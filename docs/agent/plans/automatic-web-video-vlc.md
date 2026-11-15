# Automatic website video discovery and VLC handoff

Date: 2026-11-10. Branch: `research/automatic-web-video-vlc`, based on `70f74eb`.
Status: initial source research followed by the opt-in single-source experiment
recorded in the 2026-11-15 checkpoint below. Default iframe playback is unchanged.

## User outcome and current decision

The primary feature is the accidental discovery retained on 2026-10-11: detect a
website's video stream automatically, including inside cross-origin iframes,
and play it through shared VLC while keeping episode selection working. Dynamic
range compression is a secondary VLC capability, not the reason to limit this
investigation to torrents or main-document video.

The user selected completing the isolated Debug compressor prototype plus a
detailed website-integration plan in this branch. The user specifically asked
about the other saved examples, not only the custom Teleportal/Starlight route.
Do not reinstate the reverted iframe-to-VLC experiment as a side effect of this
research. Preserve production website playback until the new path is validated.

Automatic discovery here means reading an available HTTP(S) URL from the media
element in its own document. It is not universal network interception or a
decoder for Blob/MSE/DRM. The previous fullscreen hook demonstrated discovery;
it did not establish general authentication or episode-lifecycle compatibility.

## Evidence on the other examples

Use anonymized A/B/C/D identifiers from development history in shared notes.
Private page copies and media URL configurations stay ignored. The observations
below are static source findings, not current tvOS playback results.

| Example | Evidence inspected | Episode owner and integration consequence |
| --- | --- | --- |
| A | Saved `site1.html`; freshly downloaded outer `playlist.js` / `fullplaylist.js`; public iframe document | PlayerJS is configured with one media source and hidden episode buttons. The **outer host** owns the multi-episode list. It exposes `switchToNextEpisode()` / `switchToPreviousEpisode()`. Its tracker consumes `time`, `pause` and **`end`**, then shows a cancellable countdown respecting `pl_autonext`. It can navigate to the next season's page. Calling only PlayerJS's internal `next` would address the wrong playlist. |
| B | Saved `site2.html`, freshly downloaded current host HTML and original iframe URL | The current host still references the saved embed path, but retrieving that iframe produces a short nginx "404 Not Found" HTML body, not a player. No stream or lifecycle contract can be established from it. This is an unavailable example, not proof that the site or player family is incompatible. Stop this retrieval path until conditions change. |
| C | Saved outer `site3.html`, saved iframe/PlayerJS sources and prior Safari observations | The outer host consumes **`finish`** and **`next`**, selects an adjacent playlist LI within the same `data-id` group and runs its delayed `autoplayer()`. `PlayerNextCustom()` contains the same next-selection path. It navigates the existing iframe. The failed VLC experiment and unbuilt draft are recorded in `iframe-vlc-investigation.md`. |
| D | Saved `site4.html` plus the public current `uasplayer/assets/index.js` bundle | The outer **`player-control` web component** owns selection. `nextEpisode(true)` advances its dropdown through episodes/seasons and sets an autoplay request. **`ended`** triggers that route only when its `autoswitch` preference permits it. The active iframe is inside an **open shadow root**. The component polls **`tortuga:getInfo`**, correlates replies by source/requestId and emits change events with the returned state. Replacing the renderer without bridging that state would leave site progress stale. |
| Starlight / Teleportal | Current bridge, `teleportal-player.md`, development history | Starlight recognition/title/Next are not hostname-gated. Teleportal supplies the season catalog for missing Previous sources and canonical page URL mapping. 2.21.9 has scoped user confirmation on Teleportal; it is not evidence for another host or for Starlight playing through VLC. Keep it as a regression target, not a shortcut around A/C/D integration. |

This reveals an important distinction: A and C can embed the same player family
while using different completion events and different outer playlists. A single
"PlayerJS adapter" or generic Media Session next command cannot cover both.

### Linux WebKit observations using the user-provided stand

Use the local `webkit-testbench` skill with ephemeral profiles. This is
Playwright WebKit on Linux, not tvOS or VLC. The inspected environment reports
Playwright 1.65.0 / browser 27.2; the production bridge fingerprint is
`f14b28a2c7fb507923111cdaef8b033e3460baab94da024869261c803d610be9`.

- A's first passive snapshot caught a document still loading and did not acquire
  its playlist functions or a video. No playback or transition was established.
- C without injection exposed `PlayerNextCustom` and an iframe video with empty
  source, readyState 0. With the production bridge, the helper was present in
  all three observed frames, but no visible video box or active playlist LI was
  acquired. No Play click was delivered. One direct `PlayerNextCustom()`
  submission produced no selected-episode change; the page logged a null
  `playerfr` access. Calling a defined function before its asynchronous playlist
  is ready was an insufficient diagnostic. Stop that interaction path until
  target readiness is established; do not attribute this to injection or claim
  a playback/Next regression from these different ephemeral sessions.
- D with and without injection instantiated `player-control`, a callable
  `nextEpisode`, two component data entries and two open shadow roots. The bridge
  was present in every observed frame. No video element/source appeared during
  these passive observations; no Next or completion command was sent there.
- The stand originally omitted frame-lifetime logs. With the user's permission,
  add stable run-local frame IDs, cached parent IDs and document generations to
  frame lifecycle events and native-stub messages. The D bridge run recorded
  frame-existing=1, attached=4, navigated=5, detached=1. This verifies event
  collection, not a successful episode transition. Runtime syntax inspection
  and the skill structure validator passed.

Private scripts: `.data/webkit-testbench/inspect-media-owners.mjs` (passive
inventory) and `explore-site-c.mjs` (the unsuccessful Play/Next investigation).
Evidence stays under `.data/webkit-testbench/runs/`; C's interaction run is
`2026-11-10T18-33-34.376Z-ad21dd77`, D's instrumented run is
`2026-11-10T18-36-12.786Z-447e610b`. No successful source acquisition, native
takeover or natural EOF transition was established by these runs.

### Reproducible local sources

- Reuse `.data/site1.html` through `site4.html` and
  `.data/site3-player-debug.html` / `site3-playerjs-unpacked-debug.js` without
  committing their page content or signed source URLs.
