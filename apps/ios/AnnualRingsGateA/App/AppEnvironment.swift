import Foundation

struct AppResearchAuthorizationContext: Equatable {
    let baseURL: URL
    let readToken: String?
    let readHeaderName: String
    let writeToken: String?
    let writeHeaderName: String
}

enum AppConnectionSettingsError: Error, Equatable {
    case invalidBaseURL
    case invalidHeaderName
    case tokensRequiredForNewOrigin
}

enum AppEnvironment {
#if DEBUG
    static func persistDebugConnectionIfRequested() {
        // Only the dedicated experience app is launched with this flag. It reopens on the same
        // isolated API after process death; because its bundle identity differs, the saved origin
        // and tokens stay inside the experience profile. Tokens arrive through the launcher
        // environment, never as command arguments.
        guard ProcessInfo.processInfo.arguments.contains("--persist-debug-connection") else { return }
        let environment = ProcessInfo.processInfo.environment
        guard let rawBaseURL = argumentValue(after: "--base-url") ?? environment["ANNUAL_RINGS_GATE_A_BASE_URL"],
              let readToken = argumentValue(after: "--auth-token") ?? nonEmpty(environment["ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN"]),
              let writeToken = argumentValue(after: "--write-auth-token") ?? nonEmpty(environment["ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN"]) else {
            return
        }
        try? saveConnectionSettings(
            baseURL: rawBaseURL,
            readHeader: argumentValue(after: "--auth-header") ?? environment["ANNUAL_RINGS_AUTH_HEADER"] ?? "x-internal-token",
            writeHeader: argumentValue(after: "--write-auth-header") ?? environment["ANNUAL_RINGS_WRITE_AUTH_HEADER"] ?? "x-internal-write-token",
            readToken: readToken,
            writeToken: writeToken
        )
    }
#endif

    static func baseURL() -> URL {
        if let value = argumentValue(after: "--base-url"),
           let url = validatedBaseURL(value) {
            return url
        }
        let value = ProcessInfo.processInfo.environment["ANNUAL_RINGS_GATE_A_BASE_URL"] ?? ""
        if let url = validatedBaseURL(value) {
            return url
        }
#if DEBUG
        if let value = bundleDebugValue("AnnualRingsPreviewBaseURL"),
           let url = validatedBaseURL(value) {
            return url
        }
#endif
        if let value = AppConnectionStore.readBaseURL(),
           let url = validatedBaseURL(value) {
            return url
        }
        if let value = Bundle.main.object(forInfoDictionaryKey: "AnnualRingsDefaultBaseURL") as? String,
           let url = validatedBaseURL(value) { return url }
        return URL(string: "http://127.0.0.1:4010")!
    }

    static func validatedBaseURL(_ rawValue: String) -> URL? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil else {
            return nil
        }
        let host = components.host?.lowercased()
        if scheme == "http", !allowsPlainHTTP(host) {
            return nil
        }
        components.scheme = scheme
        while components.path.count > 1, components.path.hasSuffix("/") {
            components.path.removeLast()
        }
        if components.path == "/" { components.path = "" }
        return components.url
    }

    private static func allowsPlainHTTP(_ host: String?) -> Bool {
        if ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host) { return true }
#if DEBUG
        let parts = host?.split(separator: ".").compactMap { Int($0) } ?? []
        return parts.count == 4 && parts.allSatisfy { 0...255 ~= $0 }
            && (parts[0] == 10 || parts[0] == 172 && 16...31 ~= parts[1] || parts[0] == 192 && parts[1] == 168)
#else
        return false
#endif
    }

    static func rawSymbolInput() -> String {
        argumentValue(after: "--symbol")
            ?? ProcessInfo.processInfo.environment["ANNUAL_RINGS_GATE_A_SYMBOL"]
            ?? "HK.00175"
    }

    /// Debug-only experience label. The launcher injects it, and a relaunch of the dedicated
    /// experience bundle by tapping its own icon falls back to the known default. The ordinary
    /// install stays nil, the label is never persisted, and it is capped so a long or malformed
    /// launcher value cannot reach the interface unchanged.
    static var experienceLabel: String? {
#if DEBUG
        let raw = ProcessInfo.processInfo.environment["ANNUAL_RINGS_EXPERIENCE_LABEL"] ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return String(trimmed.prefix(40)) }
        return Bundle.main.bundleIdentifier == experienceBundleIdentifier ? defaultExperienceLabel : nil
