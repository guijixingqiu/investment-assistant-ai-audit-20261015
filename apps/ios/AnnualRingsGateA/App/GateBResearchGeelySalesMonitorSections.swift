import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func geelySalesMonitorSection() -> some View {
        if selectedMembership?.symbol == "HK.00175" {
            let monitor = frozenResearchEvidenceWorkspace.envelope?.data?.latestGeelySalesMonitor
            let events = currentGeelySalesSourceEvents
            VStack(alignment: .leading, spacing: 10) {
                Text("吉利月度销量监测")
                    .font(.headline)
                Text("把已核对事件中的月度销量表绑定成可复算监测；不完整数据保留 UNKNOWN，不会自动冻结、生成报告或决定。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let monitor {
                    Label(
                        "\(monitor.period) · \(geelySalesStatusLabel(monitor.assessment.status)) · \(monitor.observations.count) 条观察",
                        systemImage: monitor.assessment.trendConclusionAllowed ? "chart.line.uptrend.xyaxis" : "questionmark.circle"
                    )
                    .font(.callout.weight(.semibold))
                    Text("走势：\(geelySalesMovementLabel(monitor.assessment.movement)) · 监测 #\(monitor.id) v\(monitor.runVersion)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if !monitor.assessment.blockers.isEmpty {
                        DisclosureGroup("待补数据与不可比较项 · \(monitor.assessment.blockers.count)") {
                            ForEach(monitor.assessment.blockers, id: \.self) { Text("• \($0)").font(.caption) }
                        }
                    }
                    DisclosureGroup("观察与来源 · \(monitor.observations.count)") {
                        ForEach(Array(monitor.observations.enumerated()), id: \.offset) { _, observation in
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(observation.entityName) · \(observation.period) · \(observation.value.formatted()) \(observation.unit)")
                                    .font(.caption.weight(.semibold))
                                Text("\(observation.metric) / \(observation.propulsion) / \(observation.geography) / \(observation.channel) · event #\(observation.eventId)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                if let rawURL = observation.sourceEvent.sourceUrl,
                                   let url = URL(string: rawURL), url.scheme == "https" {
                                    Link("打开绑定来源", destination: url).font(.caption)
                                }
                            }
                            .padding(.vertical, 3)
                        }
                    }
                } else {
                    Text("尚无当前销量监测。先录入并核对 new_energy_vehicle_sales 事件，再保存监测。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                DisclosureGroup("录入或更新销量监测") {
                    VStack(alignment: .leading, spacing: 10) {
                        if events.isEmpty {
                            Text("当前 HK.00175 workspace 没有可用的 new_energy_vehicle_sales 研究事件；请先在上方录入并核对来源。")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        } else {
                            DisclosureGroup("当前可引用事件 · \(events.count)") {
                                ForEach(events) { event in
                                    Text("#\(event.id) · \(event.source.publishedAt) · \(event.hypothesisImpact)")
                                        .font(.caption)
                                }
                            }
                            Button("添加吉利观察") {
                                geelySalesMonitorDraft.appendTarget(eventId: events[0].id)
                                geelySalesMonitorMessage = "已添加一条吉利观察；填写数值并按需要复制为上月、去年同期或新能源口径。"
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("addGeelySalesTargetObservation")
                        }
                        TextField("监测月份（YYYY-MM）", text: $geelySalesMonitorDraft.period)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("geelySalesMonitorPeriod")
                        if geelySalesMonitorDraft.observations.isEmpty {
                            ContentUnavailableView(
                                "尚未添加观察",
                                systemImage: "tablecells",
                                description: Text("先添加一条吉利观察；数据不完整时监测会保持 UNKNOWN。")
                            )
                        } else {
                            ForEach($geelySalesMonitorDraft.observations) { $observation in
                                geelySalesObservationEditor($observation, events: events)
                            }
                        }
                        Button("添加其他实体或行业观察") {
                            geelySalesMonitorDraft.appendBlank()
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("addGeelySalesObservation")
                        Text("一条观察会绑定一个已核对来源。可复制后改成上月、去年同期、新能源、出口或同业口径；缺项会保留 UNKNOWN。")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Toggle("我已核对来源、期间、口径与数值", isOn: $geelySalesMonitorDraft.ownerConfirmed)
                            .accessibilityIdentifier("geelySalesMonitorOwnerConfirmed")
                        Button {
                            Task { await saveGeelySalesMonitor() }
                        } label: {
                            Label(isSavingGeelySalesMonitor ? "正在保存并核对" : "保存销量监测", systemImage: "chart.xyaxis.line")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canSaveGeelySalesMonitor)
                        .accessibilityIdentifier("saveGeelySalesMonitor")
                        Text(geelySalesMonitorMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("geelySalesMonitorMessage")
                        Text("只写研究监测；不会自动冻结证据、综合报告、确认结论、修改资产或发起交易。")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                    .padding(.top, 8)
                }
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("geelySalesMonitorSection")
        }
    }

    private var currentGeelySalesSourceEvents: [ResearchAnnouncementEventData] {
        guard let membership = selectedMembership, membership.state == .tracked,
              membership.symbol == "HK.00175" else { return [] }
        return (frozenResearchEvidenceWorkspace.envelope?.data?.events ?? []).filter {
            $0.coverageScope == "research_stock" && $0.keyVariable == "new_energy_vehicle_sales"
                && $0.source.freshness == "fresh" && $0.source.revisionState == "current"
                && $0.source.verificationStatus == "verified"
                && ["user_provided", "authorized_public"].contains($0.source.rightsStatus)
        }
    }

    @ViewBuilder
    private func geelySalesObservationEditor(
        _ observation: Binding<GeelySalesObservationDraft>,
        events: [ResearchAnnouncementEventData]
    ) -> some View {
        let row = observation.wrappedValue
        DisclosureGroup("\(geelySalesRoleLabel(row.entityRole)) · \(row.entityName.isEmpty ? "未命名实体" : row.entityName) · \(row.period)") {
            VStack(alignment: .leading, spacing: 10) {
                Picker("观察对象", selection: observation.entityRole) {
                    Text("吉利汽车").tag("target")
                    Text("同业公司").tag("peer")
                    Text("行业整体").tag("industry")
                }
                .onChange(of: observation.wrappedValue.entityRole) { _, role in
                    if role == "industry" {
                        observation.wrappedValue.entityLevel = "industry"
                        observation.wrappedValue.issuerId = ""
                    } else if observation.wrappedValue.entityLevel == "industry" {
                        observation.wrappedValue.entityLevel = "issuer"
                    }
                    geelySalesMonitorDraft.ownerConfirmed = false
                }
                if row.entityRole == "target", !events.isEmpty {
                    Picker("绑定已核对来源", selection: observation.eventId) {
                        ForEach(events) { event in
                            Text("事件 #\(event.id) · \(event.source.publishedAt)").tag(event.id)
                        }
                    }
                } else {
                    TextField("已核对来源事件编号", text: observation.eventId)
                        .keyboardType(.numberPad)
                    Text("同业或行业观察可绑定其他 tracked 研究标的中已核对的 research_stock 事件。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                TextField("实体名称", text: observation.entityName)
                TextField("实体标识（英文小写）", text: observation.entityId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if row.entityRole != "industry" {
                    Picker("实体层级", selection: observation.entityLevel) {
                        Text("上市主体").tag("issuer")
                        Text("品牌").tag("brand")
                        Text("车型").tag("model")
                    }
                    if row.entityLevel != "issuer" {
                        TextField("所属上市主体标识", text: observation.issuerId)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                Picker("期间类型", selection: observation.periodKind) {
                    Text("单月").tag("month")
                    Text("年初至今").tag("year_to_date")
                }
                .onChange(of: observation.wrappedValue.periodKind) { _, kind in
                    observation.wrappedValue.period = geelySalesMonitorDraft.allowedPeriods(for: kind).first ?? geelySalesMonitorDraft.period
                    geelySalesMonitorDraft.ownerConfirmed = false
                }
                Picker("数据期间", selection: observation.period) {
                    ForEach(geelySalesMonitorDraft.allowedPeriods(for: row.periodKind), id: \.self) {
                        Text(geelySalesPeriodLabel($0, runPeriod: geelySalesMonitorDraft.period)).tag($0)
                    }
                }
                Picker("指标", selection: observation.metric) {
                    Text("销量").tag("sales_volume")
                    Text("平均成交价").tag("average_transaction_price")
                }
                Picker("动力类型", selection: observation.propulsion) {
                    Text("全部车型").tag("all")
                    Text("新能源").tag("new_energy")
                }
                Picker("地区", selection: observation.geography) {
                    Text("全球").tag("global")
                    Text("中国").tag("china")
                    Text("出口").tag("export")
                }
                Picker("统计渠道", selection: observation.channel) {
                    Text("批发").tag("wholesale")
                    Text("零售").tag("retail")
                    Text("交付").tag("deliveries")
                    Text("注册").tag("registrations")
                }
                TextField("统计口径标识（防止混用）", text: observation.definitionKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField(row.metric == "sales_volume" ? "数值（辆）" : "数值（人民币/辆）", text: observation.value)
                    .keyboardType(.decimalPad)
                DailyResponsiveActionGroup {
                    Button("复制观察") { geelySalesMonitorDraft.duplicate(row.id) }
                    Button("删除", role: .destructive) { geelySalesMonitorDraft.remove(row.id) }
                }
                .buttonStyle(.bordered)
            }
            .padding(.top, 8)
        }
        .accessibilityIdentifier("geelySalesObservationRow")
    }

    private var canSaveGeelySalesMonitor: Bool {
        guard !isSavingGeelySalesMonitor, !isSavingResearchEvent,
              !frozenResearchEvidenceWorkspace.isBusy, !twoLayerReportWorkspace.isBusy,
              twoLayerReportWorkspace.pendingSynthesisTask == nil,
              let membership = selectedMembership else { return false }
        return geelySalesMonitorDraft.request(membership: membership, idempotencyKey: "preview") != nil
    }

    @MainActor
    private func saveGeelySalesMonitor() async {
        guard canSaveGeelySalesMonitor, let membership = selectedMembership else { return }
        let authorizationRevision = viewModel.authorizationRevision
        let context = AppEnvironment.researchAuthorizationContext()
        let fingerprint = "\(membership.id)|\(membership.version)|\(geelySalesMonitorDraft.fingerprint)"
        let key = geelySalesMonitorReservation.reserve(for: fingerprint, prefix: "ios-geely-sales-monitor")
        guard let request = geelySalesMonitorDraft.request(membership: membership, idempotencyKey: key) else { return }
        isSavingGeelySalesMonitor = true
        frozenResearchEvidenceWorkspace.envelope = nil
        frozenResearchEvidenceWorkspace.setOwnerConfirmation(false, for: currentFrozenResearchBindingIdentity)
        clearTodayResearch("销量监测写入中；旧 Today 事项已清除。", membershipId: membership.id)
        invalidateTwoLayerReport("销量监测写入中；旧冻结包与报告不得冒充当前版本。")
        defer { isSavingGeelySalesMonitor = false }
        do {
            let result = try await client.createGeelySalesMonitorAndReadBack(
                membership: membership,
                requestBody: request
            )
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  selectedMembership?.actorId == membership.actorId,
                  parsedSymbol?.canonical == membership.symbol else {
                throw FrozenResearchEvidenceClientError.bindingDrift
            }
            await loadTodayResearch(for: membership)
            let geelyRefs = todayResearch.items.compactMap(\.bindings.monitorRef).filter { $0.kind == "geely_sales" }
            guard todayResearch.status == .available,
                  geelyRefs.allSatisfy({
                      $0.id == result.monitor.id && $0.runVersion == result.monitor.runVersion
                          && $0.runFingerprint == result.monitor.runFingerprint
                  }) else {
                throw FrozenResearchEvidenceClientError.invalidResponse
            }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            frozenResearchEvidenceWorkspace.message = "销量监测 #\(result.monitor.id) 已 fresh read；请明确重新冻结证据后再生成报告。"
            geelySalesMonitorReservation.clear()
            geelySalesMonitorDraft = GeelySalesMonitorDraft()
            geelySalesMonitorMessage = "销量监测 #\(result.monitor.id) 已保存并核对 workspace 与 Today；旧报告仍保持失效。"
            pendingDecisionWorkspaceScrollTarget = "freezeResearchEvidenceButton"
            todayRefreshRevision &+= 1
        } catch {
            frozenResearchEvidenceWorkspace.envelope = nil
            clearTodayResearch("销量监测未取得完整 fresh readback；未展示旧 Today 事项。", membershipId: membership.id)
            invalidateTwoLayerReport("销量监测未取得完整 fresh readback；旧报告继续隐藏。")
            geelySalesMonitorMessage = "保存未完整确认；输入与幂等身份已保留。请重新读取来源后明确重试，不会重复写入同一监测。"
        }
    }

    @MainActor
    func resetGeelySalesMonitorCapture(_ message: String) {
        isSavingGeelySalesMonitor = false
        geelySalesMonitorDraft = GeelySalesMonitorDraft()
        geelySalesMonitorReservation.clear()
        geelySalesMonitorMessage = message
    }

    private func geelySalesStatusLabel(_ value: String) -> String {
        switch value {
        case "comparable": "可比较"
        case "incomparable": "不可比较"
        default: "数据不足 / UNKNOWN"
        }
    }

    private func geelySalesRoleLabel(_ value: String) -> String {
        switch value {
        case "target": "吉利汽车"
        case "peer": "同业公司"
        default: "行业整体"
        }
    }

    private func geelySalesPeriodLabel(_ value: String, runPeriod: String) -> String {
        if value == runPeriod { return "本期 · \(value)" }
        let monthPeriods = geelySalesMonitorDraft.allowedPeriods(for: "month")
        if monthPeriods.dropFirst().first == value { return "上月 · \(value)" }
        return "去年同期 · \(value)"
    }

    private func geelySalesMovementLabel(_ value: String) -> String {
        switch value {
        case "industry_common_up": "行业共同上升"
        case "industry_common_down": "行业共同下降"
        case "company_specific_outperformance": "吉利相对更强"
        case "company_specific_underperformance": "吉利相对更弱"
        case "mixed": "信号混合"
        default: "暂不能判断 / UNKNOWN"
        }
    }
}
