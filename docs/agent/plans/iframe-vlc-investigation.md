# Iframe streams in VLC: retained investigation

Date: 2026-10-11. Final user decision: keep iframe playback in the website player and stop repeat playback tests. The iframe-to-VLC experiment is disabled in 2.21.3. Do not resume it without a new request.

## Confirmed observations

- An all-frame WKUserScript can read a direct HTTP(S) URL from HTMLVideoElement.currentSrc/src or a source child inside its own cross-origin iframe. Its parent does not need direct DOM access. This is element-based discovery, not a universal stream extractor; Blob/MSE/DRM remain outside this path.
- 2.21.2 paused the source website video on VLC acceptance, routed Previous/Next through retained Media Session handlers with a system-command fallback, and tried to produce a genuine ended event by seeking/playing the source video's last 50 milliseconds after native EOF. A changed-URL watcher lasted 15 seconds.
- The user reported that both the end-to-next-episode attempt and Next failed. Build/install/launch success did not establish either interaction.
- Safari Web Inspector connected to the requested Example site C page on the tvOS 18.2 Simulator. The top document had no video element, used playerfr on embed-a.example.test, and exposed PlayerNextCustom and autoplayer. PlayerNextCustom selects the adjacent playlist LI only when its data-id matches the current item, then schedules autoplayer after three seconds. autoplayer sends the PlayerJS play command to playerfr.
- The site's message handler handles PlayerJS finish with that same adjacent-item selection and handles next by calling PlayerNextCustom. Its time handler provides next-episode/season prompts. This uses the PlayerJS message protocol, not solely navigator.mediaSession.
- In one live observation, the active item was Series 1 and its next sibling Series 2; both had matching data-id. A preceding observation had no matching next sibling, so boundary behavior must also be respected.
- Console output included cross-origin-access errors and blocked ad resources. Those errors alone do not prove which step prevented native continuation.

## Interpretation and unfinished approach

The source video being paused removes the website's normal completion lifecycle. The generic Media Session fallback did not match the observed Example site C playlist mechanism. Selecting the next item changes the iframe document; a watcher retained only in the old document cannot follow that navigation. These are concrete architectural gaps; no single runtime failure cause was isolated.

A site-specific PlayerNextCustom/adjacent-LI adapter and parent-to-new-frame session handshake were drafted, then removed before build or interaction checking at the user's request. An ignored draft is retained at .data/iframe-vlc-investigation/unbuilt-playerjs-bridge.js. It is not a working implementation or a verified fix. Future work would need source/session reattachment, duplicate-completion prevention, playlist boundaries, autoplay permission and source availability; do not assume a generic Next submission proves a switch.

References: [PlayerJS commands](https://playerjs.com/docs/en=apicommands), [PlayerJS events](https://playerjs.com/docs/en=api). Live website findings above came from Safari Web Inspector, not from the documentation.

## Final delivery

2.21.3 restores iframe website playback by excluding child documents from direct-VLC requests and removing iframe VLC relay/EOF/track-continuation code. Native requests also validate that their video document is the main document. Keep the existing iframe fullscreen media panel unchanged. Retain Go to Beginning/End in VLC and move Audio/Subtitles to the right edge. Debug Simulator build, install and launch succeeded with the requested Example site C URL. No repeat playback checks, automated app tests, Release build, physical-TV work or Git remote push were performed.
