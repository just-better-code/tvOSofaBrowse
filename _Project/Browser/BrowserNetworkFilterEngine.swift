import Foundation
import JavaScriptCore
import CryptoKit

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

private final class BrowserNetworkPreparationToken {
    private let lock = NSLock()
    private var stopped = false
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
}

@objc(BrowserNetworkFilterEngine)
final class BrowserNetworkFilterEngine: NSObject {
    // Access these only on the main queue.
    private static var installed: BrowserNetworkRuntime?
    private static var installedIdentity = ""
    private static var installedSummary: NSDictionary = [:]
    private static var preparationGeneration = 0
    private static var activeToken: BrowserNetworkPreparationToken?
    private static var installedConfiguration = ""
    private static var requestedConfiguration = ""

    // Only generated network snapshots are disposable. Retain the successful
    // current cache and one previous cache; never touch website/torrent data.
    private static func pruneSnapshots(directory: URL, keeping current: URL, token: BrowserNetworkPreparationToken) {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? []
        let snapshots = files.filter { $0.lastPathComponent.hasPrefix("network-v") && $0.pathExtension == "json" }.sorted {
            let a = (try? $0.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            return a > b
        }
        var keep: Set<URL> = [current]
        if let previous = snapshots.first(where: { $0 != current }) { keep.insert(previous) }
        // The paired service pointer can intentionally lag a newly prepared
        // network candidate while the other backends finish or fail.
        let servicePointer = directory.deletingLastPathComponent().appendingPathComponent("BrowserContentRules/LastSuccessfulFilters.plist")
        if let pointer = NSDictionary(contentsOf: servicePointer), let identity = pointer["identity"] as? String,
           !identity.contains("/"), !identity.contains("..") {
            keep.insert(directory.appendingPathComponent("network-v4-\(identity).json"))
        }
        if let pointer = NSDictionary(contentsOf: directory.appendingPathComponent("LastGood.plist")),
           let file = pointer["file"] as? String, (file as NSString).lastPathComponent == file {
            keep.insert(directory.appendingPathComponent(file))
        }
        var sourceKeys = Set<String>()
        for url in keep {
            if let cache = readCache(url), let references = cache["sources"] as? [[String: String]] {
                for reference in references { if let key = reference["key"] { sourceKeys.insert(key) } }
            }
        }
        for url in snapshots where !keep.contains(url) {
            if token.cancelled { return }
            try? FileManager.default.removeItem(at: url)
        }
        // Keep referenced sources plus a small spare window for a cancelled
        // producer; no source TXT or website data belongs to this namespace.
        let sources = files.filter { $0.lastPathComponent.hasPrefix("source-v1-") && $0.pathExtension == "json" }.sorted {
            ((try? $0.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast) >
            ((try? $1.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast)
        }
        var spare = 0
        for url in sources {
            if token.cancelled { return }
            let name = url.deletingPathExtension().lastPathComponent
            let key = String(name.dropFirst("source-v1-".count))
            if sourceKeys.contains(key) { continue }
            if spare < 8 { spare += 1; continue }
            try? FileManager.default.removeItem(at: url)
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

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func cacheDirectory() -> URL {
        let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
            .appendingPathComponent("BrowserNetworkRules", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private static func readCache(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url),
              var value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let integrity = value.removeValue(forKey: "integrity") as? String,
              let canonical = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              digest(canonical) == integrity else { return nil }
        return value
    }

    @discardableResult private static func writeCache(_ value: [String: Any], to url: URL) -> Bool {
        guard let canonical = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return false }
        var stored = value
        stored["integrity"] = digest(canonical)
        guard let data = try? JSONSerialization.data(withJSONObject: stored, options: [.sortedKeys]) else { return false }
        do { try data.write(to: url, options: .atomic); return true } catch { return false }
    }

    private static func validSourceRecord(_ value: [String: Any]?, key: String, fingerprint: String) -> Bool {
        guard let value, value["format"] as? Int == 1, value["sourceKey"] as? String == key,
              value["engineFingerprint"] as? String == fingerprint, value["id"] is String,
              let text = value["compiled"] as? String, let stats = value["stats"] as? [String: Any],
              let accepted = stats["accepted"] as? Int, accepted >= 0,
              let rejected = stats["rejected"] as? Int, rejected >= 0 else { return false }
        return !text.isEmpty || accepted == 0
    }

    private static func engineResources() -> (String, String)? {
        guard let suffixURL = Bundle.main.url(forResource: "PublicSuffixList", withExtension: "dat"),
              let suffixes = try? String(contentsOf: suffixURL, encoding: .utf8),
              let engineURL = Bundle.main.url(forResource: "UBlockNetwork", withExtension: "js"),
              let engine = try? Data(contentsOf: engineURL) else { return nil }
        return (suffixes, digest(engine + Data(suffixes.utf8)))
    }

    private static func restoreRecords(_ cache: [String: Any], directory: URL, fingerprint: String) -> [[String: Any]]? {
        guard let references = cache["sources"] as? [[String: String]] else { return nil }
        var records = [[String: Any]]()
        for reference in references {
            guard let key = reference["key"], key.count == 64,
                  key.allSatisfy({ $0.isHexDigit }), let id = reference["id"],
                  let record = readCache(directory.appendingPathComponent("source-v1-\(key).json")),
                  record["id"] as? String == id, validSourceRecord(record,key: key,fingerprint: fingerprint) else { return nil }
            records.append(record)
        }
        return records
    }

    @objc(cancelPreparation)
    static func cancelPreparation() {
        dispatchPrecondition(condition: .onQueue(.main))
        activeToken?.cancel()
        preparationGeneration += 1
        requestedConfiguration = ""
    }

    // Keep the old collecting interface for the existing diagnostic harnesses.
    @objc(prepareLists:identity:completion:)
    static func prepare(lists: NSArray, identity: String, completion: @escaping (NSDictionary) -> Void) {
        prepare(sources: lists, identity: identity, configuration: identity, completion: completion)
    }

    @objc(prepareSources:identity:configuration:completion:)
    static func prepare(sources: NSArray, identity: String, configuration: String, completion: @escaping (NSDictionary) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        requestedConfiguration = configuration
        activeToken?.cancel()
        preparationGeneration += 1
        let generation = preparationGeneration
        if installedIdentity == identity, installedConfiguration == configuration, installed != nil {
            let exact = installedSummary.mutableCopy() as! NSMutableDictionary
            exact["stale"] = false
            installedSummary = exact
            completion(installedSummary)
            return
        }
        let token = BrowserNetworkPreparationToken()
        activeToken = token
        let candidate = BrowserNetworkRuntime()
        candidate.queue.async {
            let started = ProcessInfo.processInfo.systemUptime
            func fail(_ error: Int) {
                DispatchQueue.main.async { completion(["available": false, "error": error, "superseded": token.cancelled]) }
            }
            guard !token.cancelled, let context = createContext(runtime: candidate),
                  let (suffixes, fingerprint) = engineResources() else { fail(1); return }
            candidate.context = context
            let cancelled: @convention(block) () -> Bool = { token.cancelled }
            context.setObject(cancelled, forKeyedSubscript: "browserPreparationCancelled" as NSString)
            let directory = cacheDirectory()
            let cacheURL = directory.appendingPathComponent("network-v4-\(identity).json")
            let cache = readCache(cacheURL)
            let compatible = cache?["format"] as? Int == 4 && cache?["identity"] as? String == identity && cache?["engineFingerprint"] as? String == fingerprint && cache?["configuration"] as? String == configuration
            var summary: [String: Any]?
            var records: [[String: Any]]?
            var references = [[String: String]]()
            if compatible, let snapshot = cache?["snapshot"] as? String {
                summary = context.objectForKeyedSubscript("browserRestoreNetwork")?.call(withArguments: [snapshot, suffixes])?.toDictionary() as? [String: Any]
                if context.exception != nil { summary = nil; context.exception = nil }
                if summary != nil { summary?["stats"] = cache?["stats"] ?? [:] }
            }
            if summary == nil, compatible, let cache, let restored = restoreRecords(cache, directory: directory, fingerprint: fingerprint) {
                records = restored
                references = cache["sources"] as? [[String: String]] ?? []
            }
            if summary == nil {
                if records == nil {
                    context.objectForKeyedSubscript("browserBeginNetworkCompilation")?.call(withArguments: [suffixes])
                    records = []
                    for descriptor in sources.compactMap({ $0 as? [String: Any] }) {
                        guard !token.cancelled else { fail(3); return }
                        guard let id = descriptor["id"] as? String else { fail(2); return }
                        let text: String
                        if let supplied = descriptor["text"] as? String { text = supplied }
                        else {
                            if descriptor["available"] as? Bool == false { continue }
                            guard let address = descriptor["url"] as? String, let url = URL(string: address),
                                  let loaded = try? String(contentsOf: url, encoding: .utf8) else { fail(2); return }
                            text = loaded
                        }
                        if text.isEmpty {
                            if descriptor["text"] == nil { fail(2); return }
                            continue
                        }
                        let trusted = descriptor["trusted"] as? Bool ?? false
                        let epoch = descriptor["epoch"] as? String ?? ""
                        let key = digest(Data("network-source-v1|\(fingerprint)|\(id)|\(trusted)|\(epoch)|".utf8) + Data(text.utf8))
                        let sourceURL = directory.appendingPathComponent("source-v1-\(key).json")
                        var record = readCache(sourceURL)
                        if record?["id"] as? String != id || !validSourceRecord(record,key: key,fingerprint: fingerprint) {
                            let input: [String: Any] = ["id": id, "text": text, "trusted": trusted]
                            record = context.objectForKeyedSubscript("browserCompileNetworkSource")?.call(withArguments: [input])?.toDictionary() as? [String: Any]
                            guard context.exception == nil, record?["compiled"] is String, record?["stats"] is [String: Any] else { fail(2); return }
                            record?["id"] = id
                            record?["format"] = 1; record?["sourceKey"] = key; record?["engineFingerprint"] = fingerprint
                            if !token.cancelled, let record { writeCache(record,to: sourceURL) }
                        }
                        guard let record else { fail(2); return }
                        records?.append(record)
                        references.append(["id": id, "key": key])
                    }
                }
                guard !token.cancelled else { fail(3); return }
                summary = context.objectForKeyedSubscript("browserRestoreCompiledNetworkSources")?.call(withArguments: [records ?? [], suffixes])?.toDictionary() as? [String: Any]
            }
            guard !token.cancelled, context.exception == nil, var prepared = summary else { fail(2); return }
            var persisted = compatible && (prepared["snapshot"] as? Bool == true)
            if !persisted {
                let snapshot = context.objectForKeyedSubscript("browserSerializeNetwork")?.call(withArguments: [])?.toString()
                if context.exception == nil, let snapshot, !snapshot.isEmpty, !token.cancelled {
                    let value: [String: Any] = ["format": 4, "identity": identity, "snapshot": snapshot, "sources": references,
                        "stats": prepared["stats"] ?? [:], "configuration": configuration, "engineFingerprint": fingerprint]
                    persisted = writeCache(value,to: cacheURL)
                }
                context.exception = nil
            }
            prepared["available"] = true
            prepared["identity"] = identity
            prepared["configuration"] = configuration
            prepared["prepareMilliseconds"] = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            let readySummary = prepared as NSDictionary
            let shouldPrune = persisted
            DispatchQueue.main.async {
                guard generation == preparationGeneration, !token.cancelled else { completion(["available": false, "superseded": true]); return }
                installed = candidate; installedIdentity = identity; installedConfiguration = configuration; installedSummary = readySummary
                if shouldPrune {
                    let pointer: NSDictionary = ["format": 1, "configuration": configuration, "identity": identity, "file": cacheURL.lastPathComponent, "engineFingerprint": fingerprint]
                    pointer.write(to: directory.appendingPathComponent("LastGood.plist"), atomically: true)
                    DispatchQueue.global(qos: .utility).async { pruneSnapshots(directory: directory, keeping: cacheURL, token: token) }
                }
                completion(readySummary)
            }
        }
    }

    // Restore only a compatible previously completed snapshot. It never parses
    // TXT, changes the requested generation or supersedes a full candidate.
    @objc(restoreLastGoodForConfiguration:completion:)
    static func restoreLastGood(configuration: String, completion: @escaping (NSDictionary) -> Void) {
        let pointer = NSDictionary(contentsOf: cacheDirectory().appendingPathComponent("LastGood.plist"))
        guard let identity = pointer?["identity"] as? String else { completion(["available": false]); return }
        restore(identity: identity, configuration: configuration, completion: completion)
    }

    @objc(restoreIdentity:configuration:completion:)
    static func restore(identity: String, configuration: String, completion: @escaping (NSDictionary) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        if installed != nil {
            if installedConfiguration == configuration && installedIdentity == identity { completion(installedSummary) }
            else { completion(["available": false]) }
            return
        }
        if requestedConfiguration.isEmpty { requestedConfiguration = configuration }
        let candidate = BrowserNetworkRuntime()
        candidate.queue.async {
            let directory = cacheDirectory()
            guard !identity.contains("/"), !identity.contains("..") else { DispatchQueue.main.async { completion(["available": false]) }; return }
            let file = "network-v4-\(identity).json"
            guard let cache = readCache(directory.appendingPathComponent(file)), cache["format"] as? Int == 4, cache["identity"] as? String == identity, cache["configuration"] as? String == configuration,
                  let (suffixes, fingerprint) = engineResources(), cache["engineFingerprint"] as? String == fingerprint,
                  let snapshot = cache["snapshot"] as? String, let context = createContext(runtime: candidate) else {
                DispatchQueue.main.async { completion(["available": false]) }; return
            }
            candidate.context = context
            guard var summary = context.objectForKeyedSubscript("browserRestoreNetwork")?.call(withArguments: [snapshot, suffixes])?.toDictionary() as? [String: Any], context.exception == nil else {
                DispatchQueue.main.async { completion(["available": false]) }; return
            }
            summary["stats"] = cache["stats"] ?? [:]; summary["available"] = true; summary["stale"] = true
            summary["configuration"] = configuration; summary["identity"] = identity
            let prepared = summary as NSDictionary
            DispatchQueue.main.async {
                guard requestedConfiguration == configuration else { completion(["available": false, "superseded": true]); return }
                if installed == nil {
                    installed = candidate; installedIdentity = identity; installedConfiguration = configuration; installedSummary = prepared
                }
                if installedConfiguration == configuration && installedIdentity == identity { completion(installedSummary) }
                else { completion(["available": false]) }
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
