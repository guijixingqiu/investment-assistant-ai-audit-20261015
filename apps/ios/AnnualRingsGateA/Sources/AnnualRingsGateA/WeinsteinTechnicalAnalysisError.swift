public enum WeinsteinTechnicalAnalysisError: Error, Equatable, Sendable {
    case invalidRequest
    case httpStatus(Int)
    case invalid([String])
}
