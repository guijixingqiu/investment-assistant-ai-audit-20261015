import SwiftUI
import CryptoKit

@MainActor
enum InvestigationReadingPosition {
    static func key(for turn: InvestigationTurn, history: Bool) -> String {
        let mode = turn.mode ?? (turn.eventDate == nil ? "earnings_quality" : "price_move")
        return InvestigationResultCache.key(turn.membershipId, turn.membershipVersion, mode: mode, eventDate: turn.eventDate)
            + ":reading-chapter-v1:\(turn.symbol):\(turn.receipt):\(history ? "history" : "current")"
    }

    static func chapters(in turn: InvestigationTurn) -> Set<String> {
        var values: Set<String> = ["report-start", "核心判断", "后续观察", "资料范围与时间", "导出报告"]
        if let report = turn.analysis.report {
            values.formUnion(report.sections.indices.map { "report-\($0)" })
            values.insert("核查依据")
        } else {
            let analysis = turn.analysis
            if analysis.reasoning?.explanations.isEmpty == false || !analysis.possibleExplanations.isEmpty
                || !analysis.weakenedExplanations.isEmpty || analysis.operatingDrivers?.isEmpty == false
                || analysis.researchJudgment != nil {
                values.insert("主要分析")
            }
            values.insert("关键事实")
            values.insert("尚待核查与风险")
            if InvestigationReportReader.hasValueImpact(turn) { values.insert("经营与价值影响") }
        }
        return values
    }

    static func read(for turn: InvestigationTurn, history: Bool) -> String? {
        guard InvestigationResultCache.isRetained(turn),
              let saved = UserDefaults.standard.string(forKey: key(for: turn, history: history)),
              chapters(in: turn).contains(saved) else { return nil }
        return saved
    }

    static func save(_ chapter: String, for turn: InvestigationTurn, history: Bool) {
        guard InvestigationResultCache.isRetained(turn), chapters(in: turn).contains(chapter) else { return }
        UserDefaults.standard.set(chapter, forKey: key(for: turn, history: history))
    }
}

