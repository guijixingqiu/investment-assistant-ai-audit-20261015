import Foundation

public enum DailyWorkbenchWidthClass: String, Equatable, Sendable {
    case compact
    case standard
    case large
}

public struct DailyWorkbenchLayoutMetrics: Equatable, Sendable {
    public let availableWidth: CGFloat
    public let availableHeight: CGFloat
    public let accessibilityText: Bool
    public let widthClass: DailyWorkbenchWidthClass
    public let isHeightConstrained: Bool
    public let horizontalPadding: CGFloat
    public let verticalPadding: CGFloat
    public let sectionSpacing: CGFloat
    public let cardPadding: CGFloat
    public let bottomContentInset: CGFloat
    public let ringSide: CGFloat
    public let ringNodeVisualDiameter: CGFloat
    public let ringNodeHitTarget: CGFloat
    public let ringNodeLabelWidth: CGFloat
    public let ringCenterDiameter: CGFloat
    public let stacksContinuity: Bool
    public let stacksNextStep: Bool
    public let showsRingNodeLabels: Bool
    public let showsLayerMenu: Bool

    public init(
        availableWidth: CGFloat,
        availableHeight: CGFloat = .infinity,
        accessibilityText: Bool
    ) {
        self.availableWidth = availableWidth
        self.availableHeight = availableHeight
        self.accessibilityText = accessibilityText

        let widthClass: DailyWorkbenchWidthClass = if availableWidth < 360 {
            .compact
        } else if availableWidth < 420 {
            .standard
        } else {
            .large
        }
        self.widthClass = widthClass

        horizontalPadding = switch widthClass {
        case .compact: 12
        case .standard: 16
        case .large: 20
        }
        verticalPadding = widthClass == .compact ? 10 : 14
        sectionSpacing = accessibilityText ? 18 : (widthClass == .compact ? 14 : 16)
        cardPadding = widthClass == .compact ? 12 : 14
        bottomContentInset = accessibilityText ? 124 : 104

        let contentWidth = max(0, availableWidth - horizontalPadding * 2)
        let desiredRingSide: CGFloat = if accessibilityText {
            272
        } else {
            switch widthClass {
            case .compact: 284
            case .standard: 320
            case .large: 336
            }
        }
        isHeightConstrained = availableHeight.isFinite
            && availableHeight < desiredRingSide + bottomContentInset
        let heightLimitedRingSide: CGFloat = isHeightConstrained ? 272 : desiredRingSide
        ringSide = min(contentWidth, desiredRingSide, heightLimitedRingSide)
        ringNodeVisualDiameter = accessibilityText ? 40 : 38
        ringNodeHitTarget = 52
        ringNodeLabelWidth = accessibilityText ? 52 : 76
        ringCenterDiameter = accessibilityText ? 92 : 104
        stacksContinuity = accessibilityText || widthClass == .compact
        stacksNextStep = accessibilityText || widthClass == .compact
        showsRingNodeLabels = !accessibilityText
        showsLayerMenu = accessibilityText
    }

    public var usesHorizontalScrolling: Bool { false }
}
