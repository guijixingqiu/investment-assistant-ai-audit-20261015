import Foundation

struct ResearchValuationScenarioDraft: Equatable {
    var methodId = "discounted_forward_metric_multiple_user_scenario"
    var metricCurrency = ""
    var shareBasis = ""
    var baseMetricPerShare = ""
    var annualGrowthPercent = ""
    var horizonYears = ""
    var terminalMultiple = ""
    var annualDiscountPercent = ""
    var netCashPerShare = ""
    var growthStepPercent = ""
    var multipleStep = ""

    func parsed(requireShareBasis: Bool = false) -> AnnualValuationScenarioInput? {
        guard metricCurrency.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil,
              !requireShareBasis || ["basic", "diluted"].contains(shareBasis),
              let base = finite(baseMetricPerShare),
              let growth = finite(annualGrowthPercent),
              let horizon = Int(horizonYears),
              let multiple = finite(terminalMultiple),
              let discount = finite(annualDiscountPercent),
              let netCash = finite(netCashPerShare),
              let growthStep = finite(growthStepPercent),
              let multipleStep = finite(multipleStep) else { return nil }
        let adjusted = methodId == "adjusted_net_asset_value_user_scenario"
        let normalizedMultiple = adjusted ? multiple / 100 : multiple
        let normalizedStep = adjusted ? multipleStep / 100 : multipleStep
        if adjusted && (normalizedMultiple > 1 || normalizedMultiple + normalizedStep > 1) { return nil }
        let input = AnnualValuationScenarioInput(
            methodId: methodId,
            metricCurrency: metricCurrency,
            shareBasis: shareBasis.isEmpty ? nil : shareBasis,
            baseMetricPerShare: base,
            annualGrowthRate: growth / 100,
            horizonYears: horizon,
            terminalMultiple: normalizedMultiple,
            annualDiscountRate: discount / 100,
            netCashPerShare: netCash,
            growthRateStep: growthStep / 100,
            multipleStep: normalizedStep
        )
        return calculateAnnualValuationScenarioGrid(input) == nil ? nil : input
    }

    mutating func fill(from input: AnnualValuationScenarioInput) {
        methodId = input.methodId ?? "discounted_forward_metric_multiple_user_scenario"
        metricCurrency = input.metricCurrency ?? ""
        shareBasis = input.shareBasis ?? ""
        baseMetricPerShare = String(input.baseMetricPerShare)
        annualGrowthPercent = String(input.annualGrowthRate * 100)
        horizonYears = String(input.horizonYears)
        let adjusted = methodId == "adjusted_net_asset_value_user_scenario"
        terminalMultiple = String(input.terminalMultiple * (adjusted ? 100 : 1))
        annualDiscountPercent = String(input.annualDiscountRate * 100)
        netCashPerShare = String(input.netCashPerShare)
        growthStepPercent = String(input.growthRateStep * 100)
        multipleStep = String(input.multipleStep * (adjusted ? 100 : 1))
    }

    @discardableResult
    mutating func bindCurrency(_ nextCurrency: String) -> Bool {
        let binding = rebindResearchValuationMonetaryInputs(
            currentCurrency: metricCurrency,
            nextCurrency: nextCurrency,
            baseMetricPerShare: baseMetricPerShare,
            netCashPerShare: netCashPerShare
        )
        metricCurrency = nextCurrency
        baseMetricPerShare = binding.baseMetricPerShare
        netCashPerShare = binding.netCashPerShare
        return binding.mustReenter
    }

    private func finite(_ value: String) -> Double? {
        guard value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              let result = Double(value),
              result.isFinite else { return nil }
        return result
    }
}

extension GateBResearchScreen {
    private var currentFcffProviderMaterial: ResearchMaterialData? {
        guard let membership = selectedMembership,
              let material = researchValuationScenarioWorkspace.fcffProviderMaterial,
              material.id == researchValuationScenarioWorkspace.fcffProviderMaterialId,
              material.validates(expected: membership),
              material.sourceType == "futu_opend_financial_statement_provider",
              material.futuFinancialSource?.membershipVersion == membership.version,
              material.futuFinancialSource?.financialType == "ANNUAL",
              material.revisionState == "current", material.freshness == "fresh" else { return nil }
        return material
    }

    @MainActor
    func fcffProviderSelectionChanged() {
        researchValuationScenarioWorkspace.fcffRevision = UUID()
        researchValuationScenarioWorkspace.fcffProviderReference = nil
        researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
        if researchValuationScenarioWorkspace.fcffProviderPendingSave == nil {
            researchValuationScenarioWorkspace.fcffProviderReservation.clear()
        }
    }

    @MainActor
    func loadFcffProviderCaptures() async {
        guard let membership = selectedMembership,
              researchValuationScenarioWorkspace.fcffProviderPendingSave == nil else { return }
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchValuationScenarioWorkspace.fcffProviderLookupRevision = revision
        researchValuationScenarioWorkspace.fcffProviderLookupBusy = true
        researchValuationScenarioWorkspace.fcffProviderCaptures = []
        researchValuationScenarioWorkspace.fcffProviderCaptureId = ""
        researchValuationScenarioWorkspace.fcffProviderPeriodEnd = ""
        researchValuationScenarioWorkspace.fcffProviderPreview = nil
        researchValuationScenarioWorkspace.fcffProviderMaterial = nil
        researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
        fcffProviderSelectionChanged()
        researchValuationScenarioWorkspace.fcffProviderLookupMessage = "正在读取当前成员最近的已存年度捕获。"
        defer {
            if researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision {
                researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
            }
        }
        do {
            let captures = try await client.listFutuFinancialCaptures(membership: membership)
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchValuationScenarioWorkspace.fcffProviderCaptures = captures.filter {
                $0.periodSelection == "annual" && $0.membershipVersion == membership.version
                    && $0.pages.contains { page in page.reports.contains { $0.financialType == "ANNUAL" } }
            }
            researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                researchValuationScenarioWorkspace.fcffProviderCaptures.isEmpty
                ? "最近 20 次捕获中没有当前成员可用的年度原件；请先到富途财报核对已存捕获。"
                : "请选择已存年度捕获和报告日；只读取所选原件。"
        } catch {
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                "年度捕获读取失败；未沿用旧列表。\(fcffClientMessage(error))"
        }
    }

    @MainActor
    func fcffProviderCaptureChanged() {
        researchValuationScenarioWorkspace.fcffProviderLookupRevision = UUID()
        researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
        researchValuationScenarioWorkspace.fcffProviderPeriodEnd = ""
        researchValuationScenarioWorkspace.fcffProviderPreview = nil
        researchValuationScenarioWorkspace.fcffProviderMaterial = nil
        researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
        fcffProviderSelectionChanged()
        researchValuationScenarioWorkspace.fcffProviderLookupMessage = "请选择该年度捕获中的报告日。"
    }

    @MainActor
    func fcffProviderPeriodChanged() {
        researchValuationScenarioWorkspace.fcffProviderLookupRevision = UUID()
        researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
        researchValuationScenarioWorkspace.fcffProviderPreview = nil
        researchValuationScenarioWorkspace.fcffProviderMaterial = nil
        researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
        fcffProviderSelectionChanged()
        researchValuationScenarioWorkspace.fcffProviderLookupMessage = "读取所选期间，核对已保存的有效材料。"
    }

    @MainActor
    func loadFcffProviderMaterials() async {
        guard let membership = selectedMembership,
              let capture = researchValuationScenarioWorkspace.fcffProviderCaptures.first(where: {
                  $0.id == researchValuationScenarioWorkspace.fcffProviderCaptureId
                      && $0.membershipVersion == membership.version && $0.periodSelection == "annual"
              }),
              !researchValuationScenarioWorkspace.fcffProviderPeriodEnd.isEmpty,
              researchValuationScenarioWorkspace.fcffProviderPendingSave == nil else { return }
        let period = researchValuationScenarioWorkspace.fcffProviderPeriodEnd
        guard capture.pages.contains(where: { page in
            page.reports.contains { $0.financialType == "ANNUAL" && $0.periodEnd == period }
        }) else { return }
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchValuationScenarioWorkspace.fcffProviderLookupRevision = revision
        researchValuationScenarioWorkspace.fcffProviderLookupBusy = true
        researchValuationScenarioWorkspace.fcffProviderPreview = nil
        researchValuationScenarioWorkspace.fcffProviderMaterial = nil
        researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
        fcffProviderSelectionChanged()
        defer {
            if researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision {
                researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
            }
        }
        do {
            let preview = try await client.readFutuFinancialMaterialPreview(
                membership: membership, captureId: capture.id,
                financialType: "ANNUAL", periodEnd: period)
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity,
                  researchValuationScenarioWorkspace.fcffProviderCaptureId == capture.id,
                  researchValuationScenarioWorkspace.fcffProviderPeriodEnd == period else { return }
            researchValuationScenarioWorkspace.fcffProviderPreview = preview
            researchValuationScenarioWorkspace.fcffProviderLookupMessage = preview.materials.isEmpty
                ? "该年度期间尚无当前有效的已保存材料；可到富途财报核对原值后明确保存。"
                : "已找到 \(preview.materials.count) 条当前有效材料；请选择一条核对。"
        } catch {
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                "所选年度原页读取失败；未沿用旧材料。\(fcffClientMessage(error))"
        }
    }

    @MainActor
    func selectFcffProviderMaterial(_ materialId: String) async {
        researchValuationScenarioWorkspace.fcffProviderMaterialId = materialId
        researchValuationScenarioWorkspace.fcffProviderMaterial = nil
        fcffProviderSelectionChanged()
        if materialId.isEmpty {
            researchValuationScenarioWorkspace.fcffProviderLookupRevision = UUID()
            researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
            researchValuationScenarioWorkspace.fcffProviderLookupMessage = "请选择一条已保存的有效年度材料。"
            return
        }
        guard let membership = selectedMembership,
              let preview = researchValuationScenarioWorkspace.fcffProviderPreview,
              let match = preview.materials.first(where: { $0.id == materialId }),
              researchValuationScenarioWorkspace.fcffProviderPendingSave == nil else { return }
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchValuationScenarioWorkspace.fcffProviderLookupRevision = revision
        researchValuationScenarioWorkspace.fcffProviderLookupBusy = true
        researchValuationScenarioWorkspace.fcffProviderLookupMessage = "正在核对已保存材料的身份与原页。"
        defer {
            if researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision {
                researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
            }
        }
        do {
            let material = try await client.readHistoricalFutuFinancialMaterial(
                membership: membership, materialId: match.id, revision: match.revision,
                contentFingerprint: match.contentFingerprint)
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity,
                  researchValuationScenarioWorkspace.fcffProviderMaterialId == materialId,
                  researchValuationScenarioWorkspace.fcffProviderPreview == preview else { return }
            guard material.validates(expected: membership),
                  material.revisionState == "current", material.freshness == "fresh",
                  material.sourceVersion == match.sourceVersion,
                  material.futuFinancialSource == preview.source,
                  material.contentFingerprint == preview.contentFingerprint else {
                researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
                researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                    "已存材料的版本、期间或有效期已变化；请重新读取所选原页。"
                return
            }
            researchValuationScenarioWorkspace.fcffProviderMaterial = material
            researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                "已核对材料 #\(material.id) 的当前版本、有效期和年度原页；可读取 FCFF 参考。"
        } catch {
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity,
                  researchValuationScenarioWorkspace.fcffProviderMaterialId == materialId else { return }
            researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
            researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                "已存材料读取失败；请重新选择。\(fcffClientMessage(error))"
        }
    }