/// A reading projection of the accepted response; never rewrites financial claims.
struct InvestigationReportReader: View {
    let turn: InvestigationTurn
    let archived: Bool
    let followup: (String) -> Void
    @State private var citation: ReportCitation?
    @State private var preparedExport: InvestigationReportExports?
    @State private var exportIssue: String?
    init(turn: InvestigationTurn, archived: Bool = false, followup: @escaping (String) -> Void) {
        self.turn = turn
        self.archived = archived
        self.followup = followup
    }
    private var hasMainAnalysis: Bool {
        turn.analysis.reasoning?.explanations.isEmpty == false
            || !turn.analysis.possibleExplanations.isEmpty || !turn.analysis.weakenedExplanations.isEmpty
            || turn.analysis.operatingDrivers?.isEmpty == false || turn.analysis.researchJudgment != nil
    }
    static func hasValueImpact(_ turn: InvestigationTurn) -> Bool {
        guard let r = turn.analysis.reasoning else { return false }
        let valuationNotChecked = turn.gaps.contains { $0.reason == "NOT_CHECKED" && $0.text.contains("估值假设") }
        return r.transmission.operatingFact != nil || r.transmission.operatingMeaning != nil
            || r.transmission.earnings != nil || r.transmission.cashFlow != nil || r.earningsImpact != nil
            || (!valuationNotChecked && (r.transmission.valuation != nil || r.valuationImpact != nil))
            || (turn.currentThesis?.status == "active" && r.thesisImpact != nil)
    }
    private var hasValueImpact: Bool { Self.hasValueImpact(turn) }
    var body: some View {
        Group {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(reportTitle).font(.title2.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    if reportTitle != turn.question {
                        DisclosureGroup("完整研究问题与范围") { Text(turn.question).font(.body) }
                            .font(.footnote)
                    }
                    Text("\(turn.symbol) · 研究于 \(turn.generatedDescription)")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                    if let date = turn.eventDate { Text("研究事件日：\(date)").font(.footnote) }
                    Text("AI 研究分析 · 事实与解释请结合原文核对")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }.id("report-start")
                section("核心判断") {
                    Text(turn.analysis.reasoning?.summary ?? turn.analysis.whatHappened.first?.text ?? "当前资料尚不足以形成结论。")
                        .font(.title3.weight(.medium))
                    Text("最重要的不确定性").font(.headline)
                    Text(turn.analysis.largestUnknown.text)
                }
                if let report = turn.analysis.report {
                    ForEach(report.sections.indices, id: \.self) { index in
                        VStack(alignment: .leading, spacing: 16) {
                            if index == 0 {
                                Divider()
                                Text("报告正文").font(.title3.bold()).accessibilityAddTraits(.isHeader)
                            }
                            reportParagraph(report.sections[index])
                        }.id("report-\(index)")
                    }
                } else if hasMainAnalysis {
                    section("主要分析") {
                        if let reasoning = turn.analysis.reasoning, !reasoning.explanations.isEmpty {
                            ForEach(reasoning.explanations.sorted { $0.rank < $1.rank }) { explanation in
                                explanationParagraph(explanation)
                            }
                        } else {
                            claims(turn.analysis.possibleExplanations + turn.analysis.weakenedExplanations)
                        }
                        if let drivers = turn.analysis.operatingDrivers, !drivers.isEmpty {
                            Text("管理层如何解释经营变化").font(.headline)
                            claims(drivers)
                        }
                        if let judgment = turn.analysis.researchJudgment {
                            claims([judgment.importance, judgment.impact])
                        }
                    }
                }
                if turn.analysis.report == nil {
                    section("关键事实") {
                        claims(turn.analysis.whatHappened + turn.analysis.confirmedInformation)
                    }
                }
                if turn.analysis.report == nil, hasValueImpact, let r = turn.analysis.reasoning {
                    section("经营与价值影响") {
                        if let step = r.transmission.operatingFact { transmission("经营事实", step) }
                        if let step = r.transmission.operatingMeaning { transmission("经营含义", step) }
                        if let step = r.transmission.earnings { transmission("如何影响盈利", step) }
                        if let step = r.transmission.cashFlow { transmission("如何影响现金流", step) }
                        if let impact = r.earningsImpact { impactParagraph("盈利判断", impact) }
                        if !valuationNotChecked {
                            if let step = r.transmission.valuation { transmission("如何影响估值", step) }
                            if let impact = r.valuationImpact { impactParagraph("估值判断", impact) }
                        }
                        if turn.currentThesis?.status == "active", let impact = r.thesisImpact {
                            Text("与当前研究判断的关系").font(.headline)
                            if let thesis = turn.currentThesis?.text { Text(thesis).foregroundStyle(Theme.textSecondary) }
                            impactParagraph("新证据的影响", impact)
                        }
                    }
                }
                if turn.analysis.report == nil { section("尚待核查与风险") {
                    if let reasoning = turn.analysis.reasoning, !reasoning.unknowns.isEmpty {
                        ForEach(reasoning.unknowns, id: \.text) { unknown in
                            Text(valuationNotChecked && unknown.text.contains("估值") ? "本轮未核对估值假设，因此不能量化影响。" : unknown.text)
                            why(unknown.whyThisMatters)
                        }
                    } else { Text(turn.analysis.largestUnknown.text) }
                } }
                section("后续观察") {
                    Text(turn.analysis.nextCheck)
                    if let reasoning = turn.analysis.reasoning, !reasoning.nextQuestions.isEmpty {
                        DisclosureGroup("进一步研究的问题") {
                        ForEach(reasoning.nextQuestions, id: \.question) { item in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.question).font(.headline)
                                Text(item.whyImportant)
                                Text("需要的依据：" + item.neededEvidence).foregroundStyle(Theme.textSecondary)
                                Button("围绕这个问题追问") { followup(item.question) }.frame(minHeight: 44)
                            }
                        }
                        }
                    }
                }
                if turn.analysis.report != nil {
                    section("核查依据") {
                        DisclosureGroup("事实与数值") {
                            claims(turn.analysis.whatHappened + turn.analysis.confirmedInformation)
                        }
                        if hasValueImpact, let r = turn.analysis.reasoning {
                            DisclosureGroup("经营与价值影响的详细核查") {
                                if let step = r.transmission.operatingFact { transmission("经营事实", step) }
                                if let step = r.transmission.operatingMeaning { transmission("经营含义", step) }
                                if let step = r.transmission.earnings { transmission("如何影响盈利", step) }
                                if let step = r.transmission.cashFlow { transmission("如何影响现金流", step) }
                                if let impact = r.earningsImpact { impactParagraph("盈利判断", impact) }
                                if !valuationNotChecked {
                                    if let step = r.transmission.valuation { transmission("如何影响估值", step) }
                                    if let impact = r.valuationImpact { impactParagraph("估值判断", impact) }
                                }
                                if turn.currentThesis?.status == "active", let impact = r.thesisImpact {
                                    if let thesis = turn.currentThesis?.text { Text(thesis) }
                                    impactParagraph("与当前研究判断的关系", impact)
                                }
                            }
                        }
                        DisclosureGroup("逐项核查与未解问题") {
                            if let reasoning = turn.analysis.reasoning {
                                ForEach(reasoning.explanations.sorted { $0.rank < $1.rank }) { explanation in
                                    explanationParagraph(explanation)
                                }
                                ForEach(reasoning.unknowns, id: \.text) { unknown in
                                    Text(unknown.text)
                                    why(unknown.whyThisMatters)
                                }
                            }
                            if let drivers = turn.analysis.operatingDrivers, !drivers.isEmpty {
                                Text("管理层的说明").font(.headline)
                                claims(drivers)
                            }
                        }
                    }
                }
                section("资料范围与时间") {
                    Text("生成日期不代表全部资料截至该日。以下分别列出来源发布时间和读取时间；未覆盖的维度不视为已完成分析。")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                    DisclosureGroup("来源清单（\(turn.sources.count) 条）") {
                    ForEach(turn.sources) { source in
                        Button {
                            citation = ReportCitation(source: source, quote: nil)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(source.source + (source.pageNumber.map { " · 第\($0)页" } ?? ""))
                                Text("发布：\(source.publishedAt ?? "未提供")\n读取：\(source.retrievedAt)").font(.caption)
                                if source.readStatus != "BODY_READ" { Text("未读正文，不能作为已核实事实").font(.caption) }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
                        }.buttonStyle(.plain)
                    }
                    }
                    ForEach(turn.gaps, id: \.text) { Text($0.text).foregroundStyle(Theme.textSecondary) }
                    DisclosureGroup("导出这份报告") {
                        Text(archived ? "历史版本仅供查阅，当前适用性尚未重新核验。" : "导出当前已核验的研究回答；来源时间以报告记录为准。")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                        Button("准备 PDF、JSON、CSV") {
                            do {
                                preparedExport = try InvestigationReportExporter.prepare(turn, archived: archived)
                                exportIssue = nil
                            } catch {
                                preparedExport = nil
                                exportIssue = "这份报告无法完成导出，请重新打开历史记录后重试。"
                            }
                        }.frame(minHeight: 44).accessibilityIdentifier("investigationPrepareExport")
                        if let preparedExport {
                            ShareLink(item: preparedExport.pdf, preview: SharePreview(preparedExport.pdf.filename)) {
                                Label("导出可读 PDF", systemImage: "doc.text")
                            }.frame(minHeight: 44).accessibilityIdentifier("investigationExportPDF")
                            ShareLink(item: preparedExport.json, preview: SharePreview(preparedExport.json.filename)) {
                                Label("导出完整 JSON", systemImage: "curlybraces")
                            }.frame(minHeight: 44).accessibilityIdentifier("investigationExportJSON")
                            ShareLink(item: preparedExport.csv, preview: SharePreview(preparedExport.csv.filename)) {
                                Label("导出表格 CSV", systemImage: "tablecells")
                            }.frame(minHeight: 44).accessibilityIdentifier("investigationExportCSV")
                        }
                        if let exportIssue { Text(exportIssue).foregroundStyle(Theme.amber) }
                    }.id("导出报告")
                }
            }.scrollTargetLayout().font(.body).lineSpacing(6).textSelection(.enabled)
                .frame(maxWidth: 720, alignment: .leading)
                .sheet(item: $citation) { InvestigationCitationSheet(citation: $0, membershipId: turn.membershipId, membershipVersion: turn.membershipVersion, symbol: turn.symbol) }
        }.accessibilityIdentifier("investigationReportReader")
            .onChange(of: turn.receipt) { _, _ in preparedExport = nil; exportIssue = nil }
    }

    private var reportTitle: String {
        if turn.question.count <= 90 { return turn.question }
        if let end = turn.question.firstIndex(where: { $0 == "？" || $0 == "?" || $0 == "\n" }), turn.question.distance(from: turn.question.startIndex, to: end) <= 90 {
            return String(turn.question[...end]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return turn.mode == "price_move" ? "价格变化研究" : "公司深度研究"
    }
    private func reportParagraph(_ value: InvestigationAnalysis.Report.Section) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(value.heading).font(.headline).accessibilityAddTraits(.isHeader)
            Text(value.text).fixedSize(horizontal: false, vertical: true)
            if !value.missingEvidence.isEmpty {
                Text("判断的限制：" + value.missingEvidence).foregroundStyle(Theme.textSecondary)
            }
            references(value.basis)
            Button {
                // The signed prior report travels through the existing conversation
                // payload. Pasting its prose here can exhaust the question limit.
                followup("请重新核对 \(turn.generatedDescription) 报告中的「\(value.heading)」一节。我想进一步了解：")
            } label: {
                Label("追问这一节", systemImage: "bubble.left").font(.footnote).frame(minHeight: 44)
            }
        }.padding(.bottom, 12)
    }
    private var valuationNotChecked: Bool {
        turn.gaps.contains { $0.reason == "NOT_CHECKED" && $0.text.contains("估值假设") }
    }
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Divider()
            Text(title).font(.title3.bold()).accessibilityAddTraits(.isHeader)
            content()
        }.frame(maxWidth: .infinity, alignment: .leading).id(title)
    }
    private func claims(_ values: [InvestigationAnalysis.Claim]) -> some View {
        let unique = values.enumerated().filter { index, value in !values.prefix(index).contains(where: { $0.text == value.text }) }.map(\.element)
        return ForEach(unique) { claim in
            VStack(alignment: .leading, spacing: 8) {
                Text(claim.text)
                Text(["FACT": "原始事实", "SOURCE_SUPPORTED": "来源支持，待交叉核验", "INTERPRETATION": "分析解释", "HYPOTHESIS": "待核验解释"][claim.classification] ?? "待核查")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                references(claim.basis)
                if !claim.missingEvidence.isEmpty { Text("尚缺依据：" + claim.missingEvidence).foregroundStyle(Theme.textSecondary) }
            }.padding(.bottom, 8)
        }
    }
    private func references(_ values: [InvestigationAnalysis.Claim.Basis]) -> some View {
        Group {
            if values.count == 1, let value = values.first {
                Button {
                    citation = ReportCitation(source: turn.sources.first { $0.id == value.sourceId }, quote: value.quote)
                } label: { Label("核对原文依据", systemImage: "doc.text.magnifyingglass").font(.footnote).frame(minHeight: 44) }
            } else if !values.isEmpty {
                Menu {
                    ForEach(values.indices, id: \.self) { index in
                        let value = values[index]
                        Button {
                            citation = ReportCitation(source: turn.sources.first { $0.id == value.sourceId }, quote: value.quote)
                        } label: {
                            Text("引用 \(index + 1) · " + (turn.sources.first { $0.id == value.sourceId }.map { "\($0.source)\($0.pageNumber.map { " · 第\($0)页" } ?? "")" } ?? "查看原文"))
                        }
                    }
                } label: { Label("核对 \(values.count) 条原文依据", systemImage: "doc.text.magnifyingglass").font(.footnote).frame(minHeight: 44) }
            }
        }
    }

    private func transmission(_ title: String, _ step: InvestigationAnalysis.Reasoning.Step) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(step.status == "confirmed" ? "已确认" : step.status == "interpretation" ? "分析解释" : "尚未判断").font(.caption).foregroundStyle(Theme.textSecondary)
            Text(step.text)
            if let gap = step.gap { Text(gap.text).foregroundStyle(Theme.textSecondary) }
            references(step.basis)
            why(step.whyThisMatters)
        }
    }
    private func impactParagraph(_ title: String, _ impact: InvestigationAnalysis.Reasoning.Impact) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline); Text(impact.text); references(impact.basis)
            if !impact.missingEvidence.isEmpty { Text(impact.missingEvidence).foregroundStyle(Theme.textSecondary) }
        }
    }
    private func explanationParagraph(_ value: InvestigationAnalysis.Reasoning.Explanation) -> some View {
        let result = turn.analysis.hypothesisResults?.first { $0.hypothesisId == value.hypothesisId }
        return VStack(alignment: .leading, spacing: 10) {
            Text(result?.proposition ?? value.claimCoverage.claim).font(.headline)
            Text(["supported": "现有原文支持", "partial": "部分支持", "weakened": "已被弱化", "unresolved": "尚无法判断"][result?.verdict ?? ""] ?? "尚无法判断").font(.caption).foregroundStyle(Theme.textSecondary)
            if let result { Text(result.explanation) }
            if value.confidenceReason != result?.explanation { Text(value.confidenceReason) }
            references(value.supportingEvidence)
            if value.contradictingEvidence.isEmpty {
                Text("本次已读资料未提供明确反证，不等于该解释已被证实。").foregroundStyle(Theme.textSecondary)
            } else { Text("相反证据").font(.headline); references(value.contradictingEvidence) }
            if value.claimCoverage.conclusion != result?.explanation && value.claimCoverage.conclusion != value.confidenceReason { Text(value.claimCoverage.conclusion) }
            if !value.claimCoverage.missingLink.isEmpty { Text("尚缺的环节：" + value.claimCoverage.missingLink) }
            if !value.missingEvidence.isEmpty && value.missingEvidence != value.claimCoverage.missingLink { Text(value.missingEvidence).foregroundStyle(Theme.textSecondary) }
        }.padding(.bottom, 12)
    }
    private func why(_ value: InvestigationAnalysis.Reasoning.Why) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let text = value.why { Text(text) }
            if let text = value.ifConfirmed { Text(text) }
            if let text = value.ifRejected { Text(text) }
        }.foregroundStyle(Theme.textSecondary)
    }
}

