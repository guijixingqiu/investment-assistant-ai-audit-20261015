import Foundation

struct ResearchDocumentIdempotencyReservation {
    var fingerprint: String?
    var key: String?

    mutating func reserve(for newFingerprint: String, prefix: String) -> String {
        if fingerprint == newFingerprint, let key {
            return key
        }
        let reservedKey = "\(prefix)-\(UUID().uuidString.lowercased())"
        fingerprint = newFingerprint
        key = reservedKey
        return reservedKey
    }

    mutating func clear() {
        fingerprint = nil
        key = nil
    }
}

struct IndependentTechnicalConfirmationRequestStore {
    private struct Record: Codable {
        let semantic: String
        let request: CreateIndependentWeinsteinTechnicalConfirmationRequest
    }

    private let key = "research.independent-weinstein-confirmation.pending.v1"

    func load(semantic: String) -> CreateIndependentWeinsteinTechnicalConfirmationRequest? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record.semantic == semantic,
              record.request.kind == independentWeinsteinTechnicalVersion,
              record.request.ownerConfirmed,
              record.request.ownerWeinsteinZones.validates(expected: record.request.expectedWeinstein) else {
            return nil
        }
        return record.request
    }

    func save(semantic: String, request: CreateIndependentWeinsteinTechnicalConfirmationRequest) -> Bool {
        guard let data = try? JSONEncoder().encode(Record(semantic: semantic, request: request)) else { return false }
        UserDefaults.standard.set(data, forKey: key)
        return load(semantic: semantic) == request
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

public struct FrozenResearchEvidenceRequestLanes: Equatable, Sendable {
    public private(set) var loadRevision = UUID()
    public private(set) var saveRevision = UUID()
    public private(set) var presentationRevision = UUID()
    public private(set) var isLoading = false
    public private(set) var isSaving = false

    public init() {}

    public var isBusy: Bool { isLoading || isSaving }

    public mutating func beginLoad() -> UUID {
        let revision = UUID()
        loadRevision = revision
        presentationRevision = revision
        isLoading = true
        return revision
    }

    public mutating func beginSave() -> UUID {
        let revision = UUID()
        saveRevision = revision
        presentationRevision = revision
        isSaving = true
        return revision
    }

    public func acceptsLoad(_ revision: UUID) -> Bool {
        loadRevision == revision && presentationRevision == revision
    }

    public func acceptsSave(_ revision: UUID) -> Bool {
        saveRevision == revision && presentationRevision == revision
    }

    public mutating func finishLoad(_ revision: UUID) {
        if loadRevision == revision { isLoading = false }
    }

    public mutating func finishSave(_ revision: UUID) {
        if saveRevision == revision { isSaving = false }
    }

    public mutating func reset() {
        let revision = UUID()
        loadRevision = revision
        saveRevision = revision
        presentationRevision = revision
        isLoading = false
        isSaving = false
    }
}

struct FrozenResearchTechnicalRequestLane: Equatable, Sendable {
    private(set) var revision = UUID()

    mutating func begin() -> UUID {
        let revision = UUID()
        self.revision = revision
        return revision
    }

    func accepts(_ revision: UUID) -> Bool {
        self.revision == revision
    }

    mutating func reset() {
        revision = UUID()
    }
}

struct OwnerWeinsteinZoneRowDraft: Equatable, Sendable {
    var lower: String
    var upper: String

    init(lower: String = "", upper: String = "") {
        self.lower = lower
        self.upper = upper
    }

    init(_ zone: WeinsteinZone) {
        lower = String(zone.lower)
        upper = String(zone.upper)
    }

    var priceZone: OwnerWeinsteinPriceZone? {
        guard let lower = Double(lower.trimmingCharacters(in: .whitespacesAndNewlines)),
              let upper = Double(upper.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let zone = OwnerWeinsteinPriceZone(lower: lower, upper: upper)
        return zone.isValid ? zone : nil
    }
}

struct OwnerWeinsteinZoneDraft: Equatable, Sendable {
    var enabled = false
    var basedOn: FrozenWeinsteinEvidenceBinding?
    var version = "1"
    var reason = ""
    var supportRows: [OwnerWeinsteinZoneRowDraft] = []
    var resistanceRows: [OwnerWeinsteinZoneRowDraft] = []

    mutating func prefill(from analysis: WeinsteinTechnicalAnalysisEnvelope) {
        guard let binding = FrozenWeinsteinEvidenceBinding(envelope: analysis) else { return }
        enabled = true
        basedOn = binding
        version = "1"
        supportRows = analysis.supportZones.prefix(5).map(OwnerWeinsteinZoneRowDraft.init)
        resistanceRows = analysis.resistanceZones.prefix(5).map(OwnerWeinsteinZoneRowDraft.init)
        reason = ""
    }

    func revision(matching binding: FrozenWeinsteinEvidenceBinding) -> OwnerWeinsteinZoneRevision? {
        guard enabled, basedOn == binding,
              let version = Int(version),
              supportRows.count <= 5, resistanceRows.count <= 5,
              supportRows.count + resistanceRows.count > 0 else { return nil }
        let supports = supportRows.compactMap(\.priceZone)
        let resistances = resistanceRows.compactMap(\.priceZone)
        guard supports.count == supportRows.count,
              resistances.count == resistanceRows.count else { return nil }
        let revision = OwnerWeinsteinZoneRevision(
            version: version,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
            basedOn: binding,
            supportZones: supports,
            resistanceZones: resistances
        )
        return revision.validates(expected: binding) ? revision : nil
    }
}

struct TechnicalSnapshotConfirmationIdentity: Codable, Equatable, Sendable {
    let membershipId: String
    let membershipVersion: Int
    let actorId: String
    let symbol: String
    let weinstein: FrozenWeinsteinEvidenceBinding
    let ownerZones: OwnerWeinsteinZoneRevision

    init?(membership: CandidateMembershipData, analysis: WeinsteinTechnicalAnalysisEnvelope?,
          ownerZonesDraft: OwnerWeinsteinZoneDraft) {
        guard membership.state == .tracked,
              let analysis, analysis.status == "available",
              analysis.symbol == membership.symbol,
              let binding = FrozenWeinsteinEvidenceBinding(envelope: analysis),
              let zones = ownerZonesDraft.revision(matching: binding) else { return nil }
        membershipId = membership.id
        membershipVersion = membership.version
        actorId = membership.actorId
        symbol = membership.symbol
        weinstein = binding
        ownerZones = zones
    }
}

struct FrozenResearchEvidenceBindingIdentity: Equatable, Sendable {
    let membershipId: String
    let membershipVersion: Int
    let membershipState: String
    let symbol: String
    let scenarioId: String?
    let scenarioRevision: Int?
    let selectionVersion: String?
    let valuationMethods: [FrozenResearchValuationMethodBinding]
    let anchorMaterialId: String?
    let anchorSourceFingerprint: String?
    let technicalSnapshotSha: String?
    let technicalResultHash: String?
    let weinstein: FrozenWeinsteinEvidenceBinding?
    let ownerZonesRequested: Bool
    let ownerWeinsteinZones: OwnerWeinsteinZoneRevision?
    let expectedQuantPortfolio: ExpectedFrozenQuantPortfolioIdentity

    var isFreezeReady: Bool {
        (selectionVersion == "provider-pe-fcff-v2" || scenarioId != nil && scenarioRevision != nil)
            && valuationMethods.count == 2
            && (selectionVersion != "provider-pe-fcff-v2"
                || Set(valuationMethods.compactMap(\.basisKind)) == Set(["provider", "fcff"]))
            && anchorMaterialId != nil
            && anchorSourceFingerprint != nil
            && technicalSnapshotSha != nil
            && technicalResultHash != nil
            && weinstein != nil
            && (!ownerZonesRequested || ownerWeinsteinZones != nil)
    }

    init(
        membership: CandidateMembershipData,
        scenario: ResearchValuationScenarioSetData?,
        valuationMethods: [ResearchValuationScenarioSetData] = [],
        providerScenario: ResearchProviderValuationScenarioSetData? = nil,
        fcffScenario: ResearchFcffScenarioSetData? = nil,
        technical: MarketDailyTechnicalEnvelope?,
        weinstein: FrozenWeinsteinEvidenceBinding? = nil,
        ownerZonesDraft: OwnerWeinsteinZoneDraft = .init(),
        expectedQuantPortfolio: ExpectedFrozenQuantPortfolioIdentity = .sourceMissing
    ) {
        membershipId = membership.id
        membershipVersion = membership.version
        membershipState = membership.state.rawValue
        symbol = membership.symbol
        scenarioId = scenario?.id
        scenarioRevision = scenario?.revision
        selectionVersion = providerScenario == nil ? nil : "provider-pe-fcff-v2"
        self.valuationMethods = ((providerScenario.map { [FrozenResearchValuationMethodBinding($0, basisKind: "provider")] }
            ?? valuationMethods.map(FrozenResearchValuationMethodBinding.init))
            + (fcffScenario.map { [FrozenResearchValuationMethodBinding(scenarioId: $0.id,
                scenarioRevision: $0.revision, methodId: $0.calculation.methodId,
                basisKind: providerScenario == nil ? nil : "fcff")] } ?? []))
            .sorted { $0.methodId < $1.methodId }
        anchorMaterialId = providerScenario?.providerBasis.sourceMaterialId ?? scenario?.anchor.source.materialId
        if let providerScenario {
            anchorSourceFingerprint = providerScenario.providerBasis.sourceMaterialFingerprint
        } else if let source = scenario?.anchor.source, source.hasValidCitation, source.isCurrentlyUsable {
            if let citation = source.snapshotCitation, let original = source.snapshotOriginal {
                anchorSourceFingerprint = [source.materialId, source.materialSourceVersion,
                    citation.snapshotId, original.rawSha256, citation.textSha256,
                    String(citation.startUtf16), String(citation.endUtf16), citation.excerptSha256]
                    .joined(separator: "|")
            } else if let documentId = source.documentId,
                      let pdfSha = source.documentPdfSha256,
                      let page = source.pageNumber,
                      let pageHash = source.pageTextSha256 {
                anchorSourceFingerprint = [source.materialId, source.materialSourceVersion,
                    documentId, pdfSha, String(page), pageHash].joined(separator: "|")
            } else { anchorSourceFingerprint = nil }
        } else { anchorSourceFingerprint = nil }
        technicalSnapshotSha = technical?.dailyBars.snapshot?.snapshotSha
        technicalResultHash = technical?.technical.resultHash
        self.weinstein = weinstein
        ownerZonesRequested = ownerZonesDraft.enabled
        ownerWeinsteinZones = weinstein.flatMap { ownerZonesDraft.revision(matching: $0) }
        self.expectedQuantPortfolio = expectedQuantPortfolio
    }
}

struct FrozenResearchEvidenceWorkspaceState {
    var ownerZonesDraft = OwnerWeinsteinZoneDraft()
    var technicalSnapshotConfirmedIdentity: TechnicalSnapshotConfirmationIdentity?
    var technicalSnapshotReservation = ResearchDocumentIdempotencyReservation()
    var technicalSnapshotRequests = FrozenResearchEvidenceRequestLanes()
    var technicalSnapshotHistoryMembershipKey: String?
    var technicalSnapshotMaterials: [ResearchMaterialData] = []
    var technicalSnapshotMessage = "核对当前周线与人工区域后，可单独确认并保存技术快照。"
    var selectedMethodMode = ""
    var selectedProviderScenarioId = ""
    var selectedFcffScenarioId = ""
    var selectedLegacyPeId = ""
    var selectedLegacyNavId = ""
    var envelope: FrozenResearchEvidenceWorkspace?
    var requests = FrozenResearchEvidenceRequestLanes()
    var bindingIdentity: FrozenResearchEvidenceBindingIdentity?
    var confirmedBindingIdentity: FrozenResearchEvidenceBindingIdentity?
    var ownerConfirmed = false
    var reservation = ResearchDocumentIdempotencyReservation()
    var lastFreshPackId: String?
    var limitedSelectionMembershipKey: String?
    var limitedSelectedMaterials: [SelectedLimitedResearchMaterial] = []
    var message = "请选择当前研究成员并重新读取技术证据版本。"

    var isLoading: Bool { requests.isLoading }
    var isSaving: Bool { requests.isSaving }
    var isBusy: Bool { requests.isBusy }

    mutating func invalidateTechnicalSnapshotConfirmation() {
        technicalSnapshotConfirmedIdentity = nil
        technicalSnapshotReservation.clear()
    }

    static func technicalSnapshotMembershipKey(_ membership: CandidateMembershipData) -> String {
        "\(membership.actorId)|\(membership.id)|\(membership.version)|\(membership.symbol)"
    }

    mutating func updateTechnicalSnapshotMaterials(_ materials: [ResearchMaterialData],
                                                    membership: CandidateMembershipData,
                                                    sourceType: String) {
        technicalSnapshotHistoryMembershipKey = Self.technicalSnapshotMembershipKey(membership)
        technicalSnapshotMaterials = materials.filter {
            $0.sourceType == sourceType && $0.symbol == membership.symbol
        }
    }

    static func limitedSelectionKey(_ membership: CandidateMembershipData) -> String {
        "\(membership.actorId)|\(membership.id)|\(membership.version)|\(membership.symbol)"
    }

    mutating func setLimitedMaterial(_ material: ResearchMaterialData,
                                     membership: CandidateMembershipData, selected: Bool) {
        guard !requests.isBusy else { return }
        let key = Self.limitedSelectionKey(membership)
        if limitedSelectionMembershipKey != key {
            limitedSelectionMembershipKey = key
            limitedSelectedMaterials = []
        }
        limitedSelectedMaterials.removeAll { $0.id == material.id }
        if selected { limitedSelectedMaterials.append(SelectedLimitedResearchMaterial(material: material)) }
        limitedSelectedMaterials.sort { (Int($0.id) ?? 0) < (Int($1.id) ?? 0) }
        reservation.clear()
    }

    mutating func clearLimitedMaterials(membership: CandidateMembershipData) {
        guard !requests.isBusy,
              limitedSelectionMembershipKey == Self.limitedSelectionKey(membership) else { return }
        limitedSelectedMaterials = []
        reservation.clear()
    }

    func invalidLimitedMaterialCount(membership: CandidateMembershipData,
                                     available: [ResearchMaterialData]) -> Int {
        guard limitedSelectionMembershipKey == Self.limitedSelectionKey(membership) else { return 0 }
        return limitedSelectedMaterials.filter { !Self.isUsable($0, in: available) }.count
    }

    func selectedLimitedMaterials(membership: CandidateMembershipData,
                                  available: [ResearchMaterialData]) -> [SelectedLimitedResearchMaterial]? {
        guard limitedSelectionMembershipKey == Self.limitedSelectionKey(membership),
              !limitedSelectedMaterials.isEmpty, limitedSelectedMaterials.count <= 100 else { return nil }
        return limitedSelectedMaterials.allSatisfy { Self.isUsable($0, in: available) }
            ? limitedSelectedMaterials : nil
    }

    private static func isUsable(_ expected: SelectedLimitedResearchMaterial,
                                 in available: [ResearchMaterialData]) -> Bool {
        available.contains { expected.matches($0)
            && $0.freshness == "fresh"
            && !["conflict", "rejected"].contains($0.verificationStatus)
            && ["user_provided", "authorized_public"].contains($0.rightsStatus) }
    }

    mutating func synchronizeBinding(
        _ identity: FrozenResearchEvidenceBindingIdentity,
        message: String
    ) {
        guard let bindingIdentity else {
            self.bindingIdentity = identity
            return
        }
        guard bindingIdentity != identity else { return }
        invalidatePresentation(message)
        self.bindingIdentity = identity
    }

    mutating func invalidateForUpstreamSuccess(_ message: String) {
        invalidatePresentation(message)
        bindingIdentity = nil
    }

    mutating func setOwnerConfirmation(
        _ confirmed: Bool,
        for identity: FrozenResearchEvidenceBindingIdentity?
    ) {
        reservation.clear()
        guard confirmed, let identity, identity.isFreezeReady else {
            ownerConfirmed = false
            confirmedBindingIdentity = nil
            return
        }
        ownerConfirmed = true
        confirmedBindingIdentity = identity
    }

    mutating func clear(_ message: String) {
        invalidatePresentation(message)
        bindingIdentity = nil
        ownerZonesDraft = OwnerWeinsteinZoneDraft()
    }

    mutating func clearAfterMembershipSelectionLost(
        selectedMembership: inout CandidateMembershipData?,
        message: String
    ) {
        selectedMembership = nil
        clear(message)
    }

    private mutating func invalidatePresentation(_ message: String) {
        envelope = nil
        requests.reset()
        ownerConfirmed = false
        confirmedBindingIdentity = nil
        reservation.clear()
        lastFreshPackId = nil
        limitedSelectionMembershipKey = nil
        limitedSelectedMaterials = []
        self.message = message
    }
}

extension ResearchClient {
    /// Reads one still-saved historical provider material without validating today's entire workspace.
    public func readHistoricalFutuFinancialMaterial(
        membership: CandidateMembershipData,
        materialId: String,
        revision: Int,
        contentFingerprint: String
    ) async throws -> ResearchMaterialData {
        guard researchDocumentIsPositiveIntegerString(materialId), revision > 0,
              researchDocumentIsSha256(contentFingerprint) else {
            throw ResearchDocumentClientError.invalidResponse
        }
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "materials").appending(path: materialId)
                .appending(path: "saved-opend-material"),
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let material = try JSONDecoder().decode(ResearchMaterialData.self, from: data)
        guard material.id == materialId, material.revision == revision,
              material.contentFingerprint == contentFingerprint,
              material.sourceType == "futu_opend_financial_statement_provider",
              material.market == membership.market, material.code == membership.code,
              material.symbol == membership.symbol,
              material.claimType == "third_party_statement",
              material.verificationStatus == "unverified",
              material.rightsStatus == "user_provided",
              researchDocumentSha256(Data(material.contentText.utf8)) == contentFingerprint,
              let source = material.futuFinancialSource,
              source.membershipId == membership.id, source.symbol == membership.symbol,
              source.membershipVersion > 0, source.membershipVersion <= membership.version,
              !source.pages.isEmpty else {
            throw ResearchDocumentClientError.invalidResponse
        }
        return material
    }

    public func fetchFrozenResearchEvidence(
        membership: CandidateMembershipData
    ) async throws -> FrozenResearchEvidenceWorkspace {
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "deep-research"),
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        try validateFrozenResearchWorkspaceRawShape(data)
        let envelope = try JSONDecoder().decode(FrozenResearchEvidenceWorkspace.self, from: data)
        // These nested immutable validators exceed a Simulator worker task's small stack.
        return try await MainActor.run {
            try envelope.validated(expected: membership)
        }
    }

    public func freezeLimitedResearchAndReadBack(
        membership: CandidateMembershipData,
        selectedMaterials: [SelectedLimitedResearchMaterial],
        idempotencyKey: String
    ) async throws -> (workspace: FrozenResearchEvidenceWorkspace, pack: FrozenResearchEvidencePack) {
        var request = URLRequest(url: frozenResearchEvidenceURL(membershipId: membership.id).appending(path: "evidence-packs"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(FreezeLimitedResearchRequest(membershipVersion: membership.version, selectedMaterials: selectedMaterials, idempotencyKey: idempotencyKey))
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        try validateFrozenResearchWriteRawShape(data)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<FrozenResearchEvidencePack>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1", write.status == "succeeded",
              write.source.actorType == "user", write.source.actorId == membership.actorId,
              write.data.membershipVersion == membership.version, write.data.researchMode == "limited",
              write.data.materialSelectionMode == "explicit",
              selectedMaterials.count == write.data.items.count,
              selectedMaterials.allSatisfy({ expected in write.data.items.contains { expected.matches($0) } }) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let pack = try write.data.validated(expected: membership)
        let workspace = try await fetchFrozenResearchEvidence(membership: membership)
        guard let fresh = workspace.data?.latestPack, fresh.id == pack.id,
              fresh == pack, fresh.currentness.status == "current",
              fresh.materialSelectionMode == "explicit" else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (workspace, fresh)
    }

    public func freezeResearchEvidenceAndReadBack(
        membership: CandidateMembershipData,
        requestBody: FreezeResearchEvidencePackRequest
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        pack: FrozenResearchEvidencePack
    ) {
        guard requestBody.ownerWeinsteinZones?.validates(expected: requestBody.expectedWeinstein) ?? true else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        var request = URLRequest(
            url: frozenResearchEvidenceURL(membershipId: membership.id)
                .appending(path: "evidence-packs")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        try validateFrozenResearchWriteRawShape(data)
        let write = try JSONDecoder().decode(
            ResearchWriteEnvelope<FrozenResearchEvidencePack>.self,
            from: data
        )
        let writtenContext = write.data.frozenResearchContext
        let writtenMethods: [FrozenResearchValuationMethodBinding] = requestBody.selectionVersion == "provider-pe-fcff-v2"
            ? writtenContext?.selectedValuationMethods?.map(\.binding) ?? []
            : ((writtenContext?.valuationMethods?.map(FrozenResearchValuationMethodBinding.init) ?? [])
                + (writtenContext?.fcffScenario.map { [FrozenResearchValuationMethodBinding($0)] } ?? []))
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.membershipVersion == requestBody.membershipVersion,
              write.data.symbol == membership.symbol,
              writtenContext?.bindingVersion == (requestBody.selectionVersion == "provider-pe-fcff-v2"
                ? frozenResearchContextVersionV2 : frozenResearchContextVersion),
              (requestBody.selectionVersion == "provider-pe-fcff-v2"
                || (writtenContext?.valuationScenario?.id == requestBody.expectedScenarioId
                    && writtenContext?.valuationScenario?.revision == requestBody.expectedScenarioRevision)),
              writtenMethods
                .sorted(by: { $0.methodId < $1.methodId })
                == requestBody.expectedValuationMethods.sorted(by: { $0.methodId < $1.methodId }),
              write.data.frozenResearchContext?.technical.dailyBars.snapshot?.snapshotSha
                == requestBody.expectedTechnicalSnapshotSha,
              write.data.frozenResearchContext?.technical.technical.resultHash
                == requestBody.expectedTechnicalResultHash,
              write.data.frozenResearchContext?.weinstein == requestBody.expectedWeinstein,
              write.data.frozenResearchContext?.ownerWeinsteinZones == requestBody.ownerWeinsteinZones,
              (write.data.frozenResearchContext?.quantPortfolio?
                .matches(requestBody.expectedQuantPortfolio) == true
                || (write.data.frozenResearchContext?.quantPortfolio == nil
                    && requestBody.expectedQuantPortfolio == .sourceMissing)) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let validatedWrite = try write.data.validated(expected: membership)
        let fresh = try await fetchFrozenResearchEvidence(membership: membership)
        guard let freshPack = fresh.data?.evidencePacks.first(where: {
            $0.id == validatedWrite.id
        }),
        freshPack.currentness.status == "current",
        freshPack.currentness.invalidatedBy.isEmpty,
        freshPack.hasSameImmutableIdentity(as: validatedWrite),
        freshPack.frozenResearchContext == validatedWrite.frozenResearchContext,
        freshPack.frozenResearchContext?.technical.dailyBars.snapshot?.snapshotSha
            == validatedWrite.frozenResearchContext?.technical.dailyBars.snapshot?.snapshotSha,
        freshPack.frozenResearchContext?.technical.technical.resultHash
            == validatedWrite.frozenResearchContext?.technical.technical.resultHash,
        freshPack.frozenResearchContext?.weinstein
            == validatedWrite.frozenResearchContext?.weinstein,
        freshPack.frozenResearchContext?.ownerWeinsteinZones
            == validatedWrite.frozenResearchContext?.ownerWeinsteinZones else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (fresh, freshPack)
    }

    public func confirmIndependentWeinsteinTechnicalAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateIndependentWeinsteinTechnicalConfirmationRequest
    ) async throws -> (
        workspace: FrozenResearchEvidenceWorkspace,
        material: ResearchMaterialData,
        content: IndependentWeinsteinTechnicalConfirmationContent
    ) {
        guard requestBody.kind == independentWeinsteinTechnicalVersion,
              requestBody.ownerConfirmed,
              requestBody.membershipId == membership.id,
              requestBody.membershipVersion == membership.version,
              requestBody.expectedWeinstein.symbol == membership.symbol,
              requestBody.ownerWeinsteinZones.validates(expected: requestBody.expectedWeinstein) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        var request = URLRequest(url: baseURL
            .appending(path: "api/mobile/research/profiles")
            .appending(path: membership.market)
            .appending(path: membership.code)
            .appending(path: "materials"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateFrozenResearchResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchMaterialData>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              let content = try? JSONDecoder().decode(
                IndependentWeinsteinTechnicalConfirmationContent.self,
                from: Data(write.data.contentText.utf8)
              ),
              content.validates(material: write.data, membership: membership),
              content.confirmedAt == requestBody.confirmedAt,
              content.ownerWeinsteinZones == requestBody.ownerWeinsteinZones,
              FrozenWeinsteinEvidenceBinding(envelope: content.machine) == requestBody.expectedWeinstein else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        let workspace = try await fetchFrozenResearchEvidence(membership: membership)
        guard let fresh = workspace.data?.materials.first(where: { $0.id == write.data.id }),
              fresh.revision == write.data.revision,
              fresh.contentFingerprint == write.data.contentFingerprint,
              fresh.sourceVersion == write.data.sourceVersion,
              fresh.contentText == write.data.contentText,
              content.validates(material: fresh, membership: membership) else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        return (workspace, fresh, content)
    }

    func frozenResearchEvidenceURL(membershipId: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
    }

    func validateFrozenResearchResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw FrozenResearchEvidenceClientError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            throw FrozenResearchEvidenceClientError.httpStatus(http.statusCode)
        }
    }
}

private extension FrozenResearchEvidencePack {
    func hasSameImmutableIdentity(as write: Self) -> Bool {
        membershipId == write.membershipId
            && membershipVersion == write.membershipVersion
            && market == write.market
            && code == write.code
            && symbol == write.symbol
            && version == write.version
            && packFingerprint == write.packFingerprint
            && frozenAt == write.frozenAt
            && researchMode == write.researchMode
            && materialSelectionMode == write.materialSelectionMode
            && frozenResearchContext == write.frozenResearchContext
    }
}

private func validateFrozenResearchWorkspaceRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    var errors: [String] = []
    frozenExactKeys(
        root,
        [
            "schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId",
            "requestedSymbol", "metadata", "data", "message"
        ],
        "frozen research workspace",
        &errors
    )
    frozenExactObject(
        root["metadata"],
        [
            "source", "asOf", "fetchedAt", "freshness", "provenance", "authority",
            "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"
        ],
        "frozen research workspace.metadata",
        &errors
    )
    guard let payload = root["data"] as? [String: Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    frozenExactKeys(
        payload,
        [
            "target", "materials", "events", "latestGeelySalesMonitor",
            "latestGclPvPriceMonitor", "latestPack", "evidencePacks", "latestReport",
            "reports", "userDecision", "decisions", "classification", "completion"
        ],
        "frozen research workspace.data",
        &errors,
        optionalKeys: ["reportDeletions", "operatingReasoning", "operatingAnchorSelection", "providerOperatingReference"]
    )
    if let reasoning = payload["operatingReasoning"], !(reasoning is NSNull),
       !operatingReasoningRawShapeIsValid(reasoning) {
        errors.append("operatingReasoning has invalid fields")
    }
    frozenExactObject(
        payload["target"],
        ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"],
        "frozen research workspace.data.target",
        &errors
    )
    frozenExactObject(
        payload["classification"],
        [
            "verifiedFactMaterialIds", "issuerStatementMaterialIds",
            "thirdPartyStatementMaterialIds", "modelInferenceMaterialIds", "userDecisionId"
        ],
        "frozen research workspace.data.classification",
        &errors
    )
    frozenExactObject(
        payload["completion"],
        ["state", "deepResearchComplete", "reasons"],
        "frozen research workspace.data.completion",
        &errors
    )
    if let latestPack = payload["latestPack"], !(latestPack is NSNull) {
        frozenPackRawShape(latestPack, label: "frozen research workspace.data.latestPack", errors: &errors)
    }
    guard let packs = payload["evidencePacks"] as? [Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    for (index, pack) in packs.enumerated() {
        frozenPackRawShape(
            pack,
            label: "frozen research workspace.data.evidencePacks[\(index)]",
            errors: &errors
        )
    }
    if let latestReport = payload["latestReport"], !(latestReport is NSNull) {
        frozenReportRawShape(
            latestReport,
            label: "frozen research workspace.data.latestReport",
            errors: &errors
        )
    }
    guard let reports = payload["reports"] as? [Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    for (index, report) in reports.enumerated() {
        frozenReportRawShape(
            report,
            label: "frozen research workspace.data.reports[\(index)]",
            errors: &errors
        )
    }
    if let decision = payload["userDecision"], !(decision is NSNull) {
        frozenExactObject(
            decision,
            ["id", "reportId", "decision", "note", "actorType", "actorId", "decidedAt"],
            "frozen research workspace.data.userDecision",
            &errors
        )
    }
    guard let decisions = payload["decisions"] as? [Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    for (index, decision) in decisions.enumerated() {
        frozenExactObject(
            decision,
            ["id", "reportId", "decision", "note", "actorType", "actorId", "decidedAt"],
            "frozen research workspace.data.decisions[\(index)]",
            &errors
        )
    }
    if !errors.isEmpty { throw FrozenResearchEvidenceClientError.invalidResponse }
}

private func frozenReportRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    twoLayerReportRawShape(value, label: label, errors: &errors)
}

private func validateFrozenResearchWriteRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw FrozenResearchEvidenceClientError.invalidResponse
    }
    var errors: [String] = []
    frozenExactKeys(
        root,
        ["schemaVersion", "status", "asOf", "source", "data", "message"],
        "frozen research write",
        &errors
    )
    frozenExactObject(
        root["source"],
        ["actorType", "actorId", "correlationId"],
        "frozen research write.source",
        &errors
    )
    frozenPackRawShape(root["data"], label: "frozen research write.data", errors: &errors)
    if !errors.isEmpty { throw FrozenResearchEvidenceClientError.invalidResponse }
}

private func frozenPackRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let pack = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        pack,
        [
            "id", "membershipId", "membershipVersion", "market", "code", "symbol",
            "version", "packFingerprint", "frozenAt", "items", "frozenResearchContext",
            "currentness"
        ],
        label,
        &errors,
        optionalKeys: ["researchMode", "materialSelectionMode"]
    )
    guard pack["items"] is [Any] else {
        errors.append("\(label).items must be an array")
        return
    }
    frozenExactObject(
        pack["currentness"],
        ["status", "invalidatedBy"],
        "\(label).currentness",
        &errors
    )
    if let context = pack["frozenResearchContext"], !(context is NSNull) {
        frozenContextRawShape(context, label: "\(label).frozenResearchContext", errors: &errors)
    }
}

