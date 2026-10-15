import SwiftUI

struct PersonalBrief: Codable {
    struct FactSource: Codable {
        let documentId: String
        let pageNumber: Int
        let pageTextSha256: String
        let documentPdfSha256: String
        let sourceUrl: String?
        let publishedAt: String
        let title: String
    }
    struct Metric: Codable, Identifiable {
        let key: String
        let label: String
        let current: Double
        let previous: Double
        let unit: String
        let changePercent: Double?
        let sourceDocumentId: String
        let sourcePageNumber: Int?
        let exactSources: [FactSource]
        let crossCheckedAgainstDocumentId: String
        var id: String { key }

        func displayValue(_ value: Double) -> String {
            if unit == "%" { return InvestigationFinancialDisplay.number(value) + "%" }
            let suffix = " 十亿元"
            if unit.hasSuffix(suffix) {
                return InvestigationFinancialDisplay.amount(value, scale: 1_000_000_000,
                    currency: String(unit.dropLast(suffix.count)))
            }
            return InvestigationFinancialDisplay.number(value) + " " + unit
        }
    }
    struct Source: Codable, Identifiable {
        let id: String
        let documentId: String
        let pageNumber: Int
        let title: String
        let publishedAt: String
        let sourceUrl: String?
        let pageTextSha256: String
        let excerpt: String
    }
    struct Note: Codable, Identifiable {
        let id: String
        let text: String
        let createdAt: String
        let kind: String
    }
    struct LatestFinancialDocument: Codable {
        let id: String
        let title: String
        let pdfSha256: String
        let sourceUrl: String?
        let publishedAt: String
    }
    let status: String
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let asOf: String
    let period: String?
    let comparisonPeriod: String?
    let financialScope: String?
    let summary: String
    let metrics: [Metric]
    let sources: [Source]
    let notes: [Note]
    let latestFinancialDocument: LatestFinancialDocument?
    let unresolvedMetrics: [String]
    let fingerprint: String
    let message: String
    let generationMethod: String
}

struct PersonalAnswer: Codable, Identifiable {
    struct Section: Codable, Identifiable {
        let kind: String
        let text: String
        let sourceIds: [String]
        var id: String { "\(kind):\(text)" }
    }
    struct Reference: Codable, Identifiable {
        let id: String
        let documentId: String
        let pageNumber: Int
        let title: String
        let publishedAt: String
        let sourceUrl: String?
        let pageTextSha256: String
    }
    struct Usage: Codable { let promptTokens: Int?; let completionTokens: Int?; let totalTokens: Int? }
    struct Sent: Codable { let fullPdf: Bool; let officialAssets: Bool; let credentials: Bool; let sourcePages: Int; let requestSha256: String }
    let ok: Bool
    let symbol: String
    let membershipId: String
    let fingerprint: String
    let question: String
    let sections: [Section]
    let nextChecks: [String]
    let usage: Usage
    let sourceReferences: [Reference]
    let provider: String
    let model: String
    let generatedAt: String
    let sent: Sent
    var id: String { "\(generatedAt):\(question)" }
}

private struct PersonalBriefError: Decodable { let code: String?; let message: String? }

@MainActor
enum PersonalBriefClient {
    static func url(_ membershipId: String) -> URL {
        AppEnvironment.baseURL().appending(path: "api/mobile/research/candidate-memberships/\(membershipId)/personal-brief")
    }

