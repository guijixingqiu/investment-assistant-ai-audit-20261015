import SwiftUI

struct ExistingWorkflowDestination<Content: View>: View {
    let title: String
    let content: Content
    @Binding var tools: GlobalToolSheet?
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(action: close) { Label("返回", systemImage: "chevron.left") }
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.blue)
                    .accessibilityIdentifier("ownerBackToOverview")
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Theme.bgPrimary)
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bgPrimary.ignoresSafeArea())
        .globalToolsToolbar($tools)
    }
}