/// Return to the current, source-bound composer before starting a new question.
struct InvestigationHistoryReader: View {
    let turn: InvestigationTurn
    let archived: Bool
    let followup: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var visibleChapter: String?

    var body: some View {
        ScrollView {
            if archived {
                Text("历史版本 · 未重新验证当前适用性").font(.footnote).padding(.top)
            }
            InvestigationReportReader(turn: turn, archived: archived) { question in
                dismiss()
                followup(question)
            }.padding(24)
        }.scrollPosition(id: $visibleChapter, anchor: .top)
            .safeAreaInset(edge: .top, spacing: 0) {
            InvestigationReportDirectory(turn: turn) { target in
                withAnimation { visibleChapter = target }
            }
        }
        .navigationTitle(archived ? "历史报告" : "历史研究")
        .task(id: turn.receipt) {
            visibleChapter = InvestigationReadingPosition.read(for: turn, history: true) ?? "report-start"
        }
        .onChange(of: visibleChapter) { _, chapter in
            guard let chapter else { return }
            InvestigationReadingPosition.save(chapter, for: turn, history: true)
        }
    }
}

/// Sits outside the scrolling article so navigation stays available at any depth.
struct InvestigationReportDirectory: View {
    let turn: InvestigationTurn
    let navigate: (String) -> Void

