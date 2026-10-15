#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cat > "$WORK_DIR/main.swift" <<'SWIFT'
import Foundation

let fixturePath = CommandLine.arguments[1]
let decisionContextPath = CommandLine.arguments[2]
let pinganSnapshotPath = CommandLine.arguments[3]
let blockedPinganSnapshotPath = CommandLine.arguments[4]
let decisionReviewHistoryPath = CommandLine.arguments[5]
let candidateOverviewPath = CommandLine.arguments[6]
let marketQuotePath = CommandLine.arguments[7]
let portfolioContextPath = CommandLine.arguments[8]
let portfolioRiskImpactPath = CommandLine.arguments[9]
let quantDecisionEvidencePath = CommandLine.arguments[10]
let data = try Data(contentsOf: URL(fileURLWithPath: fixturePath))
let envelope = try JSONDecoder().decode(ResearchProfileEnvelope.self, from: data)

precondition(envelope.schemaVersion == "2026-06-17.gate-b.v1")
precondition(envelope.requestedSymbol == "HK.00175")
precondition(envelope.data?.profile.symbol == "HK.00175")
precondition(envelope.data?.evidence.count == 2)
precondition(envelope.data?.evidence.contains { $0.factKind == .fact } == true)
precondition(envelope.data?.evidence.contains { $0.factKind == .inference } == true)
precondition(envelope.data?.suggestions.first?.status == .accepted)
precondition(envelope.data?.suggestions.first?.decisionNote == "iOS smoke accepted suggestion; thesis unchanged.")

let contextData = try Data(contentsOf: URL(fileURLWithPath: decisionContextPath))
let context = try JSONDecoder().decode(DecisionContextEnvelope.self, from: contextData)
precondition(context.schemaVersion == "2026-06-23.core-1a.v1")
precondition(context.requestedSymbol == "HK.00175")
precondition(context.quote.status == "fresh")
precondition(context.provenance.quant == "quant_research_evidence")
precondition(context.quantEvidence.status == "available")
precondition(context.quantEvidence.metadata.provenance == "quant_evidence")
precondition(context.quantEvidence.metadata.authority == "quant_evidence")
precondition(context.quantEvidence.identities?.frozenSnapshot.snapshotHash.isEmpty == false)
precondition(context.quantEvidence.sampleBoundary.finalTestPolicy == "locked_report_only_no_tuning")
precondition(context.quantEvidence.authority.brokerWrite == false)
precondition(context.portfolio.reason == "authoritative_portfolio_source_not_approved")

let quantDecisionEvidenceData = try Data(contentsOf: URL(fileURLWithPath: quantDecisionEvidencePath))
let quantDecisionEvidence = try JSONDecoder().decode(QuantDecisionEvidenceRefinement.self, from: quantDecisionEvidenceData)
precondition(quantDecisionEvidence.status == "available")
precondition(quantDecisionEvidence.symbol == "HK.09926")
precondition(quantDecisionEvidence.samples.map(\.id) == ["train", "validation", "final_test"])
precondition(quantDecisionEvidence.samples.last?.parameterSelectionAllowed == false)
precondition(quantDecisionEvidence.execution?.earliestExecution == "next_trading_day_open")
precondition(quantDecisionEvidence.execution?.allowsSameBarExecution == false)
precondition(quantDecisionEvidence.robustness?.failedExperiments.status == "not_captured")
let quantDecisionEvidenceJSON = String(decoding: quantDecisionEvidenceData, as: UTF8.self)
let quantDecisionContextData = Data("{\"quantEvidence\":{\"decisionEvidence\":\(quantDecisionEvidenceJSON)}}".utf8)
try validateQuantDecisionEvidenceCanonicalIdentity(quantDecisionContextData)

let pinganSnapshotData = try Data(contentsOf: URL(fileURLWithPath: pinganSnapshotPath))
let pinganSnapshot = try JSONDecoder().decode(PinganSnapshotEnvelope.self, from: pinganSnapshotData)
precondition(pinganSnapshot.status == .stale)
precondition(pinganSnapshot.requestedSymbol == "HK.00175")
precondition(pinganSnapshot.sourceSystem == "pingan_imported_snapshot")
precondition(pinganSnapshot.hasDisplayablePositions)
precondition(pinganSnapshot.positions.first?.currency == "HKD")
precondition(pinganSnapshot.dataUse.riskImpact == "blocked_stale_historical_only")

