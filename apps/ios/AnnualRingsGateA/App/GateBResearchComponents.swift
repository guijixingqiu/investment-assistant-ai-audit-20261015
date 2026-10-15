import SwiftUI

enum ReviewKnowledgeLineageMode: String, CaseIterable {
    case newEntry = "new_entry"
    case correction = "correction"
    case replacement = "replacement"
    case correctionAndReplacement = "correction_and_replacement"

    var title: String {
        switch self {
        case .newEntry: "新条目"
        case .correction: "纠正引用"
        case .replacement: "替换引用"
        case .correctionAndReplacement: "纠正并替换"
        }
    }
}

struct SectionTitle: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.headline)
    }
}

struct InfoBlock: View {
    let title: String
    let value: String
    var valueIdentifier: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.callout)
                .accessibilityIdentifier(valueIdentifier ?? "")
        }
    }
}

struct BulletList: View {
    let title: String
    let items: [String]

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(items, id: \.self) { item in
                    Text("• \(item)")
                        .font(.caption)
                }
            }
        }
    }
}

/// 选中股票的方形字标：V2 的浅蓝底 + 蓝色字，深色模式沿用自适应蓝，不生成假身份。
struct StockMonogram: View {
    let text: String
    var size: CGFloat = 44

    var body: some View {
        Text(text)
            .font(.system(size: size * (text.count >= 4 ? 0.30 : 0.42), weight: .bold, design: .rounded))
            .foregroundStyle(OwnerExperienceStyle.accent)
            .frame(width: size, height: size)
            .background(
                OwnerExperienceStyle.accent.opacity(0.14),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// 紧凑小胶囊：用于来源、时点与状态标签，颜色之外仍有文字含义。
struct OwnerStatusPill: View {
    let text: String
    var tint: Color = OwnerExperienceStyle.accent

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule(style: .continuous))
            .fixedSize()
    }
}

struct MakeV9ThemeToggleButton: View {
    @AppStorage("annualRingsMakeV9DarkTheme") private var isDark = true

    var body: some View {
        Button {
            isDark.toggle()
        } label: {
            Image(systemName: isDark ? "sun.max" : "moon")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .frame(width: 36, height: 36)
                .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(OwnerExperienceStyle.border, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isDark ? "切换浅色主题" : "切换深色主题")
    }
}

struct MakeV9SearchButton: View {
    let action: () -> Void
    let label: String