    @MainActor
    func loadFcffProviderReference() async {
        guard let membership = selectedMembership, let material = currentFcffProviderMaterial,
              let source = material.futuFinancialSource,
              researchValuationScenarioWorkspace.fcffProviderPendingSave == nil,
              !researchValuationScenarioWorkspace.fcffBusy else { return }
        let selection = FcffProviderSelection(financialCaptureId: source.captureId,
            sourceMaterialId: material.id, annualPeriodEnd: source.periodEnd,
            shareReferenceDate: researchValuationScenarioWorkspace.fcffProviderShareDate)
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchValuationScenarioWorkspace.fcffRevision = revision
        researchValuationScenarioWorkspace.fcffBusy = true
        defer { if researchValuationScenarioWorkspace.fcffRevision == revision {
            researchValuationScenarioWorkspace.fcffBusy = false
        } }
        do {
            let reference = try await client.fetchFcffProviderReference(membership: membership,
                selection: selection)
            guard researchValuationScenarioWorkspace.fcffRevision == revision,
                  researchDocumentTaskIdentity == identity,
                  currentFcffProviderMaterial == material,
                  researchValuationScenarioWorkspace.fcffProviderShareDate == selection.shareReferenceDate else { return }
            let draft = researchValuationScenarioWorkspace.fcffDraft
            if draft.currency != reference.currency || draft.balanceReferenceDate != reference.balanceReferenceDate {
                researchValuationScenarioWorkspace.fcffDraft.clearMonetaryInputs()
                researchValuationScenarioWorkspace.fcffProviderBridge = FcffProviderBridgeDraft()
            }
            researchValuationScenarioWorkspace.fcffDraft.currency = reference.currency
            researchValuationScenarioWorkspace.fcffDraft.historicalAnnualPeriodEnd = reference.balanceReferenceDate
            researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate = reference.balanceReferenceDate
            if researchValuationScenarioWorkspace.fcffDraft.forecast.isEmpty {
                researchValuationScenarioWorkspace.fcffDraft.resetForecastPeriods()
            }
            researchValuationScenarioWorkspace.fcffProviderReference = reference
            researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
            researchValuationScenarioWorkspace.fcffProviderMessage =
                "OpenD 原页已核对；这是第三方未核实参考。缺项保留，权益桥接和未来预测须逐项填写个人判断。"
        } catch {
            guard researchValuationScenarioWorkspace.fcffRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchValuationScenarioWorkspace.fcffProviderMessage = fcffClientMessage(error)
        }
    }

    @MainActor
    func prepareFcffProviderRevision(_ scenario: ResearchProviderFcffScenarioSetData) async {
        guard let membership = selectedMembership,
              scenario.scenarioState == "current",
              researchValuationScenarioWorkspace.fcffProviderPendingSave == nil else { return }
        let reference = scenario.providerReference
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchValuationScenarioWorkspace.fcffProviderLookupRevision = revision
        researchValuationScenarioWorkspace.fcffProviderLookupBusy = true
        researchValuationScenarioWorkspace.fcffProviderCaptureId = ""
        researchValuationScenarioWorkspace.fcffProviderPeriodEnd = ""
        researchValuationScenarioWorkspace.fcffProviderPreview = nil
        researchValuationScenarioWorkspace.fcffProviderMaterial = nil
        researchValuationScenarioWorkspace.fcffProviderMaterialId = ""
        fcffProviderSelectionChanged()
        defer {
            if researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision {
                researchValuationScenarioWorkspace.fcffProviderLookupBusy = false
            }
        }
        do {
            let material = try await client.readHistoricalFutuFinancialMaterial(
                membership: membership, materialId: reference.materialId,
                revision: reference.materialRevision,
                contentFingerprint: reference.materialFingerprint)
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            guard material.validates(expected: membership),
                  material.revisionState == "current", material.freshness == "fresh",
                  let source = material.futuFinancialSource,
                  source.membershipVersion == membership.version,
                  source.financialType == "ANNUAL",
                  source.captureId == reference.financialCaptureId,
                  source.periodEnd == reference.balanceReferenceDate else {
                researchValuationScenarioWorkspace.fcffProviderMessage =
                    "该情景的已存材料不再是当前有效年度原件；请重新选择材料。"
                return
            }
            let capture = try await client.readFutuFinancialCapture(
                membership: membership, captureId: source.captureId)
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            guard capture.periodSelection == "annual", capture.membershipVersion == membership.version else {
                researchValuationScenarioWorkspace.fcffProviderMessage = "该情景的年度捕获已变化；请重新选择。"
                return
            }
            let preview = try await client.readFutuFinancialMaterialPreview(
                membership: membership, captureId: source.captureId,
                financialType: "ANNUAL", periodEnd: source.periodEnd)
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            guard preview.source == source,
                  preview.materials.contains(where: { $0.id == material.id
                      && $0.revision == material.revision
                      && $0.contentFingerprint == material.contentFingerprint
                      && $0.sourceVersion == material.sourceVersion }) else {
                researchValuationScenarioWorkspace.fcffProviderMessage =
                    "该情景的材料与当前原页不再匹配；请重新选择。"
                return
            }
            researchValuationScenarioWorkspace.fcffProviderCaptures = [capture]
                + researchValuationScenarioWorkspace.fcffProviderCaptures.filter { $0.id != capture.id }
            researchValuationScenarioWorkspace.fcffProviderCaptureId = capture.id
            researchValuationScenarioWorkspace.fcffProviderPeriodEnd = source.periodEnd
            researchValuationScenarioWorkspace.fcffProviderPreview = preview
            researchValuationScenarioWorkspace.fcffProviderMaterial = material
            researchValuationScenarioWorkspace.fcffProviderMaterialId = material.id
            researchValuationScenarioWorkspace.fcffProviderLookupMessage =
                "已核对情景 #\(scenario.id) 的有效年度材料 #\(material.id)。"
        } catch {
            guard researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchValuationScenarioWorkspace.fcffProviderMessage =
                "该情景的已存原件读取失败；请重新选择。\(fcffClientMessage(error))"
            return
        }
        researchValuationScenarioWorkspace.fcffProviderShareDate = scenario.providerReference.shareReferenceDate
        researchValuationScenarioWorkspace.fcffDraft.fill(from: scenario)
        researchValuationScenarioWorkspace.fcffProviderBridge.fill(from: scenario)
        researchValuationScenarioWorkspace.fcffProviderReplacesId = scenario.id
        researchValuationScenarioWorkspace.fcffProviderReference = nil
        researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
        await loadFcffProviderReference()
        if researchValuationScenarioWorkspace.fcffProviderLookupRevision == revision,
           researchDocumentTaskIdentity == identity,
           researchValuationScenarioWorkspace.fcffProviderReference != nil {
            researchValuationScenarioWorkspace.fcffProviderMessage = scenario.recomputable
                ? "已载入第三方参考情景 #\(scenario.id)，核对后可保存新修订。"
                : "已载入历史情景 #\(scenario.id)；当前来源须重新核对。"
        }
    }

    @MainActor
    func saveFcffProviderScenario() async {
        guard !researchValuationScenarioWorkspace.fcffBusy else { return }
        if let pending = researchValuationScenarioWorkspace.fcffProviderPendingSave,
           let membership = researchValuationScenarioWorkspace.fcffProviderPendingMembership {
            await submitFcffProviderScenario(pending, membership: membership)
            return
        }
        guard let membership = selectedMembership,
              researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed,
              let reference = researchValuationScenarioWorkspace.fcffProviderReference,
              let bridge = researchValuationScenarioWorkspace.fcffProviderBridge.bridge,
              let assumptions = researchValuationScenarioWorkspace.fcffDraft.providerAssumptions(
                reference: reference, bridge: bridge) else { return }
        do {
            let fresh = try await client.fetchResearchValuationScenarios(membership: membership)
            let prior = (fresh.providerFcffScenarioSets ?? []).first { $0.scenarioState == "current" }
            guard prior?.id == researchValuationScenarioWorkspace.fcffProviderReplacesId else {
                researchValuationScenarioWorkspace.fcffProviderMessage = "修订链已变化，请刷新并载入当前版本。"
                return
            }
            let selection = FcffProviderSelection(financialCaptureId: reference.financialCaptureId,
                sourceMaterialId: reference.materialId, annualPeriodEnd: reference.balanceReferenceDate,
                shareReferenceDate: reference.shareReferenceDate)
            let reasons = researchValuationScenarioWorkspace.fcffProviderBridge.reasons
            let key = researchValuationScenarioWorkspace.fcffProviderReservation.reserve(
                for: "\(membership.id)|\(reference.sourceFingerprint)|\(prior?.id ?? "root")|\(assumptions)|\(reasons)",
                prefix: "ios-fcff-provider")
            let body = CreateResearchProviderFcffScenarioRequest(membershipVersion: membership.version,
                symbol: membership.symbol, replacesScenarioSetId: prior?.id, selection: selection,
                sourceFingerprint: reference.sourceFingerprint, assumptions: assumptions,
                bridgeReasons: reasons, idempotencyKey: key)
            researchValuationScenarioWorkspace.fcffProviderPendingSave = body
            researchValuationScenarioWorkspace.fcffProviderPendingMembership = membership
            researchValuationScenarioWorkspace.fcffProviderHadSubmissionAttempt = false
            await submitFcffProviderScenario(body, membership: membership)
        } catch { researchValuationScenarioWorkspace.fcffProviderMessage = fcffClientMessage(error) }
    }

