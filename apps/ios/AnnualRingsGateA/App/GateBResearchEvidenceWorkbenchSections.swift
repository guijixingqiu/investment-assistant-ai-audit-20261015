import SwiftUI

enum DailyEvidenceWorkspace: String, CaseIterable, Identifiable {
    case brief
    case valuation
    case research
    case documents
    case frozen
    case facts

    var id: String { rawValue }

    var title: String {
        switch self {
        case .brief: "报告与行动"
        case .valuation: "估值量化"
        case .research: "研究维护"
        case .documents: "PDF 原文"
        case .frozen: "证据身份"
        case .facts: "事实来源"
        }
    }

    var detail: String {
        switch self {
        case .brief: "结论 · 条件 · 显式决定"
        case .valuation: "隐含预期 · 历史量化"
        case .research: "论点 · 变量 · 新证据"
        case .documents: "导入 · 核对 · 同页打开"
        case .frozen: "引用 · 截止时间 · 冻结历史"
        case .facts: "档案 · 上下文 · 历史"
        }
    }

    var systemImage: String {
        switch self {
        case .brief: "doc.text"
        case .valuation: "function"
        case .research: "square.and.pencil"
        case .documents: "doc.richtext"
        case .frozen: "snowflake"
        case .facts: "checkmark.shield"
        }
    }
}

