import Foundation

struct ResearchFundamentalWorkspaceState {
    var envelope: ResearchFundamentalsEnvelope?
    var materials: [ResearchMaterialData] = []
    var verifiedSnapshots: [String: ResearchSourceSnapshotData] = [:]
    var sourceMaterialId: String?
    var sourcePage: ResearchDocumentPageData?
    var sourcePageMaterialId: String?
    var sourcePageRevision = UUID()
    var isReadingSourcePage = false
    var sourceExcerpt = ""
    var metric = "revenue"
    var periodStart = Calendar.current.date(byAdding: .year, value: -1, to: Date()) ?? Date()
    var periodEnd = Date()
    var currency = "HKD"
    var unitScale = 1_000_000
    var scope = "consolidated"
    var value = ""
    var rawValueText = ""
    var businessScope = ""
    var measurementBasis = "financial_statement"
    var category = "actual"
    var mixDimension = "brand"
    var mixDimensionValue = ""
    var mixParentScope = ""
    var mixOverlapPolicy = "nested"
    var guidanceTargetType = "minimum"
    var guidanceLower = ""
    var guidanceUpper = ""
    var guidanceDefinition = ""
    var guidanceStatement = ""
    var guidanceVerificationDate = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    var limitation = ""
    var sourceChecked = false
    var confirmedDetails: Set<String> = []
    var explicitUnknown = false
    var comparable = true
    var comparabilityReason = ""
    var amendmentKind = "initial"
    var replacesValueId: String?
    var confirmationBinding = ResearchFundamentalConfirmationBinding()
    var message = "请选择当前 PDF 原文引用后读取结构化基本面。"
    var isLoading = false
    var isSaving = false
    var requestRevision = UUID()
    var reservation = ResearchDocumentIdempotencyReservation()

    var isBusy: Bool { isLoading || isSaving || isReadingSourcePage }

    mutating func clearForIdentityChange() {
        envelope = nil
        materials = []
        verifiedSnapshots = [:]
        sourceMaterialId = nil
        resetDraft()
        message = "正在 fresh read 结构化基本面..."
        isLoading = false
        isSaving = false
        requestRevision = UUID()
    }

    mutating func reconcileSource(
        materials: [ResearchMaterialData],
        serverAsOf: String? = nil,
        fundamentalValues: [ResearchFundamentalValueData] = [],
        verifiedSnapshot: ResearchSourceSnapshotData? = nil
    ) {
        self.materials = materials
        let reconciliation = reconcileResearchFundamentalSource(
            selectedMaterialId: sourceMaterialId,
            materials: materials,
            serverAsOf: serverAsOf,
            fundamentalValues: fundamentalValues,
            verifiedSnapshot: verifiedSnapshot,
            verifiedSnapshots: verifiedSnapshots
        )
        sourceMaterialId = reconciliation.selectedMaterialId
        guard reconciliation.requiresDraftReset else { return }
        resetDraft()
    }

    mutating func selectSource(_ materialId: String?, from materials: [ResearchMaterialData],
                               verifiedSnapshot: ResearchSourceSnapshotData? = nil) {
        let selected = reconcileResearchFundamentalSource(
            selectedMaterialId: materialId,
            materials: materials,
            verifiedSnapshot: verifiedSnapshot,
            verifiedSnapshots: verifiedSnapshots
        ).selectedMaterialId
        guard sourceMaterialId != selected else { return }
        sourceMaterialId = selected
        sourcePage = nil
        sourcePageMaterialId = nil
        sourcePageRevision = UUID()
        isReadingSourcePage = false
        sourceExcerpt = materials.first(where: { $0.id == selected })?.contentText ?? ""
        rawValueText = ""
        value = ""
        businessScope = ""
        limitation = ""
        sourceChecked = false
        confirmedDetails = []
        if selected == nil {
            resetDraft()
            return
        }
        replacesValueId = nil
        amendmentKind = "initial"
        confirmationBinding.clear()
        reservation.clear()
    }

    mutating func selectMetric(_ selected: String) {
        guard metric != selected, let option = ResearchFundamentalMetricCatalog.option(for: selected) else { return }
        metric = selected
        currency = ["vehicles", "shares", "ratio"].contains(option.unit) ? "XXX" : "HKD"
        unitScale = option.unit == "currency" ? 1_000_000 : 1
        measurementBasis = option.measurementBasis
        category = "actual"
        value = ""
        rawValueText = ""
        businessScope = ""
        limitation = ""
        explicitUnknown = false
        mixDimension = "brand"
        mixDimensionValue = ""
        mixParentScope = ""
        mixOverlapPolicy = "nested"
        guidanceTargetType = "minimum"
        guidanceLower = ""
        guidanceUpper = ""
        guidanceDefinition = ""
        guidanceStatement = ""
        sourceChecked = false
        confirmedDetails = []
        replacesValueId = nil
        amendmentKind = "initial"
        confirmationBinding.clear()
        reservation.clear()
    }

    private mutating func resetDraft() {
        sourcePage = nil
        sourcePageMaterialId = nil
        sourcePageRevision = UUID()
        isReadingSourcePage = false
        sourceExcerpt = ""
        metric = "revenue"
        periodStart = Calendar.current.date(byAdding: .year, value: -1, to: Date()) ?? Date()
        periodEnd = Date()
        currency = "HKD"
        unitScale = 1_000_000
        scope = "consolidated"
        value = ""
        rawValueText = ""
        businessScope = ""
        measurementBasis = "financial_statement"
        category = "actual"
        mixDimension = "brand"
        mixDimensionValue = ""
        mixParentScope = ""
        mixOverlapPolicy = "nested"
        guidanceTargetType = "minimum"
        guidanceLower = ""
        guidanceUpper = ""
        guidanceDefinition = ""
        guidanceStatement = ""
        guidanceVerificationDate = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
        limitation = ""
        sourceChecked = false
        confirmedDetails = []
        explicitUnknown = false
        comparable = true
        comparabilityReason = ""
        replacesValueId = nil
        amendmentKind = "initial"
        confirmationBinding.clear()
        reservation.clear()
    }
}

