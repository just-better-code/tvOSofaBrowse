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
// Native preprocessing shares a small locked VM; every extended compilation owns
// its own VM so it never serializes behind native conversion.
import JavaScriptCore

extension BrowserAdBlockConverter {
    private static let parserLock = NSRecursiveLock()
    private static var parserContext: JSContext?

    private static func resource(_ name: String, _ ext: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private static func makeContext() -> JSContext? {
        guard let source = resource("UBlockParser", "js"), let context = JSContext() else { return nil }
        let normalize: @convention(block) (String) -> String = { host in
            guard !host.contains("/"), !host.contains("@"), !host.contains(":") else { return "" }
            return autoreleasepool { URL(string: "https://\(host)/")?.host?.lowercased() ?? "" }
        }
        context.setObject(normalize, forKeyedSubscript: "browserNormalizeHostname" as NSString)
        context.evaluateScript(source)
        guard context.exception == nil else { return nil }
        return context
    }

    @objc static func preprocessRules(_ source: String) -> String {
        parserLock.lock(); defer { parserLock.unlock() }
        return autoreleasepool {
            if parserContext == nil { parserContext = makeContext() }
            guard let context = parserContext else { return source }
            context.exception = nil
            return context.objectForKeyedSubscript("browserPreprocessUBlock")?.call(withArguments: [source])?.toString() ?? source
        }
    }

    @objc static func compileUBlockLists(_ lists: NSArray) -> NSDictionary? {
        // The background queue need not drain its pool between preparations.
        // Retain only the compiled scripts/counters, not temporary bridge objects.
        return autoreleasepool { compileScripts(lists) }
    }

    private static func compileScripts(_ lists: NSArray) -> NSDictionary? {
        guard let libraryText = resource("UBlockScriptlets", "json"),
              let libraryData = libraryText.data(using: .utf8),
              let library = (try? JSONSerialization.jsonObject(with: libraryData)) as? [[String: Any]],
              let runtime = resource("UBlockRuntime", "js"),
              let domains = resource("UBlockDomains", "js"),
              let cosmetics = resource("UBlockCosmetics", "js"),
              let procedural = resource("UBlockProcedural", "js") else { return nil }
        let byName = Dictionary(uniqueKeysWithValues: library.compactMap { entry -> (String, [String: Any])? in
            guard let name = entry["name"] as? String else { return nil }; return (name, entry)
        })
        func json(_ object: Any) -> String {
            autoreleasepool {
                guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
                      let text = String(data: data, encoding: .utf8) else { return "[]" }
                return text
            }
        }
        func literal(_ value: String) -> String { String(json([value]).dropFirst().dropLast()) }
        // Like uBO's hostname database, retrieve only candidate buckets before
        // running the authoritative domain/path/entity/ancestor matcher. Keep
        // regex/ancestor and generic scopes in the fallback, without guessing.
        final class Buckets {
            var groupIDs = [String: Int](), groups = [String](), index = [String: [Int]](), fallback = [Int]()
            var ordinal = 0
            var scriptletNames = [String]()

            func append(_ record: String, positives: [String], scriptlet: String?, json: (Any) -> String) {
                let broad = positives.isEmpty || positives.contains { $0.hasPrefix("/") || $0.hasSuffix(">>") }
                let keys = broad ? [] : Array(Set(positives.map { String($0.split(separator: "/", maxSplits: 1).first ?? "") })).sorted()
                let signature = broad ? "" : json(keys)
                let id: Int
                if let existing = groupIDs[signature] { id = existing }
                else {
                    id = groups.count; groupIDs[signature] = id; groups.append("")
                    if broad { fallback.append(id) }
                    else { for key in keys { index[key, default: []].append(id) } }
                }
                groups[id].append(groups[id].isEmpty ? "[" : ",")
                groups[id].append("[\(ordinal),")
                groups[id].append(record)
                groups[id].append("]")
                ordinal += 1
                if let scriptlet { scriptletNames.append(scriptlet) }
            }

            var sourceCapacity: Int { groups.reduce(0) { $0 + $1.utf8.count } }

            func appendSource(to source: inout String, json: (Any) -> String, literal: (String) -> String) {
                source.append("(function(){\nfunction buckets(host){switch(host){")
                for key in index.keys.sorted() {
                    source.append("case \(literal(key)):return \(json(index[key]!));")
                }
                source.append("}return [];}\nfunction entries(id){switch(id){")
                for id in groups.indices {
                    groups[id].append("]")
                    source.append("case \(id):return JSON.parse(")
                    BrowserAdBlockConverter.appendJSONLiteral(groups[id], to: &source)
                    source.append(");")
                    groups[id] = ""
                }
                source.append("""
                }return [];}
                const chosen=new Set(\(json(fallback)));
                for(let host of [hostname,entityFor(hostname),'*']){
                    while(host){for(const id of buckets(host))chosen.add(id);const dot=host.indexOf('.');if(dot<0)break;host=host.slice(dot+1);}
                }
                const matches=[];for(const id of chosen)for(const entry of entries(id))matches.push(entry);
                matches.sort((a,b)=>a[0]-b[0]);return matches.map(entry=>entry[1]);
                })()
                """)
            }
        }
        let buckets = ["MAIN": Buckets(), "ISOLATED": Buckets()]
        let counters: (NSDictionary, NSDictionary)? = autoreleasepool {
            guard let context = makeContext() else { return nil }
            // Release the VM before assembling the scripts; it owns neither
            // the final bucket buffers nor the returned counters.
            context.exception = nil
            guard let iterator = context.objectForKeyedSubscript("browserCompileUBlockBatches")?.call(withArguments: [lists, library]),
                  context.exception == nil,
                  let next = context.evaluateScript("""
            (function(iterator){
                const step=iterator.next();
                if(step.done)return {done:true,...step.value};
                return {done:false,batch:step.value.map(r=>[
                    JSON.stringify(r),
                    (r.domains||[]).filter(d=>d.exclude!==true).map(d=>d.host),
                    r.kind,r.world||'',r.exception===true,r.name||''
                ])};
            })
            """), context.exception == nil else { return nil }
            var counters: (NSDictionary, NSDictionary)?
            while counters == nil {
                let valid: Bool = autoreleasepool {
                    // Pull and consume each batch within the same pool. Even
                    // the JSValue wrappers die before the next parser batch.
                    guard let step = next.call(withArguments: [iterator]), context.exception == nil,
                          let done = step.objectForKeyedSubscript("done") else { return false }
                    if done.toBool() {
                        guard let stats = step.objectForKeyedSubscript("stats")?.toDictionary(),
                              let rejected = step.objectForKeyedSubscript("rejected")?.toDictionary() else { return false }
                        counters = (stats as NSDictionary, rejected as NSDictionary)
                        return true
                    }
                    guard let batch = step.objectForKeyedSubscript("batch")?.toArray() as? [[Any]],
                          !batch.isEmpty, batch.count <= 512 else { return false }
                    for entry in batch {
                        guard entry.count == 6, let record = entry[0] as? String,
                              let positives = entry[1] as? [String], let kind = entry[2] as? String,
                              let world = entry[3] as? String, let exception = entry[4] as? Bool,
                              let name = entry[5] as? String else { return false }
                        for target in ["MAIN", "ISOLATED"] {
                            let selected = exception ? (kind != "cosmetic" || target == "ISOLATED") :
                                (kind == "cosmetic" ? target == "ISOLATED" : world == target)
                            if selected {
                                buckets[target]!.append(record, positives: positives,
                                    scriptlet: kind == "scriptlet" && !exception ? name : nil, json: json)
                            }
                        }
                    }
                    return true
                }
                guard valid else { return nil }
            }
            return counters
        }
        guard let (stats, rejected) = counters else { return nil }
        var scripts = [String: String]()
        for world in ["MAIN", "ISOLATED"] {
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
            for name in buckets[world]!.scriptletNames { collect(name) }
            for name in names.sorted() where name.hasSuffix(".js") {
                guard let entry = byName[name], let functionName = entry["functionName"] as? String else { continue }
                functions.append("[\(json([name]).dropFirst().dropLast()),\(functionName)]")
            }
            scripts[world] = autoreleasepool {
                render(runtime, parts: [
                    "__BROWSER_DOMAINS__": domains,
                    "__BROWSER_FUNCTIONS__": declarations.joined(separator: "\n"),
                    "__BROWSER_FUNCTION_MAP__": "[\(functions.joined(separator: ","))]",
                    "__BROWSER_COSMETICS__": world == "ISOLATED" ? cosmetics.replacingOccurrences(of: "__BROWSER_PROCEDURAL__", with: procedural) : "",
                ], recordCapacity: buckets[world]!.sourceCapacity) { buffer in
                    buckets[world]!.appendSource(to: &buffer, json: json, literal: literal)
                }
            }
        }
        return ["scripts": scripts, "stats": stats, "rejected": rejected]
    }

    // Escape directly into the final source buffer. Foundation serialization
    // would materialize both a huge UTF-16 wrapper and a second escaped string.
    private static func appendJSONLiteral(_ value: String, to output: inout String) {
        output.append("\"")
        let scalars = value.unicodeScalars
        var cursor = scalars.startIndex
        for index in scalars.indices {
            let scalar = scalars[index].value
            let escaped: String
            switch scalar {
            case 0x22: escaped = "\\\""
            case 0x5C: escaped = "\\\\"
            case 0x08: escaped = "\\b"
            case 0x0C: escaped = "\\f"
            case 0x0A: escaped = "\\n"
            case 0x0D: escaped = "\\r"
            case 0x09: escaped = "\\t"
            case 0x00...0x1F, 0x2028, 0x2029: escaped = String(format: "\\u%04x", scalar)
            default: continue
            }
            output.append(contentsOf: value[cursor..<index])
            output.append(escaped)
            cursor = scalars.index(after: index)
        }
        output.append(contentsOf: value[cursor...])
        output.append("\"")
    }

    // Assemble one final buffer rather than repeatedly copying a script that
    // already contains tens of megabytes of filter data. Inserted data stays
    // literal, including marker-looking text in filter arguments.
    private static func render(_ template: String, parts: [String: String], recordCapacity: Int,
                               records: (inout String) -> Void) -> String {
        var tokens = [(Range<String.Index>, String)]()
        for token in Array(parts.keys) + ["__BROWSER_RECORDS__"] {
            var cursor = template.startIndex
            while let range = template.range(of: token, range: cursor..<template.endIndex) {
                tokens.append((range, token))
                cursor = range.upperBound
            }
        }
        tokens.sort { $0.0.lowerBound < $1.0.lowerBound }
        var script = ""
        script.reserveCapacity(template.utf8.count + recordCapacity + parts.values.reduce(0) { $0 + $1.utf8.count })
        var cursor = template.startIndex
        for (range, token) in tokens {
            script.append(contentsOf: template[cursor..<range.lowerBound])
            if token == "__BROWSER_RECORDS__" { records(&script) }
            else { script.append(parts[token]!) }
            cursor = range.upperBound
        }
        script.append(contentsOf: template[cursor...])
        return script
    }
}

// Full upstream network engines have their own context and serial worker. No page
// contains this bundle, and a request decision never waits on the main thread.
// Each candidate owns its JS VM, timers and serial queue. Building a replacement
// never queues behind (or resets) the VM currently making network decisions.
private final class BrowserNetworkRuntime {
    let queue = DispatchQueue(label: "browser.ublock.network.runtime", qos: .userInitiated)
    var context: JSContext?
    var timerID = 0
    var timers = [Int: JSValue]()
}

@objc(BrowserNetworkFilterEngine)
final class BrowserNetworkFilterEngine: NSObject {
    // Access these only on the main queue.
    private static var installed: BrowserNetworkRuntime?
    private static var installedIdentity = ""
    private static var installedSummary: NSDictionary = [:]
    private static var preparationGeneration = 0

