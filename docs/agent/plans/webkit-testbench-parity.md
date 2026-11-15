# WebKit testbench parity

## Objective and acceptance

Build a reusable Linux investigation stand close enough to the application to catch
web bridge/host contract failures before another TV trial. The user explicitly
requests a sub-agent and reuse beyond the present capture bug. Real WebKit site
behavior and real Linux libVLC decoding must replace optimistic manual accepted
responses. UIKit/TVVLCKit and native WKContentRuleList remain separate evidence.

Acceptance for the first stage:

1. Read current production bridge and pinned blocker components without maintaining
   a fork. Use one deterministic document-start script and record source hashes.
2. Run actual network blocking, scriptlets/cosmetics and actual libVLC readiness;
   mirror app UA/referrer and cookie selection, failing closed for unavailable APIs.
3. Model check/prepare/leaf ack/decoder/accepted ack/suspend/present/activate and
   modal occupancy during close. Trace every offer instead of capped-array polling.
4. Supply replayable loopback lifecycle/fault scenarios and actual-site evidence.
5. Keep helpers tracked, raw data private, local skill a wrapper, and document gaps.

## Invariants

- No physical TV work, database copying, signing changes, custom HTTP command server,
  native player replacement, adblock whitelist, or invented network source extraction.
- Main-document acknowledgement is insufficient unless the real leaf acknowledged.
- Decoder success requires real fresh displayed/decoded frames and advancing time.
- Modeled state is labeled; it cannot establish UIKit visibility or callback order.
- Required cookies are never silently dropped to obtain a successful stream.
- A failed site run identifies its failed stage; preload/readiness/input failures
  are not app playback failures. Filter/host differences are material evidence.

## Implementation checkpoint, 2026-11-15

Tracked CLI/runtime/adblock/native-host/libVLC worker and scenarios live in
`scripts/webkit-testbench/`. The existing ignored `webkit-testbench` skill delegates
to the tracked runtime and was expanded at the user's request. No duplicate skill.
The [runbook](../WEBKIT_TESTBENCH.md) records commands and actual/model boundaries.

The worker uses a dedicated stdin reader queue to avoid TextIO/select buffering
stranding rapid activate/status/stop commands. The installed Linux libVLC lacks
`libvlc_media_store_cookie`; cookie-free streams are verified, required-cookie
streams return `required-cookie-store-api-unavailable`. Window output exists as
an optional experimental mode but has not been visually verified.

Evidence (raw runs remain ignored):

- `2026-11-15T17-41-08.222Z-e9ddfdc3`: first integrated nested fixture, real decoded
  video, accepted-session inactive/active, completion Next recapture, and deliberate
  early-callback lost recapture. This exposed the gap in the old manual reply stand.
- `2026-11-15T17-48-05.637Z-1134c5a5`: tracked cross-origin lifecycle scenario passed
  after the stdin queue and bounded ephemeral cleanup changes.
- `2026-11-15T17-42-16.690Z-23976076`: actual Teleportal with adblock and app headers:
  episode 92 decoded 854×480 (1.6 s), Next selected actual 93 and its new decoder
  became ready (1.7 s). No manually supplied acceptance or website fullscreen.
- `2026-11-15T17-47-07.035Z-56d5c3bc`: actual UASerials with adblock: initial decode
  640×480 (1.4 s), ten-second native-playing hold, Next and a new ready decoder
  (1.1 s). `RequestIsCurrent=false` while native capture is suspended is expected
  from that exported function's active-permission gate, not itself stale binding.
- `2026-11-15T17-47-01.873Z-efe6cb62`: actual UAKino with adblock: main iframe loaded
  and Play ran, but HTML video remained readyState 0 before any offer. This is not a
  VLC timeout. `2026-11-15T17-48-35.461Z-8a7c67f7` with only adblock disabled passed
  initial capture, ten-second hold, Next and new actual decoder readiness. Its private
  helper mistakenly printed literal `adblock:true`; environment.json correctly
  records disabled. Do not cite that helper label as configuration evidence.

## Remaining work and next edits

- Final interruption scenario passed: `2026-11-15T17-49-42.203Z-4bbb9f58` checks cancelled warmup/new Play, Back/no recapture, one failure rollback and changed-source rejection; injected delay/failure are explicitly labeled. Current source fingerprints are recorded per run.
- Investigate UAKino's unresolved blocker-sensitive pre-offer failure observed on
  the stand. Candidate causes include an app filter/adapter problem, host rule/world
  differences, list state, or a combination. No attribution is established. Trace
  the exact winning request rules and classify whether the app's converted native
  chunks or page fetch/XHR hooks would block the same request. Do not add exceptions
  merely to pass.
