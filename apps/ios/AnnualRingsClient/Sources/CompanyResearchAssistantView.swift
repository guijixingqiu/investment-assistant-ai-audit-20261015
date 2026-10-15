import SwiftUI

/// Ordinary questions reuse the public-source brief endpoint; deep research remains explicit.
struct CompanyResearchAssistantView: View {
    let symbol: String
    @Binding var selectedTab: AnnualRingsTab
    @Binding var selectedDecisionLayer: DailyDecisionRingLayer
    let clearPendingResearchNavigation: () -> Void
    let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    let openReportRevision: (TodayReportRevisionNotice) -> Void
    let closeOuterAssistant: () -> Void
    @ObservedObject private var store = OwnerClientStore.shared
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var membership: CandidateMembershipData?
    @State private var brief: PersonalBrief?
    @State private var question = ""
    @State private var answers: [PersonalAnswer] = []
    @State private var message: String?
    @State private var loading = false
    @State private var asking = false
    @State private var deepResearch = false
    @State private var reportAssistant = false
    @State private var closeForResearchNavigation = false
    @State private var requestRevision = UUID()

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("\(membership?.research.name ?? symbol) · \(symbol)").font(.headline)
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            focused = false
                            reportAssistant = true
                        } label: {
                            Label("追问研究报告", systemImage: "text.bubble.fill")
                        }
                        .buttonStyle(.bordered)
                        .disabled(asking || loading)
                        .accessibilityIdentifier("companyAssistantOpenReportAssistant")
                        Text("基于当前版本研究报告追问；若没有可追问的报告，可从该页面打开研究工作区。普通公司资料问答仍在本页。")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    if loading { ProgressView("正在读取公开公司资料…") }
                    if let brief {
                        DisclosureGroup("已读事实与来源（\(brief.sources.count)）") {
                            Text(brief.summary).font(.subheadline)
                            ForEach(brief.sources) { source in
                                Text("\(source.id) · \(source.title) · 第 \(source.pageNumber) 页").font(.caption)
                            }
                        }
                        if answers.isEmpty {
                            Text("围绕这家公司的已读资料提问。数值事实见上方，助手解释关系、反证和仍待核实之处。")
                                .foregroundStyle(Theme.textSecondary)
                            Button("经营现金流与利润为什么可能不同？") { question = "经营现金流与利润为什么可能不同？请依据当前已读资料解释，区分事实、可能原因和仍待核实之处。" }
                                .disabled(asking).accessibilityIdentifier("companyAssistantSuggestion")
                        }
                    }
                    ForEach(answers) { answer in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(answer.question).font(.headline)
                            Text("AI 解释 · 仍需结合原文核实").font(.caption).foregroundStyle(Theme.textSecondary)
                            ForEach(answer.sections) { section in
                                Text(section.text).textSelection(.enabled)
                                Text("来源：\(section.sourceIds.joined(separator: "、"))")
                                    .font(.caption).foregroundStyle(Theme.textSecondary)
                            }
                            ForEach(answer.nextChecks, id: \.self) { Text("待核实：\($0)").font(.footnote) }
                        }.padding(16).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 12))
                            .id(answer.id).accessibilityIdentifier("companyAssistantAnswer")
                    }
                    if let message { Text(message).foregroundStyle(Theme.amber).accessibilityIdentifier("companyAssistantIssue") }
                    if brief == nil && !loading { Button("重新读取资料") { Task { await load() } } }
                    if membership != nil {
                        Button("需要补读原文或深入查证？") { deepResearch = true }.disabled(asking)
                    }
                }.padding(20)
            }
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("向研究助手提问…", text: $question, axis: .vertical)
                        .lineLimit(1...5).focused($focused).disabled(asking)
                        .accessibilityIdentifier("globalAssistantQuestion")
                    HStack {
                        Text("\(question.utf16.count)/1000").font(.caption).foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Button(asking ? "正在回答…" : "发送问题") { Task { await ask() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(asking || loading || brief?.status != "available" || question.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count < 3 || question.utf16.count > 1000 || AppEnvironment.writeAuthToken() == nil)
                            .accessibilityIdentifier("globalAssistantAsk")
                    }
                    if AppEnvironment.writeAuthToken() == nil { Text("缺少问答授权，请检查连接与授权设置。").font(.caption) }
                }.padding(16).background(Theme.bgPrimary)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.bgPrimary).navigationTitle("研究助手").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(asking) }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { focused = false } }
            }
            .onChange(of: answers.count) { _, _ in
                if let answer = answers.last { withAnimation { proxy.scrollTo(answer.id, anchor: .top) } }
            }
            }
        }
        .task(id: "\(symbol):\(store.authorizationRevision)") { await load() }
        .onDisappear { requestRevision = UUID() }
        .sheet(isPresented: $deepResearch, onDismiss: {
            if store.hasPersonalFormalDismissalPending { dismiss() }
        }) {
            if let membership {
                PersonalInvestigationView(selection: PersonalInvestigationSelection(
                    membershipId: membership.id, membershipVersion: membership.version,
                    symbol: membership.symbol, mode: "earnings_quality", question: question,
                    startAnalysis: false, resumeExisting: false))
            }
        }
        .sheet(isPresented: $reportAssistant, onDismiss: {
            if closeForResearchNavigation {
                closeForResearchNavigation = false
                closeOuterAssistant()
            }
        }) {
            GlobalAssistantSheet(
                symbolInput: .constant(symbol),
                selectedTab: $selectedTab,
                selectedDecisionLayer: $selectedDecisionLayer,
                clearPendingResearchNavigation: {
                    closeForResearchNavigation = true
                    clearPendingResearchNavigation()
                },
                openResearchCandidate: openResearchCandidate,
                openReportRevision: { notice in
                    closeForResearchNavigation = true
                    openReportRevision(notice)
                }
            )
        }
    }

    private func load() async {
        let revision = UUID(); requestRevision = revision
        membership = nil; brief = nil; answers = []; loading = true; asking = false; message = nil
        defer { if requestRevision == revision { loading = false } }
        let auth = AppEnvironment.researchAuthorizationContext()
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName)
        let result = await client.fetchCandidateMemberships(includeArchived: false)
        guard requestRevision == revision, !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext() else { return }
        let matches = result.memberships.filter { $0.symbol == symbol && $0.state != .archived }
        guard result.status == .available, matches.count == 1, let current = matches.first else {
            message = result.status == .available ? "请先搜索这家公司并加入研究自选，再向助手提问。" : "公司研究身份暂时读取失败，请检查连接后重试。"
            return
        }
        do {
            let value = try await PersonalBriefClient.load(current)
            guard requestRevision == revision, !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext() else { return }
            membership = current; brief = value
            if value.status != "available" { message = "尚未取得可用于问答的公开资料，请先到公司资料页补充。" }
        } catch { if requestRevision == revision && auth == AppEnvironment.researchAuthorizationContext() { message = "公开资料读取失败，请重试。" } }
    }

    private func ask() async {
        guard !asking, let membership, let brief else { return }
        let submitted = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (3...1000).contains(submitted.utf16.count) else { return }
        let revision = UUID(); requestRevision = revision
        asking = true; message = nil; focused = false
        defer { if requestRevision == revision { asking = false } }
        let auth = AppEnvironment.researchAuthorizationContext()
        do {
            let current = try await PersonalBriefClient.load(membership)
            guard requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
            guard current.fingerprint == brief.fingerprint else {
                self.brief = current; answers = []; message = "资料已更新，旧对话已清除。请核对后重新发送。"; return
            }
            let answer = try await PersonalBriefClient.ask(membership, brief: current, question: submitted, priorAnswers: answers)
            guard requestRevision == revision, !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext(), self.membership?.id == membership.id, self.membership?.version == membership.version, answer.question == submitted else { return }
            answers.append(answer); question = ""
#if DEBUG
            if let raw = try? JSONEncoder().encode(answer) { UserDefaults.standard.set(raw, forKey: "company-assistant-last-response") }
#endif
        } catch { if requestRevision == revision && auth == AppEnvironment.researchAuthorizationContext() { message = error.localizedDescription } }
    }
}
