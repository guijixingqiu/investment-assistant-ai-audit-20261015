import Foundation
import SwiftUI
@MainActor
final class GateBResearchViewModel: ObservableObject {
    @Published var requestState = GateBResearchRequestState()
    @Published var authorizationRevision = UUID()
    @Published var researchEvidenceQuestion = ""
    @Published var researchEvidenceQuestionResponse: ResearchEvidenceQuestionEnvelope?
    @Published var researchEvidenceQuestionConversation: [ResearchEvidenceQuestionConversationTurn] = []
    @Published var researchEvidenceQuestionSessionId = "legacy"
    @Published var researchEvidenceQuestionCarrySummary: String?
    @Published var researchEvidenceQuestionCarryFromSessionId: String?
    @Published var researchEvidenceQuestionHistory: [ResearchTemporaryConversationSnapshot] = []
    @Published var researchEvidenceQuestionHistorySelection: String?
    @Published var researchEvidenceQuestionNewSessionDraft = ""
    @Published var researchEvidenceQuestionNewSessionConfirmed = false
    @Published var researchEvidenceQuestionNewSessionSourceIdentity: String?
    @Published var researchEvidenceQuestionClearMarker: String?
    @Published var researchEvidenceQuestionConversationIdentity: String?
    @Published var researchEvidenceQuestionCorrection = ""
    @Published var researchEvidenceQuestionMessage = "请先重新读取当前报告，再输入要追问的证据主题。"
    @Published var researchEvidenceQuestionRequestId = UUID()
    @Published var isAskingResearchEvidenceQuestion = false
    var client: ResearchClient
    var valuationQuantClient: AnnualValuationQuantFetching
    var conditionalDecisionClient: AnnualConditionalDecisionPreviewFetching
    var portfolioLabClient: AnnualPortfolioLabFetching
    var portfolioClient: PortfolioDecisionFetching
    var marketDailyClient: MarketDailyTechnicalFetching
    let localDefaults: UserDefaults
    let reviewKnowledgeStorage: AssistReviewKnowledgeUserDefaultsStorage
    var runtimeAuthorizationContext: AppResearchAuthorizationContext
    init(
        client: ResearchClient = ResearchClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName(),
            writeAuthToken: AppEnvironment.writeAuthToken(),
            writeAuthHeaderName: AppEnvironment.writeAuthHeaderName()
        ),
        valuationQuantClient: AnnualValuationQuantFetching = AnnualValuationQuantClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName(),
            writeAuthToken: AppEnvironment.writeAuthToken(),
            writeAuthHeaderName: AppEnvironment.writeAuthHeaderName()
        ),
        conditionalDecisionClient: AnnualConditionalDecisionPreviewFetching = AnnualConditionalDecisionPreviewClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName()
        ),
        portfolioLabClient: AnnualPortfolioLabFetching = AnnualPortfolioLabClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName()
        ),
        portfolioClient: PortfolioDecisionFetching = PortfolioDecisionClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName()
        ),
        marketDailyClient: MarketDailyTechnicalFetching = MarketDailyTechnicalClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName()
        ),
        localDefaults: UserDefaults = .standard,
        reviewKnowledgeStorage: AssistReviewKnowledgeUserDefaultsStorage = .init()
    ) {
        runtimeAuthorizationContext = AppEnvironment.researchAuthorizationContext()
        self.client = client
        self.valuationQuantClient = valuationQuantClient
        self.conditionalDecisionClient = conditionalDecisionClient
        self.portfolioLabClient = portfolioLabClient
        self.portfolioClient = portfolioClient
        self.marketDailyClient = marketDailyClient
        self.localDefaults = localDefaults
        self.reviewKnowledgeStorage = reviewKnowledgeStorage
    }
}
extension GateBResearchViewModel {
    func binding<Value>(_ keyPath: ReferenceWritableKeyPath<GateBResearchViewModel, Value>) -> Binding<Value> {
        Binding(
            get: { self[keyPath: keyPath] },
            set: { self[keyPath: keyPath] = $0 }
        )
    }
}
