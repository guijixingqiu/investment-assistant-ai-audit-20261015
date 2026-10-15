import SwiftUI

extension GateBResearchScreen {
    func candidateOverviewSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionTitle("跟踪候选")
                    .accessibilityIdentifier("candidateOverviewTitle")
                Spacer()
                Button {
                    Task { await refreshCandidates() }
                } label: {
                    Label(isLoadingCandidates ? "刷新中" : "刷新", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingCandidates)
                .accessibilityIdentifier("refreshCandidatesButton")
            }

            InfoBlock(title: "状态", value: "\(candidateOverview.status.researchLabel)：\(candidateOverview.message)", valueIdentifier: "candidateOverviewStatus")
            InfoBlock(title: "来源", value: "研究档案与已存行情；不读取资产账户", valueIdentifier: "candidateOverviewProvenance")

            if candidateOverview.candidates.isEmpty {
                Text(candidateOverview.status == .empty ? "暂无跟踪候选标的。" : "候选标的不可用，未展示旧数据或部分数据。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("candidateOverviewEmpty")
            } else {
                ForEach(Array(candidateOverview.candidates.enumerated()), id: \.element.id) { index, candidate in
                    candidateRow(candidate, order: index + 1)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.candidateList)
    }

    func candidateRow(_ candidate: CandidateOverviewItem, order: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(order). \(candidate.symbol)")
                    .font(.callout.weight(.semibold))
                    .accessibilityIdentifier("candidateSymbol-\(candidate.symbol)")
                Spacer()
                Text(candidate.quote.status.researchLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(candidateQuoteColor(candidate.quote.status))
                    .accessibilityIdentifier("candidateQuoteStatus-\(candidate.symbol)")
            }
            if let name = candidate.name {
                Text(name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            InfoBlock(title: "研究更新时间", value: candidate.researchUpdatedAt, valueIdentifier: "candidateResearchUpdatedAt-\(candidate.symbol)")
            InfoBlock(title: "下次复核", value: candidate.nextReviewOn ?? "未安排")
            InfoBlock(title: "研究维护状态", value: candidateReviewMaintenanceText(candidate), valueIdentifier: "candidateReviewMaintenance-\(candidate.symbol)")
            InfoBlock(title: "最新证据时间", value: candidate.latestEvidenceCapturedAt ?? "未记录", valueIdentifier: "candidateLatestEvidence-\(candidate.symbol)")
            InfoBlock(title: "证据 / 待处理建议", value: "\(candidate.evidenceCount) / \(candidate.pendingSuggestionCount)", valueIdentifier: "candidateCounts-\(candidate.symbol)")
            InfoBlock(title: "报价", value: candidateQuoteText(candidate.quote), valueIdentifier: "candidateQuoteText-\(candidate.symbol)")
            Button {
                selectedEvidenceWorkspace = .facts
                showDailyDecisionLayer(.evidence)
                symbolInput = candidate.symbol
            } label: {
                Label("查看辅助决策", systemImage: "arrow.right.circle")
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("selectCandidate-\(candidate.symbol)")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
    }

    func candidateMembershipSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("研究自选管理")
                .accessibilityIdentifier("candidateMembershipTitle")

            DailyResponsiveActionGroup {
                Toggle("含归档", isOn: $includeArchivedMemberships)
                    .accessibilityIdentifier("candidateMembershipIncludeArchived")
                    .disabled(isLoadingMemberships || isWritingMembership)
                    .onChange(of: includeArchivedMemberships) {
                        Task { await refreshMemberships() }
                    }
                Button {
                    Task { await refreshMemberships() }
                } label: {
                    Label(isLoadingMemberships ? "刷新中" : "刷新", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingMemberships || isWritingMembership)
                .accessibilityIdentifier("refreshMembershipsButton")
            }
            .accessibilityIdentifier("candidateMembershipHeaderActions")

            InfoBlock(title: "状态", value: "\(candidateMemberships.status.researchLabel)：\(candidateMemberships.message)", valueIdentifier: "candidateMembershipStatus")
            InfoBlock(title: "来源", value: "研究自选、研究档案与已存行情；不读取资产账户", valueIdentifier: "candidateMembershipProvenance")

            Text("研究优先（优先研究 / 正常 / 稍后）只保存在本机 UserDefaults，仅调整你本机此列表的显示顺序；不上传、不跨设备同步，也不代表研究证据是否充分。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("candidateResearchPriorityLocalOnly")

            candidateMembershipCreateForm()

            if let membershipWriteMessage {
                Text(membershipWriteMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("candidateMembershipWriteMessage")
            }
            if let membershipStaleMessage {
                Text(membershipStaleMessage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("candidateMembershipStaleMessage")
            }

            if candidateMemberships.memberships.isEmpty {
                Text(candidateMemberships.status == .empty ? "暂无研究自选记录。" : "研究自选不可用，未展示旧数据或部分数据。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("candidateMembershipEmpty")
            } else {
                ForEach(prioritizedMemberships) { membership in
                    candidateMembershipRow(membership)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func candidateMembershipCreateForm() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("五位港股代码或 HK.代码", text: $membershipInput)
                .textInputAutocapitalization(.characters)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("candidateMembershipInput")

            Picker("初始状态", selection: $membershipInitialState) {
                Text("跟踪").tag(CandidateMembershipInitialState.tracked)
                Text("暂停").tag(CandidateMembershipInitialState.paused)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("candidateMembershipInitialState")

            Toggle("显式恢复已归档", isOn: $restoreArchivedMembership)
                .accessibilityIdentifier("candidateMembershipRestoreArchived")

            Button {
                Task { await createMembership() }
            } label: {
                Label(isWritingMembership ? "提交中" : "加入研究自选", systemImage: "plus.circle")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isWritingMembership || isLoadingMemberships)
            .accessibilityIdentifier("candidateMembershipCreateButton")

            Text("手动输入普通五位港股代码即可加入研究自选，不要求港股通资格；已归档的代码需先打开「显式恢复已归档」才会恢复。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("candidateMembershipManualEntryScope")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func candidateMembershipRow(_ membership: CandidateMembershipData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(membership.symbol) \(membership.research.name ?? "")")
                    .font(.callout.weight(.semibold))
                    .accessibilityIdentifier("candidateMembershipSymbol-\(membership.symbol)")
                Spacer()
                Text(membership.state.researchLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(candidateMembershipStateColor(membership.state))
                    .accessibilityIdentifier("candidateMembershipState-\(membership.symbol)")
            }

            Text("跟踪 / 暂停 / 归档只说明是否继续跟踪，不代表研究证据是否充分；档案是否足够仍要看报告与来源。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("candidateMembershipStateMeaning-\(membership.symbol)")

            VStack(alignment: .leading, spacing: 4) {
                Text("我的研究优先（本机排序）")
                    .font(.caption.weight(.semibold))
                Picker("我的研究优先", selection: candidateResearchPriorityBinding(for: membership)) {
                    ForEach(CandidateResearchPriority.allCases, id: \.self) { priority in
                        Text(priority.researchPriorityLabel).tag(priority)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("candidateResearchPriority-\(membership.symbol)")
            }

            DailyResponsiveActionGroup {
                Button {
                    Task { await updateMembership(membership, state: .tracked) }
                } label: {
                    Label("跟踪", systemImage: "eye")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isWritingMembership || membership.state == .tracked)
                .accessibilityIdentifier("candidateMembershipTrack-\(membership.symbol)")

                Button {
                    Task { await updateMembership(membership, state: .paused) }
                } label: {
                    Label("暂停", systemImage: "pause.circle")
                }
                .buttonStyle(.bordered)
                .disabled(isWritingMembership || membership.state == .paused)
                .accessibilityIdentifier("candidateMembershipPause-\(membership.symbol)")

                Button {
                    Task { await updateMembership(membership, state: .archived) }
                } label: {
                    Label("归档", systemImage: "archivebox")
                }
                .buttonStyle(.bordered)
                .disabled(isWritingMembership || membership.state == .archived)
                .accessibilityIdentifier("candidateMembershipArchive-\(membership.symbol)")

                Button {
                    Task { await openMobileWorkspace(for: membership) }
                } label: {
                    Label("打开候选详情", systemImage: "rectangle.stack")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isLoadingMobileWorkspace)
                .accessibilityIdentifier("assistMobileWorkspaceOpen-\(membership.symbol)")
            }
            .accessibilityIdentifier("candidateMembershipStateActions-\(membership.symbol)")

            InfoBlock(title: "成员标识 / 版本", value: "\(membership.id) / \(membership.version)", valueIdentifier: "candidateMembershipVersion-\(membership.symbol)")
            InfoBlock(title: "更新时间", value: membership.updatedAt, valueIdentifier: "candidateMembershipUpdatedAt-\(membership.symbol)")
            InfoBlock(title: "归档时间", value: membership.archivedAt ?? "未归档", valueIdentifier: "candidateMembershipArchivedAt-\(membership.symbol)")
            InfoBlock(title: "研究", value: candidateMembershipResearchText(membership), valueIdentifier: "candidateMembershipResearch-\(membership.symbol)")
            InfoBlock(title: "报价", value: candidateMembershipQuoteText(membership.quote), valueIdentifier: "candidateMembershipQuote-\(membership.symbol)")
            InfoBlock(title: "安全边界", value: candidateMembershipSafetyText(membership.safety), valueIdentifier: "candidateMembershipSafety-\(membership.symbol)")

            decisionBriefCandidateActions(membership)

            valuationQuantCandidateAction(membership)

            annualPortfolioLabCandidateAction(membership)

            Button {
                selectMembershipForAction(membership, layer: .evidence)
                selectedEvidenceWorkspace = .facts
                Task { await loadCandidateDecisionIntake(for: membership) }
            } label: {
                Label(isLoadingDecisionIntake ? "读取中" : "读取决策准备", systemImage: "doc.text.magnifyingglass")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoadingDecisionIntake)
            .accessibilityIdentifier("candidateDecisionIntakeLoad-\(membership.symbol)")

            Button {
                selectMembershipForAction(membership, layer: .decision, expandResult: true)
                Task { await loadAssistAdvisoryScope(for: membership) }
            } label: {
                Label(isLoadingAdvisoryScope ? "读取中" : "查看辅助范围", systemImage: "list.bullet.clipboard")
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingAdvisoryScope)
            .accessibilityIdentifier("assistAdvisoryScopeLoad-\(membership.symbol)")

            Button {
                selectMembershipForAction(membership, layer: .decision, expandResult: true)
                Task { await loadAssistHumanReviewWorkspace(for: membership) }
            } label: {
                Label(isLoadingHumanReviewWorkspace ? "读取中" : "打开人工复核", systemImage: "person.text.rectangle")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoadingHumanReviewWorkspace)
            .accessibilityIdentifier("assistHumanReviewWorkspaceLoad-\(membership.symbol)")

            Button {
                selectMembershipForAction(membership, layer: .review, expandResult: true)
                selectedReviewWorkspace = .followUp
                Task { await loadAssistReviewFollowUpWorkflow(for: membership) }
            } label: {
                Label(isLoadingReviewFollowUpWorkflow ? "读取中" : "打开复核后续", systemImage: "square.and.pencil")
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingReviewFollowUpWorkflow)
            .accessibilityIdentifier("assistReviewFollowUpWorkflowLoad-\(membership.symbol)")

            Button {
                selectMembershipForAction(membership, layer: .review, expandResult: true)
                selectedReviewWorkspace = .followUp
                Task { await loadAssistDecisionNoteWorkflow(for: membership) }
            } label: {
                Label(isLoadingDecisionNoteWorkflow ? "读取中" : "打开决定记录", systemImage: "note.text")
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingDecisionNoteWorkflow)
            .accessibilityIdentifier("assistDecisionNoteWorkflowLoad-\(membership.symbol)")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .id(candidateMembershipAnchor(membership.symbol))
    }

    /// Display order for the existing membership list: lifecycle group first,
    /// then the device-local priority, and equal priorities keep server order.
    var prioritizedMemberships: [CandidateMembershipData] {
        CandidateResearchPriorityPreferences.sortedForDisplay(
            candidateMemberships.memberships,
            raw: candidateResearchPriorityRaw
        )
    }

    func candidateResearchPriorityBinding(for membership: CandidateMembershipData) -> Binding<CandidateResearchPriority> {
        Binding(
            get: {
                CandidateResearchPriorityPreferences.priority(
                    actorId: membership.actorId,
                    symbol: membership.symbol,
                    raw: candidateResearchPriorityRaw
                )
            },
            set: { priority in
                candidateResearchPriorityRaw = CandidateResearchPriorityPreferences.setting(
                    priority,
                    actorId: membership.actorId,
                    symbol: membership.symbol,
                    raw: candidateResearchPriorityRaw
                )
            }
        )
    }

}

private extension CandidateOverviewStatus {
    var researchLabel: String {
        switch self {
        case .available: "已更新"
        case .empty: "暂无候选"
        case .unavailable: "暂不可用"
        }
    }
}

private extension CandidateOverviewQuoteStatus {
    var researchLabel: String {
        switch self {
        case .fresh: "当前行情"
        case .stale: "非实时行情"
        case .unavailable: "行情暂不可用"
        }
    }
}

private extension CandidateMembershipEnvelopeStatus {
    var researchLabel: String {
        switch self {
        case .available: "已更新"
        case .empty: "暂无记录"
        case .unavailable: "暂不可用"
        }
    }
}

private extension CandidateMembershipState {
    var researchLabel: String {
        switch self {
        case .tracked: "跟踪中"
        case .paused: "已暂停"
        case .archived: "已归档"
        }
    }
}

private extension CandidateResearchPriority {
    var researchPriorityLabel: String {
        switch self {
        case .priority: "优先研究"
        case .normal: "正常"
        case .later: "稍后"
        }
    }
}