extension GateBResearchScreen {
    @ViewBuilder
    func evidenceLayerContent() -> some View {
        if selectedMembership == nil {
            AnyView(selectedSymbolSection())
        }

        if let malformedInputMessage {
            AnyView(
                Text(malformedInputMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("malformedSymbolMessage")
            )
        }

        AnyView(dailyEvidenceWorkspacePicker())
        selectedEvidenceWorkspaceContent()
    }

    private func selectedEvidenceWorkspaceContent() -> AnyView {
        evidenceWorkspaceContent(selectedEvidenceWorkspace)
    }

    func evidenceWorkspaceContent(_ workspace: DailyEvidenceWorkspace) -> AnyView {
        switch workspace {
        case .brief:
            AnyView(
                VStack(alignment: .leading, spacing: 12) {
#if OWNER_CLIENT
                    if clientDestination == .manualResearch {
                        manualOrdinaryDecisionSection()
                        let sourceCount = ownerStore.personalFormalHandoff?.manualSources.count ?? 0
                        DisclosureGroup("已选来源与证据维护 · \(sourceCount) 条") {
                            manualResearchHandoffSection()
                            annualDecisionBriefResearchEditorSection()
                        }
                        DisclosureGroup("相关报告与研究记录") {
                            manualReviewLearningResearchDraftSection()
                            todayReportConfirmationCard()
                            researchEvidenceQuestionSection()
                            researchQuestionTaskOverview()
                            if let quant = annualDecisionBriefModel.data?.quantEvidence,
                               quant.status == "available" {
                                annualDecisionBriefQuant(quant)
                            }
                            annualDecisionBriefSection()
                        }
                    } else {
                        manualReviewLearningResearchDraftSection()
                        todayReportConfirmationCard()
                        twoLayerReportSection()
                        DisclosureGroup("向助手核查报告") { researchEvidenceQuestionSection() }
                        DisclosureGroup("相关研究问题与任务") { researchQuestionTaskOverview() }
                        if let quant = annualDecisionBriefModel.data?.quantEvidence,
                           quant.status == "available" {
                            DisclosureGroup("历史量化依据") { annualDecisionBriefQuant(quant) }
                        }
                        DisclosureGroup("报告准备与诊断", isExpanded: $isAnnualDecisionBriefExpanded) {
                            annualDecisionBriefResearchEditorSection()
                            annualDecisionBriefSection().padding(.top, 8)
                        }
                    }
#else
                    researchQuestionTaskOverview()
                    todayReportConfirmationCard()
                    twoLayerReportSection()
                    researchEvidenceQuestionSection()
                    if let quant = annualDecisionBriefModel.data?.quantEvidence,
                       quant.status == "available" {
                        annualDecisionBriefQuant(quant)
                    }
                    DisclosureGroup("报告准备与诊断", isExpanded: $isAnnualDecisionBriefExpanded) {
                        annualDecisionBriefResearchEditorSection()
                        annualDecisionBriefSection().padding(.top, 8)
                    }
#endif
                }
            )
        case .valuation:
            AnyView(
                VStack(alignment: .leading, spacing: 12) {
                    researchValuationScenarioSection()
#if OWNER_CLIENT
                    ClientCard(title: "技术与历史量化", icon: "chart.xyaxis.line", tone: Theme.blue) {
                        DisclosureGroup("查看技术状态与历史证据") { annualValuationQuantSection() }
                    }
#else
                    annualValuationQuantSection()
#endif
                }
            )
        case .research:
            // 深度研究工作区直接承载既有任务管线：准备/发起、运行状态、重试、吸收与取消。
            AnyView(
                VStack(alignment: .leading, spacing: 12) {
                    twoLayerReportSection()
                }
            )
        case .documents:
            AnyView(researchDocumentsWorkspace())
        case .frozen:
            AnyView(frozenResearchTechnicalWorkspace())
        case .facts:
            AnyView(
                completeEvidenceFactsWorkspace()
                    .task(id: researchDocumentTaskIdentity) {
                        await loadFundamentalsWorkspaceForCurrentIdentity()
                    }
            )
        }
    }

    private func dailyEvidenceWorkspacePicker() -> some View {
        dailyWorkspacePicker(
            DailyEvidenceWorkspace.allCases.map {
                DailyWorkspaceOption(id: $0.rawValue, title: $0.title, detail: $0.detail, systemImage: $0.systemImage)
            },
            selectedID: selectedEvidenceWorkspace.rawValue,
            tint: DailyDecisionRingLayer.evidence.tint,
            accessibilityPrefix: "dailyEvidenceWorkspace"
        ) { rawValue in
            guard let workspace = DailyEvidenceWorkspace(rawValue: rawValue) else { return }
            selectedEvidenceWorkspace = workspace
        }
    }

    @ViewBuilder
    private func todayReportConfirmationCard() -> some View {
        if let report = researchInvestmentBriefCurrentReport,
           let pack = currentTwoLayerReportPack,
           let advice = report.payload.adviceLayer,
           let reservation = todayReportConfirmationReservation(for: report),
           researchContextWorkspace.completeness?.data?.canFormalize == true {
            VStack(alignment: .leading, spacing: 8) {
                Label("待你确认当前报告", systemImage: "checkmark.seal")
                    .font(.headline)
                Text(advice.conclusion)
                    .font(.callout.weight(.semibold))
                Text("report #\(report.id) v\(report.version) · pack #\(pack.id) v\(pack.version) · cutoff \(report.payload.cutoffAt)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Button("确认报告并返回今日") {
                    pendingTodayReportConfirmationReservation = reservation
                    Task { await decideTwoLayerReport(report, decision: "confirmed") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.isStaleRead)
                .accessibilityIdentifier("todayReportConfirmButton")
            }
            .padding(12)
            .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
            .id("\(twoLayerReportFormalDecisionAnchor(report.id)):confirmation")
        }
    }

    func todayReportConfirmationReservation(
        for report: TwoLayerReportData
    ) -> TodayReportConfirmationReservation? {
        guard let membership = selectedMembership,
              let pack = currentTwoLayerReportPack else { return nil }
        return todayResearch.items.lazy.compactMap { item in
            TodayReportConfirmationReservation(
                item: item,
                membership: membership,
                authorizationRevision: viewModel.authorizationRevision
            )
        }.first { $0.matches(report: report, evidencePack: pack, membership: membership) }
    }

    @ViewBuilder
    private func completeEvidenceFactsWorkspace() -> some View {
        candidateDecisionIntakeSection()
        researchContextCompletionSection()
        researchFundamentalsSection()

        if let payload = envelope.data {
            profileSection(payload.profile)
            evidenceSection(payload.evidence)
            suggestionSection(payload.suggestions)
        } else {
            Text(envelope.message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchEmptyMessage")
        }

        if let decisionContext,
           decisionContext.requestedSymbol == parsedSymbol?.canonical {
            decisionContextSection(decisionContext)
        } else if let decisionContextMessage {
            Text(decisionContextMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("decisionContextMessage")
        }

        DisclosureGroup {
            if let pinganSnapshot {
                pinganSnapshotSection(pinganSnapshot)
                    .padding(.top, 10)
            } else if let pinganSnapshotMessage {
                Text(pinganSnapshotMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                    .accessibilityIdentifier("pinganSnapshotMessage")
            }
        } label: {
            Label("历史研究快照", systemImage: "clock.arrow.circlepath")
                .font(.headline)
                .accessibilityIdentifier("historicalPinganDisclosure")
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

        Button {
            Task {
                await loadProfile()
                if let membership = selectedMembership {
                    await loadResearchContext(for: membership)
                    await loadAnnualDecisionBrief(for: membership)
                }
            }
        } label: {
            Label((isLoading || isLoadingDecisionReviewHistory) ? "刷新中" : "刷新证据", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.borderedProminent)
        .disabled(isLoading || isLoadingDecisionReviewHistory || isWritingAnnualDecisionBriefResearch || submissionState.isInFlight)
        .accessibilityIdentifier("refreshResearchButton")
    }

    /// 基本面工作区自行读取当前标的的结构化数值事实：
    /// 若 PDF 工作区已按同一身份 fresh read 过，则复用其物料列表；否则自取一次，不要求先访问 PDF。
    @MainActor
    func loadFundamentalsWorkspaceForCurrentIdentity() async {
        guard selectedMembership != nil else { return }
        if researchDocumentWorkspace.identity == researchDocumentTaskIdentity {
            await loadResearchFundamentals(refreshDocuments: false)
        } else {
            await loadResearchFundamentals(refreshDocuments: true)
        }
    }
}
