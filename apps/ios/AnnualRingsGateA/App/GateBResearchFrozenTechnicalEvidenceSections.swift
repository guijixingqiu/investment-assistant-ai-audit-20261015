import SwiftUI
struct DailyDecisionNextStep {
    let layer: DailyDecisionRingLayer
    let title: String
    let detail: String
    let expandsResult: Bool
    let evidenceWorkspace: DailyEvidenceWorkspace?
    let scrollTarget: String?
    let buttonTitle: String

    init(
        layer: DailyDecisionRingLayer,
        title: String,
        detail: String,
        expandsResult: Bool,
        evidenceWorkspace: DailyEvidenceWorkspace? = nil,
        scrollTarget: String? = nil,
        buttonTitle: String = "打开"
    ) {
        self.layer = layer
        self.title = title
        self.detail = detail
        self.expandsResult = expandsResult
        self.evidenceWorkspace = evidenceWorkspace
        self.scrollTarget = scrollTarget
        self.buttonTitle = buttonTitle
    }
}

extension GateBResearchScreen {
    var frozenEvidenceDailyNextStep: DailyDecisionNextStep? {
        guard let completion = frozenResearchEvidenceWorkspace.envelope?.data?.completion else { return nil }
        switch completion.state {
        case "materials_required":
            return DailyDecisionNextStep(
                layer: .evidence,
                title: "导入并核对公司原始材料",
                detail: "先导入官方 PDF，确认使用权限、页码和原值；系统不会用猜测填补缺失事实。",
                expandsResult: false,
                evidenceWorkspace: .documents,
                scrollTarget: "researchDocumentsWorkspaceAnchor",
                buttonTitle: "打开 PDF 原文"
            )
        case "pack_required":
            return DailyDecisionNextStep(
                layer: .evidence,
                title: "冻结更新后的证据版本",
                detail: "真实日线或研究材料已更新。核对估值和技术绑定后，由你明确确认并冻结当前证据包。",
                expandsResult: false,
                evidenceWorkspace: .frozen,
                scrollTarget: "freezeResearchEvidenceButton",
                buttonTitle: "核对并冻结"
            )
        case "research_required":
            let readyToAbsorb = twoLayerReportWorkspace.pendingSynthesisTask != nil
            return DailyDecisionNextStep(
                layer: .evidence,
                title: readyToAbsorb ? "吸收已完成的深度研究" : "生成当前版本的研究报告",
                detail: readyToAbsorb
                    ? "综合任务已绑定当前证据；由你明确吸收后，才会形成新的研究报告。"
                    : "当前证据包已就绪。先准备并发起综合，结果仍需你审阅和确认。",
                expandsResult: false,
                evidenceWorkspace: .brief,
                scrollTarget: readyToAbsorb ? "absorbDeepResearchButton" : "createTwoLayerReportDraftButton",
                buttonTitle: readyToAbsorb ? "吸收报告" : "准备深度研究"
            )
        default:
            return nil
        }
    }

