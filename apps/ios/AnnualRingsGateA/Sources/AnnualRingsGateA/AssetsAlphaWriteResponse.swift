import Foundation

public struct AssetsAlphaSnapshotWriteResponse: Decodable, Equatable, Sendable {
    public let createdRecord: AssetsAlphaSnapshot
    public let envelope: AssetsAlphaEnvelope

    func matches(_ request: CreateAssetsAlphaSnapshotRequest, expectedActorId: String) -> Bool {
        envelope.requestedActorId == expectedActorId
            && envelope.latestSnapshot == createdRecord
            && envelope.snapshots.filter({ $0.id == createdRecord.id }) == [createdRecord]
            && createdRecord.source == request.source
            && assetsAlphaSameInstant(createdRecord.asOf, request.asOf)
            && createdRecord.cashHkd == request.cashHkd
            && createdRecord.positions == request.positions
            && createdRecord.ownerConfirmed == request.ownerConfirmed
    }
}

public struct AssetsAlphaTradeWriteResponse: Decodable, Equatable, Sendable {
    public let createdRecord: AssetsAlphaTrade
    public let envelope: AssetsAlphaEnvelope

    func matches(_ request: CreateAssetsAlphaTradeRequest, expectedActorId: String) -> Bool {
        envelope.requestedActorId == expectedActorId
            && envelope.trades.filter({ $0.id == createdRecord.id }) == [createdRecord]
            && createdRecord.symbol == request.symbol
            && createdRecord.side == request.side
            && createdRecord.quantity == request.quantity
            && createdRecord.priceHkd == request.priceHkd
            && assetsAlphaSameInstant(createdRecord.occurredAt, request.occurredAt)
            && createdRecord.note == request.note
            && createdRecord.ownerConfirmed == request.ownerConfirmed
    }
}

public extension AssetsAlphaSnapshot {
    func isStale(now: Date = Date()) -> Bool? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: asOf) ?? ISO8601DateFormatter().date(from: asOf) else { return nil }
        return now.timeIntervalSince(date) > 24 * 60 * 60
    }

    var completeMarketValueSummary: ManualAssetKnownMarketValueSummary? {
        let known = positions.compactMap { position in
            position.marketValueHkd.map { (position.symbol, $0) }
        }
        guard known.count == positions.count else { return nil }
        let total = known.reduce(0) { $0 + $1.1 }
        guard total.isFinite else { return nil }
        let weights = total > 0
            ? Dictionary(uniqueKeysWithValues: known.map { ($0.0, $0.1 / total) })
            : [:]
        return ManualAssetKnownMarketValueSummary(
            knownPositionCount: positions.count,
            totalPositionCount: positions.count,
            total: total,
            weightsBySymbol: weights
        )
    }

    var completeUnrealizedPnlHkd: Double? {
        guard positions.allSatisfy({ $0.unrealizedPnlHkd != nil }) else { return nil }
        let total = positions.compactMap(\.unrealizedPnlHkd).reduce(0, +)
        return total.isFinite ? total : nil
    }

    var completeTotalAssetsHkd: Double? {
        guard let stockMarketValue = completeMarketValueSummary?.total,
              let cashHkd else { return nil }
        let total = stockMarketValue + cashHkd
        return total.isFinite ? total : nil
    }

    var completeStockExposure: Double? {
        guard let stockMarketValue = completeMarketValueSummary?.total,
              let totalAssets = completeTotalAssetsHkd,
              totalAssets > 0 else { return nil }
        return stockMarketValue / totalAssets
    }

    func completeAssetExposure(for symbol: String) -> Double? {
        guard let marketValue = positions.first(where: { $0.symbol == symbol })?.marketValueHkd,
              let totalAssets = completeTotalAssetsHkd,
              totalAssets > 0 else { return nil }
        return marketValue / totalAssets
    }
}

func validateAssetsAlphaRawShape(_ data: Data) throws {
    try validateAssetsAlphaEnvelopeRawObject(assetsAlphaJSONObject(data))
}

