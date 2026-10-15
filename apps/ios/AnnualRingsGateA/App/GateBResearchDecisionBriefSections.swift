import SwiftUI
enum AnnualDecisionBriefResearchPage: String, CaseIterable, Identifiable {
    case profile
    case evidence

    var id: String { rawValue }
    var title: String { self == .profile ? "研究论点" : "证据记录" }
    var systemImage: String { self == .profile ? "text.quote" : "doc.badge.plus" }
}

extension GateBResearchScreen {
    @ViewBuilder
    func annualDecisionBriefSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("每日决策简报")
                    .accessibilityIdentifier("annualDecisionBriefTitle")
                Spacer()
                Text(annualDecisionBriefStateLabel(annualDecisionBriefModel.state))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(annualDecisionBriefStateColor)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(annualDecisionBriefStateColor.opacity(0.1), in: Capsule())
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualDecisionBriefState")
            }

            Text(annualDecisionBriefModel.title)
                .font(.callout.weight(.semibold))
                .accessibilityIdentifier("annualDecisionBriefReadinessTitle")
            Text(annualDecisionBriefDisplayMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("annualDecisionBriefMessage")

            if let data = annualDecisionBriefModel.data {
                annualDecisionBriefTargetSummary(data)
                DisclosureGroup {
                    annualDecisionBriefIdentity(data)
                        .padding(.top, 8)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("事实来源与身份", systemImage: "checkmark.shield")
                            .font(.callout.weight(.semibold))
                        Text(annualDecisionBriefIdentitySummary(data))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(annualDecisionBriefIdentityAccessibilityLabel(data))
                            .accessibilityIdentifier("annualDecisionBriefIdentitySummary")
                    }
                }
                .accessibilityIdentifier("annualDecisionBriefIdentityDisclosure")
                annualDecisionBriefThesis(data)
                annualDecisionBriefVariables(data.keyVariables)
                BulletList(title: "催化观察", items: data.catalysts)
                annualDecisionBriefEvidenceGroup(title: "支持证据", items: data.evidence.support)
                annualDecisionBriefEvidenceGroup(title: "反方证据", items: data.evidence.counter)
                annualDecisionBriefEvidenceGroup(title: "中性证据", items: data.evidence.neutral)
                annualDecisionBriefConflicts(data.evidence.conflicts)
                BulletList(title: "明确证据缺口", items: data.evidence.gaps)
                BulletList(title: "服务端 readiness 原因", items: data.readiness.reasons)
                InfoBlock(
                    title: "辅助边界",
                    value: "不改变候选顺序，不生成推荐、排名、目标价、目标仓位、交易方向、订单或成交。",
                    valueIdentifier: "annualDecisionBriefSafety"
                )
            } else {
                Text("当前没有可展示的简报事实；旧候选或部分响应不会复用。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("annualDecisionBriefFailClosed")
            }

            if let membership = selectedMembership {
                Button {
                    Task { await loadAnnualDecisionBrief(for: membership) }
                } label: {
                    Label(isLoadingDecisionBrief ? "读取中" : "刷新每日简报", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingDecisionBrief || isWritingAnnualDecisionBriefResearch)
                .accessibilityIdentifier("annualDecisionBriefRefreshButton")
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualDecisionBriefSection")
    }

    @ViewBuilder
    func annualDecisionBriefResearchEditorSection() -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "square.and.pencil")
                    .foregroundStyle(DailyDecisionRingLayer.evidence.tint)
                SectionTitle("维护研究事实")
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("annualDecisionBriefResearchEditorDisclosure")

            Text(annualDecisionBriefProfileDraftSourceMessage)
                .font(.footnote)
                .foregroundStyle(annualDecisionBriefProfileDraftSource == nil ? .red : .secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("annualDecisionBriefProfileDraftSource")
            annualDecisionBriefResearchPagePicker()
            if selectedResearchEditorPage == .profile { annualDecisionBriefProfileEditor() } else { annualDecisionBriefEvidenceEditor() }
            Button {
                if selectedResearchEditorPage == .profile { Task { await submitAnnualDecisionBriefProfile() } }
                else { Task { await submitAnnualDecisionBriefEvidence() } }
            } label: {
                Label(isWritingAnnualDecisionBriefResearch ? "保存中" : selectedResearchEditorPage == .profile ? "确认并保存论点与监控规则" : "记录这条证据", systemImage: selectedResearchEditorPage == .profile ? "tray.and.arrow.down" : "doc.badge.plus").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).disabled(selectedResearchEditorPage == .profile ? !annualDecisionBriefProfileWriteEnabled : !annualDecisionBriefEvidenceWriteEnabled).accessibilityIdentifier("annualDecisionBriefResearchPrimarySave")
            if let annualDecisionBriefWriteMessage { Text(annualDecisionBriefWriteMessage).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("annualDecisionBriefWriteMessage") }
        }
        .id("annualDecisionBriefResearchEditorAnchor")
    }

    private func annualDecisionBriefResearchPagePicker() -> some View {
        HStack(spacing: 10) {
            ForEach(AnnualDecisionBriefResearchPage.allCases) { page in
                Button {
                    selectedResearchEditorPage = page
                } label: {
                    Label(page.title, systemImage: page.systemImage)
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(
                            selectedResearchEditorPage == page ? Color.blue.opacity(0.12) : Color.clear,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                }
                .buttonStyle(.plain)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(selectedResearchEditorPage == page ? Color.blue.opacity(0.45) : Color.secondary.opacity(0.18))
                }
                .accessibilityIdentifier("annualDecisionBriefResearchPage-\(page.rawValue)")
                .accessibilityAddTraits(selectedResearchEditorPage == page ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualDecisionBriefResearchPagePicker")
    }

    private var annualDecisionBriefStateColor: Color {
        switch annualDecisionBriefModel.state {
        case AnnualDecisionBriefReadinessState.readyForThreeMinuteReview.rawValue: .green
        case AnnualDecisionBriefReadinessState.researchRequired.rawValue: .orange
        default: .red
        }
    }

    private var annualDecisionBriefDisplayMessage: String {
        guard annualDecisionBriefModel.data != nil else { return annualDecisionBriefModel.message }
        return "研究、证据、Futu 报价与历史量化事实已绑定当前候选版本。"
    }

    private func annualDecisionBriefTargetSummary(_ data: AnnualDecisionBriefData) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Label(data.target.symbol, systemImage: "scope")
                .font(.callout.weight(.semibold))
            Spacer(minLength: 8)
            Text("\(annualDecisionBriefMembershipStateLabel(data.target.membershipState)) · v\(data.target.membershipVersion)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("annualDecisionBriefTargetSummary")
    }

    private func annualDecisionBriefMembershipStateLabel(_ state: CandidateMembershipState) -> String {
        switch state {
        case .tracked: "跟踪中"
        case .paused: "已暂停"
        case .archived: "已归档"
        }
    }

    private func annualDecisionBriefIdentitySummary(_ data: AnnualDecisionBriefData) -> String {
        "\(data.target.symbol) · v\(data.target.membershipVersion) · 事实 \(data.sourceIdentity.generatedAt.prefix(10))"
    }

    private func annualDecisionBriefIdentityAccessibilityLabel(_ data: AnnualDecisionBriefData) -> String {
        let metadata = annualDecisionBriefModel.metadata.map {
            "source=\($0.source); freshness=\($0.freshness); provenance=\($0.provenance); authority=\($0.authority); fixture=\($0.fixture)"
        } ?? "metadata=unavailable"
        return "symbol=\(data.target.symbol); membership=\(data.target.membershipId); version=\(data.target.membershipVersion); state=\(data.target.membershipState.rawValue); context=\(data.sourceIdentity.decisionContextId); hash=\(data.sourceIdentity.decisionContextHash); generated=\(data.sourceIdentity.generatedAt); research=\(data.sourceIdentity.researchAsOf ?? "unavailable"); evidence=\(data.sourceIdentity.evidenceAsOf ?? "unavailable"); quote=\(data.sourceIdentity.quoteSnapshotId ?? "unavailable"); \(metadata)"
    }

    private func annualDecisionBriefIdentity(_ data: AnnualDecisionBriefData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            InfoBlock(
                title: "候选身份",
                value: "\(data.target.symbol) / membership=\(data.target.membershipId) / version=\(data.target.membershipVersion) / state=\(data.target.membershipState.rawValue)",
                valueIdentifier: "annualDecisionBriefTargetIdentity"
            )
            InfoBlock(
                title: "决策上下文",
                value: "\(data.sourceIdentity.decisionContextId) / \(data.sourceIdentity.decisionContextHash)",
                valueIdentifier: "annualDecisionBriefContextIdentity"
            )
            InfoBlock(
                title: "事实时间",
                value: "generated=\(data.sourceIdentity.generatedAt); research=\(data.sourceIdentity.researchAsOf ?? "unavailable"); evidence=\(data.sourceIdentity.evidenceAsOf ?? "unavailable")",
                valueIdentifier: "annualDecisionBriefSourceTimes"
            )
            InfoBlock(
                title: "Futu 报价快照",
                value: data.sourceIdentity.quoteSnapshotId ?? "unavailable",
                valueIdentifier: "annualDecisionBriefQuoteSnapshot"
            )
            if let metadata = annualDecisionBriefModel.metadata {
                InfoBlock(
                    title: "来源与新鲜度",
                    value: "\(metadata.source) / \(metadata.freshness) / \(metadata.provenance) / \(metadata.authority) / fixture=\(metadata.fixture)",
                    valueIdentifier: "annualDecisionBriefMetadata"
                )
            }
        }
    }

    private func annualDecisionBriefThesis(_ data: AnnualDecisionBriefData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            InfoBlock(title: "为何现在", value: data.whyNow ?? "未记录", valueIdentifier: "annualDecisionBriefWhyNow")
            InfoBlock(title: "投资论点", value: data.thesis ?? "未记录", valueIdentifier: "annualDecisionBriefThesis")
            InfoBlock(title: "市场分歧", value: data.marketDisagreement ?? "未记录", valueIdentifier: "annualDecisionBriefDisagreement")
            InfoBlock(title: "失效条件", value: data.invalidationCondition ?? "未记录", valueIdentifier: "annualDecisionBriefInvalidation")
            InfoBlock(title: "下次复核", value: data.nextReviewOn ?? "未记录", valueIdentifier: "annualDecisionBriefNextReview")
        }
    }

    @ViewBuilder
    private func annualDecisionBriefVariables(_ variables: [AnnualDecisionBriefVariable]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("关键变量")
                .font(.caption.weight(.semibold))
            if variables.isEmpty {
                Text("尚未记录关键变量。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(variables) { variable in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(variable.name).font(.callout.weight(.semibold))
                        Text("支持 \(variable.supportCount) · 反方 \(variable.counterCount) · 中性 \(variable.neutralCount) · 可靠性 \(variable.highestReliability.map(String.init) ?? "-") · 重要性 \(variable.highestMateriality.map(String.init) ?? "-")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("annualDecisionBriefVariable-\(variable.name)")
                    Divider()
                }
            }
        }
    }

    @ViewBuilder
    private func annualDecisionBriefEvidenceGroup(title: String, items: [EvidenceItemData]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.weight(.semibold))
            if items.isEmpty {
                Text("无")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.summary)
                            .font(.callout)
                        Text("\(item.sourceType) · \(item.factKind.rawValue) · \(item.stance.rawValue) · \(item.variableName ?? "未绑定变量")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("captured \(item.capturedAt) · reliability \(item.reliability.map(String.init) ?? "-") · materiality \(item.materiality.map(String.init) ?? "-")")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("annualDecisionBriefEvidence-\(item.id)")
                    Divider()
                }
            }
        }
    }

    @ViewBuilder
    private func annualDecisionBriefConflicts(_ conflicts: [AnnualDecisionBriefConflict]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("证据冲突").font(.caption.weight(.semibold))
            if conflicts.isEmpty {
                Text("无已识别的同变量支持/反方冲突。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(conflicts) { conflict in
                    Text("• \(conflict.variableName)：支持 \(conflict.supportingEvidenceIds.joined(separator: ", "))；反方 \(conflict.counterEvidenceIds.joined(separator: ", "))")
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("annualDecisionBriefConflict-\(conflict.variableName)")
                }
            }
        }
    }

    func annualDecisionBriefQuant(_ quant: DecisionQuantEvidence) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("历史量化证据").font(.caption.weight(.semibold))
            InfoBlock(title: "状态", value: quantEvidenceStatusText(quant), valueIdentifier: "annualDecisionBriefQuantStatus")
            InfoBlock(
                title: "来源与新鲜度",
                value: "\(quant.metadata.source) / \(quant.metadata.freshness) / \(quant.metadata.provenance) / \(quant.metadata.authority) / fixture=\(quant.metadata.fixture)",
                valueIdentifier: "annualDecisionBriefQuantMetadata"
            )
            InfoBlock(
                title: "事实时间",
                value: "asOf=\(quant.metadata.asOf ?? "unavailable"); fetchedAt=\(quant.metadata.fetchedAt ?? "unavailable")",
                valueIdentifier: "annualDecisionBriefQuantTimes"
            )
            InfoBlock(title: "样本边界", value: "\(quant.sampleBoundary.sourceClassification) / \(quant.sampleBoundary.finalTestPolicy) / \(quant.sampleBoundary.universe.joined(separator: ", "))", valueIdentifier: "annualDecisionBriefQuantBoundary")
            InfoBlock(title: "冻结身份", value: quantEvidenceIdentityText(quant), valueIdentifier: "annualDecisionBriefQuantIdentity")
            InfoBlock(title: "历史模拟摘要", value: quantDecisionEvidenceSummary(quant), valueIdentifier: "annualDecisionBriefQuantSummary")
            InfoBlock(title: "三段样本", value: quantDecisionEvidenceSamples(quant), valueIdentifier: "annualDecisionBriefQuantSamples")
            InfoBlock(title: "执行与费用", value: quantDecisionEvidenceExecution(quant), valueIdentifier: "annualDecisionBriefQuantExecution")
            InfoBlock(title: "稳健性边界", value: quantDecisionEvidenceRobustness(quant), valueIdentifier: "annualDecisionBriefQuantRobustness")
            BulletList(title: "量化限制", items: quant.limitations)
            InfoBlock(
                title: "权威边界",
                value: "researchOnly=\(quant.authority.researchOnly); advisoryOnly=\(quant.authority.advisoryOnly); changesCandidateOrdering=\(quant.authority.changesCandidateOrdering); officialPortfolioFact=\(quant.authority.officialPortfolioFact)",
                valueIdentifier: "annualDecisionBriefQuantAuthority"
            )
        }
    }

    private func annualDecisionBriefProfileEditor() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("投资论点与观察条件")
                .font(.callout.weight(.semibold))
            TextField("为何现在值得研究", text: $annualDecisionBriefProfileDraft.whyNow, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefWhyNowField")
            TextField("投资论点", text: $annualDecisionBriefProfileDraft.thesis, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefThesisField")
            TextField("市场分歧或主要反方", text: $annualDecisionBriefProfileDraft.marketDisagreement, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefDisagreementField")
            TextField("失效条件", text: $annualDecisionBriefProfileDraft.invalidationCondition, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefInvalidationField")
            TextField("下次复核 YYYY-MM-DD", text: $annualDecisionBriefProfileDraft.nextReviewOn)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefNextReviewField")
            TextField("关键变量，每行一项", text: $annualDecisionBriefProfileDraft.keyVariables, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefVariablesField")
            TextField("催化观察，每行一项", text: $annualDecisionBriefProfileDraft.catalysts, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefCatalystsField")
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("明确证据缺口（\(annualDecisionBriefProfileDraft.evidenceGaps.count)/20）")
                        .font(.callout.weight(.semibold))
                    Spacer()
                    Button("新增一项") { annualDecisionBriefProfileDraft.evidenceGaps.append("") }
                        .disabled(annualDecisionBriefProfileDraft.evidenceGaps.count >= 20)
                        .accessibilityIdentifier("annualDecisionBriefGapAdd")
                }
                ForEach(annualDecisionBriefProfileDraft.evidenceGaps.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("第 \(index + 1) 项").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button("移除", role: .destructive) {
                                guard annualDecisionBriefProfileDraft.evidenceGaps.indices.contains(index) else { return }
                                annualDecisionBriefProfileDraft.evidenceGaps.remove(at: index)
                            }
                            .accessibilityIdentifier("annualDecisionBriefGapRemove-\(index)")
                        }
                        TextField("填写这一项待核查内容", text: Binding(
                            get: {
                                annualDecisionBriefProfileDraft.evidenceGaps.indices.contains(index)
                                    ? annualDecisionBriefProfileDraft.evidenceGaps[index] : ""
                            },
                            set: { value in
                                guard annualDecisionBriefProfileDraft.evidenceGaps.indices.contains(index) else { return }
                                annualDecisionBriefProfileDraft.evidenceGaps[index] = value
                            }
                        ), axis: .vertical)
                        .lineLimit(2...6)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(index == 0 ? "annualDecisionBriefGapsField" : "annualDecisionBriefGapsField-\(index)")
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("annualDecisionBriefGapsList")
            ResearchMonitorRulesEditor(keyVariables: annualDecisionBriefProfileDraft.normalizedKeyVariables, rules: $annualDecisionBriefProfileDraft.monitorRules)
        }
        .disabled(!annualDecisionBriefProfileWriteEnabled)
    }
    private func annualDecisionBriefEvidenceEditor() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("记录证据")
                .font(.callout.weight(.semibold))
            TextField("来源类型", text: $annualDecisionBriefEvidenceDraft.sourceType)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefEvidenceSourceTypeField")
            TextField("来源 URL（可选）", text: $annualDecisionBriefEvidenceDraft.sourceURL)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .accessibilityIdentifier("annualDecisionBriefEvidenceURLField")
            TextField("证据摘要", text: $annualDecisionBriefEvidenceDraft.summary, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefEvidenceSummaryField")
            Picker("事实类型", selection: $annualDecisionBriefEvidenceDraft.factKind) {
                Text("事实").tag(FactKind.fact)
                Text("推断").tag(FactKind.inference)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("annualDecisionBriefEvidenceFactKindPicker")
            Picker("证据立场", selection: $annualDecisionBriefEvidenceDraft.stance) {
                Text("支持").tag(EvidenceStance.support)
                Text("反方").tag(EvidenceStance.refute)
                Text("中性").tag(EvidenceStance.neutral)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("annualDecisionBriefEvidenceStancePicker")
            TextField("绑定关键变量（可选）", text: $annualDecisionBriefEvidenceDraft.variableName)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("annualDecisionBriefEvidenceVariableField")
            Stepper("可靠性 \(annualDecisionBriefEvidenceDraft.reliability)", value: $annualDecisionBriefEvidenceDraft.reliability, in: 1...5)
                .accessibilityIdentifier("annualDecisionBriefEvidenceReliabilityStepper")
            Stepper("重要性 \(annualDecisionBriefEvidenceDraft.materiality)", value: $annualDecisionBriefEvidenceDraft.materiality, in: 1...5)
                .accessibilityIdentifier("annualDecisionBriefEvidenceMaterialityStepper")
            Toggle("已阅读来源", isOn: $annualDecisionBriefEvidenceDraft.isRead)
                .accessibilityIdentifier("annualDecisionBriefEvidenceReadToggle")
        }
        .disabled(!annualDecisionBriefEvidenceWriteEnabled)
    }

    @ViewBuilder
    func annualDecisionBriefResearchToolbarButton() -> some View {
        switch selectedResearchEditorPage {
        case .profile:
            Button {
                Task { await submitAnnualDecisionBriefProfile() }
            } label: {
                Image(systemName: isWritingAnnualDecisionBriefResearch ? "hourglass" : "tray.and.arrow.down")
            }
            .disabled(!annualDecisionBriefProfileWriteEnabled)
            .accessibilityLabel(isWritingAnnualDecisionBriefResearch ? "保存中" : "确认并保存论点与监控规则")
            .accessibilityIdentifier("annualDecisionBriefProfileSaveButton")
        case .evidence:
            Button {
                Task { await submitAnnualDecisionBriefEvidence() }
            } label: {
                Image(systemName: isWritingAnnualDecisionBriefResearch ? "hourglass" : "doc.badge.plus")
            }
            .disabled(!annualDecisionBriefEvidenceWriteEnabled)
            .accessibilityLabel(isWritingAnnualDecisionBriefResearch ? "记录中" : "记录证据")
            .accessibilityIdentifier("annualDecisionBriefEvidenceSaveButton")
        }
    }

    private var annualDecisionBriefProfileWriteEnabled: Bool {
        guard !isWritingAnnualDecisionBriefResearch,
              let selectedMembership,
              let parsedSymbol else {
            return false
        }
        if clientDestination == .manualResearch,
           (manualHandoffSession.verifiedHandoffId == nil
            || manualHandoffSession.verifiedHandoffId != ownerStore.personalFormalHandoff?.id) { return false }
        return selectedMembership.state != .archived
            && selectedMembership.symbol == parsedSymbol.canonical
            && annualDecisionBriefProfileDraftSource?.allowsProfileWrite(
                membershipId: selectedMembership.id,
                membershipVersion: selectedMembership.version,
                symbol: selectedMembership.symbol
            ) == true
    }

    private var annualDecisionBriefEvidenceWriteEnabled: Bool {
        guard annualDecisionBriefProfileWriteEnabled,
              let selectedMembership else {
            return false
        }
        return annualDecisionBriefProfileDraftSource?.allowsEvidenceWrite(
            membershipId: selectedMembership.id,
            membershipVersion: selectedMembership.version,
            symbol: selectedMembership.symbol
        ) == true
    }

    private var annualDecisionBriefProfileDraftSourceMessage: String {
        switch annualDecisionBriefProfileDraftSource?.state {
        case .existing:
            "已绑定当前候选和版本的现有研究档案。"
        case .missing:
            "已确认当前候选尚无研究档案；先保存首份研究论点后才能记录证据。"
        case nil:
            "当前研究档案尚未完成候选和版本绑定；写入已禁用。"
        }
    }
}
