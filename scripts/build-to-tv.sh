#!/usr/bin/env bash
# Build and deliver to an explicitly configured Apple TV.
set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
source "$script_dir/build-stable-root.sh"
# Optional machine-local settings; never commit this file.
if [[ -f "$script_dir/Deployment.local.env" ]]; then
  source "$script_dir/Deployment.local.env"
fi
device_id="${TV_DEVICE_ID:-}"
expected_bundle="${TV_EXPECTED_BUNDLE_IDENTIFIER:-}"
configuration=Debug
mode=deploy
launch_override=""
dry_run=0
log_dir=""

usage() {
  cat <<'HELP'
Usage: build-to-tv.sh [deploy|build|install|launch] [options]
  deploy                 Build, install over the existing app and launch (default).
  build                  Build only; no device access.
  install                Install the existing build; no launch by default.
  launch                 Launch the existing app; no build or installation.
  --launch               Launch after deploy or install.
  --no-launch            Do not launch after deploy or install.
  --configuration VALUE  Debug (default) or Release.
  --device UUID           Use an explicitly requested TV instead of the configured TV.
  --dry-run              Show the operations without building or accessing a device.
  --help                 Show this help.

Configure TV_DEVICE_ID and TV_EXPECTED_BUNDLE_IDENTIFIER in
scripts/Deployment.local.env (see Deployment.local.env.example).
Local signing configuration is preserved. No app removal, profile renewal,
Git push, tests or documentation changes are performed.
HELP
}
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

if (($#)) && [[ "$1" != -* ]]; then
  mode="$1"
  shift
fi
case "$mode" in deploy|build|install|launch) ;; *) fail "Unknown mode: $mode" ;; esac
while (($#)); do
  case "$1" in
    --launch) launch_override=1; shift ;;
    --no-launch) launch_override=0; shift ;;
    --dry-run) dry_run=1; shift ;;
    --configuration|--device)
      (($# >= 2)) || fail "Missing value for $1"
      if [[ "$1" == --configuration ]]; then configuration="$2"; else device_id="$2"; fi
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
case "$configuration" in Debug|Release) ;; *) fail 'Configuration must be Debug or Release.' ;; esac
[[ -n "$expected_bundle" ]] || fail 'Set TV_EXPECTED_BUNDLE_IDENTIFIER to the bundle identifier in your local signing configuration.'
if [[ "$mode" != build ]]; then
  [[ "$device_id" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || fail 'Set TV_DEVICE_ID or pass --device with an explicitly authorized TV UUID.'
fi
if [[ -n "$launch_override" && ( "$mode" == build || "$mode" == launch ) ]]; then
  fail '--launch/--no-launch apply only to deploy or install.'
fi
should_launch=0
[[ "$mode" == deploy || "$mode" == launch ]] && should_launch=1
[[ -z "$launch_override" ]] || should_launch="$launch_override"

prepare_stable_build_root "$repo_root" "$((!dry_run))"
source_root="$stable_build_root"
derived_data="$repo_root/.derived-device/stable"
cache_root_marker="$derived_data/.repository-root"
if (( !dry_run )) && [[ ! -f "$cache_root_marker" || "$(cat "$cache_root_marker")" != "$source_root" ]]; then
  # Xcode's clean leaves compiled modules behind; their absolute paths break after a move.
  rm -rf -- "$derived_data/ModuleCache.noindex" "$derived_data/SDKStatCaches.noindex"
  mkdir -p "$derived_data"
  printf '%s\n' "$source_root" >"$cache_root_marker"
fi
app_path="$derived_data/Build/Products/$configuration-appletvos/Browser.app"
bundle_id="$expected_bundle"
cd "$source_root"

run_stage() {
  local stage="$1"
  shift
  if ((dry_run)); then
    printf '%s:' "$stage"
    printf ' %q' "$@"
    printf '\n'
    return
  fi
  if [[ -z "$log_dir" ]]; then
    mkdir -p "$repo_root/.data/tv-deploy-logs"
    log_dir="$(mktemp -d "$repo_root/.data/tv-deploy-logs/run.XXXXXX")"
  fi
  printf '%s started.\n' "$stage"
  if "$@" >"$log_dir/$stage.log" 2>&1; then
    printf '%s succeeded.\n' "$stage"
  else
    fail "$stage failed; inspect $log_dir/$stage.log. Later stages were not run."
  fi
}

if [[ "$mode" == build || "$mode" == deploy ]]; then
  run_stage build xcodebuild -project "$source_root/_Project/Browser.xcodeproj" \
    -scheme Browser -configuration "$configuration" \
    -destination 'generic/platform=tvOS' -derivedDataPath "$derived_data" \
    -allowProvisioningUpdates build
  if ((!dry_run)); then
    /usr/bin/grep -q '^\*\* BUILD SUCCEEDED \*\*' "$log_dir/build.log" || fail 'Build success marker missing; installation stopped.'
  fi
fi

if [[ "$mode" != launch ]]; then
  if ((dry_run)); then
    printf 'artifact: inspect %s/Info.plist for version and bundle identity\n' "$app_path"
  else
    [[ -f "$app_path/Info.plist" ]] || fail "Missing app artifact: $app_path"
    bundle_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app_path/Info.plist")"
    version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app_path/Info.plist")"
    [[ "$bundle_id" == "$expected_bundle" ]] || fail 'Unexpected app identity; preserve local signing before installation.'
    printf 'Artifact version: %s (%s).\n' "$version" "$configuration"
  fi
fi

if [[ "$mode" == deploy || "$mode" == install ]]; then
  run_stage install xcrun devicectl device install app --device "$device_id" "$app_path"
fi
if ((should_launch)); then
  run_stage launch xcrun devicectl device process launch --device "$device_id" \
    --terminate-existing "$bundle_id"
fi
if ((dry_run)); then printf 'Completed: %s (dry run).\n' "$mode";
else printf 'Completed: %s.\n' "$mode"; fi