struct ResearchFinancialRequirementWorkspaceState {
    var binding: String?
    var envelope: ResearchFinancialRequirementEnvelope?
    var selectedMaterialIds: Set<String> = []
    var fiscalYearEnd = ""
    var annualPeriodEnd = ""
    var interimPeriodStart = ""
    var interimPeriodEnd = ""
    var asOf = Date()
    var nextReviewAt = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    var ownerConfirmed = false
    var message = "请先读取当前公司的已保存原文和期数核对。"
    var isLoading = false
    var isSaving = false
    var requestRevision = UUID()
    var reservation = ResearchDocumentIdempotencyReservation()

    var isBusy: Bool { isLoading || isSaving }

    mutating func clearForIdentityChange() {
        binding = nil
        envelope = nil
        selectedMaterialIds = []
        fiscalYearEnd = ""
        annualPeriodEnd = ""
        interimPeriodStart = ""
        interimPeriodEnd = ""
        asOf = Date()
        nextReviewAt = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
        ownerConfirmed = false
        message = "请先读取当前公司的已保存原文和期数核对。"
        isLoading = false
        isSaving = false
        requestRevision = UUID()
        reservation.clear()
    }
}

extension GateBResearchScreen {
    @MainActor
    func resetAndLoadResearchFundamentals() async {
        researchFundamentalWorkspace.clearForIdentityChange()
        researchFinancialRequirementWorkspace.clearForIdentityChange()
        await loadResearchFundamentals()
    }

    @MainActor
    func loadResearchFundamentals(
        refreshDocuments: Bool = true,
        includingValuation: Bool = true
    ) async {
        if includingValuation {
            researchValuationScenarioWorkspace.clearFreshSuccess()
        }
        guard let membership = selectedMembership else {
            researchFundamentalWorkspace.message = "请选择当前研究自选后读取结构化基本面。"
            return
        }
        if refreshDocuments {
            guard canAcquireResearchDocumentRefreshLane(
                isLoading: researchDocumentWorkspace.isLoading,
                isImporting: researchDocumentWorkspace.isImporting,
                isConfirming: researchDocumentWorkspace.isConfirming
            ) else {
                researchFundamentalWorkspace.message = "你提供的 PDF 正在读取或确认；完成后再刷新结构化基本面。"
                return
            }
        }
        let revision = UUID()
        let documentRevision: UUID
        if refreshDocuments {
            documentRevision = UUID()
            researchDocumentWorkspace.requestRevision = documentRevision
            researchDocumentWorkspace.isLoading = true
            researchDocumentWorkspace.list = nil
        } else {
            documentRevision = researchDocumentWorkspace.requestRevision
        }
        researchFundamentalWorkspace.requestRevision = revision
        researchFundamentalWorkspace.isLoading = true
        researchFundamentalWorkspace.envelope = nil
        defer {
            if researchFundamentalWorkspace.requestRevision == revision {
                researchFundamentalWorkspace.isLoading = false
            }
            if refreshDocuments,
               researchDocumentWorkspace.requestRevision == documentRevision {
                researchDocumentWorkspace.isLoading = false
            }
        }
        do {
            let documentList: ResearchDocumentListEnvelope
            if refreshDocuments {
                documentList = try await client.fetchResearchDocuments(membership: membership)
                guard researchDocumentWorkspace.requestRevision == documentRevision,
                      researchFundamentalWorkspace.requestRevision == revision,
                      selectedMembership?.id == membership.id,
                      selectedMembership?.version == membership.version,
                      parsedSymbol?.canonical == membership.symbol else { return }
            } else {
                guard let currentList = researchDocumentWorkspace.list,
                      currentList.membershipId == membership.id,
                      currentList.membershipVersion == membership.version,
                      currentList.symbol == membership.symbol else {
                    researchFundamentalWorkspace.reconcileSource(materials: [])
                    researchFundamentalWorkspace.message = "当前 fresh PDF 列表不可用；请重新刷新后选择来源。"
                    return
                }
                documentList = currentList
            }
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            let envelope = try await client.fetchResearchFundamentals(membership: membership)
            let htmlMaterials = workspace.data?.materials.filter { $0.sourceType == "issuer_public_html" } ?? []
            var verifiedSnapshots: [String: ResearchSourceSnapshotData] = [:]
            var unavailableSnapshotCount = 0
            for snapshotId in Set(htmlMaterials.compactMap { material -> String? in
                guard material.revisionState == "current", material.freshness == "fresh" else { return nil }
                return material.snapshotCitation?.snapshotId
            }) {
                do {
                    let snapshot = try await client.readResearchSourceSnapshot(membership: membership, snapshotId: snapshotId)
                    _ = try await client.readResearchSourceSnapshotOriginal(membership: membership, snapshot: snapshot)
                    verifiedSnapshots[snapshotId] = snapshot
                } catch { unavailableSnapshotCount += 1 }
            }
            guard researchDocumentWorkspace.requestRevision == documentRevision,
                  researchFundamentalWorkspace.requestRevision == revision,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            researchDocumentWorkspace.list = documentList
            researchFundamentalWorkspace.envelope = envelope
            researchFundamentalWorkspace.verifiedSnapshots = verifiedSnapshots
            let materials = documentList.materials + htmlMaterials
            researchFundamentalWorkspace.reconcileSource(
                materials: materials,
                serverAsOf: envelope.generatedAt,
                fundamentalValues: envelope.values
            )
            researchFundamentalWorkspace.message = envelope.values.isEmpty
                ? "尚无结构化原值；unknown 会保持为空，不会补零。"
                : "已 fresh read-back \(envelope.values.count) 条原值与 \(envelope.derivations.count) 项可复算输出。"
            if unavailableSnapshotCount > 0 {
                researchFundamentalWorkspace.message += " \(unavailableSnapshotCount) 份网页原件暂未校验通过；不能用于新事实，请重读。PDF 来源不受影响。"
            }
            await loadResearchFinancialRequirement(for: membership)
            if includingValuation {
                await loadResearchValuationScenarios()
            }
        } catch {
            guard researchDocumentWorkspace.requestRevision == documentRevision,
                  researchFundamentalWorkspace.requestRevision == revision else { return }
            researchDocumentWorkspace.list = nil
            researchFundamentalWorkspace.verifiedSnapshots = [:]
            researchFundamentalWorkspace.reconcileSource(materials: [])
            researchFinancialRequirementWorkspace.envelope = nil
            researchFinancialRequirementWorkspace.message = "财务资料或原文读取失败；期数核对按 UNKNOWN 处理。"
            researchFundamentalWorkspace.message = researchFundamentalClientMessage(error)
            if includingValuation {
                researchValuationScenarioWorkspace.message = "重新读取基本面失败；旧估值状态已清除。"
            }
        }
    }