    @MainActor
    private func submitFcffProviderScenario(_ body: CreateResearchProviderFcffScenarioRequest,
                                            membership: CandidateMembershipData) async {
        researchValuationScenarioWorkspace.fcffBusy = true
        defer { researchValuationScenarioWorkspace.fcffBusy = false }
        let priorAttempt = researchValuationScenarioWorkspace.fcffProviderHadSubmissionAttempt
        researchValuationScenarioWorkspace.fcffProviderHadSubmissionAttempt = true
        do {
            let result = try await client.createProviderFcffScenarioAndReadBack(
                membership: membership, requestBody: body)
            if selectedMembership?.id == membership.id && selectedMembership?.version == membership.version {
                researchValuationScenarioWorkspace.envelope = result.envelope
            }
            researchValuationScenarioWorkspace.fcffProviderPendingSave = nil
            researchValuationScenarioWorkspace.fcffProviderPendingMembership = nil
            researchValuationScenarioWorkspace.fcffProviderHadSubmissionAttempt = false
            researchValuationScenarioWorkspace.fcffProviderReservation.clear()
            researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
            researchValuationScenarioWorkspace.fcffProviderReplacesId = nil
            researchValuationScenarioWorkspace.fcffProviderMessage = result.saved.recomputable
                ? "第三方参考 FCFF 情景已保存并回读；可明确选入受限研究。"
                : "情景已回读但来源变化，作为历史保留；请核对后修订。"
        } catch {
            if case ResearchValuationScenarioClientError.httpStatus(let status) = error,
               !priorAttempt, (400..<500).contains(status), status != 408, status != 429 {
                researchValuationScenarioWorkspace.fcffProviderPendingSave = nil
                researchValuationScenarioWorkspace.fcffProviderPendingMembership = nil
                researchValuationScenarioWorkspace.fcffProviderHadSubmissionAttempt = false
                researchValuationScenarioWorkspace.fcffProviderReservation.clear()
                researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
                researchValuationScenarioWorkspace.fcffProviderMessage =
                    "服务端拒绝保存；请重新核对来源与假设。\(fcffClientMessage(error))"
            } else {
                researchValuationScenarioWorkspace.fcffProviderMessage =
                    "保存结果未确定；原请求已保留。请点“核对上次保存”。\(fcffClientMessage(error))"
            }
        }
    }

    @MainActor
    func fcffSelectionChanged() {
        researchValuationScenarioWorkspace.fcffRevision = UUID()
        researchValuationScenarioWorkspace.fcffPreview = nil
        researchValuationScenarioWorkspace.fcffOwnerConfirmed = false
        if researchValuationScenarioWorkspace.fcffPendingSave == nil {
            researchValuationScenarioWorkspace.fcffReservation.clear()
        }
    }

    @MainActor
    func fcffAssumptionsChanged() {
        researchValuationScenarioWorkspace.fcffOwnerConfirmed = false
        researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
        if researchValuationScenarioWorkspace.fcffPendingSave == nil {
            researchValuationScenarioWorkspace.fcffReservation.clear()
        }
        if researchValuationScenarioWorkspace.fcffProviderPendingSave == nil {
            researchValuationScenarioWorkspace.fcffProviderReservation.clear()
        }
    }

    @MainActor
    func loadFcffSourcePreview() async {
        guard let membership = selectedMembership,
              let selection = researchValuationScenarioWorkspace.fcffDraft.selection,
              !researchValuationScenarioWorkspace.fcffBusy,
              researchValuationScenarioWorkspace.fcffPendingSave == nil else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.fcffRevision = revision
        researchValuationScenarioWorkspace.fcffBusy = true
        researchValuationScenarioWorkspace.fcffPreview = nil
        defer { if researchValuationScenarioWorkspace.fcffRevision == revision {
            researchValuationScenarioWorkspace.fcffBusy = false
        } }
        do {
            let preview = try await client.fetchFcffSourcePreview(membership: membership, selection: selection)
            guard researchValuationScenarioWorkspace.fcffRevision == revision,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  researchValuationScenarioWorkspace.fcffDraft.selection == selection else { return }
            researchValuationScenarioWorkspace.fcffPreview = preview
            if preview.status == "available" {
                if !researchValuationScenarioWorkspace.fcffDraft.currency.isEmpty,
                   researchValuationScenarioWorkspace.fcffDraft.currency != preview.currency {
                    researchValuationScenarioWorkspace.fcffDraft.clearMonetaryInputs()
                    researchValuationScenarioWorkspace.fcffOwnerConfirmed = false
                }
                researchValuationScenarioWorkspace.fcffDraft.currency = preview.currency ?? ""
                researchValuationScenarioWorkspace.fcffMessage = "原始行可用。请核对历史缺项、资产负债表至估值日调整和个人预测。"
            } else {
                researchValuationScenarioWorkspace.fcffMessage = "权益桥接来源缺项：\(preview.missingBridgeRoles.joined(separator: "、"))。历史经营数据缺项可单独披露。"
            }
        } catch {
            researchValuationScenarioWorkspace.fcffMessage = fcffClientMessage(error)
        }
    }

    @MainActor
    func prepareFcffRevision(_ scenario: ResearchFcffScenarioSetData) async {
        guard scenario.scenarioState == "current",
              researchValuationScenarioWorkspace.fcffPendingSave == nil else { return }
        researchValuationScenarioWorkspace.fcffDraft.fill(from: scenario)
        if !scenario.recomputable, let currentFacts = researchFundamentalWorkspace.envelope?.values {
            researchValuationScenarioWorkspace.fcffDraft.selectAvailableFacts(currentFacts)
        }
        researchValuationScenarioWorkspace.fcffPreview = nil
        researchValuationScenarioWorkspace.fcffOwnerConfirmed = false
        researchValuationScenarioWorkspace.fcffReplacesId = scenario.id
        await loadFcffSourcePreview()
        researchValuationScenarioWorkspace.fcffMessage = scenario.recomputable
            ? "已载入情景 #\(scenario.id)；修改假设后重新确认。"
            : "已载入旧情景 #\(scenario.id)。请重新选择当前原件，保留这条修订链。"
    }

    @MainActor
    func saveFcffScenario() async {
        guard !researchValuationScenarioWorkspace.fcffBusy else { return }
        // An uncertain POST keeps its exact body, key and original membership through edits and identity changes.
        if let pending = researchValuationScenarioWorkspace.fcffPendingSave,
           let pendingMembership = researchValuationScenarioWorkspace.fcffPendingMembership {
            await submitFcffScenario(pending, membership: pendingMembership)
            return
        }
        guard let membership = selectedMembership,
              researchValuationScenarioWorkspace.fcffOwnerConfirmed,
              let selection = researchValuationScenarioWorkspace.fcffDraft.selection,
              let preview = researchValuationScenarioWorkspace.fcffPreview,
              preview.status == "available", preview.membershipVersion == membership.version,
              let fingerprint = preview.sourceFingerprint,
              let assumptions = researchValuationScenarioWorkspace.fcffDraft.assumptions(preview: preview),
              let classification = researchValuationScenarioWorkspace.fcffDraft.classification,
              calculateFcffScenarioPreview(assumptions) != nil else { return }
        do {
            let fresh = try await client.fetchResearchValuationScenarios(membership: membership)
            let prior = (fresh.fcffScenarioSets ?? []).first(where: { $0.scenarioState == "current" })
            guard prior?.id == researchValuationScenarioWorkspace.fcffReplacesId else {
                researchValuationScenarioWorkspace.fcffMessage = "当前修订链已变化；请刷新并载入当前版本。"
                return
            }
            let key = researchValuationScenarioWorkspace.fcffReservation.reserve(
                for: "\(membership.id)|\(fingerprint)|\(prior?.id ?? "root")|\(assumptions)|\(classification)",
                prefix: "ios-fcff-scenario")
            let body = CreateResearchFcffScenarioRequest(membershipVersion: membership.version,
                symbol: membership.symbol, replacesScenarioSetId: prior?.id, sourceSelection: selection,
                sourceFingerprint: fingerprint, assumptions: assumptions,
                bridgeClassification: classification, ownerConfirmed: true, idempotencyKey: key)
            researchValuationScenarioWorkspace.fcffPendingSave = body
            researchValuationScenarioWorkspace.fcffPendingMembership = membership
            researchValuationScenarioWorkspace.fcffHadSubmissionAttempt = false
            await submitFcffScenario(body, membership: membership)
        } catch {
            researchValuationScenarioWorkspace.fcffMessage = fcffClientMessage(error)
        }
    }

    @MainActor
    private func submitFcffScenario(_ body: CreateResearchFcffScenarioRequest,
                                    membership: CandidateMembershipData) async {
        researchValuationScenarioWorkspace.fcffBusy = true
        defer { researchValuationScenarioWorkspace.fcffBusy = false }
        let priorAttempt = researchValuationScenarioWorkspace.fcffHadSubmissionAttempt
        researchValuationScenarioWorkspace.fcffHadSubmissionAttempt = true
        do {
            let result = try await client.createFcffScenarioAndReadBack(membership: membership, requestBody: body)
            if selectedMembership?.id == membership.id && selectedMembership?.version == membership.version {
                researchValuationScenarioWorkspace.envelope = result.envelope
            }
            researchValuationScenarioWorkspace.fcffPendingSave = nil
            researchValuationScenarioWorkspace.fcffPendingMembership = nil
            researchValuationScenarioWorkspace.fcffHadSubmissionAttempt = false
            researchValuationScenarioWorkspace.fcffReservation.clear()
            researchValuationScenarioWorkspace.fcffOwnerConfirmed = false
            researchValuationScenarioWorkspace.fcffReplacesId = nil
            researchValuationScenarioWorkspace.fcffMessage = result.saved.recomputable
                ? "FCFF 情景已保存并回读；旧修订及引用原件继续保留。"
                : "FCFF 情景已保存并回读，当前来源已失效，作为历史留存。可载入当前修订链，核对新原件后再修订。"
        } catch {
            if case ResearchValuationScenarioClientError.httpStatus(let status) = error,
               !priorAttempt, (400..<500).contains(status), status != 408, status != 429 {
                researchValuationScenarioWorkspace.fcffPendingSave = nil
                researchValuationScenarioWorkspace.fcffPendingMembership = nil
                researchValuationScenarioWorkspace.fcffHadSubmissionAttempt = false
                researchValuationScenarioWorkspace.fcffReservation.clear()
                researchValuationScenarioWorkspace.fcffOwnerConfirmed = false
                researchValuationScenarioWorkspace.fcffMessage = "服务端明确拒绝了该保存请求；请重新读取来源并确认。\(fcffClientMessage(error))"
                return
            }
            researchValuationScenarioWorkspace.fcffMessage = "保存结果未确定；原请求及编号已保留，请点“核对上次保存”。\(fcffClientMessage(error))"
        }
    }

    func fcffClientMessage(_ error: Error) -> String {
        if case ResearchValuationScenarioClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "当前研究权限不可用。"
            case 404: return "研究成员或所选原始行不存在。"
            case 409: return "来源、成员版本或修订链已变化。"
            case 400, 422: return "来源、日期、预测、权益桥接或确认字段不完整。"
            default: return "现金流估值暂不可用。"
            }
        }
        return "现金流估值响应或网络暂不可用。"
    }
}

struct FcffYearDraft: Identifiable, Equatable {
    let id = UUID()
    var periodStart: String
    var periodEnd: String
    var ebit = ""
    var operatingTaxRate = ""
    var depreciationAmortization = ""
    var grossCapitalReinvestment = ""
    var increaseInNoncashWorkingCapital = ""

