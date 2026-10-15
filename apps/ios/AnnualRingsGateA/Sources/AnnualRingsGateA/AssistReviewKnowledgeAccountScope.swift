import Foundation

public protocol AssistReviewKnowledgeLocalStorage {
    func readString(forKey key: String) throws -> String?
    func writeString(_ value: String, forKey key: String) throws
    func removeValue(forKey key: String) throws
}

public struct AssistReviewKnowledgeUserDefaultsStorage: AssistReviewKnowledgeLocalStorage {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func readString(forKey key: String) throws -> String? {
        guard let value = defaults.object(forKey: key) else { return nil }
        guard let raw = value as? String else {
            throw AssistReviewKnowledgeMutationError.storageUnavailable("UserDefaults value is not a string")
        }
        return raw
    }

    public func writeString(_ value: String, forKey key: String) throws {
        defaults.set(value, forKey: key)
        guard defaults.string(forKey: key) == value else {
            throw AssistReviewKnowledgeMutationError.storageUnavailable("UserDefaults write could not be verified")
        }
    }

    public func removeValue(forKey key: String) throws {
        defaults.removeObject(forKey: key)
        guard defaults.object(forKey: key) == nil else {
            throw AssistReviewKnowledgeMutationError.storageUnavailable("UserDefaults clear could not be verified")
        }
    }
}

public func assistReviewKnowledgeStorageKey(membershipId: String, symbol: String) throws -> String {
    let canonical = symbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard canonical.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil else {
        throw AssistReviewKnowledgeMutationError.invalid(["knowledge requires a canonical HK five-digit symbol"])
    }
    let owner = membershipId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty else {
        throw AssistReviewKnowledgeMutationError.invalid(["knowledge requires a current membershipId"])
    }
    return "assist-local-review-knowledge-v2:\(Data(owner.utf8).base64EncodedString()):\(canonical)"
}

func assistReviewKnowledgeIdentityErrors(
    _ identity: AssistReviewKnowledgeCurrentIdentity,
    expectedSymbol: String
) -> [String] {
    [
        expectedSymbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil ? nil : "current identity requires a canonical HK symbol",
        identity.symbol == expectedSymbol ? nil : "current identity symbol must match the selected symbol",
        identity.membershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "current identity membershipId is required" : nil,
        identity.membershipVersion > 0 ? nil : "current identity membershipVersion must be positive",
        identity.sourceSignature.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "current identity sourceSignature is required" : nil,
        identity.decisionContextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "current identity decisionContextId is required" : nil,
        identity.decisionContextHash.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "current identity decisionContextHash is required" : nil
    ].compactMap { $0 }
}
