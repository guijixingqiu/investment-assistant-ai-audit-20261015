import SwiftUI
extension GateBResearchScreen {
    @ViewBuilder
    func researchContextCompletionSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Living Dossier · 行业与同业")
                    .font(.headline)
                Spacer()
                if researchContextWorkspace.envelope?.status == .available {
                    Label("可用于深度研究", systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.green)
                }
            }
            Text("把当前 PDF 中可重开的事实写入研究快照；只作为研究证据，不是推荐、排名或交易信号。")
                .font(.caption)
                .foregroundStyle(.secondary)

            let current = researchContextWorkspace.envelope?.data
            if let context = current {
                researchContextSummary(context)
            }
            researchCompletenessSection()
            if let envelope = researchContextWorkspace.envelope, !envelope.history.isEmpty {
                researchContextHistory(envelope)
            }

            if let membership = selectedMembership, membership.state != .archived {
                if let correction = researchContextWorkspace.assistantDraft {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("我的修正草稿")
                            .font(.subheadline.weight(.semibold))
                        Text(correction)
                            .font(.callout)
                            .textSelection(.enabled)
                        Text("明确保存后，它会成为绑定当前报告与证据版本的待核实研究材料，并使旧报告转为历史版本；不需要伪造 PDF 引用。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await saveAssistantReportCorrection() }
                        } label: {
                            Label(
                                researchContextWorkspace.isSaving ? "正在保存并核对" : "保存为我的修正材料",
                                systemImage: "checkmark.shield"
                            )
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(researchContextWorkspace.isBusy)
                        .accessibilityIdentifier("saveAssistantReportCorrectionButton")
                    }
                    .padding(10)
                    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier("assistantReportCorrectionDraft")
                }
                let canCreateFirst = researchContextWorkspace.envelope?.status == .notFound
                    && researchContextWorkspace.envelope?.history.isEmpty == true
                let historyOnly = current == nil
                    && researchContextWorkspace.envelope?.history.isEmpty == false
                let shouldShowEditor = canCreateFirst
                    || (researchContextWorkspace.isEditing && (current != nil || historyOnly))
                let list = researchDocumentWorkspace.list
                let documents = list?.membershipId == membership.id
                    && list?.membershipVersion == membership.version
                    && list?.symbol == membership.symbol
                    ? (list?.documents ?? []).filter {
                        $0.membershipVersionAtImport == membership.version
                            && $0.isSourceAvailable
                    }
                    : []
                if current != nil {
                    Button {
                        researchContextWorkspace.isEditing.toggle()
                    } label: {
                        Label(
                            researchContextWorkspace.isEditing ? "取消更新" : "新增或修正档案事实",
                            systemImage: researchContextWorkspace.isEditing ? "xmark" : "square.and.pencil"
                        )
                    }
                    .buttonStyle(.bordered)
                    .disabled(researchContextWorkspace.isBusy)
                    .accessibilityIdentifier("editResearchContextButton")
                }
                if historyOnly {
                    Text("当前档案已经失效。旧事实继续保留在版本历史，但不会自动复制到新的当前档案。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if !researchContextWorkspace.isEditing {
                        Button {
                            researchContextWorkspace.isEditing = true
                        } label: {
                            Label("从当前 PDF 重新建立", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .disabled(researchContextWorkspace.isBusy)
                        .accessibilityIdentifier("rebuildResearchContextButton")
                    }
                }
                if shouldShowEditor {
                    if documents.isEmpty {
                        Text("先在“PDF 原文”导入或读取一份当前标的 PDF，才能绑定精确页码。")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await loadResearchDocuments() }
                        } label: {
                            Label("读取当前 PDF", systemImage: "doc.text.magnifyingglass")
                        }
                        .buttonStyle(.bordered)
                        .disabled(researchDocumentWorkspace.isBusy || researchContextWorkspace.isBusy)
                    } else {
                        ResearchContextEditorView(
                            membership: membership,
                            documents: documents,
                            current: current,
                            assistantDraft: researchContextWorkspace.assistantDraft,
                            isSaving: researchContextWorkspace.isSaving
                        ) { draft in
                            await saveResearchContext(draft)
                        }
                        .id("\(membership.id):\(membership.version):\(current?.id ?? "first"):\(documents.map(\.id).joined(separator: ","))")
                    }
                }
            } else {
                Text("请选择一个未归档研究自选。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Text(researchContextWorkspace.message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchContextMessage")
        }
        .padding(12)
        .background(
            Color(.secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 8)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchContextCompletionSection")
        .id("researchContextCompletionSection")
    }

    @ViewBuilder
    private func researchContextSummary(_ context: ResearchContextData) -> some View {
        InfoBlock(
            title: "当前活档案 v\(researchContextWorkspace.envelope?.history.first?.revision ?? 1)",
            value: "\(context.industry) · cutoff \(context.cutoffAt) · 有效至 \(context.validUntil)"
        )
        Text(
            "公司事实 \(context.selectedFacts.count) · 同业事实 \(context.peerFacts.count) · 同业 \(context.peers.count) · KPI \(context.operatingKpis.count) · "
                + "宏观驱动 \(context.macroDrivers.count) · 行业驱动 \(context.industryDrivers.count)"
        )
        .font(.caption.weight(.semibold))

        ForEach(context.selectedFacts + context.peerFacts) { fact in
            VStack(alignment: .leading, spacing: 4) {
                Text("\(fact.symbol) · \(fact.metric)：\(fact.value ?? "待核实") \(fact.unit)")
                    .font(.callout)
                if case .pdf(let citation) = fact.citation, citation.sourceMembership == nil {
                    Button("打开 PDF 第 \(citation.pageNumber) 页") {
                        Task { await openResearchContextCitation(citation) }
                    }.font(.caption)
                } else {
                    Text("来源 \(fact.citation.sourceLabel)；在可比同行页按原公司档案重开。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        ForEach(context.macroDrivers + context.industryDrivers) { driver in
            VStack(alignment: .leading, spacing: 4) {
                Text("\(driver.kind == "macro" ? "宏观" : "行业") · \(driver.dimension) · \(driver.impact)：\(driver.statement)")
                    .font(.callout)
                Text("论点关联：\(driver.thesisRelevance)").font(.caption).foregroundStyle(.secondary)
                Button("打开 PDF 第 \(driver.citation.pageNumber) 页") {
                    Task { await openResearchContextCitation(driver.citation) }
                }
                .font(.caption)
            }
        }
        ForEach(context.peers) { peer in
            Text("同业 \(peer.symbol) · \(peer.name) · \(peer.status)：\(peer.reason)")
                .font(.callout)
        }
        ForEach(context.operatingKpis) { kpi in
            Text("\(kpi.category == "price" ? "价格趋势" : "经营 KPI") · \(kpi.metric) · \(kpi.periodStart)–\(kpi.periodEnd)：\(kpi.value ?? "UNKNOWN") \(kpi.unit)")
                .font(.callout)
        }
        ForEach(context.comparisons) { comparison in
            let selectedFact = context.selectedFacts.first { $0.id == comparison.selectedFactId }
            let peerFact = context.peerFacts.first { $0.id == comparison.peerFactId }
            let periodComparable = selectedFact?.periodEnd != nil
                && selectedFact?.periodEnd == peerFact?.periodEnd
                && selectedFact?.periodStart == peerFact?.periodStart
            Text(
                comparison.status == "available" && periodComparable
                    ? "同业差值 · \(comparison.peerSymbol) \(comparison.metric)：\(comparison.delta ?? "待核实") \(comparison.unit)"
                    : "同业不可比 · \(comparison.peerSymbol) \(comparison.metric)：\(comparison.reason ?? "旧档案未明确测量期间")"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        if !context.unknowns.isEmpty {
            DisclosureGroup("待核实（\(context.unknowns.count)）") {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(context.unknowns, id: \.self) { item in
                        Text("• \(item)")
                            .font(.caption)
                    }
                }
                .padding(.top, 6)
            }
        }
    }

    @ViewBuilder
    private func researchContextHistory(_ envelope: ResearchContextEnvelope) -> some View {
        if let summary = envelope.changeSummary {
            if summary.previousContextId == nil {
                Text("首次建立研究档案；后续版本会在这里列出变化。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                InfoBlock(
                    title: "相对上一版的变化",
                    value: summary.changedSections.isEmpty
                        ? "事实内容未变化"
                        : summary.changedSections.map(\.title).joined(separator: "、")
                )
            }
        }
        DisclosureGroup("档案版本历史（\(envelope.history.count)）") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(envelope.history) { entry in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("v\(entry.revision) · 快照 #\(entry.id)\(entry.id == envelope.data?.id ? " · 当前" : "")")
                            .font(.caption.weight(.semibold))
                        Text("\(entry.industry) · cutoff \(entry.cutoffAt) · 保存 \(entry.createdAt)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(
                            "公司 \(entry.itemCounts.selectedFacts) · 同业事实 \(entry.itemCounts.peerFacts) · 同业 \(entry.itemCounts.peers) · KPI \(entry.itemCounts.operatingKpis) · "
                                + "宏观 \(entry.itemCounts.macroDrivers) · 行业 \(entry.itemCounts.industryDrivers) · "
                                + "待核实 \(entry.itemCounts.unknowns)"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
                if envelope.historyHasMore {
                    Text("更早版本仍保留在不可变记录中。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 6)
        }
    }
}

private struct ResearchContextEditorView: View {
    let membership: CandidateMembershipData
    let documents: [ResearchDocumentData]
    let current: ResearchContextData?
    let assistantDraft: String?
    let isSaving: Bool
    let onSubmit: (ResearchContextDraft) async -> Void

    @State private var industry = ""
    @State private var kind = ResearchContextDraftKind.industryDriver
    @State private var selectedDocumentId: String
    @State private var pageNumber = "1"
    @State private var peerSymbol = ""
    @State private var peerName = ""
    @State private var peerStatus = "included"
    @State private var peerReason = ""
    @State private var metric = ""
    @State private var value = ""
    @State private var unit = ""
    @State private var currency = "HKD"
    @State private var factPeriodMode = "none"
    @State private var statement = ""
    @State private var kpiCategory = "operating"
    @State private var periodStart = Calendar.current.date(byAdding: .year, value: -1, to: Date()) ?? Date()
    @State private var periodEnd = Date()
    @State private var comparable = true
    @State private var comparabilityReason = ""
    @State private var dimension = "demand"
    @State private var impact = "unknown"
    @State private var thesisRelevance = ""
    @State private var unknowns = ""
    @State private var validUntil = Calendar.current.date(byAdding: .month, value: 6, to: Date()) ?? Date()

    init(
        membership: CandidateMembershipData,
        documents: [ResearchDocumentData],
        current: ResearchContextData?,
        assistantDraft: String?,
        isSaving: Bool,
        onSubmit: @escaping (ResearchContextDraft) async -> Void
    ) {
        self.membership = membership
        self.documents = documents
        self.current = current
        self.assistantDraft = assistantDraft
        self.isSaving = isSaving
        self.onSubmit = onSubmit
        _industry = State(initialValue: current?.industry ?? "")
        _selectedDocumentId = State(initialValue: documents.first?.id ?? "")
        _unknowns = State(initialValue: current?.unknowns.joined(separator: "\n") ?? "")
        _statement = State(initialValue: assistantDraft ?? "")
        if let value = current?.validUntil, let date = researchContextDate(value), date > Date() {
            _validUntil = State(initialValue: date)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(current == nil ? "新增一项，建立当前档案版本" : "新增或修正一项；同一公司与指标会替换旧事实")
                .font(.caption.weight(.semibold))
            if assistantDraft != nil {
                Text("已带入助手修正草稿；保存前仍需由你选择事实类型、PDF 与精确页码。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchContextAssistantDraftNotice")
            }
            TextField("行业，例如：汽车制造", text: $industry)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("researchContextIndustryInput")
            Picker("证据类型", selection: $kind) {
                ForEach(ResearchContextDraftKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.menu)
            .onChange(of: kind) { _, next in
                if next == .macroDriver { dimension = "growth" }
                if next == .industryDriver { dimension = "demand" }
            }
            Picker("来源 PDF", selection: $selectedDocumentId) {
                ForEach(documents) { document in
                    Text(document.title).tag(document.id)
                }
            }
            .pickerStyle(.menu)
            TextField("PDF 页码", text: $pageNumber)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)

            if kind == .selectedFact || kind == .peerFact {
                if kind == .peerFact {
                    TextField("同业港股代码，例如 HK.00700", text: $peerSymbol)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.characters)
                    TextField("同业名称", text: $peerName).textFieldStyle(.roundedBorder)
                    Picker("同业范围", selection: $peerStatus) {
                        Text("适用").tag("included")
                        Text("排除").tag("excluded")
                    }.pickerStyle(.segmented)
                    TextField(peerStatus == "included" ? "适用理由" : "排除理由", text: $peerReason, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                }
                TextField("指标，例如 revenue", text: $metric)
                    .textFieldStyle(.roundedBorder)
                TextField("数值；留空表示待核实", text: $value)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.decimalPad)
                HStack {
                    TextField("单位，例如 HKD_m", text: $unit)
                        .textFieldStyle(.roundedBorder)
                    TextField("币种，可留空", text: $currency)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.characters)
                }
                Picker("事实测量期间", selection: $factPeriodMode) {
                    Text("旧式未明确期间").tag("none")
                    Text("时点数值").tag("point")
                    Text("起止期间数值").tag("duration")
                }.pickerStyle(.menu)
                if factPeriodMode == "duration" {
                    DatePicker("期间开始", selection: $periodStart, displayedComponents: .date)
                }
                if factPeriodMode != "none" {
                    DatePicker("期间结束或观察日", selection: $periodEnd, displayedComponents: .date)
                }
                Text("跨公司数值比较需要双方明确同一测量期间；只填资料截止日期不能代替会计期间。")
                    .font(.caption2).foregroundStyle(.secondary)
            } else if kind == .operatingKpi {
                Picker("趋势类型", selection: $kpiCategory) {
                    Text("经营 KPI").tag("operating")
                    Text("产品/行业价格").tag("price")
                }.pickerStyle(.segmented)
                TextField("企业适用指标，例如 deliveries", text: $metric).textFieldStyle(.roundedBorder)
                TextField("数值；留空表示明确 UNKNOWN", text: $value).textFieldStyle(.roundedBorder)
                TextField("单位，例如 vehicles", text: $unit).textFieldStyle(.roundedBorder)
                DatePicker("期间开始", selection: $periodStart, displayedComponents: .date)
                DatePicker("期间结束", selection: $periodEnd, displayedComponents: .date)
                Toggle("与同指标其他期间可比", isOn: $comparable)
                if !comparable {
                    TextField("不可比原因", text: $comparabilityReason, axis: .vertical).textFieldStyle(.roundedBorder)
                }
            } else {
                Picker("驱动维度", selection: $dimension) {
                    ForEach(kind == .industryDriver
                        ? ["supply", "demand", "pricing", "competition", "policy", "cycle"]
                        : ["growth", "inflation", "rates", "fx", "commodities", "policy"], id: \.self) { Text($0).tag($0) }
                }.pickerStyle(.menu)
                Picker("影响", selection: $impact) {
                    Text("支持").tag("supportive"); Text("不利").tag("adverse")
                    Text("混合").tag("mixed"); Text("UNKNOWN").tag("unknown")
                }.pickerStyle(.segmented)
                TextField(
                    kind == .macroDriver ? "宏观驱动事实" : "行业驱动事实",
                    text: $statement,
                    axis: .vertical
                )
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
                TextField("为什么与当前投资论点相关", text: $thesisRelevance, axis: .vertical)
                    .lineLimit(2...5).textFieldStyle(.roundedBorder)
            }

            TextField("待核实项；每行一项（可选）", text: $unknowns, axis: .vertical)
                .lineLimit(2...6)
                .textFieldStyle(.roundedBorder)
            DatePicker("有效至", selection: $validUntil, in: Date()..., displayedComponents: .date)

            Button {
                guard let page = Int(pageNumber) else { return }
                let draft = ResearchContextDraft(
                    industry: industry,
                    kind: kind,
                    documentId: selectedDocumentId,
                    pageNumber: page,
                    peerSymbol: peerSymbol,
                    peerName: peerName,
                    peerStatus: peerStatus,
                    peerReason: peerReason,
                    metric: metric,
                    value: value,
                    unit: unit,
                    currency: currency,
                    factPeriodMode: factPeriodMode,
                    statement: statement,
                    kpiCategory: kpiCategory,
                    periodStart: periodStart,
                    periodEnd: periodEnd,
                    comparable: comparable,
                    comparabilityReason: comparabilityReason,
                    dimension: dimension,
                    impact: impact,
                    thesisRelevance: thesisRelevance,
                    unknowns: unknowns,
                    validUntil: validUntil
                )
                Task { await onSubmit(draft) }
            } label: {
                Label(
                    isSaving ? "正在保存并核对" : current == nil ? "保存首个档案版本" : "保存档案新版本",
                    systemImage: "checkmark.shield"
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSaving || Int(pageNumber).map { $0 > 0 } != true)
            .accessibilityIdentifier("saveResearchContextButton")

            Text("只追加不可变研究快照；不会修改持仓、现金、订单、成交或正式决定。")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private extension ResearchContextDraftKind {
    var title: String {
        switch self {
        case .selectedFact: "公司数值事实"
        case .peerFact: "同业数值事实"
        case .operatingKpi: "经营 KPI / 价格趋势"
        case .macroDriver: "宏观驱动"
        case .industryDriver: "行业驱动"
        }
    }
}

private extension ResearchContextSection {
    var title: String {
        switch self {
        case .industry: "行业"
        case .selectedFacts: "公司事实"
        case .peerFacts: "同业事实"
        case .peers: "同业范围"
        case .operatingKpis: "经营 KPI / 价格趋势"
        case .macroDrivers: "宏观驱动"
        case .industryDrivers: "行业驱动"
        case .unknowns: "待核实项"
        case .timeline: "时间边界"
        case .provenance: "来源"
        }
    }
}