    var body: some View {
        HStack {
            Menu {
                Button("核心判断") { navigate("核心判断") }
                if let report = turn.analysis.report {
                    ForEach(report.sections.indices, id: \.self) { index in
                        Button(report.sections[index].heading) { navigate("report-\(index)") }
                    }
                    Button("核查依据") { navigate("核查依据") }
                } else {
                    if turn.analysis.reasoning?.explanations.isEmpty == false
                        || !turn.analysis.possibleExplanations.isEmpty || !turn.analysis.weakenedExplanations.isEmpty
                        || turn.analysis.operatingDrivers?.isEmpty == false || turn.analysis.researchJudgment != nil {
                        Button("主要分析") { navigate("主要分析") }
                    }
                    Button("关键事实") { navigate("关键事实") }
                    Button("尚待核查与风险") { navigate("尚待核查与风险") }
                }
                Button("后续观察") { navigate("后续观察") }
                Button("资料范围与时间") { navigate("资料范围与时间") }
                Button("导出报告") { navigate("导出报告") }
            } label: {
                Label("报告目录", systemImage: "list.bullet").frame(minHeight: 44)
            }.accessibilityIdentifier("investigationPersistentDirectory")
            Spacer()
            Button("回到开头") { navigate("report-start") }.font(.footnote).frame(minHeight: 44)
        }.padding(.horizontal, 24).background(Theme.bgPrimary)
            .overlay(alignment: .bottom) { Divider() }
    }
}

