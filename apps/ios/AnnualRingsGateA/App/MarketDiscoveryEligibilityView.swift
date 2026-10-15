import SwiftUI

struct MarketDiscoveryEligibilityView: View {
    let eligibility: MarketDiscoveryEligibility
    var body: some View {
        Group {
            if eligibility.status == "eligible", let universe = eligibility.universe {
                Label("当前标的属于港股通 · \(universe.effectiveDate)", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
            } else if eligibility.status == "not_eligible", let universe = eligibility.universe {
                VStack(alignment: .leading, spacing: 3) {
                    Label("当前标的不属于 \(universe.effectiveDate) 港股通范围", systemImage: "info.circle")
                        .foregroundStyle(.orange)
                    Text("仍可通过明确操作手工加入 Research；不会进入港股通候选发现、排序或推荐，已有研究与历史不受名单变化影响。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("当前标的港股通资格 UNKNOWN；仍可手工研究，但不会进入港股通候选发现。")
                    .foregroundStyle(.orange)
            }
        }
        .font(.caption.weight(.semibold))
        .accessibilityIdentifier("marketCurrentSymbolHkConnectEligibility")
    }
}