    var currentFinancialRequirementMaterials: [ResearchMaterialData] {
        guard let membership = selectedMembership,
              let list = researchDocumentWorkspace.list,
              list.membershipId == membership.id,
              list.membershipVersion == membership.version else { return [] }
        let documents = Dictionary(uniqueKeysWithValues: list.documents.map { ($0.id, $0) })
        let snapshots = researchFundamentalWorkspace.verifiedSnapshots
        return researchFundamentalWorkspace.materials.filter { material in
            guard material.validates(expected: membership),
                  ["issuer_statement", "third_party_statement", "verified_fact"].contains(material.claimType),
                  ["unverified", "verified"].contains(material.verificationStatus),
                  material.revisionState == "current", material.freshness == "fresh",
                  researchContextDate(material.validUntil).map({ $0 > Date() }) == true else { return false }
            if let citation = material.citation,
               ["owner_provided_pdf", "issuer_public_pdf"].contains(material.sourceType) {
                guard let document = documents[citation.documentId] else { return false }
                let expectedRights = material.sourceType == "owner_provided_pdf" ? "user_provided" : "authorized_public"
                return material.rightsStatus == expectedRights
                    && document.isSourceAvailable && document.membershipVersionAtImport == membership.version
                    && document.symbol == membership.symbol && citation.pageNumber <= document.pageCount
            }
            if material.sourceType == "issuer_public_html",
               let citation = material.snapshotCitation,
               let original = material.snapshotOriginal,
               let snapshot = snapshots[citation.snapshotId] {
                return material.rightsStatus == "authorized_public"
                    && snapshot.reviewState == "current" && snapshot.rawSha256 == original.rawSha256
                    && snapshot.textSha256 == citation.textSha256
            }
            return false
        }
    }

    @MainActor
    func loadResearchFinancialRequirement(for membership: CandidateMembershipData) async {
        let binding = "\(membership.id):\(membership.version):\(membership.symbol):\(membership.actorId)"
        if researchFinancialRequirementWorkspace.binding != binding {
            researchFinancialRequirementWorkspace.clearForIdentityChange()
            researchFinancialRequirementWorkspace.binding = binding
        }
        let revision = UUID()
        researchFinancialRequirementWorkspace.requestRevision = revision
        researchFinancialRequirementWorkspace.isLoading = true
        researchFinancialRequirementWorkspace.envelope = nil
        defer {
            if researchFinancialRequirementWorkspace.requestRevision == revision {
                researchFinancialRequirementWorkspace.isLoading = false
            }
        }
        do {
            let fresh = try await client.fetchResearchFinancialRequirement(membership: membership)
            guard researchFinancialRequirementWorkspace.requestRevision == revision,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
            if let coverage = researchFundamentalWorkspace.envelope?.financialCoverage,
               (coverage.requirement != nil || fresh.status == "available"),
               !sameFinancialRequirementBinding(coverage.requirement, fresh.data) {
                throw ResearchFinancialRequirementClientError.invalidResponse
            }
            researchFinancialRequirementWorkspace.envelope = fresh
            researchFinancialRequirementWorkspace.message = fresh.status == "available"
                ? "期数依据与来源已重新读取；财务覆盖仍以实际财务值和缺口为准。"
                : fresh.status == "not_found" ? "尚未保存财务资料期数核对。"
                : "先前核对已失效或来源不可用；请重读原文并查看具体缺口。"
            let eligible = Set(currentFinancialRequirementMaterials.map(\.id))
            let previousSelection = researchFinancialRequirementWorkspace.selectedMaterialIds
            researchFinancialRequirementWorkspace.selectedMaterialIds.formIntersection(eligible)
            if researchFinancialRequirementWorkspace.selectedMaterialIds != previousSelection {
                researchFinancialRequirementWorkspace.ownerConfirmed = false
                researchFinancialRequirementWorkspace.reservation.clear()
            }
        } catch {
            guard researchFinancialRequirementWorkspace.requestRevision == revision else { return }
            researchFinancialRequirementWorkspace.envelope = nil
            if let clientError = error as? ResearchFinancialRequirementClientError,
               clientError == .invalidResponse {
                researchFundamentalWorkspace.envelope = nil
                researchFundamentalWorkspace.message = "财务覆盖与期数核对版本不一致；请重新读取当前资料。"
            }
            researchFinancialRequirementWorkspace.message = financialRequirementFailureMessage(error)
        }
    }