struct ReportCitation: Identifiable {
    let id = UUID()
    let source: InvestigationSource?
    let quote: String?
}

struct InvestigationCitationSheet: View {
    let citation: ReportCitation
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    var returnLabel = "返回报告"
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var pdf: ResearchDocumentPDFPresentation?
    @State private var loading = false
    @State private var issue: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let source = citation.source {
                        Text(source.source).font(.title3.bold())
                        if let page = source.pageNumber { Text("引用页码：第 \(page) 页") }
                        Text("发布：\(source.publishedAt ?? "未提供")\n读取：\(source.retrievedAt)").font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if let quote = citation.quote { Text("本段引用").font(.headline); Text(quote) }
                    if let source = citation.source {
                        Text("已读取的来源上下文").font(.headline)
                        Text(source.text)
                        if let reason = source.reason { Text(reason).foregroundStyle(Theme.textSecondary) }
                        if source.sourceType == "official_pdf", source.pageNumber != nil {
                            Button(loading ? "正在核对原文版本…" : "查看 PDF 对应页") { Task { await openPDF() } }
                                .disabled(loading).frame(minHeight: 44)
                            if let issue { Text(issue).foregroundStyle(Theme.amber) }
                        }
                        if source.sourceType == "official_body", let coordinate = source.snapshotCitation {
                            NavigationLink("核对已存网页原件与选段") {
                                InvestigationStoredSourceReader(membershipId: membershipId,
                                    membershipVersion: membershipVersion, symbol: symbol,
                                    coordinate: coordinate)
                            }.frame(minHeight: 44)
                        }
                        if let raw = source.url, let url = URL(string: raw), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                            Link("打开原始来源", destination: url).frame(minHeight: 44)
                        } else { Text("本项未提供可打开的网址，保留已读取原文供核对。") }
                    } else { Text("当前报告未包含这项来源的完整信息，不能确认原文定位。") }
                }.padding(24).textSelection(.enabled).lineSpacing(6)
            }.navigationTitle("核对原文").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(returnLabel) { dismiss() } } }
        }.sheet(item: $pdf) { item in
            NavigationStack {
                ResearchDocumentPDFView(data: item.data, pageNumber: item.pageNumber)
                    .navigationTitle("原文第 \(item.pageNumber) 页").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("返回引用") { pdf = nil } } }
            }
        }.onChange(of: store.authorizationRevision) { _, _ in pdf = nil; dismiss() }
    }
    private func openPDF() async {
        guard !loading, let source = citation.source, source.symbol == symbol,
              let pageNumber = source.pageNumber, pageNumber > 0, let sourceURL = source.url else { return }
        loading = true; issue = nil
        defer { loading = false }
        let auth = AppEnvironment.researchAuthorizationContext()
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName)
        do {
            let members = await client.fetchCandidateMemberships(includeArchived: false)
            guard let membership = members.memberships.first(where: { $0.id == membershipId && $0.version == membershipVersion && $0.symbol == symbol }) else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let documents = try await client.fetchResearchDocuments(membership: membership)
            // URL alone is not a version identity: bind the cited page hash before opening bytes.
            for document in documents.documents.filter({ $0.capturedSourceUrl == sourceURL && $0.isSourceAvailable && $0.pageCount >= pageNumber }) {
                let page = try await client.fetchResearchDocumentPage(membership: membership, documentId: document.id, pageNumber: pageNumber)
                guard page.pageTextSha256 == source.contentSha256 else { continue }
                let bytes = try await client.fetchResearchDocumentContent(membership: membership, document: document)
                guard !Task.isCancelled, auth == AppEnvironment.researchAuthorizationContext(), researchDocumentPDFContainsPage(bytes, pageNumber: pageNumber) else { return }
                pdf = ResearchDocumentPDFPresentation(title: document.title, data: bytes, pageNumber: pageNumber)
                return
            }
            issue = "未找到与这条引用完全一致的 PDF 版本；已读原文仍保留，外部来源可能已经更新。"
        } catch {
            guard auth == AppEnvironment.researchAuthorizationContext() else { return }
            issue = "原文暂未打开。请检查连接后重试；没有以其他版本替代引用。"
        }
    }
}

