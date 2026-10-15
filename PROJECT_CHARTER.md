# Project Charter

## Mission

Build a dependable investment-assistance system that helps a human user understand market and portfolio context, collect and compare evidence, assess risk and impact, record decisions, and review outcomes without silently crossing into automated real-money trading.

## Product boundary

This repository contains the existing assistance platform, its shared backend and operational infrastructure, web and iOS clients, and bounded specialist research modules.

The Hong Kong low-frequency quantitative module is one research evidence provider. It must reuse existing API, database, worker, market-data, and Futu capabilities where appropriate rather than becoming a parallel product or infrastructure stack.

## Product layers

### Core assistance product

- Portfolio and position context.
- Watchlists and candidate-security workflows.
- Research evidence aggregation and conflict visibility.
- Risk and portfolio-impact explanations.
- Human decision records and later reviews.

### Shared platform

- PostgreSQL facts and migrations.
- Market-data and Futu integration.
- Redis, workers, synchronization, and idempotency.
- Authorization and write boundaries.
- Staging, production, observability, backup, recovery, and rollback.

### Clients

- Web and iOS implementations of the same critical user journeys.
- Explicit loading, empty, stale, error, and permission states.
- Stable API contracts and verifiable release smoke checks.

### Specialist research modules

- Hong Kong low-frequency quantitative research.
- Portfolio risk and exposure analysis.
- Fundamental, event, news, and market-structure evidence.
- Rule-based reminders and review feedback.

## Strategic scope

1. Inventory the complete existing system and identify the real product mainline.
2. Deliver one end-to-end core investment-decision assistance journey.
3. Strengthen shared data, fact, permission, synchronization, and operational reliability.
4. Align web and iOS clients around the core journey.
5. Develop low-frequency quant and other research modules as bounded evidence providers.
6. Add portfolio-level intelligent assistance only after the core loop and shared facts are dependable.

## Planning balance

As a default planning guide:

- 50 percent of attention goes to the core assistance product;
- 30 percent goes to shared platform and reliability;
- 20 percent goes to research modules, including low-frequency quant.

This is not a fixed staffing rule. The repository still has only one active task at a time, and the owner may explicitly reprioritize tracks.

## Explicit exclusions

Until separately approved, the project does not include:

- automatic real broker order submission or trade unlocking;
- loading or storage of real trading credentials anywhere in the project;
- unauthorized writes to official portfolio, transaction, or review facts;
- A-share or A+H quantitative expansion;
- machine-learning strategy selection;
- multi-agent orchestration;
- high-frequency or minute-level execution;
- new queues, databases, schedulers, or frameworks without measured need.

## Non-negotiable safety rules

- The final decision remains human.
- Real trading credentials must not be loaded or stored anywhere in the project.
- Existing authorized product writes must have explicit permissions, auditability, and rollback boundaries.
- Quantitative code cannot modify official trades, positions, or reviews.
- Day `t` close quantitative information cannot execute before day `t+1`.
- Same-bar execution, future-data access, centered windows, backward fill, and test-period parameter selection must be detected and blocked.
- Formal research must bind to immutable data, configuration, code, and experiment identities.
- Failed tests, incidents, experiments, audits, and health checks must not be hidden or rewritten as success.

## Engineering principles

- One active milestone and one next task.
- One scoped branch and one pull request per task.
- Prefer end-to-end user-value slices over broad rewrites or module-first roadmaps.
- Reuse existing infrastructure before adding new infrastructure.
- Every material fact, permission, data, execution, accounting, or safety change requires negative-path verification.
- Generated evidence is useful only when its provenance can be reproduced.

## Decision model

- The repository owner decides scope changes, priority, merges, deployment, and any movement toward paper or real trading.
- Codex may implement bounded tasks and prepare pull requests.
- Independent review must verify remote code, tests, CI, and evidence before merge.
- `PROJECT_STATE.yaml` is the single source of truth for the active phase and next task.

## Definition of done

A task is complete only when:

- its acceptance criteria are met;
- required tests and quality gates pass;
- the pull request contains no unrelated changes;
- safety and product boundaries remain intact;
- documentation and project state are updated when the task changes the project phase;
- the change is reviewed and merged into `main`.
