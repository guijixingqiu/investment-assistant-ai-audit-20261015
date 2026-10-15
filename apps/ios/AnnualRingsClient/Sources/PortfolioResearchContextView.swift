import SwiftUI

struct PortfolioResearchContextResponse: Decodable {
    struct ActorScope: Decodable { let actorType: String; let actorId: String }
    struct Milestone: Decodable { let milestoneId: String; let description: String; let targetDate: String? }
    struct Item: Decodable, Identifiable {
        let symbol: String
        let companyName: String?
        let holdingIdentity: String
        let assetSnapshotIdentity: String?
        let assetAsOf: String
        let positionValue: Double?
        let positionCurrency: String?
        let portfolioWeight: Double?
        let valuationAsOf: String?
        let membershipId: String?
        let membershipVersion: Int?
        let researchState: String
        let evidenceState: String?
        let scenarioPeriodType: String?
        let baselineId: String?
        let activeMilestone: Milestone?
        let latestReviewAt: String?
        let thesisLineageState: String
        let currentBaseStatus: String?
        let limitations: [String]
        var id: String { holdingIdentity }
    }
    struct Summary: Decodable {
        let totalHoldings: Int
        let trackedResearchCount: Int
        let untrackedCount: Int
        let currentCount: Int
        let reviewDueCount: Int
        let reviewRequiredCount: Int
        let endedCount: Int
        let reviewLoopNotEnabledCount: Int
        let exposureByResearchState: [String: Exposure]
        let valuationStatus: String
        let valuationLimitation: String?
    }
    struct Exposure: Decodable { let amount: Double?; let percentage: Double? }
    let status: String
    let actorScope: ActorScope
    let portfolioSnapshotIdentity: String?
    let portfolioAsOf: String?
    let portfolioSource: String?
    let portfolioFreshness: String
    let items: [Item]
    let summary: Summary
    let projectionFingerprint: String
    let limitations: [String]
}

struct PortfolioResearchContextClient {
    let baseURL: URL
    let session: URLSession
    let readToken: String?
    let readHeaderName: String
    func fetch() async throws -> PortfolioResearchContextResponse {
        guard let readToken else { throw NSError(domain: "研究读取授权不可用", code: 401) }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/mobile/assets/research-context"))
        request.setValue(readToken, forHTTPHeaderField: readHeaderName)
        let (data, response) = try await session.data(for: request)
        guard (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 503) else {
            throw NSError(domain: "研究覆盖读取暂不可用", code: (response as? HTTPURLResponse)?.statusCode ?? 503)
        }
        return try JSONDecoder().decode(PortfolioResearchContextResponse.self, from: data)
    }
}

struct PortfolioResearchContextView: View {
    let projection: PortfolioResearchContextResponse?
    let error: String?
    let canOpenResearch: (PortfolioResearchContextResponse.Item) -> Bool
    let openResearch: (PortfolioResearchContextResponse.Item) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("研究覆盖").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("portfolioResearchContextHeader")
            if let projection {
                Text("非官方持仓快照 · \(projection.portfolioAsOf ?? "时点未提供")")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                if projection.actorScope.actorId.hasPrefix("test-phase13-") {
                    Text("TEST FIXTURE ONLY · 隔离测试数据").font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.gold).accessibilityIdentifier("phase13FixtureBanner")
                }
                if projection.items.isEmpty {
                    Text(projection.status == "empty" ? "当前没有可用于研究覆盖分析的持仓快照。" : "当前没有可读取的非官方持仓快照。")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                } else {
                    HStack(spacing: 8) {
                        count("当前", projection.summary.currentCount)
                        count("需要重新审视", projection.summary.reviewRequiredCount)
                        count("验证节点已到", projection.summary.reviewDueCount)
                    }
                    HStack(spacing: 8) {
                        count("Thesis 已结束", projection.summary.endedCount)
                        count("复核未启用", projection.summary.reviewLoopNotEnabledCount)
                        count("未纳入研究", projection.summary.untrackedCount)
                    }
                    if projection.summary.valuationStatus == "AVAILABLE",
                       let percentage = projection.summary.exposureByResearchState["REVIEW_REQUIRED"]?.percentage,
                       percentage.isFinite, (0...1).contains(percentage) {
                        Text("处于需要重新审视的持仓快照占比 \(percentage * 100, specifier: "%.1f")%")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    } else {
                        Text(projection.summary.valuationLimitation ?? "持仓比例 UNKNOWN")
                            .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    DisclosureGroup("查看每项持仓的研究状态") {
                        VStack(spacing: 8) {
                            ForEach(projection.items) { item in row(item) }
                        }.padding(.top, 8)
                    }.font(.system(size: 12)).foregroundStyle(Theme.textPrimary)
                }
            } else {
                Text(error ?? "研究覆盖读取中…").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(14).templateCardStyle()
    }
    private func count(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            Text("\(value) 项").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func row(_ item: PortfolioResearchContextResponse.Item) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    if let name = item.companyName, !name.isEmpty { Text(name).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.textPrimary) }
                    Text(item.symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                        .accessibilityIdentifier("portfolioResearchRow-\(item.symbol)")
                }
                Spacer()
                Text(stateLabel(item.researchState)).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.gold)
            }
            if let milestone = item.activeMilestone { Text("下一验证：\(milestone.description)").font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
            if item.researchState == "ENDED" { Text("当前仍存在非官方持仓快照；请查看 Research 历史。") .font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
            if let period = item.scenarioPeriodType { Text("研究基线：\(period == "CURRENT_FY" ? "当前财年" : "下一报告期")") .font(.system(size: 10)).foregroundStyle(Theme.textTertiary) }
            ForEach(item.limitations, id: \.self) { Text($0).font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
            if item.membershipId != nil {
                Button(item.researchState == "REVIEW_REQUIRED" || item.researchState == "REVIEW_DUE" ? "进入正式复核" : "进入研究") { openResearch(item) }
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.gold)
                    .disabled(!canOpenResearch(item))
                    .accessibilityIdentifier("portfolioResearchOpen-\(item.symbol)")
            }
        }.padding(10).templateCardStyle()
    }
    private func stateLabel(_ state: String) -> String {
        switch state {
        case "CURRENT": "当前研究无需重新审视"
        case "REVIEW_REQUIRED": "需要重新审视"
        case "REVIEW_DUE": "验证节点已到"
        case "ENDED": "当前研究 Thesis 已结束"
        case "REVIEW_LOOP_NOT_ENABLED": "持续复核尚未启用"
        default: "未纳入研究"
        }
    }
}
