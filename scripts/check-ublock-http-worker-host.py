#!/usr/bin/env python3
"""Run an isolated HTTPS-worker/native-protocol research fixture on a booted tvOS Simulator.

This does not alter Browser or its website store. Synthetic responses test the transport,
not real-server credentials, redirects, request attribution or production integration.
The test app is removed after the run. Logs/artifacts remain in ignored .data/.
"""
import json
import pathlib
import platform
import plistlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
IDENTIFIER = 'org.tvosofabrowse.workerhostprobe'
ARTIFACT = ROOT / '.data' / 'worker-host-probe' / 'WorkerHostProbe.app'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

inventory = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'booted', '--json', capture_output=True).stdout)
devices = [d for runtime, rows in inventory['devices'].items() if 'tvOS' in runtime for d in rows if d['state'] == 'Booted']
if len(devices) != 1:
    raise SystemExit('Boot exactly one tvOS Simulator before running this fixture.')
device = devices[0]['udid']
ARTIFACT.mkdir(parents=True, exist_ok=True)
(ARTIFACT / 'Info.plist').write_bytes(plistlib.dumps({
    'CFBundleExecutable': 'WorkerHostProbe', 'CFBundleIdentifier': IDENTIFIER,
    'CFBundleName': 'WorkerHostProbe', 'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0',
    'MinimumOSVersion': '18.0', 'UIDeviceFamily': [3],
    'UIApplicationSupportsIndirectInputEvents': True,
}))
(ARTIFACT / 'UBlockNetwork.js').write_bytes((ROOT / '_Project/Vendor/UBlock/UBlockNetwork.js').read_bytes())
sdk = run('xcrun', '--sdk', 'appletvsimulator', '--show-sdk-path', capture_output=True).stdout.strip()
run('xcrun', 'clang', '-target', f'{platform.machine()}-apple-tvos18.0-simulator', '-isysroot', sdk,
    '-fobjc-arc', '-framework', 'Foundation', '-framework', 'UIKit', '-framework', 'JavaScriptCore',
    str(ROOT / 'scripts/check-ublock-http-worker-host.m'), '-o', str(ARTIFACT / 'WorkerHostProbe'))
run('xcrun', 'simctl', 'install', device, str(ARTIFACT))
try:
    result = subprocess.run(['xcrun', 'simctl', 'launch', '--terminate-running-process', '--console', device, IDENTIFIER],
                            capture_output=True, text=True, timeout=35, check=False)
    output = result.stdout + result.stderr
    (ARTIFACT.parent / 'fixture.log').write_text(output)
    match = re.search(r'\[WorkerHostProbe\] summary=(\{[^\n]+\})', output)
    if result.returncode != 0 or not match or json.loads(match.group(1)).get('passed') is not True:
        raise SystemExit('Fixture failed; inspect ignored .data/worker-host-probe/fixture.log.')
    print('Native HTTPS worker identity/import, fetch/XHR and shipped full-core blocking passed.')
    print('Synthetic cookie observations:', json.dumps({key: json.loads(match.group(1)).get(key)
          for key in ('documentCookie', 'responseCookie')}))
    print('Production cookie, redirect, cancellation and tab/type attribution adapters remain pending.')
finally:
    run('xcrun', 'simctl', 'uninstall', device, IDENTIFIER, capture_output=True)
