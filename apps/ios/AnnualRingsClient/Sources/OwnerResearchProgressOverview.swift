import SwiftUI

struct OwnerResearchProgressLayer {
    let state: OwnerResearchRingState
    let detail: String
}

struct OwnerResearchProgressSnapshot {
    let symbol: String
    let researchStatus: String
    let nextStep: String
    let layers: [DailyDecisionRingLayer: OwnerResearchProgressLayer]
}

/// A read-only summary of existing facts for the selected company. Each lane fails independently.
extension OwnerClientStore {
    func researchProgressSnapshot(symbol rawSymbol: String) -> OwnerResearchProgressSnapshot? {
        guard let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical,
              symbol == selectedSymbol else { return nil }
        let membershipStatus = membershipEnvelope?.status
        let member = membershipEnvelope?.memberships.first { $0.symbol == symbol && $0.state != .archived }
        let candidate = candidateProgress(symbol: symbol, member: member, status: membershipStatus)
        let evidence = evidenceProgress(symbol: symbol, member: member, candidate: candidate)
        let portfolio = portfolioProgress(symbol: symbol)
        let history = decisionHistory(symbol: symbol, member: member)
        let ordinaryCheck = history?.last.flatMap { isOrdinaryDecisionRecord($0) ? $0 : nil }
        let decision = decisionProgress(symbol: symbol, member: member, history: history,
                                        candidate: candidate, evidence: evidence)
        let review = reviewProgress(symbol: symbol, member: member, history: history,
                                    candidate: candidate)
        let currentItem = member.flatMap { currentInboxItems(symbol: symbol, member: $0).first }
        let nextStep: String
        if let currentItem {
            nextStep = TodayMaterialChangePresentation.localizedResearchTitle(currentItem.title)
        } else if member == nil && (membershipStatus == .available || membershipStatus == .empty) {
            nextStep = "选择并加入研究自选"
        } else if let member, issues["inbox"] == nil, inbox?.status == .available,
                  inbox?.requestedActorId == member.actorId,
                  inbox?.items.contains(where: {
                      $0.membership.id == member.id && $0.membership.version == member.version
                          && $0.kind == .sourceFailure && $0.state == .blocked
                  }) == true {
            nextStep = "核对不可用来源"
        } else if issues["inbox"] != nil || inbox?.status == .unavailable || inbox?.status == .unauthorized || inbox == nil {
            nextStep = "重新读取 Today 待办"
        } else if review.state == .waitingOwner {
            nextStep = "核对待完成的复盘"
        } else if ordinaryCheck != nil && decision.state == .inProgress {
            nextStep = "补充普通人工判断所需证据"
        } else if decision.state == .blocked {
            nextStep = "核对人工检查的限制与风险条件"
        } else if decision.state == .waitingOwner {
            nextStep = "审阅报告；普通人工判断可独立记录"
        } else if evidence.state == .stale {
            nextStep = "重读已陈旧的证据来源"
        } else if ordinaryCheck != nil && decision.state == .recorded {
            nextStep = "按普通判断的复核条件继续观察"
        } else if decision.state == .notStarted || decision.state == .inProgress {
            nextStep = "核对资料并记录普通人工判断"
        } else {
            nextStep = "暂无新待办，继续观察"
        }
        let researchStatus: String
        if let member, member.state == .paused {
            researchStatus = "跟踪已暂停"
        } else if member == nil {
            researchStatus = membershipStatus == .unavailable || membershipStatus == nil ? "研究身份待核对" : "尚未加入跟踪"
        } else if ordinaryCheck != nil && evidence.state == .stale {
            researchStatus = "普通判断已记录，依据待更新"
        } else if evidence.state == .stale {
            researchStatus = "研究依据待更新"
        } else if ordinaryCheck != nil && decision.state == .recorded {
            researchStatus = "普通人工判断已记录"
        } else if ordinaryCheck != nil && decision.state == .inProgress {
            researchStatus = "普通判断待补证据"
        } else if ordinaryCheck != nil && decision.state == .blocked {
            researchStatus = "普通判断检查受阻"
        } else if decision.state == .blocked {
            researchStatus = "人工检查受阻"
        } else if decision.state == .recorded {
            researchStatus = "已有决定记录，当前适用性待复核"
        } else if boundTemplateReports(symbol: symbol).contains(where: { $0.isFormalizable }) {
            researchStatus = "研究报告待审阅"
        } else if boundOperatingReasoning(symbol: symbol) != nil {
            researchStatus = "研究判断已读取"
        } else if let member, member.research.status == .available {
            researchStatus = "研究档案跟踪中"
        } else {
            researchStatus = "研究资料待建立"
        }
        return OwnerResearchProgressSnapshot(symbol: symbol, researchStatus: researchStatus,
            nextStep: nextStep, layers: [.candidate: candidate, .evidence: evidence,
                .portfolio: portfolio, .decision: decision, .review: review])
    }