- A closer native blocking host should consume a sanitized converted-rule artifact
  from the application's real Swift converter, including format/converter revision,
  list hashes, policy and compiled native chunks. No local Swift converter is available;
  do not replace it with an invented converter. Apply converted rules only to the
  native-resource path; retain full-core semantics where the app actually uses them.
- Add further exact settings/worker/control coverage only against observed need.
  NSUserDefaults, native tab/history coordination, named content worlds and UIKit
  remain unimplemented host differences; use Simulator/device workflows for them.
- Validate optional Linux window output separately. It is neither a UIKit substitute
  nor a reason to claim the tvOS first-frame problem fixed.

Parent owns app capture fixes and final commit/push. This stand stage alone does not
establish that the user's installed TV failures are resolved.

## User-confirmed simple baseline, 2026-11-15

The user confirms the simplified scheme on the visible stand for UAKino, UASerials
and Teleportal, explicitly not TV. Promote it without copying the private capture
implementation: the tracked production bridge owns source association, event-armed
50 ms watches and the 0.1 s actual-advance threshold. The host uses one accepted
pause acknowledgement, immediately presents/starts VLC and observes decoder readiness
as telemetry only. There is no hidden preparation.

The actual desktop transport is tracked in `desktop-vlc.mjs`, with per-input UA,
referrer/start-time options and private RC position/length output. Closing mid-video
returns position paused and rearms manual Play; near-end completion returns HTML
near EOF. Native Next first seeks VLC itself near EOF; real VLC EOF is the single
return path. No `close('next')` or explicit website Next API shortcut is accepted.

Important corrections to earlier evidence:
- UAKino adblock-OFF MP4 capture did not establish main-content identity and may
  have captured preroll. Do not treat those old OFF results as main-video success.
- A controlled actual PlayerJS iframe (same top origin/lists) proved Safari UA forced
  unsupported native HLS on Linux; HLS.js with the same Safari UA and only the native
  preference disabled played the 810 s main video with advancing time. Firefox UA
  is the user's selected stand adaptation; it is not a tvOS app change.
- Actual desktop HTTP capture proved global --http-user-agent did not set Firefox
  headers, while per-input :http-user-agent did. Same media endpoint returned 403
  for VLC UA and 200 for Firefox, with matching cookies/referrer/range controls.
- A resumed WebKit fixture emitted real play/timeupdate while delaying playing until
  EOF. The production bridge now arms on play as well; sampling still rejects seeks
  and requires actual advancement.

Current simple-contract evidence:
- `19-42-22.902Z-52f6bdaf`: canonical production bridge + actual libVLC passes real
  advancement, single acknowledgement, presentation-before-readiness, start/return
  position, paused close, same-source manual replay, actual VLC EOF Next and two
  trusted HTML completions.
- `19-36-26.773Z-0ddbf1ea`: cancellation/new Play and changed-source rejection pass
  with explicit 400 ms pre-acceptance delay.
- `19-36-25.290Z-bab088ce`: actual stalled HTTP worker shows presentation immediately,
  hits the stand diagnostic readiness watchdog after 15.1 s and leaves HTML paused
  after manual close. This is not an app timeout claim.

Final app build/TV observation belongs to the parent stage. Native UIKit behavior
is still unverified here. The private manually controlled stand remains owned by
the user and must not be disturbed by automated regression tests.

Final simple-contract checkpoint:
- `19-45-54.475Z-9f3d4018` repeats the canonical scenario on the final production JS,
  including the fullscreen/metadata gate follow-up; all simple-flow assertions pass.
- `19-45-58.466Z-c30cc55d` verifies an existing website fullscreen plus reloaded
  metadata cannot bypass the real-play threshold (accepted time 0.148 s).
- Actual desktop CLI transport in dummy output also passes start-time/RC return
  after adding RC length handling; no additional VLC window was opened.
- `19-47-56.540Z-cbd55c07` uses the actual Teleportal leaf player in a controlled
  same-origin embed, avoiding the intermittent full-page loader. Initial capture,
  actual libVLC decode, paused return at 12 s and manual same-source recapture pass.
  Next seeks actual VLC near its end; actual VLC EOF returns action `ended` and the
  HTML video reaches its real end: time=duration=2547.96, ended=true, paused=true,
  no media error. The website remains episode 92 and does not start 93 within the
  observation window. Automatic episode advance is therefore not verified by this
  controlled embed; do not report it as a Teleportal Next fix or native-TV success.

No automated test touched the user's manually controlled visible stand. Parent owns
atomic app/stand contract commit and native CI build; all above observations are
Linux engine/decoder evidence plus explicitly modeled UIKit state.
