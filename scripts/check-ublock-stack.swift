// Run on macOS: swift -module-cache-path /tmp/browser-swift-cache scripts/check-ublock-stack.swift
// Reproduce the large WKUserScript function-entry stack requirement in JavaScriptCore.
import Foundation
import JavaScriptCore

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let template = try String(contentsOf: root.appendingPathComponent("_Project/Vendor/UBlock/UBlockRuntime.js"), encoding: .utf8)
let record: [String: Any] = ["kind": "cosmetic", "domains": [], "key": "[data-ad='$&\\\"']\n\u{2028}", "exception": false]
let records = Array(repeating: record, count: 132_844)
func json(_ value: Any) throws -> String {
    String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
}
let serialized = try json(records)
let packed = "JSON.parse(\(try json([serialized]))[0])"
func script(_ data: String) -> String {
    template.replacingOccurrences(of: "__BROWSER_CONFIG__", with: "{enabled:false}")
        .replacingOccurrences(of: "__BROWSER_RECORDS__", with: data)
        .replacingOccurrences(of: "__BROWSER_FUNCTIONS__", with: "")
        .replacingOccurrences(of: "__BROWSER_FUNCTION_MAP__", with: "[]")
        .replacingOccurrences(of: "__BROWSER_COSMETICS__", with: "")
}
let done = DispatchSemaphore(value: 0)
var passed = false
let thread = Thread {
    let old = JSContext()!
    old.evaluateScript(script(serialized))
    let overflow = old.exception?.toString()?.contains("Maximum call stack") == true
    let fixed = JSContext()!
    fixed.evaluateScript(script(packed))
    let executes = fixed.exception == nil
    let decoded = fixed.evaluateScript(packed)?.toArray() as? [[String: Any]]
    let roundTrip = decoded?.count == records.count && decoded?.first?["key"] as? String == record["key"] as? String
    passed = overflow && executes && roundTrip
    print("Large literal reproduces stack overflow: \(overflow)")
    print("Packed runtime executes: \(executes); records round-trip: \(roundTrip)")
    done.signal()
}
thread.stackSize = 256 * 1024
thread.start()
done.wait()
if !passed { exit(1) }
