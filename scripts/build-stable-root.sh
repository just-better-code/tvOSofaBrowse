#!/usr/bin/env bash

prepare_stable_build_root() {
  local controller_root="$1" update_tree="$2" stable_commit link target
  stable_build_root="$controller_root/.data/stable-worktree"
  stable_commit="$(git -C "$controller_root" rev-parse --verify 'refs/heads/stable^{commit}')" ||
    { printf 'Error: local stable branch is missing.\n' >&2; return 1; }

  if ((update_tree)); then
    if [[ ! -f "$stable_build_root/.git" ]]; then
      [[ ! -e "$stable_build_root" ]] ||
        { printf 'Error: stable worktree path is occupied.\n' >&2; return 1; }
      git -C "$controller_root" worktree add --detach "$stable_build_root" "$stable_commit" || return 1
    else
      [[ "$(git -C "$stable_build_root" rev-parse --show-toplevel)" == "$stable_build_root" ]] ||
        { printf 'Error: stable worktree registration is invalid.\n' >&2; return 1; }
      [[ -z "$(git -C "$stable_build_root" status --porcelain --untracked-files=no)" ]] ||
        { printf 'Error: stable worktree has tracked changes.\n' >&2; return 1; }
      git -C "$stable_build_root" checkout --detach "$stable_commit" || return 1
    fi

    for link in .deps _Project/Browser/Config/Signing.local.xcconfig; do
      target="$controller_root/$link"
      [[ -e "$target" ]] || { printf 'Error: required local build input is missing: %s\n' "$link" >&2; return 1; }
      if [[ -L "$stable_build_root/$link" ]]; then
        [[ "$(readlink "$stable_build_root/$link")" == "$target" ]] ||
          { printf 'Error: stable worktree has an unexpected %s link.\n' "$link" >&2; return 1; }
      elif [[ -e "$stable_build_root/$link" ]]; then
        printf 'Error: stable worktree has an unexpected %s path.\n' "$link" >&2
        return 1
      else
        ln -s "$target" "$stable_build_root/$link"
      fi
    done
  fi
}
