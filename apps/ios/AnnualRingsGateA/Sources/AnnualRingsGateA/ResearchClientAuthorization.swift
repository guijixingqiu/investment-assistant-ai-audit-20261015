import Foundation

extension ResearchClient {
    public func replaceAuthorization(
        authToken: String?,
        authHeaderName: String,
        writeAuthToken: String?,
        writeAuthHeaderName: String
    ) {
        authorizationLock.lock()
        defer { authorizationLock.unlock() }
        self.authToken = authToken
        self.authHeaderName = authHeaderName
        self.writeAuthToken = writeAuthToken
        self.writeAuthHeaderName = writeAuthHeaderName
    }

    func applyAuth(to request: inout URLRequest) {
        let authorization = authorizationSnapshot(write: false)
        guard let token = authorization.token, !token.isEmpty else { return }
        request.setValue(token, forHTTPHeaderField: authorization.headerName)
    }

    func applyWriteAuth(to request: inout URLRequest) {
        let authorization = authorizationSnapshot(write: true)
        guard let token = authorization.token, !token.isEmpty else { return }
        request.setValue(token, forHTTPHeaderField: authorization.headerName)
    }

    private func authorizationSnapshot(write: Bool) -> (token: String?, headerName: String) {
        authorizationLock.lock()
        defer { authorizationLock.unlock() }
        return write
            ? (writeAuthToken, writeAuthHeaderName)
            : (authToken, authHeaderName)
    }
}
