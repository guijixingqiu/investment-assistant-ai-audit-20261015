import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public struct MarketQuoteView: View {
    private let envelope: MarketQuoteEnvelope
    private let isRetained: Bool

    public init(envelope: MarketQuoteEnvelope, isRetained: Bool = false) {
        self.envelope = envelope
        self.isRetained = isRetained
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(envelope.data?.symbol ?? (envelope.requestedSymbol == "UNSELECTED" ? "未选择" : envelope.requestedSymbol))
                    .font(.headline)
                Spacer()
                Text(statusLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(statusColor.opacity(0.1), in: Capsule())
                    .accessibilityIdentifier("marketQuoteStatus")
            }

            if let quote = envelope.data {
                if let name = quote.name {
                    Text(name)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                HStack(alignment: .firstTextBaseline) {
                    Text("\(quote.currency) \(quote.price, specifier: "%.2f")")
                        .font(.largeTitle.weight(.bold))
                        .monospacedDigit()
                        .accessibilityIdentifier("marketQuotePrice")
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(signed(quote.change))
                        Text(percent(quote.changePercent))
                    }
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(changeColor(quote.change))
                    .accessibilityIdentifier("marketQuoteChange")
                }

                Text("昨收 \(price(quote.previousClose))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)

                DisclosureGroup("价格来源与时间") {
                    Text("来源 \(envelope.source.provider.userLabel) · 截止 \(quote.quoteTime)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                        .accessibilityIdentifier("marketQuoteSource")
                    Text("读取 \(envelope.source.fetchedAt ?? "未提供") · 数据状态 \(quoteFreshnessLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("marketQuoteFreshness")
                }
            } else {
                Text(envelope.message)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("marketQuoteUnavailableMessage")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            cardBackground,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color(red: 233 / 255, green: 238 / 255, blue: 246 / 255), lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.035), radius: 10, y: 4)
    }

    private var statusLabel: String {
        marketQuotePresentation(envelope, isRetained: isRetained).label
    }

    private var cardBackground: Color {
#if canImport(UIKit)
        Color(uiColor: .secondarySystemGroupedBackground)
#elseif canImport(AppKit)
        Color(nsColor: .controlBackgroundColor)
#else
        .white
#endif
    }

    private var statusColor: Color {
        switch marketQuotePresentation(envelope, isRetained: isRetained).tone {
        case .live:
            return .green
        case .caution:
            return .orange
        case .unavailable:
            return .red
        }
    }

    private var quoteFreshnessLabel: String {
        if envelope.source.provider == .fixture { return "测试样本 · 非真实" }
        if isRetained { return "上次有效 · 非实时" }
        switch envelope.metadata?.freshness {
        case "fresh": return "本次读取"
        case "stale": return "已陈旧 · 非实时"
        case "unknown": return "新鲜度未确认"
        default: return envelope.status == .unavailable ? "不可用" : "待补齐"
        }
    }

    private func signed(_ value: Double?) -> String { value.map { String(format: "%+.2f", $0) } ?? "待补齐" }
    private func percent(_ value: Double?) -> String { value.map { String(format: "%+.2f%%", $0) } ?? "待补齐" }
    private func price(_ value: Double?) -> String { value.map { String(format: "%.2f", $0) } ?? "待补齐" }
    private func changeColor(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        return value > 0 ? .red : value < 0 ? .green : .secondary
    }
}

private extension MarketProvider {
    var userLabel: String {
        switch self {
        case .futu: "Futu 行情（只读）"
        case .fixture: "测试样本"
        case .cache: "本地缓存"
        case .unavailable: "暂不可用"
        }
    }
}

enum MarketQuotePresentationTone: Equatable {
    case live
    case caution
    case unavailable
}

struct MarketQuoteStatusPresentation: Equatable {
    let label: String
    let tone: MarketQuotePresentationTone
}

func marketQuotePresentation(_ envelope: MarketQuoteEnvelope, isRetained: Bool = false) -> MarketQuoteStatusPresentation {
    if envelope.source.provider == .fixture {
        return .init(label: "测试样本 / 非真实行情", tone: .caution)
    }
    if isRetained && envelope.data != nil {
        return .init(label: "上次有效 · 非实时", tone: .caution)
    }
    switch envelope.status {
    case .live:
        return .init(label: "实时", tone: .live)
    case .stale:
        return .init(label: "最后观测 · 非实时", tone: .caution)
    case .unavailable:
        return .init(label: "不可用", tone: .unavailable)
    }
}

#if DEBUG
struct MarketQuoteViewPreview: PreviewProvider {
    static var previews: some View {
        MarketQuoteView(envelope: .previewLive)
            .padding()
    }
}

private extension MarketQuoteEnvelope {
    static let previewLive = MarketQuoteEnvelope(
        schemaVersion: "2026-06-17.gate-a.v1",
        status: .live,
        asOf: "2026-06-17T08:50:00.000Z",
        requestedSymbol: "HK.09926",
        source: MarketQuoteSource(provider: .fixture, providerStatus: .live, fetchedAt: "2026-06-17T08:50:00.000Z"),
        data: MarketQuoteData(
            market: "HK",
            code: "09926",
            symbol: "HK.09926",
            name: "康方生物",
            currency: "HKD",
            price: 74.25,
            previousClose: 72.8,
            change: 1.45,
            changePercent: 1.9918,
            quoteTime: "2026-06-17T08:50:00.000Z"
        ),
        message: "Latest quote for HK.09926 is live."
    )
}
#endif
