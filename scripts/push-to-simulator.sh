#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:-deploy}"
if [[ $# -gt 0 && "$1" != --* ]]; then shift; else mode=deploy; fi
configuration=Debug
simulator_id=""
launch_override=""
launch_url=""
dry_run=0
usage() {
  cat <<'HELP'
Usage: push-to-simulator.sh [deploy|build|install|launch] [options]
  deploy                    Build, boot, install and launch (default).
  build                     Build only; no boot/install/launch.
  install                   Boot and install the existing build.
  launch                    Boot and launch the existing installed app.
  --device SIMULATOR_UUID    Use a specific available tvOS Simulator.
  --configuration Debug|Release
  --launch / --no-launch     Override launch after deploy/install.
  --url HTTP(S)_URL          Open a new tab at launch (Debug only).
  --dry-run                 Print planned stages without changing simulator state.
  --help                    Show this help.
HELP
}
fail() { printf '%s\n' "$*" >&2; exit 1; }
case "$mode" in deploy|build|install|launch) ;; *) fail "Unknown mode: $mode";; esac
while (($#)); do
  case "$1" in
    --device) [[ $# -ge 2 ]] || fail 'Missing simulator ID'; simulator_id="$2"; shift 2;;
    --configuration) [[ $# -ge 2 ]] || fail 'Missing configuration'; configuration="$2"; shift 2;;
    --url) [[ $# -ge 2 ]] || fail 'Missing URL'; launch_url="$2"; shift 2;;
    --launch) launch_override=1; shift;;
    --no-launch) launch_override=0; shift;;
    --dry-run) dry_run=1; shift;;
    --help|-h) usage; exit 0;;
    *) fail "Unknown option: $1";;
  esac
done
[[ "$configuration" == Debug || "$configuration" == Release ]] || fail 'Use Debug or Release.'
[[ -z "$launch_override" || "$mode" == deploy || "$mode" == install ]] || fail '--launch/--no-launch apply to deploy/install.'
should_launch=0
[[ "$mode" == deploy || "$mode" == launch ]] && should_launch=1
[[ -z "$launch_override" ]] || should_launch="$launch_override"
if [[ -n "$launch_url" ]]; then
  [[ "$configuration" == Debug && "$should_launch" == 1 ]] || fail '--url requires a Debug launch.'
  python3 - "$launch_url" <<'PY'
import sys
from urllib.parse import urlsplit
url=sys.argv[1]; parsed=urlsplit(url)
if len(url)>8192 or parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
    raise SystemExit('Expected an HTTP(S) URL without credentials')
PY
fi
logs_root="$repo_root/.data/simulator-deploy-logs"
mkdir -p "$logs_root"
log_dir="$(mktemp -d "$logs_root/run.XXXXXX")"
xcrun simctl list devices available -j > "$log_dir/devices.json"
simulator_id="$(python3 - "$log_dir/devices.json" "$simulator_id" <<'PY'
import json,sys
available=[]
for runtime,devices in json.load(open(sys.argv[1]))['devices'].items():
    if 'tvOS' in runtime: available.extend(devices)
requested=sys.argv[2]
if requested:
    device=next((d for d in available if d['udid']==requested),None)
else:
    device=next((d for d in available if d['state']=='Booted'),None)
    device=device or next((d for d in available if '1080p' in d['name']),None)
    device=device or next(iter(available),None)
if not device: raise SystemExit('No matching available tvOS Simulator; install a tvOS runtime in Xcode.')
print(device['udid'])
PY
)"
run_stage() {
  local stage="$1"; shift
  if ((dry_run)); then printf 'planned: %s\n' "$stage"; return; fi
  printf '%s started.\n' "$stage"
  if ! "$@" > "$log_dir/$stage.log" 2>&1; then
    fail "$stage failed; inspect $log_dir/$stage.log"
  fi
  printf '%s succeeded.\n' "$stage"
}
artifact="$repo_root/.derived/simulator/Build/Products/$configuration-appletvsimulator/Browser.app"
if [[ "$mode" == deploy || "$mode" == build ]]; then
  run_stage build xcodebuild -project "$repo_root/_Project/Browser.xcodeproj" -scheme Browser \
    -configuration "$configuration" -destination "platform=tvOS Simulator,id=$simulator_id" \
    -derivedDataPath "$repo_root/.derived/simulator" CODE_SIGNING_ALLOWED=NO build
  if ((!dry_run)); then
    /usr/bin/grep -q '^\*\* BUILD SUCCEEDED \*\*' "$log_dir/build.log" || fail 'Build success marker missing; stopped.'
  fi
fi
bundle_id=""
if ((!dry_run)); then
  [[ -f "$artifact/Info.plist" ]] || fail "Missing simulator artifact; run build first."
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$artifact/Info.plist")"
  version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$artifact/Info.plist")"
  printf 'Artifact version: %s (%s Simulator).\n' "$version" "$configuration"
fi
if [[ "$mode" != build ]]; then
  booted="$(python3 - "$log_dir/devices.json" "$simulator_id" <<'PY'
import json,sys
print(next(d['state'] for ds in json.load(open(sys.argv[1]))['devices'].values() for d in ds if d['udid']==sys.argv[2]))
PY
)"
  [[ "$booted" == Booted ]] || run_stage boot xcrun simctl boot "$simulator_id"
  run_stage ready xcrun simctl bootstatus "$simulator_id" -b
  if [[ "$mode" == deploy || "$mode" == install ]]; then
    run_stage install xcrun simctl install "$simulator_id" "$artifact"
  fi
  if ((should_launch)); then
    if [[ -n "$launch_url" ]]; then
      run_stage launch env "SIMCTL_CHILD_BROWSER_OPEN_URL=$launch_url" xcrun simctl launch \
        --terminate-running-process "$simulator_id" "$bundle_id"
    else
      run_stage launch xcrun simctl launch --terminate-running-process "$simulator_id" "$bundle_id"
    fi
  fi
fi
printf 'Completed: %s%s.\n' "$mode" "$( ((dry_run)) && printf ' (dry run)' || true )"
