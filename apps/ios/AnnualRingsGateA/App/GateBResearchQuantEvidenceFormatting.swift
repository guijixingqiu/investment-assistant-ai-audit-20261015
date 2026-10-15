import Foundation

extension GateBResearchScreen {
    func quantDecisionEvidenceSummary(_ evidence: DecisionQuantEvidence) -> String {
        guard let refinement = evidence.decisionEvidence else {
            return "not_captured：旧量化上下文不从后续 manifest 或指标倒填。"
        }
        guard refinement.status == "available", let source = refinement.source else {
            return "\(refinement.status)：\(refinement.limitations.joined(separator: " "))"
        }
        return "available：\(refinement.refinementId ?? "missing-id")：\(refinement.symbol ?? "missing-symbol")：观察期 \(source.observationStartDate) 至 \(source.observationEndDate)：\(source.sourceClassification) / \(source.adjustment)：复算时间 \(evidence.identities?.generatedAt ?? "not_recorded")；原始数据截止 \(source.dataCutoff)（这是来源快照的截止日，不是本次读取或复算时间）：仅历史模拟研究。"
    }

    func quantDecisionEvidenceSamples(_ evidence: DecisionQuantEvidence) -> String {
        guard let refinement = evidence.decisionEvidence, refinement.status == "available" else {
            return "not_available：不重用旧样本指标。"
        }
        return refinement.samples.map { sample in
            let metrics = sample.metrics
            let performance = if let annualized = metrics.simulatedAnnualizedReturn,
                                 let roundTrips = metrics.simulatedClosedRoundTripCount,
                                 let winRate = metrics.simulatedWinRate {
                "年化 \(quantPercent(annualized))，完成回合 \(roundTrips)，胜率 \(quantPercent(winRate))"
            } else {
                "年化/完成回合/胜率 UNKNOWN"
            }
            return "\(sample.id) [\(sample.start)~\(sample.end), \(sample.role)]：模拟收益 \(quantPercent(metrics.simulatedTotalReturn))，\(performance)，最大回撤 \(quantPercent(metrics.simulatedMaxDrawdown))，Sharpe \(formatNumber(metrics.simulatedSharpe))，执行 \(metrics.simulatedTradeCount)，费用 \(formatNumber(metrics.simulatedTotalFees)) HKD，单边换手 \(quantPercent(metrics.simulatedTurnoverOneWay))，平均总敞口 \(quantPercent(metrics.simulatedAverageGrossExposure))，核算 \(metrics.accountingAuditStatus)。"
        }.joined(separator: "\n")
    }

    func quantDecisionEvidenceExecution(_ evidence: DecisionQuantEvidence) -> String {
        guard let execution = evidence.decisionEvidence?.execution else {
            return "not_available：不推断执行规则。"
        }
        return "信号 \(execution.signalTiming)；最早 \(execution.earliestExecution)；同 bar=\(execution.allowsSameBarExecution)；融资=\(execution.allowsMargin)；手数 \(execution.boardLot)；非零费用=\(execution.nonZeroCosts)；停牌、零成交量、缺价均拒绝模拟执行。注意：\(execution.earliestExecution) 只是既有枚举诊断值，实际协议是在下一个“已观察到”的交易日开盘执行；交易日历完整性未知，不能据此当作已核验的完整交易所日历。"
    }

    func quantDecisionEvidenceRobustness(_ evidence: DecisionQuantEvidence) -> String {
        guard let robustness = evidence.decisionEvidence?.robustness else {
            return "not_available：不推断稳健性或失败实验。"
        }
        let failedIds = robustness.failedExperiments.experimentIds
        let failedIdentity = failedIds.isEmpty ? "无" : failedIds.joined(separator: ", ")
        return "注册时点 \(robustness.registrationTiming)；预注册=\(robustness.preregistered)；前瞻留出=\(robustness.prospectiveHoldoutClaim)；final-test 调参=\(robustness.finalTestUsedForParameterSelection)；失败实验=\(robustness.failedExperiments.status)（\(failedIdentity)）· \(robustness.failedExperiments.limitation) 仅历史模拟证据，不是预测、排序、推荐、组合变更或执行指令。"
    }

    func quantFormalEvidenceChecks(_ evidence: DecisionQuantEvidence) -> [String] {
        guard let formal = evidence.decisionEvidence?.formalEvidence else {
            return ["UNKNOWN：当前 manifest 未绑定正式量化完整性清单，不从相邻产物推断。"]
        }
        let rule = formal.candidateResearchRule
        return [
            "候选规则：\(rule.ruleVersion) · universe=\(rule.universeVersion) · cutoff=\(rule.cutoff) · eligibility=\(rule.eligibilityEvidenceStatus) · 保持来源顺序、不排名、不推荐；资格未知时仅人工研究。"
        ] + formal.checks.map { check in
            "\(check.id)：\(check.status.uppercased()) · \(check.identity ?? "无证据身份") · \(check.limitation)"
        }
    }

    private func quantPercent(_ value: Double) -> String {
        String(format: "%.2f%%", value * 100)
    }
}
