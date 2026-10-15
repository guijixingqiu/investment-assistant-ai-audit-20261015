import Foundation

extension GateBResearchScreen {
    @MainActor
    func synchronizeMarketTechnicalEnvelope(_ incoming: MarketDailyTechnicalEnvelope?) {
        guard let incoming,
              let canonical = parsedSymbol?.canonical,
              incoming.isBound(to: canonical) else { return }
        researchTechnicalRequestLane.reset()
        researchMarketTechnicalEnvelope = incoming
        synchronizeFrozenResearchBinding(
            "市场日线状态已变化；研究页已采用同一快照和计算结果，旧异步结果与确认已清除。"
        )
    }

    var latestCurrentFrozenResearchScenario: ResearchValuationScenarioSetData? {
        researchValuationScenarioWorkspace.envelope?.scenarioSets
            .filter {
                $0.scenarioState == "current"
                    && $0.recomputable
                    && $0.invalidatedBy.isEmpty
            }
            .sorted {
                if $0.createdAt != $1.createdAt { return $0.createdAt > $1.createdAt }
                return (Int($0.id) ?? 0) > (Int($1.id) ?? 0)
            }
            .first
    }

    var latestCurrentFrozenResearchValuationMethods: [ResearchValuationScenarioSetData] {
        let current = researchValuationScenarioWorkspace.envelope?.scenarioSets
            .filter {
                $0.scenarioState == "current"
                    && $0.recomputable
                    && $0.invalidatedBy.isEmpty
            }
            .sorted {
                if $0.createdAt != $1.createdAt { return $0.createdAt > $1.createdAt }
                return (Int($0.id) ?? 0) > (Int($1.id) ?? 0)
            } ?? []
        var byMethod: [String: ResearchValuationScenarioSetData] = [:]
        for scenario in current where byMethod[scenario.calculation.method.id] == nil {
            byMethod[scenario.calculation.method.id] = scenario
        }
        let selected = byMethod.values.sorted { $0.calculation.method.id < $1.calculation.method.id }
        return latestCurrentFrozenResearchFcffScenario == nil ? selected
            : latestCurrentFrozenResearchScenario.map { [$0] } ?? []
    }

    var latestCurrentFrozenResearchFcffScenario: ResearchFcffScenarioSetData? {
        researchValuationScenarioWorkspace.envelope?.fcffScenarioSets?
            .filter { $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty }
            .sorted { $0.createdAt > $1.createdAt }.first
    }

    var currentExpectedFrozenQuantPortfolioIdentity: ExpectedFrozenQuantPortfolioIdentity {
        guard let membership = selectedMembership else { return .sourceMissing }
        let decision = valuationQuantEnvelope.status == "available"
            && valuationQuantEnvelope.membershipId == membership.id
            && valuationQuantEnvelope.data?.target.membershipVersion == membership.version
            && valuationQuantEnvelope.data?.target.symbol == membership.symbol
            && valuationQuantEnvelope.data?.quant.evidence.status == "available"
            && valuationQuantEnvelope.data?.quant.evidence.decisionEvidence?.status == "available"
            && valuationQuantEnvelope.data?.quant.evidence.identities?.hkConnectUniverse?
                .isValidOfficialHongKongConnectBinding == true
        let portfolio = portfolioLabEnvelope.status == "available"
            && portfolioLabEnvelope.membershipId == membership.id
            && portfolioLabEnvelope.data?.target.membershipVersion == membership.version
            && portfolioLabEnvelope.data?.target.symbol == membership.symbol
            && portfolioLabEnvelope.data?.quant.evidenceStatus == "available"
            && portfolioLabEnvelope.data?.quant.evidence?.source.hkConnectUniverse?
                .isValidOfficialHongKongConnectBinding == true
        return ExpectedFrozenQuantPortfolioIdentity(
            decisionRefinementId: decision
                ? valuationQuantEnvelope.data?.quant.evidence.decisionEvidence?.refinementId : nil,
            decisionUniverseSnapshotId: decision
                ? valuationQuantEnvelope.data?.quant.evidence.identities?.hkConnectUniverse?.snapshotId : nil,
            portfolioEvidenceId: portfolio
                ? portfolioLabEnvelope.data?.quant.evidence?.evidenceId : nil,
            portfolioUniverseSnapshotId: portfolio
                ? portfolioLabEnvelope.data?.quant.evidence?.source.hkConnectUniverse?.snapshotId : nil
        )
    }

