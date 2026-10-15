import SwiftUI

extension GateBResearchScreen {
    var researchOnboardingDailyNextStep: DailyDecisionNextStep? {
        guard selectedMembership != nil, researchInvestmentBriefCurrentReport == nil else { return nil }
        if twoLayerReportWorkspace.pendingSynthesisTask != nil || twoLayerReportWorkspace.draft != nil {
            return DailyDecisionNextStep(
                layer: .evidence,
                title: "继续本次研究",
                detail: "查看待确认的问题或读取同一任务的结果；不重复创建研究任务。",
                expandsResult: false,
                evidenceWorkspace: .brief,
                scrollTarget: twoLayerReportWorkspace.pendingSynthesisTask == nil ? "twoLayerResearchConfirmation" : "absorbDeepResearchButton",
                buttonTitle: "查看本次研究"
            )
        }
        return DailyDecisionNextStep(
            layer: .evidence,
            title: "从一份可追溯资料开始研究",
            detail: "保存公司披露或可信媒体的摘要与链接，再用已有资料分析。估值和完整财务可按研究问题逐步补齐。",
            expandsResult: false,
            evidenceWorkspace: .brief,
            scrollTarget: "researchInvestmentBriefTop",
            buttonTitle: "添加资料或开始研究"
        )
    }
}