    private func sameFinancialRequirementBinding(
        _ left: ResearchFinancialRequirementData?, _ right: ResearchFinancialRequirementData?
    ) -> Bool {
        guard let left, let right else { return left == nil && right == nil }
        return left.id == right.id && left.version == right.version
            && left.membershipId == right.membershipId && left.membershipVersion == right.membershipVersion
            && left.symbol == right.symbol && left.actorId == right.actorId
            && left.fiscalYearEnd == right.fiscalYearEnd
            && left.latestRequiredAnnualPeriodEnd == right.latestRequiredAnnualPeriodEnd
            && left.latestRequiredInterimPeriodStart == right.latestRequiredInterimPeriodStart
            && left.latestRequiredInterimPeriodEnd == right.latestRequiredInterimPeriodEnd
            && left.asOf == right.asOf && left.nextReviewAt == right.nextReviewAt
            && left.validUntil == right.validUntil
            && left.sources.map { "\($0.materialId):\($0.materialRevision):\($0.contentFingerprint)" }
                == right.sources.map { "\($0.materialId):\($0.materialRevision):\($0.contentFingerprint)" }
    }

    @MainActor
    func saveResearchFinancialRequirement() async {
        guard let membership = selectedMembership,
              researchFinancialRequirementWorkspace.ownerConfirmed else {
            researchFinancialRequirementWorkspace.message = "请逐份核对原文，再明确确认这次期数核对。"
            return
        }
        let eligible = currentFinancialRequirementMaterials
        let selected = eligible.filter { researchFinancialRequirementWorkspace.selectedMaterialIds.contains($0.id) }
            .sorted { (Int($0.id) ?? 0) < (Int($1.id) ?? 0) }
        guard (1...4).contains(selected.count),
              selected.count == researchFinancialRequirementWorkspace.selectedMaterialIds.count else {
            researchFinancialRequirementWorkspace.message = "请选择 1–4 份当前可打开的已保存官方原文。"
            return
        }
        let workspace = researchFinancialRequirementWorkspace
        let yearEnd = workspace.fiscalYearEnd.trimmingCharacters(in: .whitespacesAndNewlines)
        let asOf = ISO8601DateFormatter().string(from: workspace.asOf)
        guard researchFinancialRequirementPeriodsValid(
                fiscalYearEnd: yearEnd, annualEnd: workspace.annualPeriodEnd,
                interimStart: workspace.interimPeriodStart, interimEnd: workspace.interimPeriodEnd,
                asOf: asOf),
              workspace.asOf <= Date(), workspace.nextReviewAt > Date(),
              workspace.nextReviewAt > workspace.asOf else {
            researchFinancialRequirementWorkspace.message = "请核对财政年结、应有年度/中期日期与下一次复核时间。"
            return
        }
        let nextReviewAt = ISO8601DateFormatter().string(from: workspace.nextReviewAt)
        let expectations = selected.map(ResearchFinancialRequirementSourceExpectation.init(material:))
        let semantic = [membership.id, String(membership.version), workspace.envelope?.latestRequirementId ?? "first",
                        expectations.map { "\($0.materialId):\($0.materialRevision):\($0.contentFingerprint)" }.joined(separator: ","),
                        yearEnd, workspace.annualPeriodEnd, workspace.interimPeriodStart,
                        workspace.interimPeriodEnd, asOf, nextReviewAt].joined(separator: "|")
        let key = researchFinancialRequirementWorkspace.reservation.reserve(for: semantic, prefix: "ios-financial-period-check")
        let request = CreateResearchFinancialRequirementRequest(
            membershipVersion: membership.version,
            baseRequirementId: workspace.envelope?.latestRequirementId,
            sourceMaterials: expectations,
            fiscalYearEnd: yearEnd,
            latestRequiredAnnualPeriodEnd: workspace.annualPeriodEnd,
            latestRequiredInterimPeriodStart: workspace.interimPeriodStart,
            latestRequiredInterimPeriodEnd: workspace.interimPeriodEnd,
            asOf: asOf, nextReviewAt: nextReviewAt, idempotencyKey: key
        )
        let revision = UUID()
        researchFinancialRequirementWorkspace.requestRevision = revision
        researchFinancialRequirementWorkspace.isSaving = true
        researchFinancialRequirementWorkspace.envelope = nil
        defer {
            if researchFinancialRequirementWorkspace.requestRevision == revision {
                researchFinancialRequirementWorkspace.isSaving = false
            }
        }
        do {
            let fresh = try await client.createResearchFinancialRequirementAndReadBack(
                membership: membership, requestBody: request)
            guard researchFinancialRequirementWorkspace.requestRevision == revision,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
            researchFinancialRequirementWorkspace.envelope = fresh
            researchFinancialRequirementWorkspace.ownerConfirmed = false
            researchFinancialRequirementWorkspace.reservation.clear()
            researchContextWorkspace.completeness = nil
            researchContextWorkspace.completenessMessage = "财务应覆盖期间已变化；请重新记录研究覆盖。"
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "财务期数核对已保存；旧冻结展示与确认已清除。"
            )
            invalidateTwoLayerReport("财务期数核对已保存；旧报告状态已清除。")
            researchFinancialRequirementWorkspace.message = "期数核对已按当前来源保存并回读；请查看实际缺口。"
            researchFinancialRequirementWorkspace.isSaving = false
            await loadResearchFundamentals(refreshDocuments: false, includingValuation: false)
        } catch {
            guard researchFinancialRequirementWorkspace.requestRevision == revision else { return }
            researchFinancialRequirementWorkspace.envelope = nil
            researchFinancialRequirementWorkspace.message = financialRequirementFailureMessage(error)
        }
    }

    @MainActor
    func openResearchFinancialRequirementSource(_ material: ResearchMaterialData) async {
        guard currentFinancialRequirementMaterials.contains(where: { $0.id == material.id
            && $0.revision == material.revision && $0.contentFingerprint == material.contentFingerprint }) else {
            researchFinancialRequirementWorkspace.message = "所选原文已变化；请刷新来源。"
            return
        }
        if let citation = material.snapshotCitation, let original = material.snapshotOriginal {
            if !(await openStoredSourceCitation(citation, original: original)) {
                researchFinancialRequirementWorkspace.message = "已保存网页原件或段落已变化，未打开旧内容。"
            }
        } else if let citation = material.citation,
                  let list = researchDocumentWorkspace.list,
                  let document = list.documents.first(where: { $0.id == citation.documentId }) {
            await openPersistedResearchDocumentCitation(document: document, material: material)
        } else {
            researchFinancialRequirementWorkspace.message = "当前找不到可打开的原文引用。"
        }
    }

    private func financialRequirementFailureMessage(_ error: Error) -> String {
        if case ResearchFinancialRequirementClientError.httpStatus(let status) = error {
            if [401, 403].contains(status) { return "当前身份没有保存期数核对的权限；旧结果已清除。" }
            if status == 409 { return "成员版本、来源或现有核对已变化；请重新读取后核对。" }
            if status == 404 { return "研究成员或所选原文不存在；请刷新资料。" }
            if [400, 422].contains(status) { return "来源不足以支持所填期数或日期无效；请核对原文与日期。" }
        }
        return "期数核对暂不可用；旧成功状态已清除。"
    }

    @MainActor
    func saveResearchFundamental() async {
        guard let membership = selectedMembership,
              let semantic = currentResearchFundamentalSemantic(),
              researchFundamentalWorkspace.confirmationBinding.isConfirmed(for: semantic) else { return }
        let key = researchFundamentalWorkspace.reservation.reserve(
            for: semantic.fingerprint,
            prefix: "ios-fundamental"
        )
        guard let body = researchFundamentalWorkspace.confirmationBinding.makeRequest(
            semantic: semantic,
            idempotencyKey: key
        ) else { return }
        let revision = UUID()
        researchFundamentalWorkspace.requestRevision = revision
        researchFundamentalWorkspace.isSaving = true
        researchFundamentalWorkspace.envelope = nil
        defer {
            if researchFundamentalWorkspace.requestRevision == revision {
                researchFundamentalWorkspace.isSaving = false
            }
        }
        do {
            let fresh = try await client.createResearchFundamentalAndReadBack(membership: membership, requestBody: body)
            guard researchFundamentalWorkspace.requestRevision == revision,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
            researchFundamentalWorkspace.envelope = fresh
            researchFundamentalWorkspace.reconcileSource(
                materials: researchFundamentalWorkspace.materials,
                serverAsOf: fresh.generatedAt,
                fundamentalValues: fresh.values
            )
            researchFundamentalWorkspace.confirmationBinding.clear()
            researchFundamentalWorkspace.reservation.clear()
            researchFundamentalWorkspace.amendmentKind = "initial"
            researchFundamentalWorkspace.replacesValueId = nil
            researchContextWorkspace.completeness = nil
            researchContextWorkspace.completenessMessage = "基本面来源已变化；请重新记录研究覆盖。"
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "新基本面事实已保存；旧冻结展示与确认已清除。"
            )
            invalidateTwoLayerReport("新基本面事实已保存；旧研究报告状态已清除。")
            researchFundamentalWorkspace.message = "基本面原值已保存；下一步填写估值情景。"
            await loadResearchValuationScenarios()
            selectedEvidenceWorkspace = .valuation
            pendingDecisionWorkspaceScrollTarget = "researchValuationScenarioAnchor"
        } catch {
            guard researchFundamentalWorkspace.requestRevision == revision else { return }
            researchFundamentalWorkspace.message = researchFundamentalClientMessage(error)
        }
    }

    @MainActor
    func loadSelectedFundamentalSourcePage() async {
        guard let membership = selectedMembership,
              let material = currentFundamentalMaterials.first(where: {
                  $0.id == researchFundamentalWorkspace.sourceMaterialId
              }),
              material.sourceType == "owner_provided_pdf",
              let citation = material.citation,
              let document = researchDocumentWorkspace.list?.documents.first(where: {
                  $0.id == citation.documentId && $0.symbol == membership.symbol
                      && $0.membershipVersionAtImport == membership.version && $0.isSourceAvailable
              }) else {
            researchFundamentalWorkspace.message = "请先选择当前可读的 PDF 原文来源。"
            return
        }
        let revision = UUID()
        researchFundamentalWorkspace.sourcePageRevision = revision
        researchFundamentalWorkspace.sourcePage = nil
        researchFundamentalWorkspace.sourcePageMaterialId = nil
        researchFundamentalWorkspace.isReadingSourcePage = true
        defer {
            if researchFundamentalWorkspace.sourcePageRevision == revision {
                researchFundamentalWorkspace.isReadingSourcePage = false
            }
        }
        do {
            let page = try await client.fetchResearchDocumentPage(
                membership: membership,
                documentId: document.id,
                pageNumber: citation.pageNumber
            )
            guard researchFundamentalWorkspace.sourcePageRevision == revision,
                  researchFundamentalWorkspace.sourceMaterialId == material.id,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  page.pageTextSha256 == citation.pageTextSha256,
                  !page.isTextless else { return }
            researchFundamentalWorkspace.sourcePage = page
            researchFundamentalWorkspace.sourcePageMaterialId = material.id
            researchFundamentalWorkspace.sourceExcerpt = material.contentText
            researchFundamentalWorkspace.sourceChecked = false
            researchFundamentalWorkspace.confirmedDetails = []
            researchFundamentalWorkspace.confirmationBinding.clear()
            researchFundamentalWorkspace.message = "已读取 PDF 第 \(page.pageNumber) 页；请核对摘录与原始数字。"
        } catch {
            guard researchFundamentalWorkspace.sourcePageRevision == revision else { return }
            researchFundamentalWorkspace.message = "PDF 原文页读取失败；扩展指标不会使用未核实的页文本。"
        }
    }

    func currentResearchFundamentalSemantic() -> ResearchFundamentalDraftSemantic? {
        guard let membership = selectedMembership,
              let sourceMaterialId = researchFundamentalWorkspace.sourceMaterialId else { return nil }
        let calendar = Calendar.current
        guard let option = ResearchFundamentalMetricCatalog.option(for: researchFundamentalWorkspace.metric) else { return nil }
        let instant = option.isInstant
        guard let periodEnd = ResearchFundamentalCalendarDate.string(
            from: researchFundamentalWorkspace.periodEnd,
            calendar: calendar
        ) else { return nil }
        let periodStart: String?
        if instant {
            periodStart = nil
        } else {
            guard let date = ResearchFundamentalCalendarDate.string(
                from: researchFundamentalWorkspace.periodStart,
                calendar: calendar
            ) else { return nil }
            periodStart = date
        }
        if let periodStart, periodStart >= periodEnd { return nil }
        let trimmedValue = researchFundamentalWorkspace.value.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedReason = researchFundamentalWorkspace.comparabilityReason.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = researchFundamentalWorkspace.rawValueText.trimmingCharacters(in: .whitespacesAndNewlines)
        let businessScope = researchFundamentalWorkspace.businessScope.trimmingCharacters(in: .whitespacesAndNewlines)
        let limitation = researchFundamentalWorkspace.limitation.trimmingCharacters(in: .whitespacesAndNewlines)
        let unit = option.unit
        let scale = researchFundamentalWorkspace.unitScale
        let currency = researchFundamentalWorkspace.currency.trimmingCharacters(in: .whitespacesAndNewlines)
        guard [1, 1_000, 1_000_000, 1_000_000_000].contains(scale),
              ["consolidated", "parent_company", "segment", "unknown"].contains(researchFundamentalWorkspace.scope),
              researchFundamentalWorkspace.comparable || !trimmedReason.isEmpty,
              !researchFundamentalWorkspace.explicitUnknown || ResearchFundamentalMetricCatalog.coverage.contains(option.id),
              researchFundamentalWorkspace.explicitUnknown || trimmedValue.range(
                  of: #"^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$"#, options: .regularExpression) != nil else { return nil }
        if ["currency", "currency_per_vehicle"].contains(unit) {
            guard currency.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil,
                  currency != "XXX" else { return nil }
        } else {
            guard currency == "XXX", (unit == "vehicles" || scale == 1) else { return nil }
        }
        if option.id == "gross_margin", let number = Double(trimmedValue), !(0...1).contains(number) { return nil }
        if ResearchFundamentalMetricCatalog.magnitudeOutflows.contains(option.id),
           let number = Double(trimmedValue), number < 0 { return nil }
        if ["vehicles", "shares"].contains(unit), !researchFundamentalWorkspace.explicitUnknown {
            guard ResearchFundamentalTranscription.matches(value: trimmedValue, raw: trimmedValue,
                                                           unit: unit, unitScale: scale) else { return nil }
        }
        let material = currentFundamentalMaterials.first { $0.id == sourceMaterialId }
        guard let material else { return nil }
        let assertion: ResearchFundamentalAssertion?
        let requiresAssertion = material.sourceType == "issuer_public_html"
            || !ResearchFundamentalMetricCatalog.coverage.contains(option.id)
        if requiresAssertion || researchFundamentalWorkspace.sourceChecked {
            let required: Set<String> = ["metric", "period", "currency", "unitScale", "scope"]
            guard !researchFundamentalWorkspace.explicitUnknown,
                  researchFundamentalWorkspace.sourceChecked,
                  required.isSubset(of: researchFundamentalWorkspace.confirmedDetails),
                  !businessScope.isEmpty, businessScope.count <= 200,
                  !limitation.isEmpty, limitation.count <= 2000,
                  raw.count <= 100, !raw.isEmpty,
                  ResearchFundamentalMetricCatalog.measurementBases(for: option.id)
                      .contains(researchFundamentalWorkspace.measurementBasis),
                  ["actual", "guidance"].contains(researchFundamentalWorkspace.category),
                  ResearchFundamentalTranscription.matches(value: trimmedValue, raw: raw,
                                                           unit: unit, unitScale: scale,
                                                           metric: option.id) else { return nil }
            let mix: ResearchFundamentalMix?
            if option.id == "product_mix_volume" {
                let dimensionValue = researchFundamentalWorkspace.mixDimensionValue.trimmingCharacters(in: .whitespacesAndNewlines)
                let parentScope = researchFundamentalWorkspace.mixParentScope.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !dimensionValue.isEmpty, dimensionValue.count <= 200,
                      !parentScope.isEmpty, parentScope.count <= 200,
                      researchFundamentalWorkspace.confirmedDetails.contains("taxonomy") else { return nil }
                mix = ResearchFundamentalMix(dimension: researchFundamentalWorkspace.mixDimension,
                    dimensionValue: dimensionValue, parentScope: parentScope,
                    overlapPolicy: researchFundamentalWorkspace.mixOverlapPolicy)
            } else { mix = nil }
            let guidance: ResearchFundamentalGuidance?
            if researchFundamentalWorkspace.category == "guidance" {
                let verificationDate = ResearchFundamentalCalendarDate.string(
                    from: researchFundamentalWorkspace.guidanceVerificationDate, calendar: calendar)
                let definition = researchFundamentalWorkspace.guidanceDefinition.trimmingCharacters(in: .whitespacesAndNewlines)
                let statement = researchFundamentalWorkspace.guidanceStatement.trimmingCharacters(in: .whitespacesAndNewlines)
                let lower = Double(researchFundamentalWorkspace.guidanceLower)
                let upper = Double(researchFundamentalWorkspace.guidanceUpper)
                guard ResearchFundamentalMetricCatalog.allowsGuidance(option.id),
                      let verificationDate, verificationDate > periodEnd,
                      !definition.isEmpty, definition.count <= 2000,
                      !statement.isEmpty, statement.count <= 4000,
                      ["minimum", "maximum", "range", "text"].contains(researchFundamentalWorkspace.guidanceTargetType),
                      lower.map({ $0.isFinite && abs($0) <= 1e15 }) ?? true,
                      upper.map({ $0.isFinite && abs($0) <= 1e15 }) ?? true,
                      lower == nil || upper == nil || lower! <= upper! else { return nil }
                guidance = ResearchFundamentalGuidance(lower: lower, upper: upper,
                    definition: definition, expectedVerificationDate: verificationDate,
                    targetType: researchFundamentalWorkspace.guidanceTargetType, statement: statement)
            } else { guidance = nil }
            let pdfBinding: ResearchFundamentalDocumentTextBinding?
            let htmlBinding: ResearchFundamentalSnapshotTextBinding?
            if material.sourceType == "issuer_public_html" {
                guard let citation = material.snapshotCitation,
                      material.contentText.contains(raw),
                      ResearchFundamentalTranscription.hasExactSourceToken(raw, in: material.contentText),
                      !researchFundamentalWorkspace.sourceExcerpt.isEmpty,
                      researchFundamentalWorkspace.sourceExcerpt == material.contentText else { return nil }
                pdfBinding = nil
                htmlBinding = ResearchFundamentalSnapshotTextBinding(
                    snapshotId: citation.snapshotId, textSha256: citation.textSha256,
                    startUtf16: citation.startUtf16, endUtf16: citation.endUtf16,
                    excerptSha256: citation.excerptSha256, sourceExcerpt: material.contentText,
                    rawValueText: raw)
            } else {
                let excerpt = researchFundamentalWorkspace.sourceExcerpt.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let citation = material.citation,
                      let page = researchFundamentalWorkspace.sourcePage,
                      researchFundamentalWorkspace.sourcePageMaterialId == material.id,
                      page.documentId == citation.documentId,
                      page.pageNumber == citation.pageNumber,
                      page.pageTextSha256 == citation.pageTextSha256,
                      !excerpt.isEmpty, excerpt.count <= 4000,
                      page.normalizedText.contains(excerpt), excerpt.contains(raw),
                      ResearchFundamentalTranscription.hasExactSourceToken(raw, in: excerpt) else { return nil }
                pdfBinding = ResearchFundamentalDocumentTextBinding(documentId: page.documentId,
                    pageNumber: page.pageNumber, pageTextSha256: page.pageTextSha256,
                    sourceExcerpt: excerpt, rawValueText: raw)
                htmlBinding = nil
            }
            var built = ResearchFundamentalAssertion(unit: unit,
                measurementBasis: researchFundamentalWorkspace.measurementBasis,
                businessScope: businessScope, category: researchFundamentalWorkspace.category,
                sourceUrl: material.sourceUrl ?? "", limitation: limitation, sourceChecked: true,
                structureConfirmation: ResearchFundamentalStructureConfirmation(
                    confirmedFields: option.id == "product_mix_volume"
                        ? ["metric", "period", "currency", "unitScale", "scope", "taxonomy"]
                        : ["metric", "period", "currency", "unitScale", "scope"]),
                snapshotTextBinding: htmlBinding)
            built.textBinding = pdfBinding
            built.mix = mix
            built.guidance = guidance
            assertion = built
        } else { assertion = nil }
        var semantic = ResearchFundamentalDraftSemantic(
            membershipId: membership.id,
            membershipVersion: membership.version,
            sourceMaterialId: sourceMaterialId,
            metric: researchFundamentalWorkspace.metric,
            periodKind: instant ? "instant" : "duration",
            periodStart: periodStart,
            periodEnd: periodEnd,
            currency: researchFundamentalWorkspace.currency,
            unitScale: researchFundamentalWorkspace.unitScale,
            scope: researchFundamentalWorkspace.scope,
            valueStatus: researchFundamentalWorkspace.explicitUnknown ? "explicit_unknown" : "reported",
            value: researchFundamentalWorkspace.explicitUnknown ? nil : trimmedValue,
            comparability: researchFundamentalWorkspace.comparable ? "comparable" : "not_comparable",
            comparabilityReason: researchFundamentalWorkspace.comparable ? nil : trimmedReason,
            amendmentKind: researchFundamentalWorkspace.amendmentKind,
            replacesValueId: researchFundamentalWorkspace.replacesValueId
        )
        semantic.assertion = assertion
        return semantic
    }

    @MainActor
    func prepareResearchFundamentalReplacement(_ value: ResearchFundamentalValueData) {
        guard canPrepareResearchFundamentalReplacement(value) else {
            researchFundamentalWorkspace.message = "该网页原件当前不可用于修正；请重新读取并核对来源。"
            return
        }
        researchFundamentalWorkspace.sourceMaterialId = value.source.materialId
        researchFundamentalWorkspace.sourcePage = nil
        researchFundamentalWorkspace.sourcePageMaterialId = nil
        researchFundamentalWorkspace.sourcePageRevision = UUID()
        researchFundamentalWorkspace.metric = value.metric
        researchFundamentalWorkspace.currency = value.currency
        researchFundamentalWorkspace.unitScale = value.unitScale
        researchFundamentalWorkspace.scope = value.scope
        let calendar = Calendar.current
        if let periodStart = value.periodStart.flatMap({
            ResearchFundamentalCalendarDate.date(from: $0, calendar: calendar)
        }) {
            researchFundamentalWorkspace.periodStart = periodStart
        }
        if let periodEnd = ResearchFundamentalCalendarDate.date(from: value.periodEnd, calendar: calendar) {
            researchFundamentalWorkspace.periodEnd = periodEnd
        }
        researchFundamentalWorkspace.value = value.value ?? ""
        researchFundamentalWorkspace.rawValueText = value.assertion?.textBinding?.rawValueText
            ?? value.assertion?.snapshotTextBinding?.rawValueText ?? ""
        researchFundamentalWorkspace.sourceExcerpt = value.assertion?.textBinding?.sourceExcerpt
            ?? currentFundamentalMaterials.first(where: { $0.id == value.source.materialId })?.contentText ?? ""
        researchFundamentalWorkspace.businessScope = value.assertion?.businessScope ?? ""
        researchFundamentalWorkspace.measurementBasis = value.assertion?.measurementBasis
            ?? ResearchFundamentalMetricCatalog.option(for: value.metric)?.measurementBasis ?? "financial_statement"
        researchFundamentalWorkspace.category = value.assertion?.category ?? "actual"
        researchFundamentalWorkspace.limitation = value.assertion?.limitation ?? ""
        researchFundamentalWorkspace.mixDimension = value.assertion?.mix?.dimension ?? "brand"
        researchFundamentalWorkspace.mixDimensionValue = value.assertion?.mix?.dimensionValue ?? ""
        researchFundamentalWorkspace.mixParentScope = value.assertion?.mix?.parentScope ?? ""
        researchFundamentalWorkspace.mixOverlapPolicy = value.assertion?.mix?.overlapPolicy ?? "nested"
        researchFundamentalWorkspace.guidanceTargetType = value.assertion?.guidance?.targetType ?? "minimum"
        researchFundamentalWorkspace.guidanceLower = value.assertion?.guidance?.lower.map { String($0) } ?? ""
        researchFundamentalWorkspace.guidanceUpper = value.assertion?.guidance?.upper.map { String($0) } ?? ""
        researchFundamentalWorkspace.guidanceDefinition = value.assertion?.guidance?.definition ?? ""
        researchFundamentalWorkspace.guidanceStatement = value.assertion?.guidance?.statement ?? ""
        if let dateString = value.assertion?.guidance?.expectedVerificationDate,
           let date = ResearchFundamentalCalendarDate.date(from: dateString, calendar: calendar) {
            researchFundamentalWorkspace.guidanceVerificationDate = date
        }
        researchFundamentalWorkspace.sourceChecked = false
        researchFundamentalWorkspace.confirmedDetails = []
        researchFundamentalWorkspace.explicitUnknown = value.valueStatus == "explicit_unknown"
        researchFundamentalWorkspace.comparable = value.comparability == "comparable"
        researchFundamentalWorkspace.comparabilityReason = value.comparabilityReason ?? ""
        researchFundamentalWorkspace.amendmentKind = "correction"
        researchFundamentalWorkspace.replacesValueId = value.id
        researchFundamentalWorkspace.confirmationBinding.clear()
        researchFundamentalWorkspace.reservation.clear()
    }

    func currentFundamentalSourceStatus(_ value: ResearchFundamentalValueData) -> String {
        guard value.source.kind == "source_snapshot" else {
            return value.source.freshness == "fresh" ? "当前有效" : "已过期"
        }
        var states: [String] = []
        if value.source.materialRevisionState != "current" || value.valueState != "current" {
            states.append("历史来源")
        }
        if value.source.freshness != "fresh" {
            states.append("已过期")
        }
        switch value.source.snapshotReviewState {
        case "current": break
        case "pending_review": states.append("待重新核对")
        case "historical": states.append("历史原文")
        default: states.append("复核状态未知")
        }
        switch value.source.originalAvailability {
        case "available": break
        case "unavailable": states.append("原件不可用")
        default: states.append("原件状态未知")
        }
        return states.isEmpty ? "当前有效" : states.joined(separator: " · ")
    }

    func canPrepareResearchFundamentalReplacement(_ value: ResearchFundamentalValueData) -> Bool {
        guard value.valueState == "current", value.source.materialRevisionState == "current",
              currentFundamentalMaterials.contains(where: { $0.id == value.source.materialId }) else { return false }
        guard value.source.kind == "source_snapshot" else { return true }
        return value.source.freshness == "fresh" && value.source.isCurrentlyUsable
    }

    @MainActor
    func openResearchFundamentalSource(_ value: ResearchFundamentalValueData) async {
        if value.source.kind == "source_snapshot" {
            guard let citation = value.source.snapshotCitation,
                  let original = value.source.snapshotOriginal else {
                researchFundamentalWorkspace.message = "已保存原文定位缺失，请刷新事实。"
                return
            }
            guard await openStoredSourceCitation(citation, original: original) else {
                researchFundamentalWorkspace.message = "原件、片段或连接已变化；未打开旧缓存。"
                return
            }
            return
        }
        guard let list = researchDocumentWorkspace.list,
              let material = list.materials.first(where: { $0.id == value.source.materialId }),
              let document = list.documents.first(where: { $0.id == value.source.documentId }) else {
            researchFundamentalWorkspace.message = "当前 fresh PDF 列表无法匹配该来源；未打开旧缓存。"
            return
        }
        researchDocumentWorkspace.selectedDocumentId = document.id
        await openPersistedResearchDocumentCitation(document: document, material: material)
    }

    var currentFundamentalMaterials: [ResearchMaterialData] {
        currentResearchFundamentalMaterials(
            materials: researchFundamentalWorkspace.materials,
            serverAsOf: researchFundamentalWorkspace.envelope?.generatedAt
                ?? researchDocumentWorkspace.list?.generatedAt,
            fundamentalValues: researchFundamentalWorkspace.envelope?.values ?? [],
            verifiedSnapshots: researchFundamentalWorkspace.verifiedSnapshots
        )
    }

    func researchFundamentalClientMessage(_ error: Error) -> String {
        if case ResearchFundamentalClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "未认证或缺少 user-scoped research_write；旧基本面已清除。"
            case 404: return "研究成员或当前 PDF 来源不存在；旧基本面已清除。"
            case 409: return "membership、幂等、来源修订或替代链冲突；请刷新后重试。"
            case 400, 422: return "期间、币种、单位、口径、unknown 或确认字段无效。"
            default: return "基本面数据库不可用；未显示旧成功。"
            }
        }
        return "基本面响应无效或网络不可用；未显示旧成功。"
    }
}
