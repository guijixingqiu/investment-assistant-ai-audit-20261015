import SwiftUI

struct AntigravityResearchView: View {
    @ObservedObject var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    @Binding var selectedCandidateIndex: Int
    @Binding var selectedRingTab: Int // 0: 核心论点, 1: 双层研报, 2: 量化估值, 3: 证据库, 4: 复盘历史
    
    @State private var workspaceTab: CompanyWorkspaceTab = .overview
    @State private var showAIAssistant: Bool = false
    @State private var deepResearch: PersonalInvestigationSelection?
    @State private var joinSubmission = CandidateMembershipSubmissionState()
    @State private var joiningCompany = false
    @State private var joinedMember: CandidateMembershipData?
    @State private var joinMessage: String?
    @State private var joinRevision = UUID()
    @State private var showFormalResearch: Bool = false
    @State private var selectedReportId: String?
    @State private var selectedEvidenceId: String?
    @State private var showEvidenceSheet: Bool = false
    @State private var storedSourceSnapshots: [ResearchSourceSnapshotData] = []
    @State private var storedSourceIssue: String?
    @State private var storedSourceRevision = UUID()
    
    init(
        selectedCandidateIndex: Binding<Int>,
        selectedRingTab: Binding<Int>
    ) {
        self._selectedCandidateIndex = selectedCandidateIndex
        self._selectedRingTab = selectedRingTab
    }
    
    private var currentCandidate: CandidateMembership { api.currentCandidate }
    
    private var activeOrCandidateQuote: StockQuote? { api.activeQuote }
    