let blockedPinganSnapshotData = try Data(contentsOf: URL(fileURLWithPath: blockedPinganSnapshotPath))
let blockedPinganSnapshot = try JSONDecoder().decode(PinganSnapshotEnvelope.self, from: blockedPinganSnapshotData)
precondition(blockedPinganSnapshot.status == .unavailable)
precondition(!blockedPinganSnapshot.hasDisplayablePositions)
precondition(blockedPinganSnapshot.positions.isEmpty)

let decisionReviewHistoryData = try Data(contentsOf: URL(fileURLWithPath: decisionReviewHistoryPath))
let decisionReviewHistory = try JSONDecoder().decode(DecisionReviewHistoryEnvelope.self, from: decisionReviewHistoryData)
try decisionReviewHistory.validateForDisplay(market: "HK", code: "00175")
precondition(decisionReviewHistory.checks.first?.contextSnapshot.availability == .preserved)
precondition(decisionReviewHistory.checks.first?.reviews.first?.outcome == .insufficientEvidence)
precondition(decisionReviewHistory.checks.first?.reviews.first?.portfolioReview.availability == .notCaptured)
precondition(decisionReviewHistory.checks.first?.reviews.first?.portfolioReview.snapshot == nil)
precondition(decisionReviewHistory.checks.first?.reviews.first?.portfolioReview.limitation.contains("not reconstructed") == true)
precondition(decisionReviewHistory.safety.callsBroker == false)

let candidateOverviewData = try Data(contentsOf: URL(fileURLWithPath: candidateOverviewPath))
let candidateOverview = try JSONDecoder().decode(CandidateOverviewEnvelope.self, from: candidateOverviewData)
try candidateOverview.validateForDisplay()
precondition(candidateOverview.schemaVersion == "2026-07-02.core-1d.candidate-overview.v1")
precondition(candidateOverview.status == .available)
precondition(candidateOverview.provenance.candidates == "research_profiles")
precondition(candidateOverview.provenance.quotes == "persisted_market_quotes")
precondition(candidateOverview.provenance.portfolio == "omitted")
precondition(candidateOverview.candidates.map(\.symbol) == ["HK.00175", "HK.00005", "HK.09926"])
precondition(candidateOverview.candidates.map(\.quote.status) == [.fresh, .stale, .unavailable])
precondition(candidateOverview.candidates.map(\.reviewDue) == [false, true, false])
precondition(candidateOverview.candidates.map(\.latestEvidenceCapturedAt) == [
    "2026-07-02T08:55:00.000Z",
    nil,
    "2026-06-30T10:20:00.000Z"
])
precondition(candidateOverview.candidates.allSatisfy { $0.evidenceCount >= 0 && $0.pendingSuggestionCount >= 0 })
precondition(candidateOverview.message.contains("do not imply ranking or recommendation"))
precondition(!candidateOverview.message.localizedCaseInsensitiveContains("score"))

let marketQuoteData = try Data(contentsOf: URL(fileURLWithPath: marketQuotePath))
let marketQuote = try JSONDecoder().decode(MarketQuoteEnvelope.self, from: marketQuoteData)
try marketQuote.validateForDisplay(market: "HK", code: "00175")
precondition(marketQuote.requestedSymbol == "HK.00175")
precondition(marketQuote.isUsableQuote)
precondition(marketQuote.data?.symbol == "HK.00175")

let portfolioContextData = try Data(contentsOf: URL(fileURLWithPath: portfolioContextPath))
let portfolioContext = try JSONDecoder().decode(PortfolioDecisionContextEnvelope.self, from: portfolioContextData)
try portfolioContext.validateForDisplay()
precondition(portfolioContext.status == .available)
precondition(portfolioContext.portfolioSource == "pingan_imported_snapshot")
precondition(portfolioContext.summary.cash.status == "unknown")
precondition(portfolioContext.positions.allSatisfy { $0.quote.source == "futu" })

