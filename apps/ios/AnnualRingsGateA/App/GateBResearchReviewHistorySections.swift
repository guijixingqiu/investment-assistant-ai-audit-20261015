import SwiftUI

enum ReviewLearningInputField: Int, CaseIterable, Hashable {
    case reviewEvidence
    case reviewNote
    case judgmentCorrection
    case processLesson
    case nextResearchQuestion
    var next: ReviewLearningInputField? {
        Self(rawValue: rawValue + 1)
    }
}

struct DecisionReviewTimelineIdentity: Hashable {
    struct Check: Hashable {
        let id: String
        let reviewIds: [String]
    }
    let requestedSymbol: String
    let checks: [Check]
    let reviewFormCheckId: String?
}

struct DailyTrackingReconsiderationDraftBinding: Equatable {
    let target: TodayReviewNavigationTarget
    let reportId: String
    let reviewId: String
    let reviewOutcome: DecisionReviewOutcome
}

struct PriorJudgmentSourceSelection: Equatable {
    let membershipId: String
    let membershipVersion: Int
    let actorId: String
    let symbol: String
    let checkId: String
    let checkedAt: String
    let originalText: String

    init(membership: CandidateMembershipData, check: RecordedDecisionCheckReviewState) {
        membershipId = membership.id
        membershipVersion = membership.version
        actorId = membership.actorId
        symbol = membership.symbol
        checkId = check.id
        checkedAt = check.checkedAt
        originalText = check.userFinalDecision ?? ""
    }
}