- New public downloads are ignored under `.references/web-video-interception/`:
  `site-a-playlist.js`, `site-a-fullplaylist.js`, `site-a-frame.html`,
  `site-b-frame.html`, `site-b-host-current.html`, `site-d-player.js`.
- A's source entry points are the outer page's `/playlist/playlist.js` and
  `/playlist/fullplaylist.js`. Inspect `startTracking`, its end/countdown path,
  `_playerCmd`, `_playNext` and both `switchTo...Episode` functions. The code
  explicitly distinguishes iframe **load** from the old document's ready reply.
- A playlist SHA-256:
  `802507575787d8942c978390b6b0077d814b046144e893b74f3cef9ad90b7c54`;
  fullplaylist SHA-256:
  `570efcc8d81459b6cf09898ee30659007627146884eb87217c6b581cfd7789e5`.
- D bundle SHA-256:
  `8088931f10e9a8861b0a893d524d8ab75d037d658250967d6a07999145ec64b4`.
  Search `nextEpisode`, `case"ended"`, `_setUrl`, `_requestMessage`,
  `_getValueToSend` and `customElements.define("player-control"`.
- PlayerJS's documented [commands](https://playerjs.com/docs/en=apicommands)
  distinguish internal playlist `next`/`prev` from media play/seek.
  Its [events](https://playerjs.com/docs/en=api) distinguish `end` from `finish`.
  The actual host consumer decides which event matters. Documentation alone
  does not establish which options a particular embedded build enables.

## Proposed architecture

Keep three responsibilities separate: media discovery inside each frame,
session ownership in the top document/native coordinator, and a website-owner
adapter for episode selection/completion. Reuse shared VLC and its native
controls. Do not add another player or a custom diagnostic HTTP service.

### Discovery and frame lifetime

- Add a separate all-frame helper at document start. Observe media metadata,
  source changes and the active user-requested fullscreen scope. Use the
  existing selected video/frame chain; do not take over previews, ads or another
  background video merely because a URL exists. Default trigger is the user's
  fullscreen request, matching the original accidental path.
- Offers include `contentKind: main | advertisement | unknown`, supplied only
  by an inspected source/player contract. Automatic handoff requires `main`;
  unknown classification stays in WebKit. Do not identify main content by URL
  suffix, duration or visibility alone. Stage 1 must establish this classification
  for each example before stage 2 is enabled there.
- Select the actual video first; resolve `currentSrc`, `src`, then source
  children. Only bounded HTTP(S) candidates qualify. Reject active DRM and keep
  Blob/MSE in WebKit unless a separately inspected adapter exposes a usable
  original manifest. Do not add broad fetch/XHR interception in the first stage.
- Observe iframe insertion/replacement and navigation, including open shadow
  roots. Parent observers survive child navigation. A new child document sends
  a fresh ready/offer handshake; do not depend on an interval inside the old
  document, URL inequality, or WindowProxy inequality.
- A source gets a new generation when its media identity changes, even if the
  URL repeats. Keep an accepted session independent of `fullscreenTarget`, the
  native controls' visibility, and the currently selected child document.

### Session coordinator and minimum interfaces

Introduce a `BrowserWebVideoSession` owned by the presenting browser controller;
it must survive VLC media replacement without presenting a second controller.
Keep the existing top-document VLC path compatible and torrent navigation
independent. The future JS/native messages carry:

```text
sessionID, topDocumentGeneration, frameDocumentID, sourceGeneration,
commandID, kind, bounded payload

kind: ready | offer | commandResult | sourceChanged | detached
native commands: prepare | accept | next | previous | snapshot | complete | release
command result: unsupported | submitted | boundary | failed
```

These are internal interfaces, not persistent storage or public API. Offers
contain a source descriptor, title, position/volume/mute and document/referrer
context. Snapshots contain native playback state and position/duration. Source
IDs and credentials remain memory-only; diagnostics emit numeric generations
and fixed reason codes, not stream URLs or website payloads.

- Authenticate every hop against the active parent/child relationship and the
  session token. Register the actual leaf's `WKScriptMessage.frameInfo` and its
  per-document nonce with native code; correlate top-owner authorization with
  that registration. Derive its document origin/referrer from native frame
  metadata rather than trusting a child-supplied URL string. A new registration
  invalidates the old leaf for that slot.
- Reject stale cookie callbacks, offers, source replies and EOF events after
  any generation change. Tab change, main-document navigation, web-view
  replacement, explicit exit or missing owner cancels the session. An iframe
  replacement under the same owner instead starts reattachment.
- Use states `discovering -> preparing -> native -> switching`, with terminal
  `released`/`cancelled` and website fallback. Serialize commands. "Submitted"
  means a website action was invoked; only a valid new source offer establishes
  a transition. An ambiguous reply/timeout must never trigger a second fallback
  Next command.
- Keep observation alive for the session's lifetime. Each requested transition
  has a bounded 15-second wait for a new valid candidate; timeout returns control
  to the site without repeating the action. This timeout does not destroy the
  persistent frame observer.

### Renderer transfer and fallback

- Prepare VLC muted while the current website video remains usable. Accept
  only after `Playing` plus advancing native time, within a 15-second preparation
  deadline. Resample the website position, align VLC, then pause that exact
  source and restore its intended native volume/mute. Failure leaves/reveals
  website playback. Do not repeat the old immediate `accepted` before startup.
- Preserve the web fullscreen/owner chain while VLC is presented. The current
  `accepted -> __browserTVExitFullscreen()` teardown cannot be reused for iframe
  sessions. Native renderer ownership must be independent of visual fullscreen
  controls and prevent an unsafe deferred Ad Block reload of the active page.
- During native ownership pause duplicate website playback only for the owned
  source; a newly selected source is a new candidate, not the old media restarting.
  Revalidate User-Agent, policy-aware Referer and URL-scoped cookies on every
  media change using the existing native helpers. Never send HTTPOnly cookies
  into JavaScript, persist signed media URLs or invent arbitrary Authorization
  forwarding support.
- On explicit return, restore the current episode's timestamp and audio state
  to its live website media element. A stale/detached element must never be
  modified. If automatic web resumption is rejected, leave the site's Play
  available; do not mute-and-retry or manufacture user activation.

## Episode-owner adapters

Adapters implement `recognize`, `capabilities`, `next`, `previous`, `complete`,
`snapshot` and `release`. Recognition must bind the active source frame to the
actual playlist owner and inspect its relevant functions/DOM contract; matching
one method name or a player brand is insufficient. Prefer the observed site's
own actions and settings, not an app-created episode list.

| Owner | Manual transport | Native EOF and state |
| --- | --- | --- |
| A host playlist | Invoke its existing `switchToNextEpisode` / `switchToPreviousEpisode` once after verifying the current active LI and owned iframe. Preserve its handlers and visible-list rules. | From the still-live owned leaf, relay one `end` to the website's existing consumer, with native `time`/`duration` and pause updates while VLC owns playback. Preserve the host countdown, cancellation, `pl_autonext`, saves and its ready/load behavior. Never bypass the countdown by also calling Next. |
| C host playlist | Use `PlayerNextCustom` for Next. Previous activates only the verified adjacent LI through its original click handler and the site's existing autoplay function; stop at the same group boundary. | Relay one `finish` through the owned leaf to the observed host consumer, which selects the next episode itself. Do not additionally invoke `PlayerNextCustom`. Return real native progress through the observed `time` shape. Reattach after iframe navigation before accepting the next offer. |
| D component | Use the active component's `nextEpisode(true)` and its own selection/update events. Its bundle has no demonstrated public Previous equivalent: keep native Previous unavailable until a matching source route is inspected. | Relay one `ended` from the owned leaf so the component applies `autoswitch`. During native ownership answer its exact correlated `tortuga:getInfo` request through a narrowly scoped leaf protocol adapter, preserving source/season/episode metadata and substituting native progress only. First inspect the real leaf's reply shape; do not guess it from the host's method name. |
| Other player, recognized Media Session or internal playlist | Advertise only demonstrated capabilities. Prefer a confirmed outer owner over the inner player's internal playlist. | A Next handler alone does not establish natural EOF/autoplay semantics. Without a demonstrated completion contract, retain the website renderer for automatic takeover. Discovery can still identify its direct stream. |

The leaf protocol adapter must suppress duplicate/stale progress and completion
responses from the paused renderer only while this session owns the matching
source. Keep unrelated website messages untouched. Do not globally replace
HTMLMediaElement properties, fabricate DOM `ended`, or seek/play its last
milliseconds to provoke EOF: that hypothesis already failed and triggered
autoplay/audio problems in the retained history.

Consume completion once per source generation. Manual Next and EOF racing with
it share the transition latch: one site action, one new episode. VLC's combined
End/Next control must send one semantic Next for website sessions; do not perform
near-end seeking followed by a second command to the website.

A's countdown lives in website DOM and includes real controls. Expose the
existing website fullscreen while it is shown, keeping the logical takeover
session armed, and re-present shared VLC only when a newly selected candidate is
ready. Do not copy the countdown into native UI or leave its Cancel hidden behind
VLC. Main-document season navigation cancels the old session and returns to
ordinary page behavior; cross-page automatic reentry is outside the first stage.

## Implementation stages and acceptance gates

1. **Discovery only, Debug opt-in.** Add the helper and coordinator without
   changing the renderer. Record numeric candidate/frame generations on A/C/D.
   Confirm a nested frame, open-shadow iframe and document replacement can offer
   a source; reject unrelated video/ad candidates, stale documents, Blob and DRM.
2. **Single-source handoff/fallback.** Add muted preparation, position/audio
   transfer and reverse handoff using shared VLC. Test startup failure, expired
   URL, active-tab change, cancellation and return to the same website source.
   Unrecognized lifecycle owners remain in WebKit by default.
3. **C transitions.** Implement the retained host contract and durable parent/new
   child handshake. Observe manual Next, Previous and natural EOF separately;
   confirm one advancement, group boundaries, the active-source title and any
   URL changes made by the website itself, and website
   fallback. The unbuilt old draft is reference material, not a solution to merge.
4. **A transitions and countdown.** Use its own host commands, progress consumer
   and completion countdown. Observe replacement of the iframe element (manual
   selection), navigation of the existing iframe (autonext), disabled autonext,
   cancel, last episode and return to the website. Preserve its existing resume
   and save mechanisms, rather than adding app episode preferences.
5. **D transitions/state.** Inspect the live leaf's media/protocol contract first,
   then implement its correlated info replies and completion route. Observe
   autoswitch ON/OFF, dropdown selection, episode/season changes, shadow-root
   reattachment and stored progress. Missing leaf evidence keeps D in discovery
   mode; do not claim takeover support from the host bundle alone.
6. **Regression and optional compression.** Recheck main-document VLC, torrents,
   website controls, Teleportal/Starlight and unsupported-player fallback. Add
   compression to successful handoffs through `BrowserVLCCreatePlayer` only after
   its separate runtime/audio checks. Publish capability claims and version the
   user-facing feature only after the corresponding behavior is delivered.

Native builds and Simulator/TV interaction checks require a new request. The
user supplied the Linux WebKit stand and authorized repairing it during this
investigation; its bounded observations are recorded above. Use Simulator by
default and Safari Web Inspector for actual tvOS frame/player evidence;
physical-TV work needs permission. Synthetic DOM checks may verify message/session guards, but
cannot establish VLC playback, WebKit autoplay permission or real site switching.
Record all three independently: discovered URL, confirmed native playback, and
confirmed website transition. No native build, device interaction, app test,
release, remote push or successful new iframe/VLC transition is claimed here.

## Resume checkpoint

Research and this plan are the completed website deliverable for this branch.
No browser JS, iframe-routing handler, site adapter or website player behavior
was changed. Implement discovery stage 1 only after a new implementation request;
the first concrete edits belong in a new all-frame helper and session coordinator,
with bounded Debug wiring beside the current main-document VLC handler. Keep the
already working media bridge as the fallback. Updated/live B evidence and D's
actual leaf reply/media-source contract are the remaining source prerequisites.


## 2026-11-15 — Authorized single-source trial implementation

The user explicitly requested a version to try automatic capture and reminded us
that the old fullscreen hook had already discovered a stream accidentally. This
supersedes the earlier research-only scope. Implement a bounded single-source
trial rather than presenting planning as a playback feature.

Implemented in 2.22.0 development source:

- An OFF-by-default native ON/OFF option under Debug options, available in Debug
  and Release develop IPAs named `tvOSofaBrowse Test`. The name check survives
  signing-time bundle-ID rewriting; ordinary Release keeps website iframe playback.
- Reuse the existing all-frame fullscreen hook and directVideoSource helper.
  Offer the selected fullscreen video's HTTP(S) source; reject Blob/MSE,
  detected mediaKeys and credential-bearing URLs. Retry a not-yet-loaded source
  on loadedmetadata, once per fullscreen entry. This is an explicit experimental
  fullscreen selection, not a validated main-content/ad-classification adapter.
- Receive child offers directly through WKScriptMessage, validate the document
  against native WKFrameInfo.request and retain that frame for bounded evaluation
  in WKContentWorld.pageWorld. Never redirect a failed child evaluation to top.
  Check current source, mediaKeys, connection, fullscreen scope and top generation.
- Prepare shared VLC muted. Require Playing plus advancing time after initial
  seek; resample the website position when accepting, pause only that source,
  seek VLC if supported, then restore audio. Error/15-second timeout closes VLC.
- Keep the iframe's fullscreen scope alive. Back returns position/audio and
  attempts website Play only on the same still-live source. Source/navigation
  changes invalidate replies. Cookie/UA/referrer selection uses existing helpers.

This deliberately does not implement session continuation, Next/Previous,
natural-EOF forwarding, owner classification or D's unknown leaf protocol.
Choose subsequent episodes on the site. The earlier six stages remain the full
integration roadmap, not claims of delivered capabilities. There is no global
fetch/XHR interception or custom diagnostic endpoint.

Validation: JavaScript syntax and diff/source inspection only. No application
tests or native build requested/executed in this implementation turn; local Linux
has no Xcode. A future CI Release build is required before installation. A Linux
WebKit stub cannot verify native frame evaluation, UIKit, VLC readiness or audio.
User acceptance: enable badge; start a known iframe video; enter fullscreen;
observe VLC playback/audio; press Back and observe the original source position;
retry after exiting fullscreen; disable badge and confirm website behavior.
Also observe unreachable/expired source fallback and unsupported Blob/MSE/DRM.
No such observations have yet been recorded for this implementation.

Next implementation work after trial evidence: correct actual startup/frame
compatibility failures first; add persistent owner/session transitions separately.


### Trial feedback: black fullscreen and Back, 2026-11-15

The user reports black fullscreen and Back not returning on the reported website
(uakinobest in conversation); the screen's renderer and exact page are not yet
established. Asked whether VLC/Audio/Subtitles or website controls were visible,
and for the exact page. No device or website reproduction evidence is available.

Source inspection found host Menu routing consulted the retained website
fullscreen before dismissing visible VLC. Fix that ordering and add a native
Menu recognizer on VLC. JS exit restores each ancestor's iframe layout immediately
while sending the child exit, rather than awaiting acknowledgement. Closing or
rejecting experimental capture also exits parent fullscreen, even if the leaf
navigated. Require hasVideoOut and nonzero videoSize as well as advancing time
before accepting/pause; these checks do not prove actual decoded pixels were
visible. Add a separate 15-second dispatch deadline and keep the startup header
visible. Identify native versus website playback with VLC/Website title prefixes.

Validation is source review, production-bridge extraction/JavaScript syntax and
diff checks only. No native build, TV action or real-site test. This repairs
specific exit/readiness gaps; it does not establish the cause of the user's black
picture or prove playback compatibility. Next: obtain exact page/renderer report,
then a requested build and observed Back, timeout and picture/audio checks.


### Recover the original accidental entry point, 2026-11-15

The user reports VLC still does not capture and explicitly requests Git history
research. Inspect committed `7416ee4` (shared VLC implementation, 2026-10-11),
`45862ce` (iframe rollback) and the retained unbuilt draft separately. The actual
old committed bridge had two entries: fullscreen AND Center on controlled video.
`__browserTVOpenControlledVideo` admitted `<video controls>` in child documents;
`45862ce` later restricted it to top. The new trial removed the top restriction
from `requestVLCFullscreen` but accidentally left this controlled-click restriction
intact. This is a proven source difference, not a proved cause on the user's TV.

Restore the controlled-video entry for child documents only when the experiment
is enabled. Native provides that flag at document start; validated parent/child
messages propagate it through existing/open-shadow iframe trees. Native menu
changes broadcast immediately to the active page; newly loaded child documents
request current configuration. Hidden tabs may receive configuration but native
playback offers remain gated by owner.window and the native preference. Keep the
existing top-document controlled-video behavior. Detected mediaKeys still reject.
Add numeric offer/document-mismatch diagnostics without recording source URLs.

The old offer delivery used iframe -> validated parent chain -> top native handler;
the new trial uses direct native WKFrameInfo and frame-bound evaluation. Do not
remove native URL validation or revert to parent-supplied document context without
evidence that this stage rejects a real offer. The retained draft added owner and
continuation code but was never built; do not confuse it with the committed old
entry point. No Next/EOF experiment is restored by this fix.

Validation: current production bridge extraction/JavaScript syntax and diff/source
review only. No app tests, native build or live-site/TV reproduction. Next user
trial: enable the experiment, press Center on the already playing controlled video
inside the iframe, then separately try its fullscreen button; report whether the
VLC header ever appears. If not, inspect the numeric offer/URL-validation stage.


### Installed-build identification, 2026-11-15

User reports the controlled-click attempt also did not capture, but the installed
build is not established. Add a visible menu footer with version, unique develop
run.attempt and the actual CI merge checkout SHA. Obtain that identity in the
next user observation before attributing a failure to a specific fix. The Xcode
metadata output uses existing GITHUB_SHA environment data; no workflow changes.
Capture remains unverified and unresolved. Do not call the historical entry
repair a successful site fix without observed URL/native/video evidence.


## 2026-11-15 — Live historical comparison, before another trial push

The user now requires meaningful stand evidence before another media trial push
or TV loop, and specifically asks what unrelated work caused the accidental
capture. Root instructions record that constraint. No application changes or
pushes were made in this investigation.

Historical context: the shared-VLC implementation was added while replacing the
separate native web player and making the ordinary MDN controlled-video demo work
with the remote. The generic enterFullscreen hook was injected in all frames.
During later Ad Block work the user noticed iframe playback entering the native
path. Commit 7416ee4 (merged as Volume control fix #13) contains that generic
implementation; its parent lacks requestVLCFullscreen. 45862ce later removes
child routing. The controlled-video Center entry is another old entry, not proof
that it caused this site's original accidental capture.

Open the actual saved Example C canonical URL on the network, not saved HTML.
The saved file supplied only the URL. Live ordinary WebKit initially showed no
playlist/playerfr; scrolling .players-section into view caused lazy loading:
440 playlist items, one active item, playerfr and an HTTP(S) video source appeared.
The video uses custom PlayerJS controls and controls=false. Ordinary Play on two
different voice sources produced readyState=0, video error code 4 and the site's
not found banner on Linux. This does not disprove the user's working TV website
playback or block source discovery; decoding is a separate backend observation.

Current production bridge, with only the native experiment boolean modeled ON,
was injected at document start. An actual mouse click on the website fullscreen
icon produced exactly one child-frame vlcRequest whose HTTPS URL equals the
live video's URL and whose documentURL equals that leaf's location. Main had no
vlcRequest. This confirms JS discovery and submission, not native receipt.

Extract the complete old bridge from 7416ee4 unchanged, combining its Objective-C
all-frame template with its original media script. In a fresh visible WebKit
context on the same live page, scroll, wait for the actual iframe/source, then
click the same fullscreen icon. Exactly one vlcRequest appears in the MAIN
frame; sourceMatchesRealVideo=true and leafDocumentDifferent=true. No request
payload, accepted reply, native player or successful VLC playback was fabricated.
This establishes the original iframe -> parent chain -> top native-entry route.
The new direct-child/native-frame route differs materially from that old path.
Do not claim the Center fix restored the complete original behavior or that this
comparison proves which native condition currently rejects the request.

Private evidence:
- baseline: .data/webkit-testbench/runs/2026-11-15T13-20-20.421Z-5db37ca8/
- current bridge: .data/webkit-testbench/runs/2026-11-15T13-26-59.311Z-94affb41/
- original bridge: .data/webkit-testbench/runs/2026-11-15T13-31-25.776Z-8fe24872/
  capture-summary.json records the exact URL-equality result without URLs.
- private live-capture-driver.mjs has plain/bridge/old modes and in-process stdin
  control; capture-setting.js only supplies the native boolean, not acceptance.
  prepare-historical-bridge.mjs pins 7416ee4 and verifies template syntax.

Resume: inspect native receipt/config/documentURL/frame-evaluation conditions
against the proven top-frame historical route. Preserve the native URL/cookie
context checks; do not simply trust arbitrary parent-provided media context.
A future transport correction must again be exercised on the actual live page
before pushing. Native tvOS/VLC remains unverified; no physical-TV authorization.
The visible old-bridge browser remains available via exec session 48939 if alive.
Browser interaction through Node REPL was unavailable (no process global); the
ordinary Node in-process driver works. Git extraction in Node required shell
escalation after EPERM; do not repeat the sandboxed preparation path.


## 2026-11-15 — Restore main-document relay and acknowledged handoff

Implemented the 7416ee4 transport shape: leaf fullscreen offers travel through
selected fullscreen frames to the main document; native replies return through
that stored chain. Native no longer evaluates experimental replies in WKFrameInfo.
The explicit native experiment gate remains mandatory. Each hop checks the
shared bridge secret and exact selected child window; the first parent also
checks the leaf document origin against MessageEvent.origin. Native validates
HTTP(S), host, lengths and absence of URL credentials, retains the main-document
request/generation guard, and continues filtering cookies against the media URL.
A relayed leaf document URL intentionally differs from the native main request;
requiring their equality would reject this historical route. This is page-world
bridge validation, not native attestation of the leaf URL.

Acceptance now has a separate acknowledgement: the original video validates its
source/session, pauses, and returns its current time through the chain. Native
polls the main-document result at 50 ms intervals against a two-second deadline and
activates VLC audio only after a positive reply. Rejection/closure follows the
stored route; parent layout cleanup remains independent of a surviving leaf.

Evidence: current production bridge on the actual UAKino page emitted one main
frame native offer, with URL exactly equal to the actual video source and context
exactly equal to the leaf document URL; the actual PlayerJS video has controls=false.
The bench explicitly simulated the native accepted/closed replies AFTER discovery.
Acceptance first returned pending, then accepted=true after one observed call to
the real video's pause method. Closed restored time=7, volume approximately 0.4,
and muted=true. Reaccepting the deleted session returned false. Linux playback
was not used as an acceptance criterion and native VLC was not launched.

A separate supplied fixture with two nested iframe hops passed relay, acceptance
acknowledgement, close restoration, deleted-session rejection, changed-source
rejection, and experiment-OFF suppression. Fixture network content and native
replies are simulated. Private evidence/scripts:
.data/webkit-testbench/runs/2026-11-15T13-40-44.376Z-de92573a/ and
.data/webkit-testbench/relay-check.mjs. Bridge extraction also compiled the full
injected script, and git diff --check passed. No tvOS build or native VLC/device
verification was performed on Linux. Keep version 2.22.0 unreleased; CI supplies
a fresh technical build number and revision. Next observation required is whether
the installed native build receives this main-frame offer and opens VLC.

User follow-up after successful develop Build 10.1 (source 688d411): capture
works on TV. The capture acceptance criterion is now user-confirmed. Playback
continuity, audio and Back restoration still need separate observations; do not
extend this confirmation to episode transitions or general site compatibility.

## 2026-11-15 — Follow-up: startup visibility, episode completion, labels

User reports capture works in Build 10.1, but transition shows approximately five
seconds of black, End/Next stops at EOF in fullscreen until Back, and VLC/Website
identification prefixes are no longer wanted.

Acceptance criteria:
- Keep website video visible while muted VLC prepares; shorten deliberate web
  buffering/readiness polling without weakening video-output/leaf-ack checks.
- Experimental End/Next and natural VLC EOF dismiss native playback and return
  near-end playback to the same website source outside fullscreen. Let the site's
  real ended handler own episode selection; do not synthesize ended events or
  scrape a next media URL. Ordinary direct-video replay and torrents stay intact.
- Remove VLC/Website title prefixes and startup branding; keep useful titles.
- Exercise production JS on the actual UAKino page plus an actual decoded media
  fixture for natural ended behavior before push. Distinguish any supplied media
  or simulated native replies from the site's own code and actual TV playback.

Source observation: UAKino's current top page listens for the iframe PlayerJS
`finish` event and clicks the next item in the same data-id group, followed by its
own delayed autoplay. `PlayerNextCustom` uses that same selection path. The current
native VLC code does not notify or resume this lifecycle at EOF. Native startup
uses network-caching=3000 and one-second progress polling.


Implementation checkpoint:
- Use over-fullscreen native presentation with a transparent root and an attached
  alpha-zero VLC drawable while preparing; reveal the drawable after the existing
  video-output, advancing-time and leaf-ack checks. Keep the website underneath.
- Reduce experimental web caching from 3000 to 500 ms; retain torrent/direct-main
  cache behavior. Poll readiness every 100 ms during preparation, returning to
  one-second progress updates after acceptance. Avoid a second seek for <=1 s drift.
- Add experimental-only returnWebVideoOnEnd and a finished close reason. Both
  End/Next and VLC EOF dismiss once and send ended through the existing reply
  chain; parent fullscreen cleanup remains independent. The leaf restores audio,
  seeks to duration minus 0.25 s and plays. Its real ended event belongs to the site.
  No PlayerJS/UAKino adapter, source extraction, synthetic ended event or forced
  next-source capture was added. User explicitly requested generic video behavior
  first; preserve that scope.
- Remove VLC/Website title prefixes, including torrent titles and preparation text.

Validation before push: actual UAKino, unchanged source, emitted a new main-frame
relay offer with exact URL equality. A generic supplied HTML video fixture decoded
five-second WebM in WebKit, accepted the simulated native handoff, resumed at EOF,
produced one trusted ended event, exited fullscreen, restored audio, and rejected
repeat completion. The existing nested-frame fixture also passed acknowledgement,
ordinary close, changed-source/deleted-session rejection and experiment OFF.
Private helpers: generic-end-check.mjs and relay-check.mjs under
.data/webkit-testbench/, run 2026-11-15T14-05-12.287Z-52ced1c2.

The attempted decoded-media substitution inside the real UAKino PlayerJS did not
establish actual site auto-advance: the player reloaded/reset the original source,
then play rejected with NotSupportedError on Linux. A diagnostic PlayerJS file API
attempt also timed out. Stop that path; these are not evidence of a working site
transition. Production changes use no such API. Generic decoded media is confirmed;
actual native timing, alpha-zero drawable behavior and site episode advancement
remain TV observations. No physical device work or local tvOS compilation occurred.


Delivery checkpoint: f46c163 was pushed before the user's subsequent hold and
started develop Build 11.1 (run 43723097805). Further pushes are withheld until
explicitly requested. The separately requested original VLC cone header is a
local-only follow-up and is not included in Build 11.1. Its original vector comes
from BrowserVLCButtonIcon in 7416ee4's parent and uses the shared glyph renderer.

Build 11.1 completed successfully, including native Release compilation, packaging
and develop source publication. This does not verify native transition timing or
episode advancement; the local cone follow-up remains unbuilt and unpushed.


## 2026-11-15 — Local-only contextual icons and optional fullscreen exit

User confirms an automatic-exit toggle (not an immediate fullscreen action), with
all three controls shown as icons. Implemented in the shared native VLC panel:
- Audio waveform shown only for 2+ actual tracks; captions shown for 1+ subtitle
  track. Off entries do not count. Keep menus with names and selected checkmarks.
- Inward-arrow toggle appears only for experimental iframe return-on-end playback.
  BrowserPreferencesStore.automaticallyExitIframeFullscreen uses the global
  AutomaticallyExitIframeFullscreen preference, default YES. Center toggles it.
  Green/gray icon state and accessibility ON/OFF follow the user's explicit
  icon-only request instead of the usual visible ON/OFF badge.
- ViewController's respond block applies this preference only to ended cleanup.
  Closed/rejected still always leave fullscreen. OFF preserves the bridge's
  fullscreen context where the website permits it; no force-reentry is attempted.
- Center the transport independently; keep the right group trailing at 80 points,
  with collapsible widths so hidden icons do not conflict with UIStackView hiding.

Evidence: production bridge plus generic actual-decoded media fixtures passed ON
and OFF: one trusted ended event, fullscreen exited/retained respectively, audio
restored and repeat completion rejected. Native responses and the preference
branch were modeled. Private run 2026-11-15T14-35-44.494Z-8fdc6fb7, helper
.data/webkit-testbench/check-fullscreen-completion.mjs. UIKit visibility/focus,
native persistence, compilation and real-site episode continuity remain unverified.
No build/push requested; retain this stage locally along with the cone/title work.

## 2026-11-15 — Live Teleportal/UASerials and expanded VLC requirement

User explicitly requires Teleportal's main video to transfer into shared VLC;
website playback alone is not an acceptable completion result. VLC is the intended
foundation for further capabilities. Keep pushes withheld. Preserve generic bridge
and controls; reuse the existing Starlight capability adapter rather than matching
Teleportal URLs or guessing arbitrary network requests.

Actual Teleportal episode 92 plays as Blob/MSE in nested Starlight. Direct video
fullscreen produced no initial offer, as expected from old HTTP-only discovery.
Seeking through the production website End command produced a trusted content EOF,
post-roll HTTP ads and an erroneous late VLC offer for an ad. The source remained
92 after that sequence. This is not confirmed auto-advance. Inspect exact active
adapter/video association before offering any Starlight media. Actual core exposes
engine.attachedAdapter; its mediaSource equals the video's Blob URL, currentUrl
is the declared HTTP(S) HLS master, and hls.media points to the same video. Source
integrity is preserved in ignored upstream-core.js; no URLs/tokens belong in docs.

Next implementation: resolve an eligible Starlight HLS source only through the
active adapter associated with that video, reject detached/ad/DRM contexts, retain
source/session/generation checks, and exercise live main-video offers plus replies.
Do not infer media from generic recent network URLs. Verify current URL against the
adapter's declared source list and HLS loader. Native VLC remains unverified on
Linux and cannot be published or delivered under the current hold.

Actual UASerials domain supplied by user is uaserials.com; pagination was incidental.
Opened /1511-akademiya-tancyu.html. Player is in open shadow-frame nesting, hosted
at tortuga.tw/embed/801; actual content now plays as Blob/MSE (readyState 4).
Continue its fullscreen/episode observation separately; do not claim VLC capture.


## 2026-11-15 — Final live HLS bindings and explicit Next

The expanded requirement treats VLC as the foundation for future functionality,
with Teleportal required to enter VLC. The generic frame relay and native controls
remain shared. Add bounded capability adapters instead of domain checks or guessed
recent network URLs:

- Starlight: require engine.video identity, its attached adapter's mediaSource to
  match this video's source, software-HLS identity, hls.media===video, no EME/media
  keys, currentUrl===hls.url and membership in the engine's declared HLS source list.
  Preserve source-object identity in each request. Detached/ad-video sources fail.
- PlayerJS: use documented API only. When the experiment is ON, observe script load
  and wrap the global factory with a transparent construction/call Proxy, preserving
  prototype/static behavior and retaining at most 16 created APIs per document.
  Find the player by its api('id') container containing the video; use api('hls')
  only when an actual source is initialized, then require loader.media===video,
  Blob source and no EME/media keys. Preserve player/HLS/playlist_id identity in the
  request. Skip unused HLS plugins for ordinary HTTP videos. Enabling after an
  unexposed instance already exists needs a page reload. BFCache retains valid
  constructed API references; pagehide still clears playback requests.
- Explicit Next is now a distinct native close reason, not EOF. Reuse Media Session,
  existing Starlight controls, or PlayerJS api('next') for a registered playlist.
  Never also seek to EOF after submitting a track action. If no capability exists,
  resume near-end HTML video as before. Natural EOF retains the real-ended path.
  Preserve optional fullscreen cleanup for both next and ended; Back/failure always
  exit. Do not automatically recapture the new episode in native VLC yet.
- Freeze an unsupported unrecognized source's fullscreen capture decision, so a
  later HTTP ad cannot become a new request. A new explicit fullscreen can retry.

Live evidence, with actual site media and no source substitution:

Teleportal /ua/serials/stb/kod/2026/seriya-92: actual video is Blob/MSE. Production
bridge offered the exact active adapter HLS URL in the main document and received
an explicit simulated-native acceptance acknowledgement from the paused original
video. Local libVLC 3.0.20 decoded real video/audio and sought to 120000 ms (104 video
frames / 202 audio buffers at the observed sample). This is Linux libVLC, not the
app's TVVLCKit, and its output used dummy audio/video sinks. A real post-roll HTTP
advertisement was ineligible for capture. Explicit next reply switched 92 -> 93
with zero old-video ended events, readyState 4, playing new content and fullscreen
retained. A second host-boundary capture/reply switched 93 -> 94 with fullscreen
exit. Native responses are simulated; site source changes and playback are real.

UASerials domain was supplied by the user; /series/drama/page/70/ was incidental.
On /1511-akademiya-tancyu.html the Tortuga/PlayerJS video uses Blob/MSE. An initial
observational factory probe confirmed official API availability and matching HLS
media. Then a fresh context with production bridge ONLY (no private factory probe)
produced a main-frame HTTP HLS offer, a valid current session and a paused-original
acknowledgement. The exact URL emitted by production was opened in Linux libVLC:
86 decoded video frames / 166 decoded audio buffers, seek to 120000 ms confirmed.
Explicit next reply selected episode 2, with zero old-video ended events and
fullscreen retained; repeat acceptance of the old session returned false. The
new main Blob source remained eligible, while the real HTTP ad video was rejected.
Post-Next website content playback remained held behind the site's advertisement
on this Linux stand; this is not a confirmed native/UI seamless episode transition.
No full uBO runtime/native content-rule environment was modeled.

UAKino regression: two headless attempts failed at different stages (no offer after
an early click, then lazy iframe not attached). Changed to a visible context with
source-readiness observations; actual fullscreen click produced a main offer with
URL exactly equal to the site's direct HTTPS video. Its api('hls') returned undefined.
Keep ordinary HTTP capture intact and do not misattribute transient stand readiness
failures to the adapter. No unchanged ineffective path was retried blindly.

Private evidence/helpers (all ignored; never publish signed media URLs):
- Teleportal HLS/advertisement: run 2026-11-15T14-50-32.746Z-650a426c.
- Teleportal explicit Next retained/exited: 2026-11-15T14-57-03.380Z-c3fb83b8,
  teleportal-capture-check.mjs and host-boundary follow-up in the same live context.
- UASerials initial website EOF/selected second episode/ad hold:
  2026-11-15T14-38-33.971Z-52f6396e (older bridge, baseline observation only).
- UASerials API probe: 2026-11-15T15-14-07.414Z-19872f02,
  capture-playerjs-instance.js. Production-only test: 2026-11-15T15-18-37.356Z-44bd901c.
- UAKino final live regression: 2026-11-15T15-25-37.178Z-aedb36a6.
- Linux VLC check-vlc-stream.py; private vlc-context.json and
  vlc-uaserials-context.json, numeric vlc-summary.json. Official 3.x stats structure
  reference is indexed in RESEARCH_SOURCES.md. Native offer arrays cap at 100;
  recover older offers from private events.jsonl rather than assuming none existed.
- Generic decoded ON/OFF/Next fallback: 2026-11-15T14-59-49.756Z-a1ce0645.
- Unknown-MSE -> late HTTP regression: 2026-11-15T15-06-40.589Z-0cda5a13,
  check-unsupported-source.mjs; declined until a new explicit fullscreen.

Current native source additionally carries the string close reason closed/next/ended
through BrowserVLCPlayerViewController.webVideoDidClose and ViewController.respond.
No local tvOS build, physical device work, remote push or release publication.
Keep unreleased 2.22.0. TV UI/timing, actual native HLS handoff, preference persistence
and seamless site/episode behavior require native observation after a future delivery.

### PlayerJS follow-up: completed production binding

Continue beyond the initial UASerials limitation above: official PlayerJS API
inspection established api('hls') as a supported getter. The host's player instance
is not exposed in a global variable, so an opt-in script-load constructor observer
records created API objects without calling setters or probing unrelated globals.
An observational prototype found one actual PlayerJS instance, container
videoplayer801, matching HLS media, HTTP master and playlist 1-1. A fresh production
context (no private observer) then passed actual fullscreen capture, current-source
validation and accepted/pause acknowledgement for episode 1.

The exact URL emitted by the production bridge decoded in Linux libVLC (86 video
frames / 166 audio buffers at the sample), including seek to 120000 ms. Next reply
used the documented API once: selected episode 2, zero old-video ended events,
fullscreen retained, stale-session acceptance false. The real HTTP advertisement
was rejected; the main Blob source remained eligible. The website still held
post-Next content behind its ad on this Linux stand. Do not call that a seamless
native second-episode playback verification.

Ignore uninitialized HLS plugins when ordinary HTTP media is in use. Preserve
PlayerJS API references through persisted pagehide/BFCache, and clear transient
VLC requests as before. Final visible UAKino (same production source except this
non-behavioral BFCache follow-up) produced an exact native-offer/source URL match
from the actual fullscreen click; its HLS API was undefined.

Final production bridge regression run 2026-11-15T15-29-46.161Z-1ea58838 passed
nested-frame acknowledgement/ordinary close, stale and changed-source rejection,
experiment OFF, decoded real ended with fullscreen ON/OFF, and Next fallback with
no recognized track API. Helpers remain ignored. Native callback/header/control
changes are unbuilt on Linux; the latest available IPA remains Build 11.1 without
these local follow-ups. Push hold remains in force.

## 2026-11-15 — TV failure report and automatic preparation before presentation

User reports Teleportal Next fails, fullscreen usually flashes white then exits to
container playback, and video can play behind/in a background tab. New requested
behavior: catch the main video when it starts, buffer before showing native
fullscreen, and avoid website-fullscreen -> brief playback -> interruption -> VLC.
No physical device access is authorized; continue stand validation and immediate
push of completed stages to the beta PR.

Acceptance/implementation stages:
1. Separate experiment enablement from active-page permission. Offer eligible
   playing video through the actual visible frame chain without invoking website
   fullscreen. Keep source/playlist/DRM/ad validation and bounded per-source attempts.
2. Add a prepare acknowledgement that freezes only the verified original video
   after the native active-tab check. Prepare muted VLC as an attached child behind
   the browser, with an opaque/visible drawable and about two seconds network cache.
   Present native fullscreen once output/time is confirmed; rollback on failure.
3. Deliver close/Next after native dismissal, restore active capture permission,
   and let the next real source produce its own automatic offer. Cancel preparation
   on tab change/background/modal conflicts, without restarting hidden website audio.
4. Check live Teleportal plus targeted nested/visibility/source/cancellation cases.
   The Linux stand cannot verify UIKit child-to-modal rendering or actual tvOS.

Implementation checkpoint: automatic playing-video offers now use foreground-tab
permission independently of ancestor visibility. Prepare freezes the bound HTML
source, including late site Play; native keeps an opaque drawable attached behind
the browser, uses 2000 ms network caching and waits for fresh decoded/displayed
frames and an advancing clock after any resume seek. Accepted acknowledgement is
obtained while the website is foreground; only then detach and present the prepared
controller. Return/Next runs after modal disappearance, restores capture permission
and allows a new source/playlist item to offer automatically. Back and preparation
failure resume once; inactive pages remain paused. A declined offscreen relay sends
a deferred reply so stale visibility configuration cannot permanently consume the
source's one automatic attempt.

Stand evidence (private helpers/logs under ignored `.data/webkit-testbench/`):
- Live production bridge on actual Teleportal: a single Play emitted an automatic
  offer without website fullscreen; simulated prepare/accepted paused the real
  source. Next switched 92 -> 93 and 93 -> 94 through the actual Starlight control;
  both new real sources played and emitted new automatic offers. The second
  transition included native-active permission OFF/ON simulation. Run
  2026-11-15T16-42-42.299Z-b286491a.
- Current production bridge, decoded WebM in three cross-origin documents: automatic
  offer, prepare/accept, late Play held, no fullscreen, Back without recapture,
  new-source offer, failed preparation rollback once, inactive late Play stopped,
  inactive failure kept paused, offscreen decline/scroll-visible retry and changed
  source rejected. Run 2026-11-15T16-57-39.141Z-5ef7c172. The added scroll case exposed
  and fixed a real stale-configuration/consumed-attempt race; the first late-Play
  check also exposed clock drift, fixed by stopping at `play`, before `playing`.
- Main-document and iframe natural completion/Next without a track API each produced
  exactly one trusted ended event, no website fullscreen and duplicate rejection.
  Run 2026-11-15T16-58-08.183Z-9c63274e.
- Unsupported MSE -> late HTTP remained ineligible until an explicit new entry.
  Run 2026-11-15T16-55-29.239Z-07ad6301.
- Actual new Teleportal offer in Linux libVLC 3.0.20 with 2000 ms cache: decoded,
  sought to 120 s, produced fresh post-seek displayed frames and held its decoded
  time on pause (120720 ms). This uses dummy Linux output, not TVVLCKit/UIKit.

Native replies in WebKit are simulated. The user reported native Build 13.1
failure; these checks do not establish its exact UIKit cause or prove the new
child-to-modal surface transfer on tvOS. Next step: CI compilation/publication,
then record its result and update public usage/changelog; user TV observation of
first-frame presentation and consecutive native Next remains necessary. Keep
2.22.0 consolidated; do not change signing, workflow, master or device state.

CI follow-up: commit f02cce4 passed native Release compilation and unsigned IPA
packaging/verification in run 43738492640, Build 14.1. Public documentation now
reflects automatic preparation and Next after dismissal. Documentation-only follow-up
keeps MARKETING_VERSION 2.22.0 in both configurations; it does not change app code.
Native frame transfer and repeated TV Next remain unverified until user observation.
