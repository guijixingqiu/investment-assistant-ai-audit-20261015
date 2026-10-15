import SwiftUI

struct TodayConnectionCard: View {
    let refreshRevision: UInt64
    let connectionChanged: () -> Void
    @State private var state = ConnectionState.loading
    @State private var showsSettings = false
    @State private var showsTechnicalDetails = false
    @State private var requestId = UUID()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if let label = AppEnvironment.experienceLabel {
                experienceIsolationNotice(label)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(state.rows) { row in ServiceStatusRowView(row: row) }
            }
            Text(state.footnote)
                .font(.caption)
                .foregroundStyle(.secondary)
            technicalDetails
        }
        .cardStyle()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("todayConnectionCard")
        .task(id: refreshRevision) { await load() }
        .sheet(isPresented: $showsSettings) {
            ConnectionSettingsView {
                connectionChanged()
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Label("服务状态", systemImage: state.systemImage)
                .font(.headline)
                .foregroundStyle(state.color)
            Spacer()
            Text(state.summaryTitle)
                .font(.caption.weight(.bold))
                .foregroundStyle(state.color)
            Button { showsSettings = true } label: { Image(systemName: "gearshape") }
                .accessibilityLabel("连接设置")
            Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                .accessibilityLabel("重新检查连接")
        }
    }

    private func experienceIsolationNotice(_ label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("体验会话：\(label)", systemImage: "person.crop.circle.badge.exclamationmark")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.orange)
            Text("公开研究与行情通过真实服务读取；个人持仓、决定和复盘中的体验样本会明确标注，并保存在独立体验库。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("todayExperienceIsolationNotice")
    }

    private var technicalDetails: some View {
        DisclosureGroup(isExpanded: $showsTechnicalDetails) {
            VStack(alignment: .leading, spacing: 6) {
                Text("服务地址：\(AppEnvironment.baseURL().absoluteString)")
                Text("读取请求头：\(AppEnvironment.authHeaderName())；写入请求头：\(AppEnvironment.writeAuthHeaderName())")
                Text(AppEnvironment.authToken() == nil ? "读取令牌：未配置。" : "读取令牌：已在本机钥匙串配置。")
                Text(AppEnvironment.writeAuthToken() == nil
                    ? "写入令牌：未配置，保存、确认与复盘暂不可用。"
                    : "写入令牌：已在本机钥匙串配置；每次写入仍会再次校验权限。")
                if let readDetail = state.readDetail { Text("研究数据读取：\(readDetail)") }
                Button("编辑连接地址与令牌") { showsSettings = true }
                    .accessibilityIdentifier("todayConnectionTechnicalSettings")
                Text("这里不接受券商、交易、VPS 或管理后台凭证。")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Text("技术详情：地址、请求头与令牌").font(.caption)
        }
    }

    @MainActor
    private func load() async {
        let currentRequestId = UUID()
        let context = AppEnvironment.researchAuthorizationContext()
        requestId = currentRequestId
        state = .loading
        do {
            var request = URLRequest(url: context.baseURL.appending(path: "health/ready"))
            request.timeoutInterval = 5
            let (data, _) = try await URLSession.shared.data(for: request)
            let health = try JSONDecoder().decode(ConnectionHealth.self, from: data)
            guard requestId == currentRequestId, !Task.isCancelled,
                  AppEnvironment.researchAuthorizationContext() == context else { return }
            var readDetail: String? = nil
            if health.readiness.database == "ready" {
                let memberships = await ResearchClient(
                    baseURL: context.baseURL,
                    authToken: context.readToken,
                    authHeaderName: context.readHeaderName
                ).fetchCandidateMemberships(includeArchived: false)
                guard requestId == currentRequestId, !Task.isCancelled,
                      AppEnvironment.researchAuthorizationContext() == context else { return }
                if memberships.status == .unavailable {
                    readDetail = context.readToken == nil
                        ? "未验证：首次连接或凭证已清除，请配置读取令牌。"
                        : "读取失败：请检查读取令牌，或稍后重试。"
                } else {
                    readDetail = "已用当前令牌实际读取过研究数据。"
                }
            }
            state = .report(ConnectionReport(
                serviceOK: health.ok,
                provider: health.marketProvider,
                database: health.readiness.database,
                schema: health.readiness.schema,
                marketData: health.readiness.marketData,
                rawStore: health.readiness.rawStore,
                researchAi: health.readiness.researchAi,
                taskRunner: health.readiness.taskRunner,
                readDetail: readDetail
            ))
        } catch {
            guard requestId == currentRequestId, !Task.isCancelled,
                  AppEnvironment.researchAuthorizationContext() == context else { return }
            state = .unreachable("无法连接本地研究服务；请检查地址、服务状态或网络。")
        }
    }
}

private struct ConnectionReport {
    let serviceOK: Bool
    let provider: String
    let database: String
    let schema: String?
    let marketData: String?
    let rawStore: String?
    let researchAi: String?
    let taskRunner: String?
    let readDetail: String?

