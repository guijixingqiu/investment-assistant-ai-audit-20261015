import Foundation
import SwiftUI

/// The peer list is a versioned part of the existing research context.
/// No peer is inferred from the candidate list or from an AI report.
@MainActor
struct CompanyResearchPeersView: View {
    let membership: CandidateMembershipData
    let onSaved: (ResearchContextEnvelope) -> Void
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var context: ResearchContextEnvelope?
    @State private var documents: ResearchDocumentListEnvelope?
    @State private var evidence: FrozenResearchEvidenceWorkspace?
    @State private var sourceMemberId = ""
    @State private var loading = false
    @State private var busy = false
    @State private var message = ""
    @State private var loadedIdentity = ""
    @State private var pendingRequest: CreateResearchContextRequest?
    @State private var peerSymbol = ""
    @State private var peerName = ""
    @State private var peerStatus = ""
    @State private var peerReason = ""
    @State private var editingPeerSymbol = ""
    @State private var industry = ""
    @State private var selectedDocumentId = ""
    @State private var sourceKind = "pdf"
    @State private var selectedMaterialId = ""
    @State private var selectedProviderPageId = ""
    @State private var pageNumber = 1
    @State private var validUntil = Date().addingTimeInterval(90 * 24 * 60 * 60)
    @State private var editingFactSymbol = ""
    @State private var factMetric = ""
    @State private var factValue = ""
    @State private var factUnit = ""
    @State private var factCurrency = ""
    @State private var factPeriodMode = ""
    @State private var factPeriodStart = Calendar.current.date(byAdding: .year, value: -1, to: Date()) ?? Date()
    @State private var factPeriodEnd = Date()
    @State private var selectedComparisonPeriodId = ""

    private struct ComparisonPeriod: Identifiable {
        let start: String?
        let end: String
        var id: String { "\(start ?? "point")|\(end)" }
        var title: String {
            if let start, end.hasSuffix("-12-31"), start == "\(end.prefix(4))-01-01" {
                return "\(end.prefix(4)) 年度（1月—12月）"
            }
            return start.map { "\($0) 至 \(end)" } ?? "截至 \(end) 的时点"
        }
    }

