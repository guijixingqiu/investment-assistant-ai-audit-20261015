import SwiftUI

public struct PriceGaugeView: View {
    public let currentPrice: Double
    public let safetyMargin: Double
    public let targetBase: Double
    public let targetBull: Double
    
    public init(currentPrice: Double, safetyMargin: Double, targetBase: Double, targetBull: Double) {
        self.currentPrice = currentPrice
        self.safetyMargin = safetyMargin
        self.targetBase = targetBase
        self.targetBull = targetBull
    }
    
    private var minVal: Double { min(safetyMargin * 0.9, currentPrice * 0.9) }
    private var maxVal: Double { max(targetBull * 1.05, currentPrice * 1.05) }
    
    private func positionRatio(for val: Double) -> CGFloat {
        guard maxVal > minVal else { return 0.5 }
        let ratio = (val - minVal) / (maxVal - minVal)
        return CGFloat(max(0.0, min(1.0, ratio)))
    }
    
    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("估值与价格条件锚点")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text("单位: HKD")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.textTertiary)
            }
            
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    // Base track
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Theme.bgSecondary)
                        .frame(height: 10)
                    
                    // Safety margin zone (Green zone)
                    let leftM = positionRatio(for: safetyMargin) * w
                    let rightB = positionRatio(for: targetBase) * w
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Theme.blue.opacity(0.35))
                        .frame(width: max(0, rightB - leftM), height: 10)
                        .offset(x: leftM)
                    
                    // Current price marker
                    let curX = positionRatio(for: currentPrice) * w
                    VStack(spacing: 0) {
                        Image(systemName: "arrowtriangle.down.fill")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.gold)
                        Rectangle()
                            .fill(Theme.gold)
                            .frame(width: 2, height: 14)
                    }
                    .offset(x: curX - 5, y: -4)
                }
            }
            .frame(height: 18)
            
            // Labels below
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("安全边际")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textTertiary)
                    Text(String(format: "%.2f", safetyMargin))
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.green)
                }
                
                Spacer()
                
                VStack(alignment: .center, spacing: 2) {
                    Text("当前价格")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Theme.gold)
                    Text(String(format: "%.2f", currentPrice))
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.gold)
                }
                
                Spacer()
                
                VStack(alignment: .trailing, spacing: 2) {
                    Text("中性目标")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textTertiary)
                    Text(String(format: "%.2f", targetBase))
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.blue)
                }
                
                Spacer()
                
                VStack(alignment: .trailing, spacing: 2) {
                    Text("乐观目标")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textTertiary)
                    Text(String(format: "%.2f", targetBull))
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.textSecondary)
                }
            }
        }
        .padding(14)
        .templateCardStyle()
    }
}