    var databaseReady: Bool { serviceOK && database == "ready" && schema == "ready" }
    var marketSourceLabel: String {
        ["futu", "futu-http", "futu_opend"].contains(provider) ? "VPS OpenD 行情（只读）" : "本地行情服务（\(provider)）"
    }
}

private struct ServiceStatusRow: Identifiable {
    let id: String
    let title: String
    let value: String
    let detail: String?
    let symbol: String
    let color: Color
}

private struct ServiceStatusRowView: View {
    let row: ServiceStatusRow

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: row.symbol)
                .foregroundStyle(row.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.title).font(.callout.weight(.medium))
                    Spacer()
                    Text(row.value).font(.callout.weight(.semibold)).foregroundStyle(row.color)
                }
                if let detail = row.detail {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(["\(row.title)：\(row.value)", row.detail].compactMap { $0 }.joined(separator: "。"))
    }
}

private enum ConnectionState {
    case loading
    case report(ConnectionReport)
    case unreachable(String)

    var summaryTitle: String {
        switch self {
        case .loading: "检查中"
        case let .report(report): report.databaseReady ? "服务可用" : "需处理"
        case .unreachable: "需处理"
        }
    }

    var systemImage: String {
        switch self {
        case .loading: "network"
        case .report: "checkmark.circle.fill"
        case .unreachable: "exclamationmark.triangle.fill"
        }
    }

    var color: Color {
        switch self {
        case .loading: .secondary
        case let .report(report): report.databaseReady ? .green : .orange
        case .unreachable: .orange
        }
    }

    var footnote: String {
        switch self {
        case .loading: "正在检查本机 API、数据库与读取权限。"
        case let .report(report):
            report.databaseReady
                ? "状态来自本机 /health/ready 与实际读取请求；保存、确认与复盘仍会逐次校验权限。"
                : "本机研究服务已响应，但数据库或结构尚未就绪；请重新启动本地研究服务后重新检查。"
        case .unreachable: "本机研究服务未响应，其余服务无法确认；已有本机草稿不会被修改。"
        }
    }

    var readDetail: String? {
        if case let .report(report) = self { return report.readDetail }
        return nil
    }

    var rows: [ServiceStatusRow] {
        switch self {
        case .loading:
            [ServiceStatusRow(id: "api", title: "本地 API 与数据库", value: "检查中", detail: nil, symbol: "network", color: .secondary)]
        case let .unreachable(message):
            [ServiceStatusRow(id: "api", title: "本地 API 与数据库", value: "未连接", detail: message, symbol: "exclamationmark.triangle.fill", color: .orange)]
        case let .report(report):
            Self.reportRows(report)
        }
    }

    private static func reportRows(_ report: ConnectionReport) -> [ServiceStatusRow] {
        let marketReady = report.marketData == "ready"
        let rawStoreReady = report.rawStore == "ready"
        let aiConfigured = report.researchAi == "configured"
        let runnerRunning = report.taskRunner == "running"
        let apiDetail = report.databaseReady ? report.readDetail : (report.database == "ready"
            ? "数据库在线，但服务报告未就绪或结构尚未完成升级；请重新启动本地研究服务。"
            : "数据库报告：\(report.database)。")
        return [
            ServiceStatusRow(id: "api", title: "本地 API 与数据库", value: report.databaseReady ? "运行中" : "未就绪",
                detail: apiDetail, symbol: report.databaseReady ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                color: report.databaseReady ? .green : .orange),
            ServiceStatusRow(id: "market", title: "行情（VPS + OpenD）", value: marketReady ? "已连接" : "未连接",
                detail: marketReady ? "来源：\(report.marketSourceLabel)；只读行情，不会下单。"
                    : "来源：\(report.marketSourceLabel)；已有研究记录仍可查看，服务恢复后点“重新检查”。",
                symbol: marketReady ? "chart.line.uptrend.xyaxis" : "exclamationmark.triangle.fill",
                color: marketReady ? .green : .orange),
            ServiceStatusRow(id: "rawStore", title: "原始材料存储", value: rawStoreReady ? "可读写" : "不可用",
                detail: rawStoreReady ? "PDF 与引用页面可读取。" : "原始文档存储暂不可用，PDF 与引用页面暂不能读取。",
                symbol: rawStoreReady ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                color: rawStoreReady ? .green : .orange),
            ServiceStatusRow(id: "ai", title: "AI 综合（真实模型服务）", value: aiConfigured ? "已配置" : "未配置",
                detail: aiConfigured ? "健康检查只确认“已配置”，尚未验证真实模型调用成功；结论以研究任务的实际输出为准。"
                    : "未配置 AI 服务；已有报告与决定不受影响。",
                symbol: aiConfigured ? "sparkles" : "exclamationmark.triangle.fill",
                color: aiConfigured ? .secondary : .orange),
            ServiceStatusRow(id: "taskRunner", title: "研究任务运行器", value: runnerRunning ? "运行中" : "未运行",
                detail: runnerRunning ? "深度研究任务与材料处理会排队执行。" : "研究任务暂不执行；已有报告与决定不受影响。",
                symbol: runnerRunning ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                color: runnerRunning ? .green : .orange)
        ]
    }
}

