import Foundation

struct AnnualValuationQuantDraft: Equatable {
    var methodId = "discounted_forward_metric_multiple_user_scenario"
    var metricCurrency = ""
    var baseMetricPerShare = ""
    var annualGrowthPercent = ""
    var horizonYears = ""
    var terminalMultiple = ""
    var annualDiscountPercent = ""
    var netCashPerShare = ""
    var growthStepPercent = ""
    var multipleStep = ""
    var maxDrawdownPercent = ""
    var maxTurnoverPercent = ""
    var minTradeCount = ""

    static let empty = Self()

    func parsed() throws -> (AnnualValuationScenarioInput, AnnualQuantFilterInput) {
        let horizon = try integer(horizonYears, label: "观察年限")
        let trades = try integer(minTradeCount, label: "最少模拟交易")
        let adjusted = methodId == "adjusted_net_asset_value_user_scenario"
        let terminal = try decimal(terminalMultiple, label: adjusted ? "资产实现率（%）" : "期末倍数")
        let step = try decimal(multipleStep, label: adjusted ? "实现率步长（百分点）" : "倍数敏感性步长")
        if adjusted && (terminal > 100 || terminal + step > 100) {
            throw AnnualValuationQuantDraftError.invalid("资产实现率及乐观情景不得超过 100%。")
        }
        let valuation = AnnualValuationScenarioInput(
            methodId: methodId,
            metricCurrency: try currency(metricCurrency),
            baseMetricPerShare: try decimal(baseMetricPerShare, label: "基础每股指标"),
            annualGrowthRate: try percent(annualGrowthPercent, label: "年增长率"),
            horizonYears: horizon,
            terminalMultiple: adjusted ? terminal / 100 : terminal,
            annualDiscountRate: try percent(annualDiscountPercent, label: "年折现率"),
            netCashPerShare: try decimal(netCashPerShare, label: "每股净现金"),
            growthRateStep: try percent(growthStepPercent, label: "增长敏感性步长"),
            multipleStep: adjusted ? step / 100 : step
        )
        let filter = AnnualQuantFilterInput(
            maxDrawdownMagnitude: try percent(maxDrawdownPercent, label: "最大回撤筛选"),
            maxTurnoverOneWay: try percent(maxTurnoverPercent, label: "最大单边换手筛选"),
            minTradeCount: trades
        )
        var errors: [String] = []
        valuation.validate(errors: &errors)
        filter.validate(errors: &errors)
        if errors.isEmpty == false {
            throw AnnualValuationQuantDraftError.invalid(errors.joined(separator: "；"))
        }
        return (valuation, filter)
    }

    private func decimal(_ value: String, label: String) throws -> Double {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed == value, let number = Double(trimmed), number.isFinite else {
            throw AnnualValuationQuantDraftError.invalid("\(label)必须是有限数字。")
        }
        return number
    }

    private func currency(_ value: String) throws -> String {
        guard value.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil else {
            throw AnnualValuationQuantDraftError.invalid("估值币种必须是三个大写字母，例如 CNY 或 HKD。")
        }
        return value
    }

    private func percent(_ value: String, label: String) throws -> Double {
        try decimal(value, label: label) / 100
    }

    private func integer(_ value: String, label: String) throws -> Int {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed == value, let number = Int(trimmed) else {
            throw AnnualValuationQuantDraftError.invalid("\(label)必须是整数。")
        }
        return number
    }
}

enum AnnualValuationQuantDraftError: Error, Equatable {
    case invalid(String)
}

