import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func researchValuationScenarioSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("带引用的估值情景")
                    .font(OwnerReadingFont.title3.bold())
                Spacer()
                Button {
                    Task { await loadResearchValuationScenarios() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(
                    researchValuationScenarioWorkspace.isBusy
                        || researchFundamentalWorkspace.isBusy
                        || selectedMembership == nil
                )
                .accessibilityLabel("刷新估值情景")
            }
            Text("先选有原文的公司数据口径。符合条件的母公司资产负债和同日普通股可形成 NAV/股草稿；核对并采用后，其余参数仍由你填写。结果不是预测、建议或自动交易信号。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)

#if OWNER_CLIENT
            if let envelope = researchValuationScenarioWorkspace.envelope {
                valuationScenarioReadBack(envelope)
            } else {
                Text("尚未读取到已保存的估值情景。")
                    .font(OwnerReadingFont.callout).foregroundStyle(.secondary)
            }
            NavigationLink {
                ClientReadingPage(title: "编辑估值假设") {
                    ClientCard(title: "方法与来源", icon: "function", tone: Theme.blue) {
                        valuationScenarioMethodPicker()
                        if currentValuationAnchors.isEmpty {
                            Text("尚无符合当前方法的原文事实锚点，请先在财务与经营中核对来源。")
                        } else { valuationScenarioEntryForm() }
                    }
                }
            } label: {
                ClientLinkLabel(title: "建立或修订估值情景", subtitle: "引用来源 · 个人假设 · 明确保存", icon: "slider.horizontal.3", tone: Theme.blue)
            }.buttonStyle(.plain)
#else
            valuationScenarioMethodPicker()

            if currentValuationAnchors.isEmpty {
                Text(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario"
                    ? "该方法需要当前、原文披露、来源新鲜，且报告日、币种、单位与范围一致的总资产和总负债原值。"
                    : "该方法需要当前、原文披露、口径可比且来源新鲜的收入或归母利润原值。")
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
            } else {
                valuationScenarioEntryForm()
            }

            if let envelope = researchValuationScenarioWorkspace.envelope {
                valuationScenarioReadBack(envelope)
            }
#endif
            providerValuationSection()
            fcffValuationSection()
            Text(researchValuationScenarioWorkspace.message)
                .font(OwnerReadingFont.callout)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchValuationScenarioMessage")
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .id("researchValuationScenarioAnchor")
    }

    @ViewBuilder
    private func providerValuationSection() -> some View {
        Divider()
        DisclosureGroup("提供商来源 EPS 与五年 PE/PB") {
            VStack(alignment: .leading, spacing: 9) {
                Text("富途 OpenD 数据是第三方未核实来源。历史 PE 均值仅供设定 Owner 假设时参考，不是合理倍数；CNY 情景不得直接与 HKD 报价比较。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                HStack {
                    Button("读取历史原件") { Task { await loadFutuValuationCaptures() } }
                    Button("获取五年 PE") { Task { await captureFutuValuation("PE") } }
                    Button("获取五年 PB") { Task { await captureFutuValuation("PB") } }
                }
                .buttonStyle(.bordered)
                .disabled(researchValuationScenarioWorkspace.providerBusy || selectedMembership == nil
                    || researchValuationScenarioWorkspace.providerPendingSave != nil)
                if let pending = researchValuationScenarioWorkspace.providerPendingSave {
                    Text("成员 \(pending.membershipId) 的上次估值保存结果尚未确认。先用原请求核对，再继续修改或选择新来源。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    Button("核对上次保存") { Task { await saveFutuProviderValuation() } }
                        .disabled(researchValuationScenarioWorkspace.providerBusy)
                }
                ForEach(researchValuationScenarioWorkspace.providerCaptures) { capture in
                    Text("\(capture.valuationType) #\(capture.id) · 当前 \(valuationNumber(capture.currentValue)) · 五年均值 \(valuationNumber(capture.historicalAverage)) · \(capture.historicalCount) 点 · 原件 \(capture.originalAvailability)")
                        .font(OwnerReadingFont.caption)
                }
                if let financial = futuFinancialWorkspace.current, financial.periodSelection == "annual",
                    let material = futuFinancialWorkspace.savedMaterial,
                    material.futuFinancialSource?.captureId == financial.id {
                    let periods = Array(Set(financial.pages.flatMap {
                        $0.reports.filter { $0.financialType == "ANNUAL" }.map(\.periodEnd)
                    })).sorted().reversed()
                    Text("已保存年度财报材料 #\(material.id)；EPS 从对应财报原件回读。")
                        .font(OwnerReadingFont.caption)
                    Picker("年度", selection: $researchValuationScenarioWorkspace.providerPeriodEnd) {
                        Text("选择年度").tag("")
                        ForEach(periods, id: \.self) { Text($0).tag($0) }
                    }.onChange(of: researchValuationScenarioWorkspace.providerPeriodEnd) { _, _ in providerSelectionChanged() }
                        .disabled(researchValuationScenarioWorkspace.providerPendingSave != nil)
                    Picker("EPS 口径", selection: $researchValuationScenarioWorkspace.providerEpsBasis) {
                        Text("基本每股收益 5054").tag("basic")
                        Text("摊薄每股收益 5055").tag("diluted")
                    }.onChange(of: researchValuationScenarioWorkspace.providerEpsBasis) { _, _ in providerSelectionChanged() }
                        .disabled(researchValuationScenarioWorkspace.providerPendingSave != nil)
                    Picker("五年 PE 原件", selection: $researchValuationScenarioWorkspace.providerValuationCaptureId) {
                        Text("选择 PE").tag("")
                        ForEach(researchValuationScenarioWorkspace.providerCaptures.filter {
                            $0.valuationType == "PE" && $0.originalAvailability == "available"
                                && $0.membershipVersion == selectedMembership?.version
                        }) { capture in Text("#\(capture.id) · \(capture.providerUpdatedAt)").tag(capture.id) }
                    }.onChange(of: researchValuationScenarioWorkspace.providerValuationCaptureId) { _, _ in providerSelectionChanged() }
                        .disabled(researchValuationScenarioWorkspace.providerPendingSave != nil)
                    Button("读取 EPS/PE 提案") { Task { await previewFutuProviderValuation() } }
                        .disabled(researchValuationScenarioWorkspace.providerBusy
                            || researchValuationScenarioWorkspace.providerPeriodEnd.isEmpty
                            || researchValuationScenarioWorkspace.providerValuationCaptureId.isEmpty
                            || researchValuationScenarioWorkspace.providerPendingSave != nil)
                } else {
                    Text(researchValuationScenarioWorkspace.providerPreview == nil
                        ? "先在富途财报区域选择年度并保存对应研究材料，才能引用 EPS。"
                        : "正在修订已保存来源的情景；来源身份已由服务端重新核对。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
                if let preview = researchValuationScenarioWorkspace.providerPreview {
                    Text("原件 EPS \(preview.basis.eps.rawValue) \(preview.basis.eps.currencyCode)/股 · \(preview.basis.eps.periodEnd) · PE 五年历史均值 \(valuationNumber(preview.basis.valuation.historicalAverage))")
                        .font(OwnerReadingFont.callout.bold())
                    Text("发行人原文核实、重述可比性和披露时间仍为 UNKNOWN。下列参数由你确认并可编辑。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    providerValuationField("估值币种", \.metricCurrency)
                    providerValuationField("基础 EPS/股", \.baseMetricPerShare)
                    providerValuationField("年增长率 %", \.annualGrowthPercent)
                    providerValuationField("观察年限", \.horizonYears)
                    providerValuationField("期末 PE 倍数", \.terminalMultiple)
                    providerValuationField("年折现率 %", \.annualDiscountPercent)
                    providerValuationField("净现金/股", \.netCashPerShare)
                    providerValuationField("增长步长 %", \.growthStepPercent)
                    providerValuationField("倍数步长", \.multipleStep)
                    Toggle("我确认来源、币种及全部估值参数；同一来源已有情景时，再次确认并保存会新增一版修订，旧版本保留；这不是预测或目标价", isOn: Binding(
                        get: { researchValuationScenarioWorkspace.providerOwnerConfirmed },
                        set: { confirmed in
                            researchValuationScenarioWorkspace.providerOwnerConfirmed = confirmed
                        }))
                        .disabled(researchValuationScenarioWorkspace.providerBusy
                            || researchValuationScenarioWorkspace.providerPendingSave != nil)
                    if let target = researchValuationScenarioWorkspace.providerRevisionScenarioId {
                        Text("修订情景 #\(target)；原版本会保留为历史。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                    Button("保存估值并保留历史") {
                        Task { await saveFutuProviderValuation() }
                    }
                        .disabled(researchValuationScenarioWorkspace.providerBusy
                            || researchValuationScenarioWorkspace.providerPendingSave != nil
                            || !researchValuationScenarioWorkspace.providerOwnerConfirmed
                            || researchValuationScenarioWorkspace.providerDraft.parsed() == nil)
                }
                ForEach(researchValuationScenarioWorkspace.envelope?.providerScenarioSets ?? []) { scenario in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("情景 #\(scenario.id) · 修订 \(scenario.revision) · \(scenario.providerBasis.eps.basis) EPS \(scenario.providerBasis.eps.rawValue) \(scenario.providerBasis.eps.currencyCode)/股 · 情景值 \(valuationNumber(scenario.calculation.scenarioPresentValuePerShare)) · \(scenario.recomputable ? "当前可用" : "历史留存")")
                            .font(OwnerReadingFont.caption)
                        if let predecessor = scenario.replacesScenarioSetId {
                            Text("接续情景 #\(predecessor)；原件与 Owner 假设保留。")
                                .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                        }
                        if scenario.recomputable && scenario.scenarioState == "current" {
                            Button("载入情景 #\(scenario.id) 修订") {
                                Task { await prepareFutuProviderValuationRevision(scenario) }
                            }
                            .disabled(researchValuationScenarioWorkspace.providerBusy
                                || researchValuationScenarioWorkspace.providerPendingSave != nil)
                        }
                    }
                }
                Text(researchValuationScenarioWorkspace.providerMessage)
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func providerSelectionChanged() {
        researchValuationScenarioWorkspace.providerRevision = UUID()
        researchValuationScenarioWorkspace.providerBusy = false
        researchValuationScenarioWorkspace.providerPreview = nil
        researchValuationScenarioWorkspace.providerRevisionScenarioId = nil
        researchValuationScenarioWorkspace.providerOwnerConfirmed = false
        if researchValuationScenarioWorkspace.providerPendingSave == nil {
            researchValuationScenarioWorkspace.providerReservation.clear()
        }
    }

    private func providerValuationField(_ title: String,
        _ keyPath: WritableKeyPath<ResearchValuationScenarioDraft, String>) -> some View {
        TextField(title, text: Binding(
            get: { researchValuationScenarioWorkspace.providerDraft[keyPath: keyPath] },
            set: { researchValuationScenarioWorkspace.providerDraft[keyPath: keyPath] = $0
                researchValuationScenarioWorkspace.providerOwnerConfirmed = false
                if researchValuationScenarioWorkspace.providerPendingSave == nil {
                    researchValuationScenarioWorkspace.providerReservation.clear()
                } }))
            .keyboardType(.numbersAndPunctuation).textFieldStyle(.roundedBorder)
            .disabled(researchValuationScenarioWorkspace.providerBusy
                || researchValuationScenarioWorkspace.providerPendingSave != nil)
    }

    private func valuationScenarioMethodPicker() -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("估值方法", selection: Binding(
                get: { researchValuationScenarioWorkspace.draft.methodId },
                set: {
                    researchValuationScenarioWorkspace.draft.methodId = $0
                    researchValuationScenarioWorkspace.draft.metricCurrency = ""
                    researchValuationScenarioWorkspace.draft.baseMetricPerShare = ""
                    researchValuationScenarioWorkspace.draft.terminalMultiple = ""
                    researchValuationScenarioWorkspace.draft.multipleStep = ""
                    researchValuationScenarioWorkspace.anchorValueId = nil
                    researchValuationScenarioWorkspace.replacesScenarioSetId = nil
                    researchValuationScenarioWorkspace.resetIssuerBasis()
                    researchValuationScenarioWorkspace.resetConfirmation()
                }
            )) {
                Text("远期指标倍数法").tag("discounted_forward_metric_multiple_user_scenario")
                Text("调整后净资产价值法").tag("adjusted_net_asset_value_user_scenario")
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("researchValuationMethodPicker")
            Text(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario"
                ? "仅在同口径资产、负债与普通股适合净资产口径时选择；可读取并核对来源每股草稿。"
                : "仅在收入或归母利润事实适合远期每股指标口径时选择；引用只证明公司数据适用性，不会生成你的假设。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
        }
        .disabled(researchValuationScenarioWorkspace.isBusy)
    }

    private func valuationScenarioEntryForm() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("引用锚点", selection: Binding(
                get: { researchValuationScenarioWorkspace.anchorValueId },
                set: { selectedId in
                    let nextCurrency = currentValuationAnchors.first(where: { $0.id == selectedId })?.currency ?? ""
                    let mustReenter = researchValuationScenarioWorkspace.draft.bindCurrency(nextCurrency)
                    researchValuationScenarioWorkspace.anchorValueId = selectedId
                    researchValuationScenarioWorkspace.replacesScenarioSetId = nil
                    researchValuationScenarioWorkspace.resetIssuerBasis()
                    researchValuationScenarioWorkspace.resetConfirmation()
                    researchValuationScenarioWorkspace.message = mustReenter && !nextCurrency.isEmpty
                        ? "来源币种已改为 \(nextCurrency)。原有基础每股金额与每股净现金/调整额已清空；未做换汇，请重新填写。"
                        : "请核对当前引用来源、币种和每股假设后再确认保存。"
                    if selectedId != nil && researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" {
                        Task { await loadIssuerNavBasisPreview() }
                    }
                }
            )) {
                Text("请选择当前原值").tag(nil as String?)
                ForEach(currentValuationAnchors) { anchor in
                    Text("\(valuationAnchorMetricTitle(anchor.metric)) · \(anchor.periodEnd) · #\(anchor.id)")
                        .tag(anchor.id as String?)
                }
            }
            .pickerStyle(.menu)

            if let anchor = currentValuationAnchors.first(where: {
                $0.id == researchValuationScenarioWorkspace.anchorValueId
            }) {
                valuationScenarioSourceBasis(anchor)
                if researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" {
                    issuerNavBasisPanel(anchor: anchor)
                }
                if researchValuationScenarioWorkspace.draft.baseMetricPerShare.isEmpty
                    || researchValuationScenarioWorkspace.draft.netCashPerShare.isEmpty {
                    Text("请按 \(anchor.currency) 重新填写基础每股金额和每股净现金/调整额；切换币种时原金额已清空，系统没有换汇。")
                        .font(OwnerReadingFont.caption.bold())
                        .foregroundStyle(.orange)
                }
            }

            if let replaces = researchValuationScenarioWorkspace.replacesScenarioSetId {
                Text("修订情景 #\(replaces)；锚点与修订链由服务端事务重新核验。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            }

            Text("估值方法、币种、每股口径与 8 项个人假设")
                .font(OwnerReadingFont.headline)
            Picker("每股口径", selection: Binding(
                get: { researchValuationScenarioWorkspace.draft.shareBasis },
                set: {
                    researchValuationScenarioWorkspace.draft.shareBasis = $0
                    researchValuationScenarioWorkspace.resetConfirmation()
                }
            )) {
                Text("请选择基本或摊薄").tag("")
                Text("基本股数口径").tag("basic")
                Text("摊薄股数口径").tag("diluted")
            }
            .pickerStyle(.menu)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 8) {
                    valuationScenarioFieldsLeft()
                    valuationScenarioFieldsRight()
                }
                VStack(spacing: 8) {
                    valuationScenarioFieldsLeft()
                    valuationScenarioFieldsRight()
                }
            }
            valuationScenarioLivePreview()

            Toggle("我确认上述方法、币种、基本或摊薄口径与 8 项数值均为我的估值假设，不是引用事实、目标价或系统预测", isOn: Binding(
                get: { researchValuationScenarioWorkspace.ownerConfirmed },
                set: { researchValuationScenarioWorkspace.ownerConfirmed = $0 }
            ))
            Button {
                Task { await saveResearchValuationScenario() }
            } label: {
                Label(
                    researchValuationScenarioWorkspace.isSaving
                        ? "正在保存并核对"
                        : "保存新的估值情景",
                    systemImage: "checkmark.seal"
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(valuationScenarioSaveDisabled)
            .accessibilityIdentifier("researchValuationScenarioSaveButton")
        }
        .disabled(researchValuationScenarioWorkspace.isBusy)
    }

    @ViewBuilder
    private func issuerNavBasisPanel(anchor: ResearchFundamentalValueData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("母公司 NAV/股来源草稿").font(OwnerReadingFont.callout.bold())
            Button(researchValuationScenarioWorkspace.issuerBasisLoading ? "正在核对来源" : "重新核对来源草稿") {
                Task { await loadIssuerNavBasisPreview() }
            }
            .disabled(researchValuationScenarioWorkspace.issuerBasisLoading || anchor.id != researchValuationScenarioWorkspace.anchorValueId)
            if let preview = researchValuationScenarioWorkspace.issuerBasisPreview {
                if preview.status == "available", let asset = preview.asset,
                   let liability = preview.liability, let shares = preview.shareFacts.first,
                   let proposed = preview.proposedBaseMetricPerShare {
                    Text("\(asset.value ?? "?") − \(liability.value ?? "?")，金额单位 ×\(asset.unitScale)；净资产 \(preview.netAssets ?? "?") \(asset.currency) ÷ \(preview.sharesCount ?? "?") 普通股 = \(valuationNumber(proposed)) \(asset.currency)/股")
                        .font(OwnerReadingFont.caption.bold())
                    Text("母公司范围 · 报告日 \(asset.periodEnd) · 同币种 \(asset.currency) · 股数日 \(shares.periodEnd) · 股数来源 #\(preview.shareFacts.map(\.id).joined(separator: ",")) · 模型确认 #\(preview.sharesContextId ?? "?")")
                        .font(OwnerReadingFont.caption)
                    HStack {
                        Button("打开资产原文 #\(asset.id)") { Task { await openResearchFundamentalSource(asset) } }
                        Button("打开负债原文 #\(liability.id)") { Task { await openResearchFundamentalSource(liability) } }
                        ForEach(preview.shareFacts) { fact in
                            Button("打开股数原文 #\(fact.id)") { Task { await openResearchFundamentalSource(fact) } }
                        }
                    }.buttonStyle(.bordered)
                    Toggle("我已核对该母公司净资产只归属所选普通股，不含少数股东或非普通股权益", isOn: Binding(
                        get: { researchValuationScenarioWorkspace.ordinaryEquityOwnerConfirmed },
                        set: { researchValuationScenarioWorkspace.ordinaryEquityOwnerConfirmed = $0
                            researchValuationScenarioWorkspace.resetConfirmation() }))
                    Button("采用此来源草稿") { adoptIssuerNavBasis() }
                        .disabled(!researchValuationScenarioWorkspace.ordinaryEquityOwnerConfirmed)
                    if researchValuationScenarioWorkspace.issuerBasisAdopted {
                        Text("来源草稿已采用；增长、实现率、折现等仍是你的可编辑假设。额外调整/股固定为 0，避免重复计入现金。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        if Double(researchValuationScenarioWorkspace.draft.baseMetricPerShare) != proposed {
                            TextField("修改来源每股基数的原因（至少 8 字）", text: Binding(
                                get: { researchValuationScenarioWorkspace.issuerOverrideReason },
                                set: { researchValuationScenarioWorkspace.issuerOverrideReason = $0
                                    researchValuationScenarioWorkspace.resetConfirmation() }))
                                .textFieldStyle(.roundedBorder)
                        }
                        Button("改为纯手填，不保留来源草稿绑定") {
                            researchValuationScenarioWorkspace.stopUsingIssuerBasis()
                            researchValuationScenarioWorkspace.message = "已退出来源草稿；基础净资产/股已清空。若要保存纯手填情景，请亲自重新输入该数值并确认。"
                        }.font(OwnerReadingFont.caption)
                    }
                } else {
                    Text("暂不能从当前来源计算每股基数：\(preview.missingInputs.map(researchValuationIssuerBasisMissingText).joined(separator: "；"))")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                    if let asset = preview.asset {
                        Button("核对总资产原文 #\(asset.id)") { Task { await openResearchFundamentalSource(asset) } }
                    }
                    if let liability = preview.liability {
                        Button("核对总负债原文 #\(liability.id)") { Task { await openResearchFundamentalSource(liability) } }
                    }
                    ForEach(preview.shareFacts) { fact in
                        Button("核对股数原文 #\(fact.id)") { Task { await openResearchFundamentalSource(fact) } }
                    }
                }
                Text(preview.limitation).font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            } else {
                Text(researchValuationScenarioWorkspace.issuerBasisMessage)
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(Color(.secondarySystemGroupedBackground))
    }

    private func valuationScenarioFieldsLeft() -> some View {
        VStack(spacing: 8) {
            Text("估值币种：\(researchValuationScenarioWorkspace.draft.metricCurrency.isEmpty ? "请先选来源" : researchValuationScenarioWorkspace.draft.metricCurrency)（与来源一致，无汇率换算）")
                .font(OwnerReadingFont.caption)
            valuationScenarioField(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" ? "基础净资产/股" : "基础每股指标", \.baseMetricPerShare)
            valuationScenarioField(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" ? "净资产年变动率（%）" : "年增长率（%）", \.annualGrowthPercent)
            valuationScenarioField("观察年限", \.horizonYears)
            valuationScenarioField(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" ? "资产实现率（%，10–100）" : "期末倍数", \.terminalMultiple)
        }
    }

    private func valuationScenarioFieldsRight() -> some View {
        VStack(spacing: 8) {
            valuationScenarioField("年折现率（%）", \.annualDiscountPercent)
            valuationScenarioField(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" ? "额外资产负债调整/股（不重复）" : "每股净现金（P/E 时填 0）", \.netCashPerShare)
            valuationScenarioField("增长步长（%）", \.growthStepPercent)
            valuationScenarioField(researchValuationScenarioWorkspace.draft.methodId == "adjusted_net_asset_value_user_scenario" ? "实现率步长（百分点，乐观情景≤100%）" : "倍数步长", \.multipleStep)
        }
    }

    @ViewBuilder
    private func valuationScenarioSourceBasis(_ anchor: ResearchFundamentalValueData) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("来源草稿 · \(valuationAnchorMetricTitle(anchor.metric)) \(anchor.value ?? "未提供") × \(anchor.unitScale) \(anchor.currency)")
                .font(OwnerReadingFont.caption.bold())
            Text("报告日 \(anchor.periodEnd) · \(anchor.scope) · 材料 #\(anchor.source.materialId)\(anchor.source.pageNumber.map { " 第\($0)页" } ?? " 原文快照") · 原文记录 #\(anchor.id)")
                .font(OwnerReadingFont.caption)
            Button("打开锚点原文") { Task { await openResearchFundamentalSource(anchor) } }
                .buttonStyle(.bordered)
            if anchor.metric == "total_assets" || anchor.metric == "total_liabilities" {
                if let other = currentValuationAnchors.first(where: {
                    $0.metric != anchor.metric && $0.periodKind == anchor.periodKind
                        && $0.periodStart == anchor.periodStart && $0.periodEnd == anchor.periodEnd
                        && $0.currency == anchor.currency && $0.unitScale == anchor.unitScale
                        && $0.scope == anchor.scope
                }) {
                    Text("配对来源 · \(valuationAnchorMetricTitle(other.metric)) \(other.value ?? "未提供") × \(other.unitScale) \(other.currency) · 原文记录 #\(other.id)")
                        .font(OwnerReadingFont.caption)
                    Button("打开配对原文") { Task { await openResearchFundamentalSource(other) } }
                        .buttonStyle(.bordered)
                }
            }
            Text("来源只校验公司数据口径。每股金额、股份数、净现金及调整额仍须由你核定；不得把整家公司金额直接填作每股金额。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            if anchor.metric == "revenue" {
                Text("收入口径：使用收入/股与企业价值/收入倍数；净现金/股只加一次，得到权益每股价值。")
                    .font(OwnerReadingFont.caption)
            } else if anchor.metric == "profit_attributable_to_owners" {
                Text("归母利润口径：使用同一基本或摊薄口径的利润/股与 P/E；结果已是权益每股价值，净现金/股必须填 0。")
                    .font(OwnerReadingFont.caption)
            } else {
                Text("净资产口径：资产与负债取同一报表范围；每股基数与额外调整须采用同一基本或摊薄股数，现金不得重复计入。")
                    .font(OwnerReadingFont.caption)
            }
        }
        .padding(8)
        .background(Color(.tertiarySystemGroupedBackground))
    }

    @ViewBuilder
    private func valuationScenarioLivePreview() -> some View {
        if let input = researchValuationScenarioWorkspace.draft.parsed(requireShareBasis: true),
           let grid = calculateAnnualValuationScenarioGrid(input) {
            VStack(alignment: .leading, spacing: 5) {
                Text("假设即时重算 · \(input.shareBasis == "diluted" ? "摊薄" : "基本")每股 \(valuationNumber(grid.scenarioPresentValuePerShare)) \(input.metricCurrency ?? "")")
                    .font(OwnerReadingFont.subheadline.bold())
                Text("悲观 / 基准 / 乐观：\([0, 4, 8].map { valuationNumber(grid.cells[$0].presentValuePerShare) }.joined(separator: " / ")) \(input.metricCurrency ?? "") 每股")
                    .font(OwnerReadingFont.caption)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 4) {
                    ForEach(Array(grid.cells.enumerated()), id: \.offset) { _, cell in
                        Text("\(valuationPercent(cell.annualGrowthRate)) · \(valuationScenarioAxisValue(cell.terminalMultiple, methodId: input.methodId ?? ""))\n\(valuationNumber(cell.presentValuePerShare))")
                            .font(OwnerReadingFont.caption2.monospacedDigit())
                            .frame(maxWidth: .infinity)
                    }
                }
                if let membership = selectedMembership,
                   valuationQuantEnvelope.status == "available",
                   let data = valuationQuantEnvelope.data,
                   data.target.membershipId == membership.id,
                   data.target.membershipVersion == membership.version,
                   data.target.symbol == membership.symbol,
                   let quote = data.valuation.quote,
                   quote.currency == input.metricCurrency {
                    Text("报价快照 \(valuationNumber(quote.price)) \(quote.currency) · \(quote.quoteTime)")
                        .font(OwnerReadingFont.caption)
                    if let implied = annualValuationImpliedGrowthAtPrice(quote.price, input: input) {
                        Text("该报价隐含年增长 \(valuationPercent(implied))；按当前实现率或倍数、折现与每股调整反推。")
                            .font(OwnerReadingFont.caption)
                    } else {
                        Text("该报价无法反推出有限的年增长率。")
                            .font(OwnerReadingFont.caption)
                    }
                } else {
                    Text("没有同一公司、版本及币种的已核对报价快照，隐含预期暂不可计算。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                }
                Text("仅为个人假设的研究情景，须确认后保存；不是目标价。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            Text("填写完整且有效的假设后显示悲观、基准、乐观和 3×3 即时重算。NAV 实现率及其乐观情景不得超过 100%。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func valuationScenarioField(
        _ title: String,
        _ keyPath: WritableKeyPath<ResearchValuationScenarioDraft, String>,
        currency: Bool = false
    ) -> some View {
        TextField(title, text: Binding(
            get: { researchValuationScenarioWorkspace.draft[keyPath: keyPath] },
            set: {
                researchValuationScenarioWorkspace.draft[keyPath: keyPath] = $0
                researchValuationScenarioWorkspace.resetConfirmation()
            }
        ))
        .keyboardType(currency ? .asciiCapable : .numbersAndPunctuation)
        .textInputAutocapitalization(currency ? .characters : .never)
        .autocorrectionDisabled(currency)
        .textFieldStyle(.roundedBorder)
    }

    @ViewBuilder
    private func valuationScenarioReadBack(_ envelope: ResearchValuationScenariosEnvelope) -> some View {
        Divider()
        Text("历史估值情景组")
            .font(OwnerReadingFont.headline)
        if envelope.scenarioSets.isEmpty {
            Text("尚无估值情景。").foregroundStyle(.secondary)
        } else {
            ForEach(envelope.scenarioSets) { scenario in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("情景 #\(scenario.id) · 修订 \(scenario.revision)")
                            .font(OwnerReadingFont.subheadline.bold())
                        Spacer()
                        Text(valuationScenarioStateTitle(scenario))
                            .font(OwnerReadingFont.caption.bold())
                            .foregroundStyle(scenario.recomputable ? .green : .orange)
                    }
                    if scenario.assumptions.values.methodId == "adjusted_net_asset_value_user_scenario"
                        && scenario.assumptions.values.terminalMultiple > 1 {
                        Text("旧记录的实现率原值超过 100%，历史计算保持原样；请核对后再修订。")
                            .font(OwnerReadingFont.caption.bold())
                            .foregroundStyle(.orange)
                    }
                    Text("\(valuationAnchorMetricTitle(scenario.anchor.metric)) · \(scenario.anchor.periodEnd) · 原值 \(scenario.anchor.value ?? "未提供") × \(scenario.anchor.unitScale) \(scenario.anchor.currency)")
                        .font(OwnerReadingFont.caption)
                    if scenario.calculation.method.id == "adjusted_net_asset_value_user_scenario" {
                        if let paired = scenario.pairedAnchor {
                            Text("配对来源 \(valuationAnchorMetricTitle(paired.metric)) · \(paired.periodEnd) · 原值 \(paired.value ?? "未提供") × \(paired.unitScale) \(paired.currency) · #\(paired.id)")
                                .font(OwnerReadingFont.caption)
                        } else {
                            Text("配对来源无法核验；旧版未绑定或原件现已不可用，仅保留历史。")
                                .font(OwnerReadingFont.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                    Text(scenario.calculation.issuerBasis == nil
                        ? "引用仅作上下文 · 你的估值假设不是从引用自动推导"
                        : "母公司 NAV/股基数引用已核对来源并经你采用；其余参数仍是你的假设")
                        .font(OwnerReadingFont.caption.bold())
                        .foregroundStyle(.secondary)
                    Text("方法 \(valuationScenarioMethodTitle(scenario.calculation.method.id)) · 数据口径 \(scenario.calculation.method.applicability?.companyDataBasis ?? "legacy_unbound")")
                        .font(OwnerReadingFont.caption.bold())
                    valuationScenarioAssumptionSummary(scenario.assumptions.values)
                    valuationScenarioDiagonal(
                        scenario.calculation.diagonal,
                        currency: scenario.assumptions.values.metricCurrency,
                        methodId: scenario.calculation.method.id
                    )
                    valuationScenarioMatrix(
                        scenario.calculation.matrix,
                        currency: scenario.assumptions.values.metricCurrency,
                        methodId: scenario.calculation.method.id
                    )
                    if let range = scenario.calculation.valueRange {
                        Text("三情景价值范围（研究用）：\(valuationNumber(range.low))–\(valuationNumber(range.high)) \(scenario.assumptions.values.metricCurrency ?? "币种未记录")；不是目标价。")
                            .font(OwnerReadingFont.caption.bold())
                    }
                    Text("公式 \(scenario.calculation.method.calculationVersion)")
                        .font(OwnerReadingFont.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    if let basis = scenario.calculation.issuerBasis {
                        Text("NAV 来源绑定：资产 #\(basis.assetValueId) · 负债 #\(basis.liabilityValueId) · 普通股 #\(basis.shareValueIds.joined(separator: ",")) · \(basis.adoptionMode == "owner_override" ? "Owner 修改来源每股基数：\(basis.ownerOverrideReason ?? "")" : "采用来源每股基数") · 当前 \(scenario.issuerBasisCurrentness ?? "未知")")
                            .font(OwnerReadingFont.caption)
                        Text("来源指纹 \(basis.sourceFingerprint)")
                            .font(OwnerReadingFont.caption2.monospaced()).foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    if !scenario.invalidatedBy.isEmpty {
                        Text("不可重算：\(scenario.invalidatedBy.joined(separator: ", "))")
                            .font(OwnerReadingFont.caption)
                            .foregroundStyle(.orange)
                    }
                    HStack {
                        Button(scenario.anchor.source.kind == "source_snapshot"
                            ? "打开已保存原文" : "打开对应来源第\(scenario.anchor.source.pageNumber ?? 1)页") {
                            Task { await openResearchValuationSource(scenario.anchor) }
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("researchValuationSource-\(scenario.id)")
                        if let paired = scenario.pairedAnchor {
                            Button("打开配对来源") { Task { await openResearchValuationSource(paired) } }
                                .buttonStyle(.bordered)
                        }
                        if canReviseResearchValuationScenario(scenario)
                            && currentValuationAnchors(for: scenario.calculation.method.id)
                                .contains(where: { $0.id == scenario.anchor.id }) {
                            Button(scenario.recomputable ? "基于此修订" : "补绑定并修订") {
                                prepareResearchValuationRevision(scenario)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
                .padding(9)
                .background(Color(.tertiarySystemGroupedBackground))
                .overlay {
                    if researchValuationScenarioWorkspace.lastFreshScenarioSetId == scenario.id {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(Color.green, lineWidth: 2)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
    }

    private func valuationScenarioAssumptionSummary(
        _ input: AnnualValuationScenarioInput
    ) -> some View {
        Text(
            input.methodId == "adjusted_net_asset_value_user_scenario"
                ? "我的估值假设：币种 \(input.metricCurrency ?? "未记录")；\(valuationShareBasisTitle(input.shareBasis))；净资产/股 \(valuationNumber(input.baseMetricPerShare))；变动率 \(valuationPercent(input.annualGrowthRate))；\(input.horizonYears) 年；实现率 \(valuationPercent(input.terminalMultiple))；要求回报 \(valuationPercent(input.annualDiscountRate))；调整/股 \(valuationNumber(input.netCashPerShare))；增长步长 \(valuationPercent(input.growthRateStep))；实现率步长 \(valuationPercent(input.multipleStep))"
                : "我的估值假设：币种 \(input.metricCurrency ?? "未记录")；\(valuationShareBasisTitle(input.shareBasis))；每股 \(valuationNumber(input.baseMetricPerShare))；增长 \(valuationPercent(input.annualGrowthRate))；\(input.horizonYears) 年；倍数 \(valuationNumber(input.terminalMultiple))；折现 \(valuationPercent(input.annualDiscountRate))；净现金/股 \(valuationNumber(input.netCashPerShare))；增长步长 \(valuationPercent(input.growthRateStep))；倍数步长 \(valuationNumber(input.multipleStep))"
        )
        .font(OwnerReadingFont.caption)
    }

    private func valuationScenarioStateTitle(_ scenario: ResearchValuationScenarioSetData) -> String {
        if scenario.recomputable { return "可修订" }
        if canReviseResearchValuationScenario(scenario)
            && currentValuationAnchors(for: scenario.calculation.method.id)
                .contains(where: { $0.id == scenario.anchor.id }) { return "待补绑定" }
        return "仅历史"
    }

    private func valuationScenarioDiagonal(
        _ values: [ResearchValuationDiagonalScenario],
        currency: String?,
        methodId: String
    ) -> some View {
        HStack(spacing: 6) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.scenario.capitalized).font(OwnerReadingFont.caption.bold())
                    Text("\(valuationNumber(item.presentValuePerShare)) \(currency ?? "币种未记录")")
                        .font(OwnerReadingFont.body.monospacedDigit())
                    Text("\(valuationPercent(item.annualGrowthRate)) · \(valuationScenarioAxisValue(item.terminalMultiple, methodId: methodId))")
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(6)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            }
        }
    }

    private func valuationScenarioMatrix(
        _ matrix: ResearchValuationMatrix,
        currency: String?,
        methodId: String
    ) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 4) {
            ForEach(Array(matrix.cells.enumerated()), id: \.offset) { _, cell in
                VStack(spacing: 1) {
                    Text("\(valuationNumber(cell.presentValuePerShare)) \(currency ?? "币种未记录")")
                        .font(OwnerReadingFont.caption.monospacedDigit())
                    Text("\(valuationPercent(cell.annualGrowthRate)) · \(valuationScenarioAxisValue(cell.terminalMultiple, methodId: methodId))")
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 5)
                .background(Color(.secondarySystemGroupedBackground))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("完整三乘三估值矩阵")
    }

    private var valuationScenarioSaveDisabled: Bool {
        researchValuationScenarioWorkspace.isBusy
            || researchValuationScenarioWorkspace.anchorValueId == nil
            || !currentValuationAnchors.contains(where: {
                $0.id == researchValuationScenarioWorkspace.anchorValueId
                    && $0.currency == researchValuationScenarioWorkspace.draft.metricCurrency
            })
            || researchValuationScenarioWorkspace.draft.parsed(requireShareBasis: true) == nil
            || (currentValuationAnchors.first(where: {
                $0.id == researchValuationScenarioWorkspace.anchorValueId
            })?.metric == "profit_attributable_to_owners"
                && Double(researchValuationScenarioWorkspace.draft.netCashPerShare) != 0)
            || !researchValuationScenarioWorkspace.ownerConfirmed
            || (researchValuationScenarioWorkspace.issuerBasisAdopted
                && (researchValuationScenarioWorkspace.draft.shareBasis != "basic"
                    || Double(researchValuationScenarioWorkspace.draft.netCashPerShare) != 0
                    || researchValuationScenarioWorkspace.issuerBasisPreview.flatMap {
                        ResearchValuationIssuerBasisBinding(preview: $0,
                            adoptedValue: Double(researchValuationScenarioWorkspace.draft.baseMetricPerShare) ?? 0,
                            overrideReason: researchValuationScenarioWorkspace.issuerOverrideReason,
                            ordinaryEquityOwnerConfirmed: researchValuationScenarioWorkspace.ordinaryEquityOwnerConfirmed)
                    } == nil))
    }

    private func valuationAnchorMetricTitle(_ metric: String) -> String {
        switch metric {
        case "revenue": "收入"
        case "profit_attributable_to_owners": "归母利润"
        case "total_assets": "总资产"
        case "total_liabilities": "总负债"
        default: metric
        }
    }

    private func valuationScenarioMethodTitle(_ methodId: String) -> String {
        methodId == "adjusted_net_asset_value_user_scenario"
            ? "调整后净资产价值法"
            : "远期指标倍数法"
    }

    private func valuationShareBasisTitle(_ basis: String?) -> String {
        switch basis {
        case "basic": "基本每股"
        case "diluted": "摊薄每股"
        default: "旧记录未标股数口径"
        }
    }

    private func valuationScenarioAxisValue(_ value: Double, methodId: String) -> String {
        methodId == "adjusted_net_asset_value_user_scenario"
            ? valuationPercent(value)
            : valuationNumber(value) + "x"
    }

    private func valuationNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...6)))
    }

    private func valuationPercent(_ value: Double) -> String {
        (value * 100).formatted(.number.precision(.fractionLength(0...4))) + "%"
    }
}

extension GateBResearchScreen {
    private var fcffFacts: [ResearchFundamentalValueData] {
        researchFundamentalWorkspace.envelope?.values ?? []
    }

    @ViewBuilder
    func fcffValuationSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("现金流折现：FCFF 到普通股权益").font(OwnerReadingFont.headline)
            Text("年度历史现金流、最新资产负债表和今天的估值截止日分开核对。只预测截止日之后的现金流；年内首段单独填写，年末按实际天数折现。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            if let pending = researchValuationScenarioWorkspace.fcffPendingSave {
                Text("上次保存结果仍未确定：\(pending.symbol)，请求编号 \(pending.idempotencyKey)。原请求已保留，编辑和切换研究对象都不会产生新请求。")
                    .font(OwnerReadingFont.caption.bold()).foregroundStyle(.orange)
                Button("核对上次保存") { Task { await saveFcffScenario() } }
                    .disabled(researchValuationScenarioWorkspace.fcffBusy)
            } else {
                fcffSourceSection()
                if let preview = researchValuationScenarioWorkspace.fcffPreview {
                    fcffSourceStatus(preview)
                    if preview.status == "available" {
                        fcffForecastForm(preview: preview)
                    }
                }
            }
            DisclosureGroup("OpenD 第三方参考 · 个人 FCFF 情景") {
                fcffProviderReferenceSection()
            }
            ForEach(researchValuationScenarioWorkspace.envelope?.fcffScenarioSets ?? []) { scenario in
                VStack(alignment: .leading, spacing: 4) {
                    Text("FCFF 情景 #\(scenario.id) · 修订 \(scenario.revision) · \(scenario.recomputable ? "当前可重算" : "历史留存")")
                        .font(OwnerReadingFont.caption.bold())
                    Text("\(scenario.calculation.commonEquityValuePerShare) \(scenario.calculation.currency)/股 · 估值截止 \(scenario.assumptions.values.valuationCutoff)")
                        .font(OwnerReadingFont.caption)
                    if !scenario.invalidatedBy.isEmpty {
                        Text("当前依据变化：\(scenario.invalidatedBy.joined(separator: "、"))")
                            .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                    }
                    if scenario.scenarioState == "current" && researchValuationScenarioWorkspace.fcffPendingSave == nil {
                        Button("载入修订并选择新原件") { Task { await prepareFcffRevision(scenario) } }
                    }
                }
            }
            Text(researchValuationScenarioWorkspace.fcffMessage)
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
        }
        .padding(10).background(Color(.tertiarySystemGroupedBackground))
    }

    @ViewBuilder
    private func fcffProviderReferenceSection() -> some View {
        let selectedCapture = researchValuationScenarioWorkspace.fcffProviderCaptures.first {
            $0.id == researchValuationScenarioWorkspace.fcffProviderCaptureId
        }
        let periods = Array(Set(selectedCapture?.pages.flatMap { page in
            page.reports.filter { $0.financialType == "ANNUAL" }.map(\.periodEnd)
        } ?? [])).sorted().reversed()
        let savedMaterials = researchValuationScenarioWorkspace.fcffProviderPreview?.materials ?? []
        let shareDates = Array(Set(fcffFacts.filter { $0.metric == "issued_shares"
            && $0.periodKind == "instant" && $0.valueState == "current"
            && $0.valueStatus == "reported" }.map(\.periodEnd))).sorted().reversed()
        Text("已保存 OpenD 原页只作为第三方参考；金额、期间及股数来源分别核对。缺项可阅读，完整个人假设之前不计算每股值。")
            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
        Button("读取已存年度捕获") { Task { await loadFcffProviderCaptures() } }
            .font(OwnerReadingFont.caption)
            .disabled(researchValuationScenarioWorkspace.fcffProviderLookupBusy
                || researchValuationScenarioWorkspace.fcffProviderPendingSave != nil)
        Picker("年度捕获", selection: Binding(
            get: { researchValuationScenarioWorkspace.fcffProviderCaptureId },
            set: { researchValuationScenarioWorkspace.fcffProviderCaptureId = $0
                fcffProviderCaptureChanged() })) {
            Text("选择已存捕获").tag("")
            ForEach(researchValuationScenarioWorkspace.fcffProviderCaptures) { capture in
                Text("#\(capture.id) · \(capture.capturedAt)").tag(capture.id)
            }
        }.pickerStyle(.menu)
            .disabled(researchValuationScenarioWorkspace.fcffProviderLookupBusy
                || researchValuationScenarioWorkspace.fcffProviderPendingSave != nil)
        Picker("年度报告日", selection: Binding(
            get: { researchValuationScenarioWorkspace.fcffProviderPeriodEnd },
            set: { researchValuationScenarioWorkspace.fcffProviderPeriodEnd = $0
                fcffProviderPeriodChanged() })) {
            Text("选择报告日").tag("")
            ForEach(Array(periods), id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.menu)
            .disabled(selectedCapture == nil || researchValuationScenarioWorkspace.fcffProviderLookupBusy
                || researchValuationScenarioWorkspace.fcffProviderPendingSave != nil)
        if selectedCapture != nil && periods.isEmpty {
            Text("该年度捕获没有可选的年度报告日；请选择另一份已有捕获。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        }
        Button("读取所选期间的已存材料") { Task { await loadFcffProviderMaterials() } }
            .font(OwnerReadingFont.caption)
            .disabled(researchValuationScenarioWorkspace.fcffProviderPeriodEnd.isEmpty
                || researchValuationScenarioWorkspace.fcffProviderLookupBusy
                || researchValuationScenarioWorkspace.fcffProviderPendingSave != nil)
        Picker("OpenD 年度材料", selection: Binding(
            get: { researchValuationScenarioWorkspace.fcffProviderMaterialId },
            set: { materialId in
                researchValuationScenarioWorkspace.fcffProviderMaterialId = materialId
                Task { await selectFcffProviderMaterial(materialId) }
            })) {
            Text("选择材料").tag("")
            ForEach(savedMaterials, id: \.id) { material in
                Text("#\(material.id) · r\(material.revision) · \(researchValuationScenarioWorkspace.fcffProviderPeriodEnd)")
                    .tag(material.id)
            }
        }.pickerStyle(.menu)
            .disabled(savedMaterials.isEmpty || researchValuationScenarioWorkspace.fcffProviderLookupBusy
                || researchValuationScenarioWorkspace.fcffProviderPendingSave != nil)
        Text(researchValuationScenarioWorkspace.fcffProviderLookupMessage)
            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
        Picker("独立股数参考日", selection: Binding(
            get: { researchValuationScenarioWorkspace.fcffProviderShareDate ?? "" },
            set: { researchValuationScenarioWorkspace.fcffProviderShareDate = $0.isEmpty ? nil : $0
                fcffProviderSelectionChanged() })) {
            Text("无可用股数参考").tag("")
            ForEach(Array(shareDates), id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.menu)
        Text("股数报告日可以不同于余额日；股本金额不是股份数。即使有参考股数，截至估值日的摊薄分母仍须由你填写并说明。")
            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
        Button(researchValuationScenarioWorkspace.fcffBusy ? "正在核对原页" : "读取第三方 FCFF 参考") {
            Task { await loadFcffProviderReference() }
        }.disabled(researchValuationScenarioWorkspace.fcffBusy
            || researchValuationScenarioWorkspace.fcffProviderLookupBusy
            || researchValuationScenarioWorkspace.fcffProviderMaterial == nil
            || researchValuationScenarioWorkspace.fcffProviderPendingSave != nil)
        if let reference = researchValuationScenarioWorkspace.fcffProviderReference {
            Text("OpenD #\(reference.materialId) r\(reference.materialRevision) · 余额 \(reference.balanceReferenceDate) · 股数 \(reference.shareReferenceDate ?? "无") · 原页捕获 \(reference.capturedAt) · \(reference.currency) 基础单位。发行人原文核实和披露时点 UNKNOWN。")
                .font(OwnerReadingFont.caption.bold())
            ForEach(reference.rows) { row in
                Text("\(row.displayName) · \(row.rawValue) \(row.currency) · 字段 \(row.fieldId) · 原页 #\(row.pageId)")
                    .font(OwnerReadingFont.caption)
            }
            if !reference.missingRoles.isEmpty {
                Text("原页缺项：\(reference.missingRoles.joined(separator: "、"))。不补零；原字段不自动合并或假定互不重叠。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.orange)
            }
            if let shares = reference.shareReference {
                Text("另一期发行人股数参考：已发行 \(shares.issuedShares) − 库存 \(shares.treasuryShares)，日期 \(reference.shareReferenceDate ?? "未知")。不得称为余额日同日股数。")
                    .font(OwnerReadingFont.caption)
                if [shares.issuedPublishedAt, shares.treasuryPublishedAt].contains(where: { $0 == nil }) {
                    Text("股数原文发布日期未核实；不能据此保存历史截止日的每股情景。可改为不引用该股数，另行填写并说明截至日的个人分母假设。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                }
            } else {
                Text("当前无已核对的独立股份数量；股本金额和总负债均不能代替股数或有息债。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.orange)
            }
            fcffProviderScenarioForm(reference: reference)
        }
        if let pending = researchValuationScenarioWorkspace.fcffProviderPendingSave {
            Text("上次保存结果未确定，请按原请求编号 \(pending.idempotencyKey) 核对。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
            Button("核对上次保存") { Task { await saveFcffProviderScenario() } }
        }
        ForEach(researchValuationScenarioWorkspace.envelope?.providerFcffScenarioSets ?? []) { scenario in
            VStack(alignment: .leading, spacing: 4) {
                Text("OpenD 参考 FCFF #\(scenario.id) · 修订 \(scenario.revision) · \(scenario.recomputable ? "当前可重算" : "历史留存")")
                    .font(OwnerReadingFont.caption.bold())
                Text("个人情景 \(scenario.calculation.commonEquityValuePerShare) \(scenario.calculation.currency)/股 · 估值截止 \(scenario.calculation.valuationCutoff)")
                    .font(OwnerReadingFont.caption)
                if !scenario.invalidatedBy.isEmpty {
                    Text("来源变化：\(scenario.invalidatedBy.joined(separator: "、"))")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                }
                if scenario.scenarioState == "current" && researchValuationScenarioWorkspace.fcffProviderPendingSave == nil {
                    Button("载入并修订") { Task { await prepareFcffProviderRevision(scenario) } }
                }
            }
        }
        Text(researchValuationScenarioWorkspace.fcffProviderMessage)
            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
    }

    @ViewBuilder
    private func fcffProviderScenarioForm(reference: FcffProviderReference) -> some View {
        TextField("估值截止日 YYYY-MM-DD", text: Binding(
            get: { researchValuationScenarioWorkspace.fcffDraft.valuationCutoff },
            set: { researchValuationScenarioWorkspace.fcffDraft.valuationCutoff = $0
                researchValuationScenarioWorkspace.fcffDraft.resetForecastPeriods()
                researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false }))
            .textFieldStyle(.roundedBorder)
        Text("从估值截止日之后逐期填写个人预测，OpenD 的历史行不自动变成预测。")
            .font(OwnerReadingFont.caption)
        ForEach(researchValuationScenarioWorkspace.fcffDraft.forecast.indices, id: \.self) { index in
            fcffYearFields(index: index)
        }
        if !researchValuationScenarioWorkspace.fcffDraft.forecast.isEmpty {
            Button("增加完整预测年度") {
                let terminal = researchValuationScenarioWorkspace.fcffDraft.terminalNextYear
                if let year = Int(terminal.periodEnd.prefix(4)),
                   researchValuationScenarioWorkspace.fcffDraft.forecast.count < 10 {
                    researchValuationScenarioWorkspace.fcffDraft.forecast.append(terminal)
                    researchValuationScenarioWorkspace.fcffDraft.terminalNextYear = FcffYearDraft(
                        periodStart: "\(year + 1)-01-01", periodEnd: "\(year + 1)-12-31")
                    researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
                }
            }
            if researchValuationScenarioWorkspace.fcffDraft.forecast.count > 2 {
                Button("移除最后预测年度") {
                    let removed = researchValuationScenarioWorkspace.fcffDraft.forecast.removeLast()
                    researchValuationScenarioWorkspace.fcffDraft.terminalNextYear = FcffYearDraft(
                        periodStart: removed.periodStart, periodEnd: removed.periodEnd)
                    researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false
                }
            }
            fcffYearFields(index: nil)
        }
        fcffField("WACC（小数）", \.wacc)
        fcffField("永续增长率 g（小数）", \.terminalGrowthRate)
        fcffField("WACC 敏感性步长", \.waccStep)
        fcffField("g 敏感性步长", \.terminalGrowthStep)
        Text("权益桥接是你的判断值，金额为 \(reference.currency) 基础单位；空白不算零。总负债不当有息债，原字段不默认互不重叠。")
            .font(OwnerReadingFont.caption.bold())
        fcffProviderAmountField("可加回的超额现金", \.excessCash)
        fcffProviderAmountField("非经营资产", \.nonOperatingAssets)
        fcffProviderAmountField("有息债", \.interestBearingDebt)
        fcffProviderAmountField("未计入债的租赁负债", \.leaseLiabilitiesNotInDebt)
        fcffProviderAmountField("少数股东权益", \.noncontrollingInterests)
        fcffProviderAmountField("其他权益索偿", \.otherNonordinaryClaims)
        fcffProviderAmountField("截至估值日摊薄股数（整数）", \.dilutedOrdinaryShares)
        fcffProviderReasonField("现金取舍与经营所需现金理由", \.cash)
        fcffProviderReasonField("非经营资产范围理由", \.nonOperatingAssets)
        fcffProviderReasonField("贷款债券重叠与债务口径理由", \.debt)
        fcffProviderReasonField("租赁与折现率口径理由", \.leases)
        fcffProviderReasonField("少数权益账面与公允价值理由", \.nci)
        fcffProviderReasonField("其他索偿理由", \.otherClaims)
        fcffProviderReasonField("股数日期差异及摊薄假设理由", \.shares)
        fcffProviderReasonField("余额日至估值日变化理由", \.dateGap)
        fcffProviderReasonField("历史缺项与未来预测口径理由", \.historicalBasis)
        if let bridge = researchValuationScenarioWorkspace.fcffProviderBridge.bridge,
           let input = researchValuationScenarioWorkspace.fcffDraft.providerAssumptions(
            reference: reference, bridge: bridge),
           let calculation = calculateFcffScenarioPreview(input) {
            Text("个人情景：经营企业价值 \(calculation.operatingEnterpriseValue)；普通股权益 \(calculation.commonEquityValue)；每股 \(calculation.commonEquityValuePerShare) \(calculation.currency)。仅作受限研究参考，不是目标价或现价判断。")
                .font(OwnerReadingFont.caption.bold())
            Toggle("我确认第三方来源、日期差异、桥接理由及全部个人预测", isOn:
                $researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed)
            Button("保存并回读个人 FCFF 情景") { Task { await saveFcffProviderScenario() } }
                .disabled(!researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed
                    || researchValuationScenarioWorkspace.fcffBusy)
        } else {
            Text("预测、权益桥接或截至日摊薄股数尚未完整；第三方参考仍可阅读，当前不生成每股价格。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        }
    }

    private func fcffProviderAmountField(_ label: String,
        _ key: WritableKeyPath<FcffProviderBridgeDraft, String>) -> some View {
        TextField(label, text: Binding(
            get: { researchValuationScenarioWorkspace.fcffProviderBridge[keyPath: key] },
            set: { researchValuationScenarioWorkspace.fcffProviderBridge[keyPath: key] = $0
                researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false }))
            .keyboardType(.numbersAndPunctuation).textFieldStyle(.roundedBorder)
    }

    private func fcffProviderReasonField(_ label: String,
        _ key: WritableKeyPath<FcffProviderBridgeReasons, String>) -> some View {
        TextField(label, text: Binding(
            get: { researchValuationScenarioWorkspace.fcffProviderBridge.reasons[keyPath: key] },
            set: { researchValuationScenarioWorkspace.fcffProviderBridge.reasons[keyPath: key] = $0
                researchValuationScenarioWorkspace.fcffProviderOwnerConfirmed = false }))
            .textFieldStyle(.roundedBorder)
    }

    @ViewBuilder
    private func fcffSourceSection() -> some View {
        let reportedFacts = fcffFacts.filter { $0.isCurrentlyUsable && $0.valueStatus == "reported"
            && $0.source.materialRevisionState == "current" && $0.source.freshness == "fresh" }
        let annualFlowDates = fcffFacts.filter { FcffDraft.historicalMetrics.values.contains($0.metric)
            && $0.periodKind == "duration" && $0.periodEnd.hasSuffix("-12-31") }.map(\.periodEnd)
        let bridgeDates = reportedFacts.filter {
            $0.periodKind == "instant" && FcffDraft.bridgeMetrics.values.contains($0.metric)
        }.map(\.periodEnd)
        let balanceDates = Array(Set(bridgeDates)).sorted().reversed()
        let dateToExplain = researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate.isEmpty
            ? balanceDates.first : researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate
        let cashMissingForDate = dateToExplain.map { date in
            !reportedFacts.contains { $0.metric == "cash_and_cash_equivalents" && $0.periodKind == "instant"
                && $0.periodEnd == date }
        } ?? false
        let annualDates = Array(Set(annualFlowDates
            + bridgeDates.compactMap { date -> String? in
                guard let year = Int(date.prefix(4)) else { return nil }
                return "\(year - 1)-12-31"
            })).sorted().reversed()
        Picker("历史年度流量", selection: Binding(
            get: { researchValuationScenarioWorkspace.fcffDraft.historicalAnnualPeriodEnd },
            set: { researchValuationScenarioWorkspace.fcffDraft.historicalAnnualPeriodEnd = $0
                researchValuationScenarioWorkspace.fcffDraft.selectAvailableFacts(fcffFacts)
                fcffSelectionChanged() })) {
            Text("选择年度").tag("")
            ForEach(Array(annualDates), id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.menu)
        Picker("资产负债表及股数参考日", selection: Binding(
            get: { researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate },
            set: { researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate = $0
                researchValuationScenarioWorkspace.fcffDraft.selectAvailableFacts(fcffFacts)
                fcffSelectionChanged() })) {
            Text("选择报告日").tag("")
            ForEach(Array(balanceDates), id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.menu)
        if researchFundamentalWorkspace.envelope == nil {
            Text("基本面事实尚未读取。请刷新基本面后再选择报告日。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        } else if balanceDates.isEmpty {
            Text("当前没有已保存且可用的资产负债表或股数原始行，因此没有可选参考日。已保存 PDF 中的候选数值须先核对原文、期间、单位和范围，再保存为基本面事实。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        } else if cashMissingForDate, let dateToExplain {
            Text("报告日 \(dateToExplain) 缺少现金及等价物原始行。可先查看其他缺项；计算前须按发行人原文补齐并回读。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        }
        if balanceDates.isEmpty || cashMissingForDate {
            Button("前往基本面核对原文并补充财务事实") {
                selectedEvidenceWorkspace = .facts
                pendingDecisionWorkspaceScrollTarget = "researchFundamentalsAnchor"
            }
            .font(OwnerReadingFont.caption)
        }
        TextField("估值截止日，例如 2026-10-12", text: Binding(
            get: { researchValuationScenarioWorkspace.fcffDraft.valuationCutoff },
            set: { researchValuationScenarioWorkspace.fcffDraft.valuationCutoff = $0
                researchValuationScenarioWorkspace.fcffDraft.resetForecastPeriods()
                fcffAssumptionsChanged() }))
            .textFieldStyle(.roundedBorder)
        if !researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate.isEmpty {
            Button("按当前原始行重新选择") {
                researchValuationScenarioWorkspace.fcffDraft.selectAvailableFacts(fcffFacts)
                fcffSelectionChanged()
            }
            DisclosureGroup("核对资产负债表原始行与股数") {
                ForEach(FcffDraft.bridgeMetrics.keys.sorted(), id: \.self) { role in
                    fcffFixedSourcePicker(role: role, metric: FcffDraft.bridgeMetrics[role]!)
                }
                fcffBucketSources(title: "非经营性资产原始行", metrics: FcffDraft.nonOperatingMetrics,
                                  ids: \.nonOperatingAssetValueIds)
                fcffBucketSources(title: "其他权益索取权原始行", metrics: FcffDraft.otherClaimMetrics,
                                  ids: \.otherClaimValueIds)
            }
            DisclosureGroup("历史年度行及营运资本（缺项会显式显示，不阻断个人预测）") {
                ForEach(FcffDraft.historicalMetrics.keys.sorted(), id: \.self) { role in
                    fcffHistoricalSourcePicker(role: role, metric: FcffDraft.historicalMetrics[role]!)
                }
                Text("营运资本来源：\(researchValuationScenarioWorkspace.fcffDraft.workingCapitalValueIds.values.flatMap { $0 }.count) 行；未完整录入会标记为缺项。")
                    .font(OwnerReadingFont.caption)
                ForEach(["currentAsset", "currentLiability", "priorAsset", "priorLiability"], id: \.self) { role in
                    fcffWorkingCapitalSources(role: role)
                }
            }
            Button(researchValuationScenarioWorkspace.fcffBusy ? "正在核对来源" : "核对 FCFF 原件与来源口径") {
                Task { await loadFcffSourcePreview() }
            }.disabled(researchValuationScenarioWorkspace.fcffBusy
                || researchValuationScenarioWorkspace.fcffDraft.selection == nil)
        }
    }

    @ViewBuilder
    private func fcffHistoricalSourcePicker(role: String, metric: String) -> some View {
        let choices = fcffFacts.filter { $0.metric == metric
            && $0.periodEnd == researchValuationScenarioWorkspace.fcffDraft.historicalAnnualPeriodEnd
            && $0.periodKind == "duration" && $0.valueState == "current"
            && $0.valueStatus == "reported" }
        Picker(metric, selection: Binding(
            get: { (researchValuationScenarioWorkspace.fcffDraft.historicalValueIds[role] ?? nil) ?? "" },
            set: { researchValuationScenarioWorkspace.fcffDraft.historicalValueIds[role] = $0.isEmpty ? nil : $0
                fcffSelectionChanged() })) {
            Text("历史参考缺项").tag("")
            ForEach(choices) { fact in
                Text("#\(fact.id) · \(fact.value ?? "?") ×\(fact.unitScale)").tag(fact.id)
            }
        }.pickerStyle(.menu)
        if let id = researchValuationScenarioWorkspace.fcffDraft.historicalValueIds[role] ?? nil,
           let fact = choices.first(where: { $0.id == id }) {
            Button("核对 \(metric) 原文 #\(id)") { Task { await openResearchFundamentalSource(fact) } }
                .font(OwnerReadingFont.caption)
        }
    }

    @ViewBuilder
    private func fcffWorkingCapitalSources(role: String) -> some View {
        let draft = researchValuationScenarioWorkspace.fcffDraft
        let priorYear = (Int(draft.historicalAnnualPeriodEnd.prefix(4)) ?? 1) - 1
        let date = role.hasPrefix("prior") ? "\(priorYear)-12-31" : draft.historicalAnnualPeriodEnd
        let metrics = role.hasSuffix("Asset") ? FcffDraft.workingCapitalAssetMetrics
            : FcffDraft.workingCapitalLiabilityMetrics
        let choices = fcffFacts.filter { metrics.contains($0.metric) && $0.periodEnd == date
            && $0.periodKind == "instant" && $0.valueState == "current"
            && $0.valueStatus == "reported" }
        Text("\(role) · \(date)").font(OwnerReadingFont.caption.bold())
        if choices.isEmpty { Text("缺少原始行").font(OwnerReadingFont.caption).foregroundStyle(.orange) }
        ForEach(choices) { fact in
            Toggle("\(fact.metric) #\(fact.id) · \(fact.value ?? "?") ×\(fact.unitScale)",
                isOn: Binding(get: {
                    (researchValuationScenarioWorkspace.fcffDraft.workingCapitalValueIds[role] ?? [])
                        .contains(fact.id)
                }, set: { selected in
                    var ids = researchValuationScenarioWorkspace.fcffDraft.workingCapitalValueIds[role] ?? []
                    ids.removeAll { $0 == fact.id }
                    if selected { ids.append(fact.id) }
                    researchValuationScenarioWorkspace.fcffDraft.workingCapitalValueIds[role] = ids.sorted()
                    fcffSelectionChanged()
                }))
            Button("核对原文 #\(fact.id)") { Task { await openResearchFundamentalSource(fact) } }
                .font(OwnerReadingFont.caption)
        }
    }

    @ViewBuilder
    private func fcffFixedSourcePicker(role: String, metric: String) -> some View {
        let date = researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate
        let choices = fcffFacts.filter { $0.metric == metric && $0.periodEnd == date
            && $0.valueStatus == "reported" && $0.valueState == "current" }
        Picker(metric, selection: Binding(
            get: { (researchValuationScenarioWorkspace.fcffDraft.bridgeValueIds[role] ?? nil) ?? "" },
            set: { researchValuationScenarioWorkspace.fcffDraft.bridgeValueIds[role] = $0.isEmpty ? nil : $0
                fcffSelectionChanged() })) {
            Text("缺项").tag("")
            ForEach(choices) { fact in
                Text("#\(fact.id) · \(fact.value ?? "?") ×\(fact.unitScale)").tag(fact.id)
            }
        }.pickerStyle(.menu)
        if let id = researchValuationScenarioWorkspace.fcffDraft.bridgeValueIds[role] ?? nil,
           let fact = choices.first(where: { $0.id == id }) {
            Button("核对 \(metric) 原文 #\(id)") { Task { await openResearchFundamentalSource(fact) } }
                .font(OwnerReadingFont.caption)
        }
    }

    @ViewBuilder
    private func fcffBucketSources(title: String, metrics: Set<String>,
                                   ids: WritableKeyPath<FcffDraft, [String]>) -> some View {
        Text(title).font(OwnerReadingFont.caption.bold())
        let choices = fcffFacts.filter { metrics.contains($0.metric)
            && $0.periodEnd == researchValuationScenarioWorkspace.fcffDraft.balanceReferenceDate
            && $0.valueStatus == "reported" && $0.valueState == "current" }
        if choices.isEmpty { Text("缺少原始行").foregroundStyle(.orange) }
        ForEach(choices) { fact in
            Toggle("\(fact.metric) #\(fact.id) · \(fact.value ?? "?") ×\(fact.unitScale)",
                isOn: Binding(get: {
                    researchValuationScenarioWorkspace.fcffDraft[keyPath: ids].contains(fact.id)
                }, set: { selected in
                    var selectedIds = researchValuationScenarioWorkspace.fcffDraft[keyPath: ids]
                    selectedIds.removeAll { $0 == fact.id }
                    if selected { selectedIds.append(fact.id) }
                    researchValuationScenarioWorkspace.fcffDraft[keyPath: ids] = selectedIds.sorted()
                    fcffSelectionChanged()
                }))
            Button("核对原文 #\(fact.id)") { Task { await openResearchFundamentalSource(fact) } }
                .font(OwnerReadingFont.caption)
        }
    }

    @ViewBuilder
    private func fcffSourceStatus(_ preview: FcffSourcePreview) -> some View {
        let cutoff = researchValuationScenarioWorkspace.fcffDraft.valuationCutoff
        let unpublished = preview.facts.filter { fact in
            guard let day = fcffPublishedHongKongDay(fact.publishedAt) else { return true }
            return day > cutoff
        }
        Text("来源 \(preview.status != "available" ? "权益桥接缺项" : unpublished.isEmpty ? "可用于该估值日" : "发布日期待核") · 币种 \(preview.currency ?? "未知") · 年度 \(preview.historicalAnnualPeriodEnd) · 资产负债表 \(preview.balanceReferenceDate)")
            .font(OwnerReadingFont.caption.bold())
        if !unpublished.isEmpty {
            Text("估值截止 \(cutoff.isEmpty ? "未填写" : cutoff) 时以下原件尚未证明已公开，不能保存：\(unpublished.map { "\($0.metric) #\($0.id) 发布 \(fcffPublishedHongKongDay($0.publishedAt) ?? "UNKNOWN")" }.joined(separator: "；"))。按香港日历整日比较，未知发布日期不会用财报期末日代替。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        }
        if !preview.historicalMissingRoles.isEmpty || !preview.workingCapitalMissing.isEmpty {
            Text("历史数据未覆盖：\((preview.historicalMissingRoles + preview.workingCapitalMissing).joined(separator: "、"))。这不是零值，未来预测仍需你填写。")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
        }
        if !preview.missingBridgeRoles.isEmpty {
            Text("保存前须补齐：\(preview.missingBridgeRoles.joined(separator: "、"))")
                .font(OwnerReadingFont.caption).foregroundStyle(.orange)
            Button("前往基本面核对原文并补充财务事实") {
                selectedEvidenceWorkspace = .facts
                pendingDecisionWorkspaceScrollTarget = "researchFundamentalsAnchor"
            }
            .font(OwnerReadingFont.caption)
        }
        if let ebit = preview.historicalOperatingProfitBasis {
            Text("历史经营利润参考 \(ebit.value)：包含其他收益，未做持续性标准化。")
                .font(OwnerReadingFont.caption)
        }
        if let capex = preview.historicalCashCapitalExpenditureBasis {
            Text("历史现金资本开支分项 \(capex.value)：不等同完整再投入。")
                .font(OwnerReadingFont.caption)
        }
        if let wc = preview.workingCapital {
            Text("历史非现金营运资本增加 \(wc.increase)，由原始行计算。")
                .font(OwnerReadingFont.caption)
        }
    }

    @ViewBuilder
    private func fcffForecastForm(preview: FcffSourcePreview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("截止日之后的个人现金流预测（金额为 \(preview.currency ?? "来源币种") 基础单位）")
                .font(OwnerReadingFont.caption.bold())
            ForEach(researchValuationScenarioWorkspace.fcffDraft.forecast.indices, id: \.self) { index in
                fcffYearFields(index: index)
            }
            Button("增加完整预测年度") {
                let oldTerminal = researchValuationScenarioWorkspace.fcffDraft.terminalNextYear
                if let year = Int(oldTerminal.periodEnd.prefix(4)),
                   researchValuationScenarioWorkspace.fcffDraft.forecast.count < 10 {
                    researchValuationScenarioWorkspace.fcffDraft.forecast.append(oldTerminal)
                    researchValuationScenarioWorkspace.fcffDraft.terminalNextYear = FcffYearDraft(
                        periodStart: "\(year + 1)-01-01", periodEnd: "\(year + 1)-12-31")
                    fcffAssumptionsChanged()
                }
            }.disabled(researchValuationScenarioWorkspace.fcffDraft.forecast.count >= 10)
            if researchValuationScenarioWorkspace.fcffDraft.forecast.count > 2 {
                Button("移除最后预测年度") {
                    let removed = researchValuationScenarioWorkspace.fcffDraft.forecast.removeLast()
                    researchValuationScenarioWorkspace.fcffDraft.terminalNextYear = FcffYearDraft(
                        periodStart: removed.periodStart, periodEnd: removed.periodEnd)
                    fcffAssumptionsChanged()
                }
            }
            fcffYearFields(index: nil)
            Text("折现与终值（小数，例如 0.10 表示 10%）").font(OwnerReadingFont.caption.bold())
            fcffField("WACC", \.wacc)
            fcffField("永续增长率 g", \.terminalGrowthRate)
            fcffField("WACC 敏感性步长", \.waccStep)
            fcffField("增长率敏感性步长", \.terminalGrowthStep)
            if let reference = preview.bridgeReference {
                Text("来源参考：现金 \(reference.cashAndEquivalents)；非经营资产候选 \(reference.nonOperatingAssets)；借款及债券 \(reference.interestBearingDebtExcludingLeases)；租赁 \(reference.leaseLiabilities)；少数股东账面 \(reference.nciBookValue)；其他索取权 \(reference.otherClaims)；已发行股 \(reference.issuedShares) − 库存股 \(reference.treasuryShares) = \(reference.ordinaryShares) 股。")
                    .font(OwnerReadingFont.caption)
            }
            Text("资产负债表至估值日的个人调整；不明项留空，不自动作零。")
                .font(OwnerReadingFont.caption.bold())
            fcffField("现金期后变动（可负）", \.cashSinceReferenceAdjustment)
            fcffField("最低经营现金", \.minimumOperatingCash)
            fcffField("非经营资产调整（可负）", \.nonOperatingAssetAdjustment)
            fcffField("借款及债券期后变动（可负）", \.debtSinceReferenceAdjustment)
            fcffField("租赁负债期后变动（可负）", \.leaseSinceReferenceAdjustment)
            fcffField("少数股东公允价值调整（可负）", \.nciFairValueAdjustment)
            fcffField("其他索取权调整（可负）", \.otherClaimsAdjustment)
            fcffField("普通股期后股数变动（整数，可负）", \.ordinarySharesSinceReferenceAdjustment)
            fcffField("潜在摊薄股数（非负整数）", \.potentialDilutionShares)
            fcffField("现金判断理由（至少 8 字）", \.cashReason)
            fcffField("非经营资产判断理由（至少 8 字）", \.nonOperatingAssetsReason)
            fcffField("债务判断理由（至少 8 字）", \.debtReason)
            fcffField("租赁与 WACC 口径理由（至少 8 字）", \.leaseTreatmentReason)
            fcffField("少数股东价值判断理由（至少 8 字）", \.noncontrollingInterestReason)
            fcffField("其他索取权判断理由（至少 8 字）", \.otherClaimsReason)
            fcffField("摊薄股数判断理由（至少 8 字）", \.dilutedSharesReason)
            fcffField("报告日至估值日差额判断（至少 8 字）", \.balanceDateGapReason)
            fcffField("历史数据缺项与预测口径说明（至少 8 字）", \.historicalBasisReason)
            if let input = researchValuationScenarioWorkspace.fcffDraft.assumptions(preview: preview),
               let local = calculateFcffScenarioPreview(input) {
                Text("保存前核算 · 截止 \(local.valuationCutoff) · ACT/365F · 期末收款")
                    .font(OwnerReadingFont.caption.bold())
                ForEach(local.annual.indices, id: \.self) { index in
                    let row = local.annual[index]
                    Text("\(row.periodStart)–\(row.periodEnd)：FCFF \(row.fcff)，距截止日 \(row.yearsToPayment) 年，现值 \(row.presentValue)")
                        .font(OwnerReadingFont.caption)
                }
                Text("终值下一整年 FCFF \(local.terminalNextYearFcff)；于 \(local.terminalAnchorDate) 的终值 \(local.terminalEnterpriseValue)；经营企业价值 \(local.operatingEnterpriseValue)；普通股权益 \(local.commonEquityValue)，每股 \(local.commonEquityValuePerShare)。")
                    .font(OwnerReadingFont.caption)
                let b = input.bridge
                Text("权益桥接：+现金 \(b.excessCash) +非经营资产 \(b.nonOperatingAssets) −债务 \(b.interestBearingDebt) −租赁 \(b.leaseLiabilitiesNotInDebt) −少数股东 \(b.noncontrollingInterests) −其他索取权 \(b.otherNonordinaryClaims)；÷摊薄股数 \(b.dilutedOrdinaryShares)。")
                    .font(OwnerReadingFont.caption)
                ForEach(local.sensitivity.cells.indices, id: \.self) { index in
                    let cell = local.sensitivity.cells[index]
                    Text("WACC \(cell.wacc) / g \(cell.terminalGrowthRate)：\(cell.commonEquityValuePerShare) /股")
                        .font(OwnerReadingFont.caption)
                }
            } else {
                Text("预测、桥接或日期尚未完整，不能形成保存前核算。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.orange)
            }
            Toggle("我核对了原件、日期差额、逐期预测、终值、九格敏感性和普通股桥接；这些均是我的情景判断", isOn: Binding(
                get: { researchValuationScenarioWorkspace.fcffOwnerConfirmed },
                set: { researchValuationScenarioWorkspace.fcffOwnerConfirmed = $0 }))
            Button("保存 FCFF 情景") { Task { await saveFcffScenario() } }
                .disabled(researchValuationScenarioWorkspace.fcffBusy
                    || !researchValuationScenarioWorkspace.fcffOwnerConfirmed
                    || researchValuationScenarioWorkspace.fcffDraft.assumptions(preview: preview)
                        .flatMap(calculateFcffScenarioPreview) == nil)
        }
    }

    @ViewBuilder
    private func fcffYearFields(index: Int?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            let period = index.map { researchValuationScenarioWorkspace.fcffDraft.forecast[$0] }
                ?? researchValuationScenarioWorkspace.fcffDraft.terminalNextYear
            Text(index == nil ? "终值下一整年 \(period.periodStart)–\(period.periodEnd)"
                : "预测 \(period.periodStart)–\(period.periodEnd)")
                .font(OwnerReadingFont.caption.bold())
            fcffYearField("经营利润 EBIT", index: index, \.ebit)
            fcffYearField("经营税率（0–1）", index: index, \.operatingTaxRate)
            fcffYearField("折旧摊销", index: index, \.depreciationAmortization)
            fcffYearField("完整资本再投入", index: index, \.grossCapitalReinvestment)
            fcffYearField("非现金营运资本增加，可为负", index: index, \.increaseInNoncashWorkingCapital)
        }.padding(6).background(Color(.secondarySystemGroupedBackground))
    }

    private func fcffYearField(_ title: String, index: Int?,
                               _ field: WritableKeyPath<FcffYearDraft, String>) -> some View {
        TextField(title, text: Binding(get: {
            if let index { return researchValuationScenarioWorkspace.fcffDraft.forecast[index][keyPath: field] }
            return researchValuationScenarioWorkspace.fcffDraft.terminalNextYear[keyPath: field]
        }, set: { value in
            if let index { researchValuationScenarioWorkspace.fcffDraft.forecast[index][keyPath: field] = value }
            else { researchValuationScenarioWorkspace.fcffDraft.terminalNextYear[keyPath: field] = value }
            fcffAssumptionsChanged()
        })).keyboardType(.numbersAndPunctuation).textFieldStyle(.roundedBorder)
    }

    private func fcffField(_ title: String, _ field: WritableKeyPath<FcffDraft, String>) -> some View {
        TextField(title, text: Binding(get: {
            researchValuationScenarioWorkspace.fcffDraft[keyPath: field]
        }, set: { value in
            researchValuationScenarioWorkspace.fcffDraft[keyPath: field] = value
            fcffAssumptionsChanged()
        })).textFieldStyle(.roundedBorder)
    }
}
