import SwiftUI

struct ResearchLoopReadinessResponse: Decodable {
    struct ActorScope: Decodable { let actorType: String; let actorId: String }
    struct Thesis: Decodable { let status: String; let originalThesisIdentity: String?; let lineageId: String? }
    struct CurrentBase: Decodable { let status: String; let scenarioId: String?; let version: Int?; let assumptionFingerprint: String? }
    struct Baseline: Decodable { let status: String; let baselineId: String?; let scenarioPeriodType: String; let membershipVersion: Int?; let thesisLineageId: String?; let createdAt: String? }
    struct Milestone: Decodable { let status: String; let milestoneId: String?; let baselineId: String?; let description: String?; let targetDate: String? }
    struct NextOwnerAction: Decodable { let kind: String; let label: String; let destination: String? }
    let schemaVersion: String
    let actorScope: ActorScope
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let scenarioPeriodType: String
    let storageStatus: String
    let loopStatus: String
    let blockingStep: String
    let thesis: Thesis?
    let currentBase: CurrentBase?
    let baseline: Baseline?
    let milestone: Milestone?
    let researchFreshness: String?
    let evidenceState: String?
    let nextOwnerAction: NextOwnerAction
    let limitations: [String]
    let generatedAt: String
    let readinessFingerprint: String
}

private struct ResearchLoopReadinessClient {
    let baseURL: URL
    let session: URLSession
    let readToken: String?
    let readHeaderName: String
    func fetch(membershipId: String, periodType: String) async throws -> ResearchLoopReadinessResponse {
        guard let readToken else { throw NSError(domain: "持续复核读取授权不可用", code: 401) }
        let path = "api/mobile/research/\(membershipId)/loop-readiness"
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "scenarioPeriodType", value: periodType)]
        var request = URLRequest(url: components.url!)
        request.setValue(readToken, forHTTPHeaderField: readHeaderName)
        let (data, response) = try await session.data(for: request)
        guard (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 503) else {
            throw NSError(domain: "持续复核读取暂不可用", code: (response as? HTTPURLResponse)?.statusCode ?? 503)
        }
        return try JSONDecoder().decode(ResearchLoopReadinessResponse.self, from: data)
    }
}

