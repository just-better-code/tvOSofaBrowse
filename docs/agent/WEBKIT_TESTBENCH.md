# Linux WebKit media testbench

The reusable stand lives in `scripts/webkit-testbench/`. The local
`webkit-testbench` skill delegates to it. It reads the current application bridge
on each launch; do not maintain another copy in private scenarios.

## User-confirmed simple baseline

```sh
scripts/webkit-testbench/webkit-lab.sh --app --desktop-vlc --ephemeral https://example.org
```

This opens actual Linux WebKit with adblock and uses actual desktop VLC for playback.
The user confirmed this simple scheme on the stand for UAKino, UASerials and
Teleportal. This is **stand evidence, not TV verification**.

The production bridge arms a short 50 ms clock watch from media events/resources.
After at least 0.1 seconds of actual advancing HTML playback, the host validates the
foreground source and sends one `accepted` response. The leaf pauses the exact
video and acknowledges its frozen position. The host then presents/starts VLC
immediately. Buffering is visible in VLC; decoded-frame readiness never gates
presentation. There is no hidden preparation or `prepare` round trip.

An input that ends without decoding any audio/video is a failed start, not a
finished episode. It stays in the player for Back/retry and does not advance the
website. Web inputs use their per-media start-time once; the worker does not add
a second startup seek.

VLC starts at the acknowledged website position. Closing mid-video seeks the same
website video to VLC's position and leaves it **paused**. A later manual Play
rearms capture of that same source. Closing within two seconds of the end returns
the website video to `duration - 0.1` and plays it so its genuine ended lifecycle
can select the next item. Manual Next/Previous are separate commands sent after
VLC dismissal: a source-bound player adapter first, a modeled system media-key
result second, and a real website-end seek only for Next if both are unavailable.
The stand does not emulate Apple MediaRemote or native per-site preferences. It
models the selected fullscreen-exit setting and observes actual WebKit fullscreen
bridge state. Neither route emits a synthetic ended event.

The desktop transport uses RC `get_time`/`get_length`; position precision is one
second. It passes `:start-time`, `:http-user-agent` and `:http-referrer` as input
options **after the media URL**. A loopback request capture proved global
`--http-user-agent` left VLC's default UA on master, rendition and segment requests;
the server returned 403 for that UA and 200 for Firefox. Per-input options fixed
all three request classes. No command HTTP server or media relay is introduced.

`--desktop-vlc` defaults to the user-selected Firefox 128 UA. This is an explicit
Linux adaptation: Safari UA made the actual PlayerJS choose native HLS although
Linux WebKit reported no native HLS support. A controlled same-iframe A/B proved
HLS.js/MSE played the main episode (810 s, advancing clock), whereas native HLS
failed with media error 4. Do not copy this UA or PlayerJS setting into the tvOS app
as a workaround: its native HLS capabilities differ. `--user-agent TEXT` overrides
the stand UA explicitly and is recorded in metadata.

## Other modes and dependencies

`--app` alone enables the production bridge, adblock and the native-host contract
model backed by a Python ctypes Linux libVLC worker. That mode reads the current
application desktop UA and uses dummy audio/video output by default. Actual
readiness statistics are telemetry, not a handoff gate. Add `--vlc-window` to
request a Linux libVLC window; this optional output is not UIKit and has not been
visually verified. Use `--app --desktop-vlc` for the confirmed visible baseline.

For controlled comparisons, use `--bridge --native-vlc` without `--adblock`, or
plain WebKit without these flags. `--bridge` alone is observational and never
silently accepts VLC offers.

```sh
npm ci --prefix scripts/webkit-testbench --ignore-scripts --no-audit --no-fund
PLAYWRIGHT_BROWSERS_PATH="$PWD/.data/webkit-testbench/browsers" \
  node scripts/webkit-testbench/node_modules/playwright/cli.js install webkit
python3 -c 'import ctypes.util; print(ctypes.util.find_library("vlc"))'
```

The launcher prefers the ignored local Node installation and can reuse an existing
local skill installation of the pinned Playwright package. Desktop mode requires
`vlc`; the worker requires Linux libVLC and Python's standard library. Follow the
skill's graphical administrative-authorization workflow for missing OS packages.
Do not request passwords in chat or upgrade dependencies to obtain a green test.

Defaults are a 1920×1080 CSS viewport and zoom 1, not an emulated TV display. Use
`--profile investigation` instead of `--ephemeral` to preserve website storage.
Profiles are private; do not delete or reuse a personal profile for clean-state tests.

## Slow connections with standard Linux tools

