import Foundation

public struct FactMetadata: Equatable, Sendable {
    public let source: String
    public let asOf: String?
    public let fetchedAt: String?
    public let freshness: String
    public let provenance: String
    public let authority: String
    public let stale: Bool
    public let missing: Bool
    public let conflict: Bool
    public let fixture: Bool
    public let correctionOf: String?
    public let replaces: String?
    public let message: String

    public init(
        source: String,
        asOf: String?,
        fetchedAt: String?,
        freshness: String,
        provenance: String,
        authority: String,
        stale: Bool,
        missing: Bool,
        conflict: Bool,
        fixture: Bool,
        correctionOf: String?,
        replaces: String?,
        message: String
    ) {
        self.source = source
        self.asOf = asOf
        self.fetchedAt = fetchedAt
        self.freshness = freshness
        self.provenance = provenance
        self.authority = authority
        self.stale = stale
        self.missing = missing
        self.conflict = conflict
        self.fixture = fixture
        self.correctionOf = correctionOf
        self.replaces = replaces
        self.message = message
    }

    public func validateForDisplay(label: String, errors: inout [String]) {
        if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label) metadata.source is required")
        }
        if let asOf, factMetadataIsRFC3339DateTime(asOf) == false {
            errors.append("\(label) metadata.asOf must be a valid RFC3339 date-time")
        }
        if let fetchedAt, factMetadataIsRFC3339DateTime(fetchedAt) == false {
            errors.append("\(label) metadata.fetchedAt must be a valid RFC3339 date-time")
        }
        if FactMetadataValues.freshness.contains(freshness) == false {
            errors.append("\(label) metadata.freshness is invalid")
        }
        if FactMetadataValues.provenance.contains(provenance) == false {
            errors.append("\(label) metadata.provenance is invalid")
        }
        if FactMetadataValues.authority.contains(authority) == false {
            errors.append("\(label) metadata.authority is invalid")
        }
        if freshness == "fresh" && stale {
            errors.append("\(label) metadata fresh facts must not be stale")
        }
        if freshness == "missing" && missing == false {
            errors.append("\(label) metadata missing freshness requires missing flag")
        }
        if freshness == "conflict" && conflict == false {
            errors.append("\(label) metadata conflict freshness requires conflict flag")
        }
        if provenance == "fixture" && fixture == false {
            errors.append("\(label) metadata fixture provenance requires fixture flag")
        }
        if let correctionOf, correctionOf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label) metadata.correctionOf must be non-empty when present")
        }
        if let replaces, replaces.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label) metadata.replaces must be non-empty when present")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label) metadata.message is required")
        }
    }
}
