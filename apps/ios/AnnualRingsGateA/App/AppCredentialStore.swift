import Foundation
import Security

enum AppCredentialStore {
    private static let service = "com.example.AnnualRingsGateA.auth"
    static let readAccount = "research-read-token"
    static let writeAccount = "research-write-token"

    static func account(write: Bool, baseURL: URL) -> String {
        "\(write ? writeAccount : readAccount)|\(baseURL.absoluteString)"
    }

    static func readToken(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            return nil
        }
        return token
    }

    static func saveToken(_ rawToken: String, account: String) throws {
        let token = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let data = Data(token.utf8)
        var status = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    static func deleteToken(account: String) throws {
        let status = SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    static func deleteTokens(accounts: [String]) throws {
        let accounts = Array(Set(accounts))
        let previous = accounts.map { ($0, readToken(account: $0)) }
        do {
            for account in accounts { try deleteToken(account: account) }
        } catch {
            for (account, token) in previous { try? restoreToken(token, account: account) }
            throw error
        }
    }

    static func restoreToken(_ token: String?, account: String) throws {
        if let token { try saveToken(token, account: account) }
        else { try deleteToken(account: account) }
    }
}
