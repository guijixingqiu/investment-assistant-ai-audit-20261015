import Foundation
import SwiftUI

extension GateBResearchScreen {
    var portfolioResearchLoadIdentity: String {
        let members = candidateMemberships.memberships
            .filter { $0.state == .tracked }
            .map { "\($0.id):\($0.version):\($0.symbol)" }
            .joined(separator: "|")
        let selectedReport = researchInvestmentBriefReport.map { "\($0.id):\($0.version)" } ?? "no-report"
        return [
            selectedTab.rawValue,
            viewModel.authorizationRevision.uuidString,
            candidateMemberships.status.rawValue,
            candidateMemberships.generatedAt,
            members,
            selectedReport
        ].joined(separator: "::")
    }

    var trackedPortfolioMemberships: [CandidateMembershipData] {
        guard candidateMemberships.status == .available else { return [] }
        return candidateMemberships.memberships.filter { $0.state == .tracked }
    }

    @ViewBuilder
    func researchPortfolioWorkspace(layout: DailyWorkbenchLayoutMetrics) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("组合研究")
                    .font(.headline)
                Spacer()
                if isLoadingPortfolioResearch { ProgressView() }
                Text("\(trackedPortfolioMemberships.count) 只已加入跟踪")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text(portfolioResearchScopeSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchPortfolioScopeSummary")
            Text(portfolioResearchDisplayMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchPortfolioLoadMessage")
            Button {
                selectedTab = .assets
            } label: {
                Label("查看资产影响", systemImage: "chart.pie")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchPortfolioOpenAssets")

            ForEach(trackedPortfolioMemberships) { membership in
                researchPortfolioDossier(membership)
            }

            DisclosureGroup("组合研究数据说明") {
                Text("每只股票先显示当前真实完成周线；正式报告、估值和公司材料仍需分别核对，不会自动确认判断或修改资产。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
        }
        .cardStyle(padding: layout.cardPadding)
        .accessibilityIdentifier("researchPortfolioWorkspace")
    }

    private var portfolioResearchScopeSummary: String {
        guard candidateMemberships.status != .unavailable else {
            return "UNKNOWN：真实研究清单当前不可用。"
        }
        return "\(trackedPortfolioMemberships.count) 只已加入跟踪；数量不代表研究充分，也不必为凑数量新增股票，研究是否充分需逐股核对报告。"
    }

    private var portfolioResearchDisplayMessage: String {
        switch candidateMemberships.status {
        case .unavailable:
            return "UNKNOWN：研究清单不可用，旧组合判断已隐藏。"
        case .empty:
            return "真实研究清单当前为空；请在依据与记录中明确加入股票。"
        case .available:
            guard portfolioResearchLoadedIdentity == portfolioResearchLoadIdentity else {
                return "正在按当前研究清单读取每只股票的判断。"
            }
            return portfolioResearchMessage
        }
    }

    @ViewBuilder
    private func researchPortfolioDossier(_ membership: CandidateMembershipData) -> some View {
        let workspace = portfolioWorkspace(for: membership)
        let report = portfolioDossierReport(membership: membership, workspace: workspace)
        let technical: WeinsteinTechnicalAnalysisEnvelope? = {
            guard let value = portfolioResearchWeinstein[membership.id],
                  value.status == "available",
                  value.symbol == membership.symbol,
                  value.analysisAsOf == currentHongKongRequestDate() else { return nil }
            return value
        }()
        let currentReport = report.flatMap { portfolioDossierIsCurrent($0, workspace: workspace) ? $0 : nil }
        let advice = currentReport?.payload.adviceLayer
        let research = currentReport?.payload.researchLayer
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(membership.research.name ?? portfolioResearchCompanyNames[membership.id] ?? "公司名待补齐")
                        .font(.callout.weight(.semibold))
                    Text(membership.symbol)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(portfolioDossierFreshness(workspace: workspace, report: report, technical: technical))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(portfolioDossierFreshnessColor(workspace: workspace, report: report, technical: technical))
            }
            if let technical {
                InfoBlock(
                    title: "当前判断",
                    value: "\(researchTechnicalJudgment(technical))\n分析日 \(technical.analysisAsOf) · 完成周 \(technical.completedWeekEnd ?? technical.analysisAsOf)"
                )
                InfoBlock(
                    title: "核心驱动",
                    value: researchTechnicalDrivers(technical).joined(separator: "\n")
                )
                InfoBlock(
                    title: "价格条件",
                    value: researchTechnicalPriceCondition(technical)
                )
                InfoBlock(
                    title: "最大风险与推翻条件",
                    value: researchTechnicalRisk(technical)
                )
            } else if let advice, let research, let currentReport {
                InfoBlock(
                    title: "当前判断",
                    value: "\(advice.conclusion)\n适用至 \(advice.applicableUntil.prefix(10)) · \(advice.horizonStatement)"
                )
                InfoBlock(
                    title: "核心驱动",
                    value: researchBriefDrivers(report: currentReport, research: research).joined(separator: "\n")
                )
                InfoBlock(
                    title: "价格条件",
                    value: researchBriefPrice(advice, includeCurrentScenarioRange: false)
                )
                InfoBlock(
                    title: "最大风险与推翻条件",
                    value: portfolioDossierRisk(report: currentReport, advice: advice, research: research)
                )
            } else {
                InfoBlock(
                    title: "当前判断",
                    value: "当前周线或正式报告正在读取；恢复来源后会在这里给出判断。"
                )
                InfoBlock(
                    title: "下一步",
                    value: "重新读取这只股票的市场与研究来源。"
                )
            }
            InfoBlock(
                title: "相对上一版",
                value: technical != nil
                    ? "最近事实：已读取当前完成周线；公司基本面报告仍需独立核对。"
                    : report.flatMap { portfolioDossierChange(report: $0, workspace: workspace) }
                        ?? "最近事实暂未读取；恢复来源后再比较变化。"
            )
            InfoBlock(
                title: "下一步",
                value: technical != nil
                    ? "核对一条最新公司来源，确认它支持还是削弱这项周线判断。"
                    : portfolioDossierNextAction(workspace: workspace, report: currentReport)
            )
            Button {
                selectMembershipForAction(membership, layer: .evidence)
                isResearchEvidenceRecordsExpanded = false
            } label: {
                Label("打开完整判断与来源", systemImage: "doc.text.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchPortfolioOpen-\(membership.symbol)")
        }
        .ownerSubtleSurface()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchPortfolioDossier-\(membership.symbol)")
    }

    private func portfolioWorkspace(for membership: CandidateMembershipData) -> FrozenResearchEvidenceWorkspace? {
        guard portfolioResearchLoadedIdentity == portfolioResearchLoadIdentity,
              let workspace = portfolioResearchWorkspaces[membership.id],
              workspace.data?.target.membershipId == membership.id,
              workspace.data?.target.membershipVersion == membership.version,
              workspace.data?.target.symbol == membership.symbol else { return nil }
        return workspace
    }

    private func portfolioDossierReport(
        membership: CandidateMembershipData,
        workspace: FrozenResearchEvidenceWorkspace?
    ) -> TwoLayerReportData? {
        guard let data = workspace?.data else { return nil }
        if let latest = data.latestReport,
           latest.payload.adviceLayer != nil,
           latest.payload.researchLayer != nil { return latest }
        return data.reports
            .filter {
                $0.payload.adviceLayer != nil
                    && $0.payload.researchLayer != nil
                    && $0.payload.evidencePackBinding?.membershipId == membership.id
                    && $0.payload.evidencePackBinding?.membershipVersion == membership.version
                    && $0.payload.evidencePackBinding?.symbol == membership.symbol
            }
            .max { $0.version < $1.version }
    }

    private func portfolioDossierRisk(
        report: TwoLayerReportData?,
        advice: TwoLayerAdvice?,
        research: TwoLayerResearch?
    ) -> String {
        guard let report, let advice, let research else {
            return "风险：UNKNOWN\n反证：UNKNOWN\n推翻条件：UNKNOWN"
        }
        return "风险：\(researchBriefRisk(advice: advice, research: research))\n反证：\(researchBriefCounterevidence(research))\n推翻条件：\(researchBriefInvalidation(report: report, advice: advice))"
    }

    private func portfolioDossierChange(
        report: TwoLayerReportData?,
        workspace: FrozenResearchEvidenceWorkspace?
    ) -> String? {
        guard let report,
              let reports = workspace?.data?.reports,
              let change = researchBriefRecordedChange(report)
                ?? report
                    .revisionSummary(previous: reports.previousReport(before: report))
                    .ownerBriefChange(nextObservation: report.payload.researchLayer?.nextValidationQuestions.first) else {
            return nil
        }
        let applicableUntil = report.payload.adviceLayer?.applicableUntil
        let expired = applicableUntil.map { value in
            ISO8601DateFormatter().date(from: value).map { $0 <= Date() } ?? false
        } ?? false
        let stale = workspace?.isFreshForCurrentResearch != true
            || !report.isCurrentExact
            || expired
        if stale { return "上次有效版本相对更早版本：\(change) 当前没有待确认的新判断。" }
        let decision = workspace?.data?.decisions.first { $0.reportId == report.id }
        if decision?.decision == "confirmed" { return "\(change) 这版已由你确认。" }
        if decision?.decision == "rejected" { return "\(change) 这版已由你驳回，等待修订。" }
        if report.status == "evidence_insufficient" { return "\(change) 证据仍不足，不能确认正式判断。" }
        return "\(change) 新版本仍需你明确确认，确认前不会成为正式判断。"
    }

    private func portfolioDossierFreshness(
        workspace: FrozenResearchEvidenceWorkspace?,
        report: TwoLayerReportData?,
        technical: WeinsteinTechnicalAnalysisEnvelope?
    ) -> String {
        if technical != nil { return "当前 · 真实周线" }
        guard let workspace, let report else { return isLoadingPortfolioResearch ? "读取中" : "来源暂不可用" }
        guard workspace.isFreshForCurrentResearch else { return "已过时" }
        guard report.isCurrentExact else { return "最近有效" }
        if let applicableUntil = report.payload.adviceLayer?.applicableUntil,
           let date = ISO8601DateFormatter().date(from: applicableUntil),
           date <= Date() { return "已过时" }
        let confirmed = workspace.data?.userDecision?.reportId == report.id
            && workspace.data?.userDecision?.decision == "confirmed"
        if !report.isFormalizable { return "当前 · 待补证据" }
        return confirmed ? "当前 · 已确认" : "当前 · 待确认"
    }

    private func portfolioDossierFreshnessColor(
        workspace: FrozenResearchEvidenceWorkspace?,
        report: TwoLayerReportData?,
        technical: WeinsteinTechnicalAnalysisEnvelope?
    ) -> Color {
        portfolioDossierFreshness(workspace: workspace, report: report, technical: technical).hasPrefix("当前")
            ? OwnerExperienceStyle.success
            : OwnerExperienceStyle.warning
    }

    private func portfolioDossierIsCurrent(
        _ report: TwoLayerReportData,
        workspace: FrozenResearchEvidenceWorkspace?
    ) -> Bool {
        guard workspace?.isFreshForCurrentResearch == true, report.isCurrentExact else { return false }
        guard let applicableUntil = report.payload.adviceLayer?.applicableUntil,
              let date = ISO8601DateFormatter().date(from: applicableUntil) else { return true }
        return date > Date()
    }

    private func portfolioDossierNextAction(
        workspace: FrozenResearchEvidenceWorkspace?,
        report: TwoLayerReportData?
    ) -> String {
        guard let workspace, let report else { return "打开这只股票，补齐投资判断。" }
        guard workspace.isFreshForCurrentResearch, report.isCurrentExact else {
            return "打开这只股票，复核新事实后再判断。"
        }
        let confirmed = workspace.data?.userDecision?.reportId == report.id
            && workspace.data?.userDecision?.decision == "confirmed"
        if !report.isFormalizable {
            return report.payload.researchLayer?.nextValidationQuestions.first ?? "打开研究，核对主要缺口。"
        }
        return confirmed ? "打开核对今天是否有实质变化。" : "打开审阅，并由你明确是否确认这版判断。"
    }

    @MainActor
    func loadPortfolioResearchWorkspaces() async {
        let identity = portfolioResearchLoadIdentity
        let requestId = UUID()
        portfolioResearchRequestId = requestId
        portfolioResearchLoadedIdentity = nil
        portfolioResearchWorkspaces = [:]
        portfolioResearchCompanyNames = [:]
        portfolioResearchWeinstein = [:]
        isLoadingPortfolioResearch = true
        guard selectedTab == .research else {
            portfolioResearchMessage = "离开研究页后，组合判断已从当前显示清除。"
            isLoadingPortfolioResearch = false
            return
        }
        guard candidateMemberships.status == .available else {
            portfolioResearchMessage = "UNKNOWN：研究清单不可用。"
            isLoadingPortfolioResearch = false
            return
        }
        let memberships = trackedPortfolioMemberships
        guard !memberships.isEmpty else {
            portfolioResearchMessage = "当前没有持续跟踪的股票。"
            portfolioResearchLoadedIdentity = identity
            isLoadingPortfolioResearch = false
            return
        }
        let authorization = AppEnvironment.researchAuthorizationContext()
        let researchClient = client
        let loaded = await withTaskGroup(
            of: (String, FrozenResearchEvidenceWorkspace?).self,
            returning: [String: FrozenResearchEvidenceWorkspace].self
        ) { group in
            for membership in memberships {
                group.addTask {
                    (membership.id, try? await researchClient.fetchFrozenResearchEvidence(membership: membership))
                }
            }
            var results: [String: FrozenResearchEvidenceWorkspace] = [:]
            for await (membershipId, workspace) in group {
                if let workspace { results[membershipId] = workspace }
            }
            return results
        }
        guard portfolioResearchRequestId == requestId,
              selectedTab == .research,
              portfolioResearchLoadIdentity == identity,
              AppEnvironment.researchAuthorizationContext() == authorization else { return }
        portfolioResearchWorkspaces = loaded
        portfolioResearchLoadedIdentity = identity
        portfolioResearchMessage = "已读取 \(loaded.count)/\(memberships.count) 只；每只股票优先显示当前周线，报告与基本面缺口保留在下一步。"
        isLoadingPortfolioResearch = false

        let marketClient = MarketQuoteClient(
            baseURL: authorization.baseURL,
            authToken: authorization.readToken,
            authHeaderName: authorization.readHeaderName
        )
        let weinsteinClient = WeinsteinTechnicalAnalysisClient(
            baseURL: authorization.baseURL,
            authToken: authorization.readToken,
            authHeaderName: authorization.readHeaderName
        )
        let analysisAsOf = currentHongKongRequestDate()
        await withTaskGroup(of: (String, String?, WeinsteinTechnicalAnalysisEnvelope?).self) { group in
            for membership in memberships {
                group.addTask {
                    let name: String?
                    if membership.research.name == nil {
                        let search = try? await marketClient.searchHongKongStocks(query: membership.symbol)
                        name = search?.results.first(where: { $0.symbol == membership.symbol })?.name
                    } else {
                        name = nil
                    }
                    let technical = try? await weinsteinClient.fetch(
                        market: "HK",
                        code: String(membership.symbol.suffix(5)),
                        analysisAsOf: analysisAsOf
                    )
                    return (membership.id, name, technical)
                }
            }
            for await (membershipId, name, technical) in group {
                guard portfolioResearchRequestId == requestId,
                      selectedTab == .research,
                      portfolioResearchLoadIdentity == identity,
                      AppEnvironment.researchAuthorizationContext() == authorization else { return }
                if let name { portfolioResearchCompanyNames[membershipId] = name }
                if let technical { portfolioResearchWeinstein[membershipId] = technical }
            }
        }
    }
}
