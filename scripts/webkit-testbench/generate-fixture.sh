#!/usr/bin/env bash
set -euo pipefail
stand_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
stand_media="$stand_root/.data/webkit-testbench/fixture.webm"
mkdir -p "$(dirname -- "$stand_media")"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=160x90:rate=30 -t 12 -c:v libvpx -b:v 120k -an "$stand_media"