#else
        return nil
#endif
    }

    static var isExperienceSession: Bool { experienceLabel != nil }

    private static let experienceBundleIdentifier = "com.example.AnnualRingsExperience"
    static let defaultExperienceLabel = "体验版 · 个人样本隔离保存"

    static func initialTab() -> AnnualRingsTab {
        let value = argumentValue(after: "--initial-tab")
            ?? ProcessInfo.processInfo.environment["ANNUAL_RINGS_INITIAL_TAB"]
            ?? ""
        return AnnualRingsTab(rawValue: value) ?? .today
    }

    static func authToken() -> String? {
        return selectedRuntimeToken(
            stored: storedToken(write: false),
            injected: debugReadAuthToken()
        )
    }

    private static func debugReadAuthToken() -> String? {
#if DEBUG
        if isUITesting, let token = nonEmpty(argumentValue(after: "--auth-token")) {
            return token
        }
        return ProcessInfo.processInfo.environment["ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN"]
            ?? bundleDebugValue("AnnualRingsPreviewReadToken")
#else
        return nil
#endif
    }

    static func authHeaderName() -> String {
        let value = argumentValue(after: "--auth-header")
            ?? ProcessInfo.processInfo.environment["ANNUAL_RINGS_AUTH_HEADER"]
            ?? AppConnectionStore.readHeaderName(write: false)
            ?? ""
        return validatedHeaderName(value) ?? "x-internal-token"
    }

    static func writeAuthToken() -> String? {
        return selectedRuntimeToken(
            stored: storedToken(write: true),
            injected: debugWriteAuthToken()
        )
    }

    private static func debugWriteAuthToken() -> String? {
#if DEBUG
        if isUITesting, let token = nonEmpty(argumentValue(after: "--write-auth-token")) {
            return token
        }
        return ProcessInfo.processInfo.environment["ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN"]
            ?? bundleDebugValue("AnnualRingsPreviewWriteToken")
#else
        return nil
#endif
    }

    static func selectedRuntimeToken(stored: String?, injected: String?) -> String? {
#if DEBUG
        return nonEmpty(injected) ?? stored
#else
        return stored
#endif
    }

    static func writeAuthHeaderName() -> String {
        let value = argumentValue(after: "--write-auth-header")
            ?? ProcessInfo.processInfo.environment["ANNUAL_RINGS_WRITE_AUTH_HEADER"]
            ?? AppConnectionStore.readHeaderName(write: true)
            ?? ""
        return validatedHeaderName(value) ?? authHeaderName()
    }

    static func validatedHeaderName(_ rawValue: String) -> String? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty,
              value.range(of: #"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$"#, options: .regularExpression) != nil else {
            return nil
        }
        return value
    }

    static func saveConnectionSettings(
        baseURL rawBaseURL: String,
        readHeader rawReadHeader: String,
        writeHeader rawWriteHeader: String,
        readToken rawReadToken: String,
        writeToken rawWriteToken: String
    ) throws {
        guard let url = validatedBaseURL(rawBaseURL) else {
            throw AppConnectionSettingsError.invalidBaseURL
        }
        guard let readHeader = validatedHeaderName(rawReadHeader),
              let writeHeader = validatedHeaderName(rawWriteHeader) else {
            throw AppConnectionSettingsError.invalidHeaderName
        }
        let readToken = rawReadToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let writeToken = rawWriteToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if url != baseURL(), readToken.isEmpty || writeToken.isEmpty {
            throw AppConnectionSettingsError.tokensRequiredForNewOrigin
        }
        let readAccount = AppCredentialStore.account(write: false, baseURL: url)
        let writeAccount = AppCredentialStore.account(write: true, baseURL: url)
        let previousRead = AppCredentialStore.readToken(account: readAccount)
        let previousWrite = AppCredentialStore.readToken(account: writeAccount)
        do {
            if !readToken.isEmpty { try AppCredentialStore.saveToken(readToken, account: readAccount) }
            if !writeToken.isEmpty { try AppCredentialStore.saveToken(writeToken, account: writeAccount) }
        } catch {
            try? AppCredentialStore.restoreToken(previousRead, account: readAccount)
            try? AppCredentialStore.restoreToken(previousWrite, account: writeAccount)
            throw error
        }
        AppConnectionStore.save(baseURL: url, readHeader: readHeader, writeHeader: writeHeader)
    }

    static func tokenForExplicitSave(entered: String, current: String?, targetURL: URL?, currentURL: URL) -> String {
        entered.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && targetURL == currentURL
            ? current ?? entered
            : entered
    }

    static func clearCurrentConnectionTokens() throws {
        try AppCredentialStore.deleteTokens(accounts: connectionTokenAccounts(baseURL: baseURL()))
    }

    static func connectionTokenAccounts(baseURL: URL) -> [String] {
        [
            AppCredentialStore.account(write: false, baseURL: baseURL),
            AppCredentialStore.account(write: true, baseURL: baseURL),
            AppCredentialStore.readAccount,
            AppCredentialStore.writeAccount
        ]
    }

    static func researchAuthorizationContext() -> AppResearchAuthorizationContext {
        AppResearchAuthorizationContext(
            baseURL: baseURL(),
            readToken: authToken(),
            readHeaderName: authHeaderName(),
            writeToken: writeAuthToken(),
            writeHeaderName: writeAuthHeaderName()
        )
    }

    static var shouldResetDailyResume: Bool {
        ProcessInfo.processInfo.arguments.contains("--reset-daily-resume")
    }

    static var isFixtureFormalDecisionDemo: Bool {
        isUITesting && ProcessInfo.processInfo.arguments.contains("--fixture-formal-decision-demo")
    }