struct ConnectionSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    let onSaved: () -> Void
    @State private var baseURL = AppEnvironment.baseURL().absoluteString
    @State private var readHeader = AppEnvironment.authHeaderName()
    @State private var writeHeader = AppEnvironment.writeAuthHeaderName()
    @State private var readToken = ""
    @State private var writeToken = ""
    @State private var message: String?
    @State private var showsClearConfirmation = false

    private var isExperienceSession: Bool { AppEnvironment.isExperienceSession }

    var body: some View {
        NavigationStack {
            Form {
                Section("本地研究服务") {
                    TextField("https://research.example.com", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    Text("远程地址必须使用 HTTPS；Debug 本地验收允许本机或私有局域网 HTTP。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("内部 API 令牌") {
                    TextField("读取请求头", text: $readHeader)
                        .textInputAutocapitalization(.never)
                    TextField("写入请求头", text: $writeHeader)
                        .textInputAutocapitalization(.never)
                    SecureField(AppEnvironment.authToken() == nil ? "读取令牌" : "读取令牌已配置；留空不修改", text: $readToken)
                    SecureField(AppEnvironment.writeAuthToken() == nil ? "写入令牌" : "写入令牌已配置；留空不修改", text: $writeToken)
                    Text(isExperienceSession ? "体验版启动器已将连接凭证保存在此 App 的钥匙串，关闭后可再次打开。现有令牌不会显示。" : "令牌只写入 iOS 钥匙串，不显示现有值；点击“保存”后持久化。这里不接受券商或交易凭证。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if isExperienceSession {
                    Section("体验版隔离") {
                        Text("当前是体验版（\(AppEnvironment.experienceLabel ?? "")）：这是独立的体验 App，使用独立标识与本机存储，只连接体验库；日常 App 的地址、令牌、草稿与数据都不会被这次体验读写。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("正式研究档案") {
                    NavigationLink {
                        FormalResearchBackupView()
                    } label: {
                        Label("全公司正式研究备份", systemImage: "externaldrive")
                    }.accessibilityIdentifier("formalBackupFromSettings")
                    Text("独立读取 Owner 全公司备份状态，不以当前选中股票的资料代替。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("凭证管理") {
                    Button("清除本服务器令牌", role: .destructive) { showsClearConfirmation = true }
                        .accessibilityIdentifier("clearCurrentConnectionTokens")
                    Text("只清除研究服务的读取与保存令牌，不删除报告、决定、资产记录或服务器数据。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let message { Text(message).foregroundStyle(.red) }
            }
            .navigationTitle("连接设置")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("保存") { save() } }
            }
            .alert("清除本服务器令牌？", isPresented: $showsClearConfirmation) {
                Button("取消", role: .cancel) {}
                Button("清除", role: .destructive) { clearTokens() }
            } message: {
                Text("清除后需要重新输入读取和写入令牌才能连接或保存；报告和其他数据不会被删除。")
            }
        }
    }

    private func save() {
        do {
            let currentURL = AppEnvironment.baseURL()
            let targetURL = AppEnvironment.validatedBaseURL(baseURL)
            try AppEnvironment.saveConnectionSettings(
                baseURL: baseURL,
                readHeader: readHeader,
                writeHeader: writeHeader,
                readToken: AppEnvironment.tokenForExplicitSave(entered: readToken, current: AppEnvironment.authToken(), targetURL: targetURL, currentURL: currentURL),
                writeToken: AppEnvironment.tokenForExplicitSave(entered: writeToken, current: AppEnvironment.writeAuthToken(), targetURL: targetURL, currentURL: currentURL)
            )
            onSaved()
            dismiss()
        } catch AppConnectionSettingsError.invalidBaseURL {
            message = "地址无效：远程必须使用 HTTPS；Debug 本地验收仅允许本机或私有局域网 HTTP。"
        } catch AppConnectionSettingsError.invalidHeaderName {
            message = "请求头名称无效，请勿输入空格、冒号或换行。"
        } catch AppConnectionSettingsError.tokensRequiredForNewOrigin {
            message = "更换服务器地址时必须重新输入读取和写入令牌。"
        } catch {
            message = "令牌未能安全写入钥匙串，请稍后重试。"
        }
    }

    private func clearTokens() {
        do {
            try AppEnvironment.clearCurrentConnectionTokens()
            onSaved()
            dismiss()
        } catch {
            message = "令牌未能完整清除，请重新检查后再试。"
        }
    }
}

private struct ConnectionHealth: Decodable {
    let ok: Bool
    let marketProvider: String
    let readiness: Readiness

    struct Readiness: Decodable {
        let database: String
        let schema: String?
        let marketData: String?
        let rawStore: String?
        let researchAi: String?
        let taskRunner: String?
    }
}
