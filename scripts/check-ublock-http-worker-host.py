#!/usr/bin/env python3
"""Run an isolated HTTPS-worker/native-protocol research fixture on a booted tvOS Simulator.

This does not alter Browser or its website store. Synthetic responses test the transport,
not real-server credentials, redirects, request attribution or production integration.
Persistent mode uses only the disposable test app’s store, never Browser’s store.
The test app is removed after the run. Logs/artifacts remain in ignored .data/.
"""
import argparse
import os
import json
import pathlib
import platform
import plistlib
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--persistent', action='store_true', help='Use only the isolated test app’s persistent WK store.')
args = parser.parse_args()
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
    launch_env = os.environ.copy()
    if args.persistent:
        launch_env['SIMCTL_CHILD_WORKER_PROBE_PERSISTENT'] = '1'
    log = ARTIFACT.parent / ('fixture-persistent.log' if args.persistent else 'fixture.log')
    try:
        result = subprocess.run(['xcrun', 'simctl', 'launch', '--terminate-running-process', '--console', device, IDENTIFIER],
                                capture_output=True, text=True, timeout=35, check=False, env=launch_env)
    except subprocess.TimeoutExpired as error:
        def decoded(value):
            return value.decode(errors='replace') if isinstance(value, bytes) else value or ''
        log.write_text(decoded(error.stdout) + decoded(error.stderr))
        raise SystemExit(f'Fixture timed out; no automatic retry. Inspect {log.relative_to(ROOT)}.')
    output = result.stdout + result.stderr
    log.write_text(output)
    match = re.search(r'\[WorkerHostProbe\] summary=(\{[^\n]+\})', output)
    if result.returncode != 0 or not match or json.loads(match.group(1)).get('passed') is not True:
        raise SystemExit(f'Fixture failed; inspect ignored {log.relative_to(ROOT)}.')
    print('Classic/module/nested HTTPS worker identity/import, fetch/XHR, response CSP, redirects, JS abort and full-core blocking passed.')
    print('Synthetic cookie observations:', json.dumps({key: json.loads(match.group(1)).get(key)
          for key in ('documentCookie', 'responseCookie', 'storeDocumentCookie', 'storeResponseCookie')}))
    summary = json.loads(match.group(1))
    print('Transport cancellation:', summary.get('transportCancellation'))
    print('Production cookie, transport cancellation, real-server redirects and tab/type attribution remain pending.')
finally:
    run('xcrun', 'simctl', 'uninstall', device, IDENTIFIER, capture_output=True)
