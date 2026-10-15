import Foundation

extension GateBResearchViewModel {
    func refreshRuntimeAuthorizationIfNeeded() -> Bool {
        let next = AppEnvironment.researchAuthorizationContext()
        guard next != runtimeAuthorizationContext else { return false }
        runtimeAuthorizationContext = next
        client = ResearchClient(
            baseURL: next.baseURL,
            authToken: next.readToken,
            authHeaderName: next.readHeaderName,
            writeAuthToken: next.writeToken,
            writeAuthHeaderName: next.writeHeaderName
        )
        valuationQuantClient = AnnualValuationQuantClient(
            baseURL: next.baseURL,
            authToken: next.readToken,
            authHeaderName: next.readHeaderName,
            writeAuthToken: next.writeToken,
            writeAuthHeaderName: next.writeHeaderName
        )
        conditionalDecisionClient = AnnualConditionalDecisionPreviewClient(
            baseURL: next.baseURL,
            authToken: next.readToken,
            authHeaderName: next.readHeaderName
        )
        portfolioLabClient = AnnualPortfolioLabClient(
            baseURL: next.baseURL,
            authToken: next.readToken,
            authHeaderName: next.readHeaderName
        )
        portfolioClient = PortfolioDecisionClient(
            baseURL: next.baseURL,
            authToken: next.readToken,
            authHeaderName: next.readHeaderName
        )
        requestState.invalidateAll()
        authorizationRevision = UUID()
        return true
    }
}