Use Linux `tc/netem`, not a custom media proxy or delayed `route.fulfill` response.
The wrapper creates a private user/mount/network namespace and uses
[slirp4netns](https://github.com/rootless-containers/slirp4netns) for internet access.
It runs as the current UID, shapes ingress through IFB, and splits the requested
extra round-trip delay across ingress and egress. WebKit and all child VLC traffic,
including HTTPS and adaptive segments, share this connection. The host's network,
browser sessions, TLS, media URLs and HTTP headers are unchanged.

```sh
python3 scripts/webkit-testbench/slow-network.py --download-kbps 2000 --latency-ms 150 -- \
  scripts/webkit-testbench/webkit-lab.sh --app --desktop-vlc --ephemeral https://example.org
```

Requirements: Linux user namespaces, `unshare`, `mount`, `ip`, `tc` with netem/IFB,
and `slirp4netns`. The latter may be installed on PATH or extracted from the
distribution package under ignored `.data/tools/slirp4netns/` without a system
installation. Dependencies remain outside Git. A restricted execution sandbox may
need an approved invocation for namespace/network syscalls; never apply fallback
qdiscs to the host network. No system password or root network setup is required.
Exit the stand normally to remove its private namespace/helper. A new launch
without this wrapper restores normal networking for that stand.

The settings and final `tc -s qdisc` counters remain under ignored
`.data/webkit-testbench/network/`. Each browser run also records the settings in
`environment.json`. Local controlled fixtures use a loopback qdisc with the same
rate on combined local traffic; this differs from the ingress-only internet cap.
The repeatable byte-transfer and actual media check is:

```sh
python3 scripts/webkit-testbench/slow-network.py --download-kbps 512 --latency-ms 150 -- \
  scripts/webkit-testbench/webkit-lab.sh --bridge --native-vlc --headless --ephemeral \
  --script scripts/webkit-testbench/scenarios/network.mjs
```

## Actual components and modeled boundaries

| Component | What runs | Remaining difference |
| --- | --- | --- |
| Engine | Pinned Playwright WebKit, actual DOM, frames, events and website media | Linux backend differs from tvOS; Safari UA alone does not grant native HLS |
| Bridge | Extracted `BrowserFrameClickBridgeScript` and current `BrowserFullscreenMediaBridge.js` | WK messages/frames are represented by bindings and document tokens |
| Center | `lab.remote.center(x,y)` calls actual `__browserTVFrameClick` | UIKit pointer motion, gestures and native focus are not emulated |
| Adblock | Pinned app uBO core, parser, scriptlets, domain buckets, cosmetics and procedural engine | Full matcher on Playwright routes differs from converted WK rules plus page API adapters |
| Content worlds | App MAIN/ISOLATED record selection and dependencies | Both lexical bundles execute in page world; named WKContentWorld isolation is unavailable |
| Lists | Bundled uBO and six default AdGuard lists with per-run hashes | TV cache dates, personal filters, disabled lists and trusted/dynamic policies are not copied |
| Handoff | Current single-accepted pause acknowledgement, immediate presentation/start and close ordering | Objective-C/UIKit are modeled; visual TV output and focus need native verification |
| Desktop VLC | Actual CLI window, visible buffering, per-input headers, start position and RC return | Desktop UI is not the app UI; RC has integer-second precision |
| Worker VLC | Actual Linux decoding, HTTP context, 2000 ms cache and frame/clock telemetry | Dummy output is not visible TV evidence; its 15 s readiness watchdog is a stand diagnostic, not an app deadline |
| Cookies | Matching-cookie selection and anonymous cross-origin policy | Installed Linux/desktop APIs can lack TVVLCKit's cookie store; required cookies fail clearly rather than being omitted |
| Storage | Actual browser profile storage, explicit model settings | No app database, NSUserDefaults, history migration or native tab coordinator |
| Workers | Available Playwright routing; service workers blocked with adblock | Native HTTP-worker WK fallback and page/Blob-worker host adapters are not reproduced |

Known host differences are facts, not automatic explanations for failures. When
blocking changes website behavior, identify the exact rule/request or scriptlet
before attributing it to the app or stand. Do not add persistent exceptions merely
to make a test pass. Future native-rule parity can import sanitized output from the
app's real converter; do not invent a replacement converter.

## Repeatable checks

```sh
scripts/webkit-testbench/generate-fixture.sh
scripts/webkit-testbench/webkit-lab.sh --bridge --native-vlc --headless --ephemeral \
  --script scripts/webkit-testbench/scenarios/simple-takeover.mjs
scripts/webkit-testbench/webkit-lab.sh --bridge --native-vlc --headless --ephemeral \
  --script scripts/webkit-testbench/scenarios/interruption.mjs
scripts/webkit-testbench/webkit-lab.sh --bridge --native-vlc --headless --ephemeral \
  --script scripts/webkit-testbench/scenarios/timeout.mjs
```

Fixture generation requires ffmpeg and writes only ignored media. The fixture HTTP
server binds loopback, implements ranges and serves media/HTML, never commands.

The canonical simple scenario checks 0.1 s real advancement, one accepted ack,
presentation before actual decoder readiness, position return, paused mid-close,
manual same-source rearm, Next's last-resort website EOF and a separate actual VLC
EOF, both with trusted HTML ended events.
`scenarios/episode-navigation.mjs` distinguishes adapter and modeled system
dispatch, verifies real Linux decoder output for the replacement source, tests
unavailable Previous with no second action, and covers fullscreen keep/exit.
`scenarios/episode-navigation-guards.mjs` checks no duplicate/fallback after a
player boundary or thrown action, source replacement and iframe detachment,
ambiguous modeled system submission, and loss of foreground during track
acknowledgement. MediaRemote results and foreground transitions remain modeled.
`scenarios/warm-playerjs.mjs` constructs a controlled private PlayerJS capability
while capture is OFF, plays real Blob-backed video, pauses it, switches the
modeled active tab and enables capture before returning to the same document.
It requires actual Linux VLC output without replacing the video or reloading.
`WARM_CAPTURE_START=on` runs the constructor-observed control. This fixture
isolates instance registration; use actual-site evidence for website behavior.
`lifecycle.mjs` is a compatibility alias. The interruption scenario uses an explicit
400 ms pre-acceptance delay to check cancellation/new Play and changed-source
rejection. The timeout scenario stalls the worker's actual HTTP media request and
checks immediate visible model state and paused return after closing the error.
Its diagnostic timeout is not a native-app timeout claim.

A resumed WebKit video can emit `play` and advancing `timeupdate` without promptly
emitting `playing`. The production watch therefore arms from `play` as well. Test
button actions should fire `video.play().catch(...)` without awaiting that promise;
its completion can be delayed until EOF on this backend. Still require real clock
advance and decoded main-video identity; never substitute synthetic media events.

`scenarios/home.mjs` exercises foreground cycles, stale inactive permission,
temporary modal refusal, a lost offer reply, an interruption after the exact
source has paused, and a dropped pause acknowledgement. It requires same-source
decoder output without repeat Play for the injected failures. A modeled Home
interruption must not resume the website until foreground capture permission returns.
`scenarios/denied-start.mjs` denies the media request after acceptance and checks
that a zero-output VLC Ended is treated as a failed start, preserving a paused
website for Back/retry rather than forcing its completion. These injected faults
are controlled evidence, not proof that either caused a user's physical TV issue.

## Actual-site workflow and controls

Open the actual URL and let offers reach the host binding immediately. Autoplay
can occur before the first click; a late click can pause it and invalidate an old
offer. Scroll lazy player sections into view and use their real Play control.
`readyState=0` before Play may simply mean `preload=none`.

Verify main-content identity and duration. A valid MP4 and a VLC picture alone can
be a preroll. Earlier UAKino adblock-OFF trials captured a second video without
establishing main identity; those are not main-video success evidence. Prefer the
actual episode's duration/title/source binding and an advancing clock.

Useful terminal commands:

- `center X Y` uses the production website click path. It refuses to click a hidden
  website while the modeled native player is presented; UIKit focus is unsupported.
- `play-pause` targets VLC when presented, otherwise the website bridge.
- `next` runs the manual episode route; `player-back` closes VLC.
- `inactive`, `active`, `native-status` exercise/inspect the modeled lifecycle.
- `open URL`, `back`, `reload`, `status`, `screenshot`, `inspect`, `quit` control browsing.

The scenario API supports `lab.native.setPage(page)`, `setActive(false/true)`,
`next()`, `previous()` and `close('closed'|'ended')`. Modal occupancy remains modeled. Source
fingerprints identify the code against which a run was performed; review the model
whenever the Objective-C contract changes.

## Evidence and cleanup

Runs stay under ignored `.data/webkit-testbench/runs/<run>/`:

- `environment.json`: versions, actual UA, viewport, source hashes, injection order,
  filter hashes, transport options and explicit capabilities.
- `events.jsonl`: requests/errors, winning blocker rules, frames, every native offer,
  leaf checks/acks, modeled lifecycle, actual decoder/RC timing.
- `vlc-*.private.log`: raw decoder stderr/stdout, potentially containing signed URLs.
  Keep it private; never paste it into tracked docs or public issue/PR comments.

The binding observes every offer; the page message array is capped and may have
lost old entries. Required-cookie failures and execution/IPC failures must be
reported distinctly from successful playback. Stop ineffective paths and retry
only after changed conditions.

Owned decoder processes stop on close; ephemeral context cleanup is bounded before
closing its own browser. Never close, click or navigate the user's live stand during
an independent investigation. Filters download only when absent in ignored cache;
refresh deliberately and compare hashes rather than claiming they match a TV cache.
