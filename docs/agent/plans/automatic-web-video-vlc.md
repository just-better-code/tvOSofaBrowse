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
