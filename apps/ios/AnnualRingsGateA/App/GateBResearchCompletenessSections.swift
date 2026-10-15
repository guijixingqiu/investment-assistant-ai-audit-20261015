import SwiftUI

extension GateBResearchScreen {
    @MainActor
    func loadResearchCompleteness(for membership: CandidateMembershipData) async {
        guard researchContextWorkspace.binding == ResearchContextMembershipBinding(membership) else { return }
        researchContextWorkspace.isLoadingCompleteness = true
        defer { researchContextWorkspace.isLoadingCompleteness = false }
        do {
            let envelope = try await client.fetchResearchCompleteness(membership: membership)
            guard selectedMembership.map(ResearchContextMembershipBinding.init) == ResearchContextMembershipBinding(membership) else { return }
            guard completenessFinancialRequirementMatches(envelope,
                researchFundamentalWorkspace.envelope?.financialCoverage.requirement) else {
                throw ResearchCompletenessClientError.invalidResponse
            }
            researchContextWorkspace.completeness = envelope
            researchContextWorkspace.completenessMessage = envelope.message
        } catch {
            researchContextWorkspace.completeness = nil
            researchContextWorkspace.completenessMessage = completenessFailureMessage(error)
        }
    }

    @MainActor
    func saveResearchCompleteness() async {
        guard !researchContextWorkspace.isBusy,
              let membership = selectedMembership,
              let fundamentals = researchFundamentalWorkspace.envelope,
              let context = researchContextWorkspace.envelope else {
            researchContextWorkspace.completenessMessage = "请先 fresh read 基本面与研究上下文。"
            return
        }
        let fingerprint = [membership.id, String(membership.version), fundamentals.dataCutoffAt ?? "UNKNOWN",
                           fundamentals.financialCoverage.requirement?.id ?? "UNKNOWN",
                           context.data?.id ?? "UNKNOWN", researchContextWorkspace.completeness?.latestSnapshotId ?? "first"].joined(separator: "|")
        let key = researchContextWorkspace.completenessReservation.reserve(for: fingerprint, prefix: "ios-research-completeness")
        researchContextWorkspace.isSavingCompleteness = true
        researchContextWorkspace.completenessMessage = "正在记录当前覆盖与 UNKNOWN 缺口..."
        defer { researchContextWorkspace.isSavingCompleteness = false }
        do {
            let request = try makeResearchCompletenessRequest(
                membership: membership, fundamentals: fundamentals, context: context,
                current: researchContextWorkspace.completeness, idempotencyKey: key
            )
            let fresh = try await client.createResearchCompletenessAndReadBack(membership: membership, requestBody: request)
            guard selectedMembership.map(ResearchContextMembershipBinding.init) == ResearchContextMembershipBinding(membership) else { return }
            guard completenessFinancialRequirementMatches(fresh, fundamentals.financialCoverage.requirement) else {
                throw ResearchCompletenessClientError.invalidResponse
            }
            researchContextWorkspace.completeness = fresh
            researchContextWorkspace.completenessReservation.clear()
            researchContextWorkspace.completenessMessage = fresh.data?.canFormalize == true
                ? "覆盖已 exact readback，核心 5 域齐备且达到 7/9；仍须由 Owner 明确确认报告。"
                : "覆盖已 exact readback；缺口保留 UNKNOWN，确认报告和正式决定保持锁定。"
        } catch {
            researchContextWorkspace.completeness = nil
            researchContextWorkspace.completenessMessage = completenessFailureMessage(error)
        }
    }

    private func completenessFinancialRequirementMatches(
        _ envelope: ResearchCompletenessEnvelope, _ requirement: ResearchFinancialRequirementData?
    ) -> Bool {
        guard let requirement, let financials = envelope.data?.sections.first(where: { $0.section == "financials" }),
              financials.status == "available" else { return true }
        return financials.sourceBindings.contains {
            $0.sourceType == "financial_requirement" && $0.sourceId == requirement.id
                && $0.sourceVersion == requirement.schemaVersion
                && $0.asOf == requirement.asOf && $0.validUntil == requirement.validUntil
        }
    }

    @ViewBuilder
    func researchCompletenessSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("研究覆盖与缺口").font(.headline)
                Spacer()
                if let score = researchContextWorkspace.completeness?.data?.score {
                    Text("\(score.availableSections)/\(score.totalSections)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
            }
            Text("报告正式化门槛：财务、KPI、行业同业、双估值、Weinstein 五个核心域齐备，且总覆盖达到 7/9。内容缺失保留 UNKNOWN，不由 AI 补值。")
                .font(.caption).foregroundStyle(.secondary)
            if let data = researchContextWorkspace.completeness?.data {
                ForEach(data.sections) { section in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("覆盖 \(section.coverage.achieved)/\(section.coverage.required)")
                            ForEach(section.gaps, id: \.self) { Text("• \($0)") }
                            if !section.sourceBindings.isEmpty {
                                Text("来源版本：\(section.sourceBindings.map { "\($0.sourceType):\($0.sourceId)@\($0.sourceVersion)" }.joined(separator: "；"))")
                                    .textSelection(.enabled)
                            }
                        }.font(.caption).foregroundStyle(.secondary).padding(.top, 5)
                    } label: {
                        Label(completenessSectionTitle(section.section), systemImage: section.status == "available" ? "checkmark.circle.fill" : "questionmark.circle")
                            .foregroundStyle(section.status == "available" ? .green : .orange)
                    }
                }
                Text(data.canFormalize ? "可进入 Owner 报告确认；不会自动确认或形成决定。" : "未达到门槛：报告确认与正式决定已锁定。")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(data.canFormalize ? .green : .orange)
                    .accessibilityIdentifier("researchCompletenessFormalizationState")
            } else {
                Text("尚无可用覆盖快照；当前按 UNKNOWN 处理。")
                    .font(.callout).foregroundStyle(.secondary)
            }
            HStack {
                Button {
                    Task { if let membership = selectedMembership { await loadResearchCompleteness(for: membership) } }
                } label: { Label("刷新覆盖", systemImage: "arrow.clockwise") }
                    .buttonStyle(.bordered)
                Button {
                    Task { await saveResearchCompleteness() }
                } label: { Label(researchContextWorkspace.isSavingCompleteness ? "正在记录" : "记录当前覆盖", systemImage: "checkmark.shield") }
                    .buttonStyle(.borderedProminent)
                    .disabled(researchContextWorkspace.isBusy || researchFundamentalWorkspace.envelope == nil || researchContextWorkspace.envelope == nil)
            }
            Text(researchContextWorkspace.completenessMessage)
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("researchCompletenessMessage")
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchCompletenessSection")
    }

    private func completenessSectionTitle(_ id: String) -> String {
        ["financials": "财务", "kpi": "经营 KPI / 价格趋势", "peers": "行业 / 同业 / 宏观",
         "valuation": "估值", "quant": "量化", "weinstein": "Weinstein", "risks": "风险",
         "counterevidence": "反证", "conflicts": "冲突"][id] ?? id
    }

    private func completenessFailureMessage(_ error: Error) -> String {
        if case ResearchCompletenessClientError.httpStatus(let status) = error {
            if [401, 403].contains(status) { return "覆盖快照未获授权；旧成功状态已清除。" }
            if status == 409 { return "覆盖来源已变化；请 fresh read 后重试。" }
            return "覆盖服务不可用（HTTP \(status)）。"
        }
        if case ResearchCompletenessClientError.sourceUnavailable = error { return "财务或上下文来源缺失/过期；无法记录覆盖。" }
        return "覆盖快照无效或暂不可用。"
    }
}