    var body: some View {
        Button(action: action) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
                .frame(width: 36, height: 36)
                .background(OwnerExperienceStyle.softBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(OwnerExperienceStyle.border, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct MakeV9SampleBadge: View {
    var body: some View {
        Text("设计样例")
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundStyle(OwnerExperienceStyle.warning)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(OwnerExperienceStyle.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 3, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .stroke(OwnerExperienceStyle.warning.opacity(0.25), lineWidth: 1)
            }
    }
}

struct MakeV9SourceBadge: View {
    let label: String
    var tint: Color = OwnerExperienceStyle.accent

    var body: some View {
        Text(label)
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 3, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .stroke(tint.opacity(0.25), lineWidth: 1)
            }
    }
}

struct MakeV9SectionLabel: View {
    let title: String
    let action: String?
    let onAction: (() -> Void)?

    init(_ title: String, action: String? = nil, onAction: (() -> Void)? = nil) {
        self.title = title
        self.action = action
        self.onAction = onAction
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .tracking(1.2)
                .foregroundStyle(OwnerExperienceStyle.textTertiary)
            Spacer(minLength: 8)
            if let action {
                Button(action: { onAction?() }) {
                    Text(action)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OwnerExperienceStyle.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }
}

struct MakeV9AnnulusRing: View {
    let filled: Int
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            ForEach(0..<5, id: \.self) { index in
                Circle()
                    .trim(from: CGFloat(index) * 0.2 + 0.018, to: CGFloat(index) * 0.2 + 0.16)
                    .stroke(index < filled ? ringColor(index) : OwnerExperienceStyle.borderStrong, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func ringColor(_ index: Int) -> Color {
        switch index {
        case 0: OwnerExperienceStyle.gold
        case 1: OwnerExperienceStyle.accent
        case 2: OwnerExperienceStyle.success
        case 3: OwnerExperienceStyle.warning
        default: Color.purple
        }
    }
}

enum OwnerExperienceStyle {
    /// Figma Make Version 9 tokens. Values are duplicated from its index.css so
    /// the native preview keeps the same visual language in both themes.
    // TODO: 设计稿待确认：DM Sans / Instrument Serif / JetBrains Mono 未作为
    // 项目资源提供，SwiftUI 使用系统 serif / monospaced 近似字体。
    private static func dynamic(_ dark: UIColor, _ light: UIColor) -> Color {
#if os(iOS)
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
#else
        Color(nsColor: NSColor(name: nil) { _ in dark })
#endif
    }

#if OWNER_CLIENT
    static var pageBackground: Color { dynamic(UIColor(red: 0.12, green: 0.16, blue: 0.22, alpha: 1), UIColor(red: 245/255, green: 247/255, blue: 251/255, alpha: 1)) }
    static var cardBackground: Color { dynamic(UIColor(red: 0.12, green: 0.16, blue: 0.22, alpha: 1), UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)) }
    static var softBackground: Color { dynamic(UIColor(red: 0.12, green: 0.16, blue: 0.22, alpha: 1), UIColor(red: 238/255, green: 242/255, blue: 248/255, alpha: 1)) }
    static var surface3: Color { dynamic(UIColor(red: 0.12, green: 0.16, blue: 0.22, alpha: 1), UIColor(red: 232/255, green: 238/255, blue: 246/255, alpha: 1)) }
    static var accent: Color { dynamic(UIColor(red: 124/255, green: 158/255, blue: 191/255, alpha: 1), UIColor(red: 74/255, green: 108/255, blue: 141/255, alpha: 1)) }
    static var gold: Color { dynamic(UIColor(red: 124/255, green: 158/255, blue: 191/255, alpha: 1), UIColor(red: 74/255, green: 108/255, blue: 141/255, alpha: 1)) }
    static var goldBright: Color { dynamic(UIColor(red: 132/255, green: 163/255, blue: 194/255, alpha: 1), UIColor(red: 82/255, green: 113/255, blue: 144/255, alpha: 1)) }
    static var success: Color { dynamic(UIColor(red: 120/255, green: 169/255, blue: 159/255, alpha: 1), UIColor(red: 70/255, green: 119/255, blue: 109/255, alpha: 1)) }
    static var warning: Color { dynamic(UIColor(red: 205/255, green: 155/255, blue: 121/255, alpha: 1), UIColor(red: 155/255, green: 105/255, blue: 71/255, alpha: 1)) }
    static var danger: Color { dynamic(UIColor(red: 215/255, green: 144/255, blue: 153/255, alpha: 1), UIColor(red: 165/255, green: 94/255, blue: 103/255, alpha: 1)) }
    static var textPrimary: Color { dynamic(.white, UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 1)) }
    static var textSecondary: Color { dynamic(.white, UIColor(red: 71/255, green: 85/255, blue: 105/255, alpha: 1)) }
    static var textTertiary: Color { dynamic(.white, UIColor(red: 105/255, green: 120/255, blue: 139/255, alpha: 1)) }
    static var border: Color { dynamic(UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1), UIColor(red: 218/255, green: 226/255, blue: 236/255, alpha: 1)) }
#else
    static var pageBackground: Color { dynamic(UIColor(red: 8 / 255, green: 16 / 255, blue: 30 / 255, alpha: 1), UIColor(red: 244 / 255, green: 242 / 255, blue: 236 / 255, alpha: 1)) }
    static var cardBackground: Color { dynamic(UIColor(red: 15 / 255, green: 25 / 255, blue: 41 / 255, alpha: 1), .white) }
    static var softBackground: Color { dynamic(UIColor(red: 22 / 255, green: 32 / 255, blue: 53 / 255, alpha: 1), UIColor(red: 238 / 255, green: 240 / 255, blue: 245 / 255, alpha: 1)) }
    static var surface3: Color { dynamic(UIColor(red: 29 / 255, green: 42 / 255, blue: 64 / 255, alpha: 1), UIColor(red: 227 / 255, green: 230 / 255, blue: 239 / 255, alpha: 1)) }
    static var accent: Color { dynamic(UIColor(red: 77 / 255, green: 147 / 255, blue: 217 / 255, alpha: 1), UIColor(red: 26 / 255, green: 106 / 255, blue: 181 / 255, alpha: 1)) }
    static var gold: Color { dynamic(UIColor(red: 200 / 255, green: 168 / 255, blue: 75 / 255, alpha: 1), UIColor(red: 138 / 255, green: 96 / 255, blue: 21 / 255, alpha: 1)) }
    static var goldBright: Color { dynamic(UIColor(red: 226 / 255, green: 196 / 255, blue: 106 / 255, alpha: 1), UIColor(red: 176 / 255, green: 128 / 255, blue: 48 / 255, alpha: 1)) }
    static var success: Color { dynamic(UIColor(red: 45 / 255, green: 184 / 255, blue: 122 / 255, alpha: 1), UIColor(red: 26 / 255, green: 140 / 255, blue: 88 / 255, alpha: 1)) }
    static var warning: Color { dynamic(UIColor(red: 224 / 255, green: 154 / 255, blue: 53 / 255, alpha: 1), UIColor(red: 160 / 255, green: 96 / 255, blue: 16 / 255, alpha: 1)) }
    static var danger: Color { dynamic(UIColor(red: 224 / 255, green: 85 / 255, blue: 85 / 255, alpha: 1), UIColor(red: 192 / 255, green: 48 / 255, blue: 48 / 255, alpha: 1)) }
    static var textPrimary: Color { dynamic(UIColor(red: 228 / 255, green: 234 / 255, blue: 243 / 255, alpha: 1), UIColor(red: 20 / 255, green: 28 / 255, blue: 46 / 255, alpha: 1)) }
    static var textSecondary: Color { dynamic(UIColor(red: 122 / 255, green: 143 / 255, blue: 168 / 255, alpha: 1), UIColor(red: 90 / 255, green: 110 / 255, blue: 133 / 255, alpha: 1)) }
    static var textTertiary: Color { dynamic(UIColor(red: 74 / 255, green: 95 / 255, blue: 120 / 255, alpha: 1), UIColor(red: 138 / 255, green: 154 / 255, blue: 174 / 255, alpha: 1)) }
    static var border: Color { dynamic(UIColor(white: 1, alpha: 0.07), UIColor(white: 0, alpha: 0.07)) }
#endif
    static var borderStrong: Color { dynamic(UIColor(white: 1, alpha: 0.13), UIColor(white: 0, alpha: 0.12)) }
    static var subtleBorder: Color { dynamic(UIColor(white: 1, alpha: 0.05), UIColor(white: 0, alpha: 0.04)) }
    static var actionFillStart: Color { gold }
    static var accentEnd: Color { goldBright }
    static let cardCornerRadius: CGFloat = 14
    static let compactCornerRadius: CGFloat = 10
}

struct OwnerPrimaryActionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.white)
            .frame(minHeight: 44)
            .padding(.horizontal, 16)
            .background(
                OwnerExperienceStyle.gold,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .shadow(
                color: Color.black.opacity(isEnabled && !configuration.isPressed ? 0.10 : 0.04),
                radius: configuration.isPressed ? 1 : 3,
                y: 1
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(isEnabled ? 1 : 0.48)
    }
}

extension View {
    func cardStyle(padding: CGFloat = 16) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                OwnerExperienceStyle.cardBackground,
                in: RoundedRectangle(cornerRadius: OwnerExperienceStyle.cardCornerRadius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: OwnerExperienceStyle.cardCornerRadius, style: .continuous)
                    .stroke(OwnerExperienceStyle.subtleBorder, lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.035), radius: 4, y: 2)
    }

    func ownerSubtleSurface(padding: CGFloat = 10) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                OwnerExperienceStyle.softBackground,
                in: RoundedRectangle(cornerRadius: OwnerExperienceStyle.compactCornerRadius, style: .continuous)
            )
    }

    func ownerPageBackground() -> some View {
        background(OwnerExperienceStyle.pageBackground.ignoresSafeArea())
    }
}

extension ResearchProfileEnvelope {
    static let loading = ResearchProfileEnvelope(
        schemaVersion: "2026-06-17.gate-b.v1",
        asOf: "1970-01-01T00:00:00.000Z",
        requestedSymbol: "HK.00175",
        data: nil,
        message: "正在连接本地候选研究 API..."
    )

    static func unavailable(_ message: String) -> ResearchProfileEnvelope {
        ResearchProfileEnvelope(
            schemaVersion: "2026-06-17.gate-b.v1",
            asOf: "1970-01-01T00:00:00.000Z",
            requestedSymbol: "HK.00175",
            data: nil,
            message: message
        )
    }
}
