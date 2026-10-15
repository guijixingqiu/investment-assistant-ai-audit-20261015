#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cat > "$WORK_DIR/main.swift" <<'SWIFT'
import Foundation

let fixturePath = CommandLine.arguments[1]
let data = try Data(contentsOf: URL(fileURLWithPath: fixturePath))
let envelope = try JSONDecoder().decode(MarketQuoteEnvelope.self, from: data)

precondition(envelope.schemaVersion == "2026-06-17.gate-a.v1")
precondition(envelope.status == .live)
precondition(envelope.source.provider == .fixture)
precondition(envelope.data?.market == "HK")
precondition(envelope.data?.symbol == envelope.requestedSymbol)
precondition(envelope.data?.symbol == "\(envelope.data?.market ?? "").\(envelope.data?.code ?? "")")
precondition(envelope.isUsableQuote)

print("Gate A iOS DTO smoke decoded a canonical live Hong Kong quote.")
SWIFT

swiftc \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FactMetadataValues.generated.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchValidationPrimitives.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FactMetadata.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/MarketQuoteModels.swift \
  "$WORK_DIR/main.swift" \
  -o "$WORK_DIR/ios-gate-a-dto-smoke"

"$WORK_DIR/ios-gate-a-dto-smoke" \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/live-market-quote.json
