#!/bin/zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_root="/Users/REDACTED/.local/share/investment-assistant/personal-market-anomaly-20260929"
database_name="ias_experience_personal_research_20260929"
raw_root="/Users/REDACTED/.local/share/investment-assistant/personal-research-20260929/raw"
token_file="$runtime_root/api-token"
api_url="http://127.0.0.1:4097"
mkdir -p "$runtime_root"

if [[ "$(psql -At "$database_name" -c 'select current_database()')" != "$database_name" ]]; then
  print -u2 "体验数据库身份不符；未启动。"
  exit 1
fi
if [[ ! -d "$raw_root" ]] || [[ "$(find "$raw_root" -type f | wc -l | tr -d ' ')" == "0" ]]; then
  print -u2 "体验原件目录不可读；未启动。"
  exit 1
fi
if curl -fsS --max-time 2 "$api_url/health/ready" >/dev/null 2>&1; then
  print -u2 "端口 4097 已有服务；请关闭旧体验入口后重试，避免连接错误代码版本。"
  exit 1
fi

cd "$repo_root"
export LOCAL_ALPHA_DATABASE_URL="postgresql://REDACTED_USER@127.0.0.1:5432/$database_name"
export LOCAL_ALPHA_ACTOR_ID="step6-public-research-verified"
export LOCAL_ALPHA_RAW_STORE_ROOT="$raw_root"
export LOCAL_ALPHA_FUTU_PYTHON="/Users/REDACTED/.local/share/investment-assistant/futu-venv/bin/python"
export LOCAL_ALPHA_OPEND_SSH_TARGET="redacted@example.invalid"
export LOCAL_ALPHA_OPEND_SSH_REMOTE_HOST="192.0.2.1"
export LOCAL_ALPHA_OPEND_SSH_REMOTE_PORT="11111"
export LOCAL_ALPHA_OPEND_PORT="11117"
export LOCAL_ALPHA_BRIDGE_PORT="4397"
export LOCAL_ALPHA_API_PORT="4097"
export LOCAL_ALPHA_EXISTING_SCHEMA_ONLY="1"
export LOCAL_ALPHA_ENABLE_AI="0"
export LOCAL_ALPHA_FUTU_HISTORY_USE_AUTHORITY="confirmed"
export LOCAL_ALPHA_ANOMALY_CADENCE_MINUTES="10"
export LOCAL_ALPHA_EXPERIENCE_LABEL="异常调查体验"
export LOCAL_ALPHA_EXPERIENCE_TOKEN_FILE="$token_file"
export PERSONAL_MARKET_ANOMALY_BENCHMARK_CACHE_FILE="$runtime_root/hsi-observation.json"
export PERSONAL_MARKET_ANOMALY_JOURNAL_FILE="$runtime_root/anomaly-events.json"
export PGAPPNAME="ias-personal-market-anomaly-20260929"

node scripts/local-alpha-runtime.mjs > "$runtime_root/service.log" 2>&1 &
backend_pid=$!
trap 'kill -TERM "$backend_pid" 2>/dev/null || true' EXIT INT TERM
for attempt in {1..90}; do
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    tail -n 30 "$runtime_root/service.log" >&2
    exit 1
  fi
  if [[ -s "$token_file" ]] && curl -fsS --max-time 2 "$api_url/health/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done
if [[ ! -s "$token_file" ]]; then
  print -u2 "体验授权文件缺失；未连接。"
  exit 1
fi
python3 - "$api_url" "$token_file" <<'PY'
import json,sys,urllib.request
base,token_path=sys.argv[1:]
token=open(token_path).read().strip()
request=urllib.request.Request(base+'/api/mobile/research/candidate-memberships/2/personal-brief',headers={'x-internal-token':token})
with urllib.request.urlopen(request,timeout=20) as response: brief=json.load(response)
assert brief['symbol']=='HK.00175' and brief['membershipId']=='2' and brief['status']=='available'
request=urllib.request.Request(base+'/api/mobile/research/market-anomalies',headers={'x-internal-token':token})
with urllib.request.urlopen(request,timeout=25) as response: anomalies=json.load(response)
assert anomalies['ok'] and anomalies['ruleVersion']=='personal-market-anomaly-v1'
print('异常 API / 个人研究资料 / 体验库：身份已核对')
PY

simulator="${LOCAL_PERSONAL_SIMULATOR_UDID:-00000000-0000-0000-0000-000000000000}"
state="$(xcrun simctl list devices -j | python3 -c 'import json,sys; d=json.load(sys.stdin); u=sys.argv[1]; print(next((x["state"] for g in d["devices"].values() for x in g if x["udid"]==u),"NOT_FOUND"))' "$simulator")"
if [[ "$state" == "Shutdown" ]]; then
  xcrun simctl boot "$simulator"
  xcrun simctl bootstatus "$simulator" -b
elif [[ "$state" != "Booted" ]]; then
  print -u2 "Simulator 不可用：$state"
  exit 1
fi
open -a Simulator --args -CurrentDeviceUDID "$simulator"
export ANNUAL_RINGS_BASE_URL="$api_url"
export ANNUAL_RINGS_TOKEN_FILE="$token_file"
export ANNUAL_RINGS_BUILD_DIR="$runtime_root/DerivedData"
export ANNUAL_RINGS_EXPERIENCE_BUNDLE_ID="com.example.AnnualRingsPersonalMarketAnomaly"
export ANNUAL_RINGS_EXPERIENCE_LABEL="异常调查体验"
if ! apps/ios/AnnualRingsClient/run-simulator.sh "$simulator" > "$runtime_root/ios-launch.log" 2>&1; then
  tail -n 35 "$runtime_root/ios-launch.log" >&2
  exit 1
fi
print "异常调查体验已打开；保持本窗口运行即可继续使用。"
wait "$backend_pid"