private struct InvestigationStoredSourceReader: View {
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    let coordinate: PersonalFormalSnapshotCoordinate
    @State private var membership: CandidateMembershipData?
    @State private var issue: String?
    var body: some View {
        Group {
            if let membership {
                CompanyStoredSourceReader(membership: membership, snapshotId: coordinate.snapshotId,
                    expectedCoordinate: coordinate)
            } else { Text(issue ?? "正在读取来源身份…").padding(20) }
        }.task(id: "\(membershipId):\(membershipVersion):\(coordinate.snapshotId)") {
            membership = nil; issue = nil
            let auth = AppEnvironment.researchAuthorizationContext()
            let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName)
            let members = await client.fetchCandidateMemberships(includeArchived: false)
            guard auth == AppEnvironment.researchAuthorizationContext(),
                  let exact = members.memberships.first(where: { $0.id == membershipId
                      && $0.version == membershipVersion && $0.symbol == symbol }) else {
                issue = "当前公司身份不匹配，无法重开已存原文。"; return
            }
            membership = exact
        }
    }
}


private struct InvestigationReportExports {
    let pdf: ResearchArchivePDFDocument
    let json: ResearchArchiveExportDocument
    let csv: ResearchArchiveCSVDocument
}

/// Exports only an accepted turn already visible in the reader. Historical
/// status travels with the files; preparing them never changes the saved turn.
private enum InvestigationReportExporter {
    private struct Envelope: Encodable {
        let schemaVersion = "investigation-report-export-v1"
        let exportedAt: String
        let historical: Bool
        let turn: InvestigationTurn
    }