    private func candidateProgress(symbol: String, member: CandidateMembershipData?,
                                   status: CandidateMembershipEnvelopeStatus?) -> OwnerResearchProgressLayer {
        if let member {
            if member.state == .paused { return .init(state: .stale, detail: "研究自选已暂停；原记录仍保留。") }
            return .init(state: .recorded, detail: "\(String(member.updatedAt.prefix(10))) 已保存跟踪成员 v\(member.version)；不代表研究判断完成。")
        }
        if status == .unavailable || status == nil {
            return .init(state: .unavailable, detail: "研究自选暂未读取，无法确认当前成员。")
        }
        if candidateOverview?.status == .available,
           candidateOverview?.candidates.contains(where: { $0.symbol == symbol }) == true {
            return .init(state: .inProgress, detail: "已发现候选，尚未加入持续跟踪。")
        }
        return .init(state: .notStarted, detail: "当前股票尚无跟踪成员记录。")
    }

    private func evidenceProgress(symbol: String, member: CandidateMembershipData?,
                                  candidate: OwnerResearchProgressLayer) -> OwnerResearchProgressLayer {
        guard let member else {
            return .init(state: candidate.state == .unavailable ? .unavailable : .notStarted,
                         detail: "先确认当前研究成员，再读取证据。")
        }
        if member.state == .paused { return .init(state: .stale, detail: "跟踪已暂停；旧证据不作为当前完成状态。") }
        guard let workspace = templateFrozen,
              workspace.requestedActorId == member.actorId,
              workspace.requestedSymbol == symbol,
              workspace.data?.target.membershipId == member.id,
              workspace.data?.target.membershipVersion == member.version,
              workspace.data?.target.membershipState == member.state.rawValue,
              let data = workspace.data else {
            return .init(state: .unavailable, detail: "当前成员的证据工作区未读取或身份不符。")
        }
        guard workspace.status == "available", workspace.isFreshForCurrentResearch,
              workspace.metadata.provenance == "research_only" else {
            return .init(state: .stale, detail: "证据来源已陈旧或有冲突；需重读原件。")
        }
        if let pack = data.latestPack {
            if pack.currentness.status == "current", pack.currentness.invalidatedBy.isEmpty,
               pack.membershipId == member.id,
               pack.membershipVersion == member.version, pack.symbol == symbol {
                return .init(state: .recorded,
                             detail: "\(String(pack.frozenAt.prefix(10))) 冻结证据包 v\(pack.version)；逐项材料仍需核验。")
            }
            return .init(state: .stale, detail: "冻结证据包为历史版本；需核对新来源。")
        }
        if !data.evidencePacks.isEmpty {
            return .init(state: .stale, detail: "仅有历史冻结证据包；当前证据尚未重新冻结。")
        }
        if !data.materials.isEmpty {
            return .init(state: .inProgress,
                         detail: "已保存 \(data.materials.count) 项材料，尚无当前冻结证据包；来源仍需核验。")
        }
        return .init(state: .notStarted, detail: "当前成员尚无已保存证据材料。")
    }

    private func portfolioProgress(symbol: String) -> OwnerResearchProgressLayer {
        guard let context = templatePortfolio else {
            return .init(state: .unavailable, detail: "组合上下文尚未读取；其他研究状态可继续查看。")
        }
        if context.portfolioSource == "owner_entered_current" {
            guard let snapshot = assets?.snapshots.first(where: { $0.source == .ownerCurrent }),
                  context.portfolioSnapshotId == "owner-current:\(snapshot.id):\(snapshot.sourceHash)" else {
                return .init(state: .unavailable, detail: "本人录入持仓与组合快照尚未核对一致。")
            }
        }
        switch context.status {
        case .available:
            let relation = context.positions.contains(where: { $0.symbol == symbol })
                ? "当前组合含此股" : "当前组合未列此股"
            let concentration = context.summary.concentration.status == .available
                ? "集中度数据已读取" : "集中度数据未取得"
            let asOf = context.sourceAsOf ?? context.portfolioAsOf ?? "时点未记录"
            return .init(state: .inProgress,
                         detail: "\(relation)；\(concentration)；截至 \(String(asOf.prefix(10)))。不代表已完成风险决定。")
        case .zeroPosition:
            return .init(state: .notStarted, detail: "当前组合为零持仓；没有此股的持仓风险记录。")
        case .partial:
            return .init(state: .inProgress, detail: "组合快照仅部分可用；风险需人工核对。")
        case .stale:
            return .init(state: .stale, detail: "组合快照已过期；不能据此确认当前风险。")
        case .empty:
            return .init(state: .notStarted, detail: "当前未取得组合快照。")
        case .conflict, .unauthorized, .unavailable:
            return .init(state: .unavailable, detail: "组合来源冲突或不可用；没有采用旧持仓。")
        }
    }