#if DEBUG
    static var uiTestRequestDate: String? {
        guard isUITesting,
              let value = argumentValue(after: "--ui-test-request-date") else {
            return nil
        }
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            preconditionFailure("--ui-test-request-date must use YYYY-MM-DD")
        }
        return value
    }

    static var uiTestViewportWidth: CGFloat? {
        guard isUITesting,
              let rawValue = argumentValue(after: "--ui-test-viewport-width") else {
            return nil
        }
        guard ["320", "390", "430"].contains(rawValue),
              let width = Double(rawValue) else {
            preconditionFailure("--ui-test-viewport-width must be one of 320, 390, or 430")
        }
        return CGFloat(width)
    }
#endif

    private static func argumentValue(after key: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: key) else {
            return nil
        }
        let valueIndex = arguments.index(after: index)
        guard arguments.indices.contains(valueIndex) else {
            return nil
        }
        return arguments[valueIndex]
    }

    private static var isUITesting: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing")
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

#if DEBUG
    private static func bundleDebugValue(_ key: String) -> String? {
        nonEmpty(Bundle.main.object(forInfoDictionaryKey: key) as? String)
    }
#endif

    private static func storedToken(write: Bool) -> String? {
        let url = baseURL()
        if let token = AppCredentialStore.readToken(
            account: AppCredentialStore.account(write: write, baseURL: url)
        ) {
            return token
        }
        return legacyTokenOriginMatches(AppConnectionStore.readLegacyBaseURL(), current: url)
            ? AppCredentialStore.readToken(account: write ? AppCredentialStore.writeAccount : AppCredentialStore.readAccount)
            : nil
    }

    static func legacyTokenOriginMatches(_ rawLegacyURL: String?, current: URL) -> Bool {
        let legacyURL = rawLegacyURL.flatMap(validatedBaseURL)
        return legacyURL == current
            || legacyURL == nil && ["127.0.0.1", "localhost", "::1", "[::1]"].contains(current.host?.lowercased())
    }
}

func currentHongKongRequestDate() -> String {
#if DEBUG
    if let value = AppEnvironment.uiTestRequestDate { return value }
#endif
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Hong_Kong")!
    let components = calendar.dateComponents([.year, .month, .day], from: Date())
    return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
}

enum AnnualRingsTab: String, Hashable {
    case today
    case market
    case research
    case assets
}
