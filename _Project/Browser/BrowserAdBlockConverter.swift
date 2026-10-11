import Foundation
import ContentBlockerConverter

@objc(BrowserAdBlockConverter)
final class BrowserAdBlockConverter: NSObject {
    @objc static func convertRules(_ source: String) -> NSDictionary? {
        let lines = preprocessRules(source).split(whereSeparator: \.isNewline).map(String.init)
        let result = ContentBlockerConverter().convertArray(
            rules: lines,
            safariVersion: .safari15,
            advancedBlocking: true
        )
        guard result.safariRulesCount > 0 || result.advancedRulesCount > 0 else { return nil }
        return [
            "json": result.safariRulesJSON,
            "rules": result.safariRulesCount,
            "advanced": result.advancedRulesCount,
            "advancedText": result.advancedRulesText ?? "",
            "discarded": result.discardedSafariRules,
            "errors": result.errorsCount,
        ]
    }
}

// The parser runs outside the page; only pinned implementations enter WKUserScript.
// JSCore is shared under a lock because conversion can be requested by multiple tabs.
import JavaScriptCore

extension BrowserAdBlockConverter {
    private static let parserLock = NSRecursiveLock()
    private static var parserContext: JSContext?

    private static func resource(_ name: String, _ ext: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private static func context() -> JSContext? {
        if let cached = parserContext { return cached }
        guard let source = resource("UBlockParser", "js"), let context = JSContext() else { return nil }
        let normalize: @convention(block) (String) -> String = { host in
            guard !host.contains("/"), !host.contains("@"), !host.contains(":") else { return "" }
            return URL(string: "https://\(host)/")?.host?.lowercased() ?? ""
        }
        context.setObject(normalize, forKeyedSubscript: "browserNormalizeHostname" as NSString)
        context.evaluateScript(source)
        guard context.exception == nil else { return nil }
        parserContext = context
        return context
    }

    @objc static func preprocessRules(_ source: String) -> String {
        parserLock.lock(); defer { parserLock.unlock() }
        guard let context = context() else { return source }
        context.exception = nil
        return context.objectForKeyedSubscript("browserPreprocessUBlock")?.call(withArguments: [source])?.toString() ?? source
    }

    @objc static func compileUBlockLists(_ lists: NSArray) -> NSDictionary? {
        parserLock.lock(); defer { parserLock.unlock() }
        guard let context = context(),
              let libraryText = resource("UBlockScriptlets", "json"),
              let libraryData = libraryText.data(using: .utf8),
              let library = (try? JSONSerialization.jsonObject(with: libraryData)) as? [[String: Any]],
              let runtime = resource("UBlockRuntime", "js"),
              let cosmetics = resource("UBlockCosmetics", "js"),
              let procedural = resource("UBlockProcedural", "js") else { return nil }
        context.exception = nil
        guard let result = context.objectForKeyedSubscript("browserCompileUBlock")?.call(withArguments: [lists, library]),
              context.exception == nil, let compiled = result.toDictionary(),
              let records = compiled["records"] as? [[String: Any]] else { return nil }
        let byName = Dictionary(uniqueKeysWithValues: library.compactMap { entry -> (String, [String: Any])? in
            guard let name = entry["name"] as? String else { return nil }; return (name, entry)
        })
        func json(_ object: Any) -> String {
            guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
                  let text = String(data: data, encoding: .utf8) else { return "[]" }
            return text
        }
        var scripts = [String: String]()
        for world in ["MAIN", "ISOLATED"] {
            let selected = records.filter { entry in
                if entry["exception"] as? Bool == true { return true }
                return entry["kind"] as? String == "cosmetic" ? world == "ISOLATED" : entry["world"] as? String == world
            }
            var names = Set<String>(), declarations = [String](), functions = [String]()
            func collect(_ name: String) {
                guard !names.contains(name), let entry = byName[name],
                      let functionName = entry["functionName"] as? String,
                      let code = entry["code"] as? String else { return }
                names.insert(name)
                for dependency in entry["dependencies"] as? [String] ?? [] { collect(dependency) }
                // Function declarations remain lexical, independent of dependency ordering.
                declarations.append("const \(functionName)=(\(code));")
            }
            for entry in selected where entry["kind"] as? String == "scriptlet" && entry["exception"] as? Bool != true {
                if let name = entry["name"] as? String { collect(name) }
            }
            for name in names.sorted() where name.hasSuffix(".js") {
                guard let entry = byName[name], let functionName = entry["functionName"] as? String else { continue }
                functions.append("[\(json([name]).dropFirst().dropLast()),\(functionName)]")
            }
            var script = runtime.replacingOccurrences(of: "__BROWSER_RECORDS__", with: json(selected))
            script = script.replacingOccurrences(of: "__BROWSER_FUNCTIONS__", with: declarations.joined(separator: "\n"))
            script = script.replacingOccurrences(of: "__BROWSER_FUNCTION_MAP__", with: "[\(functions.joined(separator: ","))]")
            script = script.replacingOccurrences(of: "__BROWSER_COSMETICS__", with: world == "ISOLATED" ? cosmetics.replacingOccurrences(of: "__BROWSER_PROCEDURAL__", with: procedural) : "")
            scripts[world] = script
        }
        return ["scripts": scripts, "stats": compiled["stats"] ?? [:], "rejected": compiled["rejected"] ?? [:]]
    }
}
