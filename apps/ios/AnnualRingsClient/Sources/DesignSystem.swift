import SwiftUI

// MARK: - Theme Mode Management
public enum AppThemeMode: String, CaseIterable {
    case system = "跟随系统"
    case dark = "深色"
    case light = "浅色"
}

@MainActor
public final class ThemeManager: ObservableObject {
    public static let shared = ThemeManager()
    
    @Published public var currentMode: AppThemeMode {
        didSet {
            UserDefaults.standard.set(currentMode.rawValue, forKey: "app_theme_mode")
        }
    }
    
    public var preferredColorScheme: ColorScheme? {
        switch currentMode {
        case .system:
            return nil // 追随系统外观自动切换
        case .dark:
            return .dark
        case .light:
            return .light
        }
    }
    
    public var isDark: Bool {
        currentMode == .dark
    }
    
    private init() {
        if CommandLine.arguments.contains("--theme-light") || CommandLine.arguments.contains("--light") {
            self.currentMode = .light
        } else if CommandLine.arguments.contains("--theme-dark") || CommandLine.arguments.contains("--dark") {
            self.currentMode = .dark
        } else if CommandLine.arguments.contains("--theme-system") || CommandLine.arguments.contains("--system") {
            self.currentMode = .system
        } else if let saved = UserDefaults.standard.string(forKey: "app_theme_mode"),
                  let mode = AppThemeMode(rawValue: saved) {
            self.currentMode = mode
        } else {
            // 默认严格追随系统外观自动切换
            self.currentMode = .system
        }
    }
    
    public func toggle() {
        cycleMode()
    }
    
    public func cycleMode() {
        switch currentMode {
        case .system:
            currentMode = .dark
        case .dark:
            currentMode = .light
        case .light:
            currentMode = .system
        }
    }
}

// MARK: - Color Palette & Tokens
@MainActor
public enum Theme {
    public static var isDark: Bool {
        ThemeManager.shared.isDark
    }
    
    nonisolated private static func dynamicColor(dark: UIColor, light: UIColor) -> Color {
        Color(uiColor: UIColor { trait in trait.userInterfaceStyle == .dark ? dark : light })
    }

    public static var bgPrimary: Color {
        dynamicColor(
            dark: UIColor(red: 10/255, green: 13/255, blue: 20/255, alpha: 1.0),
            light: UIColor(red: 250/255, green: 251/255, blue: 248/255, alpha: 1.0)
        )
    }
    
    public static var bgCard: Color {
        dynamicColor(
            dark: UIColor(red: 19/255, green: 24/255, blue: 36/255, alpha: 1.0),
            light: UIColor.white
        )
    }
    
    public static var bgCardElevated: Color {
        dynamicColor(
            dark: UIColor(red: 27/255, green: 34/255, blue: 50/255, alpha: 1.0),
            light: UIColor(red: 237/255, green: 242/255, blue: 234/255, alpha: 1.0)
        )
    }
    
    public static var bgSecondary: Color {
        dynamicColor(
            dark: UIColor(red: 24/255, green: 31/255, blue: 47/255, alpha: 1.0),
            light: UIColor(red: 237/255, green: 242/255, blue: 234/255, alpha: 1.0)
        )
    }
    
    public static var border: Color {
        dynamicColor(
            dark: UIColor(red: 36/255, green: 46/255, blue: 69/255, alpha: 1.0),
            light: UIColor(red: 221/255, green: 228/255, blue: 220/255, alpha: 1.0)
        )
    }
    
    // Semantic Accents
    public static var gold: Color {
        dynamicColor(
            dark: UIColor(red: 229/255, green: 184/255, blue: 105/255, alpha: 1.0),
            light: UIColor(red: 66/255, green: 107/255, blue: 89/255, alpha: 1.0)
        )
    }
    
    public static var blue: Color {
        dynamicColor(
            dark: UIColor(red: 77/255, green: 138/255, blue: 240/255, alpha: 1.0),
            light: UIColor(red: 66/255, green: 107/255, blue: 89/255, alpha: 1.0)
        )
    }
    
    public static var green: Color {
        dynamicColor(
            dark: UIColor(red: 52/255, green: 199/255, blue: 123/255, alpha: 1.0),
            light: UIColor(red: 22/255, green: 163/255, blue: 74/255, alpha: 1.0)
        )
    }
    
    public static var red: Color {
        dynamicColor(
            dark: UIColor(red: 240/255, green: 93/255, blue: 94/255, alpha: 1.0),
            light: UIColor(red: 220/255, green: 38/255, blue: 38/255, alpha: 1.0)
        )
    }
    
    public static var amber: Color {
        dynamicColor(
            dark: UIColor(red: 245/255, green: 166/255, blue: 35/255, alpha: 1.0),
            light: UIColor(red: 217/255, green: 119/255, blue: 6/255, alpha: 1.0)
        )
    }
    
