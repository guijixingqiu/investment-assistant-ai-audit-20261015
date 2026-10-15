import SwiftUI

extension GateBResearchScreen {
    var canSubmitConditionalDecision: Bool {
        guard conditionalDecisionPreview.status == "available",
              conditionalDecisionPreview.data != nil,
              !conditionalDecisionFactsAreBusy,
              !submissionState.isInFlight,
              let context = decisionContext,
              context.research.status == "available",
              let source = conditionalDecisionPreview.data?.decisionBrief.data?.sourceIdentity,
              context.contextId == source.decisionContextId,
              context.contextHash == source.decisionContextHash else { return false }
        return (try? annualConditionalJudgment()) != nil
    }

    func conditionalDecisionSection() -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("条件判断")
                    .accessibilityIdentifier("annualConditionalDecisionTitle")
                Spacer()
                Text(conditionalDecisionPreview.status)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(conditionalDecisionPreview.status == "available" ? Color.green : Color.secondary)
                    .accessibilityIdentifier("annualConditionalDecisionStatus")
            }

            conditionalScenarioSelection()

            Button {
                Task { await loadAnnualConditionalDecisionPreview() }
            } label: {
                Label(isLoadingConditionalDecisionPreview ? "冻结中" : "冻结当前事实", systemImage: "lock.doc")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoadingMobileWorkspace || submissionState.isInFlight || selectedMembership == nil)
            .accessibilityIdentifier("annualConditionalDecisionPreviewButton")

            if let message = conditionalDecisionMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(conditionalDecisionPreview.status == "available" ? Color.secondary : Color.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualConditionalDecisionMessage")
            }

            if let preview = conditionalDecisionPreview.data {
                conditionalFrozenPreview(preview)
                Divider()
                conditionalJudgmentForm()
            } else {
                Text(conditionalDecisionPreview.message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualConditionalDecisionUnavailable")
            }

            InfoBlock(
                title: "边界",
                value: "人工判断、追加记录、人工复核；无推荐、排序、目标价、目标仓位、方向、订单或自动状态变化。",
                valueIdentifier: "annualConditionalDecisionSafety"
            )
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualConditionalDecisionSection")
    }

    private func conditionalScenarioSelection() -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("组合情景", selection: $conditionalSelectedScenarioIndex) {
                ForEach(Array((portfolioLabEnvelope.data?.scenarios ?? []).enumerated()), id: \.offset) { index, scenario in
                    Text("情景 \(index + 1) · HKD \(formatNumber(scenario.hypotheticalAmount))").tag(index)
                }
            }
            .pickerStyle(.menu)
            .disabled(portfolioLabEnvelope.data?.scenarios.isEmpty != false || submissionState.isInFlight)
            .accessibilityIdentifier("annualConditionalScenarioPicker")
            Text("已加载 \(portfolioLabEnvelope.data?.scenarios.count ?? 0) 个用户金额情景")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("annualConditionalScenarioCount")
        }
    }

    private func conditionalFrozenPreview(_ preview: AnnualConditionalDecisionPreviewData) -> some View {
        let brief = preview.decisionBrief.data
        let valuation = preview.valuationQuant.data
        let lab = preview.portfolioLab.data
        let scenario = preview.selectedScenario
        return VStack(alignment: .leading, spacing: 10) {
            Text("冻结事实预览")
                .font(.callout.weight(.semibold))
            InfoBlock(
                title: "预览身份",
                value: conditionalDecisionPreview.previewId ?? "unavailable",
                valueIdentifier: "annualConditionalPreviewId"
            )
            InfoBlock(
                title: "候选与版本",
                value: "\(brief?.target.symbol ?? "unavailable") / membership=\(brief?.target.membershipId ?? "-") / version=\(brief?.target.membershipVersion ?? 0)",
                valueIdentifier: "annualConditionalTarget"
            )
            InfoBlock(title: "投资论点", value: brief?.thesis ?? "not_captured", valueIdentifier: "annualConditionalThesis")
            BulletList(title: "支持证据", items: brief?.evidence.support.map(\.summary) ?? [])
            BulletList(title: "反方证据", items: brief?.evidence.counter.map(\.summary) ?? [])
            BulletList(title: "证据缺口", items: brief?.evidence.gaps ?? [])
            InfoBlock(
                title: "估值与隐含预期",
                value: conditionalValuationSummary(valuation?.valuation),
                valueIdentifier: "annualConditionalValuation"
            )
            InfoBlock(
                title: "量化身份",
                value: "snapshot=\(valuation?.quant.model.snapshotId ?? "not_captured"); code/model=\(valuation?.quant.model.modelVersion ?? "not_captured"); cutoff=\(valuation?.quant.model.dataCutoff ?? "not_captured")",
                valueIdentifier: "annualConditionalQuantIdentity"
            )
            InfoBlock(
                title: "组合身份",
                value: "account=\(lab?.sourceIdentity.accountScopeId ?? "unavailable"); portfolio=\(lab?.sourceIdentity.portfolioSnapshotId ?? "unavailable"); context=\(lab?.sourceIdentity.portfolioContextId ?? "unavailable")",
                valueIdentifier: "annualConditionalPortfolioIdentity"
            )
            InfoBlock(
                title: "选中风险情景",
                value: "scenario=\(scenario?.scenarioId ?? "unavailable"); risk=\(scenario?.riskImpact.impactId ?? "unavailable"); amount=\(formatOptionalNumber(scenario?.hypotheticalAmount)); weight change=\(formatOptionalNumber(scenario?.comparison.candidateWeightChange))",
                valueIdentifier: "annualConditionalRiskIdentity"
            )
            InfoBlock(
                title: "机会成本边界",
                value: scenario?.comparison.opportunityCostLimitation ?? "not_captured",
                valueIdentifier: "annualConditionalOpportunityCost"
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualConditionalFrozenPreview")
    }

    private func conditionalJudgmentForm() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("人工判断")
                .font(.callout.weight(.semibold))
            Picker("信心", selection: $conditionalConfidence) {
                ForEach(AnnualConditionalDecisionConfidence.allCases, id: \.self) { confidence in
                    Text(conditionalConfidenceLabel(confidence)).tag(confidence)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("annualConditionalConfidencePicker")

            TextField("关键假设（每行一项）", text: $conditionalAssumptions, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...7)
                .focused($isConditionalInputFocused)
                .accessibilityIdentifier("annualConditionalAssumptionsField")
            TextField("失效条件（每行一项）", text: $conditionalInvalidationConditions, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...7)
                .focused($isConditionalInputFocused)
                .accessibilityIdentifier("annualConditionalInvalidationField")

            Text("组合人工复核条件")
                .font(.footnote.weight(.semibold))
            Picker("观察指标", selection: $conditionalPortfolioMetric) {
                ForEach(AnnualConditionalPortfolioMetric.allCases, id: \.self) { metric in
                    Text(conditionalPortfolioMetricLabel(metric)).tag(metric)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("annualConditionalPortfolioMetricPicker")
            Picker("触发方式", selection: $conditionalPortfolioComparison) {
                ForEach(AnnualConditionalPortfolioComparison.allCases, id: \.self) { comparison in
                    Text(conditionalPortfolioComparisonLabel(comparison)).tag(comparison)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("annualConditionalPortfolioComparisonPicker")
            TextField("人工复核阈值（%）", text: $conditionalPortfolioThresholdPercent)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .focused($isConditionalInputFocused)
                .accessibilityIdentifier("annualConditionalPortfolioThresholdField")
            TextField("阈值依据", text: $conditionalPortfolioRationale, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...4)
                .focused($isConditionalInputFocused)
                .accessibilityIdentifier("annualConditionalPortfolioRationaleField")

            DatePicker("观察开始", selection: $conditionalObservationStart, displayedComponents: .date)
                .accessibilityIdentifier("annualConditionalObservationStart")
            DatePicker("观察结束", selection: $conditionalObservationEnd, displayedComponents: .date)
                .accessibilityIdentifier("annualConditionalObservationEnd")
            DatePicker("人工复核日", selection: $conditionalReviewDate, displayedComponents: .date)
                .accessibilityIdentifier("annualConditionalReviewDate")

            Picker("流程状态", selection: $conditionalWorkflowState) {
                ForEach(AnnualConditionalWorkflowState.allCases, id: \.self) { state in
                    Text(conditionalWorkflowLabel(state)).tag(state)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("annualConditionalWorkflowPicker")

            TextField("人工判断说明", text: $userFinalDecision, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...5)
                .focused($isConditionalInputFocused)
                .accessibilityIdentifier("userFinalDecisionField")
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button {
                    isConditionalInputFocused = false
                } label: {
                    Label("收起人工判断键盘", systemImage: "keyboard.chevron.compact.down")
                }
                .accessibilityIdentifier("annualConditionalKeyboardDone")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualConditionalJudgmentForm")
    }

    func conditionalDecisionStateSection(_ state: AnnualConditionalDecisionState?) -> some View {
        let state = state ?? .notCaptured
        return VStack(alignment: .leading, spacing: 8) {
            InfoBlock(title: "条件判断快照", value: state.availability, valueIdentifier: "submittedConditionalDecisionAvailability")
            InfoBlock(title: "历史边界", value: state.limitation, valueIdentifier: "submittedConditionalDecisionLimitation")
            if let judgment = state.judgment {
                InfoBlock(title: "信心", value: conditionalConfidenceLabel(judgment.confidence), valueIdentifier: "submittedConditionalConfidence")
                BulletList(title: "关键假设", items: judgment.assumptions)
                BulletList(title: "失效条件", items: judgment.invalidationConditions)
                BulletList(
                    title: "组合人工复核条件",
                    items: judgment.portfolioObservationConditions.map(conditionalPortfolioObservationSummary)
                )
                InfoBlock(title: "观察窗口", value: "\(judgment.observationWindow.startsOn) 至 \(judgment.observationWindow.endsOn)", valueIdentifier: "submittedConditionalWindow")
                InfoBlock(title: "复核日", value: judgment.reviewOn, valueIdentifier: "submittedConditionalReviewOn")
                InfoBlock(title: "流程状态", value: conditionalWorkflowLabel(judgment.workflowState), valueIdentifier: "submittedConditionalWorkflow")
            }
            if let monitor = state.monitor {
                InfoBlock(
                    title: "人工复核监视",
                    value: "\(monitor.state) · \(monitor.reasons.isEmpty ? "事实身份未变化" : monitor.reasons.joined(separator: ", "))",
                    valueIdentifier: "submittedConditionalMonitor"
                )
                BulletList(title: "事实变化", items: monitor.changes.map(\.detail))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("submittedConditionalDecision")
    }

    private func conditionalValuationSummary(_ valuation: AnnualValuationResult?) -> String {
        guard let valuation, let quote = valuation.quote, let outputs = valuation.outputs else { return "not_captured" }
        let implied = outputs.impliedAnnualGrowthRateAtCurrentPrice.map { String(format: "%.2f%%", $0 * 100) } ?? "not_computable"
        return "quote=\(formatNumber(quote.price)); user scenario=\(formatNumber(outputs.scenarioPresentValuePerShare)); implied growth=\(implied); method=\(valuation.method.calculationVersion)"
    }

    private func conditionalConfidenceLabel(_ value: AnnualConditionalDecisionConfidence) -> String {
        switch value { case .low: "低"; case .medium: "中"; case .high: "高" }
    }

    private func conditionalWorkflowLabel(_ value: AnnualConditionalWorkflowState) -> String {
        switch value {
        case .continueResearch: "继续研究"
        case .awaitCondition: "等待条件"
        case .judgmentFormed: "判断已形成"
        case .stopFollowing: "停止跟踪"
        }
    }

    private func conditionalPortfolioMetricLabel(_ value: AnnualConditionalPortfolioMetric) -> String {
        switch value {
        case .scenarioCandidateWeight: "同一用户金额情景候选权重"
        case .scenarioLargestPositionWeight: "同一用户金额情景最大持仓权重"
        case .scenarioHhi: "同一用户金额情景集中度 HHI"
        }
    }

    private func conditionalPortfolioComparisonLabel(_ value: AnnualConditionalPortfolioComparison) -> String {
        switch value { case .atOrAbove: "达到或高于"; case .atOrBelow: "达到或低于" }
    }

    private func conditionalPortfolioObservationSummary(
        _ condition: AnnualConditionalPortfolioObservationCondition
    ) -> String {
        "\(conditionalPortfolioMetricLabel(condition.metric)) \(conditionalPortfolioComparisonLabel(condition.comparison)) \(formatNumber(condition.threshold * 100))%：\(condition.rationale)（仅触发人工复核）"
    }
}
