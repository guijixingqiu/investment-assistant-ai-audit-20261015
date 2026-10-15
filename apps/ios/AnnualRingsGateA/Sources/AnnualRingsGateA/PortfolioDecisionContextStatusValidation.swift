import Foundation

extension PortfolioDecisionContextEnvelope {
    public var sourceDisplayName: String {
        portfolioSource == "owner_entered_current" ? "本人录入持仓" : "平安快照"
    }

    func validateDisplayableChronology(errors: inout [String]) {
        guard let assembledDate = portfolioDecisionStrictDate(assembledAt) else { return }
        if let portfolioAsOf,
           let portfolioDate = portfolioDecisionStrictDate(portfolioAsOf),
           portfolioDate > assembledDate {
            errors.append("displayable portfolio context portfolioAsOf must not be after assembledAt")
        }
        if positions.contains(where: {
            $0.quote.fetchedAt.flatMap(portfolioDecisionStrictDate).map { $0 > assembledDate } == true
        }) {
            errors.append("displayable portfolio context quote fetchedAt must not be after assembledAt")
        }
    }

    func validateDisplayableProvenance(errors: inout [String]) {
        guard let sourceAsOf,
              let importedAt,
              let fetchedAt,
              let sourceDate = portfolioDecisionStrictDate(sourceAsOf),
              let importedDate = portfolioDecisionStrictDate(importedAt),
              let fetchedDate = portfolioDecisionStrictDate(fetchedAt),
              let assembledDate = portfolioDecisionStrictDate(assembledAt) else {
            errors.append("displayable portfolio context requires complete Pingan provenance timestamps")
            return
        }
        if sourceDate > fetchedDate || importedDate > assembledDate || fetchedDate > assembledDate {
            errors.append("displayable portfolio context provenance must not be after assembledAt and sourceAsOf must not be after fetchedAt")
        }
        if portfolioSource != "owner_entered_current" && freshness == nil { errors.append("Pingan freshness is required") }
        if let freshness, let evaluatedDate = portfolioDecisionStrictDate(freshness.evaluatedAt), evaluatedDate > assembledDate {
            errors.append("displayable portfolio context freshness evaluatedAt must not be after assembledAt")
        }
    }

    func validateUnrealizedPnl(errors: inout [String]) {
        guard summary.unrealizedPnlFieldPresent else {
            errors.append("summary.unrealizedPnl is required for current Pingan provenance")
            return
        }
        let expected: Double?
        if !positions.isEmpty, positions.allSatisfy({ $0.unrealizedPnl?.isFinite == true }) {
            let total = positions.compactMap(\.unrealizedPnl).reduce(0, +)
            expected = total.isFinite ? portfolioDecisionJSRound(total) : nil
        } else {
            expected = nil
        }
        if summary.unrealizedPnl != expected {
            errors.append("summary.unrealizedPnl must recompute from every position unrealizedPnl")
        }
    }