private func frozenContextRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let context = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    let v2 = context["bindingVersion"] as? String == frozenResearchContextVersionV2
    var keys = ["bindingVersion", "actor", "membership", v2 ? "selectedValuationMethods" : "valuationScenario", "technical", "weinstein", "unboundSources"]
    if context["researchContext"] != nil { keys.append("researchContext") }
    if context["valuationMethods"] != nil { keys.append("valuationMethods") }
    if context["fcffScenario"] != nil { keys.append("fcffScenario") }
    if context["quantPortfolio"] != nil { keys.append("quantPortfolio") }
    if context["operatingMonitor"] != nil { keys.append("operatingMonitor") }
    if context["ownerWeinsteinZones"] != nil { keys.append("ownerWeinsteinZones") }
    frozenExactKeys(
        context,
        Set(keys),
        label,
        &errors
    )
    frozenExactObject(context["actor"], ["actorType", "actorId"], "\(label).actor", &errors)
    frozenExactObject(
        context["membership"],
        ["id", "version", "state", "symbol"],
        "\(label).membership",
        &errors
    )
    if let researchContext = context["researchContext"] {
        frozenExactObject(
            researchContext,
            ["id", "membershipId", "membershipVersion", "selectedSymbol", "cutoffAt", "validUntil", "contentHash"],
            "\(label).researchContext",
            &errors
        )
    }
    if v2 {
        if let selected = context["selectedValuationMethods"] as? [[String: Any]], selected.count == 2 {
            for (index, method) in selected.enumerated() {
                let child = "\(label).selectedValuationMethods[\(index)]"
                frozenExactKeys(method, ["basisKind", "scenario"], child, &errors)
                let expectedBasis = index == 0 ? "provider" : "fcff"
                if method["basisKind"] as? String != expectedBasis { errors.append("\(child).basisKind is invalid") }
                if expectedBasis == "provider" {
                    frozenExactObject(method["scenario"], ["id", "membershipId", "membershipVersionAtWrite", "symbol",
                        "revision", "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
                        "basisKind", "providerBasis", "assumptions", "calculation", "safety", "createdAt"],
                        "\(child).scenario", &errors)
                } else {
                    frozenExactObject(method["scenario"], ["id", "membershipId", "membershipVersionAtWrite", "symbol",
                        "revision", "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
                        "sourceSelection", "sourceFingerprint", "historicalOriginals", "assumptions",
                        "calculation", "safety", "createdAt"], "\(child).scenario", &errors)
                }
            }
        } else { errors.append("\(label).selectedValuationMethods must contain two methods") }
    } else { frozenScenarioRawShape(context["valuationScenario"], label: "\(label).valuationScenario", errors: &errors) }
    if let methods = context["valuationMethods"] as? [Any] {
        for (index, method) in methods.enumerated() {
            frozenScenarioRawShape(method, label: "\(label).valuationMethods[\(index)]", errors: &errors)
        }
    } else if context["valuationMethods"] != nil {
        errors.append("\(label).valuationMethods must be an array")
    }
    if let fcff = context["fcffScenario"] {
        frozenExactObject(fcff, ["id", "membershipId", "membershipVersionAtWrite", "symbol",
            "revision", "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
            "sourceSelection", "sourceFingerprint", "historicalOriginals", "assumptions",
            "calculation", "safety", "createdAt"], "\(label).fcffScenario", &errors)
    }
    frozenTechnicalRawShape(context["technical"], label: "\(label).technical", errors: &errors)
    frozenExactObject(
        context["weinstein"],
        ["bindingVersion", "schemaVersion", "computationVersion", "provider", "dataset", "hashMethod", "datasetHash", "symbol", "analysisAsOf", "completedWeekEnd", "sectorIdentityAsOf", "inputHash", "resultHash"],
        "\(label).weinstein",
        &errors
    )
    if let ownerZones = context["ownerWeinsteinZones"] {
        frozenExactObject(ownerZones,
            ["version", "reason", "basedOn", "supportZones", "resistanceZones"],
            "\(label).ownerWeinsteinZones", &errors)
        if let zones = ownerZones as? [String: Any] {
            frozenExactObject(zones["basedOn"],
                ["bindingVersion", "schemaVersion", "computationVersion", "provider", "dataset", "hashMethod", "datasetHash", "symbol", "analysisAsOf", "completedWeekEnd", "sectorIdentityAsOf", "inputHash", "resultHash"],
                "\(label).ownerWeinsteinZones.basedOn", &errors)
            for key in ["supportZones", "resistanceZones"] {
                if let rows = zones[key] as? [Any] {
                    for (index, row) in rows.enumerated() {
                        frozenExactObject(row, ["lower", "upper"],
                            "\(label).ownerWeinsteinZones.\(key)[\(index)]", &errors)
                    }
                } else {
                    errors.append("\(label).ownerWeinsteinZones.\(key) must be an array")
                }
            }
        }
    }
    if let monitor = context["operatingMonitor"], !(monitor is NSNull) {
        frozenExactObject(monitor, ["kind", "id", "runVersion", "runFingerprint"], "\(label).operatingMonitor", &errors)
    }
    if let quant = context["quantPortfolio"] as? [String: Any] {
        frozenExactKeys(quant, ["decision", "portfolio"], "\(label).quantPortfolio", &errors)
        frozenQuantLaneRawShape(
            quant["decision"],
            available: [
                "status", "refinementId", "snapshotId", "snapshotHash", "dataHash",
                "dataCutoff", "generatedAt", "source", "asOf", "fetchedAt", "validUntil",
                "hkConnectUniverse"
            ],
            label: "\(label).quantPortfolio.decision",
            errors: &errors
        )
        if let decision = quant["decision"] as? [String: Any], decision["status"] as? String == "available" {
            frozenExactObject(
                decision["hkConnectUniverse"],
                ["source", "snapshotId", "effectiveDate", "capturedAt", "memberCount", "sourceUrls"],
                "\(label).quantPortfolio.decision.hkConnectUniverse",
                &errors
            )
        }
        frozenQuantLaneRawShape(
            quant["portfolio"],
            available: [
                "status", "evidenceId", "contentHash", "snapshotId", "snapshotHash", "dataHash",
                "dataCutoff", "observationStartDate", "observationEndDate", "observationCount",
                "stability", "generatedAt", "validUntil", "hkConnectUniverse", "series", "covariance"
            ],
            label: "\(label).quantPortfolio.portfolio",
            errors: &errors
        )
        if let portfolio = quant["portfolio"] as? [String: Any], portfolio["status"] as? String == "available" {
            frozenExactObject(
                portfolio["hkConnectUniverse"],
                ["source", "snapshotId", "effectiveDate", "capturedAt", "memberCount", "sourceUrls"],
                "\(label).quantPortfolio.portfolio.hkConnectUniverse",
                &errors
            )
            for (index, item) in (portfolio["series"] as? [Any] ?? []).enumerated() {
                frozenExactObject(
                    item,
                    ["symbol", "annualizedVolatility", "worstDailyReturn", "historicalTailLossMagnitude"],
                    "\(label).quantPortfolio.portfolio.series[\(index)]",
                    &errors
                )
            }
            for (index, item) in (portfolio["covariance"] as? [Any] ?? []).enumerated() {
                frozenExactObject(
                    item,
                    ["leftSymbol", "rightSymbol", "annualizedCovariance", "correlation"],
                    "\(label).quantPortfolio.portfolio.covariance[\(index)]",
                    &errors
                )
            }
        }
    } else if context["quantPortfolio"] != nil {
        errors.append("\(label).quantPortfolio must be an object")
    }
    guard let sources = context["unboundSources"] as? [String: Any] else {
        errors.append("\(label).unboundSources must be an object")
        return
    }
    frozenExactKeys(
        sources,
        ["macro", "industry", "event", "risk", "counterevidence"],
        "\(label).unboundSources",
        &errors
    )
    for key in ["macro", "industry", "event", "risk", "counterevidence"] {
        let sourceLabel = "\(label).unboundSources.\(key)"
        let bound = (sources[key] as? [String: Any])?["status"] as? String == "bound"
        if bound && key != "event" { errors.append("\(sourceLabel) may only bind the event gap"); continue }
        frozenExactObject(sources[key], bound ? ["status", "value", "eventId", "eventVersion", "eventFingerprint", "materialId", "evidenceId", "keyVariable", "hypothesisImpact"] : ["status", "value"], sourceLabel, &errors)
    }
}

