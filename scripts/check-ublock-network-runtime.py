#!/usr/bin/env python3
"""Verify the actual Swift/JSC network runtime on macOS with disposable resources/cache."""
import json
import os
import sys
import pathlib
import plistlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / '.data/network-runtime-verification'
BUNDLE = ARTIFACT / 'Probe.app/Contents'
CACHE = ARTIFACT / 'cache/BrowserNetworkRules'
HARNESS = r"""func wait(_ predicate: () -> Bool) {
 let deadline = Date().addingTimeInterval(30)
 while !predicate() && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
 precondition(predicate(), "Timed out")
}
let request: NSDictionary = ["url":"https://a.invalid/ad","originURL":"https://site.invalid/","topURL":"https://site.invalid/","type":"xmlhttprequest","method":"GET"]
let full = ProcessInfo.processInfo.environment["NETWORK_PROBE_FULL"] != nil
let text = full ? (try String(contentsOf: Bundle.main.url(forResource:"UBlockFilters",withExtension:"txt")!,encoding:.utf8)) + "\n||a.invalid^" : "||a.invalid^\n/regexp-test/.*ads/$xmlhttprequest"
let a: NSArray = [["id":"fixture","trusted":full,"text":text]]
var summary: NSDictionary?
BrowserNetworkFilterEngine.prepare(lists:a,identity:"a") {summary=$0}
wait {summary != nil}
precondition(summary?["available"] as? Bool == true)
precondition((summary?["snapshot"] as? Bool ?? false) == (CommandLine.arguments[2] == "snapshot"), "Unexpected cache restore path")
print("Native cold/warm snapshot=\(summary?["snapshot"] ?? false), prepare-ms=\(summary?["prepareMilliseconds"] ?? -1)")
func check(_ expected: Int) {
 var result: NSDictionary?
 BrowserNetworkFilterEngine.match(request:request,hostRules:"",urlRules:"") {result=$0}
 wait {result != nil}
 precondition((result?["action"] as? Int)==expected)
 precondition(result?["engine"] as? String == "static", "Installed engine must remain available")
}
check(1)
let heavy = (0..<25000).map {"||domain\($0).invalid^"}.joined(separator:"\n")
var oldDecision: NSDictionary?, bSummary: NSDictionary?, cSummary: NSDictionary?
BrowserNetworkFilterEngine.prepare(lists:[["id":"fixture","trusted":false,"text":heavy]],identity:"b") {bSummary=$0}
BrowserNetworkFilterEngine.match(request:request,hostRules:"",urlRules:"") {oldDecision=$0}
wait {oldDecision != nil}
precondition(oldDecision?["action"] as? Int == 1 && bSummary == nil,"Old engine must serve while candidate builds")
BrowserNetworkFilterEngine.prepare(lists:[["id":"fixture","trusted":false,"text":"||c.invalid^"]],identity:"c") {cSummary=$0}
wait {cSummary != nil && bSummary != nil}
precondition(cSummary?["available"] as? Bool == true && bSummary?["superseded"] as? Bool == true)
check(0)
// A failed replacement must leave the installed engine intact.
let bundleSource=Bundle.main.url(forResource:"UBlockNetwork",withExtension:"js")!
let saved=try Data(contentsOf:bundleSource)
try Data("throw new Error('fixture bootstrap failure')".utf8).write(to:bundleSource)
var failure: NSDictionary?
BrowserNetworkFilterEngine.prepare(lists:a,identity:"failure") {failure=$0}
wait {failure != nil}
try saved.write(to:bundleSource)
precondition(failure?["available"] as? Bool == false)
check(0)
print("Actual Swift/JSC lifecycle: old engine remains responsive, newest candidate wins, failed replacement retains protection.")
"""

def run(*args):
    return subprocess.run(args, check=True, text=True, cwd=ROOT, timeout=60,
                          env={**os.environ, **({'NETWORK_PROBE_FULL':'1'} if '--full' in sys.argv else {})})

(BUNDLE / 'Resources').mkdir(parents=True, exist_ok=True)
(BUNDLE / 'MacOS').mkdir(exist_ok=True)
for name in ('UBlockNetwork.js', 'PublicSuffixList.dat', 'UBlockFilters.txt'):
    shutil.copy2(ROOT / '_Project/Vendor/UBlock' / name, BUNDLE / 'Resources' / name)
(BUNDLE / 'Info.plist').write_bytes(plistlib.dumps({
    'CFBundleExecutable':'Probe', 'CFBundleIdentifier':'org.tvosofabrowse.network-runtime-verification',
    'CFBundlePackageType':'APPL',
}))
source = (ROOT / '_Project/Browser/BrowserAdBlockConverter.swift').read_text()
source = source[source.index('private final class BrowserNetworkRuntime'):]
# Only redirect the cache location; the production queue/VM/swap code is unchanged.
source = source.replace('FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!',
                        'URL(fileURLWithPath: CommandLine.arguments[1])')
(ARTIFACT / 'main.swift').write_text('import Foundation\nimport JavaScriptCore\n' + source + HARNESS)
run('swiftc', '-swift-version', '5', '-O', '-module-cache-path', '/tmp/browser-swift-cache',
    str(ARTIFACT / 'main.swift'), '-o', str(BUNDLE / 'MacOS/Probe'))
CACHE.mkdir(parents=True, exist_ok=True)
for name in ('a', 'b', 'c'):
    (CACHE / f'network-v3-{name}.json').unlink(missing_ok=True)
run(str(BUNDLE / 'MacOS/Probe'), str(ARTIFACT / 'cache'), 'cold')
cache_file = CACHE / 'network-v3-a.json'
cache = json.loads(cache_file.read_text())
assert cache['snapshot'] and cache['engineFingerprint']
(CACHE / 'network-v3-b.json').unlink(missing_ok=True)
run(str(BUNDLE / 'MacOS/Probe'), str(ARTIFACT / 'cache'), 'snapshot')
cache['snapshot'] = '{broken'
cache_file.write_text(json.dumps(cache))
(CACHE / 'network-v3-b.json').unlink(missing_ok=True)
run(str(BUNDLE / 'MacOS/Probe'), str(ARTIFACT / 'cache'), 'compiled')
print('Cold, ready-snapshot, corrupt-snapshot/compiled fallback and lifecycle checks passed.')
