import SwiftUI
extension GateBResearchScreen {
    @MainActor
    func resetResearchReportFormalDecisionDraft() {
        researchReportFormalDecisionIntent = .watch
        researchReportFormalDecisionDraft = FormalOwnerDecisionDraft()
        pendingFormalRiskConfirmation = nil
    }

    @MainActor
    func openRequestedTodayFormalDecisionTarget(
        _ target: TodayFormalDecisionNavigationTarget
    ) async {
        guard selectedDecisionLayer == .evidence,
              parsedSymbol?.canonical == target.binding.symbol else {
            clearRequestedTodayFormalDecisionTarget(
                "Today 正式决定目标与当前标的不一致；请求已清除。",
                expected: target
            )
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        await refreshDailyClient(
            restoredNavigation: false,
            preferredMembership: selectedMembership
        )
        guard requestedTodayFormalDecisionTarget == target,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              selectedMembership?.id == target.binding.membershipId,
              selectedMembership?.version == target.binding.membershipVersion,
              selectedMembership?.symbol == target.binding.symbol else {
            clearRequestedTodayFormalDecisionTarget(
                "Today 目标已因授权或 membership 漂移而清除；没有自动采用。",
                expected: target
            )
            return
        }
        await loadTwoLayerReports()
        guard requestedTodayFormalDecisionTarget == target,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == target.binding.symbol,
              resolveTodayFormalDecisionTarget(target) else {
            clearRequestedTodayFormalDecisionTarget(
                "Today 目标已因授权、membership 或新报告漂移而清除；没有自动采用。",
                expected: target
            )
            return
        }
        requestedTodayFormalDecisionTarget = nil
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .brief
        pendingDecisionWorkspaceScrollTarget = twoLayerReportFormalDecisionControlAnchor(target.binding.reportId)
        researchReportFormalDecisionMessage =
            "已定位你确认过的当前报告；请先明确采用，再填写正式决定。"
    }
    @MainActor
    private func clearRequestedTodayFormalDecisionTarget(
        _ message: String,
        expected target: TodayFormalDecisionNavigationTarget
    ) {
        guard requestedTodayFormalDecisionTarget == target else { return }
        requestedTodayFormalDecisionTarget = nil
        researchReportFormalDecisionBinding = nil
        resetResearchReportFormalDecisionDraft()
        researchReportFormalDecisionMessage = message
    }
    func resolveTodayFormalDecisionTarget(_ target: TodayFormalDecisionNavigationTarget) -> Bool {
        guard let membership = selectedMembership,
              let workspace = twoLayerReportWorkspace.envelope?.data,
              let report = workspace.latestReport,
              let decision = workspace.userDecision,
              let pack = workspace.latestPack,
              researchReportFormalDecisionIsEligible(
                membership: membership, workspace: workspace,
                report: report, decision: decision, pack: pack
              ) else { return false }
        let current = ResearchReportDecisionBinding(
            membershipId: membership.id, membershipVersion: membership.version,
            symbol: membership.symbol, evidencePackId: pack.id,
            evidencePackFingerprint: pack.packFingerprint, reportId: report.id,
            reportVersion: report.version, contractVersion: report.contractVersion,
            reportFingerprint: report.reportFingerprint, reportDecisionId: decision.id,
            reportDecision: decision.decision, reportDecisionActorType: decision.actorType,
            reportDecisionActorId: decision.actorId, decidedAt: decision.decidedAt
        )
        return current == target.binding
    }
    func twoLayerReportFormalDecisionControlAnchor(_ reportId: String) -> String {
        "two-layer-report-formal-decision-control:\(reportId)"
    }
    @MainActor
    func adoptTwoLayerReportForFormalDecision(
        _ report: TwoLayerReportData,
        decision: TwoLayerReportDecision,
        pack: FrozenResearchEvidencePack
    ) {
        guard let membership = selectedMembership,
              researchReportFormalDecisionIsEligible(
                membership: membership,
                workspace: twoLayerReportWorkspace.envelope?.data,
                report: report,
                decision: decision,
                pack: pack
        ) else {
            researchReportFormalDecisionBinding = nil
            submissionState.discardForSourceDrift()
            clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
            researchReportFormalDecisionMessage = "只有当前、内容完整且已由你确认的报告才能作为正式决定来源。"
            return
        }
        let binding = ResearchReportDecisionBinding(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            evidencePackId: pack.id,
            evidencePackFingerprint: pack.packFingerprint,
            reportId: report.id,
            reportVersion: report.version,
            contractVersion: report.contractVersion,
            reportFingerprint: report.reportFingerprint,
            reportDecisionId: decision.id,
            reportDecision: decision.decision,
            reportDecisionActorType: decision.actorType,
            reportDecisionActorId: decision.actorId,
            decidedAt: decision.decidedAt
        )
        do { try binding.validate(expectedSymbol: membership.symbol) }
        catch {
            researchReportFormalDecisionBinding = nil
            submissionState.discardForSourceDrift()
            clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
            researchReportFormalDecisionMessage = "报告绑定校验失败；未采用，也未提交正式决定。"
            return
        }
        submissionState.prepareResearchReportAdoption(binding)
        clearDailyTrackingReconsiderationDraft()
        resetResearchReportFormalDecisionDraft()
        if let advice = report.payload.adviceLayer {
            researchReportFormalDecisionIntent = DecisionActionIntent(rawValue: advice.direction ?? "") ?? .watch
            researchReportFormalDecisionDraft = .from(advice)
        }
        researchReportFormalDecisionBinding = binding
        researchReportFormalDecisionMessage =
            "已选择报告 #\(report.id) 作为来源；请填写检查结果和正式决定说明后提交。"
    }
    @MainActor
    func submitTwoLayerReportFormalDecision() async {
        guard let symbol = parsedSymbol,
              let context = decisionContext,
              let binding = researchReportFormalDecisionBinding,
              let membership = selectedMembership,
              let workspace = twoLayerReportWorkspace.envelope?.data,
              let report = workspace.latestReport,
              let decision = workspace.userDecision,
              let pack = workspace.latestPack,
              researchReportFormalDecisionIsEligible(
                membership: membership,
                workspace: workspace,
                report: report,
                decision: decision,
                pack: pack
              ),
              binding.symbol == symbol.canonical,
              membership.id == binding.membershipId,
              membership.version == binding.membershipVersion,
              report.id == binding.reportId,
              report.version == binding.reportVersion,
              report.contractVersion == binding.contractVersion,
              report.reportFingerprint == binding.reportFingerprint,
              decision.id == binding.reportDecisionId,
              decision.actorId == binding.reportDecisionActorId,
                  pack.id == binding.evidencePackId,
                  pack.packFingerprint == binding.evidencePackFingerprint else {
            researchReportFormalDecisionBinding = nil
            submissionState.discardForSourceDrift()
            clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
            researchReportFormalDecisionMessage = "报告、研究标的或决定上下文已经变化；请重新核对后采用。"
            return
        }
        guard let advice = report.payload.adviceLayer,
              let systemDirection = advice.direction,
              let unconfirmedDecision = researchReportFormalDecisionDraft.request(
                direction: researchReportFormalDecisionIntent,
                systemDirection: systemDirection
              ) else {
            researchReportFormalDecisionMessage = "请完整填写决定理由、期限、价格条件、研究仓位、风险、失效条件和复核日期；与系统方向不同时还要填写差异理由。"
            return
        }
        let decisionSnapshotBinding: DecisionSnapshotBinding
        do {
            decisionSnapshotBinding = try .capture(
                portfolioContext: portfolioContext,
                riskImpact: portfolioRiskImpact
            )
        } catch {
            pendingFormalRiskConfirmation = nil
            researchReportFormalDecisionMessage = "当前组合或风险身份无效；请重新读取后再提交。"
            return
        }
        let assessment = evaluateFormalPersonalRisk(
            limits: unconfirmedDecision.personalRisk?.limits ?? .none,
            portfolioContext: portfolioContext,
            riskImpact: portfolioRiskImpact
        )
        let confirmationFingerprint = DecisionCheckSubmissionFingerprint(
            contextId: context.contextId,
            contextHash: context.contextHash,
            decisionSnapshotBinding: decisionSnapshotBinding,
            researchReportBinding: binding,
            formalDecision: unconfirmedDecision,
            actionIntent: researchReportFormalDecisionIntent.rawValue,
            humanCheckResult: humanCheckResult.rawValue,
            userFinalDecision: unconfirmedDecision.reason
        )
        if assessment.requiresOverride {
            guard unconfirmedDecision.personalRisk?.overrideReason != nil else {
                pendingFormalRiskConfirmation = nil
                researchReportFormalDecisionMessage = "个人风险限制已触发或风险事实不可用；请填写覆盖理由。"
                return
            }
            guard pendingFormalRiskConfirmation == confirmationFingerprint else {
                pendingFormalRiskConfirmation = confirmationFingerprint
                researchReportFormalDecisionMessage = "强风险警告：\(formalRiskWarningSummary(assessment))。再次点击提交，才会连同覆盖理由永久记录。"
                return
            }
        } else {
            pendingFormalRiskConfirmation = nil
        }
        guard let formalDecision = researchReportFormalDecisionDraft.request(
            direction: researchReportFormalDecisionIntent,
            systemDirection: systemDirection,
            secondRiskConfirmation: assessment.requiresOverride
        ) else { return }
        let finalText = formalDecision.reason
        let fingerprint = DecisionCheckSubmissionFingerprint(
            contextId: context.contextId,
            contextHash: context.contextHash,
            decisionSnapshotBinding: decisionSnapshotBinding,
            researchReportBinding: binding,
            formalDecision: formalDecision,
            actionIntent: researchReportFormalDecisionIntent.rawValue,
            humanCheckResult: humanCheckResult.rawValue,
            userFinalDecision: finalText
        )
        guard let pending = submissionState.begin(fingerprint: fingerprint) else { return }
        let authorizationRevision = viewModel.authorizationRevision
        researchReportFormalDecisionMessage = "正在写入报告绑定正式决定；不会创建订单或修改资产事实。"
        do {
            let response = try await client.createDecisionCheck(
                market: symbol.market,
                code: symbol.code,
                request: CreateDecisionCheckRequest(
                    decisionContextSchemaVersion: context.schemaVersion,
                    contextId: context.contextId,
                    contextHash: context.contextHash,
                    actionIntent: pending.fingerprint.actionIntent,
                    humanCheckResult: pending.fingerprint.humanCheckResult,
                    userFinalDecision: pending.fingerprint.userFinalDecision,
                    reviewedAt: nil,
                    decisionSnapshotBinding: pending.fingerprint.decisionSnapshotBinding,
                    researchReportBinding: binding,
                    formalDecision: pending.fingerprint.formalDecision,
                    idempotencyKey: pending.idempotencyKey
                )
            )
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  submissionState.isCurrent(pending),
                  researchReportFormalDecisionBinding == binding,
                  parsedSymbol?.canonical == binding.symbol,
                  response.data.researchReportDecision.availability == "preserved",
                  response.data.researchReportDecision.binding == binding,
                  (try? response.data.decisionSnapshot?.binding()) == decisionSnapshotBinding,
                  response.data.formalDecision.availability == "preserved",
                  response.data.formalDecision.ownerDecision == formalDecision else {
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                researchReportFormalDecisionBinding = nil
                clearSubmittedDecision()
                researchReportFormalDecisionMessage = "保存返回时研究状态已经变化；没有显示可能错绑的成功结果。"
                return
            }
            let history = try await client.fetchDecisionReviewHistory(market: symbol.market, code: symbol.code)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  submissionState.isCurrent(pending),
                  researchReportFormalDecisionBinding == binding,
                  let recorded = history.checks.first(where: {
                      recordedFormalDecisionMatches(
                        $0,
                        responseId: response.data.id,
                        reportBinding: binding,
                        snapshotBinding: decisionSnapshotBinding,
                        ownerDecision: formalDecision
                      )
                  }),
                  recorded.contextId == context.contextId,
                  recorded.contextHash == context.contextHash else {
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                researchReportFormalDecisionBinding = nil
                clearSubmittedDecision()
                researchReportFormalDecisionMessage = "保存后未能核对到同一份正式决定；已保留本次请求，可安全重试。"
                return
            }
            guard submissionState.finishSuccessOrReplay(for: pending) else { return }
            submittedDecision = response.data
            submittedDecisionSymbol = symbol.canonical
            decisionReviewHistory = history
            activeTodayDailyTrackingTarget = nil
            clearDailyTrackingReconsiderationDraft()
            pendingDecisionWorkspaceScrollTarget = nil
            researchReportFormalDecisionBinding = nil
            researchReportFormalDecisionMessage =
                "正式决定 #\(response.data.id) 已保存并核对，来源为报告 #\(binding.reportId)。"
            pendingFormalRiskConfirmation = nil
            todayRefreshRevision &+= 1
            scheduleResearchArchiveAutomaticBackup(.formalDecision(response.data.id), membership: membership)
            selectedTab = .today
        } catch {
            guard dailyClientAuthorizationIsCurrent(authorizationRevision) else {
                submissionState.discardForSourceDrift()
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                researchReportFormalDecisionBinding = nil
                clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
                clearSubmittedDecision()
                return
            }
            let definitive = {
                if case ResearchClientError.httpStatus(let status) = error {
                    return [400, 401, 404, 409].contains(status)
                }
                return false
            }()
            if definitive {
                submissionState.discardForSourceDrift()
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: true)
            }
            else { _ = submissionState.finishFailurePreservingRetry(for: pending) }
            researchReportFormalDecisionBinding = nil
            clearSubmittedDecision()
            researchReportFormalDecisionMessage = definitive
                ? "授权或报告绑定已确定失效；旧采用、请求身份与成功态已清除。"
                : "保存结果仍不明确；没有显示旧成功，同一请求可在重新采用后安全重试。"
        }
    }

