extension GateBResearchScreen {
    var confirmedReportDailyNextStep: DailyDecisionNextStep? {
        guard let report = researchInvestmentBriefCurrentReport,
              currentDeepResearchDecision?.decision == "confirmed",
              hasCurrentDecision == false else { return nil }
        return DailyDecisionNextStep(
            layer: .evidence,
            title: "把已确认报告用于正式决定",
            detail: "报告确认只代表你认可研究内容；还需要明确采用并填写人工正式决定，系统不会自动提交或交易。",
            expandsResult: false,
            evidenceWorkspace: .brief,
            scrollTarget: twoLayerReportFormalDecisionAnchor(report.id),
            buttonTitle: "准备正式决定"
        )
    }
}