extension GateBResearchScreen {
    /// Explicitly run the registered quantitative research operation for the
    /// selected candidate. The operation is preregistered and fixed, so it
    /// consumes no user valuation or filter input: the run answers with the
    /// existing candidate decision-intake envelope, whose decision context
    /// carries the frozen historical quant evidence that was just published.
    /// Merely viewing the workbench never triggers a run.
    @MainActor
    func runRegisteredAnnualValuationQuant(for membership: CandidateMembershipData) async {
        guard membership.state != .archived,
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            clearAnnualValuationQuant(
                message: "当前候选身份不可用于已注册量化研究。",
                membershipId: membership.id,
                clearDraft: false
            )
            return
        }
        guard let runner = valuationQuantClient as? AnnualValuationQuantRunning else {
            clearAnnualValuationQuant(
                message: "当前运行时未启用已注册量化研究；仅可读取既有冻结证据。",
                membershipId: membership.id,
                clearDraft: false
            )
            return
        }
        // A new run never keeps derived evidence from another source or an
        // earlier run. Clearing the workbench preview keeps the user's draft
        // but drops prior valuation evidence; the existing envelope change
        // hook then invalidates any frozen binding or report preview built on
        // it. Saved history is untouched.
        clearAnnualValuationQuant(
            message: "已注册量化研究正在运行；旧冻结预览已清除。",
            membershipId: membership.id,
            clearDraft: false
        )
        let writeAuthorizationRevision = viewModel.authorizationRevision
        let requestId = requestState.beginValuationQuantLoad()
        let intake = await runner.runRegisteredAnnualValuationQuant(
            membershipId: membership.id,
            membershipVersion: membership.version,
            idempotencyKey: UUID().uuidString
        )
        guard requestState.isCurrentValuationQuantLoad(requestId) else { return }
        guard dailyClientAuthorizationIsCurrent(writeAuthorizationRevision) else {
            registeredQuantIntake = nil
            valuationQuantInputMessage = "运行时授权已变化；注册研究响应已丢弃。"
            requestState.finishValuationQuantLoad(id: requestId)
            return
        }
        guard selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            registeredQuantIntake = nil
            valuationQuantInputMessage = "候选身份或版本已变化；注册研究响应已丢弃。"
            requestState.finishValuationQuantLoad(id: requestId)
            return
        }
        // Publish only the exact membership decision-intake the accepted run
        // returned, and only when it carries readable historical quant
        // evidence; a success without evidence stays fail-closed.
        if intake.status == .available,
           intake.membershipId == membership.id,
           intake.requestedActorId == membership.actorId,
           intake.requestedSymbol == membership.symbol,
           intake.membership?.version == membership.version,
           let context = intake.decisionContext {
            if context.quantEvidence.status == "available" {
                registeredQuantIntake = intake
                decisionIntakeModel = candidateDecisionIntakeRenderModel(from: intake)
                valuationQuantInputMessage = nil
            } else {
                registeredQuantIntake = nil
                valuationQuantInputMessage = "已注册量化研究未发布可读的量化证据：\(context.quantEvidence.status)。"
            }
        } else {
            registeredQuantIntake = nil
            valuationQuantInputMessage = intake.message
        }
        requestState.finishValuationQuantLoad(id: requestId)
    }

    @MainActor
    func clearAnnualValuationQuant(
        message: String,
        membershipId: String? = nil,
        clearDraft: Bool = true
    ) {
        clearAnnualConditionalDecisionPreview(message, membershipId: membershipId)
        requestState.cancelValuationQuantLoad()
        registeredQuantIntake = nil
        valuationQuantEnvelope = .unavailable(
            message,
            membershipId: membershipId ?? "unselected",
            clientFailureState: "superseded"
        )
        valuationQuantInputMessage = nil
        if clearDraft { valuationQuantDraft = .empty }
    }

    @MainActor
    func loadAnnualValuationQuant(for membership: CandidateMembershipData) async {
        guard membership.state != .archived,
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            clearAnnualValuationQuant(
                message: "当前候选身份不可用于估值与量化复核。",
                membershipId: membership.id,
                clearDraft: false
            )
            return
        }
        let input: (AnnualValuationScenarioInput, AnnualQuantFilterInput)
        do {
            input = try valuationQuantDraft.parsed()
        } catch AnnualValuationQuantDraftError.invalid(let message) {
            clearAnnualValuationQuant(message: message, membershipId: membership.id, clearDraft: false)
            valuationQuantInputMessage = message
            return
        } catch {
            clearAnnualValuationQuant(message: "估值与量化输入无效。", membershipId: membership.id, clearDraft: false)
            valuationQuantInputMessage = "估值与量化输入无效。"
            return
        }
        clearAnnualConditionalDecisionPreview("估值与量化正在重读；旧冻结预览已清除。", membershipId: membership.id)
        let requestId = requestState.beginValuationQuantLoad()
        valuationQuantEnvelope = .unavailable(
            "正在按用户输入读取 \(membership.symbol) 的估值与量化事实。",
            membershipId: membership.id,
            clientFailureState: "loading"
        )
        valuationQuantInputMessage = nil
        let envelope = await valuationQuantClient.fetchAnnualValuationQuantWorkbench(
            membershipId: membership.id,
            valuation: input.0,
            quantFilter: input.1
        )
        guard requestState.isCurrentValuationQuantLoad(requestId) else { return }
        guard selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              selectedMembership?.symbol == membership.symbol,
              parsedSymbol?.canonical == membership.symbol else {
            valuationQuantEnvelope = .unavailable(
                "候选身份或版本已变化；旧估值与量化响应已丢弃。",
                membershipId: membership.id,
                clientFailureState: "superseded"
            )
            requestState.finishValuationQuantLoad(id: requestId)
            return
        }
        if let target = envelope.data?.target,
           (target.membershipId != membership.id
            || target.membershipVersion != membership.version
            || target.symbol != membership.symbol) {
            valuationQuantEnvelope = .unavailable(
                "估值与量化响应身份与当前候选不一致，已阻止展示。",
                membershipId: membership.id,
                clientFailureState: "malformed"
            )
        } else {
            valuationQuantEnvelope = envelope
            valuationQuantInputMessage = envelope.status == "available" ? nil : envelope.message
        }
        requestState.finishValuationQuantLoad(id: requestId)
    }
}
