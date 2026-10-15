import SwiftUI

struct AssetsLocalTradeJournalSection: View {
    @Binding var envelope: AssetsAlphaEnvelope?
    let client: AssetsAlphaClient
    let readIsBusy: Bool
    @Binding var writeIsBusy: Bool
    let openMarket: (String) -> Void
    let openResearch: (String) -> Void

    @State private var symbol = ""
    @State private var side: AssetsAlphaTradeSide = .buy
    @State private var quantity = ""
    @State private var price = ""
    @State private var note = ""
    @State private var occurredAt = Date()
    @State private var message = "等待后端非官方 Alpha 回读。"
    @State private var tradeReservation = ResearchDocumentIdempotencyReservation()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("已发生交易 · 最近100条手工备注")
                .font(.headline)
            Text("只保存你已经发生并明确输入的记录；不下单、不连接券商、不回写任何持仓、现金或费用，也不是正式交易或会计账本。")
                .font(.caption)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("assetsLocalTradeBoundary")

            if let envelope, !envelope.trades.isEmpty {
                ForEach(envelope.trades) { record in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Button("\(record.side == .buy ? "买入" : "卖出") · \(record.symbol)") {
                                openMarket(record.symbol)
                            }
                            .font(.callout.weight(.semibold))
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("assetsLocalTradeOpenMarket-\(record.id)")
                            Spacer()
                            Button {
                                openResearch(record.symbol)
                            } label: {
                                Image(systemName: "doc.text.magnifyingglass")
                            }
                            .accessibilityLabel("打开 \(record.symbol) 研究")
                            .accessibilityIdentifier("assetsLocalTradeOpenResearch-\(record.id)")
                        }
                        Text("数量 \(record.quantity, specifier: "%.4f") · 成交价 HKD \(record.priceHkd, specifier: "%.4f") · 金额 HKD \(record.quantity * record.priceHkd, specifier: "%.2f")")
                            .font(.caption.monospacedDigit())
                        Text("发生 \(record.occurredAt) · 后端记录 \(record.id)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                        if let note = record.note { Text(note).font(.caption) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("assetsLocalTrade-\(record.id)")
                }
            } else if envelope != nil {
                Text("后端暂无非官方交易记录；不会从券商、旧 UserDefaults、样本或持仓快照自动生成。")
                    .foregroundStyle(.secondary)
            }

            TextField("港股代码，例如 HK.00175", text: $symbol)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .accessibilityIdentifier("assetsLocalTradeSymbol")
            Picker("方向", selection: $side) {
                Text("买入").tag(AssetsAlphaTradeSide.buy)
                Text("卖出").tag(AssetsAlphaTradeSide.sell)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("assetsLocalTradeSide")
            TextField("成交数量", text: $quantity)
                .keyboardType(.decimalPad)
                .accessibilityIdentifier("assetsLocalTradeQuantity")
            TextField("成交价 HKD", text: $price)
                .keyboardType(.decimalPad)
                .accessibilityIdentifier("assetsLocalTradePrice")
            DatePicker("成交时间", selection: $occurredAt, in: ...Date())
                .accessibilityIdentifier("assetsLocalTradeOccurredAt")
            TextField("备注（可空）", text: $note, axis: .vertical)
                .accessibilityIdentifier("assetsAlphaTradeNote")
            Button("确认并记录已发生交易") {
                Task { await save() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(readIsBusy || writeIsBusy || envelope == nil)
            .accessibilityIdentifier("assetsLocalTradeSave")

            if writeIsBusy { ProgressView("正在保存并回读...") }
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("assetsLocalTradeMessage")
        }
    }

    @MainActor
    private func save() async {
        guard !readIsBusy, !writeIsBusy, let expectedActorId = envelope?.requestedActorId else { return }
        guard let canonical = SecuritySymbol.parseHongKongAlias(symbol)?.canonical,
              let parsedQuantity = positive(quantity),
              let parsedPrice = positive(price) else {
            message = "请输入规范港股代码、大于 0 的成交数量和成交价。"
            return
        }
        let normalizedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let fingerprint = "\(canonical)|\(side.rawValue)|\(parsedQuantity)|\(parsedPrice)|\(assetsAlphaTimestamp(occurredAt))|\(normalizedNote)"
            let request = try CreateAssetsAlphaTradeRequest(
                symbol: canonical,
                side: side,
                quantity: parsedQuantity,
                priceHkd: parsedPrice,
                occurredAt: assetsAlphaTimestamp(occurredAt),
                note: normalizedNote.isEmpty ? nil : normalizedNote,
                idempotencyKey: tradeReservation.reserve(for: fingerprint, prefix: "ios-assets-trade")
            )
            writeIsBusy = true
            defer { writeIsBusy = false }
            let response = try await client.createTrade(request, expectedActorId: expectedActorId)
            guard envelope?.requestedActorId == expectedActorId else {
                message = "读取身份已变化；交易记录结果未安装，保留同一请求身份供重试。"
                return
            }
            envelope = response.envelope
            tradeReservation.clear()
            symbol = ""
            quantity = ""
            price = ""
            note = ""
            message = "\(canonical) 已由后端确认记录 \(response.createdRecord.id) · SHA-256 \(response.createdRecord.sourceHash)；持仓、现金、费用和订单均未改变。"
        } catch {
            message = "记录失败，后端旧交易和持仓保持不变：\(error.localizedDescription)"
        }
    }

    private func positive(_ value: String) -> Double? {
        guard let parsed = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)),
              parsed.isFinite, parsed > 0 else { return nil }
        return parsed
    }
}
