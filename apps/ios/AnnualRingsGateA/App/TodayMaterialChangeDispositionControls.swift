import SwiftUI

struct TodayMaterialChangeDispositionControls: View {
    let item: TodayActionInboxItem
    let client: any TodayActionInboxFetching
    @Binding var envelope: TodayActionInboxEnvelope
    @State private var inFlight: TodayMaterialChangeDispositionRequest?
    @State private var retry: TodayMaterialChangeDispositionRequest?
    @State private var message: String?
    @State private var snoozedUntil = Date().addingTimeInterval(86_400)

    /// These research items are source reminders. Handling one does not complete a task,
    /// report, formal decision, or review.
    static func isSourceResearchChange(_ item: TodayActionInboxItem) -> Bool {
        item.kind == .research
            && item.source.lane == "research"
            && item.source.status == "available"
            && ["research_decision_update", "research_source_intake", "weekly_research_review"].contains(item.source.sourceType)
            && item.researchTarget != nil
            && item.researchTarget?.task == nil
            && item.researchTarget?.report == nil
            && item.reviewEvent == nil
    }

    static func supportsDisposition(_ item: TodayActionInboxItem) -> Bool {
        guard [.new, .later, .resolved].contains(item.state),
              let fingerprint = item.source.sourceFingerprint,
              fingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              item.source.sourceType != "deep_research_tasks" else { return false }
        return canHandle(item) || item.state == .new || item.state == .later
            || (isSourceResearchChange(item) && item.state == .resolved)
    }

    static func canHandle(_ item: TodayActionInboxItem) -> Bool {
        if item.kind == .materialChange { return true }
        let sourceIsCurrent = item.source.validUntil.map { validUntil in
            parseInstant(validUntil).map { $0 > Date() } == true
        } ?? true
        return isSourceResearchChange(item) && item.source.freshness == "fresh" && sourceIsCurrent
    }

    private var pendingResolvedRetry: Bool {
        guard let retry else { return false }
        return Self.isSourceResearchChange(item)
            && [.new, .later, .resolved].contains(item.state)
            && retry.itemId == item.id
            && retry.membershipVersion == item.membership.version
            && retry.sourceFingerprint == item.source.sourceFingerprint
            && retry.state == .resolved
            && retry.snoozedUntil == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if pendingResolvedRetry {
                button("核对未确认的处理结果", systemImage: "arrow.clockwise.circle", state: .resolved, snoozedUntil: nil)
            } else if Self.supportsDisposition(item) && Self.canHandle(item) && item.state == .resolved {
                button("重新打开", systemImage: "arrow.uturn.backward.circle", state: .new, snoozedUntil: nil)
            } else if Self.supportsDisposition(item)
                        && (!Self.isSourceResearchChange(item) || Self.canHandle(item))
                        && (item.state == .new || item.state == .later) {
                HStack {
                    if item.state == .new {
                        button("稍后", systemImage: "clock", state: .later, snoozedUntil: snoozedUntil)
                    } else if item.state == .later {
                        button("立即恢复", systemImage: "arrow.uturn.backward", state: .new, snoozedUntil: nil)
                    }
                    if Self.canHandle(item) {
                        button(Self.isSourceResearchChange(item) ? "已处理此提醒" : "已处理", systemImage: "checkmark.circle", state: .resolved, snoozedUntil: nil)
                    }
                }
                if item.state == .new {
                    DisclosureGroup("选择其他回流时间") {
                        DatePicker(
                            "稍后回流时间",
                            selection: $snoozedUntil,
                            in: Date().addingTimeInterval(300)...Date().addingTimeInterval(365 * 86_400),
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .padding(.top, 4)
                        .accessibilityIdentifier("todayActionInboxSnoozedUntil-\(item.order)")
                    }
                    .font(.caption)
                }
            }
            if Self.isSourceResearchChange(item) {
                Text("这里只处理来源提醒；研究核对、报告修订和正式复盘仍需各自完成。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(retry == nil ? Color.green : Color.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayActionInboxDispositionMessage")
            }
        }
    }

