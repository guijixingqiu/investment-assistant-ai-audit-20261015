import SwiftUI
import UserNotifications

struct TodayHighImpactNotificationControls: View {
    @AppStorage("today.highImpactNotificationsEnabled") private var enabled = false
    @AppStorage("today.highImpactNotificationFingerprint") private var lastFingerprint = ""
    @AppStorage("today.highImpactQuietStartHour") private var quietStartHour = 22
    @AppStorage("today.highImpactQuietEndHour") private var quietEndHour = 8
    @State private var message = "默认关闭；开启后只合并提醒待处理的高影响事项。"
    @State private var authorizationIssue: String?

    let envelope: TodayActionInboxEnvelope
    let isLoading: Bool

    var body: some View {
        DisclosureGroup("高影响系统通知") {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("允许系统通知", isOn: $enabled)
                    .accessibilityIdentifier("todayHighImpactNotificationsToggle")
                Stepper("免打扰开始 \(hourLabel(quietStartHour))", value: $quietStartHour, in: 0...23)
                Stepper("免打扰结束 \(hourLabel(quietEndHour))", value: $quietEndHour, in: 0...23)
                Text("只有在打开或刷新 Today 时才会安排本地通知；应用不会在后台持续监控。香港时间；开始与结束相同表示不额外静默。点击通知会重新读取 Today 并核对精确事项，不会自动写入研究、决定或资产。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayHighImpactNotificationsStatus")
            }
            .padding(.top, 6)
        }
        .accessibilityIdentifier("todayHighImpactNotifications")
        .task(id: "\(enabled):\(quietStartHour):\(quietEndHour):\(envelope.generatedAt):\(isLoading)") {
            await synchronize()
        }
    }

    @MainActor
    private func synchronize() async {
        let center = UNUserNotificationCenter.current()
        guard enabled else {
            center.removePendingNotificationRequests(withIdentifiers: [TodayHighImpactNotificationRouter.requestIdentifier])
            lastFingerprint = ""
            message = authorizationIssue ?? "系统通知已关闭。"
            return
        }
        guard !isLoading else { return }

        do {
            let settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                guard try await center.requestAuthorization(options: [.alert, .sound]) else {
                    authorizationIssue = "系统未允许通知；请在系统设置中允许后，再打开此开关。"
                    enabled = false
                    message = authorizationIssue ?? "系统未允许通知。"
                    return
                }
            } else if settings.authorizationStatus == .denied {
                authorizationIssue = "系统通知权限已关闭；请在系统设置中允许后，再打开此开关。"
                enabled = false
                message = authorizationIssue ?? "系统通知权限已关闭，请在系统设置中修改。"
                return
            }
            authorizationIssue = nil

            guard envelope.status == .available || envelope.status == .empty else {
                // 读取失败时撤销已安排的提醒并同时重置去重，避免用旧事实提醒；
                // 读取恢复后会按新事实重新核对并再次安排。
                center.removePendingNotificationRequests(withIdentifiers: [TodayHighImpactNotificationRouter.requestIdentifier])
                lastFingerprint = ""
                message = "Today 读取失败；已暂停提醒，重新读取成功后再安排。"
                return
            }
            guard !envelope.metadata.fixture else {
                center.removePendingNotificationRequests(withIdentifiers: [TodayHighImpactNotificationRouter.requestIdentifier])
                lastFingerprint = ""
                message = "测试样本不会生成系统通知。"
                return
            }

            // 普通研究进度不提醒；仅高影响的新研究复核事项需要 Owner 处理。
            let excludedKinds: [TodayActionInboxItemKind] = [.candidateFound, .sourceFailure]
            let items = envelope.items.filter {
                $0.state == .new && ["action", "high"].contains($0.priority)
                    && !excludedKinds.contains($0.kind)
                    && ($0.kind != .research || $0.source.sourceType == "research_review_v1")
            }
            guard let first = items.first else {
                center.removePendingNotificationRequests(withIdentifiers: [TodayHighImpactNotificationRouter.requestIdentifier])
                lastFingerprint = ""
                message = "当前没有待提醒的高影响事项。"
                return
            }
            let fingerprint = items.map {
                "\($0.id):v\($0.membership.version):\($0.source.sourceFingerprint ?? "none"):\($0.title):\($0.summary)"
            }.joined(separator: "|") + ":quiet\(quietStartHour)-\(quietEndHour)"
            guard fingerprint != lastFingerprint else {
                message = "当前高影响事项已去重，不会重复提醒。"
                return
            }

            let content = UNMutableNotificationContent()
            content.title = items.count == 1 ? "今日有 1 项高影响事项" : "今日有 \(items.count) 项高影响事项"
            content.body = "\(first.symbol) · \(first.title)"
            content.sound = .default
            content.threadIdentifier = "annual-rings.today"
            var userInfo: [String: Any] = [
                "itemId": first.id,
                "symbol": first.symbol,
                "membershipId": first.membership.id,
                "membershipVersion": first.membership.version,
                "sourceId": first.source.id
            ]
            if let sourceFingerprint = first.source.sourceFingerprint { userInfo["sourceFingerprint"] = sourceFingerprint }
            content.userInfo = userInfo
            try await center.add(UNNotificationRequest(
                identifier: TodayHighImpactNotificationRouter.requestIdentifier,
                content: content,
                trigger: notificationTrigger()
            ))
            lastFingerprint = fingerprint
            message = "已合并安排 \(items.count) 项高影响提醒；点击通知会打开第一项，其余项可在 Today 列表中查看。"
        } catch {
            message = "系统通知安排失败；Today 内事项仍可正常查看。"
        }
    }

    private func notificationTrigger(now: Date = Date()) -> UNNotificationTrigger {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Hong_Kong")!
        let hour = calendar.component(.hour, from: now)
        guard quietStartHour != quietEndHour,
              quietStartHour < quietEndHour
                ? hour >= quietStartHour && hour < quietEndHour
                : hour >= quietStartHour || hour < quietEndHour else {
            return UNTimeIntervalNotificationTrigger(timeInterval: 60, repeats: false)
        }
        return UNCalendarNotificationTrigger(
            dateMatching: DateComponents(timeZone: calendar.timeZone, hour: quietEndHour, minute: 0),
            repeats: false
        )
    }

    private func hourLabel(_ hour: Int) -> String { String(format: "%02d:00", hour) }
}

