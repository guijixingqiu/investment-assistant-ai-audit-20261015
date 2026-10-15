import SwiftUI

#if DEBUG
struct UITestViewportContainer<Content: View>: View {
    let width: CGFloat?
    private let content: Content

    init(width: CGFloat?, @ViewBuilder content: () -> Content) {
        self.width = width
        self.content = content()
    }

    @ViewBuilder
    var body: some View {
        if let width {
            ZStack {
                Color(.systemBackground)
                    .ignoresSafeArea()
                content
                    .frame(width: width)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            content
        }
    }
}
#endif