    static func prepare(_ turn: InvestigationTurn, archived: Bool) throws -> InvestigationReportExports {
        guard turn.ok, !turn.receipt.isEmpty, !turn.sources.isEmpty,
              turn.sources.allSatisfy({ $0.symbol == turn.symbol }),
              Set(turn.sources.map(\.id)).count == turn.sources.count else {
            throw ResearchArchiveExportError.invalidSource
        }
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let receiptHash = SHA256.hash(data: Data(turn.receipt.utf8)).map { String(format: "%02x", $0) }.joined()
        let filename = "\(turn.symbol.replacingOccurrences(of: ".", with: "-"))-research-\(receiptHash.prefix(12))\(archived ? "-history" : "")"
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let json = try encoder.encode(Envelope(exportedAt: timestamp, historical: archived, turn: turn))
        let csv = Data(csvRows(turn, archived: archived).map { row in
            row.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: ",")
        }.joined(separator: "\r\n").appending("\r\n").utf8)
        let pdf = try researchReportPDFData(pdfBlocks(turn, archived: archived))
        return InvestigationReportExports(
            pdf: ResearchArchivePDFDocument(data: pdf, filename: filename + ".pdf"),
            json: ResearchArchiveExportDocument(data: json, filename: filename + ".json"),
            csv: ResearchArchiveCSVDocument(data: csv, filename: filename + ".csv")
        )
    }

    private static func csvRows(_ turn: InvestigationTurn, archived: Bool) -> [[String]] {
        var rows = [["类型", "标题", "内容", "分类", "支持程度", "来源ID", "页码", "来源网址", "逐字引文"]]
        rows.append(["报告", turn.symbol, turn.question, archived ? "历史版本，当前适用性未重新核验" : "生成时已核验", "", "", "", "", ""])
        rows.append(["核心判断", "", turn.analysis.reasoning?.summary ?? "", "", "", "", "", "", ""])
        rows.append(["主要不确定性", "", turn.analysis.largestUnknown.text, "", "", "", "", "", ""])
        let sources = Dictionary(uniqueKeysWithValues: turn.sources.map { ($0.id, $0) })
        func add(_ kind: String, _ heading: String, _ text: String, _ classification: String,
                 _ support: String, _ basis: [InvestigationAnalysis.Claim.Basis], _ missingEvidence: String) {
            rows.append([kind, heading, text, classification, support, "", "", "", ""])
            if !missingEvidence.isEmpty {
                rows.append(["判断限制", heading, missingEvidence, "", "", "", "", "", ""])
            }
            for cited in basis {
                let source = sources[cited.sourceId]
                rows.append(["引用", heading, "", "", "", cited.sourceId,
                             source?.pageNumber.map(String.init) ?? "", source?.url ?? "", cited.quote])
            }
        }
        if let report = turn.analysis.report {
            for section in report.sections {
                add("正文", section.heading, section.text, section.classification, section.support, section.basis, section.missingEvidence)
            }
        } else {
            for claim in turn.analysis.possibleExplanations + turn.analysis.weakenedExplanations {
                add("主要分析", "", claim.text, claim.classification, claim.support, claim.basis, claim.missingEvidence)
            }
        }
        for fact in turn.analysis.whatHappened + turn.analysis.confirmedInformation {
            add("事实", "", fact.text, fact.classification, fact.support, fact.basis, fact.missingEvidence)
        }
        rows.append(["后续观察", "", turn.analysis.nextCheck, "", "", "", "", "", ""])
        for gap in turn.gaps {
            rows.append(["资料缺口", "", gap.text, gap.reason, "", "", "", "", ""])
        }
        for source in turn.sources {
            rows.append(["来源记录", source.source, source.text, source.readStatus, "", source.id,
                         source.pageNumber.map(String.init) ?? "", source.url ?? "", ""])
        }
        return rows
    }

    private static func pdfBlocks(_ turn: InvestigationTurn, archived: Bool) -> [(text: String, heading: Bool)] {
        var blocks: [(text: String, heading: Bool)] = [
            (turn.question, true),
            ("\(turn.symbol) · \(turn.generatedDescription) · \(archived ? "历史版本，当前适用性未重新核验" : "生成时已通过核验")", false),
            ("核心判断", true),
            (turn.analysis.reasoning?.summary ?? turn.analysis.whatHappened.first?.text ?? "", false),
            ("最重要的不确定性", true),
            (turn.analysis.largestUnknown.text, false)
        ]
        let sources = Dictionary(uniqueKeysWithValues: turn.sources.map { ($0.id, $0) })
        func add(_ title: String, _ text: String, _ basis: [InvestigationAnalysis.Claim.Basis], _ missingEvidence: String) {
            blocks.append((title, true)); blocks.append((text, false))
            if !missingEvidence.isEmpty { blocks.append(("判断的限制：\(missingEvidence)", false)) }
            for cited in basis {
                let source = sources[cited.sourceId]
                let label = source.map { "\($0.source)\($0.pageNumber.map { " · 第\($0)页" } ?? "")" } ?? cited.sourceId
                blocks.append(("依据：\(label)｜\(cited.quote)", false))
            }
        }
        if let report = turn.analysis.report {
            for section in report.sections { add(section.heading, section.text, section.basis, section.missingEvidence) }
        } else {
            for claim in turn.analysis.possibleExplanations + turn.analysis.weakenedExplanations {
                add("主要分析", claim.text, claim.basis, claim.missingEvidence)
            }
        }
        blocks.append(("核查依据", true))
        for fact in turn.analysis.whatHappened + turn.analysis.confirmedInformation {
            add("关键事实", fact.text, fact.basis, fact.missingEvidence)
        }
        blocks.append(("后续观察", true)); blocks.append((turn.analysis.nextCheck, false))
        blocks.append(("资料范围与时间", true))
        for gap in turn.gaps { blocks.append(("资料缺口：\(gap.text)", false)) }
        for source in turn.sources {
            blocks.append(("\(source.id) · \(source.source)\(source.pageNumber.map { " · 第\($0)页" } ?? "") · \(source.readStatus) · 发布 \(source.publishedAt ?? "未提供") · 读取 \(source.retrievedAt)\(source.url.map { " · \($0)" } ?? "")", false))
        }
        return blocks
    }
}