let portfolioRiskImpactData = try Data(contentsOf: URL(fileURLWithPath: portfolioRiskImpactPath))
let portfolioRiskImpact = try JSONDecoder().decode(PortfolioRiskImpactEnvelope.self, from: portfolioRiskImpactData)
try portfolioRiskImpact.validateForDisplay()
try validatePortfolioRiskImpactBinding(
    impact: portfolioRiskImpact,
    context: portfolioContext,
    candidateSymbol: portfolioRiskImpact.candidateSymbol,
    hypotheticalAmount: portfolioRiskImpact.hypotheticalAmount!
)
precondition(portfolioRiskImpact.guardrails.createsOrder == false)
precondition(portfolioRiskImpact.guardrails.productionWrite == false)

assertMarketQuoteRejects("mismatched quote identity") { body in
    var data = body["data"] as! [String: Any]
    data["code"] = "00005"
    data["symbol"] = "HK.00005"
    body["data"] = data
}
assertCandidateOverviewRejects("malformed identity") { body in
    var candidates = body["candidates"] as! [[String: Any]]
    candidates[0]["symbol"] = "HK.00176"
    body["candidates"] = candidates
}
assertCandidateOverviewRejects("malformed provenance") { body in
    var provenance = body["provenance"] as! [String: Any]
    provenance["portfolio"] = "pingan"
    body["provenance"] = provenance
}
assertCandidateOverviewRejects("duplicate symbol") { body in
    let candidates = body["candidates"] as! [[String: Any]]
    body["candidates"] = [candidates[0], candidates[0]]
}
assertCandidateOverviewRejects("unavailable with items") { body in
    body["status"] = "unavailable"
}
assertCandidateOverviewRejects("invalid quote state") { body in
    var candidates = body["candidates"] as! [[String: Any]]
    var quote = candidates[0]["quote"] as! [String: Any]
    quote["status"] = "live"
    candidates[0]["quote"] = quote
    body["candidates"] = candidates
}

let journey = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: pinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: nil,
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(journey.stages.map(\.kind) == CoreJourneyStageKind.allCases)
precondition(journey.stages.first { $0.kind == .quote }?.status == .ready)
precondition(journey.stages.first { $0.kind == .researchEvidence }?.status == .ready)
precondition(journey.stages.first { $0.kind == .pinganHistoricalContext }?.status == .stale)
precondition(journey.stages.first { $0.kind == .humanDecisionCheck }?.status == .pending)
precondition(journey.stages.first { $0.kind == .postDecisionReview }?.status == .completed)
precondition(journey.safetyStatement.contains("不会创建订单"))
let journeyAction = CoreJourneyNextAction.derive(
    state: journey,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
)
precondition(journeyAction.kind == .continueWithPinganLimitation)
precondition(journeyAction.operation == .decision)
precondition(journeyAction.explanation.contains("风险影响"))
let initialFeedback = ReviewFeedbackCard.derive(
    state: journey,
    submittedDecision: nil,
    submittedReview: nil,
    reviewHistory: decisionReviewHistory,
    pinganSnapshot: pinganSnapshot
)
precondition(initialFeedback.state == .ready)
precondition(initialFeedback.items.map(\.kind) == [.contextLimit, .evidenceGap])

let payload = envelope.data!
let emptyResearchEnvelope = ResearchProfileEnvelope(
    schemaVersion: envelope.schemaVersion,
    asOf: envelope.asOf,
    requestedSymbol: envelope.requestedSymbol,
    data: ResearchProfilePayload(profile: payload.profile, evidence: [], suggestions: payload.suggestions),
    message: envelope.message
)
let emptyResearchJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: emptyResearchEnvelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: pinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: nil,
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(emptyResearchJourney.stages.first { $0.kind == .researchEvidence }?.status == .empty)
precondition(CoreJourneyNextAction.derive(
    state: emptyResearchJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
).kind == .refreshResearch)