    func decisionHistory(symbol: String, member: CandidateMembershipData?) -> [RecordedDecisionCheckReviewState]? {
        guard member != nil,
              let history = boundTemplateReviewHistory(symbol: symbol),
              history.metadata.provenance == "real",
              (history.metadata.freshness == "fresh"
                || (history.checks.isEmpty && history.metadata.freshness == "missing" && history.metadata.missing)),
              !history.metadata.stale, !history.metadata.conflict else { return nil }
        let deleted = Set((history.deletions ?? []).filter { $0.kind == "decision_check" }.map(\.decisionCheckId))
        return history.checks.filter { $0.symbol == symbol && !deleted.contains($0.id) }
            .sorted { $0.checkedAt < $1.checkedAt }
    }

    func historyUnavailableState(symbol: String) -> OwnerResearchRingState {
        guard let history = boundTemplateReviewHistory(symbol: symbol) else { return .unavailable }
        return history.metadata.stale || history.metadata.freshness == "stale" ? .stale : .unavailable
    }

    /// A saved human judgment with preserved context and no report or conditional binding.
    /// Source selections, when present, were validated with the recorded history.
    func isOrdinaryDecisionRecord(_ check: RecordedDecisionCheckReviewState) -> Bool {
        let finalText = check.userFinalDecision?.trimmingCharacters(in: .whitespacesAndNewlines)
        return finalText?.isEmpty == false
            && check.contextSnapshot.availability == .preserved
            && check.formalDecision.availability != "preserved"
            && check.researchReportDecision.availability != "preserved"
            && check.conditionalDecision?.availability != "preserved"
    }

    func latestRetainedReview(for check: RecordedDecisionCheckReviewState,
                              symbol: String) -> PostDecisionReviewData? {
        let deletedIds = Set((boundTemplateReviewHistory(symbol: symbol)?.deletions ?? [])
            .filter { $0.kind == "post_decision_review" }
            .compactMap(\.reviewId))
        return check.reviews.filter { !deletedIds.contains($0.id) }
            .max(by: { $0.reviewedAt < $1.reviewedAt })
    }

    private func decisionProgress(symbol: String, member: CandidateMembershipData?,
                                  history: [RecordedDecisionCheckReviewState]?,
                                  candidate: OwnerResearchProgressLayer,
                                  evidence: OwnerResearchProgressLayer) -> OwnerResearchProgressLayer {
        guard let member else {
            return .init(state: candidate.state == .unavailable ? .unavailable : .notStarted,
                         detail: "先确认研究成员，才能核对正式决定。")
        }
        if member.state == .paused { return .init(state: .stale, detail: "跟踪已暂停；历史决定不代表当前决定。") }
        guard let history else {
            return .init(state: historyUnavailableState(symbol: symbol),
                         detail: "正式决定历史未取得当前有效读回；报告意向不能代替 Owner 决定。")
        }
        if let latest = history.last {
            if latest.formalDecision.availability == "preserved", latest.formalDecision.ownerDecision != nil {
                return .init(state: .recorded,
                             detail: "已有 \(String(latest.checkedAt.prefix(10))) 正式决定记录；当前适用性仍需复核。")
            }
            if isOrdinaryDecisionRecord(latest) {
                let sourceNote = latest.manualSourceBindings.map { "，绑定 \($0.count) 项来源" } ?? ""
                let record = "\(String(latest.checkedAt.prefix(10))) 普通人工判断已保存\(sourceNote)；不是报告型正式决定。"
                if latest.humanCheckResult == "blocked" {
                    return .init(state: .blocked, detail: "\(record)人工检查仍受限制。")
                }
                if latest.humanCheckResult == "needs_more_evidence" {
                    return .init(state: .inProgress, detail: "\(record)仍需补充证据。")
                }
                return .init(state: .recorded, detail: "\(record)当前适用性仍需复核。")
            }
            if latest.humanCheckResult == "blocked" {
                return .init(state: .blocked, detail: "最新人工检查仍受风险或证据条件限制；未据此形成新判断。")
            }
            if latest.humanCheckResult == "needs_more_evidence" {
                return .init(state: .inProgress, detail: "最新人工检查需要补证据；普通判断可独立于 AI 报告继续。")
            }
            if latest.userFinalDecision != nil {
                return .init(state: .inProgress,
                             detail: "有人工检查记录；尚未核实为独立普通判断或报告型正式决定。")
            }
        }
        if boundTemplateReports(symbol: symbol).contains(where: { $0.isFormalizable }) {
            return .init(state: .waitingOwner, detail: "报告可供人工审阅；普通人工判断也可独立记录。")
        }
        return .init(state: evidence.state == .notStarted ? .notStarted : .inProgress,
                     detail: "尚无已保存判断；可核对资料后记录普通人工判断，报告型决定另行确认。")
    }

