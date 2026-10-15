import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func dailyTrackingReviewResolutionSection(
        target: TodayReviewNavigationTarget,
        report: TwoLayerReportData
    ) -> some View {
        Divider()
        if let reviewId = target.reviewId,
           let review = decisionReviewHistory?.checks
            .first(where: { $0.id == target.decisionCheckId })?.reviews
            .first(where: { $0.id == reviewId }) {
            VStack(alignment: .leading, spacing: 7) {
                Label("每日跟踪复盘已保存", systemImage: "checkmark.circle.fill")
                    .font(.callout.weight(.semibold)).foregroundStyle(.green)
                    .accessibilityIdentifier("researchDailyTrackingResolvedTitle")
                Text("#\(review.id) · \(reviewOutcomeLabel(review.outcome)) · \(compactUtcDateTime(review.reviewedAt))")
                    .font(.caption.monospaced())
                    .accessibilityIdentifier("researchDailyTrackingResolvedIdentity")
                Text(review.outcomeEvidence ?? "未填写复盘证据")
                    .font(.caption).accessibilityIdentifier("researchDailyTrackingResolvedEvidence")
                Text("这是追加式人工复盘；正式决定未被自动修改，也未触发交易。")
                    .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                if target.expectedReviewOutcome == review.outcome,
                   review.outcome == .thesisWeakened || review.outcome == .thesisInvalidated {
                    Label("该结果需要人工重新审视正式决定", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout.weight(.semibold)).foregroundStyle(.orange)
                        .accessibilityIdentifier("researchDailyTrackingReconsiderationTitle")
                    Text("只打开当前报告对应的正式决定工作区；不会自动采用报告或修改决定。")
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("researchDailyTrackingReconsiderationBoundary")
                    TextField("复盘后判断修正（必填）", text: $dailyTrackingReconsiderationCorrection, axis: .vertical)
                        .lineLimit(2...4).textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("dailyTrackingReconsiderationCorrectionField")
                    TextField("下一验证问题 / 观察点（必填）", text: $dailyTrackingReconsiderationNextQuestion, axis: .vertical)
                        .lineLimit(2...4).textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("dailyTrackingReconsiderationNextQuestionField")
                    TextField("需要反证 / 未知项（可选）", text: $dailyTrackingReconsiderationCounterevidence, axis: .vertical)
                        .lineLimit(2...4).textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("dailyTrackingReconsiderationCounterevidenceField")
                    Text("报告修正会先保存为你提供、尚未验证的研究材料；重新冻结后，AI 仍只接收当前选定的证据版本。")
                        .font(.caption).foregroundStyle(.secondary)
                    Button {
                        openDailyTrackingDecisionReconsideration(
                            target: target,
                            review: review,
                            report: report
                        )
                    } label: {
                        Label("带入正式决定工作区", systemImage: "checkmark.seal")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(dailyTrackingReconsiderationDraftHasRequiredInput == false)
                    .accessibilityIdentifier("openDailyTrackingDecisionReconsideration")
                    Button {
                        Task {
                            await carryDailyTrackingCorrectionIntoReportDraft(
                                target: target,
                                review: review,
                                report: report
                            )
                        }
                    } label: {
                        Label("保存复盘修正并准备重研", systemImage: "arrow.triangle.2.circlepath.doc.on.clipboard")
                    }
                    .buttonStyle(.bordered)
                    .disabled(dailyTrackingReconsiderationDraftHasRequiredInput == false)
                    .accessibilityIdentifier("carryDailyTrackingCorrectionIntoReportDraft")
                    if let dailyTrackingReconsiderationMessage {
                        Text(dailyTrackingReconsiderationMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("dailyTrackingReconsiderationDraftMessage")
                    }
                    if let dailyTrackingReportRevisionMessage {
                        Text(dailyTrackingReportRevisionMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("dailyTrackingReportRevisionMessage")
                    }
                }
            }
        } else if target.reviewId == nil,
                  let check = currentReviewableCheck,
                  check.id == target.decisionCheckId {
            VStack(alignment: .leading, spacing: 10) {
                Label("记录本次每日跟踪复盘", systemImage: "square.and.pencil")
                    .font(.callout.weight(.semibold))
                    .accessibilityIdentifier("researchDailyTrackingReviewFormTitle")
                if let tracking = TodayMaterialChangePresentation.formalDecisionTrackingSummary(
                    actionIntent: check.actionIntent,
                    state: check.formalDecision
                ) {
                    InfoBlock(
                        title: "本次要跟踪的 Owner 正式决定",
                        value: tracking,
                        valueIdentifier: "researchDailyTrackingFormalDecisionConditions"
                    )
                }
                Text("下一验证：\(report.payload.nextValidationQuestions.first ?? "尚未记录，请先补充报告的下一验证问题")")
                    .font(.caption).accessibilityIdentifier("researchDailyTrackingReviewQuestion")
                Text("失效条件：\(report.payload.invalidationConditions.joined(separator: "；"))")
                    .font(.caption).accessibilityIdentifier("researchDailyTrackingReviewInvalidations")
                Picker("每日跟踪结果", selection: $reviewOutcome) {
                    ForEach(DecisionReviewOutcome.allCases, id: \.self) { outcome in
                        Text(reviewOutcomeLabel(outcome)).tag(outcome)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("researchDailyTrackingReviewOutcomePicker")
                TextField("本次验证证据", text: $reviewEvidence, axis: .vertical)
                    .lineLimit(2...4).textFieldStyle(.roundedBorder)
                    .focused($focusedReviewLearningInput, equals: .reviewEvidence)
                    .submitLabel(.next)
                    .onSubmit { focusedReviewLearningInput = .reviewNote }
                    .accessibilityIdentifier("researchDailyTrackingReviewEvidenceField")
                TextField("人工复盘备注", text: $reviewNote, axis: .vertical)
                    .lineLimit(2...4).textFieldStyle(.roundedBorder)
                    .focused($focusedReviewLearningInput, equals: .reviewNote)
                    .submitLabel(.done)
                    .onSubmit { focusedReviewLearningInput = nil }
                    .accessibilityIdentifier("researchDailyTrackingReviewNoteField")
                if check.conditionalDecision?.availability == "preserved" {
                    Text("请补充本次人工复盘学习；这些内容只追加记录，不自动修改正式决定，也不触发交易。")
                        .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                        .accessibilityIdentifier("researchDailyTrackingReviewLearningBoundary")
                    reviewLearningFields()
                }
                Button {
                    Task { await submitReview(for: check, dailyTracking: true) }
                } label: {
                    Label(reviewInFlightCheckId == check.id ? "提交中" : "提交每日跟踪复盘", systemImage: "doc.badge.plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    isLoading || isLoadingDecisionReviewHistory || reviewSubmissionState.isInFlight
                        || check.conditionalDecision?.availability == "preserved"
                        && (reviewJudgmentCorrection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || reviewProcessLesson.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                )
                .accessibilityIdentifier("submitDailyTrackingReviewButton")
                Text("仅由你显式提交；不会自动创建复盘、修改正式决定或交易。保存结果核对一致后，Today 才会把事项标记为已解决。")
                    .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                    .accessibilityIdentifier("researchDailyTrackingReviewWriteBoundary")
            }
            .id(decisionReviewFormAnchor(check.id))
            .disabled(reviewInFlightCheckId == check.id || reviewSubmissionState.isInFlight)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button { focusedReviewLearningInput = nil } label: {
                        Label("完成", systemImage: "keyboard.chevron.compact.down")
                    }
                    .accessibilityIdentifier("decisionReviewKeyboardDone")
                }
            }
        } else {
            Text("每日跟踪复盘目标不可用；请返回 Today 刷新后重试。")
                .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                .accessibilityIdentifier("researchDailyTrackingReviewUnavailable")
        }
    }

    @MainActor
    func openDailyTrackingDecisionReconsideration(
        target: TodayReviewNavigationTarget,
        review: PostDecisionReviewData,
        report: TwoLayerReportData
    ) {
        guard !twoLayerReportWorkspace.isBusy else {
            dailyTrackingReconsiderationMessage = "报告修订保存或读取进行中；当前来源不会被改写。"
            return
        }
        guard activeTodayDailyTrackingTarget == target,
              target.reviewId == review.id,
              target.reportBinding?.reportId == report.id,
              target.expectedReviewOutcome == review.outcome,
              review.outcome == .thesisWeakened || review.outcome == .thesisInvalidated,
              resolveTodayDailyTrackingTarget(target) else {
            clearRequestedTodayReviewTarget(
                "每日跟踪复盘或报告 currentness 已变化；重新审视入口已失败闭合。"
            )
            return
        }
        let correction = dailyTrackingReconsiderationCorrection.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextQuestion = dailyTrackingReconsiderationNextQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        let counterevidence = dailyTrackingReconsiderationCounterevidence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !correction.isEmpty, !nextQuestion.isEmpty else {
            dailyTrackingReconsiderationMessage = "请先填写判断修正和下一验证问题；不会自动采用或提交。"
            return
        }
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .brief
        pendingDecisionWorkspaceScrollTarget = twoLayerReportFormalDecisionAnchor(report.id)
        pendingResearchReportReconsiderationId = report.id
        setPendingResearchReportRevisionSource(.dailyReview(review.id))
        dailyTrackingReconsiderationDraftBinding = DailyTrackingReconsiderationDraftBinding(
            target: target,
            reportId: report.id,
            reviewId: review.id,
            reviewOutcome: review.outcome
        )
        userFinalDecision = dailyTrackingReconsiderationDraftText(
            review: review,
            correction: correction,
            nextQuestion: nextQuestion,
            counterevidence: counterevidence
        )
        researchReportFormalDecisionBinding = nil
        dailyTrackingReconsiderationMessage = "本次复盘修正草稿已带入正式决定说明；仍需手动选择当前报告并提交。"
        researchReportFormalDecisionMessage =
            "已带入你手填的复盘修正草稿；请再次明确点击采用后手工提交新正式决定。当前没有自动采用、写入或交易。"
    }

    var dailyTrackingReconsiderationDraftHasRequiredInput: Bool {
        !dailyTrackingReconsiderationCorrection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !dailyTrackingReconsiderationNextQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @MainActor
    func clearDailyTrackingReconsiderationDraft(resetFormalDecisionText: Bool = false) {
        let hadDraft = dailyTrackingReconsiderationDraftBinding != nil
        pendingResearchReportReconsiderationId = nil
        setPendingResearchReportRevisionSource(nil)
        dailyTrackingReconsiderationDraftBinding = nil
        dailyTrackingReconsiderationCorrection = ""
        dailyTrackingReconsiderationNextQuestion = ""
        dailyTrackingReconsiderationCounterevidence = ""
        dailyTrackingReconsiderationMessage = nil
        dailyTrackingReportRevisionMessage = nil
        if resetFormalDecisionText && hadDraft {
            userFinalDecision = "继续观察，不自动生成交易。"
        }
    }

    func dailyTrackingReconsiderationDraftIsCurrent(for report: TwoLayerReportData) -> Bool {
        guard let draft = dailyTrackingReconsiderationDraftBinding,
              draft.reportId == report.id,
              activeTodayDailyTrackingTarget == draft.target,
              draft.target.reviewId == draft.reviewId,
              draft.target.expectedReviewOutcome == draft.reviewOutcome else { return false }
        return resolveTodayDailyTrackingTarget(draft.target)
    }

    func dailyTrackingReconsiderationDraftText(
        review: PostDecisionReviewData,
        correction: String,
        nextQuestion: String,
        counterevidence: String
    ) -> String {
        """
        复盘修正草稿（你手填 / 本次会话 / 未提交）
        来源：每日跟踪复盘 #\(review.id) · \(reviewOutcomeLabel(review.outcome))
        判断修正：\(correction)
        下一验证：\(nextQuestion)
        反证和未知项：\(counterevidence.isEmpty ? "未填写" : counterevidence)
        边界：该草稿不会自动采用报告、不会提交正式决定、不会交易或修改资产事实。
        """
    }

    @MainActor
    func carryDailyTrackingCorrectionIntoReportDraft(
        target: TodayReviewNavigationTarget,
        review: PostDecisionReviewData,
        report: TwoLayerReportData
    ) async {
        guard !twoLayerReportWorkspace.isBusy else {
            dailyTrackingReportRevisionMessage = "报告修订保存或读取进行中；当前来源不会被改写。"
            return
        }
        guard activeTodayDailyTrackingTarget == target,
              target.reviewId == review.id,
              target.reportBinding?.reportId == report.id,
              target.expectedReviewOutcome == review.outcome,
              review.outcome == .thesisWeakened || review.outcome == .thesisInvalidated,
              resolveTodayDailyTrackingTarget(target),
              selectedMembership != nil,
              let pack = currentTwoLayerReportPack,
              pack.currentness.status == "current",
              pack.id == report.evidencePackId,
              currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else {
            dailyTrackingReportRevisionMessage = "每日跟踪、报告或冻结证据已经变化；请重新打开当前复盘。"
            return
        }
        let correction = dailyTrackingReconsiderationCorrection.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextQuestion = dailyTrackingReconsiderationNextQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        let counterevidence = dailyTrackingReconsiderationCounterevidence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !correction.isEmpty, !nextQuestion.isEmpty else {
            dailyTrackingReportRevisionMessage = "请先填写判断修正和下一验证问题；未创建可保存的报告修订。"
            return
        }
        let fingerprint = [
            report.id, String(report.version), report.reportFingerprint,
            review.id, review.outcome.rawValue, correction, nextQuestion, counterevidence
        ].joined(separator: "|")
        let key = twoLayerReportWorkspace.saveReservation.reserve(
            for: fingerprint,
            prefix: "ios-owner-report-correction"
        )
        guard let membership = selectedMembership,
              let reportBinding = target.reportBinding,
              let requestBody = report.ownerCorrectionMaterialRequest(
                membership: membership,
                decisionCheckId: target.decisionCheckId,
                reviewId: review.id,
                reviewOutcome: review.outcome.rawValue,
                reviewedAt: review.reviewedAt,
                reportBinding: reportBinding,
                correction: correction,
                nextQuestion: nextQuestion,
                counterevidence: counterevidence,
                idempotencyKey: key
              ) else {
            dailyTrackingReportRevisionMessage = "复盘修正或当前报告身份无效；没有保存研究材料。"
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let revision = twoLayerReportWorkspace.requests.beginSave()
        defer { twoLayerReportWorkspace.requests.finishSave(revision) }
        do {
            let result = try await client.createOwnerCorrectionMaterialAndReadBack(
                membership: membership,
                requestBody: requestBody
            )
            guard twoLayerReportWorkspace.requests.acceptsSave(revision),
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  activeTodayDailyTrackingTarget == target,
                  resolveTodayDailyTrackingTarget(target) else { return }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.setOwnerConfirmation(
                false,
                for: currentFrozenResearchBindingIdentity
            )
            invalidateTwoLayerReport(
                "你的复盘修正已成为新研究材料；旧证据和报告已转为历史版本，必须重新冻结后再综合。"
            )
            pendingResearchReportReconsiderationId = report.id
            setPendingResearchReportRevisionSource(.dailyReview(review.id))
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .frozen
            pendingDecisionWorkspaceScrollTarget = "freezeResearchEvidenceButton"
            frozenResearchEvidenceWorkspace.message =
                "修正材料 #\(result.material.id) 已保存并核对；请重新冻结当前证据版本。"
            dailyTrackingReportRevisionMessage =
                "复盘修正已绑定报告 #\(report.id) 和复盘 #\(review.id)；AI 尚未运行。"
            todayRefreshRevision &+= 1
            await loadTodayResearch(for: membership)
        } catch {
            guard twoLayerReportWorkspace.requests.acceptsSave(revision) else { return }
            dailyTrackingReportRevisionMessage =
                "复盘修正保存结果未确认；同一幂等身份已保留，明确重试不会自动重复写入。"
        }
    }
}