    private func button(
        _ label: String,
        systemImage: String,
        state: TodayActionInboxItemState,
        snoozedUntil: Date?
    ) -> some View {
        Button {
            Task { await write(state: state, snoozedUntil: snoozedUntil) }
        } label: {
            Label(label, systemImage: systemImage)
        }
        .buttonStyle(.bordered)
        .disabled(inFlight != nil)
        .accessibilityIdentifier("todayActionInboxDisposition-\(state.rawValue)-\(item.order)")
    }

    @MainActor
    private func write(state: TodayActionInboxItemState, snoozedUntil: Date?) async {
        guard inFlight == nil else { return }
        do {
            let expectedActorId = envelope.requestedActorId
            let replayingHandledRequest = state == .resolved && pendingResolvedRetry
            guard Self.supportsDisposition(item),
                  replayingHandledRequest || !Self.isSourceResearchChange(item) || Self.canHandle(item),
                  (state != .resolved && item.state != .resolved) || Self.canHandle(item) || replayingHandledRequest,
                  (state == .resolved && ([.new, .later].contains(item.state) || replayingHandledRequest))
                    || (state == .later && [.new, .later].contains(item.state))
                    || (state == .new && [.later, .resolved].contains(item.state)),
                  envelope.status == .available,
                  expectedActorId != "UNKNOWN",
                  !expectedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  envelope.items.first(where: { $0.id == item.id }) == item else {
                throw TodayActionInboxValidationError.invalid(["当前 Today 行动已变化或身份不可用，请重新读取后再处置"])
            }
            let requestedSnooze = snoozedUntil.map { ISO8601DateFormatter().string(from: $0) }
            let request: TodayMaterialChangeDispositionRequest
            if let retry, retry.itemId == item.id,
               retry.membershipVersion == item.membership.version,
               retry.sourceFingerprint == item.source.sourceFingerprint,
               retry.state == state, retry.snoozedUntil == requestedSnooze {
                request = retry
            } else {
                request = try TodayMaterialChangeDispositionRequest(
                    item: item,
                    state: state,
                    snoozedUntil: snoozedUntil,
                    idempotencyKey: UUID().uuidString.lowercased()
                )
            }
            inFlight = request
            retry = request
            message = state == .later ? "正在保存行动回流时间……" : state == .new ? "正在恢复行动到待处理……" : "正在标记为已处理……"
            let write = try await client.writeTodayMaterialChangeDisposition(item: item, request: request)
            guard write.source.actorType == "user",
                  write.source.actorId == expectedActorId,
                  write.data.itemId == item.id,
                  write.data.membershipId == item.membership.id,
                  write.data.membershipVersion == item.membership.version,
                  write.data.symbol == item.symbol,
                  write.data.sourceId == item.source.id,
                  write.data.sourceVersion == item.source.version,
                  write.data.sourceFingerprint == item.source.sourceFingerprint,
                  write.data.state == state else {
                throw TodayActionInboxValidationError.invalid(["行动处置写入身份未确认，未安装结果"])
            }
            let fresh = await client.fetchTodayActionInbox()
            guard fresh.status == .available,
                  fresh.requestedActorId == expectedActorId,
                  let freshItem = fresh.items.first(where: { $0.id == item.id }),
                  freshItem.kind == item.kind,
                  freshItem.membership.id == item.membership.id,
                  freshItem.membership.version == item.membership.version,
                  freshItem.symbol == item.symbol,
                  freshItem.source.id == item.source.id,
                  freshItem.source.lane == item.source.lane,
                  freshItem.source.sourceType == item.source.sourceType,
                  freshItem.source.version == item.source.version,
                  freshItem.source.sourceFingerprint == item.source.sourceFingerprint,
                  freshItem.state == state else {
                throw TodayActionInboxValidationError.invalid(["fresh Today read did not confirm the action disposition"])
            }
            envelope = fresh
            retry = nil
            message = state == .later ? "行动已设为稍后；到期后会重新回到待处理。" : state == .new ? "行动已恢复到待处理。" : Self.isSourceResearchChange(item) ? "此条来源提醒已处理；研究和复盘状态未改变。" : "已标记为已处理。"
        } catch {
            message = "处置结果未确认；再次点击同一操作会使用原幂等身份重试。\(error.localizedDescription)"
        }
        inFlight = nil
    }
}