func validateAssetsAlphaSnapshotWriteRawShape(_ data: Data) throws {
    let root = try assetsAlphaJSONObject(data)
    guard exactAssetsAlphaKeys(root, ["createdRecord", "envelope"]),
          let record = root["createdRecord"] as? [String: Any],
          exactAssetsAlphaKeys(record, assetsAlphaSnapshotKeys),
          let envelope = root["envelope"] as? [String: Any] else {
        throw AssetsAlphaValidationError.invalid
    }
    try validateAssetsAlphaEnvelopeRawObject(envelope)
}

func validateAssetsAlphaTradeWriteRawShape(_ data: Data) throws {
    let root = try assetsAlphaJSONObject(data)
    guard exactAssetsAlphaKeys(root, ["createdRecord", "envelope"]),
          let record = root["createdRecord"] as? [String: Any],
          exactAssetsAlphaKeys(record, assetsAlphaTradeKeys),
          let envelope = root["envelope"] as? [String: Any] else {
        throw AssetsAlphaValidationError.invalid
    }
    try validateAssetsAlphaEnvelopeRawObject(envelope)
}

private let assetsAlphaSnapshotKeys: Set<String> = [
    "id", "source", "asOf", "cashHkd", "positions", "ownerConfirmed", "sourceHash", "createdAt"
]
private let assetsAlphaTradeKeys: Set<String> = [
    "id", "symbol", "side", "quantity", "priceHkd", "occurredAt", "note", "ownerConfirmed", "sourceHash", "createdAt"
]

private func assetsAlphaJSONObject(_ data: Data) throws -> [String: Any] {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw AssetsAlphaValidationError.invalid
    }
    return root
}

private func validateAssetsAlphaEnvelopeRawObject(_ root: [String: Any]) throws {
    guard exactAssetsAlphaKeys(root, ["schemaVersion", "generatedAt", "status", "requestedActorId", "authority", "latestSnapshot", "snapshots", "trades", "safety"]),
          let authority = root["authority"] as? [String: Any],
          exactAssetsAlphaKeys(authority, ["kind", "official", "production", "currency"]),
          let safety = root["safety"] as? [String: Any],
          exactAssetsAlphaKeys(safety, ["advisoryOnly", "createsOrder", "callsBroker", "mutatesOfficialPortfolio"]),
          let snapshots = root["snapshots"] as? [[String: Any]],
          snapshots.count <= 100,
          snapshots.allSatisfy({ snapshot in
              exactAssetsAlphaKeys(snapshot, assetsAlphaSnapshotKeys)
                  && (snapshot["positions"] as? [[String: Any]])?.allSatisfy({
                      validAssetsPositionKeys($0)
                  }) == true
          }),
          let trades = root["trades"] as? [[String: Any]],
          trades.allSatisfy({ exactAssetsAlphaKeys($0, assetsAlphaTradeKeys) }) else {
        throw AssetsAlphaValidationError.invalid
    }
    if !(root["latestSnapshot"] is NSNull) {
        guard let snapshot = root["latestSnapshot"] as? [String: Any],
              exactAssetsAlphaKeys(snapshot, assetsAlphaSnapshotKeys),
              let positions = snapshot["positions"] as? [[String: Any]],
              positions.allSatisfy({ validAssetsPositionKeys($0) }) else {
            throw AssetsAlphaValidationError.invalid
        }
    }
}

private func exactAssetsAlphaKeys(_ value: [String: Any], _ expected: Set<String>) -> Bool {
    Set(value.keys) == expected
}

private func assetsAlphaSameInstant(_ lhs: String, _ rhs: String) -> Bool {
    guard let left = assetsAlphaInstant(lhs), let right = assetsAlphaInstant(rhs) else { return false }
    return left == right
}

private func assetsAlphaInstant(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private func validAssetsPositionKeys(_ value: [String: Any]) -> Bool {
    let base: Set<String> = ["symbol", "quantity", "marketValueHkd", "unrealizedPnlHkd"]
    if value["costLots"] == nil { return exactAssetsAlphaKeys(value, base) }
    guard exactAssetsAlphaKeys(value, base.union(["costLots"])),
          let lots = value["costLots"] as? [[String: Any]] else { return false }
    return lots.allSatisfy { exactAssetsAlphaKeys($0, ["quantity", "unitCostHkd"]) }
}