    static func load(_ member: CandidateMembershipData) async throws -> PersonalBrief {
        var request = URLRequest(url: url(member.id), cachePolicy: .reloadIgnoringLocalCacheData)
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = auth.readToken { request.setValue(token, forHTTPHeaderField: auth.readHeaderName) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let brief = try JSONDecoder().decode(PersonalBrief.self, from: data)
        guard auth == AppEnvironment.researchAuthorizationContext(),
              brief.symbol == member.symbol, brief.membershipId == member.id,
              brief.membershipVersion == member.version else { throw URLError(.cannotParseResponse) }
        return brief
    }

    static func ask(_ member: CandidateMembershipData, brief: PersonalBrief, question: String,
                    priorAnswers: [PersonalAnswer]) async throws -> PersonalAnswer {
        var request = URLRequest(url: url(member.id).appending(path: "questions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = auth.writeToken { request.setValue(token, forHTTPHeaderField: auth.writeHeaderName) }
        let lockedIds = Set(brief.sources.map(\.id))
        let priorTurns: [[String: Any]] = priorAnswers.suffix(2).compactMap { answer in
            guard answer.symbol == brief.symbol, answer.membershipId == brief.membershipId,
                  answer.fingerprint == brief.fingerprint else { return nil }
            let ids = Array(Set(answer.sections.flatMap(\.sourceIds)).intersection(lockedIds)).sorted()
            let text = answer.sections.map { "\($0.kind)：\($0.text)" }.joined(separator: "；")
            guard !ids.isEmpty, text.count >= 3 else { return nil }
            return ["symbol": answer.symbol, "membershipId": answer.membershipId,
                    "fingerprint": answer.fingerprint, "question": answer.question,
                    "answer": String(text.prefix(1500)), "sourceIds": Array(ids.prefix(6))]
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: ["fingerprint": brief.fingerprint,
            "question": question, "priorTurns": priorTurns])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard auth == AppEnvironment.researchAuthorizationContext() else { throw URLError(.cancelled) }
#if DEBUG
        UserDefaults.standard.set(data, forKey: "company-assistant-last-raw-response")
#endif
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let error = try? JSONDecoder().decode(PersonalBriefError.self, from: data)
            throw NSError(domain: "PersonalResearch", code: (response as? HTTPURLResponse)?.statusCode ?? 1,
                userInfo: [NSLocalizedDescriptionKey: error?.message ?? error?.code ?? "研究助手暂不可用，请核对来源与连接。"])
        }
        let answer = try JSONDecoder().decode(PersonalAnswer.self, from: data)
        guard answer.ok, answer.question == question, answer.symbol == member.symbol, answer.membershipId == member.id,
              answer.fingerprint == brief.fingerprint,
              answer.sections.allSatisfy({ section in section.sourceIds.allSatisfy({ id in brief.sources.contains(where: { $0.id == id }) }) })
        else { throw URLError(.cannotParseResponse) }
        return answer
    }

    static func saveNote(_ member: CandidateMembershipData, text: String, key: String) async throws {
        let now = Date(), expires = Calendar.current.date(byAdding: .year, value: 1, to: now) ?? now.addingTimeInterval(365 * 86_400)
        let body: [String: Any] = ["membershipId": member.id, "membershipVersion": member.version,
            "title": "我的研究笔记", "contentText": text, "sourceType": "personal_research_note",
            "publishedAt": ISO8601DateFormatter().string(from: now), "claimType": "model_inference",
            "verificationStatus": "unverified", "rightsStatus": "user_provided", "sourceVersion": "personal-note-v1",
            "validUntil": ISO8601DateFormatter().string(from: expires), "summary": text, "stance": "neutral",
            "isRead": true, "idempotencyKey": key]
        var request = URLRequest(url: AppEnvironment.baseURL().appending(path: "api/mobile/research/profiles/HK/\(member.code)/materials"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let auth = AppEnvironment.researchAuthorizationContext()
        if let token = auth.writeToken { request.setValue(token, forHTTPHeaderField: auth.writeHeaderName) }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let error = try? JSONDecoder().decode(PersonalBriefError.self, from: data)
            throw NSError(domain: "PersonalResearch", code: 2,
                userInfo: [NSLocalizedDescriptionKey: error?.message ?? error?.code ?? "笔记未保存。"])
        }
    }
}

enum PersonalBriefPresentation { case overview, analysis, notes, continueReading }

struct PersonalResearchBriefSection: View {
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var requestRevision = UUID()
    @State private var summaryTask: Task<Void, Never>?
    let membership: CandidateMembershipData
    var presentation: PersonalBriefPresentation = .overview
    @State private var brief: PersonalBrief?
    @State private var issue: String?
    @State private var investigation: PersonalInvestigationSelection?
    @State private var latestInvestigation: InvestigationTurn?
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let brief {
                if presentation == .overview {
                    HStack {
                        Text("财务概览").font(.headline)
                        Spacer()
                        NavigationLink("查看全部") { PersonalResearchDetailView(membership: membership, initialBrief: brief) }.font(.footnote)
                    }
                    Text([brief.period, brief.financialScope].compactMap { $0 }.joined(separator: " · ").replacingOccurrences(of: "consolidated", with: "合并口径").replacingOccurrences(of: "CNY", with: "人民币"))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                    let metrics = brief.metrics.filter { ["profit_attributable_to_owners", "operating_cash_flow"].contains($0.key) }
                    if metrics.isEmpty {
                        Text(brief.summary).font(.body).foregroundStyle(Theme.textSecondary)
                    } else {
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: 24) { ForEach(metrics) { metric in metricSummary(metric) } }
                            VStack(alignment: .leading, spacing: 16) { ForEach(metrics) { metric in metricSummary(metric) } }
                        }
                    }
                    if let source = metrics.first?.exactSources.first {
                        Text("\(source.title) · 第 \(source.pageNumber) 页 · \(source.publishedAt.prefix(10)) 发布")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    Divider()
                }
                if presentation == .notes {
                    NavigationLink { PersonalResearchDetailView(membership: membership, initialBrief: brief) } label: {
                        WorkspaceRowLabel(title: "我的笔记", subtitle: "个人记录，不作为已核实事实", icon: "note.text")
                    }.buttonStyle(.plain).accessibilityIdentifier("personalResearchOpen")
                } else {
                    if let latestInvestigation {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(presentation == .continueReading ? "继续研究 · \(membership.research.name ?? membership.symbol)" : "最近一次分析").font(.headline)
                                Spacer()
                                Text("AI 解释").font(.caption).foregroundStyle(Theme.gold)
                            }
                            Button { open(brief) } label: {
                                WorkspaceRowLabel(title: latestInvestigation.question,
                                    subtitle: latestInvestigation.analysis.reasoning?.summary ?? "查看分析与依据", titleLineLimit: 2, subtitleLineLimit: 3)
                            }.buttonStyle(.plain)
                            Text("\(latestInvestigation.generatedDescription) · 阅读分析与依据")
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                    } else {
                        Text(presentation == .continueReading ? "继续研究 · \(membership.research.name ?? membership.symbol)" : "研究分析").font(.headline)
                        Text("\(membership.research.name ?? membership.symbol) · 尚无通过当前资料校验的分析，可以先阅读资料或提出问题。")
                            .font(.subheadline).foregroundStyle(Theme.textSecondary)
                    }
                    if presentation != .continueReading {
                        WorkspacePrimaryButton(title: "提出研究问题", icon: "sparkles") {
                            investigation = PersonalInvestigationSelection(membershipId: membership.id, membershipVersion: membership.version,
                                symbol: membership.symbol, mode: "earnings_quality", question: "", startAnalysis: false, resumeExisting: false)
                        }.accessibilityIdentifier("researchAnalyzeEarnings")
                        if presentation == .analysis {
                            Button("调查某天的价格变化") {
                                investigation = PersonalInvestigationSelection(membershipId: membership.id, membershipVersion: membership.version,
                                    symbol: membership.symbol, mode: "price_move", question: "", startAnalysis: false, resumeExisting: false)
                            }.frame(minHeight: 44)
                        }
                    } else if latestInvestigation == nil {
                        NavigationLink { PersonalResearchDetailView(membership: membership, initialBrief: brief) } label: {
                            WorkspaceRowLabel(title: "阅读已有财务资料", icon: "doc.text")
                        }.buttonStyle(.plain)
                    }
                }
            } else if issue != nil {
                Text("研究摘要暂未取得，其他资料仍可继续阅读。")
                    .font(.subheadline).foregroundStyle(Theme.textSecondary)
                Button("重新读取摘要") { Task { await load() } }.frame(minHeight: 44)
            } else { ProgressView("正在读取公司资料…") }
        }.sheet(item: $investigation, onDismiss: {
            refreshSummary()
            store.finishPersonalFormalDismissal()
        }) { PersonalInvestigationView(selection: $0) }
            .task(id: "\(membership.id):\(membership.version):\(membership.symbol):\(store.authorizationRevision)") { await load() }
            .onDisappear { summaryTask?.cancel() }
    }
    private func metricSummary(_ metric: PersonalBrief.Metric) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(metric.label).font(.footnote).foregroundStyle(Theme.textSecondary)
            Text(metric.displayValue(metric.current)).font(.title3.weight(.medium)).monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
            Text(metric.changePercent.map { String(format: "同比 %+.2f%%", $0) } ?? "期间口径不可比")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func open(_ value: PersonalBrief) {
        investigation = PersonalInvestigationSelection(membershipId: membership.id, membershipVersion: membership.version,
            symbol: membership.symbol, mode: "earnings_quality", question: "", startAnalysis: false)
    }
    private func load() async {
        let revision = UUID(); requestRevision = revision; summaryTask?.cancel()
        brief = nil; issue = nil; latestInvestigation = nil
        do {
            let result = try await PersonalBriefClient.load(membership)
            guard !Task.isCancelled, requestRevision == revision else { return }
            brief = result; refreshSummary()
        } catch { if !Task.isCancelled, requestRevision == revision { issue = error.localizedDescription } }
    }
    private func refreshSummary() {
        guard let brief else { latestInvestigation = nil; return }
        latestInvestigation = nil
        summaryTask?.cancel()
        let authorization = AppEnvironment.researchAuthorizationContext()
        summaryTask = Task {
            let answer = await InvestigationResultCache.read(id: membership.id, version: membership.version,
                symbol: membership.symbol, anchor: brief.fingerprint)
            guard !Task.isCancelled, authorization == AppEnvironment.researchAuthorizationContext(),
                  self.brief?.fingerprint == brief.fingerprint, answer?.symbol == membership.symbol,
                  answer?.membershipId == membership.id, answer?.membershipVersion == membership.version else { return }
            latestInvestigation = answer
        }
    }
    private func resultLine(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.bold())
            Text(text).font(.caption).foregroundStyle(Theme.textSecondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func earningsQuestion(_ value: PersonalBrief) -> String {
        if let revenue = value.metrics.first(where: { $0.key == "revenue" })?.changePercent,
           let profit = value.metrics.first(where: { $0.key == "profit_attributable_to_owners" })?.changePercent,
           revenue > 0, profit < revenue {
            return "收入增长为什么没有完全体现为利润增长？请核对利润表、现金流和相关附注。"
        }
        return "收入、利润与经营现金流的变化是否一致？请核对利润表、现金流和相关附注，不预设增长或下降。"
    }
    private func earningsImpact(_ value: PersonalBrief) -> String {
        guard let revenue = value.metrics.first(where: { $0.key == "revenue" }),
              let profit = value.metrics.first(where: { $0.key == "profit_attributable_to_owners" }) else {
            return "尚未取得同口径的收入与归母利润数值，先核对官方正文。"
        }
        return "收入同比 \(revenue.changePercent.map { String(format: "%+.2f%%", $0) } ?? "不可比")；归母利润同比 \(profit.changePercent.map { String(format: "%+.2f%%", $0) } ?? "不可比")。数值方向不等于经营原因，原因需结合附注核查。"
    }

}