    func parsed() -> FcffForecastYear? {
        guard let ebit = Double(ebit), let tax = Double(operatingTaxRate),
              let da = Double(depreciationAmortization), let capex = Double(grossCapitalReinvestment),
              let wc = Double(increaseInNoncashWorkingCapital),
              [ebit, tax, da, capex, wc].allSatisfy(\.isFinite),
              (0...1).contains(tax), da >= 0, capex >= 0 else { return nil }
        return FcffForecastYear(periodStart: periodStart, periodEnd: periodEnd,
            paymentDate: periodEnd, ebit: ebit, operatingTaxRate: tax,
            depreciationAmortization: da, grossCapitalReinvestment: capex,
            increaseInNoncashWorkingCapital: wc)
    }
}

struct FcffDraft: Equatable {
    static let historicalMetrics: [String: String] = [
        "profitBeforeTax": "profit_before_tax", "netFinanceIncome": "net_finance_income",
        "associatesProfit": "associates_profit", "jointVenturesProfit": "joint_ventures_profit",
        "deemedDisposalGain": "deemed_disposal_gain", "depreciationAmortization": "depreciation_amortization",
        "propertyPlantEquipmentPurchases": "property_plant_equipment_purchases",
        "intangibleAssetPurchases": "intangible_asset_purchases", "landLeasePrepayments": "land_lease_prepayments"
    ]
    static let bridgeMetrics: [String: String] = [
        "cashAndEquivalents": "cash_and_cash_equivalents", "bankBorrowings": "bank_borrowings",
        "bondsCurrent": "bonds_current", "bondsNoncurrent": "bonds_noncurrent",
        "leaseCurrent": "lease_liabilities_current", "leaseNoncurrent": "lease_liabilities_noncurrent",
        "nciBookValue": "noncontrolling_interests", "issuedShares": "issued_shares",
        "treasuryShares": "treasury_shares"
    ]
    static let nonOperatingMetrics: Set<String> = ["restricted_deposits", "structured_deposits",
        "fvoci_financial_assets", "associate_investments", "joint_venture_investments", "joint_venture_loans"]
    static let otherClaimMetrics: Set<String> = ["derivative_liabilities", "nci_dividend_payable",
        "parent_dividend_payable"]
    static let workingCapitalAssetMetrics: Set<String> = ["trade_receivables", "inventories",
        "prepayments_and_other_operating_receivables"]
    static let workingCapitalLiabilityMetrics: Set<String> = ["trade_payables", "contract_liabilities",
        "accrued_operating_liabilities"]
    var historicalAnnualPeriodEnd = ""
    var balanceReferenceDate = ""
    var valuationCutoff = ""
    var currency = ""
    var historicalValueIds: [String: String?] = [:]
    var bridgeValueIds: [String: String?] = [:]
    var nonOperatingAssetValueIds: [String] = []
    var otherClaimValueIds: [String] = []
    var workingCapitalValueIds: [String: [String]] = [:]
    var forecast: [FcffYearDraft] = []
    var terminalNextYear = FcffYearDraft(periodStart: "", periodEnd: "")
    var wacc = ""; var terminalGrowthRate = ""; var waccStep = ""; var terminalGrowthStep = ""
    var cashSinceReferenceAdjustment = ""
    var minimumOperatingCash = ""
    var nonOperatingAssetAdjustment = ""
    var debtSinceReferenceAdjustment = ""
    var leaseSinceReferenceAdjustment = ""
    var nciFairValueAdjustment = ""
    var otherClaimsAdjustment = ""
    var ordinarySharesSinceReferenceAdjustment = ""
    var potentialDilutionShares = ""
    var cashReason = ""; var nonOperatingAssetsReason = ""; var debtReason = ""
    var leaseTreatmentReason = ""; var noncontrollingInterestReason = ""
    var otherClaimsReason = ""; var dilutedSharesReason = ""
    var balanceDateGapReason = ""; var historicalBasisReason = ""

    mutating func clearMonetaryInputs() {
        for index in forecast.indices {
            forecast[index].ebit = ""; forecast[index].depreciationAmortization = ""
            forecast[index].grossCapitalReinvestment = ""
            forecast[index].increaseInNoncashWorkingCapital = ""
        }
        terminalNextYear.ebit = ""; terminalNextYear.depreciationAmortization = ""
        terminalNextYear.grossCapitalReinvestment = ""
        terminalNextYear.increaseInNoncashWorkingCapital = ""
        cashSinceReferenceAdjustment = ""; minimumOperatingCash = ""
        nonOperatingAssetAdjustment = ""; debtSinceReferenceAdjustment = ""
        leaseSinceReferenceAdjustment = ""; nciFairValueAdjustment = ""
        otherClaimsAdjustment = ""
    }

    mutating func selectAvailableFacts(_ values: [ResearchFundamentalValueData]) {
        func unique(_ metric: String, _ date: String) -> String? {
            let matching = values.filter { $0.metric == metric && $0.periodEnd == date
                && $0.valueStatus == "reported" && $0.valueState == "current" }
            return matching.count == 1 ? matching[0].id : nil
        }
        historicalValueIds = Dictionary(uniqueKeysWithValues: Self.historicalMetrics.map {
            ($0.key, unique($0.value, historicalAnnualPeriodEnd) as String?) })
        bridgeValueIds = Dictionary(uniqueKeysWithValues: Self.bridgeMetrics.map {
            ($0.key, unique($0.value, balanceReferenceDate) as String?) })
        nonOperatingAssetValueIds = values.filter { Self.nonOperatingMetrics.contains($0.metric)
            && $0.periodEnd == balanceReferenceDate && $0.valueState == "current"
            && $0.valueStatus == "reported" }.map(\.id).sorted()
        otherClaimValueIds = values.filter { Self.otherClaimMetrics.contains($0.metric)
            && $0.periodEnd == balanceReferenceDate && $0.valueState == "current"
            && $0.valueStatus == "reported" }.map(\.id).sorted()
        let priorYear = (Int(historicalAnnualPeriodEnd.prefix(4)) ?? 1) - 1
        workingCapitalValueIds = Dictionary(uniqueKeysWithValues: [
            "currentAsset", "currentLiability", "priorAsset", "priorLiability"
        ].map { role in
            let date = role.hasPrefix("prior") ? "\(priorYear)-12-31" : historicalAnnualPeriodEnd
            let metrics = role.hasSuffix("Asset") ? Self.workingCapitalAssetMetrics
                : Self.workingCapitalLiabilityMetrics
            let candidates = values.filter { metrics.contains($0.metric) && $0.periodEnd == date
                && $0.periodKind == "instant" && $0.valueState == "current"
                && $0.valueStatus == "reported" }
            let counts = Dictionary(grouping: candidates, by: \.metric)
            return (role, candidates.filter { counts[$0.metric]?.count == 1 }.map(\.id).sorted())
        })
    }

    mutating func resetForecastPeriods() {
        guard let year = Int(valuationCutoff.prefix(4)), valuationCutoff.count == 10 else {
            forecast = []; terminalNextYear = FcffYearDraft(periodStart: "", periodEnd: ""); return
        }
        func next(_ date: String) -> String {
            let input = ISO8601DateFormatter(); input.formatOptions = [.withFullDate]
            let output = ISO8601DateFormatter(); output.formatOptions = [.withFullDate]
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            guard let parsed = input.date(from: date),
                  let nextDate = calendar.date(byAdding: .day, value: 1, to: parsed)
            else { return "" }
            return output.string(from: nextDate)
        }
        let firstStart = next(valuationCutoff)
        if firstStart.hasSuffix("-01-01") {
            forecast = [FcffYearDraft(periodStart: firstStart, periodEnd: "\(year + 1)-12-31")]
            terminalNextYear = FcffYearDraft(periodStart: "\(year + 2)-01-01", periodEnd: "\(year + 2)-12-31")
        } else {
            forecast = [FcffYearDraft(periodStart: firstStart, periodEnd: "\(year)-12-31"),
                FcffYearDraft(periodStart: "\(year + 1)-01-01", periodEnd: "\(year + 1)-12-31")]
            terminalNextYear = FcffYearDraft(periodStart: "\(year + 2)-01-01", periodEnd: "\(year + 2)-12-31")
        }
    }

    var selection: FcffSourceSelection? {
        guard historicalAnnualPeriodEnd.hasSuffix("-12-31"), !balanceReferenceDate.isEmpty,
              Set(historicalValueIds.keys) == Set(Self.historicalMetrics.keys),
              Set(bridgeValueIds.keys) == Set(Self.bridgeMetrics.keys),
              Set(workingCapitalValueIds.keys) == ["currentAsset", "currentLiability", "priorAsset", "priorLiability"]
        else { return nil }
        return FcffSourceSelection(historicalAnnualPeriodEnd: historicalAnnualPeriodEnd,
            balanceReferenceDate: balanceReferenceDate, historicalValueIds: historicalValueIds,
            workingCapitalValueIds: workingCapitalValueIds, bridgeValueIds: bridgeValueIds,
            nonOperatingAssetValueIds: nonOperatingAssetValueIds, otherClaimValueIds: otherClaimValueIds)
    }

