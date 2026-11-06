import Foundation
import ContentBlockerConverter

/// Preserve the converter's ordered actions when a source exceeds one WebKit list.
/// WebKit exceptions only cancel earlier actions in the same compiled list.
@objc(BrowserNativeRuleConverter)
final class BrowserNativeRuleConverter: NSObject {
    @objc static func convertRuleChunks(_ source: String) -> NSDictionary? {
        autoreleasepool {
            let lines = BrowserAdBlockConverter.preprocessRules(source)
                .split(whereSeparator: \.isNewline).map(String.init)
            let result = ContentBlockerConverter().convertArray(
                rules: lines, safariVersion: .safari15, advancedBlocking: true,
                preserveAllRules: true
            )
            guard result.discardedSafariRules == 0 else { return nil }
            guard result.safariRulesCount > 0 || result.advancedRulesCount > 0 else { return nil }
            let chunks: [String]
            if result.safariRulesCount == 0 {
                chunks = []
            } else if result.safariRulesCount <= 149_999 {
                // Most lists already fit. Do not decode and re-encode their
                // complete JSON merely to produce the identical single list.
                chunks = [result.safariRulesJSON]
            } else {
                guard let data = result.safariRulesJSON.data(using: .utf8),
                      let entries = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
                      let converted = split(entries, limit: 149_999) else { return nil }
                chunks = converted
            }
            return ["chunks": chunks, "rules": result.safariRulesCount,
                    "advanced": result.advancedRulesCount, "discarded": 0,
                    "errors": result.errorsCount]
        }
    }

    private static func split(_ entries: [[String: Any]], limit: Int) -> [String]? {
        let exceptions = entries.indices.filter { index in
            (entries[index]["action"] as? [String: Any])?["type"] as? String == "ignore-previous-rules"
        }
        var cursor = 0, exceptionCursor = 0
        var output = [String]()
        while cursor < entries.count {
            while exceptionCursor < exceptions.count && exceptions[exceptionCursor] < cursor {
                exceptionCursor += 1
            }
            let remainingExceptions = exceptions.count - exceptionCursor
            let remainingActions = entries.count - cursor - remainingExceptions
            // Exceptions without any preceding action have no effect by themselves.
            if remainingActions == 0 { break }
            let capacity = limit - remainingExceptions
            guard capacity > 0 else { return nil }
            let start = cursor
            var actions = 0
            while cursor < entries.count {
                let isException = (entries[cursor]["action"] as? [String: Any])?["type"] as? String == "ignore-previous-rules"
                if !isException {
                    if actions == capacity { break }
                    actions += 1
                }
                cursor += 1
            }
            var chunk = Array(entries[start..<cursor])
            for index in exceptions.dropFirst(exceptionCursor) where index >= cursor {
                chunk.append(entries[index])
            }
            guard chunk.count <= limit,
                  let data = try? JSONSerialization.data(withJSONObject: chunk, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8) else { return nil }
            output.append(json)
        }
        return output
    }
}