let unauthorizedPinganSnapshot = makePinganSnapshot(status: "unauthorized")
let conflictPinganSnapshot = makePinganSnapshot(status: "source_conflict")
let notApprovedPinganSnapshot = makePinganSnapshot(status: "not_approved")
let unauthorizedJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: unauthorizedPinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: nil,
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(unauthorizedJourney.stages.first { $0.kind == .pinganHistoricalContext }?.status == .unauthorized)
precondition(CoreJourneyNextAction.derive(
    state: unauthorizedJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
).kind == .reauthenticate)

let conflictJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: conflictPinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: nil,
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(conflictJourney.stages.first { $0.kind == .pinganHistoricalContext }?.status == .conflict)
precondition(CoreJourneyNextAction.derive(
    state: conflictJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
).kind == .resolveConflict)

let notApprovedJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: notApprovedPinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: nil,
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(notApprovedJourney.stages.first { $0.kind == .pinganHistoricalContext }?.status == .unavailable)
precondition(notApprovedJourney.stages.first { $0.kind == .pinganHistoricalContext }?.status != .limited)

let malformedJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: "仅支持形如 00175.hk 或 HK.00175 的香港五位数字代码。",
    researchEnvelope: ResearchProfileEnvelope(
        schemaVersion: envelope.schemaVersion,
        asOf: envelope.asOf,
        requestedSymbol: envelope.requestedSymbol,
        data: nil,
        message: "输入无效，未发送研究请求。"
    ),
    decisionContext: nil,
    decisionContextMessage: "输入无效，未发送决策上下文请求。",
    pinganSnapshot: nil,
    pinganSnapshotMessage: "输入无效，未发送平安快照请求。",
    submittedDecision: nil,
    decisionReviewHistory: nil,
    decisionReviewMessage: "输入无效，未发送复盘历史请求。"
)
precondition(malformedJourney.stages.map(\.status) == Array(repeating: CoreJourneyStageStatus.malformed, count: 5))
precondition(CoreJourneyNextAction.derive(
    state: malformedJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
).kind == .fixSymbol)

let completedCheckJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: pinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: makeDecisionCheck(from: context),
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(completedCheckJourney.stages.first { $0.kind == .humanDecisionCheck }?.status == .completed)
precondition(completedCheckJourney.stages.first { $0.kind == .postDecisionReview }?.status == .completed)
precondition(CoreJourneyNextAction.derive(
    state: completedCheckJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
).kind == .journeyComplete)
let completedFeedback = ReviewFeedbackCard.derive(
    state: completedCheckJourney,
    submittedDecision: makeDecisionCheck(from: context),
    submittedReview: nil,
    reviewHistory: decisionReviewHistory,
    pinganSnapshot: pinganSnapshot
)
precondition(completedFeedback.items.map(\.kind) == [.contextLimit, .evidenceGap])

var staleSubmittedDecision = decisionReviewHistory.checks.first.map(makeDecisionCheck)!
staleSubmittedDecision = DecisionCheckData(
    id: staleSubmittedDecision.id,
    market: staleSubmittedDecision.market,
    code: staleSubmittedDecision.code,
    symbol: staleSubmittedDecision.symbol,
    decisionContextSchemaVersion: staleSubmittedDecision.decisionContextSchemaVersion,
    decisionCheckSchemaVersion: staleSubmittedDecision.decisionCheckSchemaVersion,
    contextId: "decision-context:HK.00175:stale",
    contextHash: staleSubmittedDecision.contextHash,
    actionIntent: staleSubmittedDecision.actionIntent,
    humanCheckResult: staleSubmittedDecision.humanCheckResult,
    userFinalDecision: staleSubmittedDecision.userFinalDecision,
    checkedAt: staleSubmittedDecision.checkedAt,
    decisionSnapshot: staleSubmittedDecision.decisionSnapshot,
    conditionalDecision: staleSubmittedDecision.conditionalDecision,
    audit: staleSubmittedDecision.audit,
    safety: staleSubmittedDecision.safety
)
let staleCheckJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: false,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: context,
    decisionContextMessage: nil,
    pinganSnapshot: pinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: staleSubmittedDecision,
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(staleCheckJourney.stages.first { $0.kind == .humanDecisionCheck }?.status == .pending)
precondition(CoreJourneyNextAction.derive(
    state: staleCheckJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
).kind == .continueWithPinganLimitation)