extension GateBResearchScreen {
    @ViewBuilder
    func crossStockDecisionReviewHistorySection() -> some View {
        let otherMemberships = candidateMemberships.memberships.filter {
            $0.actorId == selectedMembership?.actorId
                && $0.symbol != selectedMembership?.symbol
                && $0.state != .archived
        }
        if !otherMemberships.isEmpty {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 10) {
                    Picker("对比股票", selection: Binding(
                        get: { comparedDecisionReviewMembershipId ?? "" },
                        set: { membershipId in
                            comparedDecisionReviewMembershipId = membershipId
                            comparedDecisionReviewRequestId = UUID()
                            comparedDecisionReviewHistory = nil
                            isLoadingComparedDecisionReviewHistory = false
                            comparedDecisionReviewMessage = "股票已变化，请明确读取对应决定与复盘历史。"
                        }
                    )) {
                        Text("请选择").tag("")
                        ForEach(otherMemberships) { membership in
                            Text("\(membership.symbol) · \(membership.research.name ?? "未命名")")
                                .tag(membership.id)
                        }
                    }
                    .accessibilityIdentifier("crossStockDecisionHistoryMembershipPicker")
                    Button(isLoadingComparedDecisionReviewHistory ? "正在读取" : "读取对比股票历史") {
                        Task { await loadComparedDecisionReviewHistory() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(
                        isLoadingComparedDecisionReviewHistory
                            || (comparedDecisionReviewMembershipId ?? "").isEmpty
                    )
                    .accessibilityIdentifier("loadCrossStockDecisionHistoryButton")
                    Text(comparedDecisionReviewMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("crossStockDecisionHistoryMessage")
                    if let history = comparedDecisionReviewHistory,
                       let membership = otherMemberships.first(where: {
                           $0.id == comparedDecisionReviewMembershipId
                       }) {
                        let hasDecisionHistory = !history.checks.isEmpty
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(membership.symbol) · membership #\(membership.id) v\(membership.version)")
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .accessibilityIdentifier("crossStockDecisionHistoryIdentity")
                            Text("\(history.checks.count) 次正式检查 · \(history.checks.reduce(0) { $0 + $1.reviews.count }) 条复盘")
                                .font(.callout.weight(.semibold))
                            Button {
                                if hasDecisionHistory {
                                    selectedReviewWorkspace = .timeline
                                } else {
                                    selectedEvidenceWorkspace = .brief
                                }
                                selectMembershipForAction(
                                    membership,
                                    layer: hasDecisionHistory ? .review : .evidence,
                                    expandResult: true
                                )
                            } label: {
                                Label(
                                    hasDecisionHistory
                                        ? "切换到该股票继续跟踪 / 复盘"
                                        : "切换到该股票查看报告 / 正式决定",
                                    systemImage: "arrow.right.circle"
                                )
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("openCrossStockDecisionHistory-\(membership.symbol)")
                            ForEach(history.checks) { check in
                                DisclosureGroup {
                                    VStack(alignment: .leading, spacing: 8) {
                                        formalDecisionContinuityLabel(check, checks: history.checks)
                                        if let binding = check.researchReportDecision.binding {
                                            Text("report #\(binding.reportId) v\(binding.reportVersion) · pack #\(binding.evidencePackId) · \(binding.reportFingerprint)")
                                                .font(.caption2.monospaced())
                                                .textSelection(.enabled)
                                                .accessibilityIdentifier("crossStockDecisionHistoryReport-\(check.id)")
                                        }
                                        formalDecisionReviewSection(
                                            check.formalDecision,
                                            actionIntent: check.actionIntent
                                        )
                                        if check.reviews.isEmpty {
                                            Text("尚无复盘；当前正式决定仍待 Owner 跟踪。")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        } else {
                                            ForEach(check.reviews) { review in
                                                postDecisionPortfolioReviewSections(
                                                    review,
                                                    decisionCheckId: check.id,
                                                    reportBinding: check.researchReportDecision.binding,
                                                    decisionSnapshot: check.decisionSnapshot
                                                )
                                            }
                                        }
                                    }
                                    .padding(.top, 6)
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("check #\(check.id) · \(decisionActionIntentLabel(check.actionIntent)) · \(compactUtcDateTime(check.checkedAt))")
                                            .font(.caption.weight(.semibold))
                                        Text(check.reviews.isEmpty
                                            ? "待跟踪 / 复盘"
                                            : "最近复盘：\(reviewOutcomeLabel(check.reviews[0].outcome)) · \(compactUtcDateTime(check.reviews[0].reviewedAt))")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .accessibilityIdentifier("crossStockDecisionHistoryCheck-\(check.id)")
                            }
                            Text("只读聚合；每只股票保持独立 membership、决定与复盘身份，不产生写入。")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                                .accessibilityIdentifier("crossStockDecisionHistorySafety")
                        }
                    }
                }
                .padding(.top, 6)
            } label: {
                Text("跨股票决定与复盘历史")
                    .accessibilityIdentifier("crossStockDecisionHistory")
            }
        }
    }

    @MainActor
    func clearComparedDecisionReviewHistory(_ message: String) {
        comparedDecisionReviewMembershipId = nil
        comparedDecisionReviewHistory = nil
        comparedDecisionReviewRequestId = UUID()
        isLoadingComparedDecisionReviewHistory = false
        comparedDecisionReviewMessage = message
    }

    @ViewBuilder
    func todayDailyTrackingContextSection() -> some View {
        if let target = activeTodayDailyTrackingTarget,
           let binding = target.reportBinding,
           resolveTodayDailyTrackingTarget(target),
           let data = twoLayerReportWorkspace.envelope?.data,
           let report = data.latestReport,
           let decision = data.userDecision,
           let pack = data.latestPack,
           let check = decisionReviewHistory?.checks.first(where: { $0.id == target.decisionCheckId }),
           let technical = pack.frozenResearchContext?.technical {
            VStack(alignment: .leading, spacing: 10) {
                Label("每日跟踪 · 下一验证", systemImage: "calendar.badge.clock")
                    .font(.headline)
                    .accessibilityIdentifier("researchDailyTrackingTitle")
                InfoBlock(
                    title: "正式决定",
                    value: "check #\(target.decisionCheckId) · report decision #\(decision.id) · \(decision.decision)",
                    valueIdentifier: "researchDailyTrackingFormalDecision"
                )
                formalDecisionReviewSection(check.formalDecision, actionIntent: check.actionIntent)
                InfoBlock(
                    title: "绑定报告",
                    value: "report #\(report.id) v\(report.version) · \(report.reportFingerprint)",
                    valueIdentifier: "researchDailyTrackingReportIdentity"
                )
                InfoBlock(
                    title: "冻结证据包",
                    value: "pack #\(pack.id) v\(pack.version) · \(pack.packFingerprint)",
                    valueIdentifier: "researchDailyTrackingPackIdentity"
                )
                InfoBlock(
                    title: "下一验证问题",
                    value: report.payload.nextValidationQuestions.first ?? "UNKNOWN",
                    valueIdentifier: "researchDailyTrackingNextValidation"
                )
                InfoBlock(
                    title: "失效条件",
                    value: report.payload.invalidationConditions.joined(separator: "；"),
                    valueIdentifier: "researchDailyTrackingInvalidations"
                )
                InfoBlock(
                    title: "冻结技术身份",
                    value: "snapshot=\(technical.dailyBars.snapshot?.snapshotSha ?? "UNKNOWN") · result=\(technical.technical.resultHash ?? "UNKNOWN") · cutoff=\(technical.dailyBars.source.dataCutoffAt ?? "UNKNOWN")",
                    valueIdentifier: "researchDailyTrackingTechnicalIdentity"
                )
                VStack(alignment: .leading, spacing: 5) {
                    Text("材料来源 · fresh exact match")
                        .font(.caption.weight(.semibold))
                    ForEach(pack.items) { material in
                        Text("#\(material.id) r\(material.revision) · \(material.title) · \(material.contentFingerprint)")
                            .font(.caption2.monospaced())
                            .accessibilityIdentifier("researchDailyTrackingMaterial-\(material.id)")
                    }
                }
                Text("membership #\(binding.membershipId) v\(binding.membershipVersion) · 仅展示并进入追加式复盘；不自动写复盘、不改正式决定、不创建订单或交易，也不修改现金、费用、持仓或券商事实。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("researchDailyTrackingSafetyBoundary")
                dailyTrackingReviewResolutionSection(target: target, report: report)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("researchDailyTrackingContext")
        }
    }

    func decisionReviewHistorySection(_ history: DecisionReviewHistoryEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.pink)
                    .frame(width: 34, height: 34)
                    .background(Color.pink.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("决策复盘").font(.headline)
                    Text("冻结判断、后来事实与人工修正").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(history.checks.count) 次检查").font(.caption.weight(.semibold))
                    Text("\(history.checks.reduce(0) { $0 + $1.reviews.count }) 条复盘")
                        .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
            }

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "lock.shield").foregroundStyle(.green).frame(width: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text("只读、追加式记录；不改写原判断")
                        .font(.callout.weight(.semibold))
                        .accessibilityIdentifier("decisionReviewLimitation")
                        .accessibilityValue(history.message)
                    Text("订单、交易、现金、费用、持仓和券商调用均关闭")
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("decisionReviewSafety")
                        .accessibilityValue(safetyEvidenceText(history.safety))
                }
            }

            if history.checks.isEmpty {
                ContentUnavailableView(
                    "尚无复盘记录",
                    systemImage: "clock.badge.questionmark",
                    description: Text("已记录的人工检查会按时间出现在这里。")
                )
                .accessibilityIdentifier("decisionReviewEmpty")
            }

            if priorJudgmentPendingRequest == nil,
               priorJudgmentMessageSymbol == history.requestedSymbol,
               let priorJudgmentMessage {
                Text(priorJudgmentMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("priorJudgmentMaterialMessage")
            }
            ForEach(history.checks) { check in
                decisionReviewCheckCard(check, checks: history.checks)
                    .id(decisionReviewCheckAnchor(check.id))
            }

            if let deletions = history.deletions, !deletions.isEmpty {
                DisclosureGroup("已删除决定/复盘凭证（\(deletions.count)）") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(deletions) { deletion in
                            Text("\(deletion.kind == "decision_check" ? "正式决定" : "复盘") · check #\(deletion.decisionCheckId)\(deletion.reviewId.map { " · review #\($0)" } ?? "") · 删除于 \(deletion.deletedAt)")
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                        }
                        Text("正文已从当前 History、Today 和 AI 上下文移除；旧备份仍可能含已删除内容。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 6)
                }
                .accessibilityIdentifier("decisionReviewDeletionHistory")
            }

            if let lastReviewMessage {
                Text(lastReviewMessage)
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("decisionReviewSubmitMessage")
            }
        }
    }

    private func decisionReviewCheckCard(
        _ check: RecordedDecisionCheckReviewState,
        checks: [RecordedDecisionCheckReviewState]
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.seal.fill").font(.title3).foregroundStyle(.pink)
                VStack(alignment: .leading, spacing: 3) {
                    Text(compactUtcDateTime(check.checkedAt))
                        .font(.callout.weight(.semibold))
                        .accessibilityIdentifier("reviewDecisionCheckedAt")
                        .accessibilityValue(check.checkedAt)
                    Text(check.id).font(.caption2.monospaced()).foregroundStyle(.secondary)
                        .lineLimit(2).accessibilityIdentifier("reviewDecisionCheckId")
                }
                Spacer(minLength: 8)
                Text("\(decisionActionIntentLabel(check.actionIntent)) · \(humanCheckResultLabel(check.humanCheckResult))")
                    .font(.caption.weight(.semibold)).foregroundStyle(.pink)
                    .multilineTextAlignment(.trailing)
                    .accessibilityIdentifier("reviewDecisionOriginalResult")
                    .accessibilityValue("\(check.actionIntent):\(check.humanCheckResult)")
            }

            formalDecisionContinuityLabel(check, checks: checks)

            if let reviewDueOn = check.reviewDueOn {
                Text("下次复盘：\(reviewDueOn)（香港时间）")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("reviewDecisionReviewDueOn")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("原最终决定").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(check.userFinalDecision ?? "未填写")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("reviewDecisionOriginalFinalDecision")
            }

            priorJudgmentMaterialEditor(check)

            formalDecisionReviewSection(check.formalDecision, actionIntent: check.actionIntent)

            Divider()
            decisionReviewFrozenIdentity(check)
            decisionReviewSelectedSources(check)
            decisionReviewFrozenResearchEvidence(check)
            conditionalDecisionStateSection(check.conditionalDecision)

            if check.reviews.isEmpty {
                Label("暂无复盘记录", systemImage: "text.badge.plus")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("decisionReviewNoReviews")
            } else {
                ForEach(check.reviews) { review in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.caption.weight(.semibold)).foregroundStyle(.pink).frame(width: 18)
                            postDecisionPortfolioReviewSections(
                                review,
                                decisionCheckId: check.id,
                                reportBinding: check.researchReportDecision.binding,
                                decisionSnapshot: check.decisionSnapshot
                            )
                        }
                        Button(role: .destructive) {
                            Task { await deletePostDecisionReview(review) }
                        } label: {
                            Label(
                                pendingDecisionReviewDeletionId == "review:\(review.id)"
                                    ? "再次点击确认删除这条复盘内容"
                                    : "删除这条复盘内容",
                                systemImage: "trash"
                            )
                        }
                        .buttonStyle(.bordered)
                        .disabled(decisionReviewDeletionInFlightId != nil || reviewSubmissionState.isInFlight)
                        .accessibilityIdentifier("deleteDecisionReview-\(review.id)")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(decisionReviewSourceAnchor(review.id))
                    .accessibilityIdentifier("decisionReviewSource-\(review.id)")
                }
            }