    var classification: FcffBridgeClassification? {
        let numeric = [cashSinceReferenceAdjustment, minimumOperatingCash,
            nonOperatingAssetAdjustment, debtSinceReferenceAdjustment, leaseSinceReferenceAdjustment,
            nciFairValueAdjustment, otherClaimsAdjustment, ordinarySharesSinceReferenceAdjustment,
            potentialDilutionShares].compactMap(Double.init)
        let reasons = [cashReason, nonOperatingAssetsReason, debtReason, leaseTreatmentReason,
            noncontrollingInterestReason, otherClaimsReason, dilutedSharesReason,
            balanceDateGapReason, historicalBasisReason]
        guard numeric.count == 9, numeric.allSatisfy(\.isFinite),
              numeric[1] >= 0, numeric[8] >= 0,
              numeric[7].rounded() == numeric[7], numeric[8].rounded() == numeric[8],
              abs(numeric[7]) <= 9_007_199_254_740_991,
              numeric[8] <= 9_007_199_254_740_991,
              reasons.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8
                  && $0.count <= 500 })
        else { return nil }
        return FcffBridgeClassification(cashSinceReferenceAdjustment: numeric[0],
            minimumOperatingCash: numeric[1], nonOperatingAssetAdjustment: numeric[2],
            debtSinceReferenceAdjustment: numeric[3], leaseSinceReferenceAdjustment: numeric[4],
            nciFairValueAdjustment: numeric[5], otherClaimsAdjustment: numeric[6],
            ordinarySharesSinceReferenceAdjustment: numeric[7], potentialDilutionShares: numeric[8],
            cashReason: cashReason, nonOperatingAssetsReason: nonOperatingAssetsReason,
            debtReason: debtReason, leaseTreatmentReason: leaseTreatmentReason,
            noncontrollingInterestReason: noncontrollingInterestReason, otherClaimsReason: otherClaimsReason,
            dilutedSharesReason: dilutedSharesReason, balanceDateGapReason: balanceDateGapReason,
            historicalBasisReason: historicalBasisReason)
    }

    func assumptions(preview: FcffSourcePreview) -> FcffScenarioInput? {
        guard let reference = preview.bridgeReference, let classification,
              let currency = preview.currency, !valuationCutoff.isEmpty,
              preview.facts.allSatisfy({ fact in
                  guard let publishedDay = fcffPublishedHongKongDay(fact.publishedAt) else { return false }
                  return publishedDay <= valuationCutoff
              }),
              let wacc = Double(wacc), let growth = Double(terminalGrowthRate),
              let waccStep = Double(waccStep), let growthStep = Double(terminalGrowthStep),
              forecast.count == forecast.compactMap({ $0.parsed() }).count,
              let terminal = terminalNextYear.parsed() else { return nil }
        let bridge = FcffEquityBridge(
            excessCash: reference.cashAndEquivalents + classification.cashSinceReferenceAdjustment
                - classification.minimumOperatingCash,
            nonOperatingAssets: reference.nonOperatingAssets + classification.nonOperatingAssetAdjustment,
            interestBearingDebt: reference.interestBearingDebtExcludingLeases + classification.debtSinceReferenceAdjustment,
            leaseLiabilitiesNotInDebt: reference.leaseLiabilities + classification.leaseSinceReferenceAdjustment,
            noncontrollingInterests: reference.nciBookValue + classification.nciFairValueAdjustment,
            otherNonordinaryClaims: reference.otherClaims + classification.otherClaimsAdjustment,
            dilutedOrdinaryShares: reference.ordinaryShares + classification.ordinarySharesSinceReferenceAdjustment
                + classification.potentialDilutionShares)
        return FcffScenarioInput(currency: currency, historicalAnnualPeriodEnd: historicalAnnualPeriodEnd,
            balanceReferenceDate: balanceReferenceDate, valuationCutoff: valuationCutoff,
            forecast: forecast.compactMap({ $0.parsed() }), terminalNextYear: terminal,
            wacc: wacc, terminalGrowthRate: growth, waccStep: waccStep,
            terminalGrowthStep: growthStep, bridge: bridge)
    }

    func providerAssumptions(reference: FcffProviderReference,
                             bridge: FcffEquityBridge) -> FcffScenarioInput? {
        guard currency == reference.currency,
              historicalAnnualPeriodEnd == reference.balanceReferenceDate,
              balanceReferenceDate == reference.balanceReferenceDate,
              let capturedDay = fcffPublishedHongKongDay(reference.capturedAt),
              valuationCutoff >= capturedDay,
              reference.shareReferenceDate.map({ $0 <= valuationCutoff }) ?? true,
              reference.shareReference.map({ share in
                  [share.issuedPublishedAt, share.treasuryPublishedAt].allSatisfy { publishedAt in
                      guard let day = fcffPublishedHongKongDay(publishedAt) else { return false }
                      return day <= valuationCutoff
                  }
              }) ?? true,
              let wacc = Double(wacc), let growth = Double(terminalGrowthRate),
              let waccStep = Double(waccStep), let growthStep = Double(terminalGrowthStep),
              forecast.count == forecast.compactMap({ $0.parsed() }).count,
              let terminal = terminalNextYear.parsed() else { return nil }
        let input = FcffScenarioInput(currency: currency,
            historicalAnnualPeriodEnd: historicalAnnualPeriodEnd,
            balanceReferenceDate: balanceReferenceDate, valuationCutoff: valuationCutoff,
            forecast: forecast.compactMap({ $0.parsed() }), terminalNextYear: terminal,
            wacc: wacc, terminalGrowthRate: growth, waccStep: waccStep,
            terminalGrowthStep: growthStep, bridge: bridge)
        return calculateFcffScenarioPreview(input) == nil ? nil : input
    }

    mutating func fill(from scenario: ResearchFcffScenarioSetData) {
        let selection = scenario.sourceSelection
        historicalAnnualPeriodEnd = selection.historicalAnnualPeriodEnd
        balanceReferenceDate = selection.balanceReferenceDate
        valuationCutoff = scenario.assumptions.values.valuationCutoff
        currency = scenario.assumptions.values.currency
        historicalValueIds = selection.historicalValueIds
        bridgeValueIds = selection.bridgeValueIds
        nonOperatingAssetValueIds = selection.nonOperatingAssetValueIds
        otherClaimValueIds = selection.otherClaimValueIds
        workingCapitalValueIds = selection.workingCapitalValueIds
        func draft(_ period: FcffForecastYear) -> FcffYearDraft {
            var row = FcffYearDraft(periodStart: period.periodStart, periodEnd: period.periodEnd)
            row.ebit = String(period.ebit); row.operatingTaxRate = String(period.operatingTaxRate)
            row.depreciationAmortization = String(period.depreciationAmortization)
            row.grossCapitalReinvestment = String(period.grossCapitalReinvestment)
            row.increaseInNoncashWorkingCapital = String(period.increaseInNoncashWorkingCapital)
            return row
        }
        forecast = scenario.assumptions.values.forecast.map(draft)
        terminalNextYear = draft(scenario.assumptions.values.terminalNextYear)
        let input = scenario.assumptions.values
        wacc = String(input.wacc); terminalGrowthRate = String(input.terminalGrowthRate)
        waccStep = String(input.waccStep); terminalGrowthStep = String(input.terminalGrowthStep)
        let c = scenario.assumptions.bridgeClassification
        cashSinceReferenceAdjustment = String(c.cashSinceReferenceAdjustment)
        minimumOperatingCash = String(c.minimumOperatingCash)
        nonOperatingAssetAdjustment = String(c.nonOperatingAssetAdjustment)
        debtSinceReferenceAdjustment = String(c.debtSinceReferenceAdjustment)
        leaseSinceReferenceAdjustment = String(c.leaseSinceReferenceAdjustment)
        nciFairValueAdjustment = String(c.nciFairValueAdjustment)
        otherClaimsAdjustment = String(c.otherClaimsAdjustment)
        ordinarySharesSinceReferenceAdjustment = String(c.ordinarySharesSinceReferenceAdjustment)
        potentialDilutionShares = String(c.potentialDilutionShares)
        cashReason = c.cashReason; nonOperatingAssetsReason = c.nonOperatingAssetsReason
        debtReason = c.debtReason; leaseTreatmentReason = c.leaseTreatmentReason
        noncontrollingInterestReason = c.noncontrollingInterestReason
        otherClaimsReason = c.otherClaimsReason; dilutedSharesReason = c.dilutedSharesReason
        balanceDateGapReason = c.balanceDateGapReason; historicalBasisReason = c.historicalBasisReason
    }

    mutating func fill(from scenario: ResearchProviderFcffScenarioSetData) {
        let input = scenario.assumptions.values
        historicalAnnualPeriodEnd = input.historicalAnnualPeriodEnd
        balanceReferenceDate = input.balanceReferenceDate
        valuationCutoff = input.valuationCutoff; currency = input.currency
        func draft(_ year: FcffForecastYear) -> FcffYearDraft {
            var row = FcffYearDraft(periodStart: year.periodStart, periodEnd: year.periodEnd)
            row.ebit = String(year.ebit); row.operatingTaxRate = String(year.operatingTaxRate)
            row.depreciationAmortization = String(year.depreciationAmortization)
            row.grossCapitalReinvestment = String(year.grossCapitalReinvestment)
            row.increaseInNoncashWorkingCapital = String(year.increaseInNoncashWorkingCapital)
            return row
        }
        forecast = input.forecast.map(draft); terminalNextYear = draft(input.terminalNextYear)
        wacc = String(input.wacc); terminalGrowthRate = String(input.terminalGrowthRate)
        waccStep = String(input.waccStep); terminalGrowthStep = String(input.terminalGrowthStep)
    }
}

struct FcffProviderBridgeDraft: Equatable {
    var excessCash = ""; var nonOperatingAssets = ""; var interestBearingDebt = ""
    var leaseLiabilitiesNotInDebt = ""; var noncontrollingInterests = ""
    var otherNonordinaryClaims = ""; var dilutedOrdinaryShares = ""
    var reasons = FcffProviderBridgeReasons()
    var bridge: FcffEquityBridge? {
        let fields = [excessCash, nonOperatingAssets, interestBearingDebt,
            leaseLiabilitiesNotInDebt, noncontrollingInterests, otherNonordinaryClaims,
            dilutedOrdinaryShares]
        let values = fields.compactMap(Double.init)
        guard values.count == 7, values.allSatisfy({ $0.isFinite && $0 >= 0 }),
              values[6] > 0 && values[6].rounded() == values[6],
              values[6] <= 9_007_199_254_740_991, reasons.isComplete else { return nil }
        return FcffEquityBridge(excessCash: values[0], nonOperatingAssets: values[1],
            interestBearingDebt: values[2], leaseLiabilitiesNotInDebt: values[3],
            noncontrollingInterests: values[4], otherNonordinaryClaims: values[5],
            dilutedOrdinaryShares: values[6])
    }
    mutating func fill(from scenario: ResearchProviderFcffScenarioSetData) {
        let b = scenario.assumptions.values.bridge
        excessCash = String(b.excessCash); nonOperatingAssets = String(b.nonOperatingAssets)
        interestBearingDebt = String(b.interestBearingDebt)
        leaseLiabilitiesNotInDebt = String(b.leaseLiabilitiesNotInDebt)
        noncontrollingInterests = String(b.noncontrollingInterests)
        otherNonordinaryClaims = String(b.otherNonordinaryClaims)
        dilutedOrdinaryShares = String(b.dilutedOrdinaryShares)
        reasons = scenario.assumptions.bridgeReasons
    }
}