    private func reviewProgress(symbol: String, member: CandidateMembershipData?,
                                history: [RecordedDecisionCheckReviewState]?,
                                candidate: OwnerResearchProgressLayer) -> OwnerResearchProgressLayer {
        guard let member else {
            return .init(state: candidate.state == .unavailable ? .unavailable : .notStarted,
                         detail: "先确认研究成员，才能核对复盘。")
        }
        if member.state == .paused { return .init(state: .stale, detail: "跟踪已暂停；旧复盘仅作历史参考。") }
        if currentInboxItems(symbol: symbol, member: member).contains(where: {
            $0.kind == .reviewDue || $0.kind == .dailyTracking
        }) {
            return .init(state: .waitingOwner, detail: "Today 有同一成员的待处理复盘或跟踪事项。")
        }
        guard let history else {
            return .init(state: historyUnavailableState(symbol: symbol), detail: "复盘历史未取得当前有效读回。")
        }
        guard let latest = history.last else { return .init(state: .notStarted, detail: "尚无已保存判断对应的复盘记录。") }
        if let review = latestRetainedReview(for: latest, symbol: symbol) {
            return .init(state: .recorded,
                         detail: "已有 \(String(review.reviewedAt.prefix(10))) 复盘记录；新的研究变化仍需另行核对。")
        }
        if let dueOn = latest.reviewDueOn {
            if dueOn <= currentHongKongRequestDate() {
                return .init(state: .waitingOwner, detail: "计划复盘日期 \(dueOn) 已到；尚无对应完成记录。")
            }
            return .init(state: .inProgress, detail: "已安排复盘日期 \(dueOn)；尚无对应完成记录。")
        }
        if history.dropLast().contains(where: { latestRetainedReview(for: $0, symbol: symbol) != nil }) {
            return .init(state: .inProgress, detail: "较早判断或决定有复盘记录；最新人工检查尚未复盘。")
        }
        return .init(state: .notStarted, detail: "最新普通判断或决定检查尚无复盘记录。")
    }

    private func currentInboxItems(symbol: String, member: CandidateMembershipData) -> [TodayActionInboxItem] {
        guard issues["inbox"] == nil, inbox?.status == .available,
              inbox?.requestedActorId == member.actorId else { return [] }
        return todayPendingInboxItems.filter {
            $0.symbol == symbol && $0.membership.id == member.id && $0.membership.version == member.version
        }
    }
}

struct OwnerResearchProgressOverview: View {
    @ObservedObject private var store = OwnerClientStore.shared
    let symbol: String

    var body: some View {
        if let snapshot = store.researchProgressSnapshot(symbol: symbol) {
            DisclosureGroup("研究进度与已完成记录") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("五环只读 · 记录状态不等于当前判断完成")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                    StatusRingsOverview(
                        canonicalSymbol: snapshot.symbol,
                        statusByLayer: snapshot.layers.mapValues { $0.detail },
                        layout: .init(availableWidth: 320, accessibilityText: false),
                        ringStates: snapshot.layers.mapValues { $0.state },
                        centerStatus: snapshot.researchStatus,
                        centerNextStep: snapshot.nextStep
                    )
                    ForEach(DailyDecisionRingLayer.allCases) { layer in
                        if let progress = snapshot.layers[layer] {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: progress.state.systemImage)
                                    .foregroundStyle(progress.state.tint)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(layer.title) · \(progress.state.title)")
                                        .font(.caption.weight(.semibold))
                                    Text(progress.detail)
                                        .font(.caption).foregroundStyle(Theme.textSecondary)
                                }
                            }
                        }
                    }
                    Text("当前研究：\(snapshot.researchStatus) · 下一步：\(snapshot.nextStep)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 8)
            }
            .font(.subheadline.weight(.semibold))
            .padding(12)
            .templateCardStyle()
            .accessibilityIdentifier("ownerResearchProgressOverview")
        }
    }
}
