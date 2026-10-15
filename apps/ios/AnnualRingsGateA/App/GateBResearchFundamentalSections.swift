import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func researchFundamentalsSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("基本面")
                    .font(OwnerReadingFont.title3.bold())
                Spacer()
                Button {
                    Task { await loadResearchFundamentals() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(
                    researchFundamentalWorkspace.isBusy
                        || researchDocumentWorkspace.isBusy
                        || selectedMembership == nil
                )
                .accessibilityLabel("刷新结构化基本面")
            }
            Text("公司披露 · 由你手工录入 · 尚未独立验证。核对原文不等于独立验证；缺失值不会补零。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)

#if OWNER_CLIENT
            if let envelope = researchFundamentalWorkspace.envelope { fundamentalReadBack(envelope) }
            NavigationLink {
                ClientReadingPage(title: "录入财务事实") {
                    ClientCard(title: "原文引用与事实", icon: "tablecells", tone: Theme.green) {
                        if currentFundamentalMaterials.isEmpty {
                            Text("先在资料与原文中核对当前 PDF 页或已保存网页，再录入事实。")
                        } else { fundamentalEntryForm() }
                    }
                }
            } label: { ClientLinkLabel(title: "补充或修订财务事实", icon: "square.and.pencil", tone: Theme.green) }
                .buttonStyle(.plain)
#else
            if currentFundamentalMaterials.isEmpty {
                Text("请先在上方确认一条当前原文引用。")
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
            } else {
                fundamentalEntryForm()
            }

            if let envelope = researchFundamentalWorkspace.envelope {
                fundamentalReadBack(envelope)
            }
#endif
            researchFinancialRequirementSection()
            Text(researchFundamentalWorkspace.message)
                .font(OwnerReadingFont.callout)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchFundamentalMessage")
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .id("researchFundamentalsAnchor")
    }

    @ViewBuilder
    private func researchFinancialRequirementSection() -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("财务资料期数核对").font(OwnerReadingFont.headline)
                Spacer()
                Button {
                    Task { if let membership = selectedMembership {
                        await loadResearchFinancialRequirement(for: membership)
                    } }
                } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(selectedMembership == nil || researchFinancialRequirementWorkspace.isBusy)
                    .accessibilityLabel("刷新财务期数核对")
            }
            Text("逐份查看已保存的官方原文，核对截至指定日期应有的年度和中期资料。保存只记录你的核对，不会确认报告或形成决定。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            if let requirement = researchFinancialRequirementWorkspace.envelope?.data,
               researchFinancialRequirementWorkspace.envelope?.status == "available" {
                Text("截至 \(compactUtcDateTime(requirement.asOf)) · 财政年结 \(requirement.fiscalYearEnd)")
                    .font(OwnerReadingFont.callout.bold())
                Text("应有年度至 \(requirement.latestRequiredAnnualPeriodEnd)；中期 \(requirement.latestRequiredInterimPeriodStart) 至 \(requirement.latestRequiredInterimPeriodEnd)")
                    .font(OwnerReadingFont.callout)
                Text("下次复核 \(compactUtcDateTime(requirement.nextReviewAt)) · 当前有效至 \(compactUtcDateTime(requirement.validUntil)) · \(requirement.sources.count) 份原文")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                if let gaps = researchFinancialRequirementWorkspace.envelope?.gaps, !gaps.isEmpty {
                    ForEach(gaps, id: \.self) { gap in
                        Text("待补：\(financialRequirementGapLabel(gap))")
                            .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                    }
                }
            } else if let envelope = researchFinancialRequirementWorkspace.envelope {
                Text(envelope.status == "not_found" ? "尚未保存期数核对；财务覆盖仍待核验。"
                     : "先前核对已失效或来源暂不可用；当前不视为已覆盖。")
                    .font(OwnerReadingFont.callout).foregroundStyle(.orange)
                ForEach(envelope.gaps, id: \.self) { gap in
                    Text("待补：\(financialRequirementGapLabel(gap))")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                }
            } else {
                Text("当前期数核对未读取；仍待核验。")
                    .font(OwnerReadingFont.callout).foregroundStyle(.secondary)
            }
#if OWNER_CLIENT
            NavigationLink {
                ClientReadingPage(title: "核对财务资料期数") {
                    ClientCard(title: "已保存原文与应有期间", icon: "calendar.badge.checkmark", tone: Theme.green) {
                        researchFinancialRequirementForm()
                    }
                }
            } label: { ClientLinkLabel(title: "核对并保存财务资料期数", icon: "calendar.badge.checkmark", tone: Theme.green) }
                .buttonStyle(.plain)
#else
            researchFinancialRequirementForm()
#endif
            Text(researchFinancialRequirementWorkspace.message)
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("researchFinancialRequirementMessage")
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("researchFinancialRequirementSection")
    }

    private func financialRequirementGapLabel(_ gap: String) -> String {
        if gap.contains("has not been checked") { return "尚未核对截至日期应有的财务资料" }
        if gap.contains("membership version changed") { return "当前公司资料版本已变化" }
        if gap.contains("expired") { return "期数核对或来源复核已到期" }
        if gap.contains("as-of is in the future") { return "核对截至时间尚未到来" }
        if gap.hasPrefix("source material ") { return "所选原文已变化或暂不可打开" }
        if gap.contains("annual period is absent") { return "所选原文未出现应有年度的期末日期" }
        if gap.contains("interim period is absent") { return "所选原文未出现应有中期的期末日期" }
        return "所选原文与期间尚需重新核对"
    }

    private func researchFinancialRequirementForm() -> some View {
        let materials = currentFinancialRequirementMaterials
        return VStack(alignment: .leading, spacing: 9) {
            if materials.isEmpty {
                Text("目前没有可核对的已保存官方原文。先在资料与原文中保存并确认来源。")
                    .font(OwnerReadingFont.callout).foregroundStyle(.orange)
            } else {
                Text("选择 1–4 份原文；财政年结和披露边界可以来自不同资料。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                ForEach(materials) { material in
                    HStack(alignment: .top, spacing: 8) {
                        Button {
                            if researchFinancialRequirementWorkspace.selectedMaterialIds.contains(material.id) {
                                researchFinancialRequirementWorkspace.selectedMaterialIds.remove(material.id)
                            } else if researchFinancialRequirementWorkspace.selectedMaterialIds.count < 4 {
                                researchFinancialRequirementWorkspace.selectedMaterialIds.insert(material.id)
                            }
                            researchFinancialRequirementWorkspace.ownerConfirmed = false
                            researchFinancialRequirementWorkspace.reservation.clear()
                        } label: {
                            Image(systemName: researchFinancialRequirementWorkspace.selectedMaterialIds.contains(material.id)
                                  ? "checkmark.square.fill" : "square")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("选择 \(material.title)")
                        VStack(alignment: .leading, spacing: 3) {
                            Text(material.title).font(OwnerReadingFont.callout)
                            let claim = material.claimType == "verified_fact" ? "已核实事实"
                                : material.claimType == "third_party_statement" ? "第三方陈述或规则" : "发行人声明"
                            Text("\(claim) · " + (material.snapshotCitation == nil
                                 ? "已保存 PDF 第 \(material.citation?.pageNumber ?? 1) 页"
                                 : "已保存网页段落"))
                                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                            Button("打开原文核对") {
                                Task { await openResearchFinancialRequirementSource(material) }
                            }
                            .font(OwnerReadingFont.caption)
                        }
                    }
                }
            }
            TextField("财政年结（月-日，例如 12-31）", text: $researchFinancialRequirementWorkspace.fiscalYearEnd)
                .textInputAutocapitalization(.never).textFieldStyle(.roundedBorder)
            TextField("应有最新年度结束 YYYY-MM-DD", text: $researchFinancialRequirementWorkspace.annualPeriodEnd)
                .textFieldStyle(.roundedBorder)
            TextField("应有最新中期开始 YYYY-MM-DD", text: $researchFinancialRequirementWorkspace.interimPeriodStart)
                .textFieldStyle(.roundedBorder)
            TextField("应有最新中期结束 YYYY-MM-DD", text: $researchFinancialRequirementWorkspace.interimPeriodEnd)
                .textFieldStyle(.roundedBorder)
            DatePicker("核对截至时间", selection: $researchFinancialRequirementWorkspace.asOf)
            DatePicker("下一次复核时间", selection: $researchFinancialRequirementWorkspace.nextReviewAt)
            Text("日期初值只是草稿。资料有效期可能早于下一次复核时间；保存后以实际回读的有效期和缺口为准。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            Toggle("我已逐份核对原文与上述期间，明确保存这次核对", isOn: $researchFinancialRequirementWorkspace.ownerConfirmed)
            Button {
                Task { await saveResearchFinancialRequirement() }
            } label: {
                Label(researchFinancialRequirementWorkspace.isSaving ? "正在保存并回读" : "保存财务资料期数核对", systemImage: "checkmark.seal")
            }
            .buttonStyle(.borderedProminent)
            .disabled(researchFinancialRequirementWorkspace.isBusy || materials.isEmpty
                || !researchFinancialRequirementWorkspace.ownerConfirmed)
            .accessibilityIdentifier("researchFinancialRequirementSaveButton")
        }
        .onChange(of: [researchFinancialRequirementWorkspace.fiscalYearEnd,
                       researchFinancialRequirementWorkspace.annualPeriodEnd,
                       researchFinancialRequirementWorkspace.interimPeriodStart,
                       researchFinancialRequirementWorkspace.interimPeriodEnd,
                       String(researchFinancialRequirementWorkspace.asOf.timeIntervalSince1970),
                       String(researchFinancialRequirementWorkspace.nextReviewAt.timeIntervalSince1970)].joined(separator: "|")) { old, new in
            if old != new {
                researchFinancialRequirementWorkspace.ownerConfirmed = false
                researchFinancialRequirementWorkspace.reservation.clear()
            }
        }
    }

    private func fundamentalEntryForm() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("原文来源", selection: Binding(
                get: { researchFundamentalWorkspace.sourceMaterialId },
                set: { researchFundamentalWorkspace.selectSource($0, from: currentFundamentalMaterials) }
            )) {
                Text("请选择来源").tag(nil as String?)
                ForEach(currentFundamentalMaterials) { material in
                    Text("\(material.title) · \(material.snapshotCitation == nil ? "PDF 第\(material.citation?.pageNumber ?? 1)页" : "已保存网页段落")")
                        .tag(material.id as String?)
                }
            }
            .pickerStyle(.menu)

            Group {
                Picker("指标", selection: Binding(
                    get: { researchFundamentalWorkspace.metric },
                    set: { researchFundamentalWorkspace.selectMetric($0) }
                )) {
                    ForEach(ResearchFundamentalMetricCatalog.options) { option in
                        Text(option.title).tag(option.id)
                    }
                }
                .pickerStyle(.menu)

                if !fundamentalMetricIsInstant {
                    DatePicker("期间开始", selection: $researchFundamentalWorkspace.periodStart, displayedComponents: [.date])
                }
                DatePicker(fundamentalMetricIsInstant ? "时点" : "期间结束", selection: $researchFundamentalWorkspace.periodEnd, displayedComponents: [.date])

                ViewThatFits(in: .horizontal) {
                    HStack {
                        if fundamentalMetricIsMonetary { fundamentalCurrencyField() }
                        if fundamentalMetricAllowsScale { fundamentalUnitPicker() }
                        fundamentalScopePicker()
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        if fundamentalMetricIsMonetary { fundamentalCurrencyField() }
                        if fundamentalMetricAllowsScale { fundamentalUnitPicker() }
                        fundamentalScopePicker()
                    }
                }

                if ResearchFundamentalMetricCatalog.coverage.contains(researchFundamentalWorkspace.metric) {
                    Toggle("原文明确为 unknown", isOn: $researchFundamentalWorkspace.explicitUnknown)
                }
                if !researchFundamentalWorkspace.explicitUnknown {
                    TextField(fundamentalValueLabel, text: $researchFundamentalWorkspace.value)
                        .keyboardType(.numbersAndPunctuation)
                        .textFieldStyle(.roundedBorder)
                }
                if fundamentalNeedsAssertion {
                    fundamentalAssertionFields()
                }
                Toggle("与同口径期间可比", isOn: $researchFundamentalWorkspace.comparable)
                if !researchFundamentalWorkspace.comparable {
                    TextField("不可比原因", text: $researchFundamentalWorkspace.comparabilityReason, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                }
                if researchFundamentalWorkspace.replacesValueId != nil {
                    Picker("修订类型", selection: $researchFundamentalWorkspace.amendmentKind) {
                        Text("更正").tag("correction")
                        Text("重述").tag("restatement")
                    }
                    Text("替代原值 #\(researchFundamentalWorkspace.replacesValueId ?? "")；来源与期间链不可改变。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                }
                Toggle("我已对照所选原文，确认录入这一原值或 unknown", isOn: Binding(
                    get: {
                        researchFundamentalWorkspace.confirmationBinding.isConfirmed(
                            for: currentResearchFundamentalSemantic()
                        )
                    },
                    set: {
                        researchFundamentalWorkspace.confirmationBinding.setConfirmed(
                            $0,
                            semantic: currentResearchFundamentalSemantic()
                        )
                    }
                ))
                Button {
                    Task { await saveResearchFundamental() }
                } label: {
                    Label(researchFundamentalWorkspace.isSaving ? "正在保存并核对" : "保存已核对的基本面", systemImage: "checkmark.seal")
                }
                .buttonStyle(.borderedProminent)
                .disabled(fundamentalSaveDisabled)
                .accessibilityIdentifier("researchFundamentalSaveButton")
                Text(researchFundamentalWorkspace.message)
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchFundamentalFormMessage")
            }
            .disabled(researchFundamentalWorkspace.sourceMaterialId == nil)
        }
        .disabled(researchFundamentalWorkspace.isBusy)
        .onChange(of: currentResearchFundamentalSemantic()?.fingerprint) { old, new in
            if old != new { resetFundamentalReservation() }
        }
    }

    private var selectedFundamentalMaterial: ResearchMaterialData? {
        currentFundamentalMaterials.first { $0.id == researchFundamentalWorkspace.sourceMaterialId }
    }

    private var fundamentalOption: ResearchFundamentalMetricOption? {
        ResearchFundamentalMetricCatalog.option(for: researchFundamentalWorkspace.metric)
    }

    private var fundamentalNeedsAssertion: Bool {
        selectedFundamentalMaterial?.sourceType == "issuer_public_html"
            || !ResearchFundamentalMetricCatalog.coverage.contains(researchFundamentalWorkspace.metric)
    }

    private var fundamentalMetricIsMonetary: Bool {
        ["currency", "currency_per_vehicle"].contains(fundamentalOption?.unit ?? "currency")
    }

    private var fundamentalMetricAllowsScale: Bool {
        fundamentalMetricIsMonetary || fundamentalOption?.unit == "vehicles"
    }

    private var fundamentalValueLabel: String {
        switch fundamentalOption?.unit {
        case "vehicles": "销量（按所选单位）"
        case "shares": "股数"
        case "ratio": "比例（0–1，如 0.25）"
        case "currency_per_vehicle": "每辆金额"
        default: "金额（按所选单位）"
        }
    }

    @ViewBuilder
    private func fundamentalAssertionFields() -> some View {
        if selectedFundamentalMaterial?.sourceType == "owner_provided_pdf" {
            Button("读取所选 PDF 原文页") {
                Task { await loadSelectedFundamentalSourcePage() }
            }
            .buttonStyle(.bordered)
            if let page = researchFundamentalWorkspace.sourcePage,
               researchFundamentalWorkspace.sourcePageMaterialId == selectedFundamentalMaterial?.id {
                DisclosureGroup("查看第 \(page.pageNumber) 页原文") {
                    Text(page.normalizedText)
                        .font(OwnerReadingFont.caption)
                        .textSelection(.enabled)
                }
                TextField("从该页复制包含数字的原文摘录", text: $researchFundamentalWorkspace.sourceExcerpt,
                          axis: .vertical)
                    .textFieldStyle(.roundedBorder)
            } else {
                Text("请先读取原文页，再复制该页中的准确摘录。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.orange)
            }
        } else if let excerpt = selectedFundamentalMaterial?.contentText {
            DisclosureGroup("查看已保存网页段落") {
                Text(excerpt).font(OwnerReadingFont.caption).textSelection(.enabled)
            }
        }
        TextField(fundamentalIsExpenseOrOutflow
            ? "原文中的数字（括号负数请连同括号填写）"
            : "原文中的数字（百分比可填 25%）", text: $researchFundamentalWorkspace.rawValueText)
            .textFieldStyle(.roundedBorder)
        if fundamentalIsExpenseOrOutflow {
            Text("报表括号表示支出时，原文数字连同括号照抄；上方金额填写正的费用规模。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
        }
        TextField("业务范围（按原文填写）", text: $researchFundamentalWorkspace.businessScope)
            .textFieldStyle(.roundedBorder)
        if ResearchFundamentalMetricCatalog.measurementBases(for: researchFundamentalWorkspace.metric).count > 1 {
            Picker("统计依据", selection: $researchFundamentalWorkspace.measurementBasis) {
                ForEach(ResearchFundamentalMetricCatalog.measurementBases(for: researchFundamentalWorkspace.metric), id: \.self) { basis in
                    Text(fundamentalBasisTitle(basis)).tag(basis)
                }
            }.pickerStyle(.menu)
        }
        if ResearchFundamentalMetricCatalog.allowsGuidance(researchFundamentalWorkspace.metric) {
            Picker("披露类别", selection: $researchFundamentalWorkspace.category) {
                Text("已实现数值").tag("actual")
                Text("公司指引").tag("guidance")
            }.pickerStyle(.menu)
        }
        if researchFundamentalWorkspace.metric == "product_mix_volume" {
            Picker("产品结构维度", selection: $researchFundamentalWorkspace.mixDimension) {
                Text("品牌").tag("brand")
                Text("动力形式").tag("powertrain")
                Text("地区").tag("geography")
            }.pickerStyle(.menu)
            TextField("具体分类名称", text: $researchFundamentalWorkspace.mixDimensionValue)
                .textFieldStyle(.roundedBorder)
            TextField("所属总范围", text: $researchFundamentalWorkspace.mixParentScope)
                .textFieldStyle(.roundedBorder)
            Picker("分类是否重叠", selection: $researchFundamentalWorkspace.mixOverlapPolicy) {
                Text("上下级包含").tag("nested")
                Text("互不重叠").tag("mutually_exclusive")
                Text("可能重叠").tag("overlapping")
            }.pickerStyle(.menu)
        }
        if researchFundamentalWorkspace.category == "guidance" {
            Picker("指引类型", selection: $researchFundamentalWorkspace.guidanceTargetType) {
                Text("至少").tag("minimum")
                Text("至多").tag("maximum")
                Text("区间").tag("range")
                Text("文字表述").tag("text")
            }.pickerStyle(.menu)
            if researchFundamentalWorkspace.guidanceTargetType != "text" {
                TextField("下限（如有）", text: $researchFundamentalWorkspace.guidanceLower)
                    .keyboardType(.numbersAndPunctuation).textFieldStyle(.roundedBorder)
                TextField("上限（如有）", text: $researchFundamentalWorkspace.guidanceUpper)
                    .keyboardType(.numbersAndPunctuation).textFieldStyle(.roundedBorder)
            }
            TextField("指引定义", text: $researchFundamentalWorkspace.guidanceDefinition, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            TextField("公司原话或准确转录", text: $researchFundamentalWorkspace.guidanceStatement, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            DatePicker("预计核验日期", selection: $researchFundamentalWorkspace.guidanceVerificationDate,
                       displayedComponents: [.date])
        }
        TextField("原文局限或口径说明", text: $researchFundamentalWorkspace.limitation, axis: .vertical)
            .textFieldStyle(.roundedBorder)
        Text("核对：\(fundamentalMetricTitle(researchFundamentalWorkspace.metric)) · \(fundamentalValueLabel) · \(fundamentalBasisTitle(researchFundamentalWorkspace.measurementBasis)) · \(researchFundamentalWorkspace.scope == "consolidated" ? "合并" : researchFundamentalWorkspace.scope == "parent_company" ? "母公司" : researchFundamentalWorkspace.scope == "segment" ? "分部" : "范围未定") · \(researchFundamentalWorkspace.category == "guidance" ? "公司指引" : "已实现数值")")
            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
        Toggle("以上数值、期间、统计范围与原文一致", isOn: Binding(
            get: { researchFundamentalWorkspace.sourceChecked },
            set: { checked in
                researchFundamentalWorkspace.sourceChecked = checked
                researchFundamentalWorkspace.confirmedDetails = checked
                    ? Set(["metric", "period", "currency", "unitScale", "scope", "taxonomy"])
                    : []
            }
        ))
    }

    private func fundamentalBasisTitle(_ basis: String) -> String {
        switch basis {
        case "financial_statement": "财务报表"
        case "issuer_sales": "公司销量披露"
        case "monthly_wholesale": "月度批发"
        case "monthly_retail": "月度零售"
        case "weekly_registration": "周度上牌"
        case "issued_shares": "发行股数"
        default: basis
        }
    }

    private var fundamentalIsExpenseOrOutflow: Bool {
        ResearchFundamentalMetricCatalog.magnitudeOutflows.contains(researchFundamentalWorkspace.metric)
    }

    @ViewBuilder
    private func fundamentalReadBack(_ envelope: ResearchFundamentalsEnvelope) -> some View {
        Divider()
        let coverage = envelope.financialCoverage
        VStack(alignment: .leading, spacing: 6) {
            Label(coverage.status == "available"
                ? "财务覆盖已完整" : "财务覆盖仍有 UNKNOWN",
                systemImage: coverage.status == "available"
                    ? "checkmark.seal.fill" : "questionmark.diamond.fill")
            .font(OwnerReadingFont.headline)
            .foregroundStyle(coverage.status == "available" ? Color.green : Color.orange)
            Text(
                "完整年度 \(coverage.completeAnnualPeriods)/\(coverage.requiredAnnualPeriods)"
                    + " · 最新中期 \(coverage.latestInterimPeriodEnd ?? "UNKNOWN")"
                    + "（\(coverage.latestInterimStatus == "complete" ? "完整" : "UNKNOWN")）"
            )
            .font(OwnerReadingFont.callout)
            if let requirement = coverage.requirement {
                Text("有来源的期数核对：年度至 \(requirement.latestRequiredAnnualPeriodEnd) · 中期至 \(requirement.latestRequiredInterimPeriodEnd) · 下次复核 \(compactUtcDateTime(requirement.nextReviewAt))")
                    .font(OwnerReadingFont.callout)
                Text("截至该次核对，应有最新期末 \(coverage.latestRequiredPeriodEnd ?? "UNKNOWN") · \(coverage.latestRequiredStatus == "available" ? "该期已覆盖" : "该期仍待补足")")
                    .font(OwnerReadingFont.callout)
            } else if coverage.coverageVersion != nil {
                Text("连续历史：\(coverage.historicalStatus == "available" ? "已覆盖" : "待补足") · 最新应披露期间：尚无法确认（缺披露日历）")
                    .font(OwnerReadingFont.callout).foregroundStyle(.orange)
            }
            Text("数据截止 \(envelope.dataCutoffAt.map(compactUtcDateTime) ?? "UNKNOWN") · as-of \(envelope.asOf ?? "UNKNOWN")")
                .font(OwnerReadingFont.caption.monospaced())
                .foregroundStyle(.secondary)
            DisclosureGroup("逐期间覆盖 · \(coverage.periods.count) 期") {
                ForEach(Array(coverage.periods.enumerated()), id: \.offset) { _, period in
                    let missing = period.metrics.filter { $0.value == "unknown" }.keys.sorted()
                    Text(
                        "\(period.periodEnd) · \(period.periodType == "annual" ? "年度" : "中期") · "
                            + (missing.isEmpty ? "完整" : "缺 \(missing.map(fundamentalMetricTitle).joined(separator: "、"))")
                    )
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(missing.isEmpty ? Color.secondary : Color.orange)
                }
            }
            .font(OwnerReadingFont.caption)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchFinancialCoverage")

        Text("原值与来源")
            .font(OwnerReadingFont.headline)
        if envelope.values.isEmpty {
            Text("尚无原值。").foregroundStyle(.secondary)
        } else {
            ForEach(envelope.values) { value in
                let sourceStatus = currentFundamentalSourceStatus(value)
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(fundamentalMetricTitle(value.metric)) · \(value.periodEnd)")
                        .font(OwnerReadingFont.subheadline.bold())
                    Text(value.valueStatus == "explicit_unknown"
                        ? "未知（未补零）"
                        : fundamentalReadBackValue(value))
                        .font(OwnerReadingFont.body.monospacedDigit())
                    Text("\(value.scope == "consolidated" ? "合并口径" : value.scope == "parent_company" ? "母公司口径" : value.scope == "segment" ? "分部口径" : "范围未定") · \(fundamentalValueStateTitle(value.valueState)) · 修订 \(value.revision)")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                    if let assertion = value.assertion {
                        Text("\(fundamentalBasisTitle(assertion.measurementBasis)) · \(assertion.businessScope) · \(assertion.category == "guidance" ? "公司指引" : "已实现数值")")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                    Text(
                        "来源修订 \(value.source.materialRevision) · \(sourceStatus)"
                            + " · 有效至 \(compactUtcDateTime(value.source.validUntil))"
                    )
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(sourceStatus == "当前有效" ? Color.secondary : Color.orange)
                    Text(fundamentalVerificationTitle(value.provenance.verificationStatus))
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                    if let reason = value.comparabilityReason {
                        Text("不可比：\(reason)").font(OwnerReadingFont.caption).foregroundStyle(.orange)
                    }
                    HStack {
                        Button(value.source.kind == "source_snapshot" ? "打开已保存原文" : "打开来源第\(value.source.pageNumber ?? 1)页") {
                            Task { await openResearchFundamentalSource(value) }
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("researchFundamentalSource-\(value.id)")
                        if canPrepareResearchFundamentalReplacement(value) {
                            Button("基于此修正") { prepareResearchFundamentalReplacement(value) }
                                .buttonStyle(.bordered)
                        }
                    }
                }
                .padding(9)
                .background(Color(.tertiarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }

        Text("可复算指标")
            .font(OwnerReadingFont.headline)
            .padding(.top, 4)
        ForEach(Array(envelope.derivations.enumerated()), id: \.offset) { _, item in
            VStack(alignment: .leading, spacing: 3) {
                Text(fundamentalDerivationTitle(item.kind)).font(OwnerReadingFont.subheadline.bold())
                if item.status == "available" {
                    Text("\(item.valueKind == "ratio" ? "比率" : "绝对变化")：\(item.value ?? "—")")
                        .font(OwnerReadingFont.body.monospacedDigit())
                } else {
                    Text("不可比：\(item.reason ?? "输入不足")")
                        .foregroundStyle(.orange)
                }
                Text("公式 \(item.formulaVersion) · 输入 IDs \(item.inputValueIds.joined(separator: ", "))")
                    .font(OwnerReadingFont.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func fundamentalCurrencyField() -> some View {
        TextField("币种", text: $researchFundamentalWorkspace.currency)
            .textInputAutocapitalization(.characters)
            .textFieldStyle(.roundedBorder)
            .frame(minWidth: 90)
    }

    private func fundamentalUnitPicker() -> some View {
        Picker("单位", selection: $researchFundamentalWorkspace.unitScale) {
            Text(fundamentalMetricIsMonetary ? "元" : "辆").tag(1)
            Text(fundamentalMetricIsMonetary ? "千" : "千辆").tag(1_000)
            Text(fundamentalMetricIsMonetary ? "百万" : "百万辆").tag(1_000_000)
            Text(fundamentalMetricIsMonetary ? "十亿" : "十亿辆").tag(1_000_000_000)
        }
        .pickerStyle(.menu)
    }

    private func fundamentalScopePicker() -> some View {
        Picker("口径", selection: $researchFundamentalWorkspace.scope) {
            Text("合并").tag("consolidated")
            Text("母公司").tag("parent_company")
            Text("分部").tag("segment")
            Text("未明确").tag("unknown")
        }
        .pickerStyle(.menu)
    }

    private var fundamentalMetricIsInstant: Bool {
        fundamentalOption?.isInstant == true
    }

    private var fundamentalSaveDisabled: Bool {
        researchFundamentalWorkspace.isBusy
            || currentResearchFundamentalSemantic() == nil
            || !researchFundamentalWorkspace.confirmationBinding.isConfirmed(
                for: currentResearchFundamentalSemantic()
            )
            || researchFundamentalWorkspace.sourceMaterialId == nil
            || (!researchFundamentalWorkspace.explicitUnknown
                && researchFundamentalWorkspace.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            || (!researchFundamentalWorkspace.comparable
                && researchFundamentalWorkspace.comparabilityReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func resetFundamentalReservation() {
        researchFundamentalWorkspace.confirmationBinding.clear()
        researchFundamentalWorkspace.reservation.clear()
    }

    func fundamentalMetricTitle(_ metric: String) -> String {
        ResearchFundamentalMetricCatalog.option(for: metric)?.title ?? metric
    }

    private func fundamentalReadBackValue(_ value: ResearchFundamentalValueData) -> String {
        let unit = value.assertion?.unit ?? ResearchFundamentalMetricCatalog.option(for: value.metric)?.unit ?? "currency"
        let suffix: String
        switch unit {
        case "vehicles": suffix = value.unitScale == 1 ? "辆" : "× \(value.unitScale) 辆"
        case "shares": suffix = "股"
        case "ratio": suffix = "（比例）"
        case "currency_per_vehicle": suffix = "× \(value.unitScale) \(value.currency)/辆"
        default: suffix = "× \(value.unitScale) \(value.currency)"
        }
        return "\(value.value ?? "—") \(suffix)"
    }

    private func fundamentalVerificationTitle(_ status: String) -> String {
        switch status {
        case "source_text_verified": "原文数字已核对"
        case "owner_confirmed": "已由用户确认口径"
        default: "尚未独立验证"
        }
    }

    func fundamentalDerivationTitle(_ kind: String) -> String {
        switch kind {
        case "revenue_yoy": "收入同比"
        case "profit_change": "归母利润变化"
        case "profit_margin": "归母利润率"
        case "cash_conversion": "现金转换率"
        case "liability_ratio": "负债率"
        default: kind
        }
    }

    private func fundamentalValueStateTitle(_ state: String) -> String {
        switch state {
        case "current": "当前"
        case "replaced": "已替代"
        case "historical_source_superseded": "来源已替代，仅历史"
        case "historical_source_stale": "来源已过期，仅历史"
        default: state
        }
    }
}
