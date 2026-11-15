# Linux WebKit media testbench

The reusable implementation lives in `scripts/webkit-testbench/`. It reads current
application source on each launch. The local `webkit-testbench` skill delegates to
this implementation; private scenarios must not carry another copy of the bridge.

## Start

```sh
scripts/webkit-testbench/webkit-lab.sh --app --ephemeral https://example.org
```

`--app` enables the production click/media/fullscreen bridge, adblock and an
explicit native host model backed by actual Linux libVLC. It selects the current
application's desktop User-Agent. A 1920×1080 CSS viewport and zoom 1 are defaults;
these are declared test settings, not an emulated Apple TV display. Use a named
`--profile investigation` instead of `--ephemeral` to retain website storage.
Profiles contain personal state and stay ignored. Never reuse a personal profile
for a clean-state test or delete it to fix a failing scenario.

Add `--vlc-window` to request an actual Linux video window, with fullscreen enabled
after readiness. This optional output mode is experimental and has not been
visually verified; default `dummy` output verifies decoding and displayed-picture
statistics without showing video. Audio uses dummy output in either mode. UIKit
presentation, focus, remote control widgets and compositor readiness remain outside
the Linux stand.

For a controlled comparison, use `--bridge --native-vlc` without `--adblock`, or
plain WebKit without these flags. `--bridge` alone retains the observational native
stub; it never silently accepts offers. Do not claim a playback fix from that mode.

## Dependencies

Use the pinned dependency versions; do not upgrade to make a failing site pass.

```sh
npm ci --prefix scripts/webkit-testbench --ignore-scripts --no-audit --no-fund
PLAYWRIGHT_BROWSERS_PATH="$PWD/.data/webkit-testbench/browsers" \
  node scripts/webkit-testbench/node_modules/playwright/cli.js install webkit
python3 -c 'import ctypes.util; print(ctypes.util.find_library("vlc"))'
```

The launcher prefers the ignored local Node installation and can reuse the local
skill's existing Playwright installation. Python uses standard-library ctypes;
no Python VLC package is required. Linux libVLC and WebKit's OS libraries must be
installed separately. Follow the skill's graphical administrative-authorization
workflow if installation is needed. Do not request passwords in chat.

## Actual components and modeled boundaries

| Component | What runs | Remaining difference |
| --- | --- | --- |
| Web engine | Pinned Playwright WebKit, actual website DOM, iframe tree, events and media | Linux media backend and patched WebKit build differ from tvOS |
| Page bridge | Extracted `BrowserFrameClickBridgeScript` plus current `BrowserFullscreenMediaBridge.js` | Native WK message delivery and WKFrameInfo are represented by bindings and per-document tokens |
| Pointer Center | `lab.remote.center(x,y)` invokes the production `__browserTVFrameClick` | UIKit pointer motion, gesture timing and native focus are not emulated |
| Adblock core | Pinned app uBO network/parser, scriptlet library, domain buckets, cosmetics and procedural engine | Playwright routes all request classes through the full matcher; the app uses converted WKContentRuleLists plus fetch/XHR/worker adapters |
| Adblock content worlds | MAIN and ISOLATED record selection and dependency-complete app bundles | Both bundles execute in separate lexical scopes in page world; named WKContentWorld isolation is unavailable |
| Filter sources | Bundled uBO plus the six default AdGuard lists from the app's source URLs | TV cache dates, disabled lists, My Filters and trusted-site/dynamic personal preferences are unknown and are not copied |
| Handoff | Model follows check → prepare → leaf acknowledgement → decoder preparation → accepted acknowledgement → suspend → presentation → activation | Objective-C is not executed; modal occupancy, application lifecycle and animation completion are modeled |
| Decoder | Actual Linux libVLC, 2000 ms cache, initial seek, fresh decoded/displayed frames, video dimensions and advancing clock | Different libVLC build/platform output; dummy output is not evidence of a visible tvOS frame |
| HTTP context | App-policy model for exact document referrer policy, actual app UA, matching website cookies and anonymous cross-origin suppression | Linux libVLC may lack TVVLCKit's cookie-store API; required cookies then fail closed rather than being omitted |
| Storage/settings | Actual browser profile storage and explicit model options | No copied app database, NSUserDefaults, tab coordinator, history migration or device state |
| Workers | Page workers observed through available Playwright routing; service workers blocked in adblock mode | Native HTTP-worker WK rule fallback and page/Blob-worker host adapters are not reproduced |

