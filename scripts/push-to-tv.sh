#!/usr/bin/env bash
# Local entry point: ordinary delivery subcommands and legacy scheduled renewal.
set -euo pipefail
umask 077
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
source "$script_dir/build-stable-root.sh"
case "${1:-}" in
  deploy|build|install|launch) exec "$script_dir/build-to-tv.sh" "$@" ;;
  --help|-h)
    "$script_dir/build-to-tv.sh" --help
    printf '\nScheduled renewal: push-to-tv.sh [--force] [--min-remaining-days 0..6]\n'
    printf 'Without a subcommand, preserve the existing scheduled renewal workflow.\n'
    exit 0 ;;
esac

prepare_stable_build_root "$repo_root" 1
source_root="$stable_build_root"
state_file="${TV_RENEWAL_STATE_FILE:-$repo_root/.data/tv-renewal.next-update}"
derived_data="$repo_root/.derived-device/stable"
cache_root_marker="$derived_data/.repository-root"
if [[ ! -f "$cache_root_marker" || "$(cat "$cache_root_marker")" != "$source_root" ]]; then
  # Xcode's clean leaves compiled modules behind; their absolute paths break after a move.
  rm -rf -- "$derived_data/ModuleCache.noindex" "$derived_data/SDKStatCaches.noindex"
  mkdir -p "$derived_data"
  printf '%s\n' "$source_root" >"$cache_root_marker"
fi
app_path="$derived_data/Build/Products/Debug-appletvos/Browser.app"
profile_path="$app_path/embedded.mobileprovision"
profile_backup_dir=""
state_temp=""
install_succeeded=0
cached_profile_paths=()
backed_up_profile_paths=()
threshold_days=3
force=0
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
set_threshold() {
  [[ "$1" =~ ^0*([0-6])$ ]] || fail 'Expected --min-remaining-days 0..6.'
  threshold_days="${BASH_REMATCH[1]}"
}
while (($#)); do
  case "$1" in
    --force) force=1; shift ;;
    --min-remaining-days)
      (($# >= 2)) || fail 'Missing --min-remaining-days value.'
      set_threshold "$2"; shift 2 ;;
    --min-remaining-days=*) set_threshold "${1#*=}"; shift ;;
    *) fail "Unknown argument: $1; use --help." ;;
  esac
done
profile_value() {
  openssl cms -verify -inform DER -noverify -in "$1" 2>/dev/null |
    plutil -extract "$2" raw -
}
utc_to_epoch() { date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$1" '+%s'; }
epoch_to_utc() { date -j -u -f '%s' "$1" '+%Y-%m-%dT%H:%M:%SZ'; }
profile_expiry() { utc_to_epoch "$(profile_value "$1" ExpirationDate)"; }
write_state() {
  mkdir -p "$(dirname "$state_file")"
  state_temp="$(mktemp "$state_file.XXXXXX")"
  printf '%s\n' "$1" >"$state_temp"
  mv "$state_temp" "$state_file"
  state_temp=""
}
cleanup() {
  local status=$? index
  [[ -z "$state_temp" || ! -f "$state_temp" ]] || rm -f "$state_temp"
  if ((install_succeeded == 0 && ${#cached_profile_paths[@]} > 0)); then
    for index in "${!cached_profile_paths[@]}"; do
      if [[ ! -e "${cached_profile_paths[$index]}" ]]; then
        mv "${backed_up_profile_paths[$index]}" "${cached_profile_paths[$index]}" ||
          printf 'Could not restore cached profile; backup retained in %s.\n' "$profile_backup_dir" >&2
      fi
    done
  fi
  return "$status"
}
trap cleanup EXIT
threshold_seconds=$((threshold_days * 24 * 60 * 60))
if [[ -f "$state_file" ]]; then
  IFS= read -r scheduled_utc <"$state_file" || fail 'Cannot read renewal state.'
  scheduled_epoch="$(utc_to_epoch "$scheduled_utc")"
elif [[ -f "$profile_path" ]]; then
  scheduled_epoch=$(( $(profile_expiry "$profile_path") - threshold_seconds ))
  write_state "$(epoch_to_utc "$scheduled_epoch")"
else
  scheduled_epoch=0
fi
if ((force == 0 && $(date -u '+%s') < scheduled_epoch)); then
  printf 'Renewal not due; next: %s.\n' "$(epoch_to_utc "$scheduled_epoch")"
  exit 0
fi

# Preserve backups and restore moved profiles if build or installation fails.
previous_expiry=0
if [[ -f "$profile_path" ]]; then
  previous_uuid="$(profile_value "$profile_path" UUID)"
  previous_expiry="$(profile_expiry "$profile_path")"
  for cache_dir in "$HOME/Library/MobileDevice/Provisioning Profiles" \
                   "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
    [[ -d "$cache_dir" ]] || continue
    for cached_profile in "$cache_dir"/*.mobileprovision; do
      [[ -f "$cached_profile" ]] || continue
      cached_uuid="$(profile_value "$cached_profile" UUID 2>/dev/null || true)"
      [[ "$cached_uuid" == "$previous_uuid" ]] || continue
      if [[ -z "$profile_backup_dir" ]]; then
        mkdir -p "$repo_root/.data"
        profile_backup_dir="$(mktemp -d "$repo_root/.data/tv-profile-backup.XXXXXX")"
      fi
      backup_path="$profile_backup_dir/${#cached_profile_paths[@]}.mobileprovision"
      mv "$cached_profile" "$backup_path"
      cached_profile_paths+=("$cached_profile")
      backed_up_profile_paths+=("$backup_path")
    done
  done
fi
mkdir -p "$repo_root/.data/tv-deploy-logs"
log_dir="$(mktemp -d "$repo_root/.data/tv-deploy-logs/renew.XXXXXX")"
cd "$source_root"
printf 'Renewing signing profile...\n'
if ! xcodebuild -project "$source_root/_Project/Browser.xcodeproj" -scheme Browser \
  -configuration Debug -destination 'generic/platform=tvOS' \
  -derivedDataPath "$derived_data" -allowProvisioningUpdates clean build \
  >"$log_dir/build.log" 2>&1; then
  fail "Build failed; inspect $log_dir/build.log."
fi
[[ -f "$profile_path" ]] || fail 'Built app has no provisioning profile.'
new_expiry="$(profile_expiry "$profile_path")"
minimum_expiry=$(( $(date -u '+%s') + 6 * 24 * 60 * 60 ))
((new_expiry > previous_expiry && new_expiry >= minimum_expiry)) ||
  fail 'Renewed profile must expire later than the previous profile and have at least six days remaining.'
# One install attempt; no sleeps or automatic retries. Legacy renewal does not launch.
"$script_dir/build-to-tv.sh" install --no-launch
install_succeeded=1
write_state "$(epoch_to_utc "$((new_expiry - threshold_seconds))")"
printf 'Renewal installed; next: %s.\n' "$(epoch_to_utc "$((new_expiry - threshold_seconds))")"