    private var member: CandidateMembershipData? {
        api.membershipEnvelope?.memberships.first { $0.symbol == api.currentSymbol && $0.state.rawValue == "tracked" }
    }
    var body: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                researchHeader.padding(.horizontal, 24).padding(.top, 12)
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        workspaceContent.id("\(api.currentSymbol):\(member?.version ?? 0):\(workspaceTab.rawValue)")
                    }.padding(.horizontal, 24).padding(.vertical, 12)
                }.refreshable { await api.load(tab: .research, symbol: api.currentSymbol) }
            }.background(Theme.bgPrimary.ignoresSafeArea())
                .navigationTitle("研究").navigationBarTitleDisplayMode(.large)
                .toolbar { WorkspaceTools() }
                .onAppear { focusReadiness(proxy) }
                .onChange(of: api.researchLoopFocusSymbol) { _, _ in focusReadiness(proxy) }
                .onChange(of: api.membershipEnvelope?.memberships.count) { _, _ in focusReadiness(proxy) }
                .onChange(of: api.currentSymbol) { _, _ in
                    selectedReportId = nil; workspaceTab = .overview; invalidateJoin()
                }
                .onChange(of: api.authorizationRevision) { _, _ in invalidateJoin() }
                .sheet(item: $deepResearch, onDismiss: { api.finishPersonalFormalDismissal() }) {
                    PersonalInvestigationView(selection: $0)
                }
                .sheet(isPresented: $showEvidenceSheet) {
                    AntigravityEvidenceDetailSheet(dossier: currentCandidate.currentDossier, initialFactId: selectedEvidenceId)
                }
        }
    }
    private var researchHeader: some View {
        VStack(alignment: .leading, spacing: 16) {
            Menu {
                ForEach(Array(api.candidates.enumerated()), id: \.element.symbol) { index, candidate in
                    Button("\(candidate.name) · \(candidate.symbol)") { selectedCandidateIndex = index }
                }
                Button("搜索其他公司") { actions.search() }
                Button("管理研究自选") { actions.workflow(.manage) }
            } label: {
                HStack {
                    Text(api.currentSymbol.isEmpty ? "选择一家公司" : currentCandidate.name).font(.title2.bold())
                    Image(systemName: "chevron.down").font(.footnote)
                    Spacer()
                }.foregroundStyle(Theme.textPrimary).frame(minHeight: 44)
            }
            Text("\(api.currentSymbol) · \(member == nil ? "尚未加入研究自选" : "已加入研究自选")")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
            Picker("公司内容", selection: $workspaceTab) {
                ForEach(CompanyWorkspaceTab.allCases) { tab in Text(tab.rawValue).tag(tab) }
            }.pickerStyle(.segmented).frame(minHeight: 44).accessibilityIdentifier("companyWorkspaceTabs")
        }.padding(.bottom, 8).background(Theme.bgPrimary)
    }
    @ViewBuilder private var workspaceContent: some View {
        if let member {
            switch workspaceTab {
            case .overview:
                WorkspacePrimaryButton(title: "阅读已存公司经营与估值", icon: "chart.bar.doc.horizontal") {
                    actions.workflow(.report)
                }
                .accessibilityIdentifier("companySavedBusinessReadoutEntry")
                Text("查看已存原值与期间、经营解释、PE／FCFF 假设、风险及下一问题；无需创建报告或发送 AI。")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                WorkspacePrimaryButton(title: "准备新的深度研究报告", icon: "text.book.closed") {
                    deepResearch = PersonalInvestigationSelection(membershipId: member.id, membershipVersion: member.version,
                        symbol: member.symbol, mode: "earnings_quality", question: "")
                }.accessibilityIdentifier("companyDeepResearch")
                PersonalResearchBriefSection(membership: member, presentation: .overview)
                OwnerManualJudgmentSummary(symbol: member.symbol)
                OwnerResearchProgressOverview(symbol: member.symbol)
                Divider()
                Text("报告条件下的正式判断").font(.headline)
                ThesisFormationEntryView(membership: member)
                Button { workspaceTab = .judgment } label: {
                    WorkspaceRowLabel(title: "判断与跟踪", subtitle: "查看假设、复核与历史记录", icon: "text.book.closed")
                }.buttonStyle(.plain)
            case .documents:
                CompanyDocumentsView(membership: member)
            case .analysis:
                Button {
                    actions.workflow(.report)
                } label: {
                    WorkspaceRowLabel(
                        title: "已存经营与估值摘要",
                        subtitle: "读原值、经营解释、PE／FCFF 情景与风险；无需新报告",
                        icon: "chart.bar.doc.horizontal"
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("researchAnalysisSavedBusinessReadoutEntry")
                PersonalResearchBriefSection(membership: member, presentation: .analysis)
                HStack(spacing: 12) {
                    Button("估值情景") { actions.workflow(.valuation) }
                        .accessibilityIdentifier("researchAnalysisValuationShortcut")
                    Button("量化回测与估值") { actions.workflow(.quant) }
                        .accessibilityIdentifier("researchAnalysisQuantShortcut")
                }
                .buttonStyle(.bordered)
                Divider()
                Text("进一步了解").font(.headline)
                researchSections
                DisclosureGroup("证据版本与详细记录") { casEvidenceChainSection }.font(.subheadline)
            case .judgment:
                OwnerManualJudgmentSummary(symbol: member.symbol)
                Divider()
                Text("报告条件下的正式判断").font(.headline)
                ThesisFormationEntryView(membership: member)
                if let reasoning = api.boundOperatingReasoning(symbol: member.symbol), reasoning.model.thesisBinding != nil {
                    NavigationLink("编辑判断") { ResearchUnderwritingView(initial: reasoning, editJudgment: true) }
                        .frame(minHeight: 44)
                }
                Divider()
                NavigationLink {
                    ClientPage(title: "当前假设与研究基准") {
                        CurrentBaseFormationEntryView(membership: member)
                        ResearchBaselineActivationEntryView(membership: member)
                    }
                } label: { WorkspaceRowLabel(title: "当前假设与研究基准", subtitle: "查看后再选择编辑", icon: "slider.horizontal.3") }.buttonStyle(.plain)
                NavigationLink { researchHistoryWorkspace } label: {
                    WorkspaceRowLabel(title: "复盘与历史判断", subtitle: "保留原判断及每次变更", icon: "clock")
                }.buttonStyle(.plain)
                PersonalResearchBriefSection(membership: member, presentation: .notes)
                DisclosureGroup("跟踪节点与复核准备", isExpanded: $showFormalResearch) {
                    ResearchLoopReadinessView(symbol: member.symbol, membershipId: member.id,
                        membershipVersion: member.version, membership: member,
                        reasoning: api.boundOperatingReasoning(symbol: member.symbol))
                        .id("phase14ResearchLoopReadiness")
                }.font(.subheadline)
                WorkspacePrimaryButton(title: "查看复核") { actions.workflow(.researchReview) }
            }
        } else {
            VStack(alignment: .leading, spacing: 16) {
                Text(api.loading ? "正在读取公司研究…" : "从一家感兴趣的公司开始").font(.title3.bold())
                Text(api.issues["memberships"] == nil ? "搜索并查看公司；加入研究自选后，可在这里阅读资料、分析和自己的判断。" : "研究自选暂未读取成功，请核对连接后重试。")
                    .font(.body).foregroundStyle(Theme.textSecondary)
                if SecuritySymbol.parseHongKongAlias(api.currentSymbol) != nil && !api.loading {
                    WorkspacePrimaryButton(title: joiningCompany ? "正在核对研究自选…" : joinedMember != nil ? "重新核对加入结果" : "将这家公司加入研究自选") {
                        Task { await joinCurrentCompany() }
                    }.disabled(joiningCompany || AppEnvironment.writeAuthToken() == nil)
                        .accessibilityIdentifier("companyJoinResearch")
                    if let joinMessage { Text(joinMessage).font(.footnote).foregroundStyle(Theme.amber) }
                }
                Button("搜索其他公司") { actions.search() }.frame(minHeight: 44)
                Button("管理研究自选") { actions.workflow(.manage) }.frame(minHeight: 44)
                if SecuritySymbol.parseHongKongAlias(api.currentSymbol) != nil {
                    if workspaceTab == .overview || workspaceTab == .judgment {
                        OwnerManualJudgmentSummary(symbol: api.currentSymbol)
                    }
                    if workspaceTab == .overview {
                        OwnerResearchProgressOverview(symbol: api.currentSymbol)
                    }
                }
            }
        }
    }
    private func invalidateJoin() {
        joinRevision = UUID(); joiningCompany = false; joinMessage = nil
        joinSubmission = CandidateMembershipSubmissionState(); joinedMember = nil
    }
    private func joinCurrentCompany() async {
        guard !joiningCompany, let symbol = SecuritySymbol.parseHongKongAlias(api.currentSymbol) else { return }
        let auth = AppEnvironment.researchAuthorizationContext()
        guard auth.writeToken != nil else { joinMessage = "请先核对研究写入授权。"; return }
        if joinedMember != nil {
            joiningCompany = true
            let revision = joinRevision
            await api.load(tab: .research, symbol: symbol.canonical)
            guard joinRevision == revision, auth == AppEnvironment.researchAuthorizationContext(), api.currentSymbol == symbol.canonical else { return }
            joiningCompany = false
            finishJoinReadback()
            return
        }
        let fingerprint = CandidateMembershipSubmissionFingerprint(operation: "create", membershipId: nil,
            code: symbol.code, currentVersion: nil, targetState: .tracked, restoreArchived: false)
        guard let submission = joinSubmission.begin(fingerprint: fingerprint) else { return }
        let revision = UUID(); joinRevision = revision; joiningCompany = true; joinMessage = nil
        defer { if joinRevision == revision { joiningCompany = false } }
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName,
            writeAuthToken: auth.writeToken, writeAuthHeaderName: auth.writeHeaderName)
        do {
            let result = try await client.createCandidateMembership(request: CreateCandidateMembershipRequest(
                market: symbol.market, code: symbol.code, initialState: .tracked,
                restoreArchived: false, idempotencyKey: submission.idempotencyKey))
            guard joinRevision == revision, auth == AppEnvironment.researchAuthorizationContext(), api.currentSymbol == symbol.canonical else { return }
            guard result.data.symbol == symbol.canonical && result.data.state.rawValue == "tracked" else { throw NSError(domain: "研究自选回执身份不一致", code: 409) }
            joinedMember = result.data
            await api.load(tab: .research, symbol: symbol.canonical)
            guard joinRevision == revision, auth == AppEnvironment.researchAuthorizationContext(), api.currentSymbol == symbol.canonical else { return }
            finishJoinReadback()
        } catch {
            guard joinRevision == revision, auth == AppEnvironment.researchAuthorizationContext(), api.currentSymbol == symbol.canonical else { return }
            joinSubmission.finishFailurePreservingRetry()
            joinMessage = "加入研究尚未完成，请检查连接后重试。若该公司已暂停或归档，请到管理研究自选中明确恢复。"
        }
    }
    private func finishJoinReadback() {
        if let joinedMember, let member, member.id == joinedMember.id,
           member.version == joinedMember.version, member.symbol == joinedMember.symbol, member.state == .tracked {
            joinSubmission.finishSuccessOrReplay()
            self.joinedMember = nil
            joinMessage = nil
        } else {
            joinMessage = "加入请求已收到，列表尚未核对完成。再次点击只会读取结果，不会重复提交。"
        }
    }
    private func focusReadiness(_ proxy: ScrollViewProxy) {
        guard api.researchLoopFocusSymbol == currentCandidate.symbol,
              api.membershipEnvelope?.memberships.contains(where: { $0.symbol == currentCandidate.symbol && $0.state.rawValue == "tracked" }) == true else { return }
        workspaceTab = .judgment
        showFormalResearch = true
        withAnimation { proxy.scrollTo("phase14ResearchLoopReadiness", anchor: .top) }
        api.researchLoopFocusSymbol = nil
    }
    
    private var researchSections: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let member {
                NavigationLink {
                    CompanyResearchComparisonView(primary: member)
                } label: {
                    sectionLabel("比较两家公司", detail: "并列查看已存经营、估值、风险与资料缺口；无需正式报告",
                        icon: "rectangle.split.2x1", tint: Theme.blue)
                }
                .accessibilityIdentifier("companyResearchComparisonEntry")
            }
            if let member {
                NavigationLink {
                    ProviderOperatingReferenceView(membership: member,
                        reference: api.boundProviderOperatingReference(symbol: currentCandidate.symbol)) {
                        actions.workflow(.tasks)
                    }
                    .environment(\.antigravityActions, actions)
                } label: {
                    sectionLabel("五年财务与中期",
                        detail: "查看已存年度、累计半年与三表原件 · OpenD 第三方参考",
                        icon: "chart.bar.doc.horizontal", tint: Theme.green)
                }
                .accessibilityIdentifier("providerOperatingReferenceEntry")
            }
            if let value = api.boundOperatingReasoning(symbol: currentCandidate.symbol) {
                NavigationLink { ResearchOperatingReasoningView(initial: value) } label: { sectionLabel("企业经营", detail: "事实、经营解释与传导边界", icon: "building.2", tint: Theme.blue) }
                    .accessibilityIdentifier("researchOperatingEntry")
                NavigationLink { OperatingProfitBridgeView(initial: value) } label: { sectionLabel("盈利与现金流", detail: value.profitBridge == nil ? "同期间证据待补充" : "同期间利润桥与盈利质量", icon: "chart.bar.xaxis", tint: Theme.green) }
                    .accessibilityIdentifier("researchProfitBridgeEntry")
                NavigationLink { OperatingValuationView(initial: value) } label: { sectionLabel("估值", detail: "悲观、基准、乐观情景", icon: "function", tint: Theme.gold) }
                    .accessibilityIdentifier("researchOperatingValuationEntry")
            } else {
                Button { actions.workflow(.facts) } label: { sectionLabel("企业经营", detail: "结构化事实与来源 · 分析证据待补充", icon: "building.2", tint: Theme.blue) }
                Button { actions.workflow(.facts) } label: { sectionLabel("盈利与现金流", detail: "导入可追溯的财务事实", icon: "chart.bar.xaxis", tint: Theme.green) }
                Button { actions.workflow(.valuation) } label: { sectionLabel("估值", detail: "现有估值工作区 · 新模型证据不足", icon: "function", tint: Theme.gold) }
            }
            WeinsteinDecisionSummaryView(envelope: api.weinstein?.symbol == api.currentSymbol ? api.weinstein : nil)
                .accessibilityIdentifier("researchWeinsteinDecisionSummary")
            NavigationLink { CompanyTechnicalView(symbol: api.currentSymbol) } label: { sectionLabel("个股技术分析", detail: "最新报价、日K、30周阶段、量与相对强度", icon: "waveform.path", tint: Theme.blue) }
            Button { actions.workflow(.quant) } label: { sectionLabel("量化回测与估值", detail: "运行已注册历史策略，查看收益、回撤与成本", icon: "chart.bar", tint: Theme.gold) }
            Button { actions.workflow(.tasks) } label: { sectionLabel("研究任务管理", detail: "查看结构化任务、生成条件与处理记录", icon: "clock", tint: Theme.gold) }
            Button { actions.workflow(.report) } label: { sectionLabel("报告与行动", detail: "已存经营、估值及风险；如有报告再看完整正文与历史", icon: "text.book.closed", tint: Theme.gold) }

        }.buttonStyle(.plain)
    }
    private var researchHistoryWorkspace: some View {
        ClientPage(title: "报告与复盘") {
            Picker("研究内容", selection: $selectedRingTab) {
                Text("当前判断").tag(0); Text("双层研报").tag(1); Text("复盘历史").tag(4)
            }.pickerStyle(.segmented)
            tabWorkspaceActions
            if selectedRingTab == 1 { twoLayerReportSection }
            else if selectedRingTab == 4 { reviewTimelineAndLessonsSection }
            else { coreStanceAndCompletenessSection }
        }.onAppear { if ![0,1,4].contains(selectedRingTab) { selectedRingTab = 0 } }
    }
    private func sectionLabel(_ title: String, detail: String, icon: String, tint: Color) -> some View {
        WorkspaceRowLabel(title: title, subtitle: detail, icon: icon)
    }

    // MARK: - 1. Candidate Governance & Lifecycle Switcher
    private var candidateGovernanceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("选择研究对象")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Button("管理自选") { actions.workflow(.manage) }.font(.subheadline)
                Text(api.candidates.isEmpty ? (api.loading ? "正在读取研究自选" : "暂无可读取研究自选") : "研究自选已读取")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Theme.textSecondary)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Theme.bgSecondary).clipShape(Capsule())
            }
            
            // Candidate switcher pills
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(api.candidates.enumerated()), id: \.element.symbol) { index, cand in
                        candidatePill(cand: cand, index: index)
                            .frame(width: 150, alignment: .leading)
                    }
                }
            }
            
            // Governance belongs below the concise stock selector.
            DisclosureGroup("研究状态与覆盖") { HStack(spacing: 12) {
                govMetaItem(title: "生命周期", value: currentCandidate.state, tint: Theme.blue)
                govMetaItem(title: "技术阶段", value: currentCandidate.stage, tint: Theme.green)
                govMetaItem(title: "下次复核", value: currentCandidate.nextReviewOn ?? "未记录", tint: Theme.textSecondary)
                govMetaItem(title: "完备度", value: currentCandidate.completenessScore.map { "\($0)分" } ?? "未评分", tint: Theme.gold)
            }
            .padding(10)
            .background(Theme.bgSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            }.font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }
    
    private func candidatePill(cand: CandidateMembership, index: Int) -> some View {
        let isSelected = selectedCandidateIndex == index
        return Button(action: {
            selectedCandidateIndex = index
        }) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(cand.symbol)
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .foregroundColor(isSelected ? Theme.gold : Theme.textTertiary)
                    Spacer()
                    if isSelected {
                        Circle().fill(Theme.green).frame(width: 5, height: 5)
                    }
                }
                Text(cand.name)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(isSelected ? Theme.textPrimary : Theme.textSecondary)
                Text(isSelected ? "当前研究" : "查看研究")
                    .font(.system(size: 9))
                    .foregroundColor(isSelected ? Theme.gold : Theme.textTertiary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Theme.bgCardElevated : Theme.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isSelected ? Theme.gold.opacity(0.8) : Theme.border, lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }
    
    private func govMetaItem(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 9.5))
                .foregroundColor(Theme.textTertiary)
            Text(value)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    // MARK: - 2. Annual Decision Ring Workflow & Next Best Action
    private var annualRingsWorkflowCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .foregroundColor(Theme.gold)
                    .font(.system(size: 12))
                Text("年轮决策闭环 · 唯一下一步")
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text(currentCandidate.currentRing)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Theme.gold)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.gold.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            
            Text(currentCandidate.currentDossier.nextActionDetail)
                .font(.system(size: 12))
                .foregroundColor(Theme.textSecondary)
                .lineSpacing(2)
            
            HStack {
                Button(action: {
                    selectedRingTab = 3 // Jump to CAS Evidence
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.text.magnifyingglass")
                        Text("核验官方证据链 (CAS)")
                    }
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundColor(Theme.blue)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(Theme.blue.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Spacer()
                Button(action: {
                    actions.workflow(.valuation)
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "function")
                        Text("量化多情景复算")
                    }
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundColor(Theme.gold)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(Theme.gold.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
            
            Button(action: {
                withAnimation {
                    actions.workflow(.materials)
                }
            }) {
                HStack {
                    Image(systemName: "doc.text.magnifyingglass")
                    Text("打开资料与原文")
                }
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundColor(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(Theme.blue)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
        .padding(12)
        .templateCardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.gold.opacity(0.35), lineWidth: 1)
        )
    }
    
    // MARK: - 3. Decision Ring Tab Picker
    private var decisionRingTabPicker: some View {
        Picker("决策年轮", selection: $selectedRingTab) {
            Text("核心论点").tag(0)
            Text("双层研报").tag(1)
            Text("量化估值").tag(2)
            Text("CAS证据").tag(3)
            Text("决定复盘").tag(4)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("clientResearchTabs")
    }

    private var tabDestinations: [ClientDestination] {
        switch selectedRingTab {
        case 0: [.facts, .portfolio]
        case 1: [.tasks, .report]
        case 2: [.valuation, .portfolio]
        case 3: [.materials, .facts]
        case 4: [.decision, .review]
        default: []
        }
    }
    private var tabWorkspaceActions: some View {
        HStack(spacing: 10) {
            ForEach(tabDestinations, id: \.self) { destination in
                Button { actions.workflow(destination) } label: {
                    HStack {
                        Text(destination.title)
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Theme.gold)
                    .padding(11)
                    .frame(maxWidth: .infinity)
                    .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain)
                    .accessibilityIdentifier("clientResearchTabAction-\(selectedRingTab)-\(destination.rawValue)")
            }
        }
    }
    private var boundReports: [TwoLayerReportData] { api.boundTemplateReports(symbol: currentCandidate.symbol) }
    private var displayedReport: TwoLayerReportData? {
        selectedReportId.flatMap { id in boundReports.first { $0.id == id } }
            ?? boundReports.first(where: \.isCurrentExact) ?? boundReports.first
    }

    // MARK: - Tab 0: Core Stance & Research Completeness
    private var coreStanceAndCompletenessSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            AntigravityFiveQuestionCard(
                dossier: currentCandidate.currentDossier,
                quote: activeOrCandidateQuote,
                onSelect: {
                    withAnimation {
                        selectedRingTab = 1
                    }
                }
            )
            
            completenessSection
            
            portfolioImpactCard
                .id("portfolioImpactCard")
        }
    }
    
    private var completenessSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("五维研究完备度核验")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("覆盖状态以实际证据核对为准")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundColor(Theme.green)
            }
            
            VStack(spacing: 6) {
                ForEach(currentCandidate.radarItems) { item in
                    radarRow(title: item.title, status: item.status, isReady: item.isReady)
                }
            }
            .padding(12)
            .templateCardStyle()
        }
    }
    
    private func radarRow(title: String, status: String, isReady: Bool) -> some View {
        HStack {
            Image(systemName: isReady ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundColor(isReady ? Theme.green : Theme.amber)
                .font(.system(size: 13))
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Theme.textPrimary)
            Spacer()
            Text(status)
                .font(.system(size: 10.5))
                .foregroundColor(Theme.textSecondary)
        }
        .padding(.vertical, 2)
    }
    
    private var portfolioImpactCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("资产与组合影响 (Portfolio Impact)")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("模拟推演")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundColor(Theme.blue)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.blue.opacity(0.12))
                    .clipShape(Capsule())
            }
            
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("当前持仓")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.textTertiary)
                        Text(api.currentHoldingSummary(symbol: currentCandidate.symbol))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("建议观察仓位")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.textTertiary)
                        Text("未设定")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(Theme.gold)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("波动率增量")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.textTertiary)
                        Text("未计算")
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.blue)
                    }
                }
                .padding(10)
                .background(Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                
                Text("持仓来自当前记录；情景仓位与波动率增量需在组合实验中按你的输入计算。")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.textTertiary)
                Button("查看组合解释与实验") { actions.workflow(.portfolio) }
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.gold)
            }
            .padding(12)
            .templateCardStyle()
        }
    }
    
    // MARK: - Tab 1: Two-Layer Research Report (Advice Layer + Research Layer)
    private var twoLayerReportSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            let report = api.templateReportSummary(symbol: currentCandidate.symbol, reportId: displayedReport?.id) ?? templateMissingReport
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(boundReports) { version in
                        Button { selectedReportId = version.id } label: {
                            Text("v\(version.version) · \(version.isCurrentExact ? "当前" : "历史")")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(displayedReport?.id == version.id ? Theme.gold : Theme.textSecondary)
                                .padding(.horizontal, 10).padding(.vertical, 8)
                                .background(Theme.bgSecondary, in: Capsule())
                        }.buttonStyle(.plain)
                            .accessibilityIdentifier("clientResearchInlineReport-\(version.id)")
                    }
                }
            }
            if let selected = displayedReport, !selected.isCurrentExact {
                Text("历史报告仅供回看；当前判断和其他标签仍以最新有效数据为准。")
                    .font(.system(size: 11)).foregroundColor(Theme.amber)
            }
            
            // Advice Layer (建议层)
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("双层研报 · 建议层 (Advice Layer)")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Theme.textPrimary)
                    Spacer()
                    Text("\(report.version) · \(report.status)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(displayedReport?.isFormalizable == true ? Theme.green : Theme.amber)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background((displayedReport?.isFormalizable == true ? Theme.green : Theme.amber).opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                
                VStack(alignment: .leading, spacing: 6) {
                    Text("核心结论 (Thesis)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Theme.gold)
                    Text(report.conclusion)
                        .accessibilityIdentifier("antigravityReportConclusion-\(currentCandidate.symbol)")
                        .font(.system(size: 12.5))
                        .foregroundColor(Theme.textPrimary)
                        .lineSpacing(2)
                }
                .padding(10)
                .background(Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                
                HStack(spacing: 10) {
                    reportParamCard(title: "行动意向", value: report.actionIntent, tint: Theme.blue)
                    reportParamCard(title: "目标估值区间", value: report.targetPriceRange, tint: Theme.green)
                }
                
                if let advice = displayedReport?.payload.adviceLayer {
                    researchLayerRow(title: "长期判断", content: advice.longTerm.view)
                    researchLayerRow(title: "中短期条件", content: advice.mediumShortTerm.view)
                    researchLayerRow(title: "判断失效条件", content: (advice.longTerm.invalidationConditions + advice.mediumShortTerm.invalidationConditions).joined(separator: "\n"))
                    researchLayerRow(title: "长期与短期分歧", content: advice.conflict.description)
                }
                // Catalysts
                VStack(alignment: .leading, spacing: 4) {
                    Text("核心经营催化剂 (Catalysts)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Theme.green)
                    ForEach(report.catalysts, id: \.self) { c in
                        HStack(alignment: .top, spacing: 4) {
                            Text("•").foregroundColor(Theme.green)
                            Text(c).font(.system(size: 11)).foregroundColor(Theme.textSecondary)
                        }
                    }
                }
                .padding(10)
                .background(Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                
                // Counterevidence & Invalidation
                VStack(alignment: .leading, spacing: 4) {
                    Text("推翻条件与核心反证 (Counterevidence)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Theme.red)
                    ForEach(report.counterevidence, id: \.self) { r in
                        HStack(alignment: .top, spacing: 4) {
                            Text("•").foregroundColor(Theme.red)
                            Text(r).font(.system(size: 11)).foregroundColor(Theme.textSecondary)
                        }
                    }
                }
                .padding(10)
                .background(Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(12)
            .templateCardStyle()
            
            // Research Layer (研究层)
            VStack(alignment: .leading, spacing: 10) {
                Text("双层研报 · 研究层 (Research Layer)")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                
                if let research = displayedReport?.payload.researchLayer {
                    reportFacts("基本面与经营", research.fundamentals)
                    reportFacts("产业与竞争背景", research.context ?? [])
                    reportFacts("估值依据", research.valuation)
                    reportFacts("技术证据", research.technical)
                    reportFacts("经营监测", research.operatingMonitor ?? [])
                    reportFacts("主要风险", research.risks)
                    reportFacts("待核实事项", research.unknowns)
                    reportFacts("组合风险依据", research.quantPortfolio ?? [])
                    if !research.sourceConflicts.isEmpty {
                        researchLayerRow(title: "来源冲突", content: research.sourceConflicts.map(\.description).joined(separator: "\n\n"))
                    }
                    if !research.nextValidationQuestions.isEmpty {
                        researchLayerRow(title: "下一步核验", content: research.nextValidationQuestions.joined(separator: "\n"))
                    }
                } else {
                    Text(api.issues["reports"] ?? "尚无研究正文；可在本标签准备研究或打开已保存报告。")
                        .font(.system(size: 12)).foregroundColor(Theme.textSecondary)
                }
            }
            .padding(12)
            .templateCardStyle()
        }
    }
    
    private func reportFacts(_ title: String, _ facts: [TwoLayerReportFact]) -> some View {
        researchLayerRow(title: title, content: facts.isEmpty ? "本报告尚未提供这一项证据。" : facts.map(\.statement).joined(separator: "\n\n"))
    }

    private func reportParamCard(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10))
                .foregroundColor(Theme.textTertiary)
            Text(value)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundColor(tint)
                .lineLimit(2)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
    
    private func researchLayerRow(title: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Theme.gold)
            Text(content)
                .font(.system(size: 11.5))
                .foregroundColor(Theme.textSecondary)
                .lineSpacing(2)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    // MARK: - Tab 2: Valuation Quant Multi-Scenario Workbench
    private var valuationQuantWorkbenchSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("量化估值多情景工作台")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("按已保存估值方法与假设计算")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textTertiary)
            }
            
            // Visual Progress Gauge
            AntigravityPriceGauge(
                currentPrice: activeOrCandidateQuote?.price ?? currentCandidate.currentDossier.currentPrice,
                safetyMargin: currentCandidate.currentDossier.safetyMarginPrice,
                targetBase: currentCandidate.currentDossier.targetPriceBase,
                targetBull: currentCandidate.currentDossier.targetPriceBull
            )
            
            // 3-Scenario Cards
            VStack(spacing: 10) {
                if currentCandidate.valuationScenarios.isEmpty {
                    Text(api.issues["valuation"] ?? "暂无当前可复算的估值情景。")
                        .font(.system(size: 12)).foregroundColor(Theme.textSecondary).padding(14).templateCardStyle()
                }
                Button("读取、核对与编辑估值情景") { actions.workflow(.valuation) }
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.gold)
                ForEach(currentCandidate.valuationScenarios) { sc in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(sc.name)
                                .font(.system(size: 12.5, weight: .bold))
                                .foregroundColor(Theme.textPrimary)
                            Text("概率 \(sc.probability)")
                                .font(.system(size: 9.5))
                                .foregroundColor(Theme.textTertiary)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1.5)
                                .background(Theme.bgSecondary)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            Spacer()
                            Text("\(templateNumber(sc.targetPrice)) \(sc.currency)")
                                .font(.system(size: 15, weight: .bold, design: .monospaced))
                                .foregroundColor(Theme.textPrimary)
                            Text(templateNumber(sc.changePercent, format: "%+.1f%%"))
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundColor((sc.changePercent ?? 0) >= 0 ? Theme.green : Theme.red)
                        }
                        
                        Divider().background(Theme.border)
                        
                        Text(sc.rationale)
                            .font(.system(size: 11))
                            .foregroundColor(Theme.textSecondary)
                        
                        HStack(spacing: 12) {
                            Text("假设: \(sc.growthAssumption)")
                                .font(.system(size: 10))
                                .foregroundColor(Theme.textTertiary)
                            Spacer()
                            Text("折现率: \(sc.wacc)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(Theme.textTertiary)
                        }
                    }
                    .padding(10)
                    .templateCardStyle()
                }
            }
            
            // Reverse Engineering Market Implied Expectations
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .foregroundColor(Theme.blue)
                        .font(.system(size: 12))
                    Text("反向工程市场隐含预期 (Reverse Engineering)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Theme.textPrimary)
                }
                Text("反向估值需要你填写估值和筛选假设，再由后端按当前标的复算。")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.textSecondary)
                    .lineSpacing(2)
                
                HStack {
                    Button("填写假设并复算隐含增长与安全边际") { actions.workflow(.valuation) }
                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.gold)
                }
            }
            .padding(12)
            .background(Theme.bgSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            
            // Daily Technical Indicators
            dailyTechnicalIndicatorsCard
                .id("techCard")
            
            // Weinstein Weekly Stage Analysis
            weinsteinAnalysisCard
            
            // Condition Triggers Matrix
            conditionTriggersCard
                .id("triggersCard")
        }
    }
    
    private var dailyTechnicalIndicatorsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.blue)
                Text("个股日线量化技术指标 (Daily Indicators)")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                if let tech = api.technicalIndicators {
                    StatusBadgeView(.real(source: "日线技术引擎", freshness: .stale, timestamp: tech.session))
                } else {
                    StatusBadgeView(.unavailable(reason: "技术数据未返回"))
                }
            }
            
            let tech = api.technicalIndicators
            let ma20 = tech?.ma20
            let ma60 = tech?.ma60
            let rsi = tech?.rsi14
            let macdHist = tech?.macdHistogram
            let bollLower = tech?.bollingerLower
            let bollUpper = tech?.bollingerUpper
            
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                techCell(title: "均线系统 (MA20 / MA60)", value: "\(templateNumber(ma20)) / \(templateNumber(ma60))", desc: "后端同一日线快照", color: Theme.amber)
                techCell(title: "MACD (12, 26, 9)", value: templateNumber(macdHist, format: "柱: %.3f"), desc: "后端同一日线快照", color: Theme.blue)
                techCell(title: "布林通道 (20, 2SD)", value: "\(templateNumber(bollLower)) ~ \(templateNumber(bollUpper))", desc: "后端同一日线快照", color: Theme.gold)
                techCell(title: "RSI14 (Wilder)", value: templateNumber(rsi, format: "%.1f"), desc: "后端同一日线快照", color: (rsi ?? .infinity) < 35 ? Theme.green : Theme.textPrimary)
            }
        }
        .padding(12)
        .templateCardStyle()
    }
    
    private func techCell(title: String, value: String, desc: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10))
                .foregroundColor(Theme.textTertiary)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundColor(color)
            Text(desc)
                .font(.system(size: 9.5))
                .foregroundColor(Theme.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    private var weinsteinAnalysisCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.purple)
                Text("Stan Weinstein 周线阶段分析")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text(api.weinsteinAnalysis == nil ? "周线分析未返回" : "以后台分析时点为准")
                    .font(.system(size: 10)).foregroundColor(Theme.textSecondary)
            }
            
            let wein = api.weinsteinAnalysis
            let stage = wein?.stockStage ?? "未返回"
            let ma30 = wein?.ma30wDirection ?? "未返回"
            let resistance = api.weinsteinAnalysis?.resistanceLevel ?? "未返回"
            let support = api.weinsteinAnalysis?.supportLevel ?? "未返回"
            let summary = api.weinsteinAnalysis?.summary ?? "周线分析暂不可用。"
            
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    HStack(spacing: 4) {
                        Text("当前阶段:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(stage)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Theme.gold)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Text("30周均线:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(ma30)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Theme.green)
                    }
                }
                
                HStack {
                    HStack(spacing: 4) {
                        Text("阻力区间:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(resistance)
                            .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                            .foregroundColor(Theme.red)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Text("防守支撑:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(support)
                            .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                            .foregroundColor(Theme.green)
                    }
                }
                
                Divider().background(Theme.border)
                
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "info.circle.fill")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.blue)
                        .padding(.top, 2)
                    Text(summary)
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textSecondary)
                }
            }
            .padding(10)
            .background(Theme.bgSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .padding(12)
        .templateCardStyle()
    }
    
    private var conditionTriggersCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("操作价格条件矩阵 (Condition Matrix)")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("PE \(templateNumber(currentCandidate.currentDossier.peTtm, format: "%.1f"))x")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundColor(Theme.gold)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.gold.opacity(0.12))
                    .clipShape(Capsule())
            }
            
            ForEach(currentCandidate.currentDossier.conditionTriggers, id: \.self) { cond in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "checkmark.diamond.fill")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.gold)
                        .padding(.top, 3)
                    Text(cond)
                        .font(.system(size: 11.5))
                        .foregroundColor(Theme.textSecondary)
                }
            }
        }
        .padding(12)
        .templateCardStyle()
    }
    
    // MARK: - Tab 3: CAS Evidence Chain & Verified Facts
    private var casEvidenceChainSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("CAS 不可篡改证据库与原文穿透")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Button(action: { actions.workflow(.materials) }) {
                    Text("查看已存原文")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Theme.blue)
                }
            }
            
            if let documents = api.boundTemplateDocuments(symbol: currentCandidate.symbol) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("已导入资料 · \(documents.documents.count) 份")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.textPrimary)
                    ForEach(documents.documents) { document in
                        HStack {
                            Image(systemName: "doc.richtext").foregroundColor(Theme.blue)
                            Text(document.title).font(.system(size: 12)).foregroundColor(Theme.textSecondary)
                            Spacer()
                            Text("\(document.pageCount) 页").font(.system(size: 11)).foregroundColor(Theme.textTertiary)
                        }
                    }
                    if documents.documents.isEmpty && storedSourceSnapshots.isEmpty {
                        Text("暂无已导入PDF；从上方资料入口导入后，可在此核对引用。")
                            .font(.system(size: 12)).foregroundColor(Theme.textSecondary)
                    }
                }.padding(12).templateCardStyle()
            }
            if !storedSourceSnapshots.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("已保存官方网页 · \(storedSourceSnapshots.count) 份")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                    ForEach(storedSourceSnapshots) { snapshot in
                        Text("\(snapshot.summary) · \(snapshot.reviewState == "pending_review" ? "需要重新核对" : snapshot.reviewState == "historical" ? "历史原文" : "已保存原文")")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                }.padding(12).templateCardStyle()
            }
            if let storedSourceIssue { Text(storedSourceIssue).font(.caption).foregroundStyle(Theme.gold) }
            if currentCandidate.evidenceFacts.isEmpty {
                Text(api.issues["documents"] ?? "尚无绑定原页的引用事实；已导入PDF与已核验事实分别统计。")
                    .font(.system(size: 12)).foregroundColor(Theme.textSecondary)
            }
            VStack(spacing: 8) {
                ForEach(currentCandidate.evidenceFacts) { fact in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(fact.sourceType)
                                .font(.system(size: 9.5, weight: .bold))
                                .foregroundColor(Theme.blue)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Theme.blue.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            Text(fact.sourceTitle)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(Theme.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text("P.\(fact.pageNumber)")
                                .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                .foregroundColor(Theme.gold)
                        }
                        
                        Text(fact.quoteSnippet)
                            .font(.system(size: 11))
                            .foregroundColor(Theme.textSecondary)
                            .lineLimit(3)
                            .lineSpacing(2)
                        
                        HStack {
                            Text(fact.publishDate)
                                .font(.system(size: 9.5))
                                .foregroundColor(Theme.textTertiary)
                            Text(fact.sha256)
                                .font(.system(size: 9.5, design: .monospaced))
                                .foregroundColor(Theme.textTertiary)
                            Spacer()
                            HStack(spacing: 3) {
                                Image(systemName: fact.verifiedState == "verified" ? "checkmark.seal.fill" : "exclamationmark.circle")
                                     .font(.system(size: 10))
                                Text(fact.verifiedState)
                                     .font(.system(size: 9.5, weight: .bold))
                            }
                            .foregroundColor(fact.verifiedState == "verified" ? Theme.green : Theme.amber)
                        }
                    }
                    .padding(10)
                    .templateCardStyle()
                    .onTapGesture { selectedEvidenceId = fact.id; showEvidenceSheet = true }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("clientEvidenceFact-\(fact.id)")
                }
            }
            
            // Engineering Audit & Provenance Logs
            AuditLogSection(
                provider: currentCandidate.symbol == "HK.00175" && api.activeQuote != nil ? "Futu/OpenD (港股行情切片)" : "年轮证据链 · 研报基线",
                cutoff: currentCandidate.currentDossier.dataCutoff,
                evidenceHash: currentCandidate.currentDossier.evidenceHash ?? "未提供",
                taskStatus: currentCandidate.currentDossier.deepResearchStatus,
                provenance: currentCandidate.currentDossier.provenance
            )
            .id("auditLog")
        }
        .task(id: "\(member?.id ?? "none"):\(member?.version ?? 0):\(api.authorizationRevision)") {
            await loadStoredSourceOverview()
        }
    }

    @MainActor
    private func loadStoredSourceOverview() async {
        let revision = UUID(); storedSourceRevision = revision
        storedSourceSnapshots = []; storedSourceIssue = nil
        guard let membership = member else { return }
        let auth = AppEnvironment.researchAuthorizationContext()
        do {
            let pages = try await ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
                authHeaderName: auth.readHeaderName).listResearchSourceSnapshots(membership: membership)
            guard !Task.isCancelled, storedSourceRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext(), member?.id == membership.id,
                  member?.version == membership.version else { return }
            storedSourceSnapshots = pages
        } catch {
            guard storedSourceRevision == revision else { return }
            storedSourceIssue = "已存官方网页暂不可用；可在资料工作区重读。"
        }
    }
    
    // MARK: - Tab 4: Human Decision Intake & Review Timeline
    private var reviewTimelineAndLessonsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            // 1. Human Decision Intake Card (人工决策签署台)
            humanDecisionIntakeCard
            
            VStack(alignment: .leading, spacing: 10) {
                Text("报告版本沿革").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.textPrimary)
                ForEach(boundReports) { report in
                    Button {
                        selectedReportId = report.id
                        selectedRingTab = 1
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("v\(report.version) · \(report.isCurrentExact ? "当前" : "历史") · \(report.createdAt.prefix(10))")
                                .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.gold)
                            Text(report.payload.adviceLayer?.conclusion ?? "此版本未提供建议层")
                                .font(.system(size: 12)).foregroundColor(Theme.textSecondary).lineLimit(3)
                            Text("在双层研报中查看 →").font(.system(size: 11)).foregroundColor(Theme.blue)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(12).templateCardStyle()
                    }.buttonStyle(.plain)
                }
                if boundReports.isEmpty {
                    Text("尚无可读取报告版本。").font(.system(size: 12)).foregroundColor(Theme.textSecondary)
                }
            }
            // 2. Historical Review Timeline & Codified Rules
            historicalReviewTimelineCard
            Button("读取完整决定与复盘记录") { actions.workflow(.review) }
                .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.gold)
        }
    }
    
    private var humanDecisionIntakeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "signature")
                    .foregroundColor(Theme.gold)
                    .font(.system(size: 13))
                Text("人工正式决定签署台 (Human Decision Intake)")
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("进入决定页核对")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Theme.amber)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background((Theme.amber).opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            
            // Adopted Source
            HStack {
                Text("采纳研报基线:")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.textTertiary)
                Text(currentCandidate.report?.version ?? "尚未读取报告")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Theme.blue)
                Spacer()
                Text("截止: \(currentCandidate.currentDossier.dataCutoff)")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textTertiary)
            }
            .padding(.horizontal, 4)
            
            Divider().background(Theme.border)
            
            // Decision Intent Options
            Text("办理事项：")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Theme.textSecondary)
            
            HStack(spacing: 8) {
                decisionIntentPill(intent: "填写个人判断")
                decisionIntentPill(intent: "查看复盘")
                decisionIntentPill(intent: "管理自选")
            }
            
            // Invalidation & Review
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(currentCandidate.currentDossier.confidence)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Theme.gold)
                    Spacer()
                    Text("约定复核日: \(currentCandidate.nextReviewOn ?? "未记录")")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Theme.textSecondary)
                }
                
                HStack(alignment: .top, spacing: 4) {
                    Text("推翻条件:")
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundColor(Theme.red)
                    Text(currentCandidate.currentDossier.invalidationConditions.first ?? "尚未记录失效条件")
                        .font(.system(size: 10.5))
                        .foregroundColor(Theme.textSecondary)
                }
            }
            .padding(10)
            .background(Theme.bgSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            
            // Action Button
            Button(action: {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    actions.workflow(.decision)
                }
            }) {
                HStack {
                    Image(systemName: "square.and.pencil")
                    Text("填写并核对个人正式决定 →")
                }
                .font(.system(size: 12.5, weight: .bold))
                .foregroundColor(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(Theme.gold)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
        .padding(12)
        .templateCardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke((Theme.gold).opacity(0.35), lineWidth: 1)
        )
    }
    
    private func decisionIntentPill(intent: String) -> some View {
        let isSel = intent == "填写个人判断"
        return Button(action: {
            actions.workflow(intent == "管理自选" ? .manage : intent == "查看复盘" ? .review : .decision)
        }) {
            Text(intent)
                .font(.system(size: 10.5, weight: isSel ? .bold : .medium))
                .foregroundColor(isSel ? Theme.gold : Theme.textSecondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(isSel ? Theme.gold.opacity(0.15) : Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(isSel ? Theme.gold : Color.clear, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
    
    private var historicalReviewTimelineCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("决定后的复盘记录")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("版本演化与认知沉淀")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textTertiary)
            }
            
            if currentCandidate.reviewLearnings.isEmpty {
                Text(api.issues["reviews"] ?? "尚无已保存的决定后复盘；可从本标签的决定与复盘入口办理。")
                    .font(.system(size: 12)).foregroundColor(Theme.textSecondary)
            }
            VStack(spacing: 8) {
                ForEach(currentCandidate.reviewLearnings) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(item.version)
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundColor(Theme.gold)
                            Text(item.decisionType)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(Theme.textPrimary)
                            Spacer()
                            Text(item.reviewDate)
                                .font(.system(size: 10))
                                .foregroundColor(Theme.textTertiary)
                        }
                        
                        Text("决定结果: \(item.outcome)")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.textSecondary)
                        
                        HStack(alignment: .top, spacing: 4) {
                            Text("复盘认知:")
                                .font(.system(size: 10.5, weight: .bold))
                                .foregroundColor(Theme.blue)
                            Text(item.lessonLearned)
                                .font(.system(size: 10.5))
                                .foregroundColor(Theme.textPrimary)
                        }
                        .padding(6)
                        .background(Theme.bgSecondary)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .padding(10)
                    .templateCardStyle()
                }
            }
        }
    }
}
