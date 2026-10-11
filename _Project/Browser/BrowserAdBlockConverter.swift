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
            var script = runtime.replacingOccurrences(of: "__BROWSER_RECORDS__", with: "JSON.parse(\(json([json(selected)]))[0])")
            script = script.replacingOccurrences(of: "__BROWSER_FUNCTIONS__", with: declarations.joined(separator: "\n"))
            script = script.replacingOccurrences(of: "__BROWSER_FUNCTION_MAP__", with: "[\(functions.joined(separator: ","))]")
            script = script.replacingOccurrences(of: "__BROWSER_COSMETICS__", with: world == "ISOLATED" ? cosmetics.replacingOccurrences(of: "__BROWSER_PROCEDURAL__", with: procedural) : "")
            scripts[world] = script
        }
        return ["scripts": scripts, "stats": compiled["stats"] ?? [:], "rejected": compiled["rejected"] ?? [:]]
    }
}

// Full upstream network engines have their own context and serial worker. No page
// contains this bundle, and a request decision never waits on the main thread.
@objc(BrowserNetworkFilterEngine)
final class BrowserNetworkFilterEngine: NSObject {
    private static let worker = DispatchQueue(label: "browser.ublock.network", qos: .userInitiated)
    private static var context: JSContext?
    private static var installedIdentity = ""
    private static var installedSummary: NSDictionary = [:]
    private static var timerID = 0
    private static var timers = [Int: JSValue]()
    private static var ready = false // Accessed only on main queue.

    private static func createContext() -> JSContext? {
        guard let context = JSContext(),
              let url = Bundle.main.url(forResource: "UBlockNetwork", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let normalize: @convention(block) (String) -> String = { host in
            guard !host.contains("/"), !host.contains("@"), !host.contains(":") else { return "" }
            return URL(string: "https://\(host)/")?.host?.lowercased() ?? ""
        }
        let decode: @convention(block) ([NSNumber]) -> String = { bytes in
            String(decoding: bytes.map { UInt8(truncating: $0) }, as: UTF8.self)
        }
        let schedule: @convention(block) (JSValue, Double) -> Int = { callback, milliseconds in
            timerID += 1
            let id = timerID
            timers[id] = callback
            worker.asyncAfter(deadline: .now() + max(0.001, milliseconds / 1000)) {
                guard let callback = timers.removeValue(forKey: id) else { return }
                callback.call(withArguments: [])
            }
            return id
        }
        let cancel: @convention(block) (Int) -> Void = { timers.removeValue(forKey: $0) }
        context.setObject(normalize, forKeyedSubscript: "browserNormalizeHostname" as NSString)
        context.setObject(decode, forKeyedSubscript: "browserDecodeBytes" as NSString)
        context.setObject(schedule, forKeyedSubscript: "setTimeout" as NSString)
        context.setObject(cancel, forKeyedSubscript: "clearTimeout" as NSString)
        context.evaluateScript("""
        globalThis.performance={now:()=>Date.now()};
        globalThis.TextDecoder=class {decode(bytes){return browserDecodeBytes(Array.from(bytes||[]));}};
        // The parser needs hostname normalization only. URL-transform/redirect
        // delivery requires a separate host adapter and is not enabled here.
        globalThis.URL=class {constructor(){this._hostname='';}get hostname(){return this._hostname;}set hostname(value){this._hostname=browserNormalizeHostname(value);}};
        """)
        context.evaluateScript(source)
        if let exception = context.exception {
            #if DEBUG
            NSLog("[AdBlock] network bootstrap error: %@", exception.toString() ?? "unknown")
            #endif
            return nil
        }
        return context
    }

    @objc(prepareLists:identity:completion:)
    static func prepare(lists: NSArray, identity: String, completion: @escaping (NSDictionary) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        ready = false
        worker.async {
            if installedIdentity == identity, context != nil {
                DispatchQueue.main.async { ready = true; completion(installedSummary) }
                return
            }
            if context == nil { context = createContext() }
            guard let context = context,
                  let suffixURL = Bundle.main.url(forResource: "PublicSuffixList", withExtension: "dat"),
                  let suffixes = try? String(contentsOf: suffixURL, encoding: .utf8) else {
                DispatchQueue.main.async { completion(["available": false, "error": 1]) }
                return
            }
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
                .appendingPathComponent("BrowserNetworkRules", isDirectory: true)
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let cacheURL = directory.appendingPathComponent("network-v2-\(identity).json")
            let cache = (try? Data(contentsOf: cacheURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            context.exception = nil
            var result = context.objectForKeyedSubscript("browserCompileNetwork")?.call(withArguments: [lists, cache?["compiled"] as? String ?? "", suffixes])
            if context.exception != nil, cache != nil {
                context.exception = nil
                result = context.objectForKeyedSubscript("browserCompileNetwork")?.call(withArguments: [lists, "", suffixes])
            }
            guard context.exception == nil, var compiled = result?.toDictionary() as? [String: Any],
                  let text = compiled.removeValue(forKey: "compiled") as? String else {
                installedIdentity = ""
                DispatchQueue.main.async { completion(["available": false, "error": 2]) }
                return
            }
            if compiled["cached"] as? Bool == true { compiled["stats"] = cache?["stats"] ?? [:] }
            let persistent: [String: Any] = ["compiled": text, "stats": compiled["stats"] ?? [:]]
            if let data = try? JSONSerialization.data(withJSONObject: persistent) { try? data.write(to: cacheURL, options: .atomic) }
            compiled["available"] = true
            installedIdentity = identity
            installedSummary = compiled as NSDictionary
            DispatchQueue.main.async { ready = true; completion(installedSummary) }
        }
    }

    @objc(matchRequest:hostRules:urlRules:completion:)
    static func match(request: NSDictionary, hostRules: String, urlRules: String, completion: @escaping (NSDictionary) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard ready else { completion(["action": 0, "engine": "preparing"]); return }
        worker.async {
            guard let context = context else { DispatchQueue.main.async { completion(["action": 0, "engine": "unavailable"]) }; return }
            context.exception = nil
            context.objectForKeyedSubscript("browserSetDynamicNetwork")?.call(withArguments: [hostRules, urlRules])
            let decision = context.objectForKeyedSubscript("browserMatchNetwork")?.call(withArguments: [request])?.toDictionary() as? [String: Any]
            let valid = context.exception == nil
            DispatchQueue.main.async { completion(valid ? (decision ?? [:]) as NSDictionary : ["action": 0, "engine": "error"]) }
        }
    }
}