    private func formalRiskWarningSummary(_ assessment: FormalPersonalRiskAssessment) -> String {
        let warningLabels = assessment.warnings.map { warning in
            switch warning.code {
            case .candidateWeightAboveLimit: "候选仓位超过限制"
            case .largestPositionWeightAboveLimit: "最大仓位超过限制"
            case .portfolioHhiAboveLimit: "组合集中度超过限制"
            case .unrealizedLossAboveBudget: "未实现亏损超过预算"
            }
        }
        let unavailable = assessment.unavailableMetrics.isEmpty ? [] : ["部分风险事实不可用"]
        return (warningLabels + unavailable).joined(separator: "；")
    }

    private func recordedFormalDecisionMatches(
        _ check: RecordedDecisionCheckReviewState,
        responseId: String,
        reportBinding: ResearchReportDecisionBinding,
        snapshotBinding: DecisionSnapshotBinding,
        ownerDecision: FormalOwnerDecisionInput
    ) -> Bool {
        guard check.id == responseId,
              check.researchReportDecision.availability == "preserved",
              check.researchReportDecision.binding == reportBinding,
              check.formalDecision.availability == "preserved",
              check.formalDecision.ownerDecision == ownerDecision,
              let recordedBinding = try? check.decisionSnapshot.binding() else { return false }
        return recordedBinding == snapshotBinding
    }
    @ViewBuilder
    func researchReportFormalDecisionAdoptionControl(
        report: TwoLayerReportData,
        decision: TwoLayerReportDecision,
        pack: FrozenResearchEvidencePack?
    ) -> some View {
        if let recorded = recordedFormalDecision(
            report: report,
            decision: decision,
            pack: pack
        ) {
            Label("正式决定 #\(recorded.id) 已记录", systemImage: "checkmark.seal.fill") .font(.caption.weight(.semibold)) .foregroundStyle(.green) .accessibilityIdentifier("recordedReportFormalDecision")
            Text(recorded.userFinalDecision ?? "未填写人工决定说明") .font(.caption)
            if let review = recorded.reviews.first {
                Text("复盘 #\(review.id) · \(reviewOutcomeLabel(review.outcome)) · 已完成") .font(.caption.weight(.semibold)) .accessibilityIdentifier("recordedReportFormalDecisionReview")
            } else {
                Text("下一步：完成这项正式决定的人工复盘。") .font(.caption) .foregroundStyle(.secondary)
            }
            Button(recorded.reviews.isEmpty ? "前往跟踪 / 复盘" : "查看跟踪 / 复盘") {
                selectedDecisionLayer = .review
                selectedReviewWorkspace = .timeline
                if let review = recorded.reviews.first {
                    pendingDecisionWorkspaceScrollTarget = decisionReviewSourceAnchor(review.id)
                } else if activeTodayDailyTrackingTarget?.decisionCheckId == recorded.id {
                    pendingDecisionWorkspaceScrollTarget = "dailyWorkbenchTop"
                } else {
                    selectDecisionReviewCheck(recorded)
                    pendingDecisionWorkspaceScrollTarget = decisionReviewFormAnchor(recorded.id)
                }
            } .buttonStyle(.borderedProminent) .accessibilityIdentifier("openReportTrackingReviewButton")
        } else if let membership = selectedMembership,
           let pack,
           researchReportFormalDecisionIsEligible(
            membership: membership,
            workspace: twoLayerReportWorkspace.envelope?.data,
            report: report,
            decision: decision,
            pack: pack
           ) {
            Button("明确采用为正式决定来源") {
                adoptTwoLayerReportForFormalDecision(report, decision: decision, pack: pack)
            } .buttonStyle(.borderedProminent) .disabled(twoLayerReportWorkspace.isBusy || submissionState.isInFlight) .id(twoLayerReportFormalDecisionControlAnchor(report.id)) .accessibilityIdentifier("adoptTwoLayerReportFormalDecisionButton")
        }
    }
    private func recordedFormalDecision(
        report: TwoLayerReportData,
        decision: TwoLayerReportDecision,
        pack: FrozenResearchEvidencePack?
    ) -> RecordedDecisionCheckReviewState? {
        guard let membership = selectedMembership,
              let pack,
              let history = decisionReviewHistory,
              history.requestedSymbol == membership.symbol,
              history.metadata.freshness == "fresh" else { return nil }
        let matches = history.checks.filter { check in
            guard check.researchReportDecision.availability == "preserved",
                  let binding = check.researchReportDecision.binding,
                  check.formalDecision.availability == "preserved" else { return false }
            return binding.membershipId == membership.id
                && binding.membershipVersion == membership.version
                && binding.symbol == membership.symbol
                && binding.evidencePackId == pack.id
                && binding.evidencePackFingerprint == pack.packFingerprint
                && binding.reportId == report.id
                && binding.reportVersion == report.version
                && binding.contractVersion == report.contractVersion
                && binding.reportFingerprint == report.reportFingerprint
                && binding.reportDecisionId == decision.id
                && binding.reportDecision == decision.decision
                && binding.reportDecisionActorType == decision.actorType
                && binding.reportDecisionActorId == decision.actorId
                && binding.decidedAt == decision.decidedAt
        }
        return latestPreservedFormalDecision(in: matches)
    }
    @ViewBuilder
    func researchReportFormalDecisionSubmissionControl(report: TwoLayerReportData) -> some View {
        if pendingResearchReportReconsiderationId == report.id,
           let message = researchReportFormalDecisionMessage {
            Text(message) .font(.caption) .foregroundStyle(.orange) .accessibilityIdentifier("researchReportReconsiderationMessage")
        }
        if dailyTrackingReconsiderationDraftIsCurrent(for: report) {
            Label("会话内复盘修正草稿已带入", systemImage: "square.and.pencil") .font(.caption.weight(.semibold)) .foregroundStyle(.orange) .accessibilityIdentifier("researchReportReconsiderationDraftTitle")
            Text(userFinalDecision) .font(.caption) .textSelection(.enabled) .accessibilityIdentifier("researchReportReconsiderationDraftText")
        }
        if researchReportFormalDecisionBinding?.reportId == report.id {
            DisclosureGroup("采用来源") {
                Text("证据包 #\(researchReportFormalDecisionBinding?.evidencePackId ?? "") · 报告 #\(report.id) · 报告确认 #\(researchReportFormalDecisionBinding?.reportDecisionId ?? "")")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .padding(.top, 4)
            }
            if let advice = report.payload.adviceLayer {
                let systemSummary = [
                    "方向：\(DecisionActionIntent(rawValue: advice.direction ?? "")?.label ?? "证据不足")",
                    "结论：\(advice.conclusion)",
                    "置信度：\(advice.confidence)",
                    "期限：\(advice.horizonStatement)",
                    "价格条件：\(advice.priceConditions?.joined(separator: "；") ?? "UNKNOWN")",
                    "价格区间：\(advice.priceRange ?? "UNKNOWN")",
                    "研究仓位：\(advice.researchPositionRange ?? "UNKNOWN")",
                    "前提：\(advice.assumptions?.joined(separator: "；") ?? "UNKNOWN")",
                    "情景：\(advice.scenarios?.joined(separator: "；") ?? "UNKNOWN")",
                    "主要风险：\((advice.longTerm.risks + advice.mediumShortTerm.risks).joined(separator: "；"))",
                    "失效条件：\((advice.longTerm.invalidationConditions + advice.mediumShortTerm.invalidationConditions).joined(separator: "；"))",
                    "下一问题：\(advice.nextQuestion ?? "UNKNOWN")",
                    "相对上一版：\(advice.versionChange ?? "UNKNOWN")",
                    "仅供研究，不执行交易。"
                ].joined(separator: "\n")
                InfoBlock(
                    title: "系统研究建议",
                    value: systemSummary,
                    valueIdentifier: "twoLayerReportFormalDecisionSystemRecommendation"
                )
            }
            DisclosureGroup("个人风险限制与二次确认") {
                Text("可留空；填写后会用当前组合与用户金额情景检查。触发限制或事实不可用时，必须填写覆盖理由并再次点击提交。")
                    .font(.caption)
                TextField("情景新增金额（HKD）", text: $portfolioAmountInput)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.decimalPad)
                    .accessibilityIdentifier("formalRiskScenarioAmount")
                HStack {
                    Button("读取当前组合") { Task { await loadPortfolioDecisionContext() } }
                        .disabled(isLoadingPortfolioContext || isLoadingPortfolioRisk)
                    Button("计算风险情景") { Task { await calculatePortfolioRiskImpact() } }
                        .disabled(!canCalculatePortfolioRisk)
                }
                TextField("候选仓位上限（%）", text: $researchReportFormalDecisionDraft.maxCandidateWeightPercent)
                    .textFieldStyle(.roundedBorder).keyboardType(.decimalPad)
                    .accessibilityIdentifier("formalRiskCandidateWeightLimit")
                TextField("最大单一仓位上限（%）", text: $researchReportFormalDecisionDraft.maxLargestPositionWeightPercent)
                    .textFieldStyle(.roundedBorder).keyboardType(.decimalPad)
                    .accessibilityIdentifier("formalRiskLargestWeightLimit")
                TextField("组合 HHI 上限（0–1）", text: $researchReportFormalDecisionDraft.maxPortfolioHhi)
                    .textFieldStyle(.roundedBorder).keyboardType(.decimalPad)
                    .accessibilityIdentifier("formalRiskHhiLimit")
                TextField("未实现亏损预算（HKD）", text: $researchReportFormalDecisionDraft.maxUnrealizedLossHkd)
                    .textFieldStyle(.roundedBorder).keyboardType(.decimalPad)
                    .accessibilityIdentifier("formalRiskLossBudget")
                if let limits = researchReportFormalDecisionDraft.personalRiskLimits {
                    let assessment = evaluateFormalPersonalRisk(
                        limits: limits,
                        portfolioContext: portfolioContext,
                        riskImpact: portfolioRiskImpact
                    )
                    if assessment.requiresOverride {
                        Text("强风险警告：\(formalRiskWarningSummary(assessment))")
                            .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                            .accessibilityIdentifier("formalRiskWarning")
                        TextField("覆盖理由（必填）", text: $researchReportFormalDecisionDraft.riskOverrideReason, axis: .vertical)
                            .textFieldStyle(.roundedBorder).lineLimit(2...5)
                            .accessibilityIdentifier("formalRiskOverrideReason")
                    } else if assessment.status == "available" {
                        Label("当前风险情景未触发所填限制", systemImage: "checkmark.shield")
                            .font(.caption).foregroundStyle(.green)
                    }
                } else {
                    Text("风险限制格式无效；百分比使用 0–100，HHI 使用 0–1。")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
            Picker("你的正式决定", selection: $researchReportFormalDecisionIntent) {
                ForEach(DecisionActionIntent.formalDecisionCases) { intent in
                    Text(intent.label).tag(intent)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("twoLayerReportFormalDecisionIntent")
            Picker("人工检查结果", selection: $humanCheckResult) {
                ForEach(HumanCheckResult.allCases) { result in
                    Text(result.label).tag(result)
                }
            } .pickerStyle(.menu) .accessibilityIdentifier("twoLayerReportHumanCheckResult")
            TextField("决定理由（必填）", text: $researchReportFormalDecisionDraft.reason, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...5)
                .accessibilityIdentifier("twoLayerReportFormalDecisionReason")
            TextField("适用期限（必填）", text: $researchReportFormalDecisionDraft.horizon, axis: .vertical)
                .textFieldStyle(.roundedBorder).accessibilityIdentifier("twoLayerReportFormalDecisionHorizon")
            TextField("价格条件（必填）", text: $researchReportFormalDecisionDraft.priceConditions, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...5)
                .accessibilityIdentifier("twoLayerReportFormalDecisionPriceConditions")
            TextField("研究仓位区间（必填，非真实持仓）", text: $researchReportFormalDecisionDraft.positionRange, axis: .vertical)
                .textFieldStyle(.roundedBorder).accessibilityIdentifier("twoLayerReportFormalDecisionPositionRange")
            TextField("主要风险（必填）", text: $researchReportFormalDecisionDraft.mainRisks, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...5)
                .accessibilityIdentifier("twoLayerReportFormalDecisionRisks")
            TextField("失效条件（必填）", text: $researchReportFormalDecisionDraft.invalidationConditions, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...5)
                .accessibilityIdentifier("twoLayerReportFormalDecisionInvalidation")
            DatePicker("复核日期", selection: $researchReportFormalDecisionDraft.reviewOn, displayedComponents: .date)
                .accessibilityIdentifier("twoLayerReportFormalDecisionReviewOn")
            if researchReportFormalDecisionIntent.rawValue != report.payload.adviceLayer?.direction {
                TextField("与系统建议不同的理由（必填）", text: $researchReportFormalDecisionDraft.divergenceReason, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(2...5)
                    .accessibilityIdentifier("twoLayerReportFormalDecisionDivergenceReason")
            }
            Text("提交前仍由你检查并填写；系统不会自动决定或创建交易。") .font(.caption)
            Button(pendingFormalRiskConfirmation == nil ? "提交报告绑定正式决定" : "再次确认并提交正式决定") { Task { await submitTwoLayerReportFormalDecision() } } .buttonStyle(.borderedProminent) .disabled(
                    submissionState.isInFlight
                        || decisionContext == nil
                        || researchReportFormalDecisionDraft.request(
                            direction: researchReportFormalDecisionIntent,
                            systemDirection: report.payload.adviceLayer?.direction ?? ""
                        ) == nil
                ) .accessibilityIdentifier("submitTwoLayerReportFormalDecisionButton")
        }
        if let message = researchReportFormalDecisionMessage {
            Text(message)
                .font(.caption)
                .accessibilityIdentifier("researchReportFormalDecisionMessage")
        }
    }
}