private struct PersonalResearchDetailView: View {
    let membership: CandidateMembershipData
    let initialBrief: PersonalBrief
    @Environment(\.antigravityActions) private var actions
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var isClosingForFormalPreparation = false
    @State private var brief: PersonalBrief
    @State private var question = "依据最新已发布且口径可比的官方经营/财务资料，收入、毛利率、利润与经营现金流分别发生了什么变化？经营改善是否有盈利和现金支持？哪些解释成立、哪些只是可能，下一步最值得核查什么？"
    @State private var turns: [PersonalAnswer] = []
    @State private var note = ""
    @State private var noteKey = "personal-note-\(UUID().uuidString.lowercased())"
    @State private var asking = false
    @State private var saving = false
    @State private var issue: String?
    @State private var savedMessage: String?
    @State private var investigation: PersonalInvestigationSelection?

    init(membership: CandidateMembershipData, initialBrief: PersonalBrief) {
        self.membership = membership
        self.initialBrief = initialBrief
        self._brief = State(initialValue: initialBrief)
    }

    private var conversationKey: String {
        "personal-research:\(AppEnvironment.baseURL().absoluteString):\(membership.actorId):\(brief.symbol):\(brief.fingerprint)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(membership.research.name ?? membership.symbol) · \(brief.symbol)").font(.title3.weight(.bold))
                    Text("\(brief.period.map { "财务期间 " + $0 + " · " } ?? "")来源截至 \(brief.sources.first?.publishedAt.prefix(10) ?? "尚未取得")")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                    Text(brief.summary).font(.body).accessibilityIdentifier("personalResearchDetailSummary")
                    Text("确定性计算摘要 · 不代表 AI 观点或买卖判断").font(.caption).foregroundStyle(Theme.gold)
                }.padding(14).templateCardStyle()

                VStack(alignment: .leading, spacing: 10) {
                    Text("盈利与现金流").font(.headline)
                    if let firstSource = brief.metrics.first?.exactSources.first,
                       let latest = brief.latestFinancialDocument {
                        Text("结构化数值来自 \(firstSource.title)（doc \(firstSource.documentId)）；最新完整报告 \(latest.title)（doc \(latest.id)）用于交叉核查。")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    if brief.metrics.isEmpty { Text("本页尚未列出完整的可比指标，可在深度研究中结合原文进一步核对。") }
                    Button("进入深度研究，先阅读资料") {
                        investigation = PersonalInvestigationSelection(membershipId: membership.id, membershipVersion: membership.version,
                            symbol: membership.symbol, mode: "earnings_quality", question: question)
                    }.accessibilityIdentifier("personalResearchReadEvidence")
                    ForEach(brief.metrics) { metric in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(metric.label).font(.headline)
                            Text(metric.displayValue(metric.current)).font(.title3.weight(.medium)).monospacedDigit()
                                .fixedSize(horizontal: false, vertical: true)
                            Text("上期 " + metric.displayValue(metric.previous))
                                .font(.callout).foregroundStyle(Theme.textSecondary)
                            if let change = metric.changePercent {
                                Text(String(format: "同比 %+.2f%%", change)).font(.callout).foregroundStyle(Theme.textSecondary)
                            } else if metric.key != "gross_margin" {
                                Text("同比暂不可比").font(.callout).foregroundStyle(Theme.textSecondary)
                            }
                        if let source = metric.exactSources.first {
                            Text("出处 doc \(source.documentId) 第 \(source.pageNumber) 页 · 已与 doc \(metric.crossCheckedAgainstDocumentId) 核对")
                                .font(.caption2).foregroundStyle(Theme.textSecondary)
                        }
                        }
                    }
                    if !brief.unresolvedMetrics.isEmpty {
                        Text("来源尚待核对：\(brief.unresolvedMetrics.map { $0 == "core_profit_attributable_to_owners" ? "发行人定义核心归母利润" : $0 }.joined(separator: "、"))。未把这些指标作为当前数值或发送给 AI。")
                            .font(.caption).foregroundStyle(Theme.amber)
                    }
                    Text("核心利润是发行人定义的非会计准则指标；资本支出与现金流代理值不等于可分配现金。")
                        .font(.caption).foregroundStyle(Theme.gold)
                }.padding(14).templateCardStyle()

                VStack(alignment: .leading, spacing: 10) {
                    Text("资料与引用").font(.headline)
                    if let latest = brief.latestFinancialDocument {
                        Text("最新完整官方财务原件：\(latest.title) · doc \(latest.id)。结构化数值保留各自较早原始出处；两者分开展示。")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(brief.sources) { source in
                        DisclosureGroup("\(source.id) · \(source.title) · PDF 第 \(source.pageNumber) 页") {
                            Text(source.excerpt).font(.caption).textSelection(.enabled)
                            if let raw = source.sourceUrl, let url = URL(string: raw) {
                                Link("打开发行人原件", destination: url)
                            }
                        }.font(.caption)
                    }
                    Button("在证据库核对完整 PDF") { actions.workflow(.materials) }
                }.padding(14).templateCardStyle()

                VStack(alignment: .leading, spacing: 10) {
                    Text("向研究助手提问").font(.headline)
                    TextField("围绕当前资料提一个具体问题", text: $question, axis: .vertical)
                        .lineLimit(3...7).accessibilityIdentifier("personalResearchQuestion")
                    Button("问研究助手") {
                        investigation = PersonalInvestigationSelection(membershipId: membership.id, membershipVersion: membership.version,
                            symbol: membership.symbol, mode: "earnings_quality", question: question, startAnalysis: true)
                    }
                        .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || brief.status != "available")
                        .accessibilityIdentifier("personalResearchAsk")
                    if !turns.isEmpty { DisclosureGroup("早期问答记录") { ForEach(turns) { turn in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(turn.question).font(.subheadline.weight(.semibold))
                            ForEach(turn.sections) { section in
                                Text("\(sectionTitle(section.kind)) · \(section.text)")
                                Text(section.sourceIds.joined(separator: "、"))
                                    .font(.caption).foregroundStyle(Theme.blue)
                            }
                            if !turn.nextChecks.isEmpty { Text("下一步：\(turn.nextChecks.joined(separator: "；"))") }
                            Text("分析时间 · \(turn.generatedAt)")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                        }.padding(12).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityIdentifier("personalResearchAnswer")
                    } } }
                }.padding(14).templateCardStyle()

                VStack(alignment: .leading, spacing: 10) {
                    Text("我的研究笔记（可选）").font(.headline)
                    Text("只保存个人草稿，不创建正式观点、情景或复核。笔记不会发送给 AI。")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                    TextField("下一次想核查什么？", text: $note, axis: .vertical).lineLimit(2...5)
                        .accessibilityIdentifier("personalResearchNote")
                    Button(saving ? "保存中…" : "保存笔记") { Task { await saveNote() } }
                        .disabled(saving || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("personalResearchSaveNote")
                    if let savedMessage { Text(savedMessage).foregroundStyle(Theme.green) }
                    ForEach(brief.notes) { saved in
                        VStack(alignment: .leading) {
                            Text(saved.kind == "owner_note" ? "Owner 个人笔记 · 未核验" : "未核验记录")
                                .font(.caption).foregroundStyle(Theme.gold)
                            Text(saved.text)
                            Text(saved.createdAt.prefix(10)).font(.caption).foregroundStyle(Theme.textSecondary)
                        }
                    }
                }.padding(14).templateCardStyle()
                if let issue { Text(issue).foregroundStyle(Theme.amber).font(.caption) }
            }.padding(16)
        }
        .background(Theme.bgPrimary)
        .navigationTitle("个人研究")
        .sheet(item: $investigation, onDismiss: {
            guard store.hasPersonalFormalDismissalPending else { return }
            isClosingForFormalPreparation = true
            dismiss()
        }) { PersonalInvestigationView(selection: $0) }
        .task { restoreTurns() }
        .onDisappear {
            guard isClosingForFormalPreparation else { return }
            isClosingForFormalPreparation = false
            store.finishPersonalFormalDismissal()
        }
    }

    private func sectionTitle(_ kind: String) -> String {
        ["fact": "事实", "interpretation": "解释", "counter": "反方证据", "unknown": "仍未知"][kind] ?? kind
    }

    private func restoreTurns() {
        guard let data = UserDefaults.standard.data(forKey: conversationKey),
              let saved = try? JSONDecoder().decode([PersonalAnswer].self, from: data) else { return }
        turns = saved.filter { $0.symbol == brief.symbol && $0.membershipId == brief.membershipId && $0.fingerprint == brief.fingerprint }
    }

    private func ask() async {
        guard !asking else { return }
        asking = true; issue = nil
        defer { asking = false }
        do {
            let answer = try await PersonalBriefClient.ask(membership, brief: brief,
                question: question.trimmingCharacters(in: .whitespacesAndNewlines), priorAnswers: turns)
            turns.append(answer)
            if let data = try? JSONEncoder().encode(turns) { UserDefaults.standard.set(data, forKey: conversationKey) }
        } catch {
            if (error as NSError).domain == "PersonalResearch", (error as NSError).code == 409 {
                turns = []
                UserDefaults.standard.removeObject(forKey: conversationKey)
                if let current = try? await PersonalBriefClient.load(membership) { brief = current }
            }
            issue = "AI 服务：\(error.localizedDescription)"
        }
    }

    private func saveNote() async {
        guard !saving else { return }
        saving = true; issue = nil; savedMessage = nil
        defer { saving = false }
        do {
            try await PersonalBriefClient.saveNote(membership, text: note.trimmingCharacters(in: .whitespacesAndNewlines), key: noteKey)
            brief = try await PersonalBriefClient.load(membership)
            note = ""; noteKey = "personal-note-\(UUID().uuidString.lowercased())"
            savedMessage = "笔记已保存并读回；正式研究记录未变。"
        } catch { issue = "笔记：\(error.localizedDescription)" }
    }
}
