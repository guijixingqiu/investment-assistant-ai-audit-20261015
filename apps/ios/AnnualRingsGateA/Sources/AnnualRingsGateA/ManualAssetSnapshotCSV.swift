import CryptoKit
import Foundation

public enum ManualAssetSnapshotCSVError: Error, Equatable, Sendable {
    case invalid(String)
}

public enum ManualAssetSnapshotCSV {
    public static let header = "symbol,quantity,market_value_hkd,as_of"
    private static let maxBytes = 64 * 1_024

    public static func parse(contentsOf url: URL, savedAt: Date = Date()) throws -> ManualAssetSnapshot {
        let fileSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        guard let fileSize, fileSize <= maxBytes else {
            throw ManualAssetSnapshotCSVError.invalid("CSV must be at most 64 KB")
        }
        return try parse(Data(contentsOf: url), savedAt: savedAt)
    }

    public static func parse(_ data: Data, savedAt: Date = Date()) throws -> ManualAssetSnapshot {
        guard !data.isEmpty, data.count <= maxBytes, var text = String(data: data, encoding: .utf8) else {
            throw ManualAssetSnapshotCSVError.invalid("CSV must be non-empty UTF-8 and at most 64 KB")
        }
        if text.first == "\u{feff}" { text.removeFirst() }
        guard !text.contains("\"") else {
            throw ManualAssetSnapshotCSVError.invalid("quoted CSV fields are not supported")
        }

        text = text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var rows = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if rows.last == "" { rows.removeLast() }
        guard rows.count >= 2, rows.count <= 101,
              rows[0] == header,
              !rows.dropFirst().contains(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty }) else {
            throw ManualAssetSnapshotCSVError.invalid("CSV header or row count is invalid")
        }

        var positions: [ManualAssetPosition] = []
        var sharedAsOf: String?
        for (offset, row) in rows.dropFirst().enumerated() {
            let values = fields(row)
            guard values.count == 4,
                  let symbol = SecuritySymbol.parseHongKongAlias(values[0])?.canonical,
                  let quantity = Double(values[1]), quantity.isFinite, quantity > 0 else {
                throw ManualAssetSnapshotCSVError.invalid("CSV row \(offset + 2) is invalid")
            }

            let marketValue: Double?
            if values[2].isEmpty {
                marketValue = nil
            } else if let value = Double(values[2]), value.isFinite, value >= 0 {
                marketValue = value
            } else {
                throw ManualAssetSnapshotCSVError.invalid("CSV row \(offset + 2) market value is invalid")
            }

            guard !values[3].isEmpty, sharedAsOf == nil || sharedAsOf == values[3] else {
                throw ManualAssetSnapshotCSVError.invalid("all CSV rows must use one as_of timestamp")
            }
            sharedAsOf = values[3]
            positions.append(try ManualAssetPosition(symbol: symbol, quantity: quantity, marketValue: marketValue))
        }

        guard let sharedAsOf else {
            throw ManualAssetSnapshotCSVError.invalid("CSV has no positions")
        }
        let sourceHash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return try ManualAssetSnapshot.csv(
            positions: positions,
            asOf: sharedAsOf,
            sourceHash: sourceHash,
            savedAt: savedAt
        )
    }

    private static func fields(_ row: String) -> [String] {
        row.split(separator: ",", omittingEmptySubsequences: false).map {
            $0.trimmingCharacters(in: .whitespaces)
        }
    }
}