private func frozenQuantLaneRawShape(
    _ value: Any?,
    available: Set<String>,
    label: String,
    errors: inout [String]
) {
    guard let lane = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        lane,
        lane["status"] as? String == "available" ? available : ["status", "reason"],
        label,
        &errors
    )
}

private func frozenScenarioRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let scenario = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        scenario,
        [
            "id", "membershipId", "membershipVersionAtWrite", "symbol", "revision",
            "replacesScenarioSetId", "scenarioState", "recomputable", "invalidatedBy",
            "anchor", "assumptions", "calculation", "safety", "createdAt"
        ],
        label,
        &errors
    )
    frozenExactObject(
        scenario["anchor"],
        [
            "id", "membershipId", "membershipVersionAtWrite", "symbol", "metric",
            "periodKind", "periodStart", "periodEnd", "currency", "unitScale", "scope",
            "valueStatus", "value", "comparability", "comparabilityReason", "amendmentKind",
            "replacesValueId", "revision", "valueState", "provenance", "source", "createdAt",
            "anchorRole"
        ],
        "\(label).anchor",
        &errors
    )
    if let anchor = scenario["anchor"] as? [String: Any] {
        frozenExactObject(
            anchor["provenance"],
            ["factKind", "transcription", "verificationStatus"],
            "\(label).anchor.provenance",
            &errors
        )
        frozenExactObject(
            anchor["source"],
            [
                "materialId", "materialRevision", "materialRevisionState", "validUntil",
                "freshness", "materialSourceVersion", "documentId", "documentPdfSha256",
                "pageNumber", "pageTextSha256"
            ],
            "\(label).anchor.source",
            &errors
        )
    }
    frozenExactObject(
        scenario["assumptions"],
        ["authority", "derivation", "values"],
        "\(label).assumptions",
        &errors
    )
    if let assumptions = scenario["assumptions"] as? [String: Any] {
        frozenExactObject(
            assumptions["values"],
            [
                "baseMetricPerShare", "annualGrowthRate", "horizonYears", "terminalMultiple",
                "annualDiscountRate", "netCashPerShare", "growthRateStep", "multipleStep"
            ],
            "\(label).assumptions.values",
            &errors,
            optionalKeys: ["methodId", "metricCurrency"]
        )
    }
    frozenCalculationRawShape(
        scenario["calculation"],
        label: "\(label).calculation",
        errors: &errors
    )
    frozenExactObject(
        scenario["safety"],
        [
            "advisoryOnly", "forecast", "recommendation", "automaticSignal", "createsOrder",
            "callsBroker", "mutatesOfficialPortfolio"
        ],
        "\(label).safety",
        &errors
    )
}

