# Repository Instructions

This file owns investment-assistant-specific rules. Inherit general communication,
implementation, workspace preservation and probe practices from the global
AGENTS.md; keep task progress in PROJECT_STATE.yaml rather than this file.

## Authority and execution

- Follow the latest explicit Owner instruction within its stated scope. An
  authorized local change, repair, or governance task does not require a Stage
  Issue or a special phrase. Questions and audits remain read-only unless edits
  are authorized. Permissions do not expand task scope.
- Use Stage Runner only for an explicitly requested or scheduled Stage. Its
  validated envelope, branch, allowed paths, and reporting protocol govern that
  run. See `docs/governance/CODEX_TASK_PROTOCOL.md` and the Stage Runner skill.
- Use `docs/governance/GOAL_PURSUIT.md` for an explicitly named long goal.
  Ordinary local authorization need not become Goal Pursuit.
- Local-only delivery stays local. Pushes, messages, PR publication, deployment,
  and merges require applicable Owner authority; creating a branch does not
  authorize them. Follow the current task publication scope; local-only work
  does not implicitly authorize an external write.

## Resume and document responsibilities

- When handing off to another checkout, verify the saved-project AGENTS.md and
  its exposed skill entry route to the current worktree and current mode rules.
  Updating only the delivery worktree does not complete a governance handoff.
- Read the actual controller ROOT's `PROJECT_STATE.yaml` first. An ACTIVE
  `project_controller_handoff.current_task` selects the current task. Missing,
  conflicting, paused or stale controller bindings never fall back to an old
  `local_goal`/`next_task`. Without a controller, those fields retain their
  legacy package relationship; history and snapshots never select live work.
  Verify the checkout, exact HEAD, branch, diff, and task before changing code.
  A different checkout or old date is not the current product version.
  A new bounded Owner request selects its own scope; do not resume an unrelated
  product next_task or overwrite its progress during a documentation task.
- The controller calls `project-state-verify` before dispatch and closeout;
  the designated integrator calls it before integration, and each resumed
  controller/executor calls it before dependent writes. Use the actual roots:
  `node "$ROOT/scripts/project-state-verify.mjs" --live --state-root "$ROOT"
  --execution-root "$EXECUTION" --task-id "$TASK_ID" --task-revision "$REVISION"
  --caller-thread "$CALLER_THREAD" --lifecycle dispatch|integrate|closeout|resume`.
  Declare `--operation repository_write` for dependent repository writes;
  integrate/closeout also require `--target-head <reviewed source commit>`.
  Consume the exit code and `lifecycleEligible`, preserve the result, and stop
  the affected action on refusal. Legal read-only diagnosis can continue.
  An argument naming a caller is consistency evidence, not authentication.
- No-argument checks are snapshots with `lifecycleEligible=false`. Existing
  Stage validation still requires its explicit mode and valid envelope; a
  bounded `--stage-input` uses the existing validator with supplied issue and
  comment inputs, never discovers/fetches a Stage or replaces its fresh check.
  Paid sends still require their separate applicable authorization and existing
  preflight; a remaining balance never revives a stopped chain.
- Keep one controller ROOT record across worktrees. Explicitly registered
  `serialized_shared_checkout` may use ROOT=EXECUTION: `execution.branch` names
  the producing candidate, `execution.original_branch/original_ref_oid` bind
  the return branch and its frozen ref, and `control_branch` names the actual
  ROOT branch. After independently reviewed same-commit ref restoration, only
  the controller may use a clean, proven `resume --operation repository_write
  --target-head <reviewed source>` result with `managementSyncOnly=true` to
  synchronize management paths. It then records `integration.status=INTEGRATED`,
  `source_head` and `installed_head`, plus the restored `control_branch`.
  Subsequent checks verify both refs, ancestry and metadata-only head movement;
  they do not skip branch checks. New executable changes in this ref-restoration path require fresh review.
