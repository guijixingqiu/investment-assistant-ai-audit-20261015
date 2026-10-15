import Foundation

enum AppConnectionStore {
    private struct Connection: Codable {
        let baseURL: String
        let readHeader: String
        let writeHeader: String
    }
    private static let connectionKey = "annual-rings.research-connection.v2"
    private static let baseURLKey = "annual-rings.research-base-url"
    private static let readHeaderKey = "annual-rings.research-read-header"
    private static let writeHeaderKey = "annual-rings.research-write-header"

    static func readBaseURL() -> String? {
        readConnection()?.baseURL ?? UserDefaults.standard.string(forKey: baseURLKey)
    }

    static func readLegacyBaseURL() -> String? {
        UserDefaults.standard.string(forKey: baseURLKey)
    }

    static func readHeaderName(write: Bool) -> String? {
        let connection = readConnection()
        return (write ? connection?.writeHeader : connection?.readHeader)
            ?? UserDefaults.standard.string(forKey: write ? writeHeaderKey : readHeaderKey)
    }

    static func save(baseURL: URL, readHeader: String, writeHeader: String) {
        let connection = Connection(
            baseURL: baseURL.absoluteString,
            readHeader: readHeader,
            writeHeader: writeHeader
        )
        UserDefaults.standard.set(try? JSONEncoder().encode(connection), forKey: connectionKey)
    }

    private static func readConnection() -> Connection? {
        UserDefaults.standard.data(forKey: connectionKey)
            .flatMap { try? JSONDecoder().decode(Connection.self, from: $0) }
    }
}
