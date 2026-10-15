import SwiftUI

extension GateBResearchScreen {
    func candidateDecisionIntakeSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("候选决策准备")
                    .accessibilityIdentifier("candidateDecisionIntakeTitle")
                Spacer()
                Text(decisionIntakeModel.state)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(candidateDecisionIntakeColor(decisionIntakeModel.state))
                    .accessibilityIdentifier("candidateDecisionIntakeState")
            }

            InfoBlock(title: decisionIntakeModel.title, value: decisionIntakeModel.message, valueIdentifier: "candidateDecisionIntakeStatus")
            InfoBlock(title: "成员 / 标的", value: "\(decisionIntakeModel.membershipId ?? "unselected") / \(decisionIntakeModel.symbol ?? "unavailable")", valueIdentifier: "candidateDecisionIntakeIdentity")

            if decisionIntakeModel.facts.isEmpty {
                Text("决策准备不可用，未展示旧数据或部分数据。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("candidateDecisionIntakeEmpty")
            } else {
                ForEach(Array(decisionIntakeModel.facts.enumerated()), id: \.offset) { index, fact in
                    Text(fact)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("candidateDecisionIntakeFact-\(index)")
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func assistAdvisoryScopeSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("ASSIST 范围说明")
                    .accessibilityIdentifier("assistAdvisoryScopeTitle")
                Spacer()
                Text(advisoryScopeModel.state)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(assistAdvisoryScopeColor(advisoryScopeModel.state))
                    .accessibilityIdentifier("assistAdvisoryScopeState")
            }

            InfoBlock(title: advisoryScopeModel.title, value: advisoryScopeModel.message, valueIdentifier: "assistAdvisoryScopeStatus")
            InfoBlock(title: "成员 / 标的", value: "\(advisoryScopeModel.membershipId ?? "unselected") / \(advisoryScopeModel.symbol ?? "unavailable")", valueIdentifier: "assistAdvisoryScopeIdentity")

            if advisoryScopeModel.facts.isEmpty {
                Text("ASSIST 范围不可用，未展示旧数据或部分数据。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("assistAdvisoryScopeEmpty")
            } else {
                BulletList(title: "事实清单", items: advisoryScopeModel.facts)
                    .accessibilityIdentifier("assistAdvisoryScopeFacts")
                BulletList(title: "限制", items: advisoryScopeModel.limitations)
                    .accessibilityIdentifier("assistAdvisoryScopeLimitations")
                BulletList(title: "允许继续", items: advisoryScopeModel.continuations)
                    .accessibilityIdentifier("assistAdvisoryScopeContinuations")
                BulletList(title: "安全证明", items: advisoryScopeModel.safety)
                    .accessibilityIdentifier("assistAdvisoryScopeSafety")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func assistHumanReviewWorkspaceSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("本地人工复核工作台")
                    .accessibilityIdentifier("assistHumanReviewWorkspaceTitle")
                Spacer()
                Text(humanReviewWorkspaceModel.state)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(assistHumanReviewWorkspaceColor(humanReviewWorkspaceModel.state))
                    .accessibilityIdentifier("assistHumanReviewWorkspaceState")
            }

            InfoBlock(title: humanReviewWorkspaceModel.title, value: humanReviewWorkspaceModel.message, valueIdentifier: "assistHumanReviewWorkspaceStatus")
            InfoBlock(title: "成员 / 标的", value: "\(humanReviewWorkspaceModel.membershipId ?? "unselected") / \(humanReviewWorkspaceModel.symbol ?? "unavailable")", valueIdentifier: "assistHumanReviewWorkspaceIdentity")

            if humanReviewWorkspaceModel.evidenceGroups.isEmpty {
                ForEach(Array(humanReviewWorkspaceModel.failClosedExplanation.enumerated()), id: \.offset) { index, line in
                    Text(line)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("assistHumanReviewWorkspaceFailClosed-\(index)")
                }
                if humanReviewWorkspaceModel.failClosedExplanation.isEmpty {
                    Text("本地人工复核工作台不可用，未展示旧事实或部分事实。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("assistHumanReviewWorkspaceEmpty")
                }
            } else {
                BulletList(title: "准备状态", items: humanReviewWorkspaceModel.readiness)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceReadiness")
                BulletList(title: "证据组", items: humanReviewWorkspaceModel.evidenceGroups)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceEvidenceGroups")
                BulletList(title: "限制级别", items: humanReviewWorkspaceModel.limitationsWithSeverity)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceLimitations")
                BulletList(title: "安全继续动作", items: humanReviewWorkspaceModel.continuations)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceContinuations")
                BulletList(title: "后续本地意图", items: humanReviewWorkspaceModel.followUp)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceFollowUp")
                BulletList(title: "边界", items: humanReviewWorkspaceModel.boundaries)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceBoundaries")
                BulletList(title: "失败关闭", items: humanReviewWorkspaceModel.failClosedExplanation)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceFailClosed")
                BulletList(title: "来源", items: humanReviewWorkspaceModel.provenance)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceProvenance")
                BulletList(title: "安全", items: humanReviewWorkspaceModel.safety)
                    .accessibilityIdentifier("assistHumanReviewWorkspaceSafety")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func assistReviewFollowUpWorkflowSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("本地复核后续 workflow")
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowTitle")
                Spacer()
                Text(reviewFollowUpWorkflowModel.state)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(assistReviewFollowUpWorkflowColor(reviewFollowUpWorkflowModel.state))
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowState")
            }

            InfoBlock(title: reviewFollowUpWorkflowModel.title, value: reviewFollowUpWorkflowModel.message, valueIdentifier: "assistReviewFollowUpWorkflowStatus")
            InfoBlock(title: "成员 / 标的", value: "\(reviewFollowUpWorkflowModel.membershipId ?? "unselected") / \(reviewFollowUpWorkflowModel.symbol ?? "unavailable")", valueIdentifier: "assistReviewFollowUpWorkflowIdentity")

            if reviewFollowUpWorkflowModel.steps.isEmpty {
                ForEach(Array(reviewFollowUpWorkflowModel.failClosedExplanation.enumerated()), id: \.offset) { index, line in
                    Text(line)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("assistReviewFollowUpWorkflowFailClosed-\(index)")
                }
                if reviewFollowUpWorkflowModel.failClosedExplanation.isEmpty {
                    Text("本地复核后续 workflow 不可用，未展示旧事实或本地草稿。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("assistReviewFollowUpWorkflowEmpty")
                }
            } else {
                BulletList(title: "步骤", items: reviewFollowUpWorkflowModel.steps)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowSteps")
                BulletList(title: "本地草稿意图", items: reviewFollowUpWorkflowModel.intents)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowIntents")
                Text("以下草稿仅保存在本机界面状态，不是官方复核记录，不持久化，不发送。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowLocalOnlyCopy")

                TextField("本地备忘草稿", text: $reviewFollowUpDrafts.manualNote, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(reviewFollowUpWorkflowModel.state != "available" && reviewFollowUpWorkflowModel.state != "blocked")
                    .onChange(of: reviewFollowUpDrafts.manualNote) {
                        refreshReviewFollowUpDraftSummary()
                    }
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowManualNoteDraft")

                TextField("稍后复核草稿", text: $reviewFollowUpDrafts.laterReview, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(reviewFollowUpWorkflowModel.state != "available" && reviewFollowUpWorkflowModel.state != "blocked")
                    .onChange(of: reviewFollowUpDrafts.laterReview) {
                        refreshReviewFollowUpDraftSummary()
                    }
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowLaterReviewDraft")

                TextField("证据缺口清单草稿", text: $reviewFollowUpDrafts.evidenceGapChecklist, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(reviewFollowUpWorkflowModel.state != "available" && reviewFollowUpWorkflowModel.state != "blocked")
                    .onChange(of: reviewFollowUpDrafts.evidenceGapChecklist) {
                        refreshReviewFollowUpDraftSummary()
                    }
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowEvidenceGapDraft")

                BulletList(title: "本地草稿摘要", items: reviewFollowUpWorkflowModel.draftSummary)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowDraftSummary")
                BulletList(title: "证据缺口", items: reviewFollowUpWorkflowModel.evidenceGaps)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowEvidenceGaps")
                BulletList(title: "本地下一视图", items: reviewFollowUpWorkflowModel.suggestedLocalViews)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowLocalViews")
                BulletList(title: "已阻止的外部动作", items: reviewFollowUpWorkflowModel.blockedExternalActions)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowBlockedActions")
                BulletList(title: "失败关闭", items: reviewFollowUpWorkflowModel.failClosedExplanation)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowFailClosed")
                BulletList(title: "安全", items: reviewFollowUpWorkflowModel.safety)
                    .accessibilityIdentifier("assistReviewFollowUpWorkflowSafety")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func assistDecisionNoteWorkflowSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("本地 decision note workflow")
                    .accessibilityIdentifier("assistDecisionNoteWorkflowTitle")
                Spacer()
                Text(decisionNoteWorkflowModel.state)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(assistDecisionNoteWorkflowColor(decisionNoteWorkflowModel.state))
                    .accessibilityIdentifier("assistDecisionNoteWorkflowState")
            }

            InfoBlock(title: decisionNoteWorkflowModel.title, value: decisionNoteWorkflowModel.message, valueIdentifier: "assistDecisionNoteWorkflowStatus")
            InfoBlock(title: "成员 / 标的", value: "\(decisionNoteWorkflowModel.membershipId ?? "unselected") / \(decisionNoteWorkflowModel.symbol ?? "unavailable")", valueIdentifier: "assistDecisionNoteWorkflowIdentity")

            if decisionNoteWorkflowModel.factReferences.isEmpty {
                ForEach(Array(decisionNoteWorkflowModel.failClosedExplanation.enumerated()), id: \.offset) { index, line in
                    Text(line)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("assistDecisionNoteWorkflowFailClosed-\(index)")
                }
                if decisionNoteWorkflowModel.failClosedExplanation.isEmpty {
                    Text("本地 decision note workflow 不可用，未展示旧事实或本地草稿。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("assistDecisionNoteWorkflowEmpty")
                }
            } else {
                Text("Decision note 草稿仅保存在当前 iOS 界面状态，不是官方复核记录，不持久化，不发送。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowLocalOnlyCopy")

                TextField("本地 decision note 草稿", text: $decisionNoteDrafts.decisionNote, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(decisionNoteWorkflowModel.state != "available" && decisionNoteWorkflowModel.state != "blocked")
                    .onChange(of: decisionNoteDrafts.decisionNote) {
                        refreshDecisionNoteDraftSummary()
                    }
                    .accessibilityIdentifier("assistDecisionNoteWorkflowDraftField")

                BulletList(title: "本地草稿摘要", items: decisionNoteWorkflowModel.draftSummary)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowDraftSummary")
                BulletList(title: "事实引用", items: decisionNoteWorkflowModel.factReferences)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowFactReferences")
                BulletList(title: "未解决证据缺口", items: decisionNoteWorkflowModel.unresolvedEvidenceGaps)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowEvidenceGaps")
                BulletList(title: "稍后复核入口", items: decisionNoteWorkflowModel.laterReviewEntry)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowLaterReview")
                BulletList(title: "已阻止的外部动作", items: decisionNoteWorkflowModel.blockedExternalActions)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowBlockedActions")
                BulletList(title: "失败关闭", items: decisionNoteWorkflowModel.failClosedExplanation)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowFailClosed")
                BulletList(title: "安全", items: decisionNoteWorkflowModel.safety)
                    .accessibilityIdentifier("assistDecisionNoteWorkflowSafety")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("assistDecisionNoteWorkflowSection")
    }

}