- Register the existing controller lock identity in `controller_lock` (pid,
  ppid, hostname, acquiredAt, lockRoot). This is the existing standard lock,
  never a second running lock or a token shared with children. Evidence must
  bind frozen task spec, criterion, scope, kind, source commit, producer and
  readable artifact hashes. Unsupported old material remains historical or
  UNKNOWN; build/health checks do not prove App journeys or Owner acceptance.
  The current reader supports bounded CLI records and independent review
  bindings; runtime and Owner self-declarations stay UNKNOWN/unsupported until
  their reliable source readers exist. The public pure evaluator always stays
  structural; only fresh `verifySelectedTask` I/O can report lifecycle readiness.
  Independent review records also bind the controller-owned original
  `read_thread` response hash and its completed final message/turn IDs; verify
  the actual window, task spec, source version, scope and returned conclusion.
  A reviewer ID in a self-written record is insufficient.
  These checks operate only when called, not as filesystem enforcement.
- `ROADMAP.yaml` contains capability order and dependencies, not PR diaries.
  `QUALITY_GATES.yaml` defines applicable checks. `CHANGELOG.md` and the
  explicitly historical snapshots retain past work, never execution authority.
- Product Baseline Issue 156 and subsequent explicit Owner amendments define
  product choices. Record their scope and source when relevant. A waiver of a
  waiting period permits continuation; it does not make an unrun test pass.
- At a stable product checkpoint update state once when progress changes.
  Documentation-only work must not imply product acceptance. Never hardcode an
  old branch, PR,
  ongoing status, or UNKNOWN result into a validator as the only valid future.

## Product and architecture

- Build an Owner-only, advisory investment assistant. A complete journey helps
  the Owner understand current judgment, what changed, valuation and price
  conditions, principal risk and invalidation, and one next action with sources.
- iOS is the daily-use client. The target tabs are `Today / Market / Research /
  Assets`, Today default; search and assistant are outside the tab bar. The
  five-ring overview is read-only and non-navigational. Web provides shared
  critical journeys and deeper operations; critical facts must agree across
  clients. Keep hashes, diagnostics and repeated safety text in expandable
  evidence, not the primary decision surface.
- Reuse current contracts, Fastify, PostgreSQL, market adapters, native SwiftUI,
  and existing task processing. Necessary operations may extend existing API
  resources. Do not build duplicate queues, databases, schedulers, or a parallel
  client/runtime. No full rewrite or speculative infrastructure.
- Follow `ARCHITECTURE_BASELINE.yaml` for dependency and fact boundaries. Keep
  contracts independent of applications and clients independent of databases.
- A failing provider degrades that lane visibly with source and cutoff; it
  does not block unrelated reading, drafts, or research. Correctness checks for
  periods, calculations, units, identity and evidence remain necessary even
  without an irreversible external action. Avoid controls with no reachable
  defect or meaningful product requirement.

## Delivery, collaboration and verification

- Owner sets the user task, budget and data permissions. Codex plans, implements,
  reads real results, checks the App and repairs within that scope; reversible
  local steps do not need ChatGPT approval. Concentrate independent review on
  complete product stages and concrete material financial, history, privacy or
  permission risks; a cross-module edit alone is not a trigger. Keep self-check separate from independent
  acceptance; optional improvements do not move the current completion criteria.
- 能用管理机制、产品约定（SOP）或界面提示解决的事情，不要下沉到技术底层去死磕。
- 以业务驱动为主，需要技术攻关的优化算法/代码/方案，需要单独评审。
- Deliver a bounded complete behavior, not an endless PR or a collection of
  buttons and test artifacts. State the behavior, scope, acceptance criteria
  and next action. Do not measure product value by effort ratios or line counts.
- Apply the binding personal-iteration testing policy below. Select existing
  checks from QUALITY_GATES.yaml by changed behavior and concrete risk; its
  command lists do not require a full run at every local checkpoint.
- Before editing a journey, identify the authoritative fact, contract, API and
  client path. At delivery, inspect the actual changed diff and verify the
  affected user path, including applicable empty, stale, error and permission
  states. No fabricated success, freshness or completed writes.
- Report defects, isolate the affected action, repair within authority, and
  recheck. P1/P2 findings do not create a new permission requirement. Independent
  review follows the stage/risk cadence below and precedes an authorized merge
  when applicable.
  Never hide failures or delete correctness tests merely to obtain green CI.
