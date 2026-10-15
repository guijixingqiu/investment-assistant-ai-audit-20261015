#!/bin/zsh
set -euo pipefail

mode="${1:-open}"
if [[ "$#" -gt 1 ]] || [[ "$mode" != "open" && "$mode" != "preflight" && "$mode" != "status" ]]; then
  print -u2 "用法：$0 [open|preflight|status]"
  exit 2
fi
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
controller_state="/Users/REDACTED/.codex/worktrees/personal-research-real-workflow-20260929/investment-assistant-system/PROJECT_STATE.yaml"
runtime_root="/Users/REDACTED/.local/share/investment-assistant/personal-market-anomaly-20260929"
database_name="ias_experience_personal_research_20260929"
raw_root="/Users/REDACTED/.local/share/investment-assistant/personal-research-20260929/raw"
token_file="$runtime_root/api-token"
api_url="http://127.0.0.1:4097"
cd "$repo_root"
export LOCAL_ALPHA_DATABASE_URL="postgresql://REDACTED_USER@127.0.0.1:5432/$database_name"
export LOCAL_ALPHA_EXPECTED_DATABASE_NAME="$database_name"
export LOCAL_ALPHA_EXISTING_SCHEMA_ONLY="1"
if ! simulator="$(node scripts/personal-research-startup.mjs "$controller_state")"; then
  print -u2 "请核对当前 PROJECT_STATE 的唯一 Pro Max，不要改用已删除设备。"
  exit 1
fi
if ! node scripts/local-alpha-schema-preflight.mjs; then
  print -u2 "只读核对未通过。请保持现有库不变，交由数据库负责人核对缺失迁移；不要从此入口迁移或重建。"
  exit 1
fi
if [[ ! -d "$raw_root" ]] || [[ "$(find "$raw_root" -type f | wc -l | tr -d ' ')" == "0" ]]; then
  print -u2 "体验原件目录不可读或为空；请核对原目录，勿覆盖或重建。"
  exit 1
fi
reuse_runtime=false
api_pid="$(lsof -tiTCP:4097 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
bridge_pid="$(lsof -tiTCP:4397 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [[ "$mode" == "open" && -z "$api_pid" && -n "$bridge_pid" ]]; then
  # The managed API may be restarting while its quote bridge stays up.
  for attempt in {1..20}; do
    sleep 1
    api_pid="$(lsof -tiTCP:4097 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
    if [[ -n "$api_pid" ]]; then break; fi
  done
fi
if [[ -n "$api_pid" ]]; then
  api_command="$(ps -p "$api_pid" -o command= 2>/dev/null || true)"
  if [[ "$api_command" != *"$repo_root/dist/apps/api/src/server.js"* ]]; then
    print -u2 "端口 4097 属于其他代码版本；请核对进程归属，未连接也未停止它。"
    exit 1
  fi
  api_parent_pid="$(ps -p "$api_pid" -o ppid= 2>/dev/null | tr -d ' ' || true)"
  api_parent_command="$(ps -p "$api_parent_pid" -o command= 2>/dev/null || true)"
  if [[ "$api_parent_command" != *"scripts/local-alpha-runtime.mjs"* ]] || \
      ! lsof -a -p "$api_parent_pid" -d cwd -Fn 2>/dev/null | grep -Fqx "n$repo_root"; then
    print -u2 "API 不是本入口所属的 local-alpha 父进程；请核对归属，未复用也未停止它。"
    exit 1
  fi
  if ! curl -fsS --max-time 2 "$api_url/health/ready" >/dev/null 2>&1; then
    print -u2 "本版本 API 尚未就绪；请检查现有服务日志后重试，未启动重复服务。"
    exit 1
  fi
  reuse_runtime=true
elif [[ -n "$bridge_pid" ]]; then
  print -u2 "端口 4397 已被行情桥占用而 API 不在运行；请先核对原服务和日志，未启动竞争进程。"
  exit 1
fi
if [[ -n "$bridge_pid" ]]; then
  bridge_command="$(ps -p "$bridge_pid" -o command= 2>/dev/null || true)"
  bridge_parent_pid="$(ps -p "$bridge_pid" -o ppid= 2>/dev/null | tr -d ' ' || true)"
  if [[ "$bridge_command" != *"$repo_root/scripts/futu-quote-bridge.py"* ]] || \
      [[ "$bridge_parent_pid" != "$api_parent_pid" ]]; then
    print -u2 "端口 4397 不是已核实 local-alpha 父进程的行情桥；请核对进程归属，未连接也未停止它。"
    exit 1
  fi