struct ResearchLoopReadinessView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let membership: CandidateMembershipData
    let reasoning: ResearchOperatingReasoning?
    @State private var periodType = "CURRENT_FY"
    @State private var projection: ResearchLoopReadinessResponse?
    @State private var actionReasoning: ResearchOperatingReasoning?
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("持续复核").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.textPrimary)
            Picker("预测期间", selection: $periodType) {
                Text("本财年").tag("CURRENT_FY")
                Text("下个报告期").tag("NEXT_REPORTING_PERIOD")
            }.pickerStyle(.segmented).accessibilityIdentifier("phase14ReadinessPeriod")
            if let value = projection, value.symbol == symbol, value.membershipId == membershipId,
               value.membershipVersion == membershipVersion, value.scenarioPeriodType == periodType {
                if value.actorScope.actorId.hasPrefix("test-phase14-") {
                    Text("TEST FIXTURE ONLY · 隔离测试数据").font(.caption).foregroundStyle(Theme.gold).accessibilityIdentifier("phase14FixtureBanner")
                }
                Text(statusTitle(value)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.gold)
                    .accessibilityIdentifier("phase14ReadinessStatus")
                Text(value.nextOwnerAction.label).font(.system(size: 12)).foregroundStyle(Theme.textPrimary)
                    .accessibilityIdentifier("phase14NextOwnerAction")
                if value.blockingStep == "BASELINE", let base = value.currentBase {
                    Text("Current Base · v\(base.version ?? 0) · \(periodType == "CURRENT_FY" ? "本财年" : "下一个报告期")").font(.caption).foregroundStyle(Theme.blue)
                }
                if value.loopStatus == "ACTIVE" {
                    Text("下一验证：\(value.milestone?.description ?? "正在核对") · 当前：\(value.researchFreshness ?? "UNKNOWN")").font(.caption).foregroundStyle(Theme.blue)
                }
                if value.blockingStep == "THESIS" {
                    Text("正式 Thesis · 尚未建立").font(.system(size: 12, weight: .semibold))
                    Text("选择正式 Thesis 前，请查看已有 Report 条件、反方证据与 UNKNOWN。")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }
                ownerAction(value)
                if value.storageStatus == "READY" {
                    DisclosureGroup("查看前置条件") {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("正式 Thesis · \(stepTitle(value.thesis?.status))")
                            Text("Current Base · \(stepTitle(value.currentBase?.status))")
                            Text("Research Baseline · \(stepTitle(value.baseline?.status))")
                            Text("Validation · \(stepTitle(value.milestone?.status))")
                        }.font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }.accessibilityIdentifier("phase14ReadinessDetail")
                }
            } else if let message {
                Text(message).font(.caption).foregroundStyle(Theme.gold)
            } else {
                Text("持续复核状态正在读取…").font(.caption).foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 12))
        .task(id: "\(symbol)|\(membershipId)|\(membershipVersion)|\(periodType)") { await reload() }
    }

    private func statusTitle(_ value: ResearchLoopReadinessResponse) -> String {
        if value.storageStatus == "NOT_APPLIED" { return "持续复核存储尚未启用" }
        if value.storageStatus == "UNAVAILABLE" { return "持续复核暂不可用" }
        if value.loopStatus == "ENDED" { return "当前 Thesis 已结束" }
        if value.loopStatus == "ACTIVE" {
            if value.researchFreshness == "REVIEW_REQUIRED" { return "持续复核已启用 · 需要重新审视" }
            if value.researchFreshness == "REVIEW_DUE" { return "持续复核已启用 · 验证节点已到" }
            return "持续复核已启用"
        }
        if value.blockingStep == "BASELINE" { return "还差一步：保存研究基线" }
        if value.blockingStep == "MILESTONE" { return "还差一步：设置下一验证节点" }
        return "尚未启用"
    }
    private func stepTitle(_ status: String?) -> String {
        switch status {
        case "PRESENT", "READY": return "已有"
        case "ENDED": return "已结束"
        case "DRIFTED", "REVIEW_REQUIRED": return "需要复核"
        case "MISSING": return "缺失"
        default: return "尚未确认"
        }
    }
    @ViewBuilder private func ownerAction(_ value: ResearchLoopReadinessResponse) -> some View {
        if value.blockingStep == "THESIS" {
            NavigationLink("选择正式 Thesis →") { ThesisFormationView(membership: membership) }
                .accessibilityIdentifier("phase15OpenThesisFormation")
        } else if let reasoning = actionReasoning ?? reasoning, reasoning.symbol == symbol, reasoning.membershipId == membershipId,
           reasoning.membershipVersion == membershipVersion {
            switch value.nextOwnerAction.destination {
            case "UNDERWRITING":
                if value.blockingStep == "CURRENT_BASE" {
                    NavigationLink("进入 Current Base 工作台") { CurrentBaseFormationView(membership: membership, initialPeriodType: periodType) }
                        .accessibilityIdentifier("phase14OpenOwnerAction")
                } else if value.blockingStep == "BASELINE" {
                    NavigationLink("核对基线 →") { ResearchBaselineActivationView(membership: membership, initialPeriodType: periodType) }
                        .accessibilityIdentifier("phase14OpenOwnerAction")
                } else {
                    NavigationLink("进入正式 Base / Baseline") { ResearchUnderwritingView(initial: reasoning, initialPeriodType: periodType) }
                        .accessibilityIdentifier("phase14OpenOwnerAction")
                }
            case "REVIEW":
                if value.blockingStep == "MILESTONE" {
                    NavigationLink("设置验证节点 →") { ResearchBaselineActivationView(membership: membership, initialPeriodType: periodType) }
                        .accessibilityIdentifier("phase14OpenOwnerAction")
                } else {
                    NavigationLink("进入正式复核") { ResearchReviewView(initial: reasoning, initialPeriodType: periodType) }
                        .accessibilityIdentifier("phase14OpenOwnerAction")
                }
            default: EmptyView()
            }
        } else if value.nextOwnerAction.destination != nil {
            Text("正式研究上下文暂不可用；请重新读取后再进入保存页面。")
                .font(.caption).foregroundStyle(Theme.textSecondary)
        }
    }
    private func reload() async {
        projection = nil; actionReasoning = nil; message = nil
        let context = AppEnvironment.researchAuthorizationContext()
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        do {
            let result = try await ResearchLoopReadinessClient(baseURL: context.baseURL, session: session,
                readToken: context.readToken, readHeaderName: context.readHeaderName).fetch(membershipId: membershipId, periodType: periodType)
            guard result.symbol == symbol && result.membershipId == membershipId && result.membershipVersion == membershipVersion,
                  result.scenarioPeriodType == periodType else { message = "持续复核身份已变化，请重新读取。"; return }
            projection = result
            if result.nextOwnerAction.destination != nil {
                let workspace = try await ResearchClient(baseURL: context.baseURL, session: session,
                    authToken: context.readToken, authHeaderName: context.readHeaderName)
                    .fetchFrozenResearchEvidence(membership: membership)
                if let exact = workspace.data?.operatingReasoning, exact.matches(workspace),
                   exact.symbol == symbol && exact.membershipId == membershipId && exact.membershipVersion == membershipVersion,
                   api.selectedSymbol == symbol, AppEnvironment.researchAuthorizationContext() == context,
                   let current = api.membershipEnvelope?.memberships.first(where: { $0.id == membershipId }),
                   current.version == membershipVersion && current.actorId == membership.actorId && current.state == membership.state {
                    api.templateFrozen = workspace
                    actionReasoning = api.boundOperatingReasoning(symbol: symbol)
                }
            }
        } catch { message = (error as NSError).domain }
    }
}