    private var isCurrent: Bool {
        api.currentSymbol == membership.symbol
            && api.membershipEnvelope?.memberships.contains(where: {
                $0.id == membership.id && $0.version == membership.version
                    && $0.actorId == membership.actorId && $0.symbol == membership.symbol
                    && $0.state == .tracked
            }) == true
    }
    private var taskKey: String {
        "\(membership.id):\(membership.version):\(api.currentSymbol):\(api.authorizationRevision)"
    }
    private var current: ResearchContextData? {
        context?.status == .available ? context?.data : nil
    }
    private var peers: [ResearchContextPeer] { current?.peers ?? [] }
    private var peerMembers: [CandidateMembershipData] {
        (api.membershipEnvelope?.memberships ?? []).filter {
            $0.actorId == membership.actorId && $0.id != membership.id && $0.state == .tracked
        }
    }
    private var sourceMembership: CandidateMembershipData? {
        if sourceMemberId.isEmpty || sourceMemberId == membership.id { return membership }
        return peerMembers.first { $0.id == sourceMemberId && $0.symbol == peerSymbol }
    }
    private func sourceIssue(_ peer: ResearchContextPeer) -> ResearchPeerSourceIssue? {
        context?.peerSourceIssues?.first { $0.peerId == peer.id && $0.symbol == peer.symbol }
    }
    private var availableDocuments: [ResearchDocumentData] {
        guard let sourceMembership else { return [] }
        return (documents?.documents ?? []).filter {
            $0.membershipId == sourceMembership.id && $0.membershipVersionAtImport == sourceMembership.version
                && $0.symbol == sourceMembership.symbol && $0.isSourceAvailable
                && $0.sourceClassification == "owner_declared_official"
                && $0.rightsStatus == "user_provided"
        }
    }
    private var selectedDocument: ResearchDocumentData? {
        availableDocuments.first { $0.id == selectedDocumentId }
    }
    private var availableMaterials: [ResearchMaterialData] {
        guard let sourceMembership else { return [] }
        return (evidence?.data?.materials ?? []).filter { item in
            item.validates(expected: sourceMembership) && item.symbol == sourceMembership.symbol && item.revisionState == "current"
                && item.freshness == "fresh" && researchContextDate(item.validUntil).map { $0 > Date() } == true
                && (item.sourceType == "issuer_public_html" && item.rightsStatus == "authorized_public"
                    && item.snapshotCitation?.isValid == true && item.snapshotOriginal?.isValid == true
                    || item.sourceType == "futu_opend_financial_statement_provider"
                        && item.futuFinancialSource?.validates(sourceMembership) == true)
        }
    }
    private var selectedMaterial: ResearchMaterialData? {
        availableMaterials.first { $0.id == selectedMaterialId && $0.sourceType == sourceKind }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("\(membership.symbol) · 可比同行").font(.title2.bold())
                Text("逐家说明比较维度、纳入或排除理由，并绑定已保存原件的确切定位。完整研究需有依据的 3–5 家；不足时保留不足。")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button("刷新同行与来源") { Task { await refresh() } }
                    .disabled(busy)
                if !isCurrent {
                    Text("研究公司、成员版本或授权已变化；请返回后重新打开。")
                        .foregroundStyle(.orange)
                } else {
                    if loading { ProgressView("正在读取同行和来源…") }
                    if let context, context.status == .unavailable {
                        Text("当前同行记录不可用；暂不能在旧内容上修改。")
                            .foregroundStyle(.orange)
                    }
                    if let current {
                        Text("行业：\(current.industry) · 资料截止：\(current.cutoffAt)")
                            .font(.caption).foregroundStyle(.secondary)
                        DisclosureGroup("来源与公司版本") {
                            Text("研究成员版本 \(current.membershipVersion) · 保存记录 #\(current.id)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if context?.status == .available || context?.status == .notFound {
                        let included = peers.filter { $0.status == "included" && sourceIssue($0) == nil }.count
                        let affected = context?.peerSourceIssues?.count ?? 0
                        let affectedFacts = context?.peerFactSourceIssues?.count ?? 0
                        Text("当前依据可用的纳入同行 \(included) 家 · 同行依据待修复 \(affected) 家 · 数值来源待修复 \(affectedFacts) 条 · 名单最多 5 条")
                            .font(.subheadline.bold())
                        if included < 3 {
                            Text("真正可比同行仍不足 3 家；研究覆盖保持不足。")
                                .font(.caption).foregroundStyle(.orange)
                        }
                        if peers.isEmpty && !loading {
                            Text("当前尚无已保存、带确切来源引用的同行。")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    if !peers.isEmpty { comparisonReadout }
                    DisclosureGroup("逐家核对同行理由与原件") {
                        ForEach(peers) { peer in peerCard(peer) }
                    }
                    DisclosureGroup("维护同行名单与事实") {
                        editCard
                        factCard
                    }
                    if !message.isEmpty { Text(message).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .padding()
        }
        .navigationTitle("可比同行")
        .task(id: taskKey) { await refresh() }
        .onChange(of: api.authorizationRevision) { _, _ in
            context = nil; documents = nil; evidence = nil; pendingRequest = nil
            loadedIdentity = ""; industry = ""; clearDraft()
            message = "读取授权已变化，请重新核对同行和来源。"
        }
        .onChange(of: sourceMemberId) { _, _ in
            documents = nil; evidence = nil
            Task { await loadSourceLists() }
        }
    }

    private var comparisonPeriods: [ComparisonPeriod] {
        let facts = (current?.peerFacts ?? []).filter { fact in
            peers.contains { $0.symbol == fact.symbol && $0.status == "included" }
        }
        let peerPeriods = facts.compactMap { fact -> ComparisonPeriod? in
            guard let end = fact.periodEnd else { return nil }
            return ComparisonPeriod(start: fact.periodStart, end: end)
        }
        let primaryPeriods = (api.boundProviderOperatingReference(symbol: membership.symbol)?.periods ?? [])
            .flatMap(\.values).map { ComparisonPeriod(start: $0.periodStart, end: $0.periodEnd) }
        let unique = Dictionary((peerPeriods + primaryPeriods).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return unique.values.sorted { $0.end == $1.end ? $0.id > $1.id : $0.end > $1.end }
    }

    private var comparisonPeriod: ComparisonPeriod? {
        comparisonPeriods.first { $0.id == selectedComparisonPeriodId } ?? comparisonPeriods.first
    }

    private func comparisonFacts(_ period: ComparisonPeriod, metric: String? = nil) -> [ResearchContextNumericFact] {
        (current?.peerFacts ?? []).filter { fact in
            fact.periodStart == period.start && fact.periodEnd == period.end
                && (metric == nil || fact.metric == metric)
                && peers.contains { $0.symbol == fact.symbol && $0.status == "included" }
        }
    }

    private func comparisonMetrics(_ period: ComparisonPeriod) -> [String] {
        let peerMetrics = comparisonFacts(period).map(\.metric)
        let referenceLabels = (api.boundProviderOperatingReference(symbol: membership.symbol)?.periods ?? [])
            .flatMap(\.values).filter { $0.periodStart == period.start && $0.periodEnd == period.end }
            .compactMap { value -> String? in
                guard !peerMetrics.contains(where: { primaryProviderMetric($0) == value.metric }) else { return nil }
                return value.metric == "revenue" ? "营业收入"
                    : value.metric == "operating_cash_flow" ? "经营现金流净额" : nil
            }
        return Array(Set(peerMetrics + referenceLabels)).sorted { lhs, rhs in
            let lhsMetric = primaryProviderMetric(lhs)
            let rhsMetric = primaryProviderMetric(rhs)
            let lhsPriority = lhsMetric == "revenue" ? 0 : lhsMetric == "operating_cash_flow" ? 1 : 2
            let rhsPriority = rhsMetric == "revenue" ? 0 : rhsMetric == "operating_cash_flow" ? 1 : 2
            return lhsPriority == rhsPriority ? lhs < rhs : lhsPriority < rhsPriority
        }
    }

    private func primaryProviderMetric(_ label: String) -> String? {
        switch label.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "revenue", "营业收入", "营业总收入", "集团营业收入", "营业收入（集团）": "revenue"
        case "operating_cash_flow", "经营现金流", "经营现金流净额", "经营活动产生的现金流量净额": "operating_cash_flow"
        default: nil
        }
    }

    private func readablePeerMetric(_ metric: String) -> String {
        switch metric.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "revenue": "营业收入"
        case "operating_cash_flow": "经营现金流净额"
        case "profit_attributable_to_owners": "归母净利润"
        case "total_assets": "总资产"
        case "total_liabilities": "总负债"
        case "OpenD FY2025 revenue (third-party unverified; scope UNKNOWN)":
            "同行营业收入（2025年度 · OpenD 未核实）"
        case "OpenD FY2025 operating cash flow (third-party unverified; scope UNKNOWN)":
            "同行经营现金流净额（2025年度 · OpenD 未核实）"
        default: metric
        }
    }

    private func readablePeerAmount(_ raw: String, unit: String, currency: String?) -> String {
        guard let currency, !currency.isEmpty,
              let value = Double(raw), value.isFinite else {
            return "\(raw) \(unit) \(currency ?? "币种未标")"
        }
        let scale: Double
        switch unit.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "元", "基础单位", "currency_base_unit": scale = 1
        case "千元": scale = 1_000
        case "百万元": scale = 1_000_000
        case "亿元": scale = 100_000_000
        default: return "\(raw) \(unit) \(currency)"
        }
        return InvestigationFinancialDisplay.amount(value, scale: scale, currency: currency)
    }

    private func peerSourceSummary(_ fact: ResearchContextNumericFact) -> String {
        switch fact.citation {
        case .pdf: "PDF 原页，待人工核对"
        case .savedMaterial(let source):
            source.sourceType == "futu_opend_financial_statement_provider"
                ? "OpenD 第三方未核实" : "已存官方网页，待人工核对"
        }
    }

    private func primaryProviderValue(_ metric: String, period: ComparisonPeriod) -> FutuFinancialHistoryValue? {
        guard let code = primaryProviderMetric(metric),
              let reference = api.boundProviderOperatingReference(symbol: membership.symbol) else { return nil }
        let matches = reference.periods.flatMap(\.values).filter {
            $0.metric == code && $0.periodStart == period.start && $0.periodEnd == period.end
        }
        return matches.count == 1 ? matches[0] : nil
    }

    private func comparableFact(_ peer: ResearchContextPeer, metric: String,
                                period: ComparisonPeriod) -> ResearchContextNumericFact? {
        guard peer.status == "included", sourceIssue(peer) == nil,
              researchContextDate(peer.validUntil).map({ $0 > Date() }) == true else { return nil }
        let matches = comparisonFacts(period, metric: metric).filter { $0.symbol == peer.symbol }
        guard matches.count == 1, let fact = matches.first,
              fact.value?.isEmpty == false,
              context?.peerFactSourceIssues?.contains(where: { $0.factId == fact.id }) != true,
              researchContextDate(fact.validUntil).map({ $0 > Date() }) == true else { return nil }
        return fact
    }

    private func comparisonScopeNote(_ metric: String, period: ComparisonPeriod) -> String {
        let facts = peers.compactMap { comparableFact($0, metric: metric, period: period) }
        guard facts.count >= 2 else { return "该期可核对数值不足两家；缺项不当作零。" }
        guard facts.allSatisfy({ !$0.unit.isEmpty && $0.currency?.isEmpty == false }),
              Set(facts.map(\.unit)).count == 1,
              Set(facts.compactMap(\.currency)).count == 1 else {
            return "单位或币种缺失、不同；不比较大小。"
        }
        return "同名、同期间、同单位币种可并列阅读；主体口径仍需核对，不计算差额或排名。"
    }

    private var comparisonReadout: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("已存同行对照").font(.headline)
            Text("选择同一期间查看各家公司已有数值；只读，不补零、不自动排名。")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(peers) { peer in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(peer.name) · \(peer.symbol) · \(peer.status == "included" ? "纳入" : "排除")")
                        .font(.subheadline.bold())
                    Text(peer.reason).font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("依据与资料截止") {
                        Text("\(peer.citation.sourceLabel) · 截止 \(peer.cutoffAt) · 有效至 \(peer.validUntil)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let issue = sourceIssue(peer) {
                        Text("同行依据待修复").font(.caption).foregroundStyle(.orange)
                        DisclosureGroup("查看原因") {
                            Text(issue.explanation).font(.caption).foregroundStyle(.secondary)
                        }
                    } else if researchContextDate(peer.validUntil).map({ $0 <= Date() }) != false {
                        Text("纳入依据已过有效期；当前比较暂不可用。")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            }
            if comparisonPeriods.isEmpty {
                Text("同行名单已有记录，但没有带明确测量期间的已存数值；营收和经营现金流对照仍为 UNKNOWN。")
                    .font(.caption).foregroundStyle(.orange)
            } else if let period = comparisonPeriod {
                Picker("选择可比期间", selection: Binding(
                    get: { period.id }, set: { selectedComparisonPeriodId = $0 }
                )) {
                    ForEach(comparisonPeriods) { item in Text(item.title).tag(item.id) }
                }
                .accessibilityIdentifier("peerComparisonPeriod")
                Text("测量期间：\(period.title)")
                    .font(.caption).foregroundStyle(.secondary)
                let metrics = comparisonMetrics(period)
                if metrics.isEmpty {
                    Text("这个期间尚无已存同行数值；本公司参考不能替代同行原件。")
                        .font(.caption).foregroundStyle(.orange)
                }
                ForEach(metrics, id: \.self) { metric in
                    comparisonMetricReadout(metric, period: period)
                }
                Text("OpenD 为未核实第三方参考；主体与重述可比性待核对，不据此排名。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("peerComparisonReadout")
    }

    private func comparisonMetricReadout(_ metric: String, period: ComparisonPeriod) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(readablePeerMetric(metric)).font(.subheadline.bold())
            if let primary = primaryProviderValue(metric, period: period) {
                Text("本公司（OpenD 第三方）· \(readablePeerAmount(primary.rawValue, unit: "基础单位", currency: primary.currencyCode))")
                    .font(.callout.weight(.semibold).monospacedDigit())
                DisclosureGroup("本公司原值与来源") {
                    Text("原始指标 \(primary.metric) · \(primary.displayName) · \(primary.rawValue) \(primary.currencyCode)（基础单位 ×1）")
                    Text("\(primary.periodKind == "instant" ? "期末时点" : "期间值") · 捕获 \(primary.source.capturedAt) · 页 #\(primary.source.pageId) · SHA-256 \(primary.source.rawSha256)")
                }
                .font(.caption).foregroundStyle(.secondary)
                NavigationLink {
                    CompanyPeerProviderOriginalReader(membership: membership, value: primary,
                        comparisonRootSymbol: membership.symbol)
                } label: { Text("核对本公司第三方原始页") }
                .font(.caption).buttonStyle(.plain)
            } else {
                Text("本公司 · 该期无同指标参考")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(peers) { peer in
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(peer.name) · \(peer.symbol) · \(peer.status == "included" ? "纳入" : "排除")")
                        .font(.caption.bold())
                    if peer.status != "included" {
                        Text("不参与本期对照")
                    } else if sourceIssue(peer) != nil {
                        Text("来源待修复")
                    } else if researchContextDate(peer.validUntil).map({ $0 <= Date() }) != false {
                        Text("同行纳入依据已过有效期；当前不能据此比较。")
                    } else {
                        let matches = comparisonFacts(period, metric: metric).filter { $0.symbol == peer.symbol }
                        if matches.isEmpty {
                            Text("该期缺项")
                        } else if matches.count != 1 {
                            Text("同一指标有多条记录，待核对")
                        } else if let fact = matches.first {
                            comparisonFactLine(fact)
                        }
                    }
                }
                .font(.caption)
            }
            Text(comparisonScopeNote(metric, period: period))
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }

    private func comparisonFactLine(_ fact: ResearchContextNumericFact) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            let issue = context?.peerFactSourceIssues?.first { $0.factId == fact.id }
            let expired = researchContextDate(fact.validUntil).map { $0 <= Date() } != false
            if let issue {
                Text("数值来源待修复").foregroundStyle(.orange)
                DisclosureGroup("查看原因") { Text(issue.explanation).foregroundStyle(.secondary) }
            } else if expired {
                Text("已过有效期；旧值仅供历史核对。").foregroundStyle(.orange)
            } else {
                Text(fact.value.flatMap { $0.isEmpty ? nil : $0 }.map {
                    readablePeerAmount($0, unit: fact.unit, currency: fact.currency)
                } ?? "数值未记录")
                    .font(.callout.weight(.semibold).monospacedDigit())
                Text(peerSourceSummary(fact)).foregroundStyle(.secondary)
                DisclosureGroup("原值、完整指标与来源") {
                    Text("完整指标：\(fact.metric) · 原值 \(fact.value ?? "未记录") \(fact.unit) \(fact.currency ?? "币种未标")")
                    Text("事实 #\(fact.id) · 截止 \(fact.cutoffAt) · 有效至 \(fact.validUntil)")
                    Text("\(fact.citation.sourceLabel) · \(fact.provenance.classification)")
                    switch fact.citation {
                    case .pdf(let source):
                        Text("PDF #\(source.documentId) 第 \(source.pageNumber) 页 · 页摘要 \(source.pageTextSha256)")
                    case .savedMaterial(let source):
                        Text("材料 #\(source.materialId) r\(source.materialRevision) · 指纹 \(source.contentFingerprint)")
                        if let snapshot = source.snapshotCitation {
                            Text("网页快照 #\(snapshot.snapshotId) · 原文摘要 \(source.snapshotRawSha256 ?? "未记录")")
                        }
                        if let provider = source.providerOriginal {
                            Text("OpenD 捕获 #\(provider.captureId) · 页 #\(provider.pageId) · 原响应摘要 \(provider.rawSha256)")
                        }
                    }
                    if let comparison = current?.comparisons.first(where: { $0.peerFactId == fact.id }) {
                        Text("结构比较状态：\(comparison.status)\(comparison.reason.map { " · \($0)" } ?? "")。主体范围仍需原件确认；此处不生成差额或排名。")
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            NavigationLink {
                CompanyPeerCitationReader(membership: membership, fact: fact,
                    comparisonRootSymbol: membership.symbol)
            } label: { Text("重开这条事实的确切原件") }
            .buttonStyle(.plain)
        }
    }

    private func peerMembership(_ peer: ResearchContextPeer) -> CandidateMembershipData? {
        api.membershipEnvelope?.memberships.first {
            $0.actorId == membership.actorId && $0.symbol == peer.symbol && $0.state == .tracked
        }
    }

    private func peerCard(_ peer: ResearchContextPeer) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(peer.name) · \(peer.symbol)").font(.headline)
            Text(peer.status == "included" ? "纳入比较范围" : "排除比较范围")
                .font(.subheadline.bold())
            Text(peer.reason)
            if let issue = sourceIssue(peer) {
                Text(issue.explanation).font(.caption).foregroundStyle(.orange)
            }
            Text("来源：\(peer.citation.sourceLabel) · 资料截止 \(peer.cutoffAt) · 有效至 \(peer.validUntil)")
                .font(.caption).foregroundStyle(.secondary)
            NavigationLink {
                CompanyPeerCitationReader(membership: membership, peer: peer,
                    comparisonRootSymbol: membership.symbol)
            } label: {
                WorkspaceRowLabel(title: "重开确切来源",
                    subtitle: "重新核对保存的原件身份", icon: "doc.text.magnifyingglass")
            }.buttonStyle(.plain)
            Button("修改这条同行记录") { edit(peer) }
                .disabled(busy || pendingRequest != nil)
            ForEach((current?.peerFacts ?? []).filter { $0.symbol == peer.symbol }) { fact in
                let factIssue = context?.peerFactSourceIssues?.first { $0.factId == fact.id }
                VStack(alignment: .leading, spacing: 3) {
                    Text("已存同行事实 · \(fact.metric)：\(fact.value ?? "UNKNOWN") \(fact.unit) \(fact.currency ?? "")")
                    Text("测量期间 \(fact.periodStart ?? "时点") · \(fact.periodEnd ?? "未明确")")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("资料截止 \(fact.cutoffAt) · \(fact.citation.sourceLabel)")
                        .font(.caption).foregroundStyle(.secondary)
                    if let factIssue {
                        Text(factIssue.explanation).font(.caption).foregroundStyle(.orange)
                    }
                    NavigationLink {
                        CompanyPeerCitationReader(membership: membership, fact: fact,
                            comparisonRootSymbol: membership.symbol)
                    } label: { Text("重开这条事实的确切原件") }
                    Button("修改这条事实或修复来源") { editFact(fact, for: peer) }
                        .disabled(busy || pendingRequest != nil)
                }
                .font(.subheadline)
            }
            Button("记录这家公司财务/KPI 事实") {
                edit(peer); editingFactSymbol = peer.symbol
                factMetric = ""; factValue = ""; factUnit = ""; factCurrency = ""
                factPeriodMode = ""
            }
            .disabled(busy || pendingRequest != nil || peer.status != "included")
            if peer.status == "included" {
                if let other = peerMembership(peer) {
                    Button("与这家公司并列比较") { onSelect(other.id); dismiss() }
                        .accessibilityIdentifier("companyPeerCompare-\(peer.symbol)")
                } else {
                    Text("这家公司尚不在当前可读取的研究自选中，不能在此打开两公司比较。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .disabled(busy || pendingRequest != nil)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var editCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(editingPeerSymbol.isEmpty ? "新增同行" : "修改同行 · \(editingPeerSymbol)")
                .font(.headline)
            if !editingPeerSymbol.isEmpty {
                Text("改成另一家公司会替换这条名单记录，并生成新版本。原版本和既有同行事实仍保留；旧公司的事实不再算作已纳入名单。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("取消修改，新增同行") { clearDraft() }
                    .disabled(busy || pendingRequest != nil)
            }
            if current == nil {
                TextField("所属行业（首次保存必填）", text: $industry)
                    .textInputAutocapitalization(.never)
                    .disabled(busy || pendingRequest != nil)
            }
            Picker("选择已加入研究的同行", selection: $peerSymbol) {
                Text("请选择同行").tag("")
                ForEach(peerMembers, id: \.id) { candidate in
                    Text(candidate.symbol).tag(candidate.symbol)
                }
            }
            .disabled(busy || pendingRequest != nil)
            TextField("港股代码，如 HK.00700", text: $peerSymbol)
                .textInputAutocapitalization(.characters)
                .disabled(busy || pendingRequest != nil)
            Picker("依据原件归属", selection: $sourceMemberId) {
                Text("主公司资料中提及同行 · \(membership.symbol)").tag(membership.id)
                ForEach(peerMembers.filter { $0.symbol == peerSymbol }, id: \.id) { candidate in
                    Text("同行自己的已存资料 · \(candidate.symbol)").tag(candidate.id)
                }
            }
            .disabled(busy || pendingRequest != nil)
            TextField("公司名称", text: $peerName).disabled(busy || pendingRequest != nil)
            Picker("是否纳入", selection: $peerStatus) {
                Text("请选择").tag("")
                Text("纳入：商业模式及指标口径有依据").tag("included")
                Text("排除：说明差异和原因").tag("excluded")
            }
            .disabled(busy || pendingRequest != nil)
            TextField("比较维度及纳入依据或排除原因", text: $peerReason, axis: .vertical)
                .lineLimit(2...4)
                .disabled(busy || pendingRequest != nil)
            Picker("已保存来源类型", selection: $sourceKind) {
                Text("PDF 原页").tag("pdf")
                Text("发行人 HTML 摘录").tag("issuer_public_html")
                Text("OpenD 第三方参考").tag("futu_opend_financial_statement_provider")
            }.disabled(busy || pendingRequest != nil)
            if sourceKind == "pdf" && availableDocuments.isEmpty {
                Text("所选来源公司当前成员版本没有可读 PDF；请先在该公司资料入口保存并核对原件。")
                    .font(.caption).foregroundStyle(.orange)
            } else if sourceKind == "pdf" {
                Picker("确切 PDF 来源", selection: Binding(
                    get: { selectedDocumentId },
                    set: { selectedDocumentId = $0; pageNumber = 1 }
                )) {
                    Text("请选择原件").tag("")
                    ForEach(availableDocuments) { document in
                        Text("\(document.title) · \(document.publishedAt.prefix(10))")
                            .tag(document.id)
                    }
                }
                .disabled(busy || pendingRequest != nil)
                if let selectedDocument {
                    Stepper("引用第 \(pageNumber) 页", value: $pageNumber,
                            in: 1...max(1, selectedDocument.pageCount))
                        .disabled(busy || pendingRequest != nil)
                    NavigationLink {
                        CompanyDocumentReader(membership: sourceMembership ?? membership, document: selectedDocument,
                            pageNumber: pageNumber)
                    } label: {
                        WorkspaceRowLabel(title: "先查看所选 PDF 原页",
                            subtitle: "确认这页确实支持纳入或排除理由", icon: "doc.text.magnifyingglass")
                    }.buttonStyle(.plain)
                }
            } else {
                let candidates = availableMaterials.filter { $0.sourceType == sourceKind }
                if candidates.isEmpty {
                    Text("当前没有可核对的已保存材料；请先在资料入口保存原件。")
                        .font(.caption).foregroundStyle(.orange)
                } else {
                    Picker("确切材料", selection: Binding(
                        get: { selectedMaterialId },
                        set: { selectedMaterialId = $0; selectedProviderPageId = "" }
                    )) {
                        Text("请选择材料").tag("")
                        ForEach(candidates) { material in
                            Text("#\(material.id) r\(material.revision) · \(material.title)").tag(material.id)
                        }
                    }.disabled(busy || pendingRequest != nil)
                    if let material = selectedMaterial {
                        Text("来源摘要：\(material.contentText)")
                            .font(.caption).textSelection(.enabled)
                        if let url = material.sourceUrl.flatMap(URL.init(string:)) {
                            Link("查看 HTML 来源地址", destination: url)
                        }
                        if let source = material.futuFinancialSource {
                            Picker("OpenD 原件页", selection: $selectedProviderPageId) {
                                Text("请选择原件页").tag("")
                                ForEach(source.pages, id: \.pageId) { page in
                                    Text("页 #\(page.pageId) · \(page.statementType.rawValue)").tag(page.pageId)
                                }
                            }.disabled(busy || pendingRequest != nil)
                            Text("第三方参考，尚未核实为发行人事实；发布时间未知。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            DatePicker("依据有效至", selection: $validUntil, in: Date()..., displayedComponents: [.date])
                .disabled(busy || pendingRequest != nil)
            Text("保存会产生一个新版本；已有财务事实、KPI、行业说明和旧同行记录会一并保留。")
                .font(.caption).foregroundStyle(.secondary)
            if pendingRequest == nil {
                Button("保存并重新读取名单") { Task { await save() } }
                    .disabled(loading || busy || context == nil || context?.status == .unavailable
                        || (sourceKind == "pdf" ? selectedDocument == nil
                            : selectedMaterial == nil || sourceKind == "futu_opend_financial_statement_provider"
                                && selectedProviderPageId.isEmpty)
                        || AppEnvironment.researchAuthorizationContext().writeToken == nil)
                    .accessibilityIdentifier("companyPeerSave")
            } else {
                Text("上次保存结果未确认；为防止产生另一份不同请求，当前草稿暂时固定。")
                    .font(.caption).foregroundStyle(.orange)
                Button("重试同一保存请求") { Task { await retryPending() } }
                    .disabled(busy || AppEnvironment.researchAuthorizationContext().writeToken == nil)
                Button("读取最新版本并放弃待确认草稿") { Task { await discardPendingAfterRead() } }
                    .disabled(busy)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var factCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("同行财务/KPI 事实").font(.headline)
            if editingFactSymbol.isEmpty {
                Text("先在上方一家公司点击“记录事实”，再选择该公司的已存原件。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("\(editingFactSymbol) · 使用上方所选来源和确切页；人工核对报告期间、主体、口径及单位。")
                    .font(.subheadline)
                TextField("指标及报告期间，如 2025 年营业收入（集团）", text: $factMetric)
                TextField("原值；留空表示 UNKNOWN", text: $factValue)
                    .keyboardType(.numbersAndPunctuation)
                TextField("单位，如 百万元", text: $factUnit)
                TextField("币种，如 CNY；无币种留空", text: $factCurrency)
                    .textInputAutocapitalization(.characters)
                Picker("事实测量期间", selection: $factPeriodMode) {
                    Text("请按原件选择").tag("")
                    Text("时点数值").tag("point")
                    Text("起止期间数值").tag("duration")
                }
                if factPeriodMode == "duration" {
                    DatePicker("期间开始", selection: $factPeriodStart, displayedComponents: .date)
                }
                if !factPeriodMode.isEmpty {
                    DatePicker("期间结束或观察日", selection: $factPeriodEnd, displayedComponents: .date)
                }
                Text("手工录入需先从原页核对测量期间、主体、数值和单位；保存来源不等于结构核实。只有本公司同名、同测量期间、同单位及币种的事实才会计算差额；OpenD 始终是第三方未核实参考。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("保存并回读同行事实") { Task { await saveFact() } }
                    .disabled(busy || pendingRequest != nil || peerSymbol != editingFactSymbol
                        || factPeriodMode.isEmpty
                        || (sourceKind == "pdf" ? selectedDocument == nil : selectedMaterial == nil
                            || sourceKind == "futu_opend_financial_statement_provider"
                                && selectedProviderPageId.isEmpty)
                        || AppEnvironment.researchAuthorizationContext().writeToken == nil)
            }
        }
        .disabled(busy || pendingRequest != nil)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func edit(_ peer: ResearchContextPeer) {
        editingPeerSymbol = peer.symbol
        peerSymbol = peer.symbol; peerName = peer.name; peerStatus = peer.status; peerReason = peer.reason
        sourceMemberId = peer.citation.sourceMembership?.membershipId ?? membership.id
        switch peer.citation {
        case .pdf(let source):
            sourceKind = "pdf"; selectedDocumentId = source.documentId; pageNumber = source.pageNumber
            selectedMaterialId = ""; selectedProviderPageId = ""
        case .savedMaterial(let source):
            sourceKind = source.sourceType; selectedMaterialId = source.materialId
            selectedProviderPageId = source.providerOriginal?.pageId ?? ""
            selectedDocumentId = ""; pageNumber = 1
        }
        validUntil = researchContextDate(peer.validUntil) ?? Date().addingTimeInterval(90 * 24 * 60 * 60)
    }

    private func editFact(_ fact: ResearchContextNumericFact, for peer: ResearchContextPeer) {
        edit(peer)
        editingFactSymbol = fact.symbol
        factMetric = fact.metric; factValue = fact.value ?? ""; factUnit = fact.unit
        factCurrency = fact.currency ?? ""
        factPeriodMode = fact.periodEnd == nil ? "" : fact.periodStart == nil ? "point" : "duration"
        if let start = fact.periodStart,
           let date = ResearchFundamentalCalendarDate.date(from: start,
               calendar: Calendar(identifier: .gregorian)) { factPeriodStart = date }
        if let end = fact.periodEnd,
           let date = ResearchFundamentalCalendarDate.date(from: end,
               calendar: Calendar(identifier: .gregorian)) { factPeriodEnd = date }
        sourceMemberId = fact.citation.sourceMembership?.membershipId ?? membership.id
        switch fact.citation {
        case .pdf(let source):
            sourceKind = "pdf"; selectedDocumentId = source.documentId; pageNumber = source.pageNumber
            selectedMaterialId = ""; selectedProviderPageId = ""
        case .savedMaterial(let source):
            sourceKind = source.sourceType; selectedMaterialId = source.materialId
            selectedProviderPageId = source.providerOriginal?.pageId ?? ""
            selectedDocumentId = ""; pageNumber = 1
        }
        validUntil = researchContextDate(fact.validUntil) ?? validUntil
    }

    private func clearDraft() {
        editingPeerSymbol = ""; peerSymbol = ""; peerName = ""; peerStatus = ""; peerReason = ""
        editingFactSymbol = ""; factMetric = ""; factValue = ""; factUnit = ""; factCurrency = ""
        factPeriodMode = ""
        sourceMemberId = membership.id
        sourceKind = "pdf"; selectedDocumentId = ""; pageNumber = 1
        selectedMaterialId = ""; selectedProviderPageId = ""
        validUntil = Date().addingTimeInterval(90 * 24 * 60 * 60)
    }

    private func client(_ authorization: AppResearchAuthorizationContext) -> ResearchClient {
        ResearchClient(baseURL: authorization.baseURL, authToken: authorization.readToken,
            authHeaderName: authorization.readHeaderName, writeAuthToken: authorization.writeToken,
            writeAuthHeaderName: authorization.writeHeaderName)
    }

    private func refresh() async {
        let identity = "\(membership.id):\(membership.version):\(membership.actorId):\(api.currentSymbol)"
        if loadedIdentity != identity {
            loadedIdentity = identity
            context = nil; documents = nil; evidence = nil; pendingRequest = nil
            clearDraft(); industry = ""
        }
        guard !busy, isCurrent else { return }
        loading = true; defer { loading = false }
        context = nil; documents = nil; evidence = nil; message = ""
        let authorization = AppEnvironment.researchAuthorizationContext()
        let reader = client(authorization)
        do {
            let result = try await reader.fetchResearchContext(membership: membership)
            guard isCurrent, authorization == AppEnvironment.researchAuthorizationContext() else { return }
            context = result
            if let pendingRequest, let data = result.data,
               data.id != pendingRequest.baseContextId
                && data.membershipId == membership.id
                && data.membershipVersion == pendingRequest.membershipVersion
                && data.selectedSymbol == pendingRequest.selectedSymbol
                && data.industry == pendingRequest.industry
                && data.operatingModel == pendingRequest.operatingModel
                && data.peers == pendingRequest.peers && data.selectedFacts == pendingRequest.selectedFacts
                && data.peerFacts == pendingRequest.peerFacts && data.operatingKpis == pendingRequest.operatingKpis
                && data.macroDrivers == pendingRequest.macroDrivers && data.industryDrivers == pendingRequest.industryDrivers
                && data.unknowns == pendingRequest.unknowns && data.provenance == pendingRequest.provenance
                && data.asOf == pendingRequest.asOf && data.cutoffAt == pendingRequest.cutoffAt
                && data.validUntil == pendingRequest.validUntil {
                self.pendingRequest = nil
                onSaved(result)
                clearDraft()
                message = "同行记录已从新版本重新读取。"
            }
        } catch { message = "同行名单读取失败；未显示旧名单，也不能修改。" }
        await loadSourceLists()
    }

    private func loadSourceLists() async {
        guard isCurrent, let source = sourceMembership else { return }
        let identity = "\(source.id):\(source.version):\(source.symbol):\(sourceMemberId)"
        let authorization = AppEnvironment.researchAuthorizationContext()
        let reader = client(authorization)
        do {
            let result = try await reader.fetchResearchDocuments(membership: source)
            guard isCurrent, sourceMembership.map({ "\($0.id):\($0.version):\($0.symbol):\(sourceMemberId)" }) == identity,
                  authorization == AppEnvironment.researchAuthorizationContext() else { return }
            documents = result
        } catch { documents = nil; message = "所选公司 PDF 来源清单暂不可用。" }
        do {
            let result = try await reader.fetchFrozenResearchEvidence(membership: source)
            guard isCurrent, sourceMembership.map({ "\($0.id):\($0.version):\($0.symbol):\(sourceMemberId)" }) == identity,
                  authorization == AppEnvironment.researchAuthorizationContext() else { return }
            evidence = result
        } catch { evidence = nil; message = "所选公司已保存材料清单暂不可用。" }
    }

    private func save() async {
        guard !busy, pendingRequest == nil, isCurrent, let context,
              let sourceMembership,
              context.status != .unavailable else { return }
        busy = true; defer { busy = false }
        let authorization = AppEnvironment.researchAuthorizationContext()
        let writer = client(authorization)
        do {
            let edit = ResearchContextPeerEdit(symbol: peerSymbol, name: peerName, status: peerStatus,
                reason: peerReason, industry: industry, validUntil: validUntil,
                replacingSymbol: editingPeerSymbol.isEmpty ? nil : editingPeerSymbol)
            pendingRequest = try await verifiedSourceRequest(edit: edit, writer: writer,
                sourceMembership: sourceMembership, current: context.data)
            guard isCurrent, authorization == AppEnvironment.researchAuthorizationContext() else { return }
            await submitPending(writer: writer, authorization: authorization)
        } catch {
            message = "同行资料或原页引用不符合保存条件；请核对公司、原因和来源。"
        }
    }

    private func verifiedSourceRequest(edit: ResearchContextPeerEdit, writer: ResearchClient,
        sourceMembership: CandidateMembershipData, current: ResearchContextData?) async throws
        -> CreateResearchContextRequest {
            if sourceKind == "pdf", let document = selectedDocument {
                let page = try await writer.fetchResearchDocumentPage(membership: sourceMembership,
                    documentId: document.id, pageNumber: pageNumber)
                guard page.pageTextSha256.isFrozenSHA256 else { throw ResearchContextClientError.invalidResponse }
                return try edit.request(membership: membership, document: document, page: page,
                    current: current, idempotencyKey: UUID().uuidString,
                    sourceMembership: sourceMembership.id == membership.id ? nil : sourceMembership)
            } else if let material = selectedMaterial {
                let chosenProviderPageId = selectedProviderPageId
                if material.sourceType == "issuer_public_html", let exact = material.snapshotCitation,
                   let original = material.snapshotOriginal {
                    let snapshot = try await writer.readResearchSourceSnapshot(membership: sourceMembership,
                        snapshotId: exact.snapshotId)
                    _ = try await writer.readResearchSourceSnapshotOriginal(membership: sourceMembership,
                        snapshot: snapshot)
                    guard snapshot.rawSha256 == original.rawSha256,
                          snapshot.responseUrl == original.responseUrl,
                          snapshot.textSha256 == exact.textSha256,
                          snapshot.selectedCitation(range: NSRange(location: exact.startUtf16,
                            length: exact.endUtf16 - exact.startUtf16))?.0 == exact,
                          snapshot.selectedCitation(range: NSRange(location: exact.startUtf16,
                            length: exact.endUtf16 - exact.startUtf16))?.1 == material.contentText else {
                        throw ResearchContextClientError.invalidResponse
                    }
                } else if let source = material.futuFinancialSource,
                          let page = source.pages.first(where: { $0.pageId == chosenProviderPageId }) {
                    let capture = try await writer.readFutuFinancialCapture(membership: sourceMembership,
                        captureId: source.captureId)
                    guard let exact = capture.pages.first(where: { $0.id == page.pageId
                        && $0.rawSha256 == page.rawSha256
                        && $0.reports.contains(where: { $0.reportSha256 == page.reportSha256 }) }) else {
                        throw ResearchContextClientError.invalidResponse
                    }
                    _ = try await writer.readFutuFinancialOriginal(membership: sourceMembership,
                        capture: capture, page: exact)
                } else { throw ResearchContextClientError.invalidResponse }
                return try edit.request(membership: membership, material: material,
                    providerPageId: chosenProviderPageId, current: current,
                    idempotencyKey: UUID().uuidString,
                    sourceMembership: sourceMembership.id == membership.id ? nil : sourceMembership)
            } else { throw ResearchContextClientError.invalidResponse }
    }

    private func saveFact() async {
        guard !busy, pendingRequest == nil, isCurrent, let context = current,
              let sourceMembership, peerSymbol == editingFactSymbol,
              let savedPeer = context.peers.first(where: { $0.symbol == editingFactSymbol
                  && $0.status == "included" }) else { return }
        busy = true; defer { busy = false }
        let authorization = AppEnvironment.researchAuthorizationContext()
        let writer = client(authorization)
        do {
            let factEdit = ResearchContextPeerFactEdit(peerSymbol: editingFactSymbol,
                metric: factMetric, value: factValue, unit: factUnit, currency: factCurrency,
                periodStart: factPeriodMode == "duration" ? factPeriodStart : nil,
                periodEnd: factPeriodEnd, validUntil: validUntil)
            let sourceEdit = ResearchContextPeerEdit(symbol: savedPeer.symbol, name: savedPeer.name,
                status: savedPeer.status, reason: savedPeer.reason, industry: context.industry,
                validUntil: validUntil, replacingSymbol: savedPeer.symbol)
            let sourceRequest = try await verifiedSourceRequest(edit: sourceEdit, writer: writer,
                sourceMembership: sourceMembership, current: context)
            guard let sourcePeer = sourceRequest.peers.first(where: { $0.symbol == factEdit.peerSymbol }) else {
                throw ResearchContextClientError.invalidResponse
            }
            pendingRequest = try factEdit.request(membership: membership,
                sourceMembership: sourceMembership, citation: sourcePeer.citation,
                provenance: sourcePeer.provenance, sourceAt: sourcePeer.asOf,
                current: context, idempotencyKey: UUID().uuidString)
            guard isCurrent, authorization == AppEnvironment.researchAuthorizationContext() else { return }
            await submitPending(writer: writer, authorization: authorization)
        } catch { message = "同行事实或原件定位不符合保存条件；请核对测量期间、指标、数值、单位、公司和来源。" }
    }

    private func retryPending() async {
        guard !busy, pendingRequest != nil, isCurrent else { return }
        busy = true; defer { busy = false }
        let authorization = AppEnvironment.researchAuthorizationContext()
        await submitPending(writer: client(authorization), authorization: authorization)
    }

    private func discardPendingAfterRead() async {
        guard !busy, pendingRequest != nil, isCurrent else { return }
        busy = true; defer { busy = false }
        let authorization = AppEnvironment.researchAuthorizationContext()
        do {
            let latest = try await client(authorization).fetchResearchContext(membership: membership)
            guard isCurrent, authorization == AppEnvironment.researchAuthorizationContext(),
                  latest.status != .unavailable else { return }
            context = latest; pendingRequest = nil; onSaved(latest); clearDraft()
            message = "已读取当前版本。上次请求是否曾保存仍以历史记录为准；下一次修改将从当前版本开始。"
        } catch { message = "最新版本暂不可读取；待确认草稿仍保留，可重试同一请求。" }
    }

    private func submitPending(writer: ResearchClient, authorization: AppResearchAuthorizationContext) async {
        guard let request = pendingRequest else { return }
        do {
            let factChanged = context?.data?.peerFacts != request.peerFacts
            let saved = try await writer.createResearchContextAndReadBack(membership: membership, requestBody: request)
            guard isCurrent, authorization == AppEnvironment.researchAuthorizationContext() else { return }
            context = saved; pendingRequest = nil; onSaved(saved)
            clearDraft()
            let affected = saved.peerSourceIssues?.count ?? 0
            let affectedFacts = saved.peerFactSourceIssues?.count ?? 0
            message = affected == 0 && affectedFacts == 0
                ? factChanged
                    ? "已保存并回读同行事实；新版本包含 \(saved.data?.peerFacts.count ?? 0) 条同行事实。"
                    : "已保存并回读同行名单；新版本包含 \(saved.data?.peers.count ?? 0) 条同行记录。"
                : "已保存并回读新版本；仍有 \(affected) 条同行依据、\(affectedFacts) 条同行事实来源待修复。"
        } catch {
            guard isCurrent, authorization == AppEnvironment.researchAuthorizationContext() else { return }
            message = "保存或回读尚未确认。可重试完全相同的请求；不会把未确认结果显示为成功。"
        }
    }
}

@MainActor
struct CompanyPeerCitationReader: View {
    let membership: CandidateMembershipData
    let citation: ResearchPeerCitation
    let itemId: String
    let selectedSymbol: String
    let sourceSymbol: String
    let title: String
    let explanation: String
    let comparisonRootSymbol: String
    init(membership: CandidateMembershipData, peer: ResearchContextPeer, comparisonRootSymbol: String) {
        self.membership = membership; self.citation = peer.citation; self.itemId = peer.id
        self.selectedSymbol = peer.selectedSymbol
        self.sourceSymbol = peer.symbol; self.title = "\(peer.name) · \(peer.symbol)"
        self.explanation = peer.reason; self.comparisonRootSymbol = comparisonRootSymbol
    }
    init(membership: CandidateMembershipData, fact: ResearchContextNumericFact,
         comparisonRootSymbol: String) {
        self.membership = membership; self.citation = fact.citation; self.itemId = fact.id
        self.selectedSymbol = fact.selectedSymbol
        self.sourceSymbol = fact.symbol; self.title = "\(fact.symbol) · \(fact.metric)"
        self.explanation = "\(fact.value ?? "UNKNOWN") \(fact.unit) \(fact.currency ?? "")"
        self.comparisonRootSymbol = comparisonRootSymbol
    }
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var document: ResearchDocumentData?
    @State private var page: ResearchDocumentPageData?
    @State private var savedText: String?
    @State private var sourceURL: URL?
    @State private var issue = ""

    private var citationKey: String {
        switch citation {
        case .pdf(let value):
            return "pdf:\(value.documentId):\(value.pageNumber):\(value.pageTextSha256):\(value.sourceVersion)"
        case .savedMaterial(let value):
            return "material:\(value.materialId):\(value.materialRevision):\(value.contentFingerprint):\(value.sourceVersion)"
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(title).font(.headline)
                Text(explanation)
                Text(citation.sourceLabel)
                    .font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("引用身份") {
                    switch citation {
                    case .pdf(let value): Text("页摘要 \(value.pageTextSha256)")
                    case .savedMaterial(let value): Text("材料指纹 \(value.contentFingerprint)")
                    }
                }
                if api.currentSymbol != comparisonRootSymbol {
                    Text("当前研究公司已切换；旧引用已隐藏。")
                        .foregroundStyle(.orange)
                } else if let page, let document {
                    Text(page.normalizedText).textSelection(.enabled)
                    NavigationLink {
                        CompanyDocumentReader(membership: sourceMembership ?? membership, document: document,
                            pageNumber: page.pageNumber)
                    } label: {
                        WorkspaceRowLabel(title: "查看这页 PDF 原件", subtitle: document.title,
                            icon: "doc.richtext")
                    }.buttonStyle(.plain)
                } else if let savedText {
                    Text(savedText).textSelection(.enabled)
                    if let sourceURL { Link("打开公开来源地址（页面可能已变化）", destination: sourceURL) }
                } else if !issue.isEmpty {
                    Text(issue).foregroundStyle(.orange)
                    Button("重新核对引用页") { Task { await load() } }
                } else { ProgressView("正在核对已保存原件…") }
            }.padding()
        }
        .navigationTitle("同行依据")
        .task(id: "\(membership.id):\(membership.version):\(itemId):\(citationKey):\(comparisonRootSymbol):\(api.currentSymbol):\(api.authorizationRevision)") { await load() }
    }

    private var sourceMembership: CandidateMembershipData? {
        guard let binding = citation.sourceMembership else { return membership }
        return api.membershipEnvelope?.memberships.first {
            $0.id == binding.membershipId && $0.version == binding.membershipVersion
                && $0.symbol == binding.symbol && $0.symbol == sourceSymbol
                && $0.actorId == membership.actorId && $0.state == .tracked
        }
    }

    private func load() async {
        document = nil; page = nil; savedText = nil; sourceURL = nil; issue = ""
        guard selectedSymbol == membership.symbol, api.currentSymbol == comparisonRootSymbol,
              let sourceMembership,
              api.membershipEnvelope?.memberships.contains(where: {
                  $0.id == membership.id && $0.version == membership.version
                      && $0.actorId == membership.actorId && $0.state == .tracked
              }) == true else {
            issue = "研究成员身份已变化，不能沿用旧引用。"; return
        }
        let auth = AppEnvironment.researchAuthorizationContext()
        let reader = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
            authHeaderName: auth.readHeaderName)
        do {
            if case .savedMaterial(let citation) = citation {
                let workspace = try await reader.fetchFrozenResearchEvidence(membership: sourceMembership)
                guard let material = workspace.data?.materials.first(where: { $0.id == citation.materialId }),
                      material.validates(expected: sourceMembership), material.revision == citation.materialRevision,
                      material.revisionState == "current", material.freshness == "fresh",
                      material.contentFingerprint == citation.contentFingerprint,
                      material.sourceType == citation.sourceType, material.sourceVersion == citation.sourceVersion,
                      material.sourceUrl == citation.sourceUrl else {
                    throw ResearchContextClientError.invalidResponse
                }
                var verifiedText = material.contentText
                if material.sourceType == "issuer_public_html", let exact = citation.snapshotCitation,
                   let original = material.snapshotOriginal {
                    let snapshot = try await reader.readResearchSourceSnapshot(membership: sourceMembership,
                        snapshotId: exact.snapshotId)
                    _ = try await reader.readResearchSourceSnapshotOriginal(membership: sourceMembership,
                        snapshot: snapshot)
                    guard snapshot.rawSha256 == citation.snapshotRawSha256,
                          snapshot.rawSha256 == original.rawSha256,
                          snapshot.responseUrl == original.responseUrl,
                          snapshot.textSha256 == exact.textSha256,
                          snapshot.selectedCitation(range: NSRange(location: exact.startUtf16,
                            length: exact.endUtf16 - exact.startUtf16))?.0 == exact,
                          material.snapshotCitation == exact,
                          snapshot.selectedCitation(range: NSRange(location: exact.startUtf16,
                            length: exact.endUtf16 - exact.startUtf16))?.1 == material.contentText,
                          let normalizedText = snapshot.normalizedText else {
                        throw ResearchContextClientError.invalidResponse
                    }
                    sourceURL = URL(string: snapshot.responseUrl)
                    verifiedText = "引用摘录：\(material.contentText)\n\n已保存页面全文：\(normalizedText)"
                } else if material.sourceType == "futu_opend_financial_statement_provider",
                          let exact = citation.providerOriginal, let source = material.futuFinancialSource {
                    let capture = try await reader.readFutuFinancialCapture(membership: sourceMembership,
                        captureId: exact.captureId)
                    guard source.validates(sourceMembership), source.captureId == exact.captureId,
                          source.pages.contains(where: { $0.pageId == exact.pageId
                              && $0.rawSha256 == exact.rawSha256 && $0.reportSha256 == exact.reportSha256 }),
                          let originalPage = capture.pages.first(where: { $0.id == exact.pageId
                              && $0.rawSha256 == exact.rawSha256
                              && $0.reports.contains(where: { $0.reportSha256 == exact.reportSha256 }) }) else {
                        throw ResearchContextClientError.invalidResponse
                    }
                    let original = try await reader.readFutuFinancialOriginal(membership: sourceMembership,
                        capture: capture, page: originalPage)
                    verifiedText = "已保存第三方材料：\(material.contentText)\n\nOpenD 原始页：\(original.rawText)"
                } else { throw ResearchContextClientError.invalidResponse }
                guard !Task.isCancelled, api.currentSymbol == comparisonRootSymbol,
                      self.sourceMembership?.id == sourceMembership.id,
                      self.sourceMembership?.version == sourceMembership.version,
                      auth == AppEnvironment.researchAuthorizationContext() else {
                    throw ResearchContextClientError.invalidResponse
                }
                savedText = verifiedText
                return
            }
            guard case .pdf(let pdf) = citation else { throw ResearchContextClientError.invalidResponse }
            let list = try await reader.fetchResearchDocuments(membership: sourceMembership)
            guard let match = list.documents.first(where: {
                $0.id == pdf.documentId && $0.membershipId == sourceMembership.id
                    && $0.membershipVersionAtImport == sourceMembership.version && $0.isSourceAvailable
                    && $0.sourceClassification == "owner_declared_official"
                    && $0.rightsStatus == "user_provided"
                    && $0.sourceVersion == pdf.sourceVersion
            }) else { throw ResearchContextClientError.invalidResponse }
            let exact = try await reader.fetchResearchDocumentPage(membership: sourceMembership,
                documentId: match.id, pageNumber: pdf.pageNumber)
            guard !Task.isCancelled, api.currentSymbol == comparisonRootSymbol,
                  self.sourceMembership?.id == sourceMembership.id,
                  self.sourceMembership?.version == sourceMembership.version,
                  auth == AppEnvironment.researchAuthorizationContext(),
                  api.membershipEnvelope?.memberships.contains(where: {
                      $0.id == membership.id && $0.version == membership.version
                          && $0.actorId == membership.actorId && $0.state == .tracked
                  }) == true,
                  exact.pageTextSha256 == pdf.pageTextSha256 else {
                throw ResearchContextClientError.invalidResponse
            }
            document = match; page = exact
        } catch { issue = "已保存的确切引用或原件不可用；未展示未经核对的来源。" }
    }
}

@MainActor
private struct CompanyPeerProviderOriginalReader: View {
    let membership: CandidateMembershipData
    let value: FutuFinancialHistoryValue
    let comparisonRootSymbol: String
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var originalText: String?
    @State private var issue = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text("\(membership.symbol) · OpenD 原始页").font(.headline)
                Text("\(value.displayName)：\(value.rawValue) \(value.currencyCode)（基础单位 ×1）· 期间 \(value.periodStart ?? "时点") 至 \(value.periodEnd)")
                    .font(.subheadline.monospacedDigit())
                Text("第三方提供商参考，发行人原件与主体、重述可比性尚未核实。")
                    .font(.caption).foregroundStyle(.secondary)
                if let originalText {
                    Text(originalText).font(.caption.monospaced()).textSelection(.enabled)
                } else if !issue.isEmpty {
                    Text(issue).font(.caption).foregroundStyle(.orange)
                    Button("重新核对原始页") { Task { await load() } }
                } else {
                    ProgressView("正在核对原始页…")
                }
            }.padding()
        }
        .navigationTitle("第三方原始页")
        .task(id: "\(membership.id):\(membership.version):\(value.id):\(api.currentSymbol):\(api.authorizationRevision)") {
            await load()
        }
    }

    private func load() async {
        originalText = nil; issue = ""
        guard api.currentSymbol == comparisonRootSymbol,
              api.membershipEnvelope?.memberships.contains(where: {
                  $0.id == membership.id && $0.version == membership.version
                      && $0.actorId == membership.actorId && $0.state == .tracked
              }) == true else {
            issue = "研究公司或成员版本已变化；原始页未展示。"; return
        }
        let auth = AppEnvironment.researchAuthorizationContext()
        let reader = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
            authHeaderName: auth.readHeaderName)
        do {
            let capture = try await reader.readFutuFinancialCapture(membership: membership,
                captureId: value.source.captureId)
            guard let page = capture.pages.first(where: {
                $0.id == value.source.pageId && $0.statementType == value.statementType
                    && $0.rawSha256 == value.source.rawSha256
                    && $0.capturedAt == value.source.capturedAt
                    && $0.reports.contains(where: { $0.reportSha256 == value.source.reportSha256 })
            }) else { throw ResearchContextClientError.invalidResponse }
            let original = try await reader.readFutuFinancialOriginal(membership: membership,
                capture: capture, page: page)
            guard let index = page.reports.firstIndex(where: {
                $0.reportSha256 == value.source.reportSha256
            }), original.body.report_list.indices.contains(index),
                  original.body.report_list[index].financial_type == value.financialType,
                  original.body.report_list[index].period_text == value.periodText,
                  original.body.report_list[index].currency_code == value.currencyCode,
                  original.body.report_list[index].item_list.contains(where: {
                      $0.field_id == value.fieldId && $0.display_name == value.displayName
                          && $0.data != nil
                  }) else { throw ResearchContextClientError.invalidResponse }
            guard !Task.isCancelled, api.currentSymbol == comparisonRootSymbol,
                  auth == AppEnvironment.researchAuthorizationContext(),
                  api.membershipEnvelope?.memberships.contains(where: {
                      $0.id == membership.id && $0.version == membership.version
                          && $0.actorId == membership.actorId && $0.state == .tracked
                  }) == true else { throw ResearchContextClientError.invalidResponse }
            originalText = "捕获 #\(capture.id) · 原始页 #\(page.id) · SHA-256 \(page.rawSha256)\n\n\(original.rawText)"
        } catch {
            issue = "这条参考的确切原始页不可用或身份不符；没有用另一页替代。"
        }
    }
}
