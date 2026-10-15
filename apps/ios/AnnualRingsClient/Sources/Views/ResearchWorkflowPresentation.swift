import SwiftUI

extension GateBResearchScreen {
    func configureClientDestination() {
        guard clientDestination != .workflow else { return }
        switch clientDestination {
        case .decision: selectedDecisionLayer = .decision
        case .portfolio: selectedDecisionLayer = .portfolio
        case .review: selectedDecisionLayer = .review; selectedReviewWorkspace = .timeline
        case .manage:
            selectedDecisionLayer = .candidate
            selectedCandidateWorkspace = .lifecycle
            if selectedMembership == nil && membershipInput.isEmpty { membershipInput = parsedSymbol?.canonical ?? "" }
        default: selectedDecisionLayer = .evidence
        }
        switch clientDestination {
        case .valuation, .quant: selectedEvidenceWorkspace = .valuation
        case .materials: selectedEvidenceWorkspace = .documents
        case .facts: selectedEvidenceWorkspace = .facts
        case .tasks: selectedEvidenceWorkspace = .research
        case .manualResearch: selectedEvidenceWorkspace = .brief
        default: selectedEvidenceWorkspace = .brief
        }
        clientDestinationReady = true
    }
    @ViewBuilder func clientFocusedResearchContent(layout: DailyWorkbenchLayoutMetrics) -> some View {
        ClientCard(title: selectedMembership?.research.name ?? parsedSymbol?.canonical ?? "研究", icon: "doc.text.magnifyingglass") {
            HStack {
                Text(parsedSymbol?.canonical ?? "请选择标的").font(.system(size: 11)).monospaced()
                Spacer()
                if isLoading { ProgressView().controlSize(.small) }
                else { Text(clientDestinationReady ? "本轮读取完成" : "正在读取研究资料")
                    .font(.system(size: 11)).foregroundStyle(Theme.purple)
                    .accessibilityIdentifier("clientResearchLoadState") }
            }
        }.id("dailyWorkbenchTop")
        if selectedMembership == nil {
            if isLoading { ClientNote(text: "正在核对研究身份与资料…") }
            else { selectedSymbolSection() }
        }
        if clientDestination == .quant {
            annualValuationQuantSection()
        } else if clientDestination == .review || clientDestination == .decision || clientDestination == .portfolio {
            ClientCard(title: clientDestination.title, icon: clientDestination == .portfolio ? "chart.pie" : "clock.arrow.circlepath", tone: Theme.amber) {
                researchWorkspaceContent(layout: layout)
            }
        } else if selectedDecisionLayer != .evidence {
            ClientCard(title: selectedDecisionLayer.title, icon: "square.and.pencil", tone: Theme.amber) {
                dailyDecisionLayerContent()
            }
        } else {
            if selectedEvidenceWorkspace == .research && clientDestination != .manualResearch {
                ClientCard(title: "研究问题与进度", icon: "square.and.pencil", tone: Theme.blue) {
                    DisclosureGroup("查看问题与任务") { researchQuestionTaskOverview() }
                    DisclosureGroup("使用已有材料开展有限研究") { limitedResearchEntry() }
                        .task(id: "\(selectedMembership?.id ?? "none"):\(selectedMembership?.version ?? 0):\(viewModel.authorizationRevision)") {
                            guard let membership = selectedMembership, membership.state != .archived else { return }
                            let workspace = frozenResearchEvidenceWorkspace.envelope
                            if workspace?.membershipId != membership.id
                                || workspace?.requestedActorId != membership.actorId
                                || workspace?.data?.target.membershipVersion != membership.version
                                || workspace?.data?.target.symbol != membership.symbol {
                                await loadFrozenResearchEvidence()
                            }
                        }
                }
            }
            if clientDestination == .tasks,
               ownerStore.personalFormalHandoff != nil,
               (currentTwoLayerReportPack?.currentness.status != "current"
                || ownerStore.personalFormalHandoff?.providerSources.isEmpty == false) {
                ClientCard(title: "准备研究资料", icon: "doc.text.magnifyingglass", tone: Theme.green) {
                    Text("问题已保留。请先核对原文与材料；冻结证据须由你明确操作。")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    if ownerStore.personalFormalHandoff?.providerSources.isEmpty == false {
                        Text("所选 OpenD 捕获可作为第三方未核实材料保存；不必先上传 PDF。保存后明确使用已有材料准备有限研究。")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    DisclosureGroup("查看现有资料与准备操作") {
                        evidenceWorkspaceContent(.documents)
                        limitedResearchEntry()
                    }
                }
            }
            if clientDestination == .tasks { clientResearchTaskWorkspace() }
            else { evidenceWorkspaceContent(selectedEvidenceWorkspace) }
            if clientDestination == .materials, selectedEvidenceWorkspace == .documents {
                ClientCard(title: "依据与记录", icon: "checkmark.shield", tone: Theme.green) {
                    DisclosureGroup("摘要材料与证据版本") { evidenceWorkspaceContent(.frozen) }
                }
            }
        }
    }
}
