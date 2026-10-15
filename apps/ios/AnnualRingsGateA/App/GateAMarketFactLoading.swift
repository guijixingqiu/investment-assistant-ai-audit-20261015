import SwiftUI

extension GateAMarketScreen {
    @MainActor
    @discardableResult
    func loadQuote() async -> Bool {
        guard let symbol = parsedSymbol else {
            envelope = .unavailable("输入无效，未发送行情请求。")
            quoteFactsAreHistorical = false
            dailyEnvelope = nil
            dailyFactsAreHistorical = false
            return false
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        authorizationContext = context
        quoteRequestId = requestId
        isLoading = true
        let retainPrevious = envelope.requestedSymbol == symbol.canonical && envelope.data?.symbol == symbol.canonical
        quoteFactsAreHistorical = retainPrevious
        if !retainPrevious { envelope = .unavailable("正在重新读取当前行情。", requestedSymbol: symbol.canonical) }
        defer {
            if quoteRequestId == requestId { isLoading = false }
        }
        let client = MarketQuoteClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        )
        do {
            let fetched = try await client.fetchQuote(market: symbol.market, code: symbol.code)
            guard quoteRequestId == requestId,
                  authorizationContext == context,
                  parsedSymbol?.canonical == symbol.canonical else { return false }
            guard fetched.isUsableQuote else {
                if !retainPrevious { envelope = fetched }
                quoteFactsAreHistorical = retainPrevious
                return false
            }
            envelope = fetched
            quoteFactsAreHistorical = false
            return true
        } catch {
            guard quoteRequestId == requestId,
                  authorizationContext == context,
                  parsedSymbol?.canonical == symbol.canonical else { return false }
            if !retainPrevious {
                envelope = .unavailable("行情服务暂时不可用：\(error.localizedDescription)", requestedSymbol: symbol.canonical)
            }
            quoteFactsAreHistorical = retainPrevious
            return false
        }
    }

    @MainActor
    @discardableResult
    func loadDailyTechnical() async -> Bool {
        resetWeinsteinAnalysis()
        guard let symbol = parsedSymbol else {
            dailyEnvelope = nil
            return false
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        dailyTechnicalRequestId = requestId
        let retainPrevious = dailyEnvelope?.isBound(to: symbol.canonical) == true && dailyEnvelope?.dailyBars.snapshot != nil
        dailyFactsAreHistorical = retainPrevious
        if !retainPrevious {
            dailyEnvelope = .unavailable("正在读取已存储的完成交易日日线。", market: symbol.market, code: symbol.code, cutoff: currentHongKongRequestDate())
        }
        let client = MarketDailyTechnicalClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        )
        do {
            let fetched = try await client.fetch(market: symbol.market, code: symbol.code)
            guard authorizationContext == context,
                  parsedSymbol?.canonical == symbol.canonical,
                  dailyTechnicalRequestId == requestId else { return false }
            guard fetched.usableForRequestedCutoff else {
                if !retainPrevious { dailyEnvelope = fetched }
                dailyFactsAreHistorical = retainPrevious
                return false
            }
            dailyEnvelope = fetched
            dailyFactsAreHistorical = false
            return true
        } catch {
            guard authorizationContext == context,
                  parsedSymbol?.canonical == symbol.canonical,
                  dailyTechnicalRequestId == requestId else { return false }
            if !retainPrevious {
                dailyEnvelope = .unavailable(
                    "日线数据暂时不可用或校验失败：\(error.localizedDescription)",
                    market: symbol.market,
                    code: symbol.code,
                    cutoff: currentHongKongRequestDate()
                )
            }
            dailyFactsAreHistorical = retainPrevious
            return false
        }
    }
}
