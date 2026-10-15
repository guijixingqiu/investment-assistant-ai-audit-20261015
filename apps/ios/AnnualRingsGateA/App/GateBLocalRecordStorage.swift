import Foundation

enum GateBLocalRecordStorage {
    static func envelopeKey(_ sourceSignature: String) -> String {
        assistMobileWorkspaceLocalRecordStorageKey(sourceSignature)
    }

    static func deletionKey(_ sourceSignature: String) -> String {
        assistMobileWorkspaceLocalRecordDeletionKey(sourceSignature)
    }

    static func clearLegacyFields(_ defaults: UserDefaults, sourceSignature: String) {
        for field in ["researchThought", "decisionThought", "evidenceGapNote", "laterReviewNote", "sourceSignature"] {
            defaults.removeObject(forKey: legacyKey(sourceSignature, field: field))
        }
    }

    private static func legacyKey(_ sourceSignature: String, field: String) -> String {
        "assist.local.record.v1.\(sourceSignature).\(field)"
    }
}
