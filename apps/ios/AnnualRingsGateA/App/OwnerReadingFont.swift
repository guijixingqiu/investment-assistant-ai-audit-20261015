import SwiftUI

enum OwnerReadingFont {
#if OWNER_CLIENT
    static let largeTitle = Font.system(size: 22, weight: .bold)
    static let title = Font.system(size: 20, weight: .bold)
    static let title2 = Font.system(size: 18, weight: .semibold)
    static let title3 = Font.system(size: 15, weight: .semibold)
    static let headline = Font.system(size: 14, weight: .semibold)
    static let subheadline = Font.system(size: 13)
    static let body = Font.system(size: 13)
    static let callout = Font.system(size: 13)
    static let footnote = Font.system(size: 12)
    static let caption = Font.system(size: 12)
    static let caption2 = Font.system(size: 11)
#else
    static let largeTitle = Font.largeTitle
    static let title = Font.title
    static let title2 = Font.title2
    static let title3 = Font.title3
    static let headline = Font.headline
    static let subheadline = Font.subheadline
    static let body = Font.body
    static let callout = Font.callout
    static let footnote = Font.footnote
    static let caption = Font.caption
    static let caption2 = Font.caption2
#endif
}

struct OwnerReportActions<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
#if OWNER_CLIENT
        DisclosureGroup("审阅、修订与决定") { content() }
#else
        content()
#endif
    }
}

struct OwnerReportSurface: ViewModifier {
    func body(content: Content) -> some View {
#if OWNER_CLIENT
        content.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.bgCard, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(Theme.border.opacity(0.55), lineWidth: 0.5) }
#else
        content.padding(10)
            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
#endif
    }
}