    @ViewBuilder
    func frozenResearchTechnicalWorkspace() -> some View {
        if let pendingNoticeLead {
            pendingNoticeLeadCard(pendingNoticeLead)
        }
        VStack(alignment: .leading, spacing: 10) {
            Text("冻结当前研究证据")
                .font(.headline)
            Text("把你刚核对的材料、估值和真实日线保存为一个不可变版本，供下一份研究报告使用。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Picker("明确选择两种估值方法", selection: Binding(
                get: { frozenResearchEvidenceWorkspace.selectedMethodMode },
                set: { choice in
                    frozenResearchEvidenceWorkspace.selectedMethodMode = choice
                    frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
                    synchronizeFrozenResearchBinding("估值方法选择已改变，请重新确认冻结。")
                }
            )) {
                Text("请选择").tag("")
                Text("真实 OpenD PE ＋ FCFF").tag("provider_fcff")
                Text("旧版发行人 PE ＋ NAV").tag("legacy")
            }.accessibilityIdentifier("frozenResearchMethodPairSelection")
            if frozenResearchEvidenceWorkspace.selectedMethodMode == "provider_fcff" {
                Picker("OpenD PE 原始情景", selection: Binding(
                    get: { frozenResearchEvidenceWorkspace.selectedProviderScenarioId },
                    set: { id in
                        frozenResearchEvidenceWorkspace.selectedProviderScenarioId = id
                        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
                        synchronizeFrozenResearchBinding("PE 原件选择已改变，请重新确认冻结。")
                    }
                )) {
                    Text("请选择已核对情景").tag("")
                    ForEach((researchValuationScenarioWorkspace.envelope?.providerScenarioSets ?? []).filter {
                        $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
                    }) { scenario in
                        Text("#\(scenario.id) r\(scenario.revision) · EPS \(scenario.providerBasis.eps.rawValue) \(scenario.providerBasis.eps.currencyCode)/股 · 材料 #\(scenario.providerBasis.sourceMaterialId)").tag(scenario.id)
                    }
                }.accessibilityIdentifier("frozenResearchProviderPeSelection")
                Picker("FCFF 情景", selection: Binding(
                    get: { frozenResearchEvidenceWorkspace.selectedFcffScenarioId },
                    set: { id in
                        frozenResearchEvidenceWorkspace.selectedFcffScenarioId = id
                        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
                        synchronizeFrozenResearchBinding("FCFF 选择已改变，请重新确认冻结。")
                    }
                )) {
                    Text("请选择已核对情景").tag("")
                    ForEach((researchValuationScenarioWorkspace.envelope?.fcffScenarioSets ?? []).filter {
                        $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
                    }) { scenario in
                        Text("#\(scenario.id) r\(scenario.revision) · \(scenario.calculation.currency) · 截止 \(scenario.calculation.valuationCutoff)").tag(scenario.id)
                    }
                }.accessibilityIdentifier("frozenResearchFcffSelection")
                Text("OpenD 属第三方 EPS/PE 参考；FCFF 属发行人原值与 Owner 未来假设。币种不同不得直接比现价。")
                    .font(.caption).foregroundStyle(.secondary)
            } else if frozenResearchEvidenceWorkspace.selectedMethodMode == "legacy" {
                Picker("旧版 PE 情景", selection: Binding(
                    get: { frozenResearchEvidenceWorkspace.selectedLegacyPeId },
                    set: { id in
                        frozenResearchEvidenceWorkspace.selectedLegacyPeId = id
                        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
                        synchronizeFrozenResearchBinding("旧版 PE 选择已改变，请重新确认冻结。")
                    }
                )) {
                    Text("请选择").tag("")
                    ForEach((researchValuationScenarioWorkspace.envelope?.scenarioSets ?? []).filter {
                        $0.calculation.method.id == "discounted_forward_metric_multiple_user_scenario"
                            && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
                    }) { scenario in Text("#\(scenario.id) r\(scenario.revision)").tag(scenario.id) }
                }
                Picker("旧版 NAV 情景", selection: Binding(
                    get: { frozenResearchEvidenceWorkspace.selectedLegacyNavId },
                    set: { id in
                        frozenResearchEvidenceWorkspace.selectedLegacyNavId = id
                        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: nil)
                        synchronizeFrozenResearchBinding("旧版 NAV 选择已改变，请重新确认冻结。")
                    }
                )) {
                    Text("请选择").tag("")
                    ForEach((researchValuationScenarioWorkspace.envelope?.scenarioSets ?? []).filter {
                        $0.calculation.method.id == "adjusted_net_asset_value_user_scenario"
                            && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
                    }) { scenario in Text("#\(scenario.id) r\(scenario.revision)").tag(scenario.id) }
                }
            }
            if let metadata = frozenResearchEvidenceWorkspace.envelope?.metadata,
               frozenResearchEvidenceWorkspace.envelope?.isFreshForCurrentResearch != true {
                Label(
                    metadata.conflict ? "研究来源存在冲突" : metadata.missing ? "研究来源仍缺失" : "研究来源已经过期",
                    systemImage: metadata.conflict ? "exclamationmark.triangle.fill" : "clock.badge.exclamationmark"
                )
                .font(.callout.weight(.semibold))
                .foregroundStyle(.orange)
                Text(metadata.message)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("frozenResearchWorkspaceFreshnessMessage")
            }
            if let identity = currentFrozenResearchBindingIdentity,
               identity.isFreezeReady,
               frozenResearchEvidenceWorkspace.envelope?.isFreshForCurrentResearch == true {
                Label("两种估值方法与真实日线已就绪", systemImage: "checkmark.circle.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.green)
                DisclosureGroup("本次版本详情") {
                    InfoBlock(
                        title: "精确绑定",
                        value: "valuation=\(identity.valuationMethods.map { "\($0.methodId):#\($0.scenarioId)r\($0.scenarioRevision)" }.joined(separator: " · ")) · snapshot=\(identity.technicalSnapshotSha ?? "未记录") · result=\(identity.technicalResultHash ?? "未记录")",
                        valueIdentifier: "frozenResearchPendingBinding"
                    )
                    InfoBlock(
                        title: "量化与组合风险绑定",
                        value: "quant=\(identity.expectedQuantPortfolio.decisionRefinementId ?? "source_missing") · portfolio=\(identity.expectedQuantPortfolio.portfolioEvidenceId ?? "source_missing") · 未显示的来源不会被静默冻结",
                        valueIdentifier: "frozenResearchPendingQuantBinding"
                    )
                    .padding(.top, 4)
                    InfoBlock(
                        title: "Owner 人工区域",
                        value: identity.ownerWeinsteinZones.map {
                            "v\($0.version) · 基于周线结果 \($0.basedOn.resultHash) · 支撑 \($0.supportZones.count) 区 · 阻力 \($0.resistanceZones.count) 区 · 理由：\($0.reason)"
                        } ?? "未纳入本次冻结；仅保留确定性计算区域",
                        valueIdentifier: "frozenResearchPendingOwnerZones"
                    )
                }
            } else {
                Text(
                    frozenResearchEvidenceWorkspace.ownerZonesDraft.enabled
                        && currentFrozenResearchBindingIdentity?.ownerWeinsteinZones == nil
                        ? "请先完成与当前周线结果精确对应的人工区域版本、价格范围和理由，再确认冻结。"
                    : frozenResearchEvidenceWorkspace.envelope?.isFreshForCurrentResearch == false
                        ? "请先刷新或处理过期、缺失或冲突的研究来源，再冻结新版本。"
                        : "请先刷新估值与真实日线，确认来源可用后再冻结。"
                )
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            ownerWeinsteinFrozenZonesSection()
            independentTechnicalSnapshotSection()
            Toggle(
                "我明确确认冻结当前版本",
                isOn: Binding(
                    get: { frozenResearchEvidenceWorkspace.ownerConfirmed },
                    set: {
                        frozenResearchEvidenceWorkspace.setOwnerConfirmation(
                            $0,
                            for: currentFrozenResearchBindingIdentity
                        )
                    }
                )
            )
            .disabled(
                isRefreshingResearchTechnicalEvidence
                    || currentFrozenResearchBindingIdentity?.isFreezeReady != true
                    || frozenResearchEvidenceWorkspace.envelope?.isFreshForCurrentResearch != true
            )
            .accessibilityIdentifier("frozenResearchOwnerConfirmation")
            Button {
                Task { await freezeCurrentResearchEvidence() }
            } label: {
                Label(
                    frozenResearchEvidenceWorkspace.isSaving ? "正在保存并核对" : "冻结当前证据包",
                    systemImage: "snowflake"
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(
                frozenResearchEvidenceWorkspace.isBusy
                    || frozenResearchEvidenceWorkspace.technicalSnapshotRequests.isBusy
                    || isRefreshingResearchTechnicalEvidence
                    || !frozenResearchEvidenceWorkspace.ownerConfirmed
                    || frozenResearchEvidenceWorkspace.confirmedBindingIdentity
                        != currentFrozenResearchBindingIdentity
                    || frozenResearchEvidenceWorkspace.envelope?.isFreshForCurrentResearch != true
                    || selectedMembership == nil
            )
            .id("freezeResearchEvidenceButton")
            .accessibilityIdentifier("freezeResearchEvidenceButton")
            Text(frozenResearchEvidenceWorkspace.message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("frozenResearchEvidenceMessage")
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        MarketDailyTechnicalView(envelope: currentMarketTechnicalEnvelope)
        GateBResearchWeinsteinWorkspace(
            symbolInput: symbolInput,
            dailyEnvelope: currentMarketTechnicalEnvelope,
            frozenBinding: frozenResearchEvidenceWorkspace.envelope?.data?.evidencePacks.first?.frozenResearchContext?.weinstein,
            envelope: $researchWeinsteinEnvelope
        )
        researchWeinsteinZoneCorrectionSection()
        researchEvidenceConflictSection()
        researchAnnouncementEventsSection()
        geelySalesMonitorSection()
        gclPvPriceMonitorSection()

        if let packs = frozenResearchEvidenceWorkspace.envelope?.data?.evidencePacks,
           !packs.isEmpty {
            frozenResearchEvidencePackCard(packs[0])
            if packs.count > 1 {
                DisclosureGroup("更早的研究证据版本 · \(packs.count - 1)") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(packs.dropFirst())) { pack in
                            frozenResearchEvidencePackCard(pack)
                        }
                    }
                    .padding(.top, 8)
                }
            }
        } else {
            Text("尚无已保存的冻结证据版本。")
                .font(.callout)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("frozenResearchEvidenceEmpty")
        }

        Button {
            Task { await refreshResearchTechnicalEvidence() }
        } label: {
            Label(
                isRefreshingResearchTechnicalEvidence
                    ? "正在刷新并核对真实日线"
                    : "刷新当前真实日线证据",
                systemImage: "arrow.triangle.2.circlepath"
            )
        }
        .buttonStyle(.borderedProminent)
        .disabled(
            isRefreshingResearchTechnicalEvidence
                || frozenResearchEvidenceWorkspace.isBusy
                || twoLayerReportWorkspace.isBusy
                || submissionState.isInFlight
                || selectedMembership == nil
                || selectedMembership?.state == .archived
        )
        .accessibilityIdentifier("refreshRealResearchTechnicalEvidenceButton")

        Button {
            Task {
                await loadResearchTechnicalEvidence()
                await loadResearchValuationScenarios()
                await loadFrozenResearchEvidence()
            }
        } label: {
            Label("重新读取技术与冻结历史", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .disabled(
            isRefreshingResearchTechnicalEvidence
                || frozenResearchEvidenceWorkspace.isBusy
        )
        .accessibilityIdentifier("refreshFrozenResearchEvidenceButton")

    }

    @ViewBuilder
    func independentTechnicalSnapshotSection() -> some View {
        let identity = currentTechnicalSnapshotConfirmationIdentity
        VStack(alignment: .leading, spacing: 8) {
            Text("单独保存技术判断").font(.headline)
            Text("这份确认只保存当前完成周线与人工区域版本。完整研究证据包仍须另行满足两种估值、研究材料与日线条件。")
                .font(.caption).foregroundStyle(.secondary)
            if let identity {
                Text("机器结果 \(identity.weinstein.resultHash.prefix(12))… · 完成周 \(identity.weinstein.completedWeekEnd) · 人工区域 v\(identity.ownerZones.version)")
                    .font(.caption.monospacedDigit())
                Text("人工理由：\(identity.ownerZones.reason)")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("请先读取当日有效周线，并填写与该结果精确绑定的人工区域、正整数版本和理由。")
                    .font(.caption).foregroundStyle(.orange)
            }
            Toggle("我明确确认保存这份技术快照", isOn: Binding(
                get: { identity != nil && frozenResearchEvidenceWorkspace.technicalSnapshotConfirmedIdentity == identity },
                set: { confirmed in
                    frozenResearchEvidenceWorkspace.technicalSnapshotConfirmedIdentity = confirmed ? identity : nil
                    frozenResearchEvidenceWorkspace.technicalSnapshotReservation.clear()
                }
            ))
            .disabled(identity == nil || frozenResearchEvidenceWorkspace.technicalSnapshotRequests.isBusy)
            .accessibilityIdentifier("confirmIndependentTechnicalSnapshot")
            Button {
                Task { await saveCurrentTechnicalSnapshot() }
            } label: {
                Label(frozenResearchEvidenceWorkspace.technicalSnapshotRequests.isSaving
                    ? "正在保存并核对" : "确认并保存技术快照", systemImage: "checkmark.seal")
            }
            .buttonStyle(.borderedProminent)
            .disabled(identity == nil
                || frozenResearchEvidenceWorkspace.technicalSnapshotConfirmedIdentity != identity
                || frozenResearchEvidenceWorkspace.technicalSnapshotRequests.isBusy
                || frozenResearchEvidenceWorkspace.isBusy)
            .accessibilityIdentifier("saveIndependentTechnicalSnapshot")
            Text(frozenResearchEvidenceWorkspace.technicalSnapshotMessage)
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("independentTechnicalSnapshotMessage")
            if let membership = selectedMembership,
               frozenResearchEvidenceWorkspace.technicalSnapshotHistoryMembershipKey
                    == FrozenResearchEvidenceWorkspaceState.technicalSnapshotMembershipKey(membership) {
                let materials = frozenResearchEvidenceWorkspace.technicalSnapshotMaterials.sorted {
                    (Int($0.id) ?? 0) > (Int($1.id) ?? 0)
                }
                if !materials.isEmpty {
                    DisclosureGroup("已保存技术快照与历史 · \(materials.count)") {
                        ForEach(materials) { material in
                            if let content = try? JSONDecoder().decode(
                                IndependentWeinsteinTechnicalConfirmationContent.self,
                                from: Data(material.contentText.utf8)
                            ), content.validates(material: material, membership: membership) {
                                DisclosureGroup("材料 #\(material.id) · Owner v\(content.ownerWeinsteinZones.version)") {
                                    VStack(alignment: .leading, spacing: 7) {
                                        Text(content.machine.resultHash == researchWeinsteinEnvelope?.resultHash
                                            ? "与当前读取的机器结果相同" : "已存机器版本；当前结果可能已变化")
                                            .font(.caption.weight(.semibold)).foregroundStyle(.orange)
                                        Text("Owner 确认于 \(content.confirmedAt) · 原计算结果 \(content.ownerWeinsteinZones.basedOn.resultHash)")
                                            .font(.caption2).foregroundStyle(.secondary)
                                        Text("人工理由：\(content.ownerWeinsteinZones.reason)")
                                            .font(.caption)
                                        Text("人工支撑：\(content.ownerWeinsteinZones.supportZones.map { "\($0.lower)–\($0.upper)" }.joined(separator: "、")) · 人工阻力：\(content.ownerWeinsteinZones.resistanceZones.map { "\($0.lower)–\($0.upper)" }.joined(separator: "、"))")
                                            .font(.caption)
                                        WeinsteinDecisionSummaryView(envelope: content.machine,
                                            label: "已保存机器原始判断 · 不含 Owner 调分")
                                    }.padding(.top, 5)
                                }
                            } else {
                                Text("材料 #\(material.id) 的技术快照未通过原文校验；不作为已确认版本显示。")
                                    .font(.caption).foregroundStyle(.orange)
                            }
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("independentTechnicalSnapshotSection")
    }

    @ViewBuilder
    private func pendingNoticeLeadCard(_ handoff: NoticeLeadResearchHandoff) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("待人工核验的 OpenD 信息线索")
                .font(.headline)
            Text(handoff.item.title)
                .font(.callout.weight(.semibold))
            Text("来源 \(handoff.item.source) · 发布 \(handoff.item.publishedAt) · OpenD 读取 \(handoff.fetchedAt)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("这仍是未核验元数据，不会自动进入证据。打开 HTTPS 来源后，预填表单、补充事实摘要并勾选人工确认，才可显式保存。")
                .font(.caption)
                .foregroundStyle(.orange)
            HStack {
                if let url = handoff.item.externalURL {
                    Link("打开来源", destination: url)
                        .buttonStyle(.bordered)
                }
                Button("预填核验表单") {
                    prepareNoticeLeadForVerification(handoff)
                }
                .buttonStyle(.borderedProminent)
                Button("取消") {
                    pendingNoticeLead = nil
                    resetResearchEventCapture("已取消 OpenD 线索；没有写入服务器。")
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchPendingNoticeLead")
    }

    @ViewBuilder
    private func researchAnnouncementEventsSection() -> some View {
        let events = frozenResearchEvidenceWorkspace.envelope?.data?.events ?? []
        let materials = frozenResearchEvidenceWorkspace.envelope?.data?.materials ?? []
        VStack(alignment: .leading, spacing: 10) {
            Text("官方事件与材料")
                .font(.headline)
            Text("这里汇总已经核对并绑定到当前研究档案的事件与材料；只影响研究假设，不自动生成建议或决定。")
                .font(.caption)
                .foregroundStyle(.secondary)
            ResearchMonitorRulesStatus(rules: envelope.data?.profile.monitorRules ?? [], events: events, materials: materials) { rule in
                guard rule.enabled, currentResearchEventVariables.contains(rule.variableName) else {
                    researchEventMessage = "监控规则或关键变量已变化；请重新读取研究档案。"; return
                }
                researchEventDraft.reset(preserving: rule.variableName)
                researchEventDraft.bindMonitorRule(rule)
                researchEventMaterialReservation.clear(); researchEventBindingReservation.clear()
                isResearchEventCaptureExpanded = true; pendingDecisionWorkspaceScrollTarget = "researchAnnouncementEvents"
                researchEventMessage = "已绑定监控变量“\(rule.variableName)”；请填写实际发生的事实、HTTPS 来源并人工核验。"
            }
            if events.isEmpty {
                Text("尚无已录入并验证绑定的研究事件。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(events) { event in
                    if let material = materials.first(where: { $0.id == event.source.materialId }) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(material.title)
                                .font(.callout.weight(.semibold))
                            Text("\(researchEventKindLabel(event.eventKind)) · \(researchEventImportanceLabel(event.importance)) · 对假设 \(researchEventImpactLabel(event.hypothesisImpact))")
                                .font(.caption)
                            if let rule = event.monitorRuleBinding {
                                Text("监控规则 v\(rule.version ?? 0) · \(rule.category) · 阈值：\(rule.threshold) · 理由：\(rule.reason)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Text(material.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("来源 \(researchMaterialSourceLabel(material.sourceType)) · 披露时间 \(material.publishedAt ?? "未知") · 材料保存 \(material.capturedAt)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let rawUrl = material.sourceUrl, let url = URL(string: rawUrl), url.scheme == "https" {
                                Link("打开对应来源", destination: url)
                                    .buttonStyle(.bordered)
                            }
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("researchAnnouncementEvent-\(event.id)")
                    }
                }
            }
            let leads = materials.filter {
                $0.sourceType == ResearchEventCaptureDraft.exchangeAnnouncementLeadSourceType
                    && $0.revisionState == "current"
            }
            if !leads.isEmpty {
                DisclosureGroup("待核验公告线索 \(leads.count) 项") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(leads) { lead in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(lead.title).font(.caption.weight(.semibold))
                                Text("发布 \(lead.publishedAt) · 仅为未核验元数据，不是判断或证据")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                HStack {
                                    if let raw = lead.sourceUrl, let url = URL(string: raw), url.scheme == "https" {
                                        Link("打开来源", destination: url)
                                            .buttonStyle(.bordered)
                                    }
                                    Button("预填核验表单") { prepareAnnouncementLeadForVerification(lead) }
                                        .buttonStyle(.bordered)
                                }
                            }
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("researchAnnouncementLead-\(lead.id)")
                        }
                    }
                    .padding(.top, 6)
                }
                .accessibilityIdentifier("researchAnnouncementLeads")
            }
            researchEventCaptureForm()
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchAnnouncementEvents")
    }

    @MainActor
    func prepareAnnouncementLeadForVerification(_ lead: ResearchMaterialData) {
        guard let membership = selectedMembership,
              lead.symbol == membership.symbol,
              let target = frozenResearchEvidenceWorkspace.envelope?.data?.target,
              target.membershipId == membership.id,
              target.membershipVersion == membership.version,
              researchEventDraft.prepareForVerification(lead, variableName: "") else {
            researchEventMessage = "公告线索与当前研究成员不一致或已过期；请重新读取同一研究档案再预填。"
            return
        }
        researchEventMaterialReservation.clear(); researchEventBindingReservation.clear()
        isResearchEventCaptureExpanded = true; pendingDecisionWorkspaceScrollTarget = "researchAnnouncementEvents"
        researchEventMessage = "已预填线索标题、来源与日期；它仍是未核验元数据，请选择关键变量并填写你核对的事实摘要。"
    }

    @ViewBuilder
    private func researchEventCaptureForm() -> some View {
        let variables = currentResearchEventVariables
        DisclosureGroup("录入事件、风险或反证", isExpanded: $isResearchEventCaptureExpanded) {
            VStack(alignment: .leading, spacing: 10) {
                if let replaced = researchEventDraft.replacementMaterial {
                    Label("将替代当前材料 #\(replaced.id)；来源类型与 HTTPS 已锁定，新来源版本与摘要仍需你填写。", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                    Button("取消替代") {
                        researchEventDraft.reset(
                            preserving: researchEventDraft.variableName,
                            coverageScope: researchEventDraft.coverageScope
                        )
                        researchEventMessage = "已取消替代；没有写入服务器。"
                    }
                    .buttonStyle(.bordered)
                }
                if variables.isEmpty {
                    Text("请先在研究档案中填写至少一个关键变量；事件必须精确绑定变量后才能进入证据链。")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    if let rule = researchEventDraft.monitorRuleBinding {
                        Text("已锁定正式监控规则 v\(rule.version ?? 0)：\(rule.variableName) · \(rule.category) · 阈值 \(rule.threshold)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Picker("资料类型", selection: $researchEventDraft.eventKind) {
                        Text("正式公告").tag("announcement")
                        Text("财务报告").tag("financial_report")
                        Text("公司行动").tag("corporate_action")
                        Text("重大新闻").tag("major_news")
                        Text("其他已核对事件").tag("news")
                    }
                    .pickerStyle(.menu)
                    .disabled(researchEventDraft.monitorRuleBinding != nil)
                    Picker("影响范围", selection: $researchEventDraft.coverageScope) {
                        Text("研究标的").tag("research_stock")
                        Text("当前持仓").tag("current_holding")
                    }
                    .pickerStyle(.segmented)
                    .disabled(researchEventDraft.monitorRuleBinding != nil)
                    .accessibilityIdentifier("researchEventCoverageScope")
                    if researchEventDraft.coverageScope == "current_holding" {
                        currentHoldingEventSourceIdentity
                    }
                    Picker("绑定关键变量", selection: $researchEventDraft.variableName) {
                        ForEach(variables, id: \.self) { Text($0).tag($0) }
                    }
                    .disabled(researchEventDraft.monitorRuleBinding != nil)
                    TextField("标题", text: $researchEventDraft.title)
                        .accessibilityIdentifier("researchEventTitle")
                    TextField("已核对事实摘要", text: $researchEventDraft.summary, axis: .vertical)
                        .accessibilityIdentifier("researchEventSummary")
                    TextField("精确 HTTPS 来源", text: $researchEventDraft.sourceURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .disabled(researchEventDraft.replacementMaterial != nil)
                        .accessibilityIdentifier("researchEventSourceURL")
                    if researchEventDraft.replacementMaterial != nil {
                        TextField("新来源版本（必须不同于当前版本）", text: $researchEventDraft.replacementSourceVersion)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    DatePicker("发布时间", selection: $researchEventDraft.publishedAt, in: ...Date())
                    DatePicker("资料有效至", selection: $researchEventDraft.validUntil, in: researchEventDraft.publishedAt...)
                    Picker("对当前假设", selection: $researchEventDraft.stance) {
                        Text("支持").tag("support")
                        Text("削弱 / 反证").tag("refute")
                        Text("中性待核实").tag("neutral")
                    }
                    .pickerStyle(.segmented)
                    Stepper("来源可靠性 \(researchEventDraft.reliability) / 5", value: $researchEventDraft.reliability, in: 1...5)
                    Stepper("事项重要性 \(researchEventDraft.materiality) / 5", value: $researchEventDraft.materiality, in: 1...5)
                    Toggle("我已打开并核对该来源，确认摘要与来源一致", isOn: $researchEventDraft.ownerVerified)
                        .accessibilityIdentifier("researchEventOwnerVerified")
                    Button {
                        Task { await saveVerifiedResearchEvent() }
                    } label: {
                        Label(isSavingResearchEvent ? "正在保存并核对" : "保存材料并绑定研究事件", systemImage: "link.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSaveVerifiedResearchEvent)
                    .accessibilityIdentifier("saveVerifiedResearchEvent")
                }
                Text(researchEventMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchEventMessage")
                Text("只保存你的研究材料与事件；不会确认报告、形成正式决定、修改资产或发起交易。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            .padding(.top, 8)
            .onChange(of: variables, initial: true) { _, newVariables in
                if !newVariables.contains(researchEventDraft.variableName) {
                    researchEventDraft.variableName = newVariables.first ?? ""
                }
            }
        }
        .id("researchAnnouncementEvents")
        .accessibilityIdentifier("researchEventCapture")
    }

    var currentResearchEventVariables: [String] {
        guard let membership = selectedMembership,
              membership.state == .tracked,
              envelope.requestedSymbol == membership.symbol else { return [] }
        return envelope.data?.profile.keyVariables ?? []
    }

    var canSaveVerifiedResearchEvent: Bool {
        guard !isSavingResearchEvent,
              !frozenResearchEvidenceWorkspace.isBusy,
              !twoLayerReportWorkspace.isBusy,
              let membership = selectedMembership else { return false }
        if researchEventDraft.coverageScope == "current_holding",
           !currentHoldingEventSourceIsExact(for: membership.symbol) { return false }
        if let replacement = researchEventDraft.replacementMaterial,
           !currentEvidenceConflictMaterials.contains(replacement) { return false }
        if researchEventDraft.monitorRuleBinding != nil,
           currentResearchEventMonitorRuleBinding == nil { return false }
        return researchEventDraft.materialRequest(
            membership: membership,
            allowedVariables: currentResearchEventVariables,
            idempotencyKey: "preview"
        ) != nil
    }

    var currentResearchEventMonitorRuleBinding: ResearchMonitorRule? {
        guard researchEventDraft.coverageScope == "research_stock",
              let binding = researchEventDraft.monitorRuleBinding,
              binding.binds(eventKind: researchEventDraft.eventKind, variableName: researchEventDraft.variableName)
        else { return nil }
        return (envelope.data?.profile.monitorRules)?.first(where: { $0 == binding })
    }

    @MainActor
    func resetResearchEventCapture(_ message: String) {
        isSavingResearchEvent = false
        researchEventDraft = ResearchEventCaptureDraft()
        researchEventMaterialReservation.clear()
        researchEventBindingReservation.clear()
        researchEventMessage = message
        resetGeelySalesMonitorCapture("研究来源已变化；旧销量监测草稿已清除。")
        resetGclPvPriceMonitorCapture("研究来源已变化；旧光伏监测草稿已清除。")
    }

    private func researchEventKindLabel(_ value: String) -> String {
        switch value {
        case "announcement": "正式公告"
        case "financial_report": "财务报告"
        case "corporate_action": "公司行动"
        case "major_news": "重大新闻"
        default: "新闻事件（旧分类）"
        }
    }

    private func researchEventImportanceLabel(_ value: String) -> String {
        switch value {
        case "high": "重要性高"
        case "medium": "重要性中"
        case "low": "重要性低"
        default: "重要性待确认"
        }
    }

    private func researchEventImpactLabel(_ value: String) -> String {
        switch value {
        case "supports": "提供支持证据"
        case "weakens": "形成削弱证据"
        default: "影响待确认"
        }
    }

    private func researchMaterialSourceLabel(_ value: String) -> String {
        switch value {
        case "issuer_disclosure": "发行人正式披露"
        case "owner_provided_pdf": "你提供的 PDF"
        case "futu_opend_financial_statement_provider": "OpenD 提供商原值（第三方未核实）"
        case "owner_verified_announcement": "你核对的公告"
        case "owner_verified_financial_report": "你核对的财务报告"
        case "owner_verified_corporate_action": "你核对的公司行动"
        case "owner_verified_major_news": "你核对的重大新闻"
        case "owner_verified_news": "你核对的新闻"
        case "owner_verified_holding_logic": "你核对的持仓逻辑"
        default: "已记录研究来源"
        }
    }
    private func frozenResearchEvidencePackCard(_ pack: FrozenResearchEvidencePack) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("研究证据版本 #\(pack.id) · v\(pack.version)").font(.headline)
                Spacer()
                Text(pack.currentness.status == "current" ? "当前版本" : "历史版本").font(.caption.weight(.bold)).foregroundStyle(pack.currentness.status == "current" ? .green : .orange)
            }
            Text(pack.currentness.status == "current" ? "这是当前报告使用的冻结证据版本。" : "研究来源、财务期数核对或计算依据已变化；这个版本只供回看。").font(.callout).foregroundStyle(pack.currentness.status == "current" ? Color.primary : Color.orange)
            if let context = pack.frozenResearchContext {
                let sourceGaps = [("宏观", context.unboundSources.macro), ("行业", context.unboundSources.industry), ("事件", context.unboundSources.event), ("风险", context.unboundSources.risk), ("反证", context.unboundSources.counterevidence)]
                let boundSourceCount = sourceGaps.filter { $0.1.status == "bound" }.count
                let scenario = context.valuationScenario
                let valuationMethods = context.valuationMethods ?? scenario.map { [$0] } ?? []
                let selected = context.selectedValuationMethods ?? []
                let technical = context.technical
                Text("估值方法 \(selected.isEmpty ? valuationMethods.count : selected.count) 种 · 技术截至 \(technical.dailyBars.source.dataCutoffAt ?? "未记录")").font(.caption).foregroundStyle(.secondary)
                if scenario != nil {
                    Button { Task { await openFrozenResearchEvidenceSource(pack) } } label: { Label("打开已存原文引用", systemImage: "doc.richtext") }.buttonStyle(.bordered).accessibilityIdentifier("openFrozenResearchPackSource-\(pack.id)")
                }
                InfoBlock(title: "五类来源覆盖", value: "已绑定（bound）\(boundSourceCount)/5 · 缺失（source_missing）\(5 - boundSourceCount)/5", valueIdentifier: "frozenResearchPackSourceCoverageSummary-\(pack.id)")
                DisclosureGroup("来源与版本详情") {
                    VStack(alignment: .leading, spacing: 8) {
                        InfoBlock(title: "绑定信息", value: "研究成员 #\(pack.membershipId) v\(pack.membershipVersion) · \(pack.symbol) · 冻结于 \(pack.frozenAt)", valueIdentifier: "frozenResearchPackIdentity-\(pack.id)")
                        InfoBlock(title: "版本状态", value: pack.currentness.invalidatedBy.isEmpty ? "来源已逐项核对" : "失效原因：\(pack.currentness.invalidatedBy.map { $0 == "financial_requirement_changed" ? "财务资料期数核对已变化或过期，需重新冻结" : $0 }.joined(separator: ", "))", valueIdentifier: "frozenResearchPackCurrentness-\(pack.id)")
                        InfoBlock(
                            title: "研究上下文版本",
                            value: context.researchContext.map { "context=\($0.id) · cutoff=\($0.cutoffAt) · validUntil=\($0.validUntil) · sha256:\($0.contentHash)" }
                                ?? "历史证据包未记录上下文绑定 · UNKNOWN",
                            valueIdentifier: "frozenResearchPackContext-\(pack.id)"
                        )
                        InfoBlock(
                            title: "财务资料期数核对",
                            value: context.financialRequirement.map {
                                "已绑定 #\($0.id) · 年度至 \($0.latestRequiredAnnualPeriodEnd) · 中期至 \($0.latestRequiredInterimPeriodEnd) · 有效至 \($0.validUntil)"
                            } ?? "未绑定有来源的期数核对 · UNKNOWN",
                            valueIdentifier: "frozenResearchPackFinancialRequirement-\(pack.id)"
                        )
                        InfoBlock(title: "估值方法", value: selected.isEmpty
                            ? valuationMethods.map { "\($0.calculation.method.id) · #\($0.id) r\($0.revision) · \($0.calculation.method.calculationVersion)" }.joined(separator: "\n")
                            : selected.map { method in
                                switch method {
                                case .provider(let value): return "OpenD PE · #\(value.id) r\(value.revision) · \(value.assumptions.values.metricCurrency ?? "UNKNOWN") · 第三方来源"
                                case .fcff(let value): return "FCFF · #\(value.id) r\(value.revision) · \(value.calculation.currency) · 截止 \(value.calculation.valuationCutoff)"
                                }
                            }.joined(separator: "\n"), valueIdentifier: "frozenResearchPackScenario-\(pack.id)")
                        if let scenario {
                            let source = scenario.anchor.source
                            InfoBlock(title: "估值币种与我的假设", value: frozenAssumptionText(scenario.assumptions.values), valueIdentifier: "frozenResearchPackAssumptions-\(pack.id)")
                            InfoBlock(title: "原文引用", value: source.kind == "source_snapshot"
                                ? "anchor=\(scenario.anchor.id) · material=\(source.materialId) r\(source.materialRevision) · snapshot=\(source.snapshotCitation?.snapshotId ?? "未知") · raw=\(source.snapshotOriginal?.rawSha256 ?? "未知") · excerpt=\(source.snapshotCitation?.excerptSha256 ?? "未知")"
                                : "anchor=\(scenario.anchor.id) · material=\(source.materialId) r\(source.materialRevision) · document=\(source.documentId ?? "未知") · pdf=\(source.documentPdfSha256 ?? "未知") · page=\(source.pageNumber.map(String.init) ?? "未知") · pageHash=\(source.pageTextSha256 ?? "未知")", valueIdentifier: "frozenResearchPackSource-\(pack.id)")
                        } else if case .provider(let provider) = selected.first {
                            InfoBlock(title: "OpenD 原件与材料", value: "EPS capture #\(provider.providerBasis.eps.financialCaptureId) raw \(provider.providerBasis.eps.rawSha256) · PE capture #\(provider.providerBasis.valuation.captureId) raw \(provider.providerBasis.valuation.rawSha256) · material #\(provider.providerBasis.sourceMaterialId) r\(provider.providerBasis.sourceMaterialRevision) sha \(provider.providerBasis.sourceMaterialFingerprint)", valueIdentifier: "frozenResearchPackSource-\(pack.id)")
                        }
                        InfoBlock(title: "技术指标版本", value: "截止 \(technical.dailyBars.source.dataCutoffAt ?? "未记录") · 调整 \(technical.dailyBars.request.adjustment) · 公式 \(technical.technical.computationVersion) · 快照 \(technical.dailyBars.snapshot?.snapshotSha ?? "未记录") · 结果 \(technical.technical.resultHash ?? "未记录")", valueIdentifier: "frozenResearchPackTechnical-\(pack.id)")
                        InfoBlock(title: "Weinstein 周线版本", value: "分析日 \(context.weinstein.analysisAsOf) · 完成周 \(context.weinstein.completedWeekEnd) · 行业身份 \(context.weinstein.sectorIdentityAsOf) · 数据集 \(context.weinstein.datasetHash) · 结果 \(context.weinstein.resultHash)", valueIdentifier: "frozenResearchPackWeinstein-\(pack.id)")
                        InfoBlock(title: "Owner 人工区域版本", value: context.ownerWeinsteinZones.map {
                            "v\($0.version) · 基于结果 \($0.basedOn.resultHash) · 支撑 \($0.supportZones.map { "\($0.lower)–\($0.upper)" }.joined(separator: "、")) · 阻力 \($0.resistanceZones.map { "\($0.lower)–\($0.upper)" }.joined(separator: "、")) · 理由：\($0.reason)"
                        } ?? "未随此证据包冻结人工区域；机器区域保持原样", valueIdentifier: "frozenResearchPackOwnerZones-\(pack.id)")
                        if let quant = context.quantPortfolio {
                            InfoBlock(
                                title: "量化与组合风险版本",
                                value: frozenQuantPortfolioText(quant),
                                valueIdentifier: "frozenResearchPackQuantPortfolio-\(pack.id)"
                            )
                        }
                        ForEach(Array(sourceGaps.enumerated()), id: \.offset) { index, source in InfoBlock(title: "\(source.0)来源", value: frozenResearchSourceText(source.1), valueIdentifier: "frozenResearchPackSourceCoverage-\(pack.id)-\(index)") }
                    }.padding(.top, 6)
                }
            } else {
                Text("这个历史证据版本没有绑定估值与技术事实，只供回看，不能当作当前版本。").font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("frozenResearchEvidencePack-\(pack.id)")
    }
    private func frozenResearchSourceText(_ source: FrozenResearchSourceGap) -> String { source.status == "bound" ? "bound · EVENT · event=\(source.eventId ?? "UNKNOWN") r\(source.eventVersion ?? 0) · fingerprint=\(source.eventFingerprint ?? "UNKNOWN") · material=\(source.materialId ?? "UNKNOWN") · evidence=\(source.evidenceId ?? "UNKNOWN") · variable=\(source.keyVariable ?? "UNKNOWN") · impact=\(source.hypothesisImpact ?? "unknown")" : "source_missing · UNKNOWN" }
    private func frozenQuantPortfolioText(_ value: FrozenQuantPortfolioEvidenceBinding) -> String {
        let decision = value.decision.status == "available"
            ? "个股量化 \(value.decision.refinementId ?? "UNKNOWN") · snapshot=\(value.decision.snapshotId ?? "UNKNOWN") · validUntil=\(value.decision.validUntil ?? "UNKNOWN")"
            : "个股量化 source_missing · \(value.decision.reason ?? "UNKNOWN")"
        let portfolio = value.portfolio.status == "available"
            ? "组合风险 \(value.portfolio.evidenceId ?? "UNKNOWN") · content=\(value.portfolio.contentHash ?? "UNKNOWN") · observations=\(value.portfolio.observationCount ?? 0) · stability=\(value.portfolio.stability ?? "UNKNOWN") · validUntil=\(value.portfolio.validUntil ?? "UNKNOWN")"
            : "组合风险 source_missing · \(value.portfolio.reason ?? "UNKNOWN")"
        return "\(decision)\n\(portfolio)\n仅供研究，不是正式持仓、配置或交易权限。"
    }
    private func frozenAssumptionText(_ value: AnnualValuationScenarioInput) -> String {
        [
            "metricCurrency=\(value.metricCurrency ?? "UNKNOWN")", "baseMetricPerShare=\(value.baseMetricPerShare)",
            "annualGrowthRate=\(value.annualGrowthRate)", "horizonYears=\(value.horizonYears)",
            "terminalMultiple=\(value.terminalMultiple)", "annualDiscountRate=\(value.annualDiscountRate)",
            "netCashPerShare=\(value.netCashPerShare)", "growthRateStep=\(value.growthRateStep)",
            "multipleStep=\(value.multipleStep)"
        ].joined(separator: " · ")
    }
}