A full matcher on every routed resource can block requests that the app's converted
native rule subset would not block. This is a material difference, not proof that
the app's blocker is broken. A future parity stage can import a sanitized artifact
of the app's native converted rules and evaluate those rules for native resource
classes, while retaining the full matcher for the app's page API paths. Do not
invent a replacement converter, add a whitelist to obtain a green test, or call
this stand equivalent to WKContentRuleList.

## Reproducible lifecycle checks

Generate an ignored, decoded WebM fixture (requires ffmpeg), then run the scenarios:

```sh
scripts/webkit-testbench/generate-fixture.sh
scripts/webkit-testbench/webkit-lab.sh --bridge --native-vlc --headless --ephemeral \
  --script scripts/webkit-testbench/scenarios/lifecycle.mjs
scripts/webkit-testbench/webkit-lab.sh --bridge --native-vlc --headless --ephemeral \
  --script scripts/webkit-testbench/scenarios/interruption.mjs
```

The fixture server binds only to loopback, implements HTTP byte ranges, and closes
on scenario exit. It serves media/HTML, not commands. Decoder control uses private
stdin/stdout JSON; no diagnostic HTTP endpoint or debugger port is exposed.

`lifecycle.mjs` checks a cross-origin iframe pause acknowledgement, actual libVLC
readiness, accepted-session inactive/active survival and Next recapture after
modeled dismissal completion. It deliberately replays the old early-callback
ordering while `presented=true` and checks the resulting lost recapture. That
negative result demonstrates the host-contract race, not UIKit callback timing.

`interruption.mjs` checks cancelled preparation followed by new Play of the same
source, Back without a recapture loop, one preparation-failure rollback and a
changed source rejected before acceptance. Its 400 ms startup delay and explicit
failure are fault injections, labeled in results; other decoder starts use libVLC.

The runtime API also supports `lab.native.setPage(page)` for tab changes,
`setActive(false/true)` for foreground changes and `close('closed'|'next'|'ended')`.
Use `nativeVLC:{callbackPhase:'viewDidDisappear'}` or
`invalidateAcceptedOnResign:true` only to replay known old contract behavior.
The current default is completion delivery and preservation of accepted sessions.
The model must be reviewed when the Objective-C contract changes; stored source
fingerprints identify the implementation against which a run was performed.

## Actual-site checks

Open the actual URL in `--app --ephemeral` mode. Let automatic offers reach the host
binding immediately; do not click then accept the last entry in the capped message
array. Sites can autoplay before the first click. A late click may pause an already
playing video and make that old offer invalid.

Scroll lazy player sections into view and activate the actual website Play control.
`readyState=0` before Play can be normal for `preload=none`; it is not decoder failure.
Wait for `native-host: activated` with actual decoder-ready statistics. Keep it
playing long enough to catch source changes before Next. Submit Next through the
host, then require the website's real new item/source and a new actual decoder-ready
record. A returned top-document boolean or changed playlist index alone is not enough.

Useful terminal commands:

- `center X Y`, `play-pause`: invoke production page bridge functions.
- `next`, `player-back`: close the modeled native player using the relevant action.
- `inactive`, `active`, `native-status`: exercise and inspect the host lifecycle.
- `open URL`, `back`, `reload`, `status`, `screenshot`, `inspect`, `quit`: browser controls.

Mouse clicks in the visible browser are real Linux WebKit input. Use `center X Y`
when testing the application's synthetic Center path; do not call them interchangeable.
Native transport commands in this stand are host API calls, not UIKit focus tests.

## Evidence and cleanup

All runs live under ignored `.data/webkit-testbench/runs/<run>/`:

- `environment.json`: browser/Playwright versions, actual UA, viewport, source
  fingerprints, injection order, filter content hashes and explicit capabilities.
- `events.jsonl`: real requests/errors, adblock decisions, frame lifecycle, native
  offers, per-frame request checks/responses/acks, modeled lifecycle and numeric
  decoder state/readiness. The binding observes every offer; the page array is
  capped and may have lost old entries.
- `vlc-*.private.log`: raw libVLC stderr, potentially containing signed media URLs.
  Keep it ignored. Do not paste it into tracked docs or public issue/PR comments.

The decoder process is stopped on close, and ephemeral context cleanup has a bounded
wait before closing its own browser. Do not terminate a user's unrelated browser or
reuse an ineffective path without changed conditions. Missing IPC permission is an
execution failure; retry only with the appropriate authorized sandbox permission.

Filters download only when absent under ignored `.data/webkit-testbench/filters/`.
Each run records content hashes; it does not silently refresh existing snapshots.
Refresh a research snapshot deliberately and record the changed hashes. There is no
claim that downloaded lists match a particular physical TV's cache.
