import SwiftUI

struct OwnerManualJudgmentRecord {
    let originalText: String
    let action: DecisionActionIntent
    let humanCheck: HumanCheckResult
    let checkedAt: String
    let reviewDueOn: String?
    let latestReview: PostDecisionReviewData?
    let laterCheckAt: String?
}

enum OwnerManualJudgmentProjection {
    case recorded(OwnerManualJudgmentRecord)
    case latestOther
    case empty
    case notTracked
    case paused
    case stale
    case unavailable
}

extension OwnerClientStore {
    func manualJudgmentProjection(symbol rawSymbol: String) -> OwnerManualJudgmentProjection? {
        guard let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical,
              symbol == selectedSymbol else { return nil }
        guard issues["memberships"] == nil, let membershipEnvelope else {
            return .unavailable
        }
        if membershipEnvelope.status == .empty { return .notTracked }
        guard membershipEnvelope.status == .available else { return .unavailable }
        guard let member = membershipEnvelope.memberships.first(where: {
            $0.symbol == symbol && $0.state != .archived
        }) else { return .notTracked }
        guard member.state == .tracked else { return .paused }
        guard issues["reviews"] == nil,
              let history = decisionHistory(symbol: symbol, member: member) else {
            return historyUnavailableState(symbol: symbol) == .stale ? .stale : .unavailable
        }
        guard let latest = history.last else { return .empty }
        guard let ordinary = history.last(where: { isOrdinaryDecisionRecord($0) }) else {
            return .latestOther
        }
        guard let originalText = ordinary.userFinalDecision,
              let action = DecisionActionIntent(rawValue: ordinary.actionIntent),
              let humanCheck = HumanCheckResult(rawValue: ordinary.humanCheckResult) else {
            return .unavailable
        }
        return .recorded(.init(originalText: originalText, action: action, humanCheck: humanCheck,
                               checkedAt: ordinary.checkedAt, reviewDueOn: ordinary.reviewDueOn,
                               latestReview: latestRetainedReview(for: ordinary, symbol: symbol),
                               laterCheckAt: latest.id == ordinary.id ? nil : latest.checkedAt))
    }
}

struct OwnerManualJudgmentSummary: View {
    @ObservedObject private var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    let symbol: String

    var body: some View {
        if let projection = api.manualJudgmentProjection(symbol: symbol) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("普通人工判断").font(.headline)
                    Spacer()
                    Text(symbol).font(.caption).foregroundStyle(Theme.textSecondary)
                }
                switch projection {
                case .recorded(let record):
                    recordedContent(record)
                case .latestOther:
                    Text("最近一次决定检查属于其他类型；当前没有已保存的普通人工判断可供展示。")
                        .foregroundStyle(Theme.textSecondary)
                    Button("查看决定时间线") { actions.workflow(.review) }
                    Button("从资料记录新判断") { actions.workflow(.materials) }
                case .empty:
                    Text("当前成员尚无已保存的普通人工判断。")
                        .foregroundStyle(Theme.textSecondary)
                    Button("核对资料并记录判断") { actions.workflow(.materials) }
                case .notTracked:
                    Text(api.loading ? "正在核对当前研究成员…" : "当前没有跟踪成员，尚不能读取这家公司的普通判断。")
                        .foregroundStyle(Theme.textSecondary)
                case .paused:
                    Text("跟踪已暂停；既有判断仅作历史参考，不作为当前判断。")
                        .foregroundStyle(Theme.textSecondary)
                case .stale:
                    Text("决定历史已陈旧；请重新读取后再查看普通判断。")
                        .foregroundStyle(Theme.textSecondary)
                case .unavailable:
                    Text(api.loading ? "正在读取普通判断记录…" : "决定历史暂不可用；不会采用上次缓存的判断。")
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .font(.subheadline)
            .padding(14)
            .templateCardStyle()
            .accessibilityIdentifier("ownerManualJudgmentSummary")
        }
    }

    @ViewBuilder
    private func recordedContent(_ record: OwnerManualJudgmentRecord) -> some View {
        if let laterCheckAt = record.laterCheckAt {
            Text("较早记录 · 此后在 \(WorkspaceTimestamp.hongKong(laterCheckAt)) 有其他类型的决定检查。")
                .font(.caption.weight(.semibold)).foregroundStyle(Theme.amber)
        } else {
            Text("最近一次决定检查 · 已保存记录")
                .font(.caption.weight(.semibold)).foregroundStyle(Theme.textSecondary)
        }
        Text("这是保存时的人工记录；当前适用性仍需复核，未自动形成生效决定。")
            .font(.caption).foregroundStyle(Theme.textSecondary)
        Text("已保存的判断原文").font(.caption.weight(.semibold))
            .foregroundStyle(Theme.textSecondary)
        Text(verbatim: record.originalText).font(.body)
        Text("保存时选择：\(record.action.label) · 人工检查：\(record.humanCheck.label)")
            .foregroundStyle(Theme.textSecondary)
        Text("保存时间：\(WorkspaceTimestamp.hongKong(record.checkedAt))")
            .foregroundStyle(Theme.textSecondary)
        if let review = record.latestReview {
            Text("最近复盘：\(reviewOutcomeLabel(review.outcome)) · \(WorkspaceTimestamp.hongKong(review.reviewedAt))")
                .foregroundStyle(Theme.textSecondary)
            if review.reviewLearning.availability == "ordinary_manual_preserved",
               let question = review.reviewLearning.snapshot?.nextResearchQuestion,
               !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("复盘留下的问题：\(question)")
                    .foregroundStyle(Theme.textSecondary)
            }
            if let dueOn = record.reviewDueOn {
                Text("原计划复核日：\(dueOn) · 已有对应复盘记录")
                    .foregroundStyle(Theme.textSecondary)
            }
        } else if let dueOn = record.reviewDueOn {
            Text("计划复核日：\(dueOn)")
                .foregroundStyle(Theme.textSecondary)
        }
        VStack(alignment: .leading, spacing: 8) {
            Button("查看决定时间线") { actions.workflow(.review) }
            Button("从资料记录新判断") { actions.workflow(.materials) }
        }
    }

    private func reviewOutcomeLabel(_ outcome: DecisionReviewOutcome) -> String {
        switch outcome {
        case .thesisConfirmed: "判断得到支持"
        case .thesisWeakened: "判断被削弱"
        case .thesisInvalidated: "判断已失效"
        case .insufficientEvidence: "证据不足"
        }
    }
}