let loadingWithPriorCheckJourney = CoreJourneyState.derive(
    symbol: "HK.00175",
    isLoading: true,
    malformedInputMessage: nil,
    researchEnvelope: envelope,
    decisionContext: nil,
    decisionContextMessage: "正在读取决策上下文...",
    pinganSnapshot: pinganSnapshot,
    pinganSnapshotMessage: nil,
    submittedDecision: decisionReviewHistory.checks.first.map(makeDecisionCheck),
    decisionReviewHistory: decisionReviewHistory,
    decisionReviewMessage: nil
)
precondition(loadingWithPriorCheckJourney.stages.first { $0.kind == .humanDecisionCheck }?.status == .loading)
let loadingAction = CoreJourneyNextAction.derive(
    state: loadingWithPriorCheckJourney,
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: false
)
precondition(loadingAction.kind == .waitForLoad)
precondition(loadingAction.enabled == false)

let quotePendingStages = [
    CoreJourneyStage(kind: .quote, order: 1, title: CoreJourneyStageKind.quote.title, status: .pending, detail: "报价读取待处理。", accessibilityIdentifier: CoreJourneyStageKind.quote.accessibilityIdentifier),
    CoreJourneyStage(kind: .researchEvidence, order: 2, title: CoreJourneyStageKind.researchEvidence.title, status: .unauthorized, detail: "研究证据未授权。", accessibilityIdentifier: CoreJourneyStageKind.researchEvidence.accessibilityIdentifier),
    CoreJourneyStage(kind: .pinganHistoricalContext, order: 3, title: CoreJourneyStageKind.pinganHistoricalContext.title, status: .ready, detail: "fixture", accessibilityIdentifier: CoreJourneyStageKind.pinganHistoricalContext.accessibilityIdentifier),
    CoreJourneyStage(kind: .humanDecisionCheck, order: 4, title: CoreJourneyStageKind.humanDecisionCheck.title, status: .pending, detail: "fixture", accessibilityIdentifier: CoreJourneyStageKind.humanDecisionCheck.accessibilityIdentifier),
    CoreJourneyStage(kind: .postDecisionReview, order: 5, title: CoreJourneyStageKind.postDecisionReview.title, status: .pending, detail: "fixture", accessibilityIdentifier: CoreJourneyStageKind.postDecisionReview.accessibilityIdentifier)
]
let quotePendingMixedAction = CoreJourneyNextAction.derive(
    state: CoreJourneyState(symbol: "HK.00175", stages: quotePendingStages, safetyStatement: CoreJourneyState.safetyStatement),
    decisionEnabled: false,
    reviewEnabled: false,
    loadEnabled: true
)
precondition(quotePendingMixedAction.kind == .reauthenticate)

print("Gate B iOS DTO smoke decoded HK.00175 research profile, decision context, market quote identity, historical Pingan blocked states, current Pingan/Futu portfolio facts, neutral risk binding, candidate overview contract, stale submitted-check guards, and decision-review history.")

func makePinganSnapshot(status: String) -> PinganSnapshotEnvelope {
    let body = """
    {
      "schemaVersion": "2026-06-27.core-1b-pingan-snapshot.v1",
      "status": "\(status)",
      "requestedSymbol": "HK.00175",
      "sourceSystem": null,
      "sourceSnapshotId": null,
      "sourceAsOf": null,
      "importedAt": null,
      "fetchedAt": null,
      "freshness": null,
      "limitation": "Fail closed state for deterministic iOS rendering.",
      "warning": null,
      "positions": [],
      "positionCount": 0,
      "dataUse": {
        "display": "blocked",
        "riskImpact": "blocked",
        "brokerReconciliation": "blocked",
        "accountTruth": "blocked",
        "accounting": "blocked",
        "execution": "blocked"
      },
      "safety": {
        "readOnly": true,
        "createsOrder": false,
        "createsTrade": false,
        "mutatesCash": false,
        "writesFee": false,
        "mutatesPosition": false,
        "callsBroker": false
      },
      "message": "No Pingan snapshot positions are displayed."
    }
    """
    return try! JSONDecoder().decode(PinganSnapshotEnvelope.self, from: Data(body.utf8))
}