private func frozenCalculationRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let calculation = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        calculation,
        ["method", "projectedMetricPerShare", "scenarioPresentValuePerShare", "diagonal", "matrix"],
        label,
        &errors,
        optionalKeys: ["valueRange"]
    )
    frozenExactObject(
        calculation["method"],
        ["id", "calculationVersion", "presentValueFormula", "rounding"],
        "\(label).method",
        &errors,
        optionalKeys: ["applicability"]
    )
    if let method = calculation["method"] as? [String: Any],
       let applicability = method["applicability"] {
        frozenExactObject(
            applicability,
            ["ownerConfirmed", "companyDataBasis", "requiredAnchorMetrics", "limitation"],
            "\(label).method.applicability",
            &errors
        )
    }
    if let valueRange = calculation["valueRange"] {
        frozenExactObject(
            valueRange,
            ["low", "high", "interpretation"],
            "\(label).valueRange",
            &errors
        )
    }
    frozenExactArrayObjects(
        calculation["diagonal"],
        ["scenario", "annualGrowthRate", "terminalMultiple", "presentValuePerShare"],
        "\(label).diagonal",
        &errors
    )
    frozenExactObject(
        calculation["matrix"],
        ["growthRates", "terminalMultiples", "cells"],
        "\(label).matrix",
        &errors
    )
    if let matrix = calculation["matrix"] as? [String: Any] {
        frozenExactArrayObjects(
            matrix["cells"],
            ["annualGrowthRate", "terminalMultiple", "presentValuePerShare"],
            "\(label).matrix.cells",
            &errors
        )
    }
}

