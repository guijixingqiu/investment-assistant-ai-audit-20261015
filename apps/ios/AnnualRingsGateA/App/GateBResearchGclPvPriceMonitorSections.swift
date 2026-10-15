import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func gclPvPriceMonitorSection() -> some View {
        if selectedMembership?.symbol == "HK.03800" {
            let monitor = frozenResearchEvidenceWorkspace.envelope?.data?.latestGclPvPriceMonitor.flatMap {
                gclMonitorMatchesCurrentHolding($0, symbol: "HK.03800") ? $0 : nil
            }
            let events = currentGclPvSourceEvents
            VStack(alignment: .leading, spacing: 10) {
                Text("协鑫科技光伏价值链监测").font(.headline)
                Text("保留原始规格、单位、期间与元/瓦折算规则；只比较同口径数据，缺失项保持 UNKNOWN。")
                    .font(.caption).foregroundStyle(.secondary)
                if let monitor {
                    Label(
                        "\(monitor.period) 对 \(monitor.referencePeriod) · \(gclStatusLabel(monitor.assessment.status))",
                        systemImage: monitor.assessment.trendConclusionAllowed ? "chart.line.uptrend.xyaxis" : "questionmark.circle"
                    )
                    .font(.callout.weight(.semibold))
                    Text("监测 #\(monitor.id) v\(monitor.runVersion) · 价格 \(monitor.priceObservations.count) 条 · 上下文 \(monitor.contextObservations.count) 条")
                        .font(.caption2).foregroundStyle(.secondary)
                    if !monitor.assessment.blockers.isEmpty {
                        DisclosureGroup("待补数据与不可比较项 · \(monitor.assessment.blockers.count)") {
                            ForEach(monitor.assessment.blockers, id: \.self) { Text("• \($0)").font(.caption) }
                        }
                    }
                    DisclosureGroup("价格、上下文与来源") {
                        ForEach(Array(monitor.priceObservations.enumerated()), id: \.offset) { _, item in
                            Text("\(gclStageLabel(item.stage)) · \(item.period) · \(item.value) \(item.unit) → \(item.normalizedCnyPerWatt) 元/瓦 · 事件 #\(item.eventId)")
                                .font(.caption)
                        }
                        ForEach(Array(monitor.contextObservations.enumerated()), id: \.offset) { _, item in
                            Text("\(gclMetricLabel(item.metric)) · \(item.period) · \(item.value) \(item.unit) · 事件 #\(item.eventId)")
                                .font(.caption)
                        }
                    }
                    DisclosureGroup("影响与 UNKNOWN") {
                        ForEach(gclImpactRows(monitor.assessment), id: \.0) { label, impact in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(label)：\(gclSignalLabel(impact.signal))").font(.caption.weight(.semibold))
                                if !impact.basis.isEmpty { Text(impact.basis.joined(separator: "；")).font(.caption2) }
                                if !impact.unknowns.isEmpty { Text("UNKNOWN：\(impact.unknowns.joined(separator: "；"))").font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                    }
                } else {
                    Text("当前没有可显示的协鑫光伏监测；不会沿用旧快照或猜测趋势。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Divider()
                if events.isEmpty {
                    Text("先用上方“事件、风险或反证”保存 current_holding 事件；变量须为 polysilicon_price、wafer_price、cell_price、module_price 或经营上下文指标。")
                        .font(.caption).foregroundStyle(.orange)
                } else {
                    TextField("当前期间（YYYY-MM-DD）", text: $gclPvPriceMonitorDraft.period)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("gclPvPricePeriod")
                    TextField("参照期间（YYYY-MM-DD）", text: $gclPvPriceMonitorDraft.referencePeriod)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("gclPvPriceReferencePeriod")
                    ForEach($gclPvPriceMonitorDraft.priceObservations) { $row in
                        gclPriceEditor($row, events: events)
                    }
                    ForEach($gclPvPriceMonitorDraft.contextObservations) { $row in
                        gclContextEditor($row, events: events)
                    }
                    DailyResponsiveActionGroup {
                        Button("添加价格") {
                            let event = events.first(where: { $0.keyVariable == "polysilicon_price" })
                            gclPvPriceMonitorDraft.appendPrice(eventId: event?.id ?? "")
                        }
                        Button("添加经营上下文") {
                            let event = events.first(where: { $0.keyVariable == "inventory" })
                            gclPvPriceMonitorDraft.appendContext(eventId: event?.id ?? "")
                        }
                    }
                    .buttonStyle(.bordered)
                    Toggle("我已核对来源、规格、单位、期间、折算规则与数值", isOn: $gclPvPriceMonitorDraft.ownerConfirmed)
                        .accessibilityIdentifier("gclPvPriceOwnerConfirmed")
                    Button {
                        Task { await saveGclPvPriceMonitor() }
                    } label: {
                        Label(isSavingGclPvPriceMonitor ? "正在保存并核对" : "保存光伏监测", systemImage: "chart.xyaxis.line")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSaveGclPvPriceMonitor)
                    .accessibilityIdentifier("saveGclPvPriceMonitor")
                    Text(gclPvPriceMonitorMessage).font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("gclPvPriceMonitorMessage")
                    Text("只写研究监测；不会冻结证据、生成或确认报告、形成正式决定、修改资产或发起交易。")
                        .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            .onChange(of: gclPvPriceMonitorDraft.fingerprint) { _, _ in gclPvPriceMonitorDraft.ownerConfirmed = false }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("gclPvPriceMonitorSection")
        }
    }

    private var currentGclPvSourceEvents: [ResearchAnnouncementEventData] {
        guard let membership = selectedMembership, membership.state == .tracked,
              membership.symbol == "HK.03800", currentHoldingEventSourceIsExact(for: membership.symbol) else { return [] }
        let variables = Set(["polysilicon_price", "wafer_price", "cell_price", "module_price", "inventory", "utilization", "capacity", "company_cost", "impairment"])
        return (frozenResearchEvidenceWorkspace.envelope?.data?.events ?? []).filter {
            variables.contains($0.keyVariable) && currentHoldingEventMatches($0, symbol: membership.symbol)
        }
    }

    @ViewBuilder
    private func gclPriceEditor(_ row: Binding<GclPvPriceObservationDraft>, events: [ResearchAnnouncementEventData]) -> some View {
        let value = row.wrappedValue
        DisclosureGroup("\(gclStageLabel(value.stage)) · \(value.period) · \(value.value.isEmpty ? "待填写" : value.value)") {
            VStack(alignment: .leading, spacing: 10) {
                Picker("价值链环节", selection: row.stage) {
                    Text("多晶硅").tag("polysilicon"); Text("硅片").tag("wafer"); Text("电池片").tag("cell"); Text("组件").tag("module")
                }
                .onChange(of: row.wrappedValue.stage) { _, stage in
                    row.wrappedValue.eventId = events.first(where: { $0.keyVariable == "\(stage)_price" })?.id ?? ""
                }
                Picker("绑定已核对来源", selection: row.eventId) {
                    Text("请选择").tag("")
                    ForEach(events.filter { $0.keyVariable == "\(row.wrappedValue.stage)_price" }) { event in
                        Text("事件 #\(event.id) · \(event.source.publishedAt)").tag(event.id)
                    }
                }
                TextField("数据期间（YYYY-MM-DD）", text: row.period).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("产品规格", text: row.productSpecification)
                Picker("原始单位", selection: row.unit) {
                    Text("元/公斤").tag("CNY_per_kg"); Text("元/片").tag("CNY_per_piece"); Text("元/瓦").tag("CNY_per_watt")
                }
                TextField("原始数值", text: row.value).keyboardType(.decimalPad)
                TextField("折算为元/瓦的系数", text: row.conversionFactorToCnyPerWatt).keyboardType(.decimalPad)
                TextField("统一口径键", text: row.normalizationBasisKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("折算规则", text: row.normalizationRule)
                TextField("定义键", text: row.definitionKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                DailyResponsiveActionGroup {
                    Button("复制") { gclPvPriceMonitorDraft.duplicatePrice(value.id) }
                    Button("删除", role: .destructive) { gclPvPriceMonitorDraft.removePrice(value.id) }
                }.buttonStyle(.bordered)
            }.padding(.top, 8)
        }
        .accessibilityIdentifier("gclPvPriceObservationRow")
    }

    @ViewBuilder
    private func gclContextEditor(_ row: Binding<GclPvContextObservationDraft>, events: [ResearchAnnouncementEventData]) -> some View {
        let value = row.wrappedValue
        DisclosureGroup("\(gclMetricLabel(value.metric)) · \(value.period) · \(value.value.isEmpty ? "待填写" : value.value)") {
            VStack(alignment: .leading, spacing: 10) {
                Picker("经营指标", selection: row.metric) {
                    Text("库存").tag("inventory"); Text("开工率").tag("utilization"); Text("产能").tag("capacity"); Text("公司成本").tag("company_cost"); Text("减值").tag("impairment")
                }
                .onChange(of: row.wrappedValue.metric) { _, metric in
                    let dimension = gclMetricDimension(metric)
                    row.wrappedValue.unit = dimension.unit; row.wrappedValue.currency = dimension.currency
                    row.wrappedValue.eventId = events.first(where: { $0.keyVariable == metric })?.id ?? ""
                }
                Picker("绑定已核对来源", selection: row.eventId) {
                    Text("请选择").tag("")
                    ForEach(events.filter { $0.keyVariable == row.wrappedValue.metric }) { event in
                        Text("事件 #\(event.id) · \(event.source.publishedAt)").tag(event.id)
                    }
                }
                TextField("数据期间（YYYY-MM-DD）", text: row.period).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("产品规格或范围", text: row.productSpecification)
                Text("单位：\(gclUnitLabel(value.unit))\(value.currency.isEmpty ? "" : " · \(value.currency)")").font(.caption).foregroundStyle(.secondary)
                TextField("数值", text: row.value).keyboardType(.decimalPad)
                TextField("定义键", text: row.definitionKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                DailyResponsiveActionGroup {
                    Button("复制") { gclPvPriceMonitorDraft.duplicateContext(value.id) }
                    Button("删除", role: .destructive) { gclPvPriceMonitorDraft.removeContext(value.id) }
                }.buttonStyle(.bordered)
            }.padding(.top, 8)
        }
        .accessibilityIdentifier("gclPvContextObservationRow")
    }

    private var canSaveGclPvPriceMonitor: Bool {
        guard !isSavingGclPvPriceMonitor, !isSavingResearchEvent, !frozenResearchEvidenceWorkspace.isBusy,
              let membership = selectedMembership,
              gclDraftEventsAreExact(membership: membership) else { return false }
        return gclPvPriceMonitorDraft.request(membership: membership, idempotencyKey: "preview") != nil
    }

    private func gclDraftEventsAreExact(membership: CandidateMembershipData) -> Bool {
        guard currentHoldingEventSourceIsExact(for: membership.symbol) else { return false }
        let events = currentGclPvSourceEvents
        let requirements = gclPvPriceMonitorDraft.priceObservations.map { ($0.eventId, "\($0.stage)_price") }
            + gclPvPriceMonitorDraft.contextObservations.map { ($0.eventId, $0.metric) }
        return requirements.allSatisfy { eventId, variable in
            events.contains { $0.id == eventId && $0.keyVariable == variable }
        }
    }

    @MainActor
    private func saveGclPvPriceMonitor() async {
        guard canSaveGclPvPriceMonitor, let membership = selectedMembership else { return }
        let authorizationRevision = viewModel.authorizationRevision
        let context = AppEnvironment.researchAuthorizationContext()
        guard let holdingIdentity = currentGclHoldingIdentity(for: membership.symbol) else { return }
        let fingerprint = "\(membership.actorId)|\(membership.id)|\(membership.version)|\(holdingIdentity)|\(gclPvPriceMonitorDraft.fingerprint)"
        let key = gclPvPriceMonitorReservation.reserve(for: fingerprint, prefix: "ios-gcl-pv-price-monitor")
        guard let request = gclPvPriceMonitorDraft.request(membership: membership, idempotencyKey: key) else { return }
        isSavingGclPvPriceMonitor = true
        frozenResearchEvidenceWorkspace.envelope = nil
        clearTodayResearch("光伏监测写入中；旧 Today 事项已清除。", membershipId: membership.id)
        defer { isSavingGclPvPriceMonitor = false }
        do {
            let result = try await client.createGclPvPriceMonitorAndReadBack(membership: membership, requestBody: request)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  selectedMembership?.id == membership.id, selectedMembership?.version == membership.version,
                  selectedMembership?.actorId == membership.actorId, parsedSymbol?.canonical == membership.symbol,
                  currentHoldingEventSourceIsExact(for: membership.symbol),
                  gclMonitorMatchesCurrentHolding(result.monitor, symbol: membership.symbol) else {
                throw FrozenResearchEvidenceClientError.bindingDrift
            }
            await loadTodayResearch(for: membership)
            guard todayResearch.status == .available, todayResearch.requestedActorId == membership.actorId,
                  todayGclMonitorMatches(result.monitor, workspace: result.workspace) else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.message = "光伏监测 #\(result.monitor.id) 已 fresh read；它只进入持仓逻辑 Today，不会改写冻结报告。"
            gclPvPriceMonitorReservation.clear()
            gclPvPriceMonitorDraft = GclPvPriceMonitorDraft()
            gclPvPriceMonitorMessage = "光伏监测 #\(result.monitor.id) 已保存并核对 workspace、Today 与当前平安快照。"
            todayRefreshRevision &+= 1
        } catch {
            frozenResearchEvidenceWorkspace.envelope = nil
            clearTodayResearch("光伏监测未取得完整 fresh readback；未展示旧 Today 事项。", membershipId: membership.id)
            gclPvPriceMonitorMessage = "保存未完整确认；输入与同一快照下的幂等身份已保留。请重新读取来源后明确重试。"
        }
    }

    private func todayGclMonitorMatches(_ monitor: GclPvPriceMonitorData, workspace: FrozenResearchEvidenceWorkspace) -> Bool {
        let items = todayResearch.items.filter { $0.bindings.monitorRef?.kind == "gcl_pv_price" }
        let exact = items.filter { item in
            item.bindings.monitorRef?.id == monitor.id && item.bindings.monitorRef?.runVersion == monitor.runVersion
                && item.bindings.monitorRef?.runFingerprint == monitor.runFingerprint
                && gclTodaySourcesMatch(item, monitor: monitor, workspace: workspace)
        }
        return gclMonitorRequiresToday(monitor, workspace: workspace) ? items.count == 1 && exact.count == 1 : items.isEmpty
    }

    private func gclTodaySourcesMatch(_ item: TodayResearchItem, monitor: GclPvPriceMonitorData, workspace: FrozenResearchEvidenceWorkspace) -> Bool {
        let sources = monitor.priceObservations.map(\.sourceEvent) + monitor.contextObservations.map(\.sourceEvent)
        var unique: [String: GclPvSourceEvent] = [:]
        for source in sources {
            if let existing = unique[source.eventId], existing != source { return false }
            unique[source.eventId] = source
        }
        guard item.bindings.eventRefs.count == unique.count, item.bindings.holdingSnapshotRefs.count == 1,
              let holding = item.bindings.holdingSnapshotRefs.first else { return false }
        return unique.values.allSatisfy { source in
            let workspaceEvents = workspace.data?.events.filter { $0.id == source.eventId } ?? []
            return workspaceEvents.count == 1 && source.matches(workspaceEvent: workspaceEvents[0])
                && gclSourceMatchesCurrentHolding(source, symbol: "HK.03800") && item.bindings.eventRefs.contains {
                $0.eventId == source.eventId && $0.eventVersion == source.eventVersion
                    && $0.eventFingerprint == source.eventFingerprint && $0.coverageScope == source.coverageScope
                    && $0.keyVariable == source.keyVariable && $0.hypothesisImpact == source.hypothesisImpact
            } && holding.accountScopeId == source.holdingBinding.accountScopeId
                && holding.snapshotId == source.holdingBinding.snapshotId
                && holding.sourceBatchId == source.holdingBinding.sourceBatchId
                && holding.sourceAsOf == source.holdingBinding.sourceAsOf
                && holding.positionSourceRowId == source.holdingBinding.positionSourceRowId
        }
    }

    private func currentGclHoldingIdentity(for symbol: String) -> String? {
        guard currentHoldingEventSourceIsExact(for: symbol), let context = portfolioContext,
              let account = context.accountScopeId, let snapshot = context.portfolioSnapshotId,
              let sourceAsOf = context.sourceAsOf,
              let row = context.positions.first(where: { $0.symbol == symbol })?.sourceRowId else { return nil }
        return [account, snapshot, sourceAsOf, row].joined(separator: "|")
    }

    private func gclMonitorMatchesCurrentHolding(_ monitor: GclPvPriceMonitorData, symbol: String) -> Bool {
        let sources = monitor.priceObservations.map(\.sourceEvent) + monitor.contextObservations.map(\.sourceEvent)
        return !sources.isEmpty && sources.allSatisfy { gclSourceMatchesCurrentHolding($0, symbol: symbol) }
    }

    private func gclSourceMatchesCurrentHolding(_ source: GclPvSourceEvent, symbol: String) -> Bool {
        guard currentHoldingEventSourceIsExact(for: symbol), let context = portfolioContext,
              let position = context.positions.first(where: { $0.symbol == symbol }) else { return false }
        let binding = source.holdingBinding
        return binding.accountScopeId == context.accountScopeId && binding.snapshotId == context.portfolioSnapshotId
            && binding.sourceAsOf == context.sourceAsOf && binding.positionSourceRowId == position.sourceRowId
            && position.sourceRowId.hasPrefix("broker_import_batches:\(binding.sourceBatchId)/")
    }

    @MainActor
    func resetGclPvPriceMonitorCapture(_ message: String) {
        isSavingGclPvPriceMonitor = false
        gclPvPriceMonitorDraft = GclPvPriceMonitorDraft()
        gclPvPriceMonitorReservation.clear()
        gclPvPriceMonitorMessage = message
    }

    private func gclMonitorRequiresToday(_ monitor: GclPvPriceMonitorData, workspace: FrozenResearchEvidenceWorkspace) -> Bool {
        guard monitor.assessment.isMaterialForToday else { return false }
        let sources = monitor.priceObservations.map(\.sourceEvent) + monitor.contextObservations.map(\.sourceEvent)
        guard !sources.isEmpty, let data = workspace.data, let pack = data.latestPack,
              pack.currentness.status == "current", pack.currentness.invalidatedBy.isEmpty,
              let report = data.latestReport, report.isCurrentExact, report.evidencePackId == pack.id,
              data.userDecision?.decision == "confirmed", data.userDecision?.reportId == report.id else { return true }
        return !sources.allSatisfy { source in
            pack.items.contains { item in
                item.id == source.materialId && item.revision == source.revision
                    && item.sourceVersion == source.sourceVersion && item.contentFingerprint == source.materialFingerprint
            }
        }
    }

    private func gclImpactRows(_ assessment: GclPvPriceAssessment) -> [(String, GclPvImpact)] {
        [("成本", assessment.impacts.cost), ("利润", assessment.impacts.profit), ("减值", assessment.impacts.impairment),
         ("行业出清", assessment.impacts.industryClearing), ("投资论点", assessment.impacts.thesis)]
    }

    private func gclMetricDimension(_ metric: String) -> (unit: String, currency: String) {
        switch metric {
        case "utilization": ("percent", "")
        case "capacity": ("metric_tonnes_per_year", "")
        case "company_cost": ("CNY_per_kg", "CNY")
        case "impairment": ("CNY", "CNY")
        default: ("metric_tonnes", "")
        }
    }

    private func gclStatusLabel(_ value: String) -> String { value == "comparable" ? "可比较" : value == "incomparable" ? "不可比较" : "数据不足 / UNKNOWN" }
    private func gclStageLabel(_ value: String) -> String { ["polysilicon": "多晶硅", "wafer": "硅片", "cell": "电池片", "module": "组件"][value] ?? value }
    private func gclMetricLabel(_ value: String) -> String { ["inventory": "库存", "utilization": "开工率", "capacity": "产能", "company_cost": "公司成本", "impairment": "减值"][value] ?? value }
    private func gclSignalLabel(_ value: String) -> String { ["supports": "支持", "weakens": "削弱", "mixed": "混合", "unknown": "UNKNOWN"][value] ?? value }
    private func gclUnitLabel(_ value: String) -> String { ["metric_tonnes": "公吨", "percent": "百分比", "metric_tonnes_per_year": "公吨/年", "CNY_per_kg": "元/公斤", "CNY": "元"][value] ?? value }
}