func makeDecisionCheck(from check: RecordedDecisionCheckReviewState) -> DecisionCheckData {
    DecisionCheckData(
        id: check.id,
        market: check.market,
        code: check.code,
        symbol: check.symbol,
        decisionContextSchemaVersion: check.decisionContextSchemaVersion,
        decisionCheckSchemaVersion: check.decisionCheckSchemaVersion,
        contextId: check.contextId,
        contextHash: check.contextHash,
        actionIntent: check.actionIntent,
        humanCheckResult: check.humanCheckResult,
        userFinalDecision: check.userFinalDecision,
        checkedAt: check.checkedAt,
        decisionSnapshot: check.decisionSnapshot,
        conditionalDecision: check.conditionalDecision,
        audit: DecisionCheckAudit(
            actorType: "candidate_user",
            actorId: nil,
            idempotencyKey: "dto-smoke-completed-check",
            correlationId: nil
        ),
        safety: check.safety
    )
}

func makeDecisionCheck(from context: DecisionContextEnvelope) -> DecisionCheckData {
    DecisionCheckData(
        id: "dto-smoke-current-check",
        market: "HK",
        code: "00175",
        symbol: context.requestedSymbol,
        decisionContextSchemaVersion: context.schemaVersion,
        decisionCheckSchemaVersion: "2026-06-23.pre-trade-check.v1",
        contextId: context.contextId,
        contextHash: context.contextHash,
        actionIntent: "watch",
        humanCheckResult: "ready_to_consider",
        userFinalDecision: "DTO smoke records a current local advisory check only.",
        checkedAt: context.generatedAt,
        decisionSnapshot: nil,
        conditionalDecision: nil,
        audit: DecisionCheckAudit(
            actorType: "test",
            actorId: nil,
            idempotencyKey: "dto-smoke-current-check",
            correlationId: nil
        ),
        safety: DecisionCheckSafety(
            createsOrder: false,
            createsTrade: false,
            mutatesCash: false,
            writesFee: false,
            mutatesPosition: false,
            callsBroker: false
        )
    )
}

func assertCandidateOverviewRejects(_ label: String, mutate: (inout [String: Any]) -> Void) {
    do {
        var body = try candidateOverviewObject()
        mutate(&body)
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        let envelope = try JSONDecoder().decode(CandidateOverviewEnvelope.self, from: data)
        try envelope.validateForDisplay()
        preconditionFailure("candidate overview negative case unexpectedly passed: \(label)")
    } catch {
        return
    }
}

func candidateOverviewObject() throws -> [String: Any] {
    let data = try Data(contentsOf: URL(fileURLWithPath: candidateOverviewPath))
    let object = try JSONSerialization.jsonObject(with: data)
    return object as! [String: Any]
}

func assertMarketQuoteRejects(_ label: String, mutate: (inout [String: Any]) -> Void) {
    do {
        var body = try marketQuoteObject()
        mutate(&body)
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        let envelope = try JSONDecoder().decode(MarketQuoteEnvelope.self, from: data)
        try envelope.validateForDisplay(market: "HK", code: "00175")
        preconditionFailure("market quote negative case unexpectedly passed: \(label)")
    } catch {
        return
    }
}

func marketQuoteObject() throws -> [String: Any] {
    let data = try Data(contentsOf: URL(fileURLWithPath: marketQuotePath))
    let object = try JSONSerialization.jsonObject(with: data)
    return object as! [String: Any]
}
SWIFT

swiftc \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/*.swift \
  "$WORK_DIR/main.swift" \
  -o "$WORK_DIR/ios-gate-b-dto-smoke"

"$WORK_DIR/ios-gate-b-dto-smoke" \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/research-profile.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/decision-context.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/pingan-snapshot-stale.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/pingan-snapshot-unavailable.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/decision-review-history.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/candidate-overview.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/live-market-quote.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/portfolio-decision-context.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/portfolio-risk-impact.json \
  apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/quant-decision-evidence.json
