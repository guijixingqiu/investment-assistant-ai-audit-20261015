#!/bin/sh
set -eu
# Usage: ANNUAL_RINGS_TOKEN_FILE=/private/path/token ./run-simulator.sh <owned-simulator-udid>
: "${1:?Pass the UDID of the Simulator assigned to this client}"
CLIENT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLIENT_BUILD_DIR=${ANNUAL_RINGS_BUILD_DIR:-"$HOME/.cache/annual-rings-client"}
export CLIENT_SIMULATOR_UDID="$1"
export CLIENT_BUNDLE_ID=${ANNUAL_RINGS_EXPERIENCE_BUNDLE_ID:-com.example.AnnualRingsClient}
xcodegen generate --spec "$CLIENT_ROOT/project.yml"
xcodebuild -project "$CLIENT_ROOT/AnnualRingsClient.xcodeproj" -scheme AnnualRingsClient \
  -configuration Debug -destination "id=$CLIENT_SIMULATOR_UDID" \
  -derivedDataPath "$CLIENT_BUILD_DIR" -jobs 4 CODE_SIGNING_ALLOWED=YES \
  "PRODUCT_BUNDLE_IDENTIFIER=$CLIENT_BUNDLE_ID" build
CLIENT_APP="$CLIENT_BUILD_DIR/Build/Products/Debug-iphonesimulator/AnnualRingsClient.app"
if [ -n "${ANNUAL_RINGS_EXPERIENCE_LABEL:-}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${ANNUAL_RINGS_EXPERIENCE_LABEL}" "$CLIENT_APP/Info.plist"
  codesign --force --sign - "$CLIENT_APP"
fi
xcrun simctl install "$CLIENT_SIMULATOR_UDID" "$CLIENT_APP"
python3 - <<'PY'
import os, subprocess
from pathlib import Path
from urllib.parse import urlsplit
base = os.environ.get('ANNUAL_RINGS_BASE_URL', 'http://127.0.0.1:4037')
url = urlsplit(base)
if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.username or url.password or url.query or url.fragment:
    raise SystemExit('This local launcher only accepts a loopback HTTP API URL. Use app settings for other origins.')
env = os.environ.copy()
env['SIMCTL_CHILD_ANNUAL_RINGS_GATE_A_BASE_URL'] = base
env['SIMCTL_CHILD_ANNUAL_RINGS_INITIAL_TAB'] = 'today'
if label := env.get('ANNUAL_RINGS_EXPERIENCE_LABEL'):
    env['SIMCTL_CHILD_ANNUAL_RINGS_EXPERIENCE_LABEL'] = label
args = ['xcrun', 'simctl', 'launch', '--terminate-running-process', env['CLIENT_SIMULATOR_UDID'], env['CLIENT_BUNDLE_ID']]
if token_file := env.get('ANNUAL_RINGS_TOKEN_FILE'):
    token = Path(token_file).read_text().strip()
    if not token: raise SystemExit('Token file is empty')
    env['SIMCTL_CHILD_ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN'] = token
    env['SIMCTL_CHILD_ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN'] = token
    env['SIMCTL_CHILD_ANNUAL_RINGS_AUTH_HEADER'] = 'x-internal-token'
    env['SIMCTL_CHILD_ANNUAL_RINGS_WRITE_AUTH_HEADER'] = 'x-internal-token'
    args.append('--persist-debug-connection')
subprocess.run(args, env=env, check=True)
PY