- Use the global bounded read-only probe rules. Independent ChatGPT review occurs
  only when explicitly requested or at a major-version checkpoint: a complete
  product stage or substantial change in direction or architecture. A single
  feature, small repair, commit or local integration does not trigger it. Ask
  whether delivery follows the original needs and design, whether governance is
  proportionate, and whether architecture, technology and reuse choices fit.
  Seek directional risks, key deviations, evidence impact and decision advice.
  Codex owns variable, format, hash and exact-code correctness and the necessary
  source review; small fixes do not repeat external review or add automatic gates.
- When the Owner explicitly requests separate implementation task windows,
  give each a non-overlapping scope and dedicated branch from a common base.
  They return ordinary commits and focused checks; one controller integrates.
  Internal probes do not substitute for requested user-visible tasks.
- Separate implementation, integration, runtime and Owner acceptance evidence.
  Every claim must name the object, source commit and evidence; uncommitted
  changes must also be identified, since HEAD alone does not describe them.
  Acceptance applies
  only to its specified version/scope. Missing evidence is UNKNOWN; continued
  development or a waived wait never proves full UAT.
- Local and independent review are evidence, not merge authority. For an
  authorized merge, bind the unique PR, current reviewed head and squash method
  after applicable checks pass. Head drift requires refreshed evidence, not a
  repeated magic phrase. Forbid auto-merge and direct pushes to main. Stage
  Runner itself never merges; a separately authorized controller does closeout.

## 个人自用快速迭代的测试约定

- 本项目处于个人自用、产品尚未定稿的快速迭代阶段。以下约定持续适用于
  总控、执行和复核对话；切换窗口、交接或上下文压缩后，继续工作前必须
  重读本节及当前任务。不得因窗口、代理或上下文变化恢复旧的全量验收方式。
  只有 Owner 明确改变产品阶段或要求，才调整这一默认标准。
- Owner 明确要求：“没有我的允许不要写测试代码和测试用例。”未经 Owner
  针对测试编写的明确允许，执行、复核及子代理均不得新增或修改测试代码
  和测试用例；普通开发授权不包含测试编写授权。此约定跨窗口、交接及上下文
  压缩持续有效；运行已有检查仍按最小充分范围选择。
- 按实际改动及风险选择最小充分验证：文案、样式和可逆界面小改动检查
  差异及受影响页面，代码变更按需编译；接口、合同和状态变化检查调用方
  兼容性、相关现有测试及适用失败路径。
- 身份、权限、金额、日期与期间、单位、财务计算、来源引用、正式历史、
  保存与恢复、删除和幂等性保留必要边界验证。不得删改正确性检查、伪造
  数据或吞掉错误来提速；一次构建成功不等于实际可用或 Owner 验收。
- 一组相关改动以完整用户路径为交付单位，集中检查实际使用和必要的独立
  复核。相关检查通过后，仅因相关代码或依赖变化、新失败、具体未解决风险
  或 Owner 明确要求才重跑。更换对话、更新文档或增加提交不构成重跑理由。
- 全量回归仅在影响范围确实广泛、重大完整交付、适用的发布/合并要求或
  Owner 明确要求时执行，并在已有进度记录中说明具体触发原因。日常本地
  检查点不得自动叠加全仓测试、全部 Swift 测试、全部量化流水线或重复构建。
  未运行的检查如实标注，不把历史结果冒充新版本的完整验收。
- 当前产品尚未成型阶段，Owner 要求整体减少代码检查，不是把独立核查
  转给总控。日常功能、修补、提交和本地安装不逐包配置独立源码 PASS 门槛；
  执行者只做实现所需的代码阅读和必要检查，总控不再对每个候选逐文件重读，
  也不追加一套自查替代独立核查。受影响候选按需集中编译一次，实际主路径
  确认一次；仅针对具体失败补查，不展开无关状态和字段的重复枚举。
- 独立核查集中在主体功能成型或完整产品阶段交付，重点核对真实可用能力、
  需求覆盖、重要数据风险及方向或架构偏离，再做必要的深入源码复核。
  金额计算、身份权限、用户数据保存/删除/恢复或正式历史出现具体重要风险时，
  只及时核查受影响部分，不扩大为全套检查。整体成型后做一次全面深入复核；
  当前减少核查不删除最终验收要求、不把未核查写成通过。
- 必要独立复核优先复用已有证据，不重跑执行者全部检查。纯文档修改只运行
  project-state-verify 和定向差异检查，不启动服务或模拟器。
