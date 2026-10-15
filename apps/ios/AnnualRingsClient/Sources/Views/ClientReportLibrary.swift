import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder func clientResearchTaskWorkspace() -> some View {
        ClientCard(title: "本次研究任务", icon: "sparkles", tone: Theme.blue) {
            if let handoff = ownerStore.personalFormalHandoff,
               handoff.symbol == parsedSymbol?.canonical {
                Text("待准备的问题：\(handoff.question)")
                    .font(.system(size: 13)).textSelection(.enabled)
                    .accessibilityIdentifier("pendingFormalResearchQuestion")
                if let personalFormalMessage { ClientNote(text: personalFormalMessage, tone: Theme.amber) }
                if twoLayerReportWorkspace.draft != nil,
                   twoLayerReportWorkspace.pendingSynthesisTask == nil {
                    Button("用当前问题替换现有草稿") {
                        Task { await reconcilePersonalFormalHandoff(replacingDraft: true) }
                    }
                    .disabled(personalFormalVerificationId != nil || !personalFormalTaskReadConfirmed)
                    .accessibilityIdentifier("replaceFormalResearchDraft")
                }
                if twoLayerReportWorkspace.pendingSynthesisTask != nil {
                    Button("放弃本次问题交接，查看现有任务") { discardPersonalFormalHandoff() }
                }
            } else if let personalFormalMessage {
                ClientNote(text: personalFormalMessage, tone: Theme.amber)
            }
            if let report = currentDeepResearchReport {
                NavigationLink {
                    ClientReadingPage(title: "报告 v\(report.version)") {
                        twoLayerReportCard(report, previousReport: selectedMembershipResearchReports.previousReport(before: report))
                    }
                } label: {
                    ClientLinkLabel(title: "打开当前报告 v\(report.version)",
                        subtitle: report.isFormalizable ? "已生成，等待审阅" : "已生成，仍有证据缺口",
                        icon: "doc.text", tone: Theme.purple)
                }.accessibilityIdentifier("clientTaskCurrentReport")
            }
            if twoLayerReportWorkspace.pendingSynthesisTask != nil || twoLayerReportWorkspace.failureMessage != nil {
                deepResearchJourneyStatus(currentReport: currentDeepResearchReport)
            }
            if (twoLayerReportWorkspace.draft == nil && !twoLayerReportWorkspace.hasActiveSynthesisTask) || twoLayerReportWorkspace.pendingSynthesisTask?.status == "failed" {
                Text("按当前冻结材料准备问题和发送范围，再明确发起。")
                    .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                Button(twoLayerReportWorkspace.pendingSynthesisTask?.status == "failed" ? "调整问题或预算，重新准备" : "准备研究草稿") { createTwoLayerDraft() }
                    .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.isStaleRead
                              || currentTwoLayerReportPack?.currentness.status != "current")
                    .accessibilityIdentifier("clientPrepareResearch")
            }
            if twoLayerReportWorkspace.draft != nil && twoLayerReportWorkspace.pendingSynthesisTask == nil {
                twoLayerEditableDraftSection()
            }
            Text(twoLayerReportWorkspace.message).font(.system(size: 12))
            Button("重新读取任务与报告") { Task { await loadTwoLayerReports() } }
                .disabled(twoLayerReportWorkspace.isBusy)
            NavigationLink {
                ClientReadingPage(title: "AI 使用设置") { cloudAiPolicyControls() }
            } label: { ClientLinkLabel(title: "AI 使用设置", icon: "sparkles", tone: Theme.purple) }
        }
        .task(id: deepResearchForegroundRefreshIdentity) { await refreshDeepResearchTaskWhileVisible() }
    }

    @ViewBuilder func clientReportLibrary() -> some View {
        let reports = selectedMembershipResearchReports.sorted { $0.version > $1.version }
        VStack(alignment: .leading, spacing: 16) {
            if twoLayerReportWorkspace.isStaleRead {
                ClientNote(text: "当前显示上次读取的报告；请刷新核对最新版本后再操作。", tone: Theme.amber)
            }
            ClientCard(title: "研究报告", icon: "doc.text.magnifyingglass", tone: Theme.purple) {
                if reports.isEmpty && (isLoading || twoLayerReportWorkspace.isBusy || dailyRefreshGate.phase == .refreshing || dailyRefreshGate.phase == .validatingRestoredNavigation) {
                    ProgressView("正在读取报告与历史版本…")
                } else if reports.isEmpty {
                    Text(twoLayerReportWorkspace.message)
                        .accessibilityIdentifier("twoLayerReportMessage")
                    Text("暂无可阅读的报告。可先核对资料，再准备研究。")
                        .font(.system(size: 12)).foregroundStyle(Theme.textTertiary)
                }
                ForEach(reports) { report in
                    NavigationLink {
                        ClientReadingPage(title: "报告 v\(report.version)") {
                            twoLayerReportCard(report, previousReport: reports.previousReport(before: report))
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 9) {
                            ClientLinkLabel(title: "\(report.isCurrentExact ? "当前研究" : "历史研究") · v\(report.version)",
                                subtitle: "证据截止 \(report.payload.cutoffAt.prefix(10))", icon: "doc.text", tone: Theme.purple)
                            if let advice = report.payload.adviceLayer {
                                Text(advice.conclusion).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                                    .lineLimit(3).multilineTextAlignment(.leading)
                            }
                            Text(report.isFormalizable ? "打开正文与审阅" : "存在待核实项 · 打开核对")
                                .font(.system(size: 11)).foregroundStyle(Theme.purple)
                            if report.id != reports.last?.id { Divider().padding(.top, 4) }
                        }.padding(.vertical, 3)
                    }.buttonStyle(.plain).accessibilityIdentifier("clientReadReport-\(report.id)")
                }
            }
            if twoLayerReportWorkspace.pendingSynthesisTask != nil || twoLayerReportWorkspace.failureMessage != nil {
                ClientCard(title: "任务进度", icon: "clock", tone: Theme.blue) {
                    deepResearchJourneyStatus(currentReport: currentDeepResearchReport)
                }
            }
            if reports.count > 1 {
                ClientCard(title: "版本对照", icon: "doc.on.doc", tone: Theme.purple) {
                    reportVersionComparison(reports)
                }
            }
            if let deletions = twoLayerReportWorkspace.envelope?.data?.reportDeletions, !deletions.isEmpty {
                DisclosureGroup("已删除报告记录（\(deletions.count)）") {
                    ForEach(deletions) { deletion in
                        Text("报告 #\(deletion.reportId) v\(deletion.reportVersion) · \(deletion.deletedAt)")
                            .font(.system(size: 11))
                    }
                }
            }
            ClientCard(title: "继续研究", icon: "square.and.pencil", tone: Theme.blue) {
                NavigationLink {
                    ClientReadingPage(title: "准备研究") {
                        ClientCard(title: "本次研究", icon: "square.and.pencil", tone: Theme.blue) {
                            if twoLayerReportWorkspace.draft == nil {
                                Text("核对当前冻结资料，再准备本次研究的问题与范围。")
                                Button("准备研究草稿") { createTwoLayerDraft() }
                                    .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.hasActiveSynthesisTask
                                        || twoLayerReportWorkspace.isStaleRead || currentTwoLayerReportPack?.currentness.status != "current")
                            }
                            if twoLayerReportWorkspace.draft != nil, twoLayerReportWorkspace.pendingSynthesisTask == nil,
                               !twoLayerReportWorkspace.isStaleRead { twoLayerEditableDraftSection() }
                            Text(twoLayerReportWorkspace.message).font(.system(size: 12))
                        }
                    }
                } label: { ClientLinkLabel(title: "准备或继续研究任务", subtitle: "核对资料、问题与范围后明确发起", icon: "square.and.pencil", tone: Theme.blue) }
                NavigationLink {
                    ClientReadingPage(title: "AI 使用设置") {
                        ClientCard(title: "授权与提供方", icon: "sparkles", tone: Theme.purple) { cloudAiPolicyControls() }
                    }
                } label: { ClientLinkLabel(title: "AI 使用设置", icon: "sparkles", tone: Theme.purple) }
                Button { Task { await loadTwoLayerReports() } }
                    label: { ClientLinkLabel(title: "刷新报告与任务状态", icon: "arrow.clockwise", tone: Theme.blue) }
                    .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.hasActiveSynthesisTask)
            }.buttonStyle(.plain)
        }
        .font(.system(size: 13)).tint(Theme.blue).controlSize(.small)
        .disabled(isRefreshingResearchTechnicalEvidence)
        .task(id: deepResearchForegroundRefreshIdentity) { await refreshDeepResearchTaskWhileVisible() }
    }
}