/// Compares retained statements and source identities without inventing a causal explanation.
struct InvestigationReportComparison: View {
    let previous: InvestigationTurn
    let current: InvestigationTurn

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(current.symbol).font(.title2.bold())
                Text("上次：" + previous.generatedDescription + "\n本次：" + current.generatedDescription)
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                Text(previous.question == current.question
                     ? "以下对照同一问题的两次研究，保留各自当时的判断。"
                     : "两次研究的问题不同，结论差异不等于公司发生变化。请先核对研究范围。")
                comparison("研究问题", previous.question, current.question)
                comparison("核心判断", summary(previous), summary(current))
                comparison("主要未知", previous.analysis.largestUnknown.text, current.analysis.largestUnknown.text)
                comparison("下一步观察", previous.analysis.nextCheck, current.analysis.nextCheck)
                VStack(alignment: .leading, spacing: 12) {
                    Text("资料变化").font(.title3.bold())
                    Text(previous.fingerprint == current.fingerprint
                         ? "基础资料一致；补读来源仍可能不同。"
                         : "基础资料或核验规则发生变化，旧报告不自动成为当前依据。")
                    sourceChanges("本次新增或版本变化的来源", added)
                    sourceChanges("本次未再纳入的旧来源", removed)
                    if added.isEmpty && removed.isEmpty {
                        Text("两份报告记录的来源版本与读取状态一致。措辞变化本身不能证明事实变化。")
                    }
                    Text("来源变化按网址、页码、内容版本与读取状态核对；未再纳入不等于原事实已被推翻。")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }.padding(24).font(.body).lineSpacing(6).textSelection(.enabled)
        }.navigationTitle("研究变化对照").navigationBarTitleDisplayMode(.inline)
    }
    private func summary(_ turn: InvestigationTurn) -> String {
        turn.analysis.reasoning?.summary ?? turn.analysis.whatHappened.first?.text ?? "未形成摘要"
    }
    private func comparison(_ title: String, _ before: String, _ after: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            Text(title).font(.title3.bold())
            if before == after {
                Text("与上次一致").font(.caption).foregroundStyle(Theme.textSecondary)
                Text(after)
            } else {
                Text("上次").font(.headline); Text(before)
                Text("本次").font(.headline); Text(after)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func identity(_ source: InvestigationSource) -> [String] {
        [source.symbol, source.sourceType, source.url ?? source.source,
         source.pageNumber.map(String.init) ?? "", source.contentSha256, source.readStatus]
            + (source.snapshotCitation?.identityParts ?? ["no_snapshot_citation"])
    }
    private var added: [InvestigationSource] {
        let old = Set(previous.sources.map(identity))
        return current.sources.filter { !old.contains(identity($0)) }
    }
    private var removed: [InvestigationSource] {
        let latest = Set(current.sources.map(identity))
        return previous.sources.filter { !latest.contains(identity($0)) }
    }
    @ViewBuilder private func sourceChanges(_ title: String, _ sources: [InvestigationSource]) -> some View {
        if !sources.isEmpty {
            Text(title).font(.headline)
            ForEach(sources) { source in
                Text(source.source + (source.pageNumber.map { " · 第 \($0) 页" } ?? ""))
                Text(source.readStatus == "BODY_READ" ? "已读取正文或行情" : "未读正文 · 仅作线索")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
        }
    }
}