    var currentFrozenResearchBindingIdentity: FrozenResearchEvidenceBindingIdentity? {
        guard let membership = selectedMembership,
              membership.state != .archived else { return nil }
        let envelope = researchValuationScenarioWorkspace.envelope
        let mode = frozenResearchEvidenceWorkspace.selectedMethodMode
        let provider = mode == "provider_fcff" ? envelope?.providerScenarioSets?.first {
            $0.id == frozenResearchEvidenceWorkspace.selectedProviderScenarioId
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        } : nil
        let fcff = mode == "provider_fcff" ? envelope?.fcffScenarioSets?.first {
            $0.id == frozenResearchEvidenceWorkspace.selectedFcffScenarioId
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        } : nil
        let legacy = mode == "legacy" ? [
            envelope?.scenarioSets.first { $0.id == frozenResearchEvidenceWorkspace.selectedLegacyPeId
                && $0.calculation.method.id == "discounted_forward_metric_multiple_user_scenario" },
            envelope?.scenarioSets.first { $0.id == frozenResearchEvidenceWorkspace.selectedLegacyNavId
                && $0.calculation.method.id == "adjusted_net_asset_value_user_scenario" }
        ].compactMap { $0 }.filter { $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty } : []
        return FrozenResearchEvidenceBindingIdentity(
            membership: membership,
            scenario: legacy.first,
            valuationMethods: legacy,
            providerScenario: provider,
            fcffScenario: fcff,
            technical: currentMarketTechnicalEnvelope,
            weinstein: researchWeinsteinEnvelope.flatMap(FrozenWeinsteinEvidenceBinding.init(envelope:)),
            ownerZonesDraft: frozenResearchEvidenceWorkspace.ownerZonesDraft,
            expectedQuantPortfolio: currentExpectedFrozenQuantPortfolioIdentity
        )
    }

    @MainActor
    func ownerWeinsteinZoneDraftDidChange() {
        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
        frozenResearchEvidenceWorkspace.invalidateTechnicalSnapshotConfirmation()
        frozenResearchEvidenceWorkspace.message = "人工区域版本已变化，请核对并重新确认冻结。"
    }

    var currentTechnicalSnapshotConfirmationIdentity: TechnicalSnapshotConfirmationIdentity? {
        guard let membership = selectedMembership,
              parsedSymbol?.canonical == membership.symbol,
              researchWeinsteinEnvelope?.analysisAsOf == currentHongKongRequestDate() else { return nil }
        return TechnicalSnapshotConfirmationIdentity(
            membership: membership,
            analysis: researchWeinsteinEnvelope,
            ownerZonesDraft: frozenResearchEvidenceWorkspace.ownerZonesDraft
        )
    }

    @MainActor
    func synchronizeFrozenResearchBinding(_ message: String) {
        if let confirmed = frozenResearchEvidenceWorkspace.technicalSnapshotConfirmedIdentity,
           confirmed != currentTechnicalSnapshotConfirmationIdentity {
            frozenResearchEvidenceWorkspace.invalidateTechnicalSnapshotConfirmation()
        }
        guard let identity = currentFrozenResearchBindingIdentity else {
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(message)
            invalidateTwoLayerReport(message)
            return
        }
        let changed = frozenResearchEvidenceWorkspace.bindingIdentity != identity
        frozenResearchEvidenceWorkspace.synchronizeBinding(identity, message: message)
        if changed {
            invalidateTwoLayerReport(message)
#if OWNER_CLIENT
            // Currentness invalidation must not leave the read-only report library empty.
            // The full daily refresh already reloads it after all upstream reads finish.
            if clientDestination == .report,
               dailyRefreshGate.phase != .refreshing,
               dailyRefreshGate.phase != .validatingRestoredNavigation {
                let authorizationRevision = viewModel.authorizationRevision
                Task { @MainActor in
                    guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                          currentFrozenResearchBindingIdentity == identity,
                          clientDestination == .report else { return }
                    await loadTwoLayerReports()
                }
            }
#endif
        }
    }

