import SwiftUI
import UniformTypeIdentifiers

struct AssetsManualSnapshotSection: View {
    @Binding var envelope: AssetsAlphaEnvelope?
    let client: AssetsAlphaClient
    let readIsBusy: Bool
    @Binding var writeIsBusy: Bool
    let focusSymbol: String
    let openMarket: (String) -> Void
    let openResearch: (String) -> Void

    @State private var symbol = ""
    @State private var quantity = ""
    @State private var marketValue = ""
    @State private var unrealizedPnl = ""
    @State private var cash = ""
    @State private var asOf = Date()
    @State private var message = "尚未保存本地资产快照。"
    @State private var showCSVImporter = false
    @State private var editingOriginalSymbol: String?
    @State private var snapshotReservation = ResearchDocumentIdempotencyReservation()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("新增或更新快照")
                .font(.headline)
            Text("保存在当前本地试用版的私人记录中；不是券商实时持仓，不会发起交易。")
                .font(.caption)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("assetsManualSnapshotBoundary")

            if let snapshot = envelope?.latestSnapshot {
                VStack(alignment: .leading, spacing: 7) {
                    InfoBlock(title: "记录来源", value: snapshot.source.displayName)
                        .accessibilityIdentifier("assetsManualSnapshotIdentity")
                    InfoBlock(title: "快照截止", value: snapshot.asOf)
                    InfoBlock(title: "数据状态", value: localFreshness(snapshot))
                    InfoBlock(title: "总资产", value: amount(snapshot.completeTotalAssetsHkd))
                    InfoBlock(title: "现金", value: amount(snapshot.cashHkd))
                    InfoBlock(title: "股票市值", value: amount(snapshot.completeMarketValueSummary?.total))
                        .accessibilityIdentifier("assetsAlphaExposure")
                    InfoBlock(title: "股票敞口", value: percent(snapshot.positions.isEmpty ? 0 : snapshot.completeStockExposure))
                    InfoBlock(title: "未实现盈亏", value: amount(snapshot.completeUnrealizedPnlHkd))
                    InfoBlock(title: "集中度", value: snapshot.positions.isEmpty ? "无股票持仓" : concentration(snapshot.completeMarketValueSummary))
                        .accessibilityIdentifier("assetsAlphaConcentration")
                    InfoBlock(title: "\(focusSymbol) 市值", value: amount(snapshot.positions.isEmpty ? 0 : snapshot.positions.first(where: { $0.symbol == focusSymbol })?.marketValueHkd))
                    InfoBlock(title: "\(focusSymbol) 总资产暴露", value: percent(snapshot.positions.isEmpty ? 0 : snapshot.completeAssetExposure(for: focusSymbol)))
                        .accessibilityIdentifier("assetsAlphaExposure-\(focusSymbol)")
                    InfoBlock(title: "研究决定影响", value: localDecisionImpact(snapshot))
                        .accessibilityIdentifier("assetsAlphaDecisionImpact")
                    Text(missingInputAction(snapshot))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(missingInputActionColor(snapshot))
                        .accessibilityIdentifier("assetsManualMaintenanceAction")
                }
                .padding(10)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("assetsManualSnapshotSummary")
                DisclosureGroup("记录详情") {
                    Text("保存 \(snapshot.createdAt) · \(snapshot.positions.count) 只港股 · 记录 \(snapshot.id) · 记录内容 SHA-256 \(snapshot.sourceHash)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
                ForEach(snapshot.positions) { position in
                    HStack(spacing: 8) {
                        Button {
                            openMarket(position.symbol)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(position.symbol)
                                    .font(.callout.weight(.semibold))
                                Text("数量 \(position.quantity, specifier: "%.4f") · 市值 \(amount(position.marketValueHkd)) · 未实现盈亏 \(amount(position.unrealizedPnlHkd))")
                                    .font(.caption.monospacedDigit())
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("assetsManualOpenMarket-\(position.symbol)")

                        Button {
                            openResearch(position.symbol)
                        } label: {
                            Image(systemName: "doc.text.magnifyingglass")
                        }
                        .accessibilityLabel("打开 \(position.symbol) 研究")
                        .accessibilityIdentifier("assetsManualOpenResearch-\(position.symbol)")

                        Button("维护") {
                            beginEditing(position)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("维护 \(position.symbol) 资产记录")
                        .accessibilityIdentifier("assetsManualEdit-\(position.symbol)")

                        Button(role: .destructive) {
                            Task { await removePosition(position) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .disabled(isBusy)
                        .accessibilityLabel("从新快照移除 \(position.symbol)")
                        .accessibilityIdentifier("assetsManualRemove-\(position.symbol)")
                    }
                    .padding(.vertical, 3)
                }

                DisclosureGroup("最近历史快照（最多100条，\(max(0, (envelope?.snapshots.count ?? 0) - 1))）") {
                    let history = Array((envelope?.snapshots ?? []).dropFirst())
                    if history.isEmpty {
                        Text("暂无更早快照。保存新快照后，旧记录会保留在这里。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(history) { item in
                            DisclosureGroup("\(item.asOf) · \(item.positions.count) 只港股") {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("\(item.source.displayName) · 非官方 · \(localFreshness(item))")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.orange)
                                    Text("总资产 \(amount(item.completeTotalAssetsHkd)) · 现金 \(amount(item.cashHkd)) · 记录 \(item.id) · 记录内容 SHA-256 \(item.sourceHash)")
                                        .font(.caption2.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                    ForEach(item.positions) { position in
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("\(position.symbol) · 数量 \(position.quantity, specifier: "%.4f") · 市值 \(amount(position.marketValueHkd))").font(.caption2.monospacedDigit())
                                            DailyResponsiveActionGroup {
                                                Button("查看当前市场") { openMarket(position.symbol) }.accessibilityIdentifier("assetsManualHistoryOpenMarket-\(item.id)-\(position.symbol)")
                                                Button("查看当前研究") { openResearch(position.symbol) }.accessibilityIdentifier("assetsManualHistoryOpenResearch-\(item.id)-\(position.symbol)")
                                            }
                                        }
                                    }
                                    Button("以此为基础保存新快照") { Task { await restoreSnapshot(item) } }
                                    .buttonStyle(.bordered)
                                    .disabled(isBusy)
                                    .accessibilityIdentifier("assetsManualRestoreSnapshot-\(item.id)")
                                }
                                .padding(.top, 4)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
                .accessibilityIdentifier("assetsManualSnapshotHistory")
            } else if envelope != nil {
                Text("尚未录入资产。请选择“从 CSV 导入”，或在下方手工填写后保存。")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("assetsManualSnapshotEmptyAction")
            } else {
                Text("本地资产记录服务尚未可用；请先点上方“重新读取”。")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("assetsManualSnapshotUnavailableAction")
            }

            if envelope != nil {
                Button(envelope?.latestSnapshot?.positions.isEmpty == true ? "更新零持仓快照（保留历史）" : "保存新的零持仓快照（保留历史）", role: .destructive) {
                    Task { await saveZeroPositionSnapshot() }
                }
                .buttonStyle(.bordered)
                .disabled(isBusy)
                .accessibilityIdentifier("assetsManualSaveZeroPositions")
            }

            Button("从 CSV 导入") {
                showCSVImporter = true
            }
            .buttonStyle(.bordered)
            .disabled(isBusy || envelope == nil)
            .accessibilityIdentifier("assetsManualImportCSV")
            DisclosureGroup("CSV 格式说明") {
                Text("表头：\(ManualAssetSnapshotCSV.header)。CSV 不含现金或未实现盈亏，可在导入后补充。")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }

            Divider()
            TextField("现金 HKD（选填）", text: $cash)
                .keyboardType(.decimalPad)
                .accessibilityIdentifier("assetsAlphaCash")
            TextField("港股代码，例如 HK.00175", text: $symbol)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .disabled(editingOriginalSymbol != nil)
                .accessibilityIdentifier("assetsManualSymbol")
            if let editingOriginalSymbol {
                HStack {
                    Text("正在维护 \(editingOriginalSymbol)，股票代码保持不变。") .font(.caption) .foregroundStyle(.secondary)
                    Spacer()
                    Button("取消维护") { clearEditor() } .buttonStyle(.bordered)
                }
            }
            TextField("数量（必填）", text: $quantity)
                .keyboardType(.decimalPad)
                .accessibilityIdentifier("assetsManualQuantity")
            TextField("市值 HKD（选填）", text: $marketValue)
                .keyboardType(.decimalPad)
                .accessibilityIdentifier("assetsManualMarketValue")
            TextField("未实现盈亏 HKD（可空，可为负数）", text: $unrealizedPnl)
                .keyboardType(.numbersAndPunctuation)
                .accessibilityIdentifier("assetsAlphaUnrealizedPnl")
            DatePicker("快照截止时间", selection: $asOf, in: ...Date())
            Button("保存本地资产快照") {
                Task { await savePosition() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isBusy || envelope == nil)
            .accessibilityIdentifier("assetsManualSave")

            if writeIsBusy { ProgressView("正在保存并确认...") }
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("assetsManualSnapshotMessage")
        }
        .onChange(of: envelope?.latestSnapshot?.id, initial: true) { _, _ in
            guard let snapshot = envelope?.latestSnapshot else { return }
            cash = snapshot.cashHkd.map { String($0) } ?? ""
            asOf = assetsAlphaDate(snapshot.asOf) ?? asOf
        }
        .fileImporter(
            isPresented: $showCSVImporter,
            allowedContentTypes: [.commaSeparatedText],
            allowsMultipleSelection: false,
            onCompletion: importCSV
        )
    }

    private var isBusy: Bool { readIsBusy || writeIsBusy }

    private func importCSV(_ result: Result<[URL], Error>) {
        do {
            let urls = try result.get()
            guard urls.count == 1, let url = urls.first else {
                throw ManualAssetSnapshotCSVError.invalid("exactly one CSV file is required")
            }
            let hasAccess = url.startAccessingSecurityScopedResource()
            defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
            let imported = try ManualAssetSnapshotCSV.parse(contentsOf: url)
            let positions = try imported.positions.map {
                try AssetsAlphaPosition(
                    symbol: $0.symbol,
                    quantity: $0.quantity,
                    marketValueHkd: $0.marketValue,
                    unrealizedPnlHkd: nil
                )
            }
            let request = try reservedSnapshotRequest(
                source: .csv,
                asOf: imported.asOf,
                cashHkd: nil,
                positions: positions
            )
            Task { _ = await save(request, success: "CSV 已保存；现金与未实现盈亏暂未填写。") }
        } catch {
            message = "CSV 未保存；请检查固定表头、港股代码、数值和统一 RFC3339 as_of。后端旧快照保持不变。"
        }
    }

    @MainActor
    private func savePosition() async {
        guard let canonical = SecuritySymbol.parseHongKongAlias(symbol)?.canonical,
              let parsedQuantity = positive(quantity) else {
            message = "请输入规范港股代码和大于 0 的有效数量。"
            return
        }
        guard let parsedValue = nonnegativeOrNil(marketValue),
              let parsedPnl = finiteOrNil(unrealizedPnl) else {
            message = "现金和市值必须为空或非负数；未实现盈亏必须为空或有效数字。"
            return
        }
        do {
            let position = try AssetsAlphaPosition(
                symbol: canonical,
                quantity: parsedQuantity,
                marketValueHkd: parsedValue,
                unrealizedPnlHkd: parsedPnl
            )
            let retained = (envelope?.latestSnapshot?.positions ?? []).filter { $0.symbol != (editingOriginalSymbol ?? canonical) && $0.symbol != canonical }
            if await savePositions(
                retained + [position],
                success: "\(canonical) 已保存为本地资产记录，不改变平安权威持仓。"
            ) {
                clearEditor()
            }
        } catch {
            message = "输入未通过校验，后端旧快照保持不变。"
        }
    }

    @MainActor
    private func removePosition(_ position: AssetsAlphaPosition) async {
        let retained = (envelope?.latestSnapshot?.positions ?? []).filter { $0.symbol != position.symbol }
        _ = await savePositions(
            retained,
            success: "\(position.symbol) 已从新快照移除；历史快照未删除。"
        )
    }

    @MainActor
    private func saveZeroPositionSnapshot() async {
        _ = await savePositions(
            [],
            success: "已明确保存零股票持仓；这是非官方手工快照，不等于券商对账。"
        )
    }

    @MainActor
    private func restoreSnapshot(_ snapshot: AssetsAlphaSnapshot) async {
        do {
            let request = try reservedSnapshotRequest(
                source: .manual,
                asOf: snapshot.asOf,
                cashHkd: snapshot.cashHkd,
                positions: snapshot.positions
            )
            _ = await save(
                request,
                success: "已从历史记录 #\(snapshot.id) 追加新快照；截止时间仍为原历史时点，旧记录未修改。"
            )
        } catch {
            message = "历史记录无法形成新快照；现有记录未修改。"
        }
    }

    @MainActor
    private func savePositions(_ positions: [AssetsAlphaPosition], success: String) async -> Bool {
        guard let parsedCash = nonnegativeOrNil(cash) else {
            message = "现金必须为空或非负数。"
            return false
        }
        do {
            let request = try reservedSnapshotRequest(
                source: .manual,
                asOf: assetsAlphaTimestamp(asOf),
                cashHkd: parsedCash,
                positions: positions
            )
            return await save(request, success: success)
        } catch {
            message = "输入未通过校验，后端旧快照保持不变。"
            return false
        }
    }

    @MainActor
    private func save(_ request: CreateAssetsAlphaSnapshotRequest, success: String) async -> Bool {
        guard !isBusy, let expectedActorId = envelope?.requestedActorId else { return false }
        writeIsBusy = true
        defer { writeIsBusy = false }
        do {
            let response = try await client.createSnapshot(request, expectedActorId: expectedActorId)
            guard envelope?.requestedActorId == expectedActorId else { message = "读取身份已变化；写入结果未安装，保留同一请求身份供重试。"; return false }
            envelope = response.envelope
            snapshotReservation.clear()
            message = "\(success) 后端记录 \(response.createdRecord.id) · SHA-256 \(response.createdRecord.sourceHash)"
            return true
        } catch {
            message = "保存失败，继续显示后端原快照：\(error.localizedDescription)"
            return false
        }
    }

    private func reservedSnapshotRequest(source: AssetsAlphaSource, asOf: String, cashHkd: Double?, positions: [AssetsAlphaPosition]) throws -> CreateAssetsAlphaSnapshotRequest {
        let fingerprint = "\(source.rawValue)|\(asOf)|\(String(describing: cashHkd))|\(String(describing: positions))"
        return try CreateAssetsAlphaSnapshotRequest(source: source, asOf: asOf, cashHkd: cashHkd, positions: positions, idempotencyKey: snapshotReservation.reserve(for: fingerprint, prefix: "ios-assets-snapshot"))
    }

    private func amount(_ value: Double?) -> String {
        value.map { String(format: "HKD %.2f", $0) } ?? "未填写"
    }
    private func percent(_ value: Double?) -> String {
        value?.formatted(.percent.precision(.fractionLength(2))) ?? "未填写"
    }
    private func number(_ value: Double?) -> String {
        value?.formatted(.number.precision(.fractionLength(0 ... 4))) ?? "待补齐"
    }
    private func concentration(_ summary: ManualAssetKnownMarketValueSummary?) -> String {
        guard let summary else { return "补齐市值后计算" }
        return "最大 \(percent(summary.largestWeight)) · 前三 \(percent(summary.topThreeWeight)) · 集中度指数 \(number(summary.hhi))"
    }
    private func missingInputAction(_ snapshot: AssetsAlphaSnapshot) -> String {
        var actions: [String] = []
        if snapshot.completeMarketValueSummary == nil { actions.append("用持仓旁“维护”补齐市值") }
        if snapshot.cashHkd == nil { actions.append("在表单补填现金") }
        if snapshot.completeUnrealizedPnlHkd == nil { actions.append("用持仓旁“维护”补齐未实现盈亏") }
        return actions.isEmpty ? "输入完整，可用于本地资产概览。" : "维护动作：\(actions.joined(separator: "；"))。"
    }
    private func missingInputActionColor(_ snapshot: AssetsAlphaSnapshot) -> Color {
        snapshot.completeMarketValueSummary != nil
            && snapshot.cashHkd != nil
            && snapshot.completeUnrealizedPnlHkd != nil ? .green : .orange
    }
    private func localFreshness(_ snapshot: AssetsAlphaSnapshot) -> String {
        guard let isStale = snapshot.isStale() else { return "时间无法核对" }
        return isStale
            ? "陈旧 · 超过 24 小时，仅供回看"
            : "手工新近 · 24 小时内，仍非实时"
    }
    private func localDecisionImpact(_ snapshot: AssetsAlphaSnapshot) -> String {
        guard snapshot.isStale() == false else {
            return "暂不能判断：快照时间无法确认或已过时；单股研究仍可继续。"
        }
        if snapshot.positions.isEmpty {
            return "你已明确记录零股票持仓；这是非官方手工快照，不替代券商对账或生成交易动作。"
        }
        guard snapshot.positions.contains(where: { $0.symbol == focusSymbol }) else {
            return "暂不能判断：未录入 \(focusSymbol)；非完整对账，不推断为零持仓。"
        }
        guard let exposure = snapshot.completeAssetExposure(for: focusSymbol) else {
            return "暂不能判断：需补齐现金、全部市值和 \(focusSymbol) 市值。"
        }
        return "本地非官方总资产暴露 \(percent(exposure))；仅连接研究判断，不生成方向、金额或目标仓位。"
    }
    private func beginEditing(_ position: AssetsAlphaPosition) {
        editingOriginalSymbol = position.symbol
        symbol = position.symbol
        quantity = String(position.quantity)
        marketValue = position.marketValueHkd.map { String($0) } ?? ""
        unrealizedPnl = position.unrealizedPnlHkd.map { String($0) } ?? ""
    }

    private func clearEditor() { editingOriginalSymbol = nil; symbol = ""; quantity = ""; marketValue = ""; unrealizedPnl = "" }

    private func positive(_ value: String) -> Double? {
        guard let parsed = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)),
              parsed.isFinite, parsed > 0 else { return nil }
        return parsed
    }
    private func nonnegativeOrNil(_ value: String) -> Double?? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .some(nil) }
        guard let parsed = Double(trimmed), parsed.isFinite, parsed >= 0 else { return nil }
        return .some(parsed)
    }
    private func finiteOrNil(_ value: String) -> Double?? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .some(nil) }
        guard let parsed = Double(trimmed), parsed.isFinite else { return nil }
        return .some(parsed)
    }
    private func assetsAlphaDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