    public static var purple: Color {
        dynamicColor(
            dark: UIColor(red: 168/255, green: 123/255, blue: 244/255, alpha: 1.0),
            light: UIColor(red: 124/255, green: 58/255, blue: 237/255, alpha: 1.0)
        )
    }
    
    // Typography Colors
    public static var textPrimary: Color {
        dynamicColor(
            dark: UIColor.white,
            light: UIColor(red: 34/255, green: 53/255, blue: 46/255, alpha: 1.0)
        )
    }
    
    public static var textSecondary: Color {
        dynamicColor(
            dark: UIColor(red: 155/255, green: 163/255, blue: 181/255, alpha: 1.0),
            light: UIColor(red: 104/255, green: 119/255, blue: 111/255, alpha: 1.0)
        )
    }
    
    public static var textTertiary: Color {
        dynamicColor(
            dark: UIColor(red: 92/255, green: 101/255, blue: 122/255, alpha: 1.0),
            light: UIColor(red: 104/255, green: 119/255, blue: 111/255, alpha: 1.0)
        )
    }
}

// MARK: - Theme Toggle Button
public struct ThemeToggleButton: View {
    @ObservedObject var themeManager = ThemeManager.shared
    
    public init() {}
    
    public var body: some View {
        Button(action: {
            withAnimation(.easeInOut(duration: 0.25)) {
                themeManager.cycleMode()
            }
        }) {
            HStack(spacing: 5) {
                Image(systemName: iconName)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(iconColor)
                Text(modeLabel)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(Theme.bgCardElevated)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
        }
        .accessibilityLabel("主题模式切换：\(modeLabel)")
    }
    
    private var iconName: String {
        switch themeManager.currentMode {
        case .system:
            return "circle.lefthalf.filled"
        case .dark:
            return "moon.fill"
        case .light:
            return "sun.max.fill"
        }
    }
    
    private var iconColor: Color {
        switch themeManager.currentMode {
        case .system:
            return Theme.blue
        case .dark:
            return Theme.gold
        case .light:
            return Theme.amber
        }
    }
    
    private var modeLabel: String {
        switch themeManager.currentMode {
        case .system:
            return "跟随系统"
        case .dark:
            return "深色"
        case .light:
            return "浅色"
        }
    }
}

// MARK: - View Modifiers
public struct CardModifier: ViewModifier {
    var elevated: Bool = false
    public func body(content: Content) -> some View {
        content
            .background(elevated ? Theme.bgCardElevated : Theme.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.border.opacity(0.8), lineWidth: 1)
            )
    }
}

public extension View {
    func templateCardStyle(elevated: Bool = false) -> some View {
        self.modifier(CardModifier(elevated: elevated))
    }
}

// MARK: - Data Status Badge Enum
public enum DataProvenance {
    case real(source: String, freshness: FreshnessType, timestamp: String)
    case fixture(description: String)
    case unavailable(reason: String)
    
    public enum FreshnessType {
        case fresh
        case stale
        case incomplete
    }
}

public struct StatusBadgeView: View {
    let provenance: DataProvenance
    
    public init(_ provenance: DataProvenance) {
        self.provenance = provenance
    }
    
    public var body: some View {
        switch provenance {
        case .real(let source, let freshness, let time):
            switch freshness {
            case .fresh:
                HStack(spacing: 4) {
                    Circle().fill(Theme.green).frame(width: 6, height: 6)
                    Text("来源 · \(source)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Theme.green)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Theme.green.opacity(0.12))
                .clipShape(Capsule())
                
            case .stale:
                HStack(spacing: 4) {
                    Circle().fill(Theme.amber).frame(width: 6, height: 6)
                    Text("数据陈旧 · \(time.prefix(10))")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Theme.amber)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Theme.amber.opacity(0.15))
                .clipShape(Capsule())
                
            case .incomplete:
                HStack(spacing: 4) {
                    Circle().fill(Theme.amber).frame(width: 6, height: 6)
                    Text("部分缺失 · \(source)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Theme.amber)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Theme.amber.opacity(0.12))
                .clipShape(Capsule())
            }
            
        case .fixture(let desc):
            HStack(spacing: 4) {
                Image(systemName: "flask.fill")
                    .font(.system(size: 9))
                Text("预览数据 · \(desc)")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(Theme.purple)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Theme.purple.opacity(0.15))
            .clipShape(Capsule())
            
        case .unavailable(let reason):
            HStack(spacing: 4) {
                Circle().fill(Theme.textTertiary).frame(width: 6, height: 6)
                Text("暂不可用 · \(reason)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Theme.textSecondary)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Theme.bgSecondary)
            .clipShape(Capsule())
        }
    }
}