private func frozenTechnicalRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let technical = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        technical,
        ["completeness", "usableForRequestedCutoff", "dailyBars", "technical"],
        label,
        &errors
    )
    frozenDailyBarsRawShape(technical["dailyBars"], label: "\(label).dailyBars", errors: &errors)
    frozenTechnicalResultRawShape(technical["technical"], label: "\(label).technical", errors: &errors)
}

private func frozenDailyBarsRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let dailyBars = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        dailyBars,
        ["schemaVersion", "status", "request", "source", "metadata", "snapshot", "message"],
        label,
        &errors
    )
    frozenExactObject(
        dailyBars["request"],
        [
            "market", "code", "symbol", "timeframe", "completedSessionsOnly",
            "adjustment", "minimumBars", "targetBars", "cutoff"
        ],
        "\(label).request",
        &errors
    )
    frozenExactObject(
        dailyBars["source"],
        [
            "provider", "endpoint", "fetchedAt", "providerCutoff", "dataCutoffAt",
            "rights", "retention", "derivedUse", "hashMethod", "rawBytesCaptured",
            "pageCount", "pageContentHashes", "sourceContentHash"
        ],
        "\(label).source",
        &errors
    )
    frozenExactObject(
        dailyBars["metadata"],
        [
            "source", "asOf", "fetchedAt", "freshness", "provenance", "authority",
            "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"
        ],
        "\(label).metadata",
        &errors
    )
    guard let snapshot = dailyBars["snapshot"] as? [String: Any] else {
        errors.append("\(label).snapshot must be an object")
        return
    }
    frozenExactKeys(
        snapshot,
        [
            "snapshotSha", "dataHash", "calendar", "lastCompletedSession", "firstSession",
            "lastSession", "barCount", "expectedSessions", "completedSessionEvidence",
            "quality", "bars"
        ],
        "\(label).snapshot",
        &errors
    )
    frozenExactObject(
        snapshot["calendar"],
        ["id", "version", "timezone"],
        "\(label).snapshot.calendar",
        &errors
    )
    if let evidence = snapshot["completedSessionEvidence"], !(evidence is NSNull) {
        frozenExactObject(
            evidence,
            [
                "source", "fixture", "calendar", "cutoff", "lastCompletedSession",
                "marketCloseAt", "evaluatedAt", "completedThroughCutoff", "completedSessions"
            ],
            "\(label).snapshot.completedSessionEvidence",
            &errors
        )
        if let evidenceObject = evidence as? [String: Any] {
            frozenExactObject(
                evidenceObject["calendar"],
                ["id", "version", "timezone"],
                "\(label).snapshot.completedSessionEvidence.calendar",
                &errors
            )
        }
    }
    frozenExactObject(
        snapshot["quality"],
        ["gaps", "zeroVolumeSessions", "suspensionSessions"],
        "\(label).snapshot.quality",
        &errors
    )
    if let quality = snapshot["quality"] as? [String: Any] {
        frozenExactArrayObjects(
            quality["gaps"],
            ["session", "classification"],
            "\(label).snapshot.quality.gaps",
            &errors
        )
    }
    frozenExactArrayObjects(
        snapshot["bars"],
        ["session", "open", "high", "low", "close", "volume", "turnover", "suspension"],
        "\(label).snapshot.bars",
        &errors
    )
}