struct ResearchValuationScenarioWorkspaceState {
    var envelope: ResearchValuationScenariosEnvelope?
    var anchorValueId: String?
    var replacesScenarioSetId: String?
    var draft = ResearchValuationScenarioDraft()
    var ownerConfirmed = false
    var message = "请选择合格的当前基本面锚点并读取估值情景。"
    var requests = ResearchValuationScenarioRequestLanes()
    var reservation = ResearchDocumentIdempotencyReservation()
    var lastFreshScenarioSetId: String?
    var issuerBasisPreview: ResearchValuationIssuerBasisPreview?
    var issuerBasisLoading = false
    var issuerBasisRevision = UUID()
    var issuerBasisMessage = "可读取母公司净资产/普通股来源草稿；缺项会逐项显示。"
    var issuerBasisAdopted = false
    var ordinaryEquityOwnerConfirmed = false
    var issuerOverrideReason = ""
    var providerCaptures: [FutuValuationCapture] = []
    var providerValuationCaptureId = ""
    var providerPeriodEnd = ""
    var providerEpsBasis = "basic"
    var providerPreview: FutuProviderValuationPreview?
    var providerRevisionScenarioId: String?
    var providerDraft = ResearchValuationScenarioDraft()
    var providerOwnerConfirmed = false
    var providerMessage = "请先保存年度富途财报材料，再获取五年 PE/PB 原件。"
    var providerBusy = false
    var providerRevision = UUID()
    var providerReservation = ResearchDocumentIdempotencyReservation()
    var providerPendingSave: FutuProviderValuationPendingRequest?
    var providerPendingMembership: CandidateMembershipData?
    var providerHadSubmissionAttempt = false
    var fcffDraft = FcffDraft()
    var fcffPreview: FcffSourcePreview?
    var fcffOwnerConfirmed = false
    var fcffBusy = false
    var fcffMessage = "请选择年度原始财务行并核对来源。缺项会明确显示，系统不会补零。"
    var fcffRevision = UUID()
    var fcffReservation = ResearchDocumentIdempotencyReservation()
    var fcffPendingSave: CreateResearchFcffScenarioRequest?
    var fcffPendingMembership: CandidateMembershipData?
    var fcffHadSubmissionAttempt = false
    var fcffReplacesId: String?
    var fcffProviderCaptures: [FutuFinancialCapture] = []
    var fcffProviderCaptureId = ""
    var fcffProviderPeriodEnd = ""
    var fcffProviderPreview: FutuFinancialMaterialPreview?
    var fcffProviderMaterial: ResearchMaterialData?
    var fcffProviderMaterialId = ""
    var fcffProviderLookupRevision = UUID()
    var fcffProviderLookupBusy = false
    var fcffProviderLookupMessage = "读取已存年度捕获后，选择报告日与有效材料。"
    var fcffProviderShareDate: String? = nil
    var fcffProviderReference: FcffProviderReference?
    var fcffProviderBridge = FcffProviderBridgeDraft()
    var fcffProviderReplacesId: String?
    var fcffProviderPendingSave: CreateResearchProviderFcffScenarioRequest?
    var fcffProviderPendingMembership: CandidateMembershipData?
    var fcffProviderHadSubmissionAttempt = false
    var fcffProviderOwnerConfirmed = false
    var fcffProviderReservation = ResearchDocumentIdempotencyReservation()
    var fcffProviderMessage = "选择已保存的 OpenD 年度材料，读取未核实余额参考。"

    var isLoading: Bool { requests.isLoading }
    var isSaving: Bool { requests.isSaving }
    var isBusy: Bool { requests.isBusy }

    mutating func clearForIdentityChange() {
        envelope = nil
        anchorValueId = nil
        replacesScenarioSetId = nil
        draft = ResearchValuationScenarioDraft()
        ownerConfirmed = false
        message = "正在 fresh read 带引用的估值情景..."
        requests.reset()
        reservation.clear()
        lastFreshScenarioSetId = nil
        resetIssuerBasis()
        providerCaptures = []
        providerValuationCaptureId = ""
        providerPeriodEnd = ""
        providerPreview = nil
        providerRevisionScenarioId = nil
        providerDraft = ResearchValuationScenarioDraft()
        providerOwnerConfirmed = false
        if providerPendingSave == nil { providerBusy = false }
        providerRevision = UUID()
        if providerPendingSave == nil { providerReservation.clear() }
        if providerPendingSave == nil { providerHadSubmissionAttempt = false }
        fcffDraft = FcffDraft()
        fcffPreview = nil
        fcffOwnerConfirmed = false
        if fcffPendingSave == nil { fcffBusy = false }
        fcffMessage = "请选择年度原始财务行并核对来源。缺项会明确显示，系统不会补零。"
        fcffRevision = UUID()
        if fcffPendingSave == nil { fcffReservation.clear() }
        if fcffPendingSave == nil { fcffHadSubmissionAttempt = false }
        fcffReplacesId = nil
        fcffProviderLookupRevision = UUID(); fcffProviderLookupBusy = false
        fcffProviderCaptures = []; fcffProviderCaptureId = ""; fcffProviderPeriodEnd = ""
        fcffProviderPreview = nil; fcffProviderMaterial = nil
        fcffProviderLookupMessage = "读取已存年度捕获后，选择报告日与有效材料。"
        fcffProviderMaterialId = ""; fcffProviderShareDate = nil
        fcffProviderReference = nil; fcffProviderBridge = FcffProviderBridgeDraft()
        fcffProviderReplacesId = nil; fcffProviderOwnerConfirmed = false
        fcffProviderMessage = "选择已保存的 OpenD 年度材料，读取未核实余额参考。"
        if fcffProviderPendingSave == nil { fcffProviderPendingMembership = nil
            fcffProviderHadSubmissionAttempt = false; fcffProviderReservation.clear() }
    }

    mutating func clearFreshSuccess() {
        envelope = nil
        lastFreshScenarioSetId = nil
    }

    mutating func resetConfirmation() {
        ownerConfirmed = false
        reservation.clear()
    }

    mutating func resetIssuerBasis() {
        stopUsingIssuerBasis()
        issuerBasisPreview = nil
        issuerBasisLoading = false
        issuerBasisRevision = UUID()
        issuerBasisMessage = "可读取母公司净资产/普通股来源草稿；缺项会逐项显示。"
    }

    mutating func stopUsingIssuerBasis() {
        if issuerBasisAdopted { draft.baseMetricPerShare = "" }
        issuerBasisAdopted = false
        ordinaryEquityOwnerConfirmed = false
        issuerOverrideReason = ""
        resetConfirmation()
    }
}

extension GateBResearchScreen {
    @MainActor
    func loadIssuerNavBasisPreview() async {
        guard let membership = selectedMembership,
              let anchorId = researchValuationScenarioWorkspace.anchorValueId,
              researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.stopUsingIssuerBasis()
        researchValuationScenarioWorkspace.issuerBasisRevision = revision
        researchValuationScenarioWorkspace.issuerBasisLoading = true
        researchValuationScenarioWorkspace.issuerBasisPreview = nil
        defer { if researchValuationScenarioWorkspace.issuerBasisRevision == revision {
            researchValuationScenarioWorkspace.issuerBasisLoading = false
        } }
        do {
            let preview = try await client.fetchResearchValuationIssuerBasis(
                membership: membership, anchorValueId: anchorId)
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  researchValuationScenarioWorkspace.anchorValueId == anchorId,
                  researchValuationScenarioWorkspace.issuerBasisRevision == revision else { return }
            researchValuationScenarioWorkspace.issuerBasisPreview = preview
            researchValuationScenarioWorkspace.issuerBasisMessage = preview.status == "available"
                ? "来源草稿已核对；请打开原件，核对普通股权益归属后再采用。"
                : "暂不能形成每股草稿：\(preview.missingInputs.map(researchValuationIssuerBasisMissingText).joined(separator: "；"))"
        } catch {
            if researchValuationScenarioWorkspace.issuerBasisRevision == revision {
                researchValuationScenarioWorkspace.issuerBasisMessage = researchValuationScenarioClientMessage(error)
            }
        }
    }