- 当前设备范围仅为一台 iPhone 17 Pro Max；设备身份从 PROJECT_STATE.yaml
  读取。不以多机型适配、额外设备安装或无关检查阻塞当前可用版本。
- 沿用已有状态和证据记录，在稳定交付点更新一次；不按每个小修复另建验收
  包或重复台账，不为执行本约定新增测试平台。确有扩大验证的需要时说明
  具体风险及范围，不把常规测试选择变成新的审批流程。

## Lock and workspace safety

- Before shared repository mutation the controller acquires the existing
  `scripts/codex-stage-run-lock.mjs` lock and keeps its token only in memory.
  Authorized child implementation scopes operate under that controller; only
  integration is serialized. Never pass the token to children.
- For Owner-requested parallel implementation, ROOT registers each real task
  window, private directory, source base and file ownership in the current task,
  then fresh-dispatches that window. Before private writes, its implementer
  rereads the actual ROOT state and these rules, verifies the current revision,
  assigned identity and directory, controller lock, shared input hashes and
  private Git state. Private implementers do not impersonate the shared executor
  in `project-state-verify` and do not write the shared checkout or operate its
  services, database or device. The existing shared lifecycle check and sole
  integrator still govern every shared write and integration.
- Busy locks block competing writes and integration, not read-only diagnosis.
  After controller loss, stop writes; read-only inspection may continue.
  Never adopt, steal or force-release a lock. Verify PID, parent and host, then
  obtain explicit stale-lock recovery authority before recovery. No second lock
  system or recurring historical bootstrap exception.
- Preserve unknown changes and historical worktrees. No stash, reset --hard,
  clean, force push, rebase or history rewriting to make a task fit. Do not touch
  `.ai-bridge` or another task's Simulator. The retired
  `holding-evidence-research-beta-v1-20260725` worktree remains untouched.
- A blocked external lane stops only its dependent work. Never label a whole
  goal blocked while authorized independent work remains possible.

## Trading, data and external boundaries

- No real broker order submission, trading credentials, unlock flows, automatic
  formal decisions, or paper/real trading switches. Futu is quote data and
  explicitly identified simulation only. Production remains NO_GO.
- Research and quantitative code must not mutate official portfolio,
  transaction, cash, fee, position or review facts. Preserve explicit authorized
  product writes with user/symbol/version binding, idempotency and readback.
- Pingan is Owner-approved only for account-scoped local development/Local Beta
  current portfolio when fresh and valid. Historical/sample/stale/quant data
  is never live holdings, reconciliation or production authority.
- Cloud AI sending, deletion, backup restore and formal fact binding retain
  their distinct authorization and privacy boundaries; browsing is not a write.
- `.ai-bridge`, watcher automation, MCP/Cloudflare/GPT configuration, automatic
  Stage discovery, deployment and physical-device work remain outside ordinary
  scope unless separately authorized. No access to another task's resources.
- Legacy inspection requires explicit bounded read-only authorization; Stage
  mode additionally requires its external_readonly envelope. No legacy runtime,
  network execution, sensitive files, databases, archives or wholesale copying.
  Classify retained knowledge with evidence/confidence before selective reuse;
  legacy access never grants migration or production authority.

## Quantitative research

Apply this section when changing or assessing quantitative behavior; it does not
require running quantitative pipelines for unrelated documentation or UI work.

- Day t close signals execute no earlier than trading day t+1. Detect future
  data, same-bar fills, backward fill, pre-split fitting, final-test tuning and
  undisclosed current-constituent survivorship bias.
- Bind formal backtests to reproducible snapshots, universe, adjustment mode,
  cutoff, code/configuration and experiments. Report costs, turnover, Sharpe,
  drawdown and concentration; retain failed experiments, not just best CAGR.
- Keep adjusted research bars separate from raw corporate-action accounting.
  Test dividends, splits, fees, board lots, cash/position reconciliation,
  suspension, missing/zero-volume prices and no unapproved leverage.
- Hong Kong low-frequency v0.1 remains the quantitative boundary unless the
  Owner explicitly expands it. No A-share/A+H, ML, high-frequency or runtime
  multi-agent platform expansion by inference.