    func validateDisplayableFacts(errors: inout [String]) {
        let symbols = positions.map(\.symbol)
        let sourceRows = positions.map(\.sourceRowId)
        if Set(symbols).count != symbols.count || Set(sourceRows).count != sourceRows.count {
            errors.append("displayable portfolio context requires unique position symbols and source rows")
        }

        let missingCount = positions.filter { $0.marketValue == nil }.count
        if summary.marketValue.missingPositionCount != missingCount {
            errors.append("summary marketValue missingPositionCount must recompute from position facts")
        }
        for position in positions where position.latestPrice.map({ $0.isFinite && $0 > 0 }) == true {
            if position.marketValue != portfolioDecisionJSRound(position.quantity * position.latestPrice!) {
                errors.append("displayable portfolio market values must recompute from quantities and Futu prices")
            }
        }

        if missingCount > 0 {
            if summary.marketValue.status != .partial || summary.marketValue.amount != nil || summary.marketValue.currency != nil
                || positions.contains(where: { $0.marketWeight != nil })
                || summary.concentration.status != .unavailable
                || summary.concentration.largestPositionWeight != nil
                || summary.concentration.topThreeWeight != nil
                || summary.concentration.hhi != nil {
                errors.append("incomplete displayable portfolio context must not synthesize totals, weights, or concentration")
            }
            return
        }
        if positions.isEmpty { return }
        if status == .partial {
            errors.append("partial portfolio context requires at least one missing position value")
        }
        guard positions.allSatisfy({ $0.latestPrice.map({ $0.isFinite && $0 > 0 }) == true }) else { return }

        let values = positions.map { portfolioDecisionJSRound($0.quantity * $0.latestPrice!) }
        let total = portfolioDecisionJSRound(values.reduce(0, +))
        let weights = values.map { portfolioDecisionJSRound($0 / total, digits: 8) }
        let expectedStatus: PortfolioDecisionMarketValueStatus = status == .available ? .completeCurrent : .completeStale
        if summary.marketValue.status != expectedStatus || summary.marketValue.amount != total
            || summary.marketValue.currency != "HKD"
            || positions.indices.contains(where: { positions[$0].marketValue != values[$0] || positions[$0].marketWeight != weights[$0] }) {
            errors.append("displayable portfolio values and weights must recompute from exact position facts")
        }
        let sorted = weights.sorted(by: >)
        if summary.concentration.status != .available
            || summary.concentration.largestPositionWeight != portfolioDecisionJSRound(sorted.first ?? 0, digits: 8)
            || summary.concentration.topThreeWeight != portfolioDecisionJSRound(sorted.prefix(3).reduce(0, +), digits: 8)
            || summary.concentration.hhi != portfolioDecisionJSRound(sorted.reduce(0) { $0 + $1 * $1 }, digits: 8) {
            errors.append("displayable portfolio concentration must recompute from exact position weights")
        }
    }

    func validateAvailableFacts(errors: inout [String]) {
        if positions.contains(where: { $0.quote.status != .current }) {
            errors.append("available portfolio context requires current quotes for every position")
        }
        if summary.marketValue.status != .completeCurrent
            || summary.marketValue.amount.map({ !$0.isFinite || $0 <= 0 }) != false
            || summary.marketValue.currency != "HKD"
            || summary.marketValue.missingPositionCount != 0 {
            errors.append("available portfolio context requires complete current HKD market value")
        }
        if positions.contains(where: {
            $0.currency != "HKD"
                || !isPortfolioDecisionFiniteNonNegative($0.marketValue)
                || !isPortfolioDecisionUnitInterval($0.marketWeight)
        }) {
            errors.append("available portfolio context requires complete HKD position values and weights")
        }
        if summary.concentration.status != .available
            || !isPortfolioDecisionUnitInterval(summary.concentration.largestPositionWeight)
            || !isPortfolioDecisionUnitInterval(summary.concentration.topThreeWeight)
            || !isPortfolioDecisionUnitInterval(summary.concentration.hhi) {
            errors.append("available portfolio context requires complete concentration metrics")
        }
    }

    func validateZeroPositionFacts(errors: inout [String]) {
        let expectedMarketValueStatus: PortfolioDecisionMarketValueStatus = status == .zeroPosition
            ? .completeCurrent
            : .completeStale
        if summary.positionCount != 0
            || summary.marketValue.status != expectedMarketValueStatus
            || summary.marketValue.amount != 0
            || summary.marketValue.currency != "HKD"
            || summary.marketValue.missingPositionCount != 0 {
            errors.append("zero-position portfolio context requires an exact complete zero HKD market value summary")
        }
        if summary.concentration.status != .unavailable
            || summary.concentration.largestPositionWeight != nil
            || summary.concentration.topThreeWeight != nil
            || summary.concentration.hhi != nil {
            errors.append("zero-position portfolio context must keep concentration unavailable")
        }
    }

    func validateFailClosedSummary(errors: inout [String]) {
        if summary.marketValue.status != .unavailable
            || summary.marketValue.amount != nil
            || summary.marketValue.currency != nil
            || summary.marketValue.missingPositionCount != 0 {
            errors.append("fail-closed portfolio context must keep market value unavailable")
        }
        if summary.concentration.status != .unavailable
            || summary.concentration.largestPositionWeight != nil
            || summary.concentration.topThreeWeight != nil
            || summary.concentration.hhi != nil {
            errors.append("fail-closed portfolio context must keep concentration unavailable")
        }
        if summary.unrealizedPnl != nil {
            errors.append("fail-closed portfolio context must keep unrealized P&L unknown")
        }
    }
}