    @MainActor
    func adoptIssuerNavBasis() {
        guard let preview = researchValuationScenarioWorkspace.issuerBasisPreview,
              preview.status == "available", researchValuationScenarioWorkspace.ordinaryEquityOwnerConfirmed,
              let proposed = preview.proposedBaseMetricPerShare,
              let currency = preview.currency else { return }
        researchValuationScenarioWorkspace.draft.metricCurrency = currency
        researchValuationScenarioWorkspace.draft.shareBasis = "basic"
        researchValuationScenarioWorkspace.draft.baseMetricPerShare = String(proposed)
        researchValuationScenarioWorkspace.draft.netCashPerShare = "0"
        researchValuationScenarioWorkspace.issuerBasisAdopted = true
        researchValuationScenarioWorkspace.issuerOverrideReason = ""
        researchValuationScenarioWorkspace.resetConfirmation()
        researchValuationScenarioWorkspace.message = "已将有来源的 NAV/股草稿填入；其余增长、实现率与折现参数仍由你编辑并确认。"
    }
    @MainActor
    func loadFutuValuationCaptures() async {
        guard let membership = selectedMembership else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.providerRevision = revision
        researchValuationScenarioWorkspace.providerBusy = true
        researchValuationScenarioWorkspace.providerCaptures = []
        defer { if researchValuationScenarioWorkspace.providerRevision == revision {
            researchValuationScenarioWorkspace.providerBusy = false
        }}
        do {
            let captures = try await client.listFutuValuationCaptures(membership: membership)
            guard researchValuationScenarioWorkspace.providerRevision == revision,
                selectedMembership?.id == membership.id, selectedMembership?.version == membership.version else { return }
            researchValuationScenarioWorkspace.providerCaptures = captures
            researchValuationScenarioWorkspace.providerMessage = "已读回 \(captures.count) 项五年 PE/PB 原件；请选择 PE 建立研究情景。"
        } catch {
            researchValuationScenarioWorkspace.providerMessage = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    func captureFutuValuation(_ type: String) async {
        guard let membership = selectedMembership, ["PE", "PB"].contains(type) else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.providerRevision = revision
        researchValuationScenarioWorkspace.providerBusy = true
        defer { if researchValuationScenarioWorkspace.providerRevision == revision {
            researchValuationScenarioWorkspace.providerBusy = false
        }}
        do {
            let key = researchValuationScenarioWorkspace.providerReservation.reserve(
                for: "\(membership.id)|\(membership.version)|\(type)", prefix: "ios-futu-valuation")
            let saved = try await client.captureFutuValuation(membership: membership, type: type, key: key)
            guard researchValuationScenarioWorkspace.providerRevision == revision,
                selectedMembership?.id == membership.id, selectedMembership?.version == membership.version else { return }
            researchValuationScenarioWorkspace.providerReservation.clear()
            let captures = try await client.listFutuValuationCaptures(membership: membership)
            researchValuationScenarioWorkspace.providerCaptures = captures
            if type == "PE" {
                researchValuationScenarioWorkspace.providerValuationCaptureId = saved.id
                researchValuationScenarioWorkspace.providerPreview = nil
                researchValuationScenarioWorkspace.providerRevisionScenarioId = nil
                researchValuationScenarioWorkspace.providerOwnerConfirmed = false
            }
            researchValuationScenarioWorkspace.providerMessage = "\(type) 五年历史已保存并读回；来源原件 \(saved.rawSha256.prefix(12))…。"
        } catch {
            researchValuationScenarioWorkspace.providerMessage = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    func previewFutuProviderValuation() async {
        guard let membership = selectedMembership,
            let financial = futuFinancialWorkspace.current,
            financial.periodSelection == "annual", financial.membershipVersion == membership.version,
            let material = futuFinancialWorkspace.savedMaterial,
            material.futuFinancialSource?.captureId == financial.id,
            !researchValuationScenarioWorkspace.providerPeriodEnd.isEmpty,
            let valuation = researchValuationScenarioWorkspace.providerCaptures.first(where: {
                $0.id == researchValuationScenarioWorkspace.providerValuationCaptureId
                    && $0.valuationType == "PE" && $0.originalAvailability == "available"
                    && $0.membershipVersion == membership.version
            }) else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.providerRevision = revision
        researchValuationScenarioWorkspace.providerBusy = true
        if researchValuationScenarioWorkspace.providerPendingSave == nil {
            researchValuationScenarioWorkspace.providerPreview = nil
            researchValuationScenarioWorkspace.providerRevisionScenarioId = nil
            researchValuationScenarioWorkspace.providerOwnerConfirmed = false
            researchValuationScenarioWorkspace.providerReservation.clear()
        }
        defer { if researchValuationScenarioWorkspace.providerRevision == revision {
            researchValuationScenarioWorkspace.providerBusy = false
        }}
        do {
            let preview = try await client.previewFutuProviderValuation(membership: membership,
                financialCaptureId: financial.id,
                annualPeriodEnd: researchValuationScenarioWorkspace.providerPeriodEnd,
                epsBasis: researchValuationScenarioWorkspace.providerEpsBasis,
                valuationCaptureId: valuation.id, sourceMaterialId: material.id)
            guard researchValuationScenarioWorkspace.providerRevision == revision,
                selectedMembership?.id == membership.id, selectedMembership?.version == membership.version else { return }
            if let pending = researchValuationScenarioWorkspace.providerPendingSave,
                let currentAssumptions = researchValuationScenarioWorkspace.providerDraft.parsed(),
                pending.matches(membershipId: membership.id, membershipVersion: membership.version,
                    symbol: membership.symbol, preview: preview, assumptions: currentAssumptions) {
                researchValuationScenarioWorkspace.providerPreview = preview
                researchValuationScenarioWorkspace.providerMessage =
                    "上次保存结果尚未确认；来源核对一致。点击“核对上次保存”继续核对，不会重复新增记录。"
                return
            }
            researchValuationScenarioWorkspace.providerRevisionScenarioId = nil
            researchValuationScenarioWorkspace.providerOwnerConfirmed = false
            researchValuationScenarioWorkspace.providerPreview = preview
            researchValuationScenarioWorkspace.providerDraft = ResearchValuationScenarioDraft()
            researchValuationScenarioWorkspace.providerDraft.metricCurrency = preview.proposed.metricCurrency
            researchValuationScenarioWorkspace.providerDraft.baseMetricPerShare = String(preview.proposed.baseMetricPerShare)
            researchValuationScenarioWorkspace.providerDraft.terminalMultiple = String(preview.proposed.terminalMultipleReference)
            researchValuationScenarioWorkspace.providerMessage = "已从保存原件读取 EPS 与五年 PE；增长、年限、折现及其他假设仍需你填写。"
        } catch {
            researchValuationScenarioWorkspace.providerMessage = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    func prepareFutuProviderValuationRevision(_ scenario: ResearchProviderValuationScenarioSetData) async {
        guard let membership = selectedMembership, scenario.recomputable,
            scenario.scenarioState == "current", scenario.validates(membership: membership),
            researchValuationScenarioWorkspace.providerPendingSave == nil else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.providerRevision = revision
        researchValuationScenarioWorkspace.providerBusy = true
        researchValuationScenarioWorkspace.providerPreview = nil
        researchValuationScenarioWorkspace.providerRevisionScenarioId = nil
        researchValuationScenarioWorkspace.providerOwnerConfirmed = false
        researchValuationScenarioWorkspace.providerReservation.clear()
        defer { if researchValuationScenarioWorkspace.providerRevision == revision {
            researchValuationScenarioWorkspace.providerBusy = false
        }}
        do {
            let source = scenario.providerBasis
            let preview = try await client.previewFutuProviderValuation(membership: membership,
                financialCaptureId: source.eps.financialCaptureId,
                annualPeriodEnd: source.eps.periodEnd, epsBasis: source.eps.basis,
                valuationCaptureId: source.valuation.captureId,
                sourceMaterialId: source.sourceMaterialId)
            guard researchValuationScenarioWorkspace.providerRevision == revision,
                selectedMembership?.id == membership.id, selectedMembership?.version == membership.version else { return }
            guard preview.basis == source else {
                researchValuationScenarioWorkspace.providerMessage = "保存的来源依据已变化；请刷新后重新选择当前情景。"
                return
            }
            researchValuationScenarioWorkspace.providerPreview = preview
            researchValuationScenarioWorkspace.providerRevisionScenarioId = scenario.id
            researchValuationScenarioWorkspace.providerDraft.fill(from: scenario.assumptions.values)
            researchValuationScenarioWorkspace.providerMessage =
                "已从保存原件读回情景 #\(scenario.id) 修订起点；请修改假设并重新确认。"
        } catch {
            researchValuationScenarioWorkspace.providerMessage = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    func saveFutuProviderValuation() async {
        guard !researchValuationScenarioWorkspace.providerBusy else { return }
        if let pending = researchValuationScenarioWorkspace.providerPendingSave,
           let pendingMembership = researchValuationScenarioWorkspace.providerPendingMembership {
            await submitFutuProviderValuation(pending, membership: pendingMembership)
            return
        }
        guard let membership = selectedMembership,
            let preview = researchValuationScenarioWorkspace.providerPreview,
            let assumptions = researchValuationScenarioWorkspace.providerDraft.parsed(),
            researchValuationScenarioWorkspace.providerOwnerConfirmed,
            assumptions.methodId == preview.methodId,
            assumptions.metricCurrency == preview.proposed.metricCurrency else { return }
        let revision = UUID()
        researchValuationScenarioWorkspace.providerRevision = revision
        researchValuationScenarioWorkspace.providerBusy = true
        defer { if researchValuationScenarioWorkspace.providerRevision == revision {
            researchValuationScenarioWorkspace.providerBusy = false
        }}
        do {
            let current = try await client.fetchResearchValuationScenarios(membership: membership)
            guard researchValuationScenarioWorkspace.providerRevision == revision,
                selectedMembership?.id == membership.id, selectedMembership?.version == membership.version else { return }
            let previous = try currentFutuProviderValuationScenario(
                basis: preview.basis,
                scenarios: current.providerScenarioSets ?? [],
                expectedId: researchValuationScenarioWorkspace.providerRevisionScenarioId)
            let key = researchValuationScenarioWorkspace.providerReservation.reserve(
                for: "\(membership.id)|\(preview.sourceFingerprint)|\(previous?.id ?? "root")|\(assumptions)",
                prefix: "ios-provider-scenario")
            let body = CreateFutuProviderValuationScenarioRequest(membershipVersion: membership.version,
                symbol: membership.symbol, financialCaptureId: preview.basis.eps.financialCaptureId,
                annualPeriodEnd: preview.basis.eps.periodEnd, epsBasis: preview.basis.eps.basis,
                valuationCaptureId: preview.basis.valuation.captureId,
                sourceMaterialId: preview.basis.sourceMaterialId, proposalFingerprint: preview.sourceFingerprint,
                replacesScenarioSetId: previous?.id, assumptions: assumptions,
                ownerConfirmed: true, idempotencyKey: key)
            let attempt = FutuProviderValuationPendingRequest(membershipId: membership.id, body: body)
            researchValuationScenarioWorkspace.providerPendingSave = attempt
            researchValuationScenarioWorkspace.providerPendingMembership = membership
            researchValuationScenarioWorkspace.providerHadSubmissionAttempt = false
            researchValuationScenarioWorkspace.providerBusy = false
            await submitFutuProviderValuation(attempt, membership: membership)
        } catch {
            researchValuationScenarioWorkspace.providerMessage = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    private func submitFutuProviderValuation(_ pending: FutuProviderValuationPendingRequest,
                                             membership: CandidateMembershipData) async {
        researchValuationScenarioWorkspace.providerBusy = true
        defer { researchValuationScenarioWorkspace.providerBusy = false }
        let priorAttempt = researchValuationScenarioWorkspace.providerHadSubmissionAttempt
        researchValuationScenarioWorkspace.providerHadSubmissionAttempt = true
        do {
            let currentMember = selectedMembership?.id == membership.id ? selectedMembership : nil
            let fresh = try await client.saveFutuProviderValuationAndReadBack(membership: membership,
                body: pending.body, readbackMembership: currentMember)
            if selectedMembership?.id == membership.id
                && selectedMembership?.version == fresh.membershipVersion {
                researchValuationScenarioWorkspace.envelope = fresh
            }
            researchValuationScenarioWorkspace.providerRevisionScenarioId = nil
            researchValuationScenarioWorkspace.providerOwnerConfirmed = false
            researchValuationScenarioWorkspace.providerReservation.clear()
            researchValuationScenarioWorkspace.providerPendingSave = nil
            researchValuationScenarioWorkspace.providerPendingMembership = nil
            researchValuationScenarioWorkspace.providerHadSubmissionAttempt = false
            researchValuationScenarioWorkspace.providerMessage = fresh.membershipVersion != membership.version
                ? "原请求已在当前成员版本中读回；旧版估值保留为历史，请重新准备当前来源。"
                : pending.body.replacesScenarioSetId == nil
                    ? "提供商来源估值情景已首次保存并读回。可在有限研究中明确选用。"
                    : "提供商来源估值情景修订已保存并读回；旧版本保留为历史。"
        } catch {
            if let saveError = error as? FutuProviderValuationSaveError,
               saveError.confirmsNoWrite(priorAttempt: priorAttempt) {
                researchValuationScenarioWorkspace.providerPendingSave = nil
                researchValuationScenarioWorkspace.providerPendingMembership = nil
                researchValuationScenarioWorkspace.providerHadSubmissionAttempt = false
                researchValuationScenarioWorkspace.providerReservation.clear()
                researchValuationScenarioWorkspace.providerOwnerConfirmed = false
                researchValuationScenarioWorkspace.providerMessage =
                    "首次保存请求被服务端明确拒绝，未形成记录；请重新读取来源并确认。"
                return
            }
            let detail: String
            if case ResearchValuationScenarioClientError.httpStatus(let status) = error {
                detail = "读回返回 HTTP \(status)。"
            } else {
                detail = researchValuationScenarioClientMessage(error)
            }
            researchValuationScenarioWorkspace.providerMessage =
                "保存结果尚未确认；原请求及编号已保留，请点“核对上次保存”。\(detail)"
        }
    }

    var currentValuationAnchors: [ResearchFundamentalValueData] {
        currentValuationAnchors(for: researchValuationScenarioWorkspace.draft.methodId)
    }

    func currentValuationAnchors(for methodId: String) -> [ResearchFundamentalValueData] {
        guard let fundamentals = researchFundamentalWorkspace.envelope else { return [] }
        return currentResearchValuationAnchors(
            values: fundamentals.values,
            serverAsOf: fundamentals.generatedAt,
            methodId: methodId,
            expectedMembershipVersion: fundamentals.membershipVersion,
            expectedSymbol: fundamentals.symbol
        )
    }

    @MainActor
    func loadResearchValuationScenarios() async {
        researchValuationScenarioWorkspace.clearFreshSuccess()
        guard let membership = selectedMembership else {
            researchValuationScenarioWorkspace.message = "请选择当前研究自选后读取估值情景。"
            return
        }
        let revision = researchValuationScenarioWorkspace.requests.beginLoad()
        defer {
            researchValuationScenarioWorkspace.requests.finishLoad(revision)
        }
        do {
            let envelope = try await client.fetchResearchValuationScenarios(membership: membership)
            guard researchValuationScenarioWorkspace.requests.acceptsLoad(revision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            researchValuationScenarioWorkspace.envelope = envelope
            synchronizeFrozenResearchBinding(
                "当前估值情景或来源已变化；旧冻结展示与确认已清除。"
            )
            if let selected = researchValuationScenarioWorkspace.anchorValueId,
               !currentValuationAnchors.contains(where: { $0.id == selected }) {
                researchValuationScenarioWorkspace.anchorValueId = nil
                researchValuationScenarioWorkspace.replacesScenarioSetId = nil
                researchValuationScenarioWorkspace.resetIssuerBasis()
                researchValuationScenarioWorkspace.resetConfirmation()
            }
            researchValuationScenarioWorkspace.message = envelope.scenarioSets.isEmpty
                ? "尚无估值情景；估值币种和 8 项数值参数都必须由你明确输入。"
                : "已重新读取 \(envelope.scenarioSets.count) 组可追溯估值情景。"
        } catch {
            guard researchValuationScenarioWorkspace.requests.acceptsLoad(revision) else { return }
            researchValuationScenarioWorkspace.message = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    func saveResearchValuationScenario() async {
        guard let membership = selectedMembership,
              let anchorValueId = researchValuationScenarioWorkspace.anchorValueId,
              currentValuationAnchors.contains(where: {
                  $0.id == anchorValueId
                      && $0.currency == researchValuationScenarioWorkspace.draft.metricCurrency
              }),
              (currentValuationAnchors.first(where: { $0.id == anchorValueId })?.metric
                != "profit_attributable_to_owners"
                || Double(researchValuationScenarioWorkspace.draft.netCashPerShare) == 0),
              let assumptions = researchValuationScenarioWorkspace.draft.parsed(requireShareBasis: true),
              researchValuationScenarioWorkspace.ownerConfirmed else { return }
        let issuerBasis = researchValuationScenarioWorkspace.issuerBasisAdopted
            ? researchValuationScenarioWorkspace.issuerBasisPreview.flatMap {
                ResearchValuationIssuerBasisBinding(preview: $0,
                    adoptedValue: assumptions.baseMetricPerShare,
                    overrideReason: researchValuationScenarioWorkspace.issuerOverrideReason,
                    ordinaryEquityOwnerConfirmed: researchValuationScenarioWorkspace.ordinaryEquityOwnerConfirmed)
            } : nil
        if researchValuationScenarioWorkspace.issuerBasisAdopted
            && (issuerBasis == nil || assumptions.netCashPerShare != 0
                || assumptions.shareBasis != "basic") { return }
        let fingerprint = [
            membership.id,
            String(membership.version),
            membership.symbol,
            anchorValueId,
            researchValuationScenarioWorkspace.replacesScenarioSetId ?? "",
            assumptions.methodId ?? "discounted_forward_metric_multiple_user_scenario",
            assumptions.metricCurrency ?? "",
            assumptions.shareBasis ?? "",
            String(assumptions.baseMetricPerShare),
            String(assumptions.annualGrowthRate),
            String(assumptions.horizonYears),
            String(assumptions.terminalMultiple),
            String(assumptions.annualDiscountRate),
            String(assumptions.netCashPerShare),
            String(assumptions.growthRateStep),
            String(assumptions.multipleStep),
            issuerBasis?.sourceFingerprint ?? "manual",
            issuerBasis?.adoptionMode ?? "manual",
            issuerBasis?.ownerOverrideReason ?? ""
        ].joined(separator: "|")
        let key = researchValuationScenarioWorkspace.reservation.reserve(
            for: fingerprint,
            prefix: "ios-valuation-scenario"
        )
        let request = CreateResearchValuationScenarioRequest(
            membershipVersion: membership.version,
            symbol: membership.symbol,
            anchorValueId: anchorValueId,
            replacesScenarioSetId: researchValuationScenarioWorkspace.replacesScenarioSetId,
            assumptions: assumptions,
            ownerConfirmed: true,
            idempotencyKey: key,
            issuerBasis: issuerBasis
        )
        let revision = researchValuationScenarioWorkspace.requests.beginSave()
        researchValuationScenarioWorkspace.clearFreshSuccess()
        defer {
            researchValuationScenarioWorkspace.requests.finishSave(revision)
        }
        do {
            let fresh = try await client.createResearchValuationScenarioAndReadBack(
                membership: membership,
                requestBody: request
            )
            guard researchValuationScenarioWorkspace.requests.acceptsSave(revision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  let saved = fresh.scenarioSets.first(where: {
                      $0.anchor.id == anchorValueId
                          && $0.assumptions.values == assumptions
                          && $0.replacesScenarioSetId == request.replacesScenarioSetId
                  }) else { return }
            researchValuationScenarioWorkspace.envelope = fresh
            if !saved.recomputable {
                researchValuationScenarioWorkspace.ownerConfirmed = false
                researchValuationScenarioWorkspace.message =
                    "原确认请求已找到并读回，但该估值情景当前不可重算；请核对原件与失效原因后重新确认。"
                return
            }
            researchValuationScenarioWorkspace.lastFreshScenarioSetId = saved.id
            researchValuationScenarioWorkspace.replacesScenarioSetId = nil
            researchValuationScenarioWorkspace.ownerConfirmed = false
            researchValuationScenarioWorkspace.reservation.clear()
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "新估值情景已保存；旧冻结展示与确认已清除。"
            )
            invalidateTwoLayerReport("新估值情景已保存；旧研究报告状态已清除。")
            synchronizeFrozenResearchBinding(
                "新估值情景已经生效；请重新读取并确认冻结绑定。"
            )
            researchValuationScenarioWorkspace.message =
                "估值情景已保存；下一步核对事件、风险与真实日线。"
            await loadFrozenResearchEvidence()
            selectedEvidenceWorkspace = .frozen
            let needsEvent = frozenResearchEvidenceWorkspace.envelope?.data?.events.isEmpty != false
            isResearchEventCaptureExpanded = needsEvent
            pendingDecisionWorkspaceScrollTarget = needsEvent
                ? "researchAnnouncementEvents"
                : "freezeResearchEvidenceButton"
        } catch {
            guard researchValuationScenarioWorkspace.requests.acceptsSave(revision) else { return }
            researchValuationScenarioWorkspace.message = researchValuationScenarioClientMessage(error)
        }
    }

    @MainActor
    func prepareResearchValuationRevision(_ scenario: ResearchValuationScenarioSetData) {
        guard canReviseResearchValuationScenario(scenario),
              currentValuationAnchors(for: scenario.calculation.method.id)
                .contains(where: { $0.id == scenario.anchor.id }) else { return }
        researchValuationScenarioWorkspace.anchorValueId = scenario.anchor.id
        researchValuationScenarioWorkspace.replacesScenarioSetId = scenario.id
        researchValuationScenarioWorkspace.resetIssuerBasis()
        researchValuationScenarioWorkspace.draft.fill(from: scenario.assumptions.values)
        let mustReenter = researchValuationScenarioWorkspace.draft.bindCurrency(scenario.anchor.currency)
        if scenario.calculation.issuerBasis != nil {
            researchValuationScenarioWorkspace.draft.baseMetricPerShare = ""
        }
        researchValuationScenarioWorkspace.resetConfirmation()
        researchValuationScenarioWorkspace.message = scenario.calculation.issuerBasis != nil
            ? "已载入来源绑定情景 #\(scenario.id) 的其余参数；基础净资产/股已清空。请重新核对并采用当前来源草稿，或明确手填后再保存修订。旧记录保持原样。"
            : mustReenter
            ? "旧情景 #\(scenario.id) 的币种为 \(scenario.assumptions.values.metricCurrency ?? "未知")，引用币种为 \(scenario.anchor.currency)。修订草稿已清空基础每股金额与每股净现金/调整额；未做换汇，请按 \(scenario.anchor.currency) 重新填写。旧记录保持原样。"
            : "已载入情景 #\(scenario.id) 作为修订起点；请核对方法、估值币种、每股口径和 8 项数值假设。"
    }

    func canReviseResearchValuationScenario(_ scenario: ResearchValuationScenarioSetData) -> Bool {
        if scenario.recomputable { return true }
        return scenario.scenarioState == "current"
            && scenario.calculation.method.id == "adjusted_net_asset_value_user_scenario"
            && scenario.invalidatedBy.count == 1
            && ["nav_pair_unbound", "nav_pair_unavailable"].contains(scenario.invalidatedBy[0])
    }

    @MainActor
    func openResearchValuationSource(_ anchor: ResearchValuationAnchorData) async {
        if anchor.source.kind == "source_snapshot" {
            guard let citation = anchor.source.snapshotCitation,
                  let original = anchor.source.snapshotOriginal,
                  await openStoredSourceCitation(citation, original: original) else {
                researchValuationScenarioWorkspace.message = "已存原件或选段不可用；未打开旧引用。"
                return
            }
            return
        }
        guard let list = researchDocumentWorkspace.list,
              let material = list.materials.first(where: {
                  $0.id == anchor.source.materialId
                      && $0.revision == anchor.source.materialRevision
                      && $0.sourceVersion == anchor.source.materialSourceVersion
                      && $0.citation?.documentId == anchor.source.documentId
                      && $0.citation?.pageNumber == anchor.source.pageNumber
                      && $0.citation?.pageTextSha256 == anchor.source.pageTextSha256
              }),
              let document = list.documents.first(where: {
                  $0.id == anchor.source.documentId
                      && $0.pdfSha256 == anchor.source.documentPdfSha256
              }) else {
            researchValuationScenarioWorkspace.message =
                "当前 fresh PDF 列表无法精确匹配文档、页码与 hash；未打开旧缓存。"
            return
        }
        researchDocumentWorkspace.selectedDocumentId = document.id
        await openPersistedResearchDocumentCitation(document: document, material: material)
    }

    func researchValuationScenarioClientMessage(_ error: Error) -> String {
        if case FutuProviderValuationSaveError.postRejected(let status) = error {
            return "原请求重放收到 HTTP \(status)，先前写入结果仍未确认。"
        }
        if case ResearchValuationScenarioClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "未认证或缺少 research_write；旧估值成功态已清除。"
            case 404: return "membership 或基本面锚点不存在；旧估值成功态已清除。"
            case 409: return "成员、版本、依据或修订状态已变化；请刷新后重试。"
            case 400, 422: return "估值方法、币种、8 项数值 assumptions、身份或确认字段无效。"
            default: return "估值情景数据库不可用；未显示旧成功。"
            }
        }
        return "估值情景响应无效或网络不可用；未显示旧成功。"
    }
}