struct TodayHighImpactNotificationTarget: Equatable {
    let itemId: String
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let sourceId: String
    let sourceFingerprint: String?

    init?(userInfo: [AnyHashable: Any]) {
        guard let itemId = userInfo["itemId"] as? String, !itemId.isEmpty,
              let symbol = userInfo["symbol"] as? String,
              SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol,
              let membershipId = userInfo["membershipId"] as? String, !membershipId.isEmpty,
              let membershipVersion = userInfo["membershipVersion"] as? Int, membershipVersion > 0,
              let sourceId = userInfo["sourceId"] as? String, !sourceId.isEmpty else { return nil }
        let fingerprint = userInfo["sourceFingerprint"] as? String
        guard fingerprint == nil || fingerprint?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        self.itemId = itemId; self.symbol = symbol; self.membershipId = membershipId
        self.membershipVersion = membershipVersion; self.sourceId = sourceId; sourceFingerprint = fingerprint
    }

    func matches(_ item: TodayActionInboxItem) -> Bool {
        item.id == itemId && item.symbol == symbol && item.membership.id == membershipId
            && item.membership.version == membershipVersion && item.source.id == sourceId
            && item.source.sourceFingerprint == sourceFingerprint
    }
}

final class TodayHighImpactNotificationRouter: NSObject, ObservableObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let requestIdentifier = "annual-rings.today.high-impact"
    static let shared = TodayHighImpactNotificationRouter()
    @Published private(set) var pendingTarget: TodayHighImpactNotificationTarget?

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func consume(_ target: TodayHighImpactNotificationTarget) {
        if pendingTarget == target { pendingTarget = nil }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let target = response.notification.request.identifier == Self.requestIdentifier
            ? TodayHighImpactNotificationTarget(userInfo: response.notification.request.content.userInfo)
            : nil
        if let target { DispatchQueue.main.async { self.pendingTarget = target } }
        completionHandler()
    }
}