            Divider()
            if isActiveDailyTrackingReviewCheck(check) {
                Text("请使用上方“记录本次每日跟踪复盘”专用控件提交。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("dailyTrackingUsesDedicatedReviewForm")
            } else if currentReviewableCheck?.id == check.id {
                reviewForm(check: check)
            } else {
                Button {
                    selectDecisionReviewCheck(check)
                } label: {
                    Label("选择此检查并追加复盘", systemImage: "square.and.pencil")
                }
                .buttonStyle(.bordered)
                .disabled(isLoading || isLoadingDecisionReviewHistory || reviewSubmissionState.isInFlight)
                .accessibilityIdentifier("selectDecisionReviewCheck-\(check.id)")
            }

            Button(role: .destructive) {
                Task { await deleteDecisionCheck(check) }
            } label: {
                Label(
                    pendingDecisionReviewDeletionId == "check:\(check.id)"
                        ? "再次点击确认删除正式决定内容"
                        : "删除正式决定内容",
                    systemImage: "trash"
                )
            }
            .buttonStyle(.bordered)
            .disabled(decisionReviewDeletionInFlightId != nil || reviewSubmissionState.isInFlight)
            .accessibilityIdentifier("deleteDecisionCheck-\(check.id)")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay { RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08), lineWidth: 1) }
    }

    private var priorJudgmentHistoryIsFresh: Bool {
        guard let history = decisionReviewHistory,
              let membership = selectedMembership else { return false }
        return history.requestedSymbol == membership.symbol
            && history.metadata.freshness == "fresh"
            && !history.metadata.stale
            && !history.metadata.missing
            && !history.metadata.conflict
            && !isLoadingDecisionReviewHistory
    }

    private func revokePriorJudgmentSendConfirmation() {
        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: currentFrozenResearchBindingIdentity)
        if var intent = twoLayerReportWorkspace.draft?.taskIntent {
            intent.confirmProviderAuthorization(false)
            twoLayerReportWorkspace.draft?.taskIntent = intent
        }
    }

    @ViewBuilder
    func priorJudgmentPendingRecoverySection() -> some View {
        if let pending = priorJudgmentPendingRequest,
           let source = priorJudgmentSource {
            let sameIdentity = selectedMembership?.id == source.membershipId
                && selectedMembership?.version == source.membershipVersion
                && selectedMembership?.actorId == source.actorId
                && selectedMembership?.symbol == source.symbol
                && selectedMembership?.state == .tracked
                && parsedSymbol?.canonical == source.symbol
                && priorJudgmentPendingAuthorizationRevision == viewModel.authorizationRevision
                && pending.membershipId == source.membershipId
                && pending.membershipVersion == source.membershipVersion
                && pending.priorDecisionBinding?.decisionCheckId == source.checkId
                && pending.priorDecisionBinding?.checkedAt == source.checkedAt
            VStack(alignment: .leading, spacing: 8) {
                Text(sameIdentity
                    ? "历史判断材料保存待核清 · \(source.symbol) · 检查 #\(source.checkId)"
                    : "历史判断材料保存待核清")
                    .font(.callout.weight(.semibold))
                Text("这份材料可能已写入。原判断即使后来删除，也可在原股票和授权身份下用同一请求核对材料；不会新建保存请求。")
                    .font(.caption).foregroundStyle(.secondary)
                if sameIdentity {
                    Text(pending.priorDecisionBinding?.excerpt ?? "")
                        .font(.caption).textSelection(.enabled)
                    Button("用同一请求核对材料保存结果") {
                        Task { await savePriorJudgmentMaterial(source: source) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(priorJudgmentSaving)
                    .accessibilityIdentifier("retryPriorJudgmentMaterial")
                } else {
                    Text("当前股票、成员或授权身份与待核清请求不同；请返回原身份后重试。")
                        .font(.caption).foregroundStyle(.orange)
                }
                if priorJudgmentMessageSymbol == source.symbol,
                   let priorJudgmentMessage {
                    Text(priorJudgmentMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityIdentifier("priorJudgmentPendingRecovery")
        }
    }

    @ViewBuilder
    private func priorJudgmentMaterialEditor(_ check: RecordedDecisionCheckReviewState) -> some View {
        if check.isOrdinaryPriorJudgmentSource,
           let membership = selectedMembership,
           membership.state == .tracked,
           check.symbol == membership.symbol {
            let source = PriorJudgmentSourceSelection(membership: membership, check: check)
            if priorJudgmentSource == source {
                VStack(alignment: .leading, spacing: 10) {
                    Text("选一段历史判断作为研究材料")
                        .font(.callout.weight(.semibold))
                    Text("请从上方原文复制一段连续、非敏感的文字，最多 1000 字。这里只保存你粘贴的片段，不复制整条判断或账户资料。")
                        .font(.caption).foregroundStyle(.secondary)
                    TextField("粘贴原文中的连续片段", text: Binding(
                        get: { priorJudgmentExcerpt },
                        set: { value in
                            guard value != priorJudgmentExcerpt else { return }
                            priorJudgmentExcerpt = value
                            priorJudgmentConfirmedNonSensitive = false
                            revokePriorJudgmentSendConfirmation()
                        }
                    ), axis: .vertical)
                    .lineLimit(3...8)
                    .disabled(priorJudgmentSaving || priorJudgmentPendingRequest != nil)
                    .accessibilityIdentifier("priorJudgmentExcerpt-\(check.id)")
                    Text("\(priorJudgmentExcerpt.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)/1000 字")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    DatePicker("下次核实有效性", selection: Binding(
                        get: { priorJudgmentValidUntil },
                        set: { value in
                            guard !Calendar.current.isDate(value, inSameDayAs: priorJudgmentValidUntil) else { return }
                            priorJudgmentValidUntil = value
                            priorJudgmentConfirmedNonSensitive = false
                            revokePriorJudgmentSendConfirmation()
                        }
                    ), in: Date()..., displayedComponents: .date)
                    .disabled(priorJudgmentSaving || priorJudgmentPendingRequest != nil)
                    Toggle("我确认选段不含账户、持仓、交易、凭据或其他敏感资料", isOn: Binding(
                        get: { priorJudgmentConfirmedNonSensitive },
                        set: { value in
                            priorJudgmentConfirmedNonSensitive = value
                            revokePriorJudgmentSendConfirmation()
                        }
                    ))
                    .disabled(priorJudgmentSaving || priorJudgmentPendingRequest != nil)
                    .accessibilityIdentifier("priorJudgmentNonSensitiveConfirmation-\(check.id)")
                    Text("保存后仅成为待核实的历史背景；还须在研究资料中明确选择、重新冻结，发送研究服务前再次确认授权。")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        if priorJudgmentPendingRequest == nil {
                            Button("保存所选历史片段") {
                                Task { await savePriorJudgmentMaterial(source: source) }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(priorJudgmentSaving || !priorJudgmentHistoryIsFresh
                                || check.priorJudgmentMaterialRequest(
                                    membership: membership,
                                    excerpt: priorJudgmentExcerpt,
                                    ownerConfirmedNonSensitive: priorJudgmentConfirmedNonSensitive,
                                    validUntil: priorJudgmentValidUntil,
                                    idempotencyKey: "preview"
                                ) == nil)
                            .accessibilityIdentifier("savePriorJudgmentMaterial-\(check.id)")
                            Button("取消选段") {
                                priorJudgmentSource = nil
                                priorJudgmentExcerpt = ""
                                priorJudgmentConfirmedNonSensitive = false
                            }
                            .disabled(priorJudgmentSaving)
                        } else {
                            Text("保存请求待核清；请使用时间线上方的同一请求按钮。")
                                .font(.caption).foregroundStyle(.orange)
                        }
                    }
                    if !priorJudgmentHistoryIsFresh {
                        Text("决定历史正在刷新、已过期或不可用；请读取当前记录后再保存。")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
                .padding(12)
                .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("priorJudgmentMaterialEditor-\(check.id)")
            } else {
                Button("选取此普通判断的非敏感片段作为研究资料") {
                    priorJudgmentSource = source
                    priorJudgmentExcerpt = ""
                    priorJudgmentConfirmedNonSensitive = false
                    priorJudgmentValidUntil = Date().addingTimeInterval(90 * 24 * 60 * 60)
                    priorJudgmentMessage = nil
                    revokePriorJudgmentSendConfirmation()
                }
                .buttonStyle(.bordered)
                .disabled(!priorJudgmentHistoryIsFresh || priorJudgmentSaving
                    || priorJudgmentPendingRequest != nil)
                .accessibilityIdentifier("selectPriorJudgmentSource-\(check.id)")
            }
        }
    }

    @MainActor
    private func savePriorJudgmentMaterial(source: PriorJudgmentSourceSelection) async {
        guard !priorJudgmentSaving,
              priorJudgmentSource == source,
              let membership = selectedMembership,
              membership.id == source.membershipId,
              membership.version == source.membershipVersion,
              membership.actorId == source.actorId,
              membership.symbol == source.symbol,
              membership.state == .tracked,
              parsedSymbol?.canonical == source.symbol else { return }
        let authorizationRevision = viewModel.authorizationRevision
        if priorJudgmentPendingRequest != nil,
           priorJudgmentPendingAuthorizationRevision != authorizationRevision { return }
        let revision = UUID()
        priorJudgmentSaveRevision = revision
        priorJudgmentSaving = true
        priorJudgmentMessageSymbol = source.symbol
        priorJudgmentMessage = priorJudgmentPendingRequest == nil
            ? "正在重新核对原判断并保存所选片段…"
            : "正在用原请求核对材料保存结果…"
        defer {
            if priorJudgmentSaveRevision == revision { priorJudgmentSaving = false }
        }
        do {
            let request: CreateResearchMaterialRequest
            if let pending = priorJudgmentPendingRequest {
                guard pending.priorDecisionBinding?.decisionCheckId == source.checkId,
                      pending.priorDecisionBinding?.checkedAt == source.checkedAt,
                      pending.membershipId == membership.id,
                      pending.membershipVersion == membership.version else { return }
                request = pending
            } else {
                guard priorJudgmentHistoryIsFresh,
                      let check = decisionReviewHistory?.checks.first(where: {
                          $0.id == source.checkId && $0.checkedAt == source.checkedAt
                              && $0.userFinalDecision == source.originalText
                              && $0.isOrdinaryPriorJudgmentSource
                      }) else { return }
                let currentHistory = try await client.fetchDecisionReviewHistory(
                    market: membership.market, code: membership.code
                )
                guard priorJudgmentSaveRevision == revision,
                      dailyClientAuthorizationIsCurrent(authorizationRevision),
                      priorJudgmentSource == source,
                      selectedMembership == membership,
                      parsedSymbol?.canonical == source.symbol else { return }
                guard currentHistory.requestedSymbol == source.symbol,
                      currentHistory.metadata.freshness == "fresh",
                      !currentHistory.metadata.stale,
                      !currentHistory.metadata.missing,
                      !currentHistory.metadata.conflict,
                      currentHistory.checks.contains(where: {
                          $0.id == check.id && $0.checkedAt == check.checkedAt
                              && $0.userFinalDecision == source.originalText
                              && $0.isOrdinaryPriorJudgmentSource
                      }) else {
                    priorJudgmentMessage = "原判断已删除、变化或不可用；没有确认保存。请重新读取决定时间线。"
                    return
                }
                guard let draft = check.priorJudgmentMaterialRequest(
                    membership: membership,
                    excerpt: priorJudgmentExcerpt,
                    ownerConfirmedNonSensitive: priorJudgmentConfirmedNonSensitive,
                    validUntil: priorJudgmentValidUntil,
                    idempotencyKey: "ios-prior-judgment-\(UUID().uuidString.lowercased())"
                ) else {
                    priorJudgmentMessage = "选段须来自原文且不超过 1000 字；请确认非敏感资料和有效期。"
                    return
                }
                request = draft
                priorJudgmentPendingRequest = draft
                priorJudgmentPendingAuthorizationRevision = authorizationRevision
            }
            let result = try await client.createPriorJudgmentMaterialAndReadBack(
                membership: membership, requestBody: request
            )
            guard priorJudgmentSaveRevision == revision,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  priorJudgmentSource == source,
                  selectedMembership == membership,
                  parsedSymbol?.canonical == source.symbol else { return }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.setOwnerConfirmation(
                false, for: currentFrozenResearchBindingIdentity
            )
            invalidateTwoLayerReport("已新增历史人工判断材料；旧证据包和报告需重新核对。")
            priorJudgmentPendingRequest = nil
            priorJudgmentPendingAuthorizationRevision = nil
            priorJudgmentSource = nil
            priorJudgmentExcerpt = ""
            priorJudgmentConfirmedNonSensitive = false
            priorJudgmentMessage = "历史片段已保存为独立待核实材料 #\(result.material.id) 并读回；它是历史背景，不代表当前判断。请到研究资料明确选入、重新冻结；研究服务未发送。"
            frozenResearchEvidenceWorkspace.message = priorJudgmentMessage ?? ""
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .frozen
            pendingDecisionWorkspaceScrollTarget = "freezeResearchEvidenceButton"
            await loadResearchDocuments()
        } catch {
            guard priorJudgmentSaveRevision == revision,
                  priorJudgmentSource == source,
                  selectedMembership == membership,
                  parsedSymbol?.canonical == source.symbol else { return }
            priorJudgmentMessage = "保存或读回结果未确认；同一请求与片段已保留。请重新核对，不会自动重写原判断。"
        }
    }

    @ViewBuilder
    private func formalDecisionContinuityLabel(
        _ check: RecordedDecisionCheckReviewState,
        checks: [RecordedDecisionCheckReviewState]
    ) -> some View {
        switch formalDecisionContinuityStatus(for: check, among: checks) {
        case .currentPendingReview:
            Label("当前正式决定 · 待复盘", systemImage: "clock.badge.exclamationmark")
                .foregroundStyle(.orange)
        case .currentReviewDue:
            Label("当前正式决定 · 复核日期已到", systemImage: "calendar.badge.exclamationmark")
                .foregroundStyle(.orange)
        case .currentReviewed(let outcome):
            Label("当前正式决定 · 已复盘 · \(reviewOutcomeLabel(outcome))", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .currentRequiresNewDecision(let outcome):
            Label("当前正式决定已\(outcome == .thesisInvalidated ? "失效" : "弱化") · 等待 Owner 新决定", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        case .superseded(let latestCheckId):
            Label("已被正式决定 #\(latestCheckId) 替代", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(.secondary)
        case nil:
            EmptyView()
        }
    }

    @ViewBuilder
    private func formalDecisionReviewSection(
        _ state: FormalDecisionState,
        actionIntent: String
    ) -> some View {
        if state.availability == "preserved",
           let system = state.systemRecommendation,
           let owner = state.ownerDecision {
            VStack(alignment: .leading, spacing: 6) {
                let systemSummary = [
                    "方向：\(DecisionActionIntent(rawValue: system.direction)?.label ?? system.direction)",
                    "结论：\(system.conclusion)",
                    "置信度：\(system.confidence)",
                    "期限：\(system.horizon)",
                    "价格条件：\(system.priceConditions.joined(separator: "；"))",
                    "价格区间：\(system.priceRange)",
                    "研究仓位：\(system.researchPositionRange)",
                    "前提：\(system.assumptions.joined(separator: "；"))",
                    "情景：\(system.scenarios.joined(separator: "；"))",
                    "主要风险：\(system.risks.joined(separator: "；"))",
                    "失效条件：\(system.invalidationConditions.joined(separator: "；"))",
                    "下一问题：\(system.nextQuestion)",
                    "相对上一版：\(system.versionChange)",
                    "仅供研究，不执行交易。"
                ].joined(separator: "\n")
                InfoBlock(
                    title: "系统研究建议",
                    value: systemSummary,
                    valueIdentifier: "reviewFormalDecisionSystemRecommendation"
                )
                InfoBlock(
                    title: "Owner 正式决定",
                    value: "\(decisionActionIntentLabel(actionIntent)) · \(owner.reason)\n期限：\(owner.horizon) · 复核：\(owner.reviewOn)\n价格条件：\(owner.priceConditions)\n研究仓位：\(owner.positionRange)\n主要风险：\(owner.mainRisks)\n失效条件：\(owner.invalidationConditions)",
                    valueIdentifier: "reviewFormalDecisionOwnerDecision"
                )
                if state.differsFromSystem == true {
                    Text("与系统建议不同：\(owner.divergenceReason ?? "未记录理由")")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("reviewFormalDecisionDivergence")
                }
                if let assessment = state.personalRiskAssessment,
                   let personalRisk = owner.personalRisk {
                    let warningText = assessment.warnings.map {
                        "\($0.code.rawValue)：actual=\($0.actual)，limit=\($0.limit)"
                    }.joined(separator: "；")
                    let unavailableText = assessment.unavailableMetrics.map(\.rawValue).joined(separator: "；")
                    InfoBlock(
                        title: assessment.requiresOverride ? "个人风险覆盖（已二次确认）" : "个人风险检查",
                        value: "status=\(assessment.status)\n警告：\(warningText.isEmpty ? "无" : warningText)\n不可用：\(unavailableText.isEmpty ? "无" : unavailableText)\n覆盖理由：\(personalRisk.overrideReason ?? "无")",
                        valueIdentifier: "reviewFormalDecisionPersonalRisk"
                    )
                }
            }
        } else {
            Text("历史决定未分别保存系统建议与 Owner 决定；保持 UNKNOWN。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("reviewFormalDecisionNotCaptured")
        }
    }

    private func isActiveDailyTrackingReviewCheck(_ check: RecordedDecisionCheckReviewState) -> Bool {
        guard let target = activeTodayDailyTrackingTarget else { return false }
        return target.reviewId == nil
            && target.decisionCheckId == check.id
            && target.reportBinding == check.researchReportDecision.binding
    }

    private func decisionReviewFrozenIdentity(_ check: RecordedDecisionCheckReviewState) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("冻结身份").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text("\(check.contextId)\n\(check.contextHash)")
                .font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(3)
                .accessibilityIdentifier("reviewDecisionContextIdentity")
            HStack(spacing: 12) {
                Label(check.contextSnapshot.availability.rawValue, systemImage: "doc.badge.clock")
                    .accessibilityIdentifier("reviewDecisionSnapshotAvailability")
                    .accessibilityValue(snapshotAvailabilityText(check.contextSnapshot))
                Label(check.decisionSnapshot.availability.rawValue, systemImage: "lock.doc")
                    .accessibilityIdentifier("reviewDecisionFullSnapshotAvailability")
                    .accessibilityValue(decisionSnapshotAvailabilityText(check.decisionSnapshot))
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func decisionReviewSelectedSources(_ check: RecordedDecisionCheckReviewState) -> some View {
        if let sources = check.manualSourceBindings, !sources.isEmpty {
            DisclosureGroup("本次判断明确选用的来源（\(sources.count)）") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(sources) { source in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(source.title).font(.callout.weight(.semibold))
                            Text("\(source.bindingKind == "saved_material" ? "材料 #\(source.materialId ?? "UNKNOWN")" : "证据 #\(source.evidenceId ?? "UNKNOWN")") · \(source.sourceType)\(source.pageNumber.map { " · 第\($0)页" } ?? "")")
                                .font(.caption).foregroundStyle(.secondary)
                            Text("当时内容 SHA-256：\(source.contentSha256)")
                                .font(.caption2.monospaced()).textSelection(.enabled)
                            if let documentId = source.documentId, let pdfSha = source.documentPdfSha256 {
                                Text("已存 PDF #\(documentId) · 原文件 SHA-256 \(pdfSha)")
                                    .font(.caption2.monospaced()).textSelection(.enabled)
                            }
                            if let materialId = source.materialId {
                                Text("已保存材料 #\(materialId) r\(source.materialRevision ?? 0) · \(source.materialFingerprint ?? "指纹未记录")")
                                    .font(.caption2.monospaced()).textSelection(.enabled)
                            }
                            if source.snapshotId != nil {
                                Button("核验并重开已存原文") {
                                    Task { await reopenManualDecisionSnapshot(source, check: check) }
                                }
                                .disabled(selectedMembership?.symbol != check.symbol)
                                .accessibilityIdentifier("reviewSelectedSnapshot-\(check.id)-\(source.id)")
                            } else if ["official_pdf", "owner_provided_pdf", "issuer_public_pdf"].contains(source.sourceType),
                                      source.documentId != nil, source.documentPdfSha256 != nil {
                                Button("核验并重开已存 PDF 第\(source.pageNumber ?? 0)页") {
                                    Task { await reopenManualDecisionPDF(source, check: check) }
                                }
                                .disabled(selectedMembership?.symbol != check.symbol)
                                .accessibilityIdentifier("reviewSelectedPDF-\(check.id)-\(source.id)")
                            } else if source.sourceType == "futu_opend_financial_statement_provider",
                                      source.materialId != nil {
                                Button("核验并重开已存 OpenD 原始页") {
                                    Task { await reopenManualDecisionProvider(source, check: check) }
                                }
                                .disabled(selectedMembership?.symbol != check.symbol)
                                .accessibilityIdentifier("reviewSelectedProvider-\(check.id)-\(source.id)")
                            } else if let url = manualSourceReopenURL(source) {
                                Link("打开当时记录的来源网址", destination: url)
                                    .accessibilityIdentifier("reviewSelectedSourceURL-\(check.id)-\(source.id)")
                                Text("这条旧记录没有已存原件身份；外部网页可能变化，不能证明是当时原件。")
                                    .font(.caption).foregroundStyle(.secondary)
                            } else {
                                Text("这条来源没有可直接重开的原件链接；保留当时身份供核对。")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    if researchSourceSnapshotWorkspace.message.hasPrefix("当时原件") {
                        Text(researchSourceSnapshotWorkspace.message)
                            .font(.caption).foregroundStyle(.orange)
                    }
                    if researchDocumentWorkspace.message.hasPrefix("当时原件") {
                        Text(researchDocumentWorkspace.message)
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
                .padding(.top, 6)
            }
            .accessibilityIdentifier("reviewSelectedSources-\(check.id)")
            .sheet(item: Binding(
                get: { researchDocumentWorkspace.savedOriginal },
                set: { researchDocumentWorkspace.savedOriginal = $0 }
            )) { original in
                NavigationStack {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(original.verification).font(.caption).foregroundStyle(.secondary)
                        ScrollView {
                            Text(original.body).font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding()
                    .navigationTitle(original.title)
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
    }

    @MainActor
    private func reopenManualDecisionSnapshot(_ source: ManualDecisionSourceBinding,
                                              check: RecordedDecisionCheckReviewState) async {
        guard let snapshotId = source.snapshotId, let rawSha256 = source.snapshotRawSha256,
              selectedMembership?.symbol == check.symbol,
              check.manualSourceBindings?.contains(source) == true else { return }
        if source.bindingKind == "saved_material" {
            guard let membership = selectedMembership,
                  let materialId = source.materialId, let materialRevision = source.materialRevision,
                  let fingerprint = source.materialFingerprint else { return }
            do {
                let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
                guard workspace.data?.materials.contains(where: { material in
                    material.id == materialId && material.revision == materialRevision
                        && material.contentFingerprint == fingerprint && material.title == source.title
                        && material.sourceType == source.sourceType && material.sourceUrl == source.sourceUrl
                        && material.snapshotCitation?.snapshotId == snapshotId
                        && material.snapshotCitation?.textSha256 == source.contentSha256
                        && material.snapshotOriginal?.rawSha256 == rawSha256
                }) == true else { throw ResearchDocumentClientError.invalidResponse }
            } catch {
                researchSourceSnapshotWorkspace.message = "当时原件或材料身份无法核验；没有用相似资料替代。"
                return
            }
        }
        await openResearchSourceSnapshot(snapshotId)
        guard let snapshot = researchSourceSnapshotWorkspace.current,
              researchSourceSnapshotWorkspace.rawVerified,
              snapshot.id == snapshotId, snapshot.rawSha256 == rawSha256,
              snapshot.textSha256 == source.contentSha256 else {
            researchSourceSnapshotWorkspace.message = "当时原件无法核验；没有用相似或当前来源替代。"
            return
        }
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .documents
    }

    @MainActor
    private func reopenManualDecisionPDF(_ source: ManualDecisionSourceBinding,
                                         check: RecordedDecisionCheckReviewState) async {
        guard let membership = selectedMembership, membership.symbol == check.symbol,
              let documentId = source.documentId, let pdfSha = source.documentPdfSha256,
              let pageNumber = source.pageNumber,
              ["official_pdf", "owner_provided_pdf", "issuer_public_pdf"].contains(source.sourceType),
              check.manualSourceBindings?.contains(source) == true else { return }
        let identity = researchDocumentTaskIdentity, revision = UUID()
        researchDocumentWorkspace.savedOpenRevision = revision
        researchDocumentWorkspace.pdfPresentation = nil
        researchDocumentWorkspace.message = "当时原件正在按保存身份核验。"
        do {
            let list = try await client.fetchResearchDocuments(membership: membership)
            if source.bindingKind == "saved_material" {
                let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
                guard workspace.data?.materials.contains(where: { material in
                    material.id == source.materialId && material.revision == source.materialRevision
                        && material.contentFingerprint == source.materialFingerprint
                        && material.title == source.title && material.sourceType == source.sourceType
                        && material.sourceUrl == source.sourceUrl
                        && material.citation?.documentId == documentId
                        && material.citation?.pageNumber == pageNumber
                        && material.citation?.pageTextSha256 == source.contentSha256
                }) == true else { throw ResearchDocumentClientError.invalidResponse }
            }
            guard let document = list.documents.first(where: { $0.id == documentId }),
                  document.membershipId == membership.id, document.symbol == membership.symbol,
                  document.pdfSha256 == pdfSha, document.isSourceAvailable,
                  (source.bindingKind == "saved_material" || document.capturedSourceUrl == source.sourceUrl),
                  (1...document.pageCount).contains(pageNumber) else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let page = try await client.fetchResearchDocumentPage(membership: membership,
                documentId: documentId, pageNumber: pageNumber)
            guard page.pageTextSha256 == source.contentSha256 else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let bytes = try await client.fetchResearchDocumentContent(membership: membership, document: document)
            guard researchDocumentWorkspace.savedOpenRevision == revision,
                  researchDocumentTaskIdentity == identity,
                  selectedMembership?.id == membership.id,
                  check.manualSourceBindings?.contains(source) == true else { return }
            presentResearchDocumentPDF(document: document, pageNumber: pageNumber, data: bytes)
            if researchDocumentWorkspace.pdfPresentation != nil {
                researchDocumentWorkspace.message = "当时原件已核对 PDF 字节、文档身份和第\(pageNumber)页文本；事实仍须人工判断。"
            }
        } catch {
            guard researchDocumentWorkspace.savedOpenRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchDocumentWorkspace.pdfPresentation = nil
            researchDocumentWorkspace.message = "当时原件缺失、身份变化或校验失败；没有用相似或当前 PDF 替代。"
        }
    }

    @MainActor
    private func reopenManualDecisionProvider(_ source: ManualDecisionSourceBinding,
                                              check: RecordedDecisionCheckReviewState) async {
        guard let membership = selectedMembership, membership.symbol == check.symbol,
              source.sourceType == "futu_opend_financial_statement_provider",
              let materialId = source.materialId, let revisionNumber = source.materialRevision,
              let fingerprint = source.materialFingerprint,
              check.manualSourceBindings?.contains(source) == true else { return }
        let identity = researchDocumentTaskIdentity, revision = UUID()
        researchDocumentWorkspace.savedOpenRevision = revision
        researchDocumentWorkspace.savedOriginal = nil
        researchDocumentWorkspace.message = "当时原件正在按保存身份核验。"
        do {
            let material = try await client.readHistoricalFutuFinancialMaterial(
                membership: membership, materialId: materialId,
                revision: revisionNumber, contentFingerprint: fingerprint)
            guard source.bindingKind != "saved_material"
                    || material.title == source.title && material.sourceType == source.sourceType
                        && material.sourceUrl == source.sourceUrl
                        && material.contentFingerprint == source.contentSha256 else {
                throw ResearchDocumentClientError.invalidResponse
            }
            guard let originalSource = material.futuFinancialSource else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let capture = try await client.readFutuFinancialCapture(membership: membership,
                captureId: originalSource.captureId)
            guard capture.id == originalSource.captureId,
                  capture.membershipId == membership.id, capture.symbol == membership.symbol,
                  capture.membershipVersion == originalSource.membershipVersion else {
                throw ResearchDocumentClientError.invalidResponse
            }
            var originalPages: [String] = []
            for coordinate in originalSource.pages {
                guard let page = capture.pages.first(where: { $0.id == coordinate.pageId
                    && $0.statementType == coordinate.statementType
                    && $0.rawSha256 == coordinate.rawSha256
                    && $0.reports.contains(where: { $0.reportSha256 == coordinate.reportSha256 }) }) else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                let original = try await client.readFutuFinancialOriginal(membership: membership,
                    capture: capture, page: page)
                originalPages.append("\(page.statementType.title) · 原始页 #\(page.id) · SHA-256 \(page.rawSha256)\n\(original.rawText)")
            }
            guard researchDocumentWorkspace.savedOpenRevision == revision,
                  researchDocumentTaskIdentity == identity,
                  selectedMembership?.id == membership.id,
                  check.manualSourceBindings?.contains(source) == true else { return }
            researchDocumentWorkspace.savedOriginal = ResearchSavedOriginalPresentation(
                title: "当时选用的 OpenD 材料 #\(materialId)",
                body: "已保存材料：\n\(material.contentText)\n\n已核验原始响应：\n\(originalPages.joined(separator: "\n\n"))",
                verification: "已核对材料 ID、版本、指纹与对应原始页字节。第三方声明，未核实；不是发行人事实。",
                highlightRange: nil)
            researchDocumentWorkspace.message = "当时原件已核对材料和 OpenD 原始页；第三方内容未核实。"
        } catch {
            guard researchDocumentWorkspace.savedOpenRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchDocumentWorkspace.savedOriginal = nil
            researchDocumentWorkspace.message = "当时原件或已存材料缺失、已删、身份变化或校验失败；没有用当前相似材料替代。"
        }
    }

    private func manualSourceReopenURL(_ source: ManualDecisionSourceBinding) -> URL? {
        guard let raw = source.sourceUrl, let url = raw.exactHTTPSURL,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        if ["official_pdf", "owner_provided_pdf", "issuer_public_pdf"].contains(source.sourceType),
           let page = source.pageNumber,
           components.fragment == nil {
            components.fragment = "page=\(page)"
        }
        return components.url
    }

    @ViewBuilder
    private func decisionReviewFrozenResearchEvidence(_ check: RecordedDecisionCheckReviewState) -> some View {
        if check.contextSnapshot.availability == .preserved,
           let context = check.contextSnapshot.envelope {
            DisclosureGroup("查看判断时的研究证据（\(context.research.evidence.count)）") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("以下为判断时冻结的研究上下文，可能包含未被本次判断选用的证据。证据记录未保存所选原件的精确页码和内容指纹；打开外部网址后请核对原文版本。")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(context.research.evidence) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.summary).font(.callout)
                            Text("\(item.sourceType) · 记录于 \(compactUtcDateTime(item.capturedAt))")
                                .font(.caption).foregroundStyle(.secondary)
                            if let url = item.sourceUrl?.exactHTTPSURL {
                                Link("打开这条证据的原始来源", destination: url)
                                    .accessibilityIdentifier("reviewFrozenEvidenceSource-\(check.id)-\(item.id)")
                            } else {
                                Text("这条证据没有可重开的 HTTPS 原始来源。")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                .padding(.top, 6)
            }
            .accessibilityIdentifier("reviewFrozenResearchEvidence-\(check.id)")
        } else {
            Text("这次判断的证据快照不可用，无法从历史重开原始来源。")
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("reviewFrozenResearchEvidenceUnavailable-\(check.id)")
        }
    }

    func reviewForm(check: RecordedDecisionCheckReviewState) -> some View {
        let capturesLearning = check.conditionalDecision?.availability == "preserved"
            || ordinaryManualReviewLearningApplies(check)
        return VStack(alignment: .leading, spacing: 10) {
            Label("追加复盘", systemImage: "square.and.pencil").font(.callout.weight(.semibold))
            Picker("复盘结果", selection: $reviewOutcome) {
                ForEach(DecisionReviewOutcome.allCases, id: \.self) { outcome in
                    Text(reviewOutcomeLabel(outcome)).tag(outcome)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("decisionReviewOutcomePicker")

            TextField("复盘证据", text: $reviewEvidence, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                .focused($focusedReviewLearningInput, equals: .reviewEvidence)
                .submitLabel(.next)
                .onSubmit { focusedReviewLearningInput = .reviewNote }
                .accessibilityIdentifier("decisionReviewEvidenceField")
            TextField("复盘备注", text: $reviewNote, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                .focused($focusedReviewLearningInput, equals: .reviewNote)
                .submitLabel(capturesLearning ? .next : .done)
                .onSubmit {
                    focusedReviewLearningInput = capturesLearning
                        ? .judgmentCorrection
                        : nil
                }
                .accessibilityIdentifier("decisionReviewNoteField")

            if check.conditionalDecision?.availability == "preserved" {
                reviewLearningFields()
            } else if ordinaryManualReviewLearningApplies(check) {
                reviewLearningFields()
            }

            Button {
                Task { await submitReview(for: check) }
            } label: {
                Label(reviewInFlightCheckId == check.id ? "提交中" : "提交复盘", systemImage: "doc.badge.plus")
            }
            .buttonStyle(.bordered)
            .disabled(
                isLoading || isLoadingDecisionReviewHistory || reviewSubmissionState.isInFlight
                    || capturesLearning
                    && (reviewJudgmentCorrection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || reviewProcessLesson.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            )
            .accessibilityIdentifier("submitDecisionReviewButton")
        }
        .id(decisionReviewFormAnchor(check.id))
        .disabled(reviewInFlightCheckId == check.id || reviewSubmissionState.isInFlight)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                if let next = focusedReviewLearningInput?.next,
                   focusedReviewLearningInput == .reviewEvidence {
                    Button {
                        focusedReviewLearningInput = next
                    } label: {
                        Image(systemName: "arrow.down.to.line")
                    }
                    .accessibilityLabel("下一项")
                    .accessibilityIdentifier("reviewLearningKeyboardNextButton")
                }
                if focusedReviewLearningInput == .reviewEvidence || focusedReviewLearningInput == .reviewNote {
                    Button { focusedReviewLearningInput = nil } label: {
                        Label("收起复盘键盘", systemImage: "keyboard.chevron.compact.down")
                    }
                    .accessibilityIdentifier("decisionReviewKeyboardDone")
                }
            }
        }
    }

    @ViewBuilder
    func reviewLearningFields() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("判断如何修正", text: $reviewJudgmentCorrection, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                .focused($focusedReviewLearningInput, equals: .judgmentCorrection)
                .submitLabel(.next)
                .onSubmit { focusedReviewLearningInput = .processLesson }
                .accessibilityIdentifier("reviewLearningJudgmentCorrectionField")
            TextField("流程学到什么", text: $reviewProcessLesson, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                .focused($focusedReviewLearningInput, equals: .processLesson)
                .submitLabel(.next)
                .onSubmit { focusedReviewLearningInput = .nextResearchQuestion }
                .accessibilityIdentifier("reviewLearningProcessLessonField")
            TextField("下一研究问题（可选）", text: $reviewNextResearchQuestion, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                .focused($focusedReviewLearningInput, equals: .nextResearchQuestion)
                .submitLabel(.done)
                .onSubmit { focusedReviewLearningInput = nil }
                .accessibilityIdentifier("reviewLearningNextQuestionField")
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                if let next = focusedReviewLearningInput?.next {
                    Button {
                        focusedReviewLearningInput = next
                    } label: {
                        Image(systemName: "arrow.down.to.line")
                    }
                    .accessibilityLabel("下一项")
                    .accessibilityIdentifier("reviewLearningKeyboardNextButton")
                }
                Button { focusedReviewLearningInput = nil } label: {
                    Label("收起复盘学习键盘", systemImage: "keyboard.chevron.compact.down")
                }
                .accessibilityIdentifier("reviewLearningKeyboardDone")
            }
        }
    }

    func decisionReviewCheckAnchor(_ checkId: String) -> String {
        "decision-review-check:\(checkId)"
    }

    func decisionReviewFormAnchor(_ checkId: String) -> String {
        "decision-review-form:\(checkId)"
    }

    func decisionReviewSourceAnchor(_ reviewId: String) -> String {
        "decision-review-source:\(reviewId)"
    }

    @MainActor
    func deleteDecisionCheck(_ check: RecordedDecisionCheckReviewState) async {
        guard let symbol = parsedSymbol, let membership = selectedMembership,
              membership.symbol == symbol.canonical,
              decisionReviewHistory?.checks.contains(where: { $0.id == check.id }) == true else { return }
        let identity = "check:\(check.id)"
        if pendingDecisionReviewDeletionId != identity {
            pendingDecisionReviewDeletionId = identity
            lastReviewMessage = "再次点击“删除正式决定内容”确认；该决定及其复盘正文将移出 History、Today 和 AI 上下文，只保留无正文删除凭证。"
            return
        }
        let key = decisionReviewDeletionReservation.reserve(
            for: "\(symbol.canonical)|\(check.id)|\(check.checkedAt)", prefix: "ios-decision-check-delete"
        )
        decisionReviewDeletionInFlightId = identity
        defer { decisionReviewDeletionInFlightId = nil }
        do {
            let result = try await client.deleteDecisionCheckAndReadBack(
                market: symbol.market, code: symbol.code, check: check, idempotencyKey: key
            )
            guard parsedSymbol?.canonical == symbol.canonical,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
            decisionReviewHistory = result.history
            reconcileDecisionReviewSessionState(with: result.history)
            if activeTodayDailyTrackingTarget?.decisionCheckId == check.id { activeTodayDailyTrackingTarget = nil }
            if activeTodayReviewReturnTarget?.decisionCheckId == check.id { activeTodayReviewReturnTarget = nil }
            pendingDecisionReviewDeletionId = nil
            decisionReviewDeletionReservation.clear()
            lastReviewMessage = "删除凭证：正式决定 #\(check.id) · deletedAt=\(result.deletion.deletedAt)。正文和所附复盘已移除；旧备份仍可能含原内容。"
            scheduleResearchArchiveAutomaticBackup(.deletion("decision-\(check.id)-\(result.deletion.deletedAt)"), membership: membership)
        } catch {
            pendingDecisionReviewDeletionId = identity
            lastReviewMessage = "删除结果尚未精确确认；同一请求已保留，可再次确认重试。"
        }
    }

    @MainActor
    func deletePostDecisionReview(_ review: PostDecisionReviewData) async {
        guard let symbol = parsedSymbol, let membership = selectedMembership,
              membership.symbol == symbol.canonical,
              decisionReviewHistory?.checks.contains(where: {
                  $0.id == review.decisionCheckId && $0.reviews.contains(where: { $0.id == review.id })
              }) == true else { return }
        let identity = "review:\(review.id)"
        if pendingDecisionReviewDeletionId != identity {
            pendingDecisionReviewDeletionId = identity
            lastReviewMessage = "再次点击“删除这条复盘内容”确认；正文会移出 History、Today 和 AI 上下文，只保留无正文删除凭证。"
            return
        }
        let key = decisionReviewDeletionReservation.reserve(
            for: "\(symbol.canonical)|\(review.decisionCheckId)|\(review.id)|\(review.createdAt)",
            prefix: "ios-decision-review-delete"
        )
        decisionReviewDeletionInFlightId = identity
        defer { decisionReviewDeletionInFlightId = nil }
        do {
            let result = try await client.deletePostDecisionReviewAndReadBack(
                market: symbol.market, code: symbol.code, checkId: review.decisionCheckId,
                review: review, idempotencyKey: key
            )
            guard parsedSymbol?.canonical == symbol.canonical,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
            decisionReviewHistory = result.history
            reconcileDecisionReviewSessionState(with: result.history)
            if activeTodayDailyTrackingTarget?.reviewId == review.id { activeTodayDailyTrackingTarget = nil }
            if activeTodayReviewReturnTarget?.reviewId == review.id { activeTodayReviewReturnTarget = nil }
            pendingDecisionReviewDeletionId = nil
            decisionReviewDeletionReservation.clear()
            lastReviewMessage = "删除凭证：复盘 #\(review.id) · deletedAt=\(result.deletion.deletedAt)。正文已移除；旧备份仍可能含原内容。"
            scheduleResearchArchiveAutomaticBackup(.deletion("review-\(review.id)-\(result.deletion.deletedAt)"), membership: membership)
        } catch {
            pendingDecisionReviewDeletionId = identity
            lastReviewMessage = "删除结果尚未精确确认；同一请求已保留，可再次确认重试。"
        }
    }

    @MainActor
    func reconcileDecisionReviewSessionState(with history: DecisionReviewHistoryEnvelope) {
        let activeCheckIds = Set(history.checks.map(\.id))
        let activeReviewIds = Set(history.checks.flatMap(\.reviews).map(\.id))
        if let submittedDecision, !activeCheckIds.contains(submittedDecision.id) {
            clearSubmittedDecision()
        }
        if let submittedReview, !activeReviewIds.contains(submittedReview.id) {
            self.submittedReview = nil
            reviewSubmissionState.discardForAuthorizationChange()
        }
        if let binding = selectedDecisionReviewCheckBinding,
           !activeCheckIds.contains(binding.checkId) {
            selectedDecisionReviewCheckBinding = nil
            reviewSubmissionState.discardForAuthorizationChange()
        }
    }
}
