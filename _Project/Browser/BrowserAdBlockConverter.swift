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
    private static let resourceLock = NSLock()
    private static var cachedResources = [String: String]()
    private static var cachedScriptletLibrary: [[String: Any]]?
    // Bundle resources are immutable for the process lifetime. Like Brave's
    // ScriptFactory, retain reusable sources rather than rereading/parsing the
    // same library for every changed filter list. Only derived caches are freed.
    private static let resourceMemoryWarningObserver = NotificationCenter.default.addObserver(
        forName: Notification.Name("UIApplicationDidReceiveMemoryWarningNotification"),
        object: nil, queue: nil
    ) { _ in
        resourceLock.lock()
        cachedResources.removeAll()
        cachedScriptletLibrary = nil
        resourceLock.unlock()
    }

    private static func resource(_ name: String, _ ext: String) -> String? {
        _ = resourceMemoryWarningObserver
        let key = "\(name).\(ext)"
        resourceLock.lock()
        let cached = cachedResources[key]
        resourceLock.unlock()
        if let cached { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: ext),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        resourceLock.lock()
        cachedResources[key] = source
        resourceLock.unlock()
        return source
    }

    private static func scriptletLibrary() -> [[String: Any]]? {
        resourceLock.lock()
        let cached = cachedScriptletLibrary
        resourceLock.unlock()
        if let cached { return cached }
        guard let source = resource("UBlockScriptlets", "json"),
              let data = source.data(using: .utf8),
              let library = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return nil }
        resourceLock.lock()
        cachedScriptletLibrary = library
        resourceLock.unlock()
        return library
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
        compileUBlockLists(lists, cancelled: { false })
    }

    @objc(compileUBlockLists:cancelled:)
    static func compileUBlockLists(_ lists: NSArray, cancelled: @escaping () -> Bool) -> NSDictionary? {
        // The background queue need not drain its pool between preparations.
        // Retain only the compiled scripts/counters, not temporary bridge objects.
        return autoreleasepool { compileScripts(lists, cancelled: cancelled) }
    }

    private static func compileScripts(_ lists: NSArray, cancelled: () -> Bool) -> NSDictionary? {
        guard !cancelled(), let library = scriptletLibrary(),
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
                guard !cancelled() else { return nil }
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
            guard !cancelled() else { return nil }
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
                    "__BROWSER_CONFIG__": "(browserConfigurationDescriptor && browserConfigurationDescriptor.configurable === true && Object.prototype.hasOwnProperty.call(browserConfigurationDescriptor, 'value') ? browserConfigurationDescriptor.value : undefined)",
                    "__BROWSER_DOMAINS__": domains,
                    "__BROWSER_FUNCTIONS__": declarations.joined(separator: "\n"),
                    "__BROWSER_FUNCTION_MAP__": "[\(functions.joined(separator: ","))]",
                    "__BROWSER_COSMETICS__": world == "ISOLATED" ? cosmetics.replacingOccurrences(of: "__BROWSER_PROCEDURAL__", with: procedural) : "",
                ], recordCapacity: buckets[world]!.sourceCapacity) { buffer in
                    buckets[world]!.appendSource(to: &buffer, json: json, literal: literal)
                }
            }
        }
        // The per-document token/configuration travels in a separate tiny
        // document-start script. The universal sources can therefore be reused
        // across tabs without copying tens of megabytes for token substitution.
        guard !cancelled() else { return nil }
        return ["format": 4, "scripts": scripts, "configurationMode": "separate-v1", "stats": stats, "rejected": rejected]
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