    // Only generated network snapshots are disposable. Retain the successful
    // current cache and one previous cache; never touch website/torrent data.
    private static func pruneSnapshots(directory: URL, keeping current: URL) {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? []
        let candidates = files.filter {
            $0.lastPathComponent.hasPrefix("network-v") && $0.pathExtension == "json" &&
                (try? $0.resourceValues(forKeys: keys).isRegularFile) == true
        }.sorted {
            let a = (try? $0.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            return a > b
        }
        var keptPrevious = false
        for file in candidates where file != current {
            if !keptPrevious { keptPrevious = true; continue }
            try? FileManager.default.removeItem(at: file)
        }
    }

    private static func createContext(runtime: BrowserNetworkRuntime) -> JSContext? {
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
        let schedule: @convention(block) (JSValue, Double) -> Int = { [weak runtime] callback, milliseconds in
            guard let runtime else { return 0 }
            runtime.timerID += 1
            let id = runtime.timerID
            runtime.timers[id] = callback
            runtime.queue.asyncAfter(deadline: .now() + max(0.001, milliseconds / 1000)) { [weak runtime] in
                guard let callback = runtime?.timers.removeValue(forKey: id) else { return }
                callback.call(withArguments: [])
            }
            return id
        }
        let cancel: @convention(block) (Int) -> Void = { [weak runtime] id in runtime?.timers.removeValue(forKey: id) }
        context.setObject(normalize, forKeyedSubscript: "browserNormalizeHostname" as NSString)
        context.setObject(decode, forKeyedSubscript: "browserDecodeBytes" as NSString)
        context.setObject(schedule, forKeyedSubscript: "setTimeout" as NSString)
        context.setObject(cancel, forKeyedSubscript: "clearTimeout" as NSString)
        context.evaluateScript("""
        globalThis.performance={now:()=>Date.now()};
        globalThis.TextDecoder=class {decode(bytes){return browserDecodeBytes(Array.from(bytes||[]));}};
        globalThis.URL=class {constructor(){this._hostname='';}get hostname(){return this._hostname;}set hostname(value){this._hostname=browserNormalizeHostname(value);}};
        """)
        context.evaluateScript(source)
        return context.exception == nil ? context : nil
    }

    @objc(prepareLists:identity:completion:)
    static func prepare(lists: NSArray, identity: String, completion: @escaping (NSDictionary) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        preparationGeneration += 1
        let generation = preparationGeneration
        if installedIdentity == identity, installed != nil {
            completion(installedSummary)
            return
        }
        let candidate = BrowserNetworkRuntime()
        candidate.queue.async {
            let started = Date()
            guard let context = createContext(runtime: candidate),
                  let suffixURL = Bundle.main.url(forResource: "PublicSuffixList", withExtension: "dat"),
                  let suffixes = try? String(contentsOf: suffixURL, encoding: .utf8) else {
                DispatchQueue.main.async { completion(["available": false, "error": 1]) }
                return
            }
            candidate.context = context
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
                .appendingPathComponent("BrowserNetworkRules", isDirectory: true)
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let cacheURL = directory.appendingPathComponent("network-v3-\(identity).json")
            func readCache(_ url: URL) -> [String: Any]? {
                (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            }
            let cache = readCache(cacheURL) ?? readCache(directory.appendingPathComponent("network-v2-\(identity).json"))
            var fingerprint: UInt64 = 14695981039346656037
            let engineSource = Bundle.main.url(forResource: "UBlockNetwork", withExtension: "js").flatMap { try? Data(contentsOf: $0) } ?? Data()
            for byte in engineSource + Data(suffixes.utf8) { fingerprint = (fingerprint ^ UInt64(byte)) &* 1099511628211 }
            let engineFingerprint = String(fingerprint, radix: 16)
            let compatibleCache = cache?["engineFingerprint"] as? String == engineFingerprint
            var compiled: [String: Any]?
            if compatibleCache, let snapshot = cache?["snapshot"] as? String {
                compiled = context.objectForKeyedSubscript("browserRestoreNetwork")?.call(withArguments: [snapshot, suffixes])?.toDictionary() as? [String: Any]
                if context.exception != nil { compiled = nil; context.exception = nil }
            }
            var text = compatibleCache ? (cache?["compiled"] as? String ?? "") : ""
            if compiled == nil {
                var result = context.objectForKeyedSubscript("browserCompileNetwork")?.call(withArguments: [lists, text, suffixes])
                if context.exception != nil, !text.isEmpty {
                    context.exception = nil
                    result = context.objectForKeyedSubscript("browserCompileNetwork")?.call(withArguments: [lists, "", suffixes])
                }
                compiled = result?.toDictionary() as? [String: Any]
                text = compiled?.removeValue(forKey: "compiled") as? String ?? ""
            }
            guard context.exception == nil, var summary = compiled else {
                DispatchQueue.main.async { completion(["available": false, "error": 2]) }
                return
            }
            if summary["cached"] as? Bool == true { summary["stats"] = cache?["stats"] ?? [:] }
            // Finish optimization/serialization on the candidate queue while the
            // previous VM remains free to serve requests. Never publish a VM
            // and then block its first decisions behind snapshot creation.
            var persistent: [String: Any]?
            if summary["snapshot"] as? Bool != true {
                context.exception = nil
                let snapshot = context.objectForKeyedSubscript("browserSerializeNetwork")?.call(withArguments: [])?.toString()
                if context.exception == nil, let snapshot, !snapshot.isEmpty {
                    persistent = ["snapshot": snapshot, "compiled": text, "stats": summary["stats"] ?? [:], "engineFingerprint": engineFingerprint]
                }
                context.exception = nil // Cache failure must not disable matching.
            }
            var persisted = summary["snapshot"] as? Bool == true
            if let persistent, let data = try? JSONSerialization.data(withJSONObject: persistent) {
                do { try data.write(to: cacheURL, options: .atomic); persisted = true }
                catch { persisted = false }
            }
            summary["available"] = true
            summary["prepareMilliseconds"] = Int(Date().timeIntervalSince(started) * 1000)
            let preparedSummary = summary as NSDictionary
            let prune = persisted
            let retainedCache = FileManager.default.fileExists(atPath: cacheURL.path) ? cacheURL : directory.appendingPathComponent("network-v2-\(identity).json")
            DispatchQueue.main.async {
                guard generation == preparationGeneration else {
                    completion(["available": false, "superseded": true]); return
                }
                installed = candidate
                installedIdentity = identity
                installedSummary = preparedSummary
                if prune { pruneSnapshots(directory: directory, keeping: retainedCache) }
                completion(preparedSummary)
            }
        }
    }

    @objc(matchRequest:hostRules:urlRules:completion:)
    static func match(request: NSDictionary, hostRules: String, urlRules: String, completion: @escaping (NSDictionary) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let runtime = installed else { completion(["action": 0, "engine": "preparing"]); return }
        runtime.queue.async {
            guard let context = runtime.context else { DispatchQueue.main.async { completion(["action": 0, "engine": "unavailable"]) }; return }
            context.exception = nil
            context.objectForKeyedSubscript("browserSetDynamicNetwork")?.call(withArguments: [hostRules, urlRules])
            let decision = context.objectForKeyedSubscript("browserMatchNetwork")?.call(withArguments: [request])?.toDictionary() as? [String: Any]
            let valid = context.exception == nil
            DispatchQueue.main.async {
                // A decision queued on the previous VM must be reevaluated after
                // the atomic swap, using the caller's current dynamic rules.
                guard installed === runtime else {
                    match(request: request, hostRules: hostRules, urlRules: urlRules, completion: completion); return
                }
                completion(valid ? (decision ?? [:]) as NSDictionary : ["action": 0, "engine": "error"])
            }
        }
    }
}
