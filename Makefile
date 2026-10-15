.PHONY: doctor dev lint coverage test contract-test smoke gate-a-verify gate-b-verify data-gate-verify data-gate-export-verify data-gate-negative-verify data-gate-full-sample-verify data-gate-staging-rehearsal final-cutover-readiness final-cutover-readiness-verify final-cutover-blockers mainline-health-check mainline-health-report mainline-decision-readiness mainline-decision-action-readiness limited-mobile-research-routes-check limited-mobile-research-routes-readiness limited-mobile-research-routes-post-install-smoke legacy-freeze-readiness legacy-freeze-rules-check legacy-freeze-preflight legacy-freeze-strict-preflight-verify legacy-freeze-post-smoke-check legacy-freeze-live-smoke legacy-freeze-evidence-bundle legacy-freeze-retry-readiness production-takeover-boundary-check staging-write-token-readiness staging-write-token-revoke-verify staging-research-write-rehearsal staging-readonly-preflight staging-readonly-smoke futu-probe futu-live-smoke audit-db quant-review-package quant-pipeline quant-portfolio-pipeline quant-freeze-snapshot quant-freeze-snapshot-multi quant-loop-readiness quant-smoke quant-portfolio-smoke quant-portfolio-audit quant-audit ios-build ios-dto-smoke ios-gate-b-dto-smoke ios-app-smoke ios-gate-b-ui-smoke ios-staging-smoke ios-production-url-preflight ios-production-client-smoke candidate-production-url-smoke candidate-production-quote-recovery candidate-production-post-recovery-verify ios-physical-production-smoke migrate verify verify-local clean-checkout-verify

doctor:
	@node --version
	@npm --version
	@psql --version || true
	@echo "未验证: Docker daemon, Futu OpenD login, VPS, production database, iOS candidate build."

dev:
	npm run dev

lint:
	npm run lint

coverage:
	npm run coverage

test:
	npm run test

contract-test:
	npm run contract-test

smoke:
	npm run smoke

gate-a-verify:
	npm run gate-a-verify

gate-b-verify:
	npm run gate-b-verify

data-gate-verify:
	npm run data-gate-verify

data-gate-export-verify:
	npm run data-gate-export-verify

data-gate-negative-verify:
	npm run data-gate-negative-verify

data-gate-full-sample-verify:
	npm run data-gate-full-sample-verify

data-gate-staging-rehearsal:
	npm run data-gate-staging-rehearsal

final-cutover-readiness:
	npm run final-cutover-readiness

final-cutover-readiness-verify:
	npm run final-cutover-readiness-verify

final-cutover-blockers:
	npm run final-cutover-blockers

mainline-health-check:
	npm run mainline-health-check

mainline-health-report:
	npm run mainline-health-report

mainline-decision-readiness:
	npm run mainline-decision-readiness

mainline-decision-action-readiness:
	npm run mainline-decision-action-readiness

client-candidate-api-switch-verify:
	npm run client-candidate-api-switch-verify

post-switch-observe:
	npm run post-switch-observe

limited-mobile-research-routes-check:
	npm run limited-mobile-research-routes-check

limited-mobile-research-routes-readiness:
	npm run limited-mobile-research-routes-readiness

limited-mobile-research-routes-post-install-smoke:
	npm run limited-mobile-research-routes-post-install-smoke

legacy-freeze-readiness:
	npm run legacy-freeze-readiness

legacy-freeze-rules-check:
	npm run legacy-freeze-rules-check

legacy-freeze-preflight:
	npm run legacy-freeze-preflight

legacy-freeze-strict-preflight-verify:
	npm run legacy-freeze-strict-preflight-verify

legacy-freeze-post-smoke-check:
	npm run legacy-freeze-post-smoke-check

legacy-freeze-live-smoke:
	npm run legacy-freeze-live-smoke

legacy-freeze-evidence-bundle:
	npm run legacy-freeze-evidence-bundle

legacy-freeze-retry-readiness:
	npm run legacy-freeze-retry-readiness

production-takeover-boundary-check:
	npm run production-takeover-boundary-check

staging-write-token-readiness:
	npm run staging-write-token-readiness

staging-write-token-revoke-verify:
	npm run staging-write-token-revoke-verify

staging-research-write-rehearsal:
	npm run staging-research-write-rehearsal

staging-readonly-preflight:
	npm run staging-readonly-preflight

staging-readonly-smoke:
	npm run staging-readonly-smoke -- --dry-run

futu-probe:
	node scripts/futu-gate-a-probe.mjs

futu-live-smoke:
	npm run futu-live-smoke

audit-db:
	npm run audit-db

quant-review-package:
	npm run quant-review-package

quant-pipeline:
	npm run quant-pipeline

quant-portfolio-pipeline:
	npm run quant-portfolio-pipeline

quant-freeze-snapshot:
	npm run quant-freeze-snapshot

quant-freeze-snapshot-multi:
	npm run quant-freeze-snapshot:multi

quant-loop-readiness:
	npm run quant-loop-readiness

quant-smoke:
	npm run quant-smoke

quant-portfolio-smoke:
	npm run quant-portfolio-smoke

quant-portfolio-audit:
	npm run quant-portfolio-audit

quant-audit:
	npm run quant-audit

clean-checkout-verify:
	npm run clean-checkout-verify

ios-build:
	rm -rf apps/ios/AnnualRingsGateA/AnnualRingsGateAApp.xcodeproj apps/ios/AnnualRingsGateA/AnnualRingsGateAApp\ 2.xcodeproj
	cd apps/ios/AnnualRingsGateA && xcodegen generate --quiet
	cd apps/ios/AnnualRingsGateA && xcodebuild -project AnnualRingsGateAApp.xcodeproj -scheme AnnualRingsGateAApp -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO -quiet

ios-dto-smoke:
	bash scripts/ios-gate-a-dto-smoke.sh

ios-gate-b-dto-smoke:
	bash scripts/ios-gate-b-dto-smoke.sh

ios-app-smoke:
	node scripts/ios-gate-a-app-smoke.mjs

ios-gate-b-ui-smoke:
	node scripts/ios-gate-b-ui-smoke.mjs

ios-staging-smoke:
	npm run ios-staging-smoke

ios-production-url-preflight:
	npm run ios-production-url-preflight

ios-production-client-smoke:
	npm run ios-production-client-smoke

candidate-production-url-smoke:
	npm run candidate-production-url-smoke

candidate-production-quote-recovery:
	npm run candidate-production-quote-recovery

candidate-production-post-recovery-verify:
	npm run candidate-production-post-recovery-verify

ios-physical-production-smoke:
	npm run ios-physical-production-smoke

migrate:
	npm run migrate

verify:
	npm run verify
	$(MAKE) ios-dto-smoke
	$(MAKE) ios-gate-b-dto-smoke
	$(MAKE) ios-build
	$(MAKE) ios-app-smoke
	$(MAKE) ios-gate-b-ui-smoke

verify-local:
	npm run verify:local
