import Foundation
public let ASSETS_ALPHA_SCHEMA_VERSION = "2026-08-07.assets-alpha.v2"
public enum AssetsAlphaValidationError: Error, Equatable, Sendable {
    case invalid
}
public enum AssetsAlphaSource: String, Codable, Sendable {
    case manual
    case csv
    case ownerCurrent = "owner_current"
    public var displayName: String {
        switch self {
        case .manual: "手工研究快照"
        case .csv: "CSV 研究快照"
        case .ownerCurrent: "本人录入的当前持仓"
        }
    }
}
public struct AssetsAlphaCostLot: Codable, Equatable, Sendable {
    public let quantity: Double
    public let unitCostHkd: Double
    public init(quantity: Double, unitCostHkd: Double) {
        self.quantity = quantity; self.unitCostHkd = unitCostHkd
    }
}
public enum AssetsAlphaTradeSide: String, Codable, Sendable {
    case buy
    case sell
}
public struct AssetsAlphaPosition: Codable, Equatable, Identifiable, Sendable {
    public var id: String { symbol }
    public let symbol: String
    public let quantity: Double
    public let marketValueHkd: Double?
    public let unrealizedPnlHkd: Double?
    public let costLots: [AssetsAlphaCostLot]?
    public init(
        symbol: String,
        quantity: Double,
        marketValueHkd: Double?,
        unrealizedPnlHkd: Double?,
        costLots: [AssetsAlphaCostLot]? = nil
    ) throws {
        self.symbol = symbol
        self.quantity = quantity
        self.marketValueHkd = marketValueHkd
        self.unrealizedPnlHkd = unrealizedPnlHkd
        self.costLots = costLots
        try validate()
    }
    private enum CodingKeys: String, CodingKey {
        case symbol, quantity, marketValueHkd, unrealizedPnlHkd, costLots
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        symbol = try container.decode(String.self, forKey: .symbol)
        quantity = try container.decode(Double.self, forKey: .quantity)
        marketValueHkd = try container.decodeAssetsAlphaNullable(Double.self, forKey: .marketValueHkd)
        unrealizedPnlHkd = try container.decodeAssetsAlphaNullable(Double.self, forKey: .unrealizedPnlHkd)
        costLots = try container.decodeIfPresent([AssetsAlphaCostLot].self, forKey: .costLots)
        try validate()
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(symbol, forKey: .symbol)
        try container.encode(quantity, forKey: .quantity)
        try container.encode(marketValueHkd, forKey: .marketValueHkd)
        try container.encode(unrealizedPnlHkd, forKey: .unrealizedPnlHkd)
        try container.encodeIfPresent(costLots, forKey: .costLots)
    }
    fileprivate func validate() throws {
        guard SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol,
              quantity.isFinite, quantity > 0,
              marketValueHkd.map({ $0.isFinite && $0 >= 0 }) ?? true,
              unrealizedPnlHkd.map(\.isFinite) ?? true else {
            throw AssetsAlphaValidationError.invalid
        }
        if let costLots {
            guard (1...100).contains(costLots.count),
                  costLots.allSatisfy({ $0.quantity.isFinite && $0.quantity > 0 && $0.quantity.rounded() == $0.quantity && $0.quantity <= 9_007_199_254_740_991 && $0.unitCostHkd.isFinite && $0.unitCostHkd > 0 }),
                  costLots.reduce(0, { $0 + $1.quantity }) == quantity,
                  quantity <= 9_007_199_254_740_991,
                  costLots.reduce(0, { $0 + $1.quantity * $1.unitCostHkd }).isFinite else {
                throw AssetsAlphaValidationError.invalid
            }
        }
    }
}
public struct CreateAssetsAlphaSnapshotRequest: Codable, Equatable, Sendable {
    public let source: AssetsAlphaSource
    public let asOf: String
    public let cashHkd: Double?
    public let positions: [AssetsAlphaPosition]
    public let ownerConfirmed: Bool
    public let idempotencyKey: String
    public let expectedSnapshotId: String?
    public init(
        source: AssetsAlphaSource,
        asOf: String,
        cashHkd: Double?,
        positions: [AssetsAlphaPosition],
        idempotencyKey: String,
        expectedSnapshotId: String? = nil
    ) throws {
        self.source = source
        self.asOf = asOf
        self.cashHkd = cashHkd
        self.positions = positions
        ownerConfirmed = true
        self.idempotencyKey = idempotencyKey
        self.expectedSnapshotId = expectedSnapshotId
        try validate()
    }
    private enum CodingKeys: String, CodingKey {
        case source, asOf, cashHkd, positions, ownerConfirmed, idempotencyKey, expectedSnapshotId
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(source, forKey: .source)
        try container.encode(asOf, forKey: .asOf)
        try container.encode(cashHkd, forKey: .cashHkd)
        try container.encode(positions, forKey: .positions)
        try container.encode(ownerConfirmed, forKey: .ownerConfirmed)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
        if source == .ownerCurrent { try container.encode(expectedSnapshotId, forKey: .expectedSnapshotId) }
    }
    fileprivate func validate() throws {
        guard isParseableDateTime(asOf),
              cashHkd.map({ $0.isFinite && $0 >= 0 }) ?? true,
              (0...100).contains(positions.count),
              Set(positions.map(\.symbol)).count == positions.count,
              ownerConfirmed,
              !idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              idempotencyKey.count <= 200 else {
            throw AssetsAlphaValidationError.invalid
        }
        guard source != .ownerCurrent || positions.allSatisfy({ $0.costLots != nil }) else {
            throw AssetsAlphaValidationError.invalid
        }
        try positions.forEach { try $0.validate() }
    }
}
public struct CreateAssetsAlphaTradeRequest: Codable, Equatable, Sendable {
    public let symbol: String
    public let side: AssetsAlphaTradeSide
    public let quantity: Double
    public let priceHkd: Double
    public let occurredAt: String
    public let note: String?
    public let ownerConfirmed: Bool
    public let idempotencyKey: String
    public init(
        symbol: String,
        side: AssetsAlphaTradeSide,
        quantity: Double,
        priceHkd: Double,
        occurredAt: String,
        note: String?,
        idempotencyKey: String
    ) throws {
        self.symbol = symbol
        self.side = side
        self.quantity = quantity
        self.priceHkd = priceHkd
        self.occurredAt = occurredAt
        self.note = note
        ownerConfirmed = true
        self.idempotencyKey = idempotencyKey
        try validate()
    }
    fileprivate func validate() throws {
        guard SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol,
              quantity.isFinite, quantity > 0,
              priceHkd.isFinite, priceHkd > 0,
              isParseableDateTime(occurredAt),
              note.map({ $0.count <= 2_000 }) ?? true,
              ownerConfirmed,
              !idempotencyKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              idempotencyKey.count <= 200 else {
            throw AssetsAlphaValidationError.invalid
        }
    }
}
public struct AssetsAlphaAuthority: Codable, Equatable, Sendable {
    public let kind: String
    public let official: Bool
    public let production: Bool
    public let currency: String
}
public struct AssetsAlphaSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let createsOrder: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool
}
public struct AssetsAlphaSnapshot: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let source: AssetsAlphaSource
    public let asOf: String
    public let cashHkd: Double?
    public let positions: [AssetsAlphaPosition]
    public let ownerConfirmed: Bool
    public let sourceHash: String
    public let createdAt: String
    private enum CodingKeys: String, CodingKey {
        case id, source, asOf, cashHkd, positions, ownerConfirmed, sourceHash, createdAt
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        source = try container.decode(AssetsAlphaSource.self, forKey: .source)
        asOf = try container.decode(String.self, forKey: .asOf)
        cashHkd = try container.decodeAssetsAlphaNullable(Double.self, forKey: .cashHkd)
        positions = try container.decode([AssetsAlphaPosition].self, forKey: .positions)
        ownerConfirmed = try container.decode(Bool.self, forKey: .ownerConfirmed)
        sourceHash = try container.decode(String.self, forKey: .sourceHash)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        try validate()
    }
    fileprivate func validate() throws {
        guard assetsAlphaIsID(id),
              isParseableDateTime(asOf), isParseableDateTime(createdAt),
              cashHkd.map({ $0.isFinite && $0 >= 0 }) ?? true,
              (0...100).contains(positions.count),
              Set(positions.map(\.symbol)).count == positions.count,
              ownerConfirmed,
              assetsAlphaIsSha256(sourceHash) else {
            throw AssetsAlphaValidationError.invalid
        }
        guard source != .ownerCurrent || positions.allSatisfy({ $0.costLots != nil }) else {
            throw AssetsAlphaValidationError.invalid
        }
        try positions.forEach { try $0.validate() }
    }
}
public struct AssetsAlphaTrade: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let symbol: String
    public let side: AssetsAlphaTradeSide
    public let quantity: Double
    public let priceHkd: Double
    public let occurredAt: String
    public let note: String?
    public let ownerConfirmed: Bool
    public let sourceHash: String
    public let createdAt: String
    private enum CodingKeys: String, CodingKey {
        case id, symbol, side, quantity, priceHkd, occurredAt, note, ownerConfirmed, sourceHash, createdAt
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        symbol = try container.decode(String.self, forKey: .symbol)
        side = try container.decode(AssetsAlphaTradeSide.self, forKey: .side)
        quantity = try container.decode(Double.self, forKey: .quantity)
        priceHkd = try container.decode(Double.self, forKey: .priceHkd)
        occurredAt = try container.decode(String.self, forKey: .occurredAt)
        note = try container.decodeAssetsAlphaNullable(String.self, forKey: .note)
        ownerConfirmed = try container.decode(Bool.self, forKey: .ownerConfirmed)
        sourceHash = try container.decode(String.self, forKey: .sourceHash)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        try validate()
    }
    fileprivate func validate() throws {
        guard assetsAlphaIsID(id),
              SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol,
              quantity.isFinite, quantity > 0,
              priceHkd.isFinite, priceHkd > 0,
              isParseableDateTime(occurredAt), isParseableDateTime(createdAt),
              note.map({ $0.count <= 2_000 }) ?? true,
              ownerConfirmed,
              assetsAlphaIsSha256(sourceHash) else {
            throw AssetsAlphaValidationError.invalid
        }
    }
}
public struct AssetsAlphaEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: String
    public let requestedActorId: String
    public let authority: AssetsAlphaAuthority
    public let latestSnapshot: AssetsAlphaSnapshot?
    public let snapshots: [AssetsAlphaSnapshot]
    public let trades: [AssetsAlphaTrade]
    public let safety: AssetsAlphaSafety
    private enum CodingKeys: String, CodingKey {
        case schemaVersion, generatedAt, status, requestedActorId, authority, latestSnapshot, snapshots, trades, safety
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
        status = try container.decode(String.self, forKey: .status)
        requestedActorId = try container.decode(String.self, forKey: .requestedActorId)
        authority = try container.decode(AssetsAlphaAuthority.self, forKey: .authority)
        latestSnapshot = try container.decodeAssetsAlphaNullable(AssetsAlphaSnapshot.self, forKey: .latestSnapshot)
        snapshots = try container.decode([AssetsAlphaSnapshot].self, forKey: .snapshots)
        trades = try container.decode([AssetsAlphaTrade].self, forKey: .trades)
        safety = try container.decode(AssetsAlphaSafety.self, forKey: .safety)
        try validate()
    }
    fileprivate func validate() throws {
        guard schemaVersion == ASSETS_ALPHA_SCHEMA_VERSION,
              isParseableDateTime(generatedAt),
              status == "available",
              !requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              requestedActorId.count <= 200,
              authority == AssetsAlphaAuthority(
                kind: "owner_entered_unofficial_local_alpha",
                official: false,
                production: false,
                currency: "HKD"
              ),
              snapshots.count <= 100,
              Set(snapshots.map(\.id)).count == snapshots.count,
              latestSnapshot?.id == snapshots.first?.id,
              trades.count <= 100,
              Set(trades.map(\.id)).count == trades.count,
              safety == AssetsAlphaSafety(
                advisoryOnly: true,
                createsOrder: false,
                callsBroker: false,
                mutatesOfficialPortfolio: false
              ) else {
            throw AssetsAlphaValidationError.invalid
        }
        try latestSnapshot?.validate()
        try snapshots.forEach { try $0.validate() }
        try trades.forEach { try $0.validate() }
    }
}
public enum AssetsAlphaClientError: LocalizedError, Equatable, Sendable {
    case invalidRequest
    case invalidResponse
    case unauthorized
    case rejected
    case conflict
    case unavailable(Int)
    public var errorDescription: String? {
        switch self {
        case .invalidRequest: "输入无效，未发送请求。"
        case .invalidResponse: "服务返回了无效数据，已失败关闭。"
        case .unauthorized: "缺少账户范围的读取或写入授权。"
        case .rejected: "服务拒绝了这次输入，请检查字段。"
        case .conflict: "幂等键或后端事实发生冲突，请重新提交。"
        case .unavailable: "非官方 Alpha 服务暂时不可用。"
        }
    }
}
public final class AssetsAlphaClient: @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let readToken: String?
    private let readHeaderName: String
    private let writeToken: String?
    private let writeHeaderName: String
    public init(
        baseURL: URL,
        session: URLSession = .shared,
        readToken: String? = nil,
        readHeaderName: String = "x-internal-token",
        writeToken: String? = nil,
        writeHeaderName: String = "x-internal-token"
    ) {
        self.baseURL = baseURL
        self.session = session
        self.readToken = readToken
        self.readHeaderName = readHeaderName
        self.writeToken = writeToken
        self.writeHeaderName = writeHeaderName
    }
    public func fetch(expectedActorId: String? = nil) async throws -> AssetsAlphaEnvelope {
        var request = URLRequest(url: assetsURL, cachePolicy: .reloadIgnoringLocalCacheData)
        apply(token: readToken, header: readHeaderName, to: &request)
        if let expectedActorId { request.setValue(expectedActorId, forHTTPHeaderField: "x-research-expected-actor-id") }
        let envelope: AssetsAlphaEnvelope = try await send(request, validateRaw: validateAssetsAlphaRawShape)
        guard expectedActorId == nil || envelope.requestedActorId == expectedActorId else {
            throw AssetsAlphaClientError.invalidResponse
        }
        return envelope
    }
    public func createSnapshot(_ body: CreateAssetsAlphaSnapshotRequest, expectedActorId: String) async throws -> AssetsAlphaSnapshotWriteResponse {
        do { try body.validate(); try validateExpectedActorId(expectedActorId) } catch { throw AssetsAlphaClientError.invalidRequest }
        let response: AssetsAlphaSnapshotWriteResponse = try await post(
            body,
            path: "snapshots",
            expectedActorId: expectedActorId,
            validateRaw: validateAssetsAlphaSnapshotWriteRawShape
        )
        guard response.matches(body, expectedActorId: expectedActorId) else { throw AssetsAlphaClientError.invalidResponse }
        let envelope = try await fetch(expectedActorId: expectedActorId)
        guard envelope.latestSnapshot == response.createdRecord,
              envelope.snapshots.filter({ $0.id == response.createdRecord.id }) == [response.createdRecord] else {
            throw AssetsAlphaClientError.invalidResponse
        }
        return AssetsAlphaSnapshotWriteResponse(createdRecord: response.createdRecord, envelope: envelope)
    }
    public func createTrade(_ body: CreateAssetsAlphaTradeRequest, expectedActorId: String) async throws -> AssetsAlphaTradeWriteResponse {
        do { try body.validate(); try validateExpectedActorId(expectedActorId) } catch { throw AssetsAlphaClientError.invalidRequest }
        let response: AssetsAlphaTradeWriteResponse = try await post(
            body,
            path: "trades",
            expectedActorId: expectedActorId,
            validateRaw: validateAssetsAlphaTradeWriteRawShape
        )
        guard response.matches(body, expectedActorId: expectedActorId) else { throw AssetsAlphaClientError.invalidResponse }
        let envelope = try await fetch(expectedActorId: expectedActorId)
        guard envelope.trades.filter({ $0.id == response.createdRecord.id }) == [response.createdRecord] else {
            throw AssetsAlphaClientError.invalidResponse
        }
        return AssetsAlphaTradeWriteResponse(createdRecord: response.createdRecord, envelope: envelope)
    }
    private var assetsURL: URL {
        baseURL.appending(path: "api").appending(path: "mobile").appending(path: "assets").appending(path: "alpha")
    }
    private func post<Body: Encodable, Response: Decodable>(
        _ body: Body,
        path: String,
        expectedActorId: String,
        validateRaw: (Data) throws -> Void
    ) async throws -> Response {
        var request = URLRequest(url: assetsURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        apply(token: writeToken, header: writeHeaderName, to: &request)
        request.setValue(expectedActorId, forHTTPHeaderField: "x-research-expected-actor-id")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, validateRaw: validateRaw)
    }
    private func send<Response: Decodable>(
        _ request: URLRequest,
        validateRaw: (Data) throws -> Void
    ) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AssetsAlphaClientError.invalidResponse }
        switch http.statusCode {
        case 200..<300:
            do {
                try validateRaw(data)
                return try JSONDecoder().decode(Response.self, from: data)
            }
            catch { throw AssetsAlphaClientError.invalidResponse }
        case 400: throw AssetsAlphaClientError.rejected
        case 401, 403: throw AssetsAlphaClientError.unauthorized
        case 409: throw AssetsAlphaClientError.conflict
        default: throw AssetsAlphaClientError.unavailable(http.statusCode)
        }
    }
    private func apply(token: String?, header: String, to request: inout URLRequest) {
        guard let token, !token.isEmpty else { return }
        request.setValue(token, forHTTPHeaderField: header)
    }
    private func validateExpectedActorId(_ value: String) throws {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, value.count <= 200 else {
            throw AssetsAlphaValidationError.invalid
        }
    }
}
public func assetsAlphaTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}
private func assetsAlphaIsSha256(_ value: String) -> Bool {
    value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil
}
private func assetsAlphaIsID(_ value: String) -> Bool {
    value.range(of: #"^[1-9][0-9]*$"#, options: .regularExpression) != nil
}
private extension KeyedDecodingContainer {
    func decodeAssetsAlphaNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(codingPath: codingPath, debugDescription: "Required nullable field is missing")
            )
        }
        return try decodeIfPresent(type, forKey: key)
    }
}
