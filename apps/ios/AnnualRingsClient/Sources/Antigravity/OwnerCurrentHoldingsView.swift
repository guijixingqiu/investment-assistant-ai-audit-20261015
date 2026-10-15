import SwiftUI
import UniformTypeIdentifiers

private enum OwnerHoldingsCSVError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        if case .invalid(let message) = self { return message }
        return nil
    }
}

/// Keeps an unresolved save and its draft while the editor sheet is closed.
@MainActor
final class OwnerCurrentHoldingsSession: ObservableObject {
    static let shared = OwnerCurrentHoldingsSession()
    @Published var rows: [OwnerCurrentHoldingsView.Row] = []
    @Published var loaded: AssetsAlphaEnvelope?
    @Published var authorization: AppResearchAuthorizationContext?
    @Published var busy = false
    @Published var message: String?
    @Published var pendingRequest: CreateAssetsAlphaSnapshotRequest?
    @Published var importedAsOf: String?
    @Published var importedBasisSnapshotId: String?
    @Published var importedActorId: String?
    private init() {}
}

/// Owner-confirmed quantities and lot costs; revisions use the existing private asset ledger.
@MainActor
struct OwnerCurrentHoldingsView: View {
    struct Row: Identifiable {
        let id = UUID()
        var symbol: String
        var quantity: String
        var cost: String
    }
    private struct CSVPreview {
        let rows: [Row]
        let asOf: String
        let actorId: String
        let expectedSnapshotId: String?
        let authorization: AppResearchAuthorizationContext
        let quantity: Double
        let cost: Double
    }
    private static let csvHeader = "symbol,quantity,unit_cost_hkd,as_of"
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var api = OwnerClientStore.shared
    @ObservedObject private var state = OwnerCurrentHoldingsSession.shared
    @State private var showCSVImporter = false
    @State private var csvPreview: CSVPreview?
    @State private var csvMessage: String?
    private var rows: [Row] { get { state.rows } nonmutating set { state.rows = newValue } }
    private var loaded: AssetsAlphaEnvelope? { get { state.loaded } nonmutating set { state.loaded = newValue } }
    private var authorization: AppResearchAuthorizationContext? { get { state.authorization } nonmutating set { state.authorization = newValue } }
    private var busy: Bool { get { state.busy } nonmutating set { state.busy = newValue } }
    private var message: String? { get { state.message } nonmutating set { state.message = newValue } }
    // One reservation and draft survive sheet dismissal; a retry uses the original idempotency key.
    private var pendingRequest: CreateAssetsAlphaSnapshotRequest? { get { state.pendingRequest } nonmutating set { state.pendingRequest = newValue } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("本人确认的当前真实持仓")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.textPrimary)
                    if authorization != nil && authorization != AppEnvironment.researchAuthorizationContext() {
                        Text(pendingRequest == nil
                             ? "连接身份已变化，正在读取当前身份的持仓；不会显示旧身份的数据。"
                             : "连接身份已变化。原身份的待确认请求仍保留；请切回原身份后再核对。本页不会显示或重试旧身份的草稿。")
                            .font(.system(size: 12)).foregroundStyle(Theme.amber)
                            .accessibilityIdentifier("ownerHoldingsIdentityChanged")
                    } else {
                    Text("按每笔成本维护，保存后用于资产与组合分析。费用和买入日期未记录。")
                        .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    if let cash = loaded?.snapshots.first(where: { $0.source == .ownerCurrent })?.cashHkd {
                        Text("此前记录的现金 HKD \(cash.formatted()) 会原样保留；本页只修改股票持仓。")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    } else {
                        Text("现金未记录；本页只修改股票持仓。")
                            .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    if pendingRequest != nil {
                        Text("上次保存结果尚未核清。可离开本页，返回后原请求和草稿仍在；请原样重试或重新读取已保存版本。")
                            .font(.system(size: 12)).foregroundStyle(Theme.amber)
                    }
                    DisclosureGroup("从 CSV 载入当前持仓草稿") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("固定表头：\(Self.csvHeader)。每行一笔：港股代码、正整数股数、每股成本（港元）、同一个 RFC3339 记录时间。CSV 不含现金、费用或交易日期；不读取券商专用格式。")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                            Text("CSV 记录时间用于核对来源；点击下方保存时，才以当时的确认时间记录当前持仓。旧草稿只在你明确载入后被替换。")
                                .font(.caption).foregroundStyle(Theme.textSecondary)
                            Button("选择 CSV 文件") { showCSVImporter = true }
                                .disabled(busy || pendingRequest != nil || loaded == nil)
                                .accessibilityIdentifier("ownerHoldingsChooseCSV")
                            if let preview = csvPreview {
                                Text("待载入：\(preview.rows.count) 笔 · \(preview.quantity.formatted(.number.precision(.fractionLength(0)))) 股 · 记录于 \(preview.asOf)")
                                    .font(.caption.weight(.semibold))
                                Text("逐笔成本合计 HKD \(preview.cost.formatted(.number.precision(.fractionLength(2))))；请核对原 CSV 和当前实际持仓。")
                                    .font(.caption)
                                ForEach(Array(preview.rows.enumerated()), id: \.offset) { index, row in
                                    Text("第 \(index + 1) 笔 · \(row.symbol) · \(row.quantity) 股 · 每股 HKD \(row.cost)")
                                        .font(.caption.monospacedDigit())
                                }
                                Button("确认载入草稿，替换当前未保存输入") { applyCSVPreview() }
                                    .disabled(busy || pendingRequest != nil)
                                    .accessibilityIdentifier("ownerHoldingsApplyCSV")
                                Button("取消此次导入") { csvPreview = nil; csvMessage = nil }
                                    .disabled(busy || pendingRequest != nil)
                            }
                            if let csvMessage {
                                Text(csvMessage).font(.caption).foregroundStyle(Theme.amber)
                                    .accessibilityIdentifier("ownerHoldingsCSVMessage")
                            }
                        }
                    }
                    if let importedAsOf = state.importedAsOf {
                        Text("已载入 CSV 草稿 · 原记录时间 \(importedAsOf)。下面每笔仍可修改；确认保存前请核对当前实际持仓、成本和日期。")
                            .font(.caption).foregroundStyle(Theme.amber)
                    }
                    ForEach(Array(rows.indices), id: \.self) { index in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("第 \(index + 1) 笔").foregroundStyle(Theme.gold)
                                Spacer()
                                Button("移除此笔") { rows.remove(at: index) }
                                    .disabled(pendingRequest != nil)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            field("港股代码", text: $state.rows[index].symbol, id: "ownerLotSymbol-\(index)")
                            field("持有股数", text: $state.rows[index].quantity, id: "ownerLotQuantity-\(index)", numeric: true)
                            field("每股成本 · HKD", text: $state.rows[index].cost, id: "ownerLotCost-\(index)", numeric: true)
                        }
                        .font(.system(size: 13)).padding(14).templateCardStyle()
                        .disabled(pendingRequest != nil)
                    }
                    Button("增加一笔") {
                        rows.append(Row(symbol: api.currentSymbol, quantity: "", cost: ""))
                    }.foregroundStyle(Theme.blue).disabled(pendingRequest != nil)
                    if let totals = draftTotals {
                        Text("合计 \(totals.quantity, specifier: "%.0f") 股 · 成本 HKD \(totals.cost, specifier: "%.2f")")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.gold)
                    }
                    if rows.isEmpty && loaded != nil {
                        Text("保存空列表将确认当前没有股票持仓；旧版本仍保留。")
                            .font(.system(size: 12)).foregroundStyle(Theme.amber)
                    }
                    if let message {
                        Text(message).font(.system(size: 12)).foregroundStyle(Theme.amber)
                            .accessibilityIdentifier("ownerHoldingsMessage")
                    }
                    Button { Task { await save() } } label: {
                        Text(busy ? "正在核对…" : "确认并保存当前持仓")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity).padding(13)
                            .background(Theme.gold.opacity(0.17)).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .foregroundStyle(Theme.gold).disabled(busy || loaded == nil)
                    .accessibilityIdentifier("ownerHoldingsSave")
                    Button("重新读取已保存数据") { Task { await load() } }
                        .font(.system(size: 12)).foregroundStyle(Theme.blue)
                    }
                }.padding(16).disabled(busy)
            }
            .background(Theme.bgPrimary.ignoresSafeArea())
            .navigationTitle("手动修改持仓").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .task { await load() }
            .fileImporter(isPresented: $showCSVImporter, allowedContentTypes: [.commaSeparatedText],
                          allowsMultipleSelection: false, onCompletion: importCSV)
        }
        .preferredColorScheme(Theme.isDark ? .dark : .light)
    }

    private func field(_ title: String, text: Binding<String>, id: String, numeric: Bool = false) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.textSecondary)
            Spacer()
            TextField(title, text: text)
                .multilineTextAlignment(.trailing).textInputAutocapitalization(.characters)
                .keyboardType(numeric ? .decimalPad : .asciiCapable)
                .foregroundStyle(Theme.textPrimary).accessibilityIdentifier(id)
        }
    }
    private func importCSV(_ result: Result<[URL], Error>) {
        guard !busy, pendingRequest == nil, let loaded, let authorization,
              authorization == AppEnvironment.researchAuthorizationContext() else {
            csvMessage = "当前持仓尚未读取、连接已变化或上一笔保存待核清；保留原草稿。"
            return
        }
        do {
            let urls = try result.get()
            guard urls.count == 1, let url = urls.first else {
                throw OwnerHoldingsCSVError.invalid("请选择一份 CSV 文件；原草稿未变。")
            }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let fileSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
            guard let fileSize, fileSize > 0, fileSize <= 64 * 1_024 else {
                throw OwnerHoldingsCSVError.invalid("CSV 须为非空 UTF-8 文件且不超过 64 KB；原草稿未变。")
            }
            let parsed = try parseCSV(Data(contentsOf: url))
            guard self.loaded?.requestedActorId == loaded.requestedActorId,
                  self.loaded?.snapshots.first(where: { $0.source == .ownerCurrent })?.id
                    == loaded.snapshots.first(where: { $0.source == .ownerCurrent })?.id,
                  self.authorization == authorization,
                  authorization == AppEnvironment.researchAuthorizationContext() else {
                throw OwnerHoldingsCSVError.invalid("读取期间持仓或连接身份已变化；原草稿未变。")
            }
            csvPreview = CSVPreview(rows: parsed.rows, asOf: parsed.asOf,
                actorId: loaded.requestedActorId,
                expectedSnapshotId: loaded.snapshots.first(where: { $0.source == .ownerCurrent })?.id,
                authorization: authorization, quantity: parsed.quantity, cost: parsed.cost)
            csvMessage = "已校验固定列和逐笔成本；尚未载入草稿，也未保存持仓。"
        } catch {
            csvPreview = nil
            csvMessage = error.localizedDescription
        }
    }

    private func parseCSV(_ data: Data) throws -> (rows: [Row], asOf: String, quantity: Double, cost: Double) {
        guard !data.isEmpty, data.count <= 64 * 1_024, var text = String(data: data, encoding: .utf8) else {
            throw OwnerHoldingsCSVError.invalid("CSV 须为非空 UTF-8 文件且不超过 64 KB。")
        }
        if text.first == "\u{feff}" { text.removeFirst() }
        guard !text.contains("\"") && !text.contains("\0") else {
            throw OwnerHoldingsCSVError.invalid("此固定列格式不支持引号或控制字符；原草稿未变。")
        }
        text = text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }
        guard lines.first == Self.csvHeader else {
            throw OwnerHoldingsCSVError.invalid("表头须完全是 \(Self.csvHeader)；原草稿未变。")
        }
        guard (2...101).contains(lines.count) else {
            throw OwnerHoldingsCSVError.invalid("CSV 须有 1 至 100 笔持仓；原草稿未变。")
        }
        var parsedRows: [Row] = []
        var sharedAsOf: String?
        for (offset, line) in lines.dropFirst().enumerated() {
            let number = offset + 2
            let fields = line.split(separator: ",", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
            guard fields.count == 4 else {
                throw OwnerHoldingsCSVError.invalid("第 \(number) 行须有 4 列，且不能留空行；原草稿未变。")
            }
            guard let symbol = SecuritySymbol.parseHongKongAlias(fields[0]) else {
                throw OwnerHoldingsCSVError.invalid("第 \(number) 行港股代码无效；原草稿未变。")
            }
            guard fields[1].range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil,
                  let quantity = Double(fields[1]), quantity.isFinite,
                  quantity <= 9_007_199_254_740_991 else {
                throw OwnerHoldingsCSVError.invalid("第 \(number) 行股数须为正整数；原草稿未变。")
            }
            guard fields[2].range(of: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$", options: .regularExpression) != nil,
                  let cost = Double(fields[2]), cost.isFinite, cost > 0,
                  (quantity * cost).isFinite else {
                throw OwnerHoldingsCSVError.invalid("第 \(number) 行每股港元成本须大于零；原草稿未变。")
            }
            let asOf = fields[3]
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = fractional.date(from: asOf) ?? plain.date(from: asOf),
                  date <= Date().addingTimeInterval(60),
                  sharedAsOf == nil || sharedAsOf == asOf else {
                throw OwnerHoldingsCSVError.invalid("第 \(number) 行须使用同一个非未来 RFC3339 记录时间；原草稿未变。")
            }
            sharedAsOf = asOf
            parsedRows.append(Row(symbol: symbol.canonical, quantity: fields[1], cost: fields[2]))
        }
        let positions: [AssetsAlphaPosition]
        do { positions = try draftPositions(parsedRows) }
        catch { throw OwnerHoldingsCSVError.invalid("CSV 的同代码合计或逐笔成本无效；原草稿未变。") }
        let quantity = positions.reduce(0) { $0 + $1.quantity }
        let cost = positions.reduce(0) { total, position in
            total + (position.costLots ?? []).reduce(0) { $0 + $1.quantity * $1.unitCostHkd }
        }
        guard let sharedAsOf, quantity.isFinite, cost.isFinite else {
            throw OwnerHoldingsCSVError.invalid("CSV 总股数或总成本超出有效范围；原草稿未变。")
        }
        return (parsedRows, sharedAsOf, quantity, cost)
    }

    private func applyCSVPreview() {
        guard let preview = csvPreview, !busy, pendingRequest == nil, let loaded,
              loaded.requestedActorId == preview.actorId,
              loaded.snapshots.first(where: { $0.source == .ownerCurrent })?.id == preview.expectedSnapshotId,
              authorization == preview.authorization,
              preview.authorization == AppEnvironment.researchAuthorizationContext() else {
            csvPreview = nil
            csvMessage = "持仓版本或连接已变化；未载入 CSV，请重新读取。"
            return
        }
        rows = preview.rows
        state.importedAsOf = preview.asOf
        state.importedBasisSnapshotId = preview.expectedSnapshotId
        state.importedActorId = preview.actorId
        csvPreview = nil
        csvMessage = "CSV 已载入草稿。请逐笔核对当前实际持仓，再按原按钮明确确认保存。"
    }
    private var draftTotals: (quantity: Double, cost: Double)? {
        guard let positions = try? draftPositions() else { return nil }
        return (positions.reduce(0) { $0 + $1.quantity }, positions.reduce(0) { total, position in
            total + (position.costLots ?? []).reduce(0) { $0 + $1.quantity * $1.unitCostHkd }
        })
    }
    private func draftPositions(_ proposedRows: [Row]? = nil) throws -> [AssetsAlphaPosition] {
        var grouped: [String: [AssetsAlphaCostLot]] = [:]
        for row in proposedRows ?? rows {
            guard let symbol = SecuritySymbol.parseHongKongAlias(row.symbol.trimmingCharacters(in: .whitespacesAndNewlines)),
                  let quantity = Double(row.quantity), let cost = Double(row.cost) else { throw AssetsAlphaValidationError.invalid }
            grouped[symbol.canonical, default: []].append(AssetsAlphaCostLot(quantity: quantity, unitCostHkd: cost))
        }
        return try grouped.keys.sorted().map { symbol in
            let lots = grouped[symbol]!
            return try AssetsAlphaPosition(symbol: symbol, quantity: lots.reduce(0) { $0 + $1.quantity },
                                           marketValueHkd: nil, unrealizedPnlHkd: nil, costLots: lots)
        }
    }
    private func client(_ context: AppResearchAuthorizationContext) -> AssetsAlphaClient {
        AssetsAlphaClient(baseURL: context.baseURL, readToken: context.readToken, readHeaderName: context.readHeaderName,
                          writeToken: context.writeToken, writeHeaderName: context.writeHeaderName)
    }
    private func load() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        let context = AppEnvironment.researchAuthorizationContext()
        if pendingRequest != nil && authorization != context {
            message = "连接身份已变化。原请求仍待核清；请切回原身份后重试或回读，当前身份不可复用这次保存。"
            return
        }
        do {
            let envelope = try await client(context).fetch()
            guard context == AppEnvironment.researchAuthorizationContext() else { throw AssetsAlphaClientError.invalidResponse }
            if pendingRequest != nil && envelope.requestedActorId != loaded?.requestedActorId {
                message = "读取到不同的持仓身份。原请求仍待核清，不能用这份数据确认或重试。"
                return
            }
            let current = envelope.snapshots.first { $0.source == .ownerCurrent }
            let sameAuthorization = authorization == context
            if let preview = csvPreview,
               preview.authorization != context || preview.actorId != envelope.requestedActorId
                || preview.expectedSnapshotId != current?.id {
                csvPreview = nil
                csvMessage = "持仓或连接版本已变化；原 CSV 预览已清除，请重新选择文件。"
            }
            let importedDraftIsCurrent = state.importedAsOf != nil && sameAuthorization
                && state.importedActorId == envelope.requestedActorId
                && state.importedBasisSnapshotId == current?.id
            authorization = context; loaded = envelope
            if let pendingRequest, sameAuthorization,
               current?.id == pendingRequest.expectedSnapshotId {
                message = "已重新读取：当前保存版本尚未变化。保留原请求，请原样重试。"
                return
            }
            let hadPendingRequest = pendingRequest != nil
            pendingRequest = nil
            if importedDraftIsCurrent {
                message = "已回读同一持仓版本；CSV 草稿保留。请核对当前实际持仓后明确保存。"
                return
            }
            state.importedAsOf = nil
            state.importedBasisSnapshotId = nil
            state.importedActorId = nil
            rows = (current?.positions ?? []).flatMap { position in
                (position.costLots ?? []).map { Row(symbol: position.symbol, quantity: String(format: "%.0f", $0.quantity), cost: String($0.unitCostHkd)) }
            }
            message = hadPendingRequest
                ? "已回读到不同的当前版本，原请求不再重试；请核对持仓后再修改。"
                : current.map { "已读取持仓确认于 \($0.asOf) 的保存版本；请核对后修改。" }
        } catch {
            csvPreview = nil
            if pendingRequest != nil {
                message = authorization == context && context == AppEnvironment.researchAuthorizationContext()
                    ? "读取失败，上次保存结果仍未知；原请求与草稿已保留，可稍后返回重试。\(error.localizedDescription)"
                    : "读取期间连接身份变化；原请求与草稿仍保留。请切回原身份后核对。"
                return
            }
            let hasImportedDraft = state.importedAsOf != nil && authorization == context
            loaded = nil; authorization = hasImportedDraft ? context : nil
            if !hasImportedDraft {
                rows = []
                state.importedAsOf = nil
                state.importedBasisSnapshotId = nil
                state.importedActorId = nil
            }
            message = hasImportedDraft
                ? "读取失败；已载入的 CSV 草稿保留，但保存不可用。请重新读取同一身份与持仓版本。\(error.localizedDescription)"
                : "读取失败，旧持仓已从编辑区清除。请重试。\(error.localizedDescription)"
        }
    }
    private func save() async {
        guard let loaded, let authorization, authorization == AppEnvironment.researchAuthorizationContext() else {
            message = "连接身份已变化，请重新读取后保存。"; return
        }
        busy = true; defer { busy = false }
        do {
            if pendingRequest == nil {
                let prior = loaded.snapshots.first { $0.source == .ownerCurrent }
                pendingRequest = try CreateAssetsAlphaSnapshotRequest(source: .ownerCurrent,
                    asOf: ISO8601DateFormatter().string(from: Date()), cashHkd: prior?.cashHkd,
                    positions: draftPositions(), idempotencyKey: "owner-current-\(UUID().uuidString)", expectedSnapshotId: prior?.id)
            }
            let result = try await client(authorization).createSnapshot(pendingRequest!, expectedActorId: loaded.requestedActorId)
            guard authorization == AppEnvironment.researchAuthorizationContext() else { throw AssetsAlphaClientError.invalidResponse }
            self.loaded = result.envelope; api.assets = result.envelope; pendingRequest = nil
            csvPreview = nil; csvMessage = nil
            state.importedAsOf = nil; state.importedBasisSnapshotId = nil; state.importedActorId = nil
            message = "已保存并从后端回读核对。"
            await api.load(tab: .assets, symbol: api.currentSymbol)
            if authorization == AppEnvironment.researchAuthorizationContext(), api.assets == nil {
                api.assets = result.envelope
                message = "已保存并从后端回读；资产页刷新暂不可用，已保留本次已核对的持仓。"
            }
        } catch AssetsAlphaClientError.conflict {
            message = "持仓版本已更新。请重新读取后再修改，避免覆盖其他修改。"
        } catch AssetsAlphaClientError.invalidRequest {
            pendingRequest = nil
            message = "请求未发送，请核对输入后再保存。"
        } catch AssetsAlphaClientError.rejected {
            pendingRequest = nil
            message = "服务拒绝了输入；请核对持仓股数和成本后再保存。"
        } catch {
            message = pendingRequest == nil
                ? "尚未发送持仓保存请求。请核对港股代码、正整数股数和大于零的成本。\(error.localizedDescription)"
                : "保存结果未知，已保留原请求。请原样重试或重新读取核对。\(error.localizedDescription)"
        }
    }
}