    @MainActor
    func loadResearchTechnicalEvidence() async {
        guard let symbol = parsedSymbol else {
            researchTechnicalRequestLane.reset()
            researchMarketTechnicalEnvelope = nil
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "技术标的无效；旧冻结展示与确认已清除。"
            )
            return
        }
        let revision = researchTechnicalRequestLane.begin()
        researchMarketTechnicalEnvelope = .unavailable(
            "正在重新读取当前日线与统一技术指标。",
            market: symbol.market,
            code: symbol.code,
            cutoff: currentHongKongRequestDate()
        )
        do {
            let fetched = try await marketDailyClient.fetch(market: symbol.market, code: symbol.code)
            guard researchTechnicalRequestLane.accepts(revision),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            researchMarketTechnicalEnvelope = fetched
            synchronizeFrozenResearchBinding(
                "技术快照或计算结果已变化；旧冻结展示与确认已清除。"
            )
        } catch {
            guard researchTechnicalRequestLane.accepts(revision),
                  parsedSymbol?.canonical == symbol.canonical else { return }
            researchMarketTechnicalEnvelope = .unavailable(
                "研究技术证据暂不可用；旧结果已清除。",
                market: symbol.market,
                code: symbol.code,
                cutoff: currentHongKongRequestDate()
            )
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "重新读取技术证据失败；旧冻结展示与确认已清除。"
            )
        }
    }

    @MainActor
    func refreshResearchTechnicalEvidence() async {
        let authorizationRevision = viewModel.authorizationRevision
        guard !isRefreshingResearchTechnicalEvidence,
              !isLoadingMobileWorkspace,
              !frozenResearchEvidenceWorkspace.isBusy,
              !twoLayerReportWorkspace.isBusy,
              !submissionState.isInFlight,
              let symbol = parsedSymbol,
              let refreshSource = DailyClientSourceKey(
                canonicalSymbol: symbol.canonical,
                authorizationRevision: authorizationRevision
              ),
              let membership = selectedMembership,
              membership.symbol == symbol.canonical,
              membership.state != .archived else { return }
        let context = AppEnvironment.researchAuthorizationContext()
        let revision = researchTechnicalRequestLane.begin()
        activeResearchTechnicalRefreshSource = refreshSource
        activeResearchTechnicalRefreshRevision = revision
        defer {
            if activeResearchTechnicalRefreshSource == refreshSource,
               activeResearchTechnicalRefreshRevision == revision {
                activeResearchTechnicalRefreshSource = nil
                activeResearchTechnicalRefreshRevision = nil
            }
            todayRefreshRevision &+= 1
        }
        clearTodayResearch(
            "真实日线刷新中；旧 Today 研究事项已清除。",
            membershipId: membership.id
        )

        researchMarketTechnicalEnvelope = .unavailable(
            "正在刷新真实 Futu 日线，等待系统回读确认。",
            market: symbol.market,
            code: symbol.code,
            cutoff: currentHongKongRequestDate()
        )
        frozenResearchEvidenceWorkspace.clear(
            "真实日线刷新中；旧冻结证据暂不可操作。"
        )
        invalidateTwoLayerReport("真实日线刷新中；旧报告暂不可操作。")
        let refreshClient = MarketDailyTechnicalClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName,
            writeAuthToken: context.writeToken,
            writeAuthHeaderName: context.writeHeaderName
        )
        do {
            let fetched = try await refreshClient.refresh(market: symbol.market, code: symbol.code)
            guard researchTechnicalRequestLane.accepts(revision),
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  parsedSymbol?.canonical == symbol.canonical,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.symbol == membership.symbol else {
                await recoverCurrentResearchAfterDiscardedTechnicalRefresh(
                    source: refreshSource,
                    revision: revision,
                    context: context
                )
                return
            }
            researchMarketTechnicalEnvelope = fetched
            synchronizeFrozenResearchBinding(
                "真实日线快照或计算结果已重新读取；发生变化时旧冻结与报告继续失效。"
            )
            frozenResearchEvidenceWorkspace.message =
                "真实日线刷新并重新读取已完成；失效版本只能由你明确重新冻结。"
            await loadTodayResearch(for: membership)
        } catch {
            guard researchTechnicalRequestLane.accepts(revision),
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  parsedSymbol?.canonical == symbol.canonical,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.symbol == membership.symbol else {
                await recoverCurrentResearchAfterDiscardedTechnicalRefresh(
                    source: refreshSource,
                    revision: revision,
                    context: context
                )
                return
            }
            researchMarketTechnicalEnvelope = .unavailable(
                "真实日线刷新或回读确认失败；旧结果已清除。",
                market: symbol.market,
                code: symbol.code,
                cutoff: currentHongKongRequestDate()
            )
            frozenResearchEvidenceWorkspace.invalidateForUpstreamSuccess(
                "真实日线刷新失败；旧冻结与报告不可冒充当前。"
            )
            invalidateTwoLayerReport("真实日线刷新失败；旧两层报告状态已清除。")
            await loadTodayResearch(for: membership)
        }
    }

    @MainActor
    func loadFrozenResearchEvidence() async {
        guard let membership = selectedMembership,
              membership.state != .archived else {
            frozenResearchEvidenceWorkspace.clear("请选择当前未归档研究自选后读取冻结证据包。")
            invalidateTwoLayerReport("membership 不可用；旧两层报告状态已清除。")
            return
        }
        if researchValuationScenarioWorkspace.envelope?.membershipId != membership.id
            || researchValuationScenarioWorkspace.envelope?.membershipVersion != membership.version {
            await loadResearchValuationScenarios()
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
        }
        let revision = frozenResearchEvidenceWorkspace.requests.beginLoad()
        let priorReportBinding = TwoLayerReportBindingIdentity(
            membership: membership,
            pack: frozenResearchEvidenceWorkspace.envelope?.data?.latestPack
        )
        frozenResearchEvidenceWorkspace.envelope = nil
        defer {
            frozenResearchEvidenceWorkspace.requests.finishLoad(revision)
        }
        do {
            let envelope = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard frozenResearchEvidenceWorkspace.requests.acceptsLoad(revision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            frozenResearchEvidenceWorkspace.envelope = envelope
            frozenResearchEvidenceWorkspace.updateTechnicalSnapshotMaterials(
                envelope.data?.materials ?? [], membership: membership,
                sourceType: independentWeinsteinTechnicalSourceType
            )
            let freshReportBinding = TwoLayerReportBindingIdentity(
                membership: membership,
                pack: envelope.data?.latestPack
            )
            let explicitLimitedPackIsCurrent = envelope.data?.latestPack?.materialSelectionMode == "explicit"
                && envelope.data?.latestPack?.currentness.status == "current"
            if !envelope.isFreshForCurrentResearch && !explicitLimitedPackIsCurrent {
                invalidateTwoLayerReport(
                    "研究来源为 \(envelope.metadata.freshness)；旧报告成功态已清除，请先刷新或处理冲突。"
                )
            } else if priorReportBinding != freshReportBinding {
                invalidateTwoLayerReport(
                    "冻结证据版本已变化；旧报告草稿、当前成功态、决定与待处理操作已清除。"
                )
            }
            frozenResearchEvidenceWorkspace.message = envelope.isFreshForCurrentResearch || explicitLimitedPackIsCurrent
                ? envelope.data?.evidencePacks.isEmpty == false
                    ? explicitLimitedPackIsCurrent
                        ? "已读取 \(envelope.data?.evidencePacks.count ?? 0) 个证据版本；本次有限研究只使用冻结所选材料。"
                        : "已读取 \(envelope.data?.evidencePacks.count ?? 0) 个不可变证据版本。"
                    : "尚无冻结证据版本；只有你明确操作才会创建。"
                : "研究来源状态为 \(envelope.metadata.freshness)：\(envelope.metadata.message) 旧成功不可继续使用。"
        } catch {
            guard frozenResearchEvidenceWorkspace.requests.acceptsLoad(revision) else { return }
            frozenResearchEvidenceWorkspace.message = frozenResearchEvidenceMessage(error)
            invalidateTwoLayerReport("冻结包读取失败；旧两层报告状态已清除。")
        }
    }

    @MainActor
    func saveCurrentTechnicalSnapshot() async {
        guard let membership = selectedMembership,
              let identity = currentTechnicalSnapshotConfirmationIdentity,
              frozenResearchEvidenceWorkspace.technicalSnapshotConfirmedIdentity == identity,
              !frozenResearchEvidenceWorkspace.technicalSnapshotRequests.isBusy,
              !frozenResearchEvidenceWorkspace.isBusy,
              let semanticData = try? JSONEncoder().encode(identity) else { return }
        let semantic = researchDocumentSha256(semanticData)
        let requestStore = IndependentTechnicalConfirmationRequestStore()
        let request: CreateIndependentWeinsteinTechnicalConfirmationRequest
        if let reserved = requestStore.load(semantic: semantic),
           reserved.membershipId == membership.id,
           reserved.membershipVersion == membership.version,
           reserved.expectedWeinstein == identity.weinstein,
           reserved.ownerWeinsteinZones == identity.ownerZones {
            request = reserved
        } else {
            let key = frozenResearchEvidenceWorkspace.technicalSnapshotReservation.reserve(
                for: semantic, prefix: "ios-independent-weinstein"
            )
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let candidate = CreateIndependentWeinsteinTechnicalConfirmationRequest(
                membership: membership, expectedWeinstein: identity.weinstein,
                ownerWeinsteinZones: identity.ownerZones,
                confirmedAt: formatter.string(from: Date()), idempotencyKey: key
            )
            guard requestStore.save(semantic: semantic, request: candidate) else {
                frozenResearchEvidenceWorkspace.technicalSnapshotMessage =
                    "无法保存本次确认的重试身份；尚未发送。"
                return
            }
            request = candidate
        }
        let authorizationRevision = viewModel.authorizationRevision
        let authorization = AppEnvironment.researchAuthorizationContext()
        let priorPack = frozenResearchEvidenceWorkspace.envelope?.data?.latestPack
        let revision = frozenResearchEvidenceWorkspace.technicalSnapshotRequests.beginSave()
        frozenResearchEvidenceWorkspace.technicalSnapshotMessage = "正在保存并回读本次 Owner 技术确认。"
        defer { frozenResearchEvidenceWorkspace.technicalSnapshotRequests.finishSave(revision) }
        do {
            let readBack = try await client.confirmIndependentWeinsteinTechnicalAndReadBack(
                membership: membership, requestBody: request
            )
            guard frozenResearchEvidenceWorkspace.technicalSnapshotRequests.acceptsSave(revision),
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == authorization,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  currentTechnicalSnapshotConfirmationIdentity == identity else { return }
            frozenResearchEvidenceWorkspace.envelope = readBack.workspace
            frozenResearchEvidenceWorkspace.updateTechnicalSnapshotMaterials(
                readBack.workspace.data?.materials ?? [], membership: membership,
                sourceType: independentWeinsteinTechnicalSourceType
            )
            frozenResearchEvidenceWorkspace.invalidateTechnicalSnapshotConfirmation()
            requestStore.clear()
            if priorPack?.id != readBack.workspace.data?.latestPack?.id
                || priorPack?.currentness != readBack.workspace.data?.latestPack?.currentness {
                invalidateTwoLayerReport("研究材料已变化；旧正式报告状态需重新核对。")
            }
            frozenResearchEvidenceWorkspace.technicalSnapshotMessage =
                "技术快照材料 #\(readBack.material.id) 已保存并重新读取；Owner 区域 v\(readBack.content.ownerWeinsteinZones.version) 与机器结果分开保留。"
            todayRefreshRevision &+= 1
        } catch {
            guard frozenResearchEvidenceWorkspace.technicalSnapshotRequests.acceptsSave(revision) else { return }
            frozenResearchEvidenceWorkspace.technicalSnapshotMessage =
                "技术快照尚未取得可验证回读；未显示成功，请保持内容不变后重试。"
        }
    }

    @MainActor
    func prepareLimitedResearch() async {
        guard let membership = selectedMembership, membership.state != .archived,
              !frozenResearchEvidenceWorkspace.isBusy,
              !twoLayerReportWorkspace.isBusy,
              twoLayerReportWorkspace.draft == nil,
              !twoLayerReportWorkspace.hasActiveSynthesisTask else { return }
        let holdingMaterialIds = Set((frozenResearchEvidenceWorkspace.envelope?.data?.events ?? [])
            .filter { $0.coverageScope == "current_holding" }.map { $0.source.materialId })
        let available = (frozenResearchEvidenceWorkspace.envelope?.data?.materials ?? [])
            .filter { $0.revisionState == "current" && $0.sourceType != "owner_verified_holding_logic"
                && $0.sourceType != "exchange_announcement_lead"
                && !holdingMaterialIds.contains($0.id) }
        guard let selectedMaterials = frozenResearchEvidenceWorkspace.selectedLimitedMaterials(
            membership: membership, available: available
        ) else {
            frozenResearchEvidenceWorkspace.message = "请先选择并核对本次要使用的有效材料。"
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        let key = frozenResearchEvidenceWorkspace.reservation.reserve(
            for: "limited|\(membership.id)|\(membership.version)|\(membership.actorId)|\(selectedMaterials.map { "\($0.id):\($0.revision):\($0.contentFingerprint):\($0.sourceVersion):\($0.validUntil)" }.joined(separator: "|"))", prefix: "ios-limited-research")
        let revision = frozenResearchEvidenceWorkspace.requests.beginSave()
        frozenResearchEvidenceWorkspace.message = "正在用已有材料准备有限研究…"
        defer { frozenResearchEvidenceWorkspace.requests.finishSave(revision) }
        do {
            let result = try await client.freezeLimitedResearchAndReadBack(
                membership: membership, selectedMaterials: selectedMaterials, idempotencyKey: key)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  frozenResearchEvidenceWorkspace.requests.acceptsSave(revision),
                  selectedMembership?.id == membership.id, selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.lastFreshPackId = result.pack.id
            frozenResearchEvidenceWorkspace.reservation.clear()
            invalidateTwoLayerReport("有限研究材料已就绪；请确认研究问题与发送范围。")
            await loadTwoLayerReports()
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id, selectedMembership?.version == membership.version else { return }
#if OWNER_CLIENT
            // A pending current-question handoff may have prepared the draft
            // after the fresh report/task read. Do not replace its question.
            if twoLayerReportWorkspace.draft == nil && ownerStore.personalFormalHandoff == nil { createTwoLayerDraft() }
#else
            createTwoLayerDraft()
#endif
            selectedEvidenceWorkspace = .brief
            selectedDecisionLayer = .evidence
            isResearchEvidenceRecordsExpanded = true
            pendingDecisionWorkspaceScrollTarget = "twoLayerResearchConfirmation"
            frozenResearchEvidenceWorkspace.message = "已有材料已准备好；本次不要求估值或技术数据，结果仍需进一步核实。"
        } catch {
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  frozenResearchEvidenceWorkspace.requests.acceptsSave(revision) else { return }
            frozenResearchEvidenceWorkspace.message = frozenResearchEvidenceMessage(error)
        }
    }

    @MainActor
    func freezeCurrentResearchEvidence() async {
        guard let membership = selectedMembership,
              membership.state != .archived,
              frozenResearchEvidenceWorkspace.ownerConfirmed,
              let confirmed = frozenResearchEvidenceWorkspace.confirmedBindingIdentity,
              confirmed == currentFrozenResearchBindingIdentity,
              confirmed.isFreezeReady,
              confirmed.valuationMethods.count == 2,
              let snapshotSha = confirmed.technicalSnapshotSha,
              let resultHash = confirmed.technicalResultHash,
              let weinstein = confirmed.weinstein else { return }
        let fingerprint = [
            membership.id,
            String(membership.version),
            membership.symbol,
            confirmed.selectionVersion ?? "legacy-v1",
            confirmed.scenarioId ?? "none",
            confirmed.scenarioRevision.map(String.init) ?? "none",
            confirmed.valuationMethods.map { "\($0.basisKind ?? "legacy"):\($0.methodId):\($0.scenarioId):\($0.scenarioRevision)" }.joined(separator: ","),
            snapshotSha,
            resultHash,
            weinstein.resultHash,
            confirmed.ownerWeinsteinZones.map {
                "owner-zones:\($0.version):\($0.reason):\($0.supportZones.map { "\($0.lower)-\($0.upper)" }.joined(separator: ",")):\($0.resistanceZones.map { "\($0.lower)-\($0.upper)" }.joined(separator: ","))"
            } ?? "owner-zones:none",
            confirmed.expectedQuantPortfolio.decisionRefinementId ?? "decision-source-missing",
            confirmed.expectedQuantPortfolio.decisionUniverseSnapshotId ?? "decision-universe-missing",
            confirmed.expectedQuantPortfolio.portfolioEvidenceId ?? "portfolio-source-missing",
            confirmed.expectedQuantPortfolio.portfolioUniverseSnapshotId ?? "portfolio-universe-missing"
        ].joined(separator: "|")
        let key = frozenResearchEvidenceWorkspace.reservation.reserve(
            for: fingerprint,
            prefix: "ios-frozen-research-evidence"
        )
        let revision = frozenResearchEvidenceWorkspace.requests.beginSave()
        frozenResearchEvidenceWorkspace.envelope = nil
        frozenResearchEvidenceWorkspace.lastFreshPackId = nil
        defer {
            frozenResearchEvidenceWorkspace.requests.finishSave(revision)
        }
        do {
            let result = try await client.freezeResearchEvidenceAndReadBack(
                membership: membership,
                requestBody: FreezeResearchEvidencePackRequest(
                    membershipVersion: membership.version,
                    expectedScenarioId: confirmed.scenarioId,
                    expectedScenarioRevision: confirmed.scenarioRevision,
                    selectionVersion: confirmed.selectionVersion,
                    expectedValuationMethods: confirmed.valuationMethods,
                    expectedTechnicalSnapshotSha: snapshotSha,
                    expectedTechnicalResultHash: resultHash,
                    expectedWeinstein: weinstein,
                    ownerWeinsteinZones: confirmed.ownerWeinsteinZones,
                    expectedQuantPortfolio: confirmed.expectedQuantPortfolio,
                    idempotencyKey: key
                )
            )
            guard frozenResearchEvidenceWorkspace.requests.acceptsSave(revision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol else { return }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.lastFreshPackId = result.pack.id
            frozenResearchEvidenceWorkspace.setOwnerConfirmation(
                false,
                for: currentFrozenResearchBindingIdentity
            )
            frozenResearchEvidenceWorkspace.message =
                "研究证据版本 #\(result.pack.id) 已保存，并与当前材料、估值和真实日线一致。"
            invalidateTwoLayerReport(
                "新证据已冻结；旧报告已转为历史。下一步请明确准备并发起深度研究修订。",
                preservingRevisionSource: pendingResearchReportRevisionSourceReservation != nil
            )
            todayRefreshRevision &+= 1
            await loadTodayResearch(for: membership)
            selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = "createTwoLayerReportDraftButton"
        } catch {
            guard frozenResearchEvidenceWorkspace.requests.acceptsSave(revision) else { return }
            frozenResearchEvidenceWorkspace.message = frozenResearchEvidenceMessage(error)
            invalidateTwoLayerReport("冻结写入失败；旧两层报告状态已清除。")
        }
    }

    @MainActor
    func openFrozenResearchEvidenceSource(_ pack: FrozenResearchEvidencePack) async {
        guard let scenario = pack.frozenResearchContext?.valuationScenario else {
            frozenResearchEvidenceWorkspace.message = "历史版本缺少原始材料、基本面或估值来源，不能当作当前来源。"
            return
        }
        if scenario.anchor.source.kind != "source_snapshot" { await loadResearchDocuments() }
        await openResearchValuationSource(scenario.anchor)
    }

    @MainActor
    func prepareNoticeLeadForVerification(_ handoff: NoticeLeadResearchHandoff) {
        let eventKind = ResearchEventCaptureDraft.suggestedEventKind(for: handoff.item)
        let rule = ResearchMonitorRule.uniqueNoticeLeadRule(
            rules: envelope.data?.profile.monitorRules ?? [],
            allowedVariables: currentResearchEventVariables,
            category: eventKind
        )
        let variable = rule?.variableName ?? ""
        guard selectedMembership?.symbol == handoff.item.symbol,
              researchEventDraft.prepareForVerification(handoff, variableName: variable) else {
            researchEventMessage = "请先读取同一 \(handoff.item.symbol) 研究成员，再预填该线索。"
            return
        }
        if let rule { researchEventDraft.bindMonitorRule(rule) }
        researchEventMaterialReservation.clear(); researchEventBindingReservation.clear()
        isResearchEventCaptureExpanded = true; pendingDecisionWorkspaceScrollTarget = "researchAnnouncementEvents"
        researchEventMessage = variable.isEmpty
            ? "已预填公告元数据；请先选择对应关键变量，再填写事实并人工核验。"
            : "已按唯一公告监控规则绑定“\(variable)”；请填写事实摘要并人工核验。"
    }

    @MainActor
    func prepareOfficialAnnouncementForVerification(_ item: OfficialAnnouncementDiscoveryItem) {
        let eventKind = ResearchEventCaptureDraft.suggestedEventKind(for: item)
        let rule = ResearchMonitorRule.uniqueNoticeLeadRule(
            rules: envelope.data?.profile.monitorRules ?? [],
            allowedVariables: currentResearchEventVariables,
            category: eventKind
        )
        let variable = rule?.variableName ?? ""
        guard selectedMembership?.symbol == item.symbol,
              researchEventDraft.prepareForVerification(item, variableName: variable) else {
            researchEventMessage = "请先读取同一 \(item.symbol) 研究成员，再预填该官方公告。"
            return
        }
        if let rule { researchEventDraft.bindMonitorRule(rule) }
        researchEventMaterialReservation.clear(); researchEventBindingReservation.clear()
        selectedDecisionLayer = .evidence
        selectedEvidenceWorkspace = .frozen
        isResearchEventCaptureExpanded = true
        pendingDecisionWorkspaceScrollTarget = "researchAnnouncementEvents"
        researchEventMessage = variable.isEmpty
            ? "官方 PDF 已导入并预填为 \(eventKind)；请选择关键变量、填写事实摘要并人工核验。"
            : "官方 PDF 已导入，并按同类别唯一监控规则绑定“\(variable)”；请填写事实摘要并人工核验。"
    }

    @MainActor
    private func recoverCurrentResearchAfterDiscardedTechnicalRefresh(
        source: DailyClientSourceKey,
        revision: UUID,
        context: AppResearchAuthorizationContext
    ) async {
        guard researchTechnicalRequestLane.accepts(revision),
              dailyClientAuthorizationIsCurrent(source.authorizationRevision),
              AppEnvironment.researchAuthorizationContext() == context,
              parsedSymbol?.canonical == source.canonicalSymbol else { return }
        await loadResearchTechnicalEvidence()
        if let membership = selectedMembership,
           membership.symbol == source.canonicalSymbol,
           membership.state != .archived {
            await loadTodayResearch(for: membership)
        }
    }

    private func frozenResearchEvidenceMessage(_ error: Error) -> String {
        if case FrozenResearchEvidenceClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403: return "未认证或缺少显式 user research_write；旧成功态已清除。"
            case 404: return "当前 membership 不存在；旧成功态已清除。"
            case 409: return "研究成员或绑定版本已变化；请重新读取后明确重试。"
            case 422: return "当前原始材料、基本面、估值或技术证据不完整，没有冻结新版本。"
            default: return "冻结证据服务不可用；旧成功态已清除。"
            }
        }
        return "冻结证据响应无效或离线；未显示写入成功。"
    }
}
