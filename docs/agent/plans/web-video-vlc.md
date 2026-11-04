# Direct web video in the existing VLC container

Request: 2026-10-11. The user chose automatic VLC playback when requesting fullscreen for a video exposing a direct HTTP(S) URL. Retain website playback/unified controls for blob/MSE or inaccessible sources; retain torrent VLC. Do not restore the removed AVPlayer or its menu toggle.

## Work

- Extend the existing VLC controller with a direct-web-URL initializer and separate web/torrent state paths, retaining the shared controls.
- At fullscreen entry, offer an accessible video URL through a validated all-frame bridge; pause only that website video after the native host accepts.
- Preserve current time, domain volume and mute; return the final position and audio state to the same website video when closing. Reject stale responses after navigation/frame replacement.
- Build and deliver the final Debug artifact under standing authorization; open a demo for user observation. Do not infer playback from compilation or process launch.

The previous MDN native-controls demo did not respond to the user's remote. This is an observed interaction limitation; its cause has not been instrumented. The user explicitly required keeping the original MDN demo. Center on its standard video now requests the shared VLC container; no replacement demo was used for delivery.

## Delivered state

Shared VLC changes built and installed as 2.21.0, then the Debug inspector gate built and installed as 2.22.0 on 2026-10-11. The final artifact excludes the proposed diagnostic HTTP server and launches with the original MDN URL. Safari Develop listed the TV browser pages, including the MDN demo; a full inspector window and actual remote playback were not verified. The user revoked further TV pushes after the final installation/launch. No application tests were run.