private func frozenTechnicalResultRawShape(
    _ value: Any?,
    label: String,
    errors: inout [String]
) {
    guard let result = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(
        result,
        [
            "schemaVersion", "status", "computationVersion", "parameters",
            "inputSnapshotSha", "dataCutoffAt", "resultHash", "points", "message"
        ],
        label,
        &errors
    )
    frozenExactObject(
        result["parameters"],
        ["ma", "macd", "bollinger", "rsi"],
        "\(label).parameters",
        &errors
    )
    if let parameters = result["parameters"] as? [String: Any] {
        frozenExactObject(parameters["macd"], ["fast", "slow", "signal"], "\(label).parameters.macd", &errors)
        frozenExactObject(
            parameters["bollinger"],
            ["window", "standardDeviations", "variance"],
            "\(label).parameters.bollinger",
            &errors
        )
        frozenExactObject(parameters["rsi"], ["period", "smoothing"], "\(label).parameters.rsi", &errors)
    }
    guard let points = result["points"] as? [Any] else {
        errors.append("\(label).points must be an array")
        return
    }
    for (index, value) in points.enumerated() {
        guard let point = value as? [String: Any] else {
            errors.append("\(label).points[\(index)] must be an object")
            continue
        }
        frozenExactKeys(
            point,
            ["session", "candle", "volume", "ma20", "ma60", "macd", "bollinger20", "rsi14"],
            "\(label).points[\(index)]",
            &errors
        )
        frozenExactObject(
            point["candle"],
            ["open", "high", "low", "close"],
            "\(label).points[\(index)].candle",
            &errors
        )
        frozenExactObject(
            point["macd"],
            ["ema12", "ema26", "line", "signal", "histogram"],
            "\(label).points[\(index)].macd",
            &errors
        )
        if let bollinger = point["bollinger20"], !(bollinger is NSNull) {
            frozenExactObject(
                bollinger,
                ["middle", "standardDeviation", "upper", "lower"],
                "\(label).points[\(index)].bollinger20",
                &errors
            )
        }
    }
}

private func frozenExactObject(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String],
    optionalKeys: Set<String> = []
) {
    guard let object = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    frozenExactKeys(object, keys, label, &errors, optionalKeys: optionalKeys)
}

private func frozenExactArrayObjects(
    _ value: Any?,
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String]
) {
    guard let array = value as? [Any] else {
        errors.append("\(label) must be an array")
        return
    }
    for (index, item) in array.enumerated() {
        frozenExactObject(item, keys, "\(label)[\(index)]", &errors)
    }
}

private func frozenExactKeys(
    _ value: [String: Any],
    _ keys: Set<String>,
    _ label: String,
    _ errors: inout [String],
    optionalKeys: Set<String> = []
) {
    let actual = Set(value.keys)
    if !keys.isSubset(of: actual) || !actual.isSubset(of: keys.union(optionalKeys)) {
        errors.append("\(label) fields are invalid")
    }
}