fi
if [[ "$mode" == "status" || "$mode" == "preflight" ]]; then
  if [[ "$reuse_runtime" == true ]]; then
    print "启动前核对通过：数据库、全部迁移、原件目录、Pro Max 已核对；本版本服务已就绪，可运行 open。"
  else
    print "启动前核对通过：数据库、全部迁移、原件目录、Pro Max 已核对；服务未运行，可运行 open。"
  fi
  exit 0
fi
mkdir -p "$runtime_root"
export LOCAL_ALPHA_ACTOR_ID="step6-public-research-verified"
export LOCAL_ALPHA_RAW_STORE_ROOT="$raw_root"
export LOCAL_ALPHA_FUTU_PYTHON="/Users/REDACTED/.local/share/investment-assistant/futu-venv/bin/python"
export LOCAL_ALPHA_OPEND_SSH_TARGET="redacted@example.invalid"
export LOCAL_ALPHA_OPEND_SSH_REMOTE_HOST="192.0.2.1"
export LOCAL_ALPHA_OPEND_SSH_REMOTE_PORT="11111"
export LOCAL_ALPHA_OPEND_PORT="11117"
export LOCAL_ALPHA_BRIDGE_PORT="4397"
export LOCAL_ALPHA_API_PORT="4097"
export LOCAL_ALPHA_FUTU_HISTORY_USE_AUTHORITY="confirmed"
export LOCAL_ALPHA_ANOMALY_CADENCE_MINUTES="10"
export LOCAL_ALPHA_EXPERIENCE_LABEL="个人研究助手"
export LOCAL_ALPHA_EXPERIENCE_TOKEN_FILE="$token_file"
export FORMAL_RESEARCH_BACKUP_OWNER_ACTOR_ID="$LOCAL_ALPHA_ACTOR_ID"
export FORMAL_RESEARCH_BACKUP_SYNC_DIR="$runtime_root/formal-backup-20261010-r30/sync"
export FORMAL_RESEARCH_BACKUP_STAGING_DIR="$runtime_root/formal-backup-20261010-r30/staging"
export FORMAL_RESEARCH_RESTORE_RAW_PARENT="/Users/REDACTED/.local/share/investment-assistant/development/report-narrative-20261010/r64-restored-originals"
export PERSONAL_MARKET_ANOMALY_BENCHMARK_CACHE_FILE="$runtime_root/hsi-observation.json"
export PERSONAL_MARKET_ANOMALY_JOURNAL_FILE="$runtime_root/anomaly-events.json"
export PGAPPNAME="ias-personal-market-anomaly-20260929"

backend_pid=""
if [[ "$reuse_runtime" != true ]]; then
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
fi
if [[ ! -s "$token_file" ]]; then
  print -u2 "体验授权文件缺失；请检查 $runtime_root/service.log，确认原服务状态后重试。"
  exit 1
fi
if ! curl -fsS --max-time 2 "$api_url/health/ready" >/dev/null 2>&1; then
  print -u2 "API 等待后仍未就绪；请检查 $runtime_root/service.log，确认后重试。"
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

state="$(xcrun simctl list devices -j | python3 -c 'import json,sys; d=json.load(sys.stdin); u=sys.argv[1]; print(next((x["state"] for g in d["devices"].values() for x in g if x["udid"]==u),"NOT_FOUND"))' "$simulator")"
if [[ "$state" == "Shutdown" ]]; then
  xcrun simctl boot "$simulator"
  xcrun simctl bootstatus "$simulator" -b
elif [[ "$state" != "Booted" ]]; then
  print -u2 "原 Pro Max Simulator 不可用：$state；请核对设备状态后重试，勿创建替代设备。"
  exit 1
fi
open -a Simulator --args -CurrentDeviceUDID "$simulator"
export ANNUAL_RINGS_BASE_URL="$api_url"
export ANNUAL_RINGS_TOKEN_FILE="$token_file"
export ANNUAL_RINGS_BUILD_DIR="$runtime_root/DerivedData"
export ANNUAL_RINGS_EXPERIENCE_BUNDLE_ID="com.example.AnnualRingsPersonalMarketAnomaly"
export ANNUAL_RINGS_EXPERIENCE_LABEL="个人研究助手"
if ! apps/ios/AnnualRingsClient/run-simulator.sh "$simulator" > "$runtime_root/ios-launch.log" 2>&1; then
  tail -n 35 "$runtime_root/ios-launch.log" >&2
  print -u2 "App 打开失败；请检查 $runtime_root/ios-launch.log。服务与原件未被清理，可核对后重试。"
  exit 1
fi
if [[ -n "$backend_pid" ]]; then
  print "个人研究助手已打开；保持本窗口运行即可继续使用。"
  wait "$backend_pid"
else
  print "个人研究助手已打开，复用本交付版本的现有本地服务。"
fi
