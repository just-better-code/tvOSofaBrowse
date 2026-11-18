#!/usr/bin/env bash
set -euo pipefail
stand_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
stand_node="$stand_root/.data/tools/node/bin/node"
if [[ ! -x "$stand_node" ]]; then stand_node=node; fi
exec "$stand_node" "$stand_root/scripts/webkit-testbench/cli.mjs" "$@"
