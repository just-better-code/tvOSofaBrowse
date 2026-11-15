# VLC compressor research prototype

Date: 2026-11-10. Branch: `research/automatic-web-video-vlc`, based on `70f74eb`.

The user clarified that automatic website-stream discovery with working episode
switching is the primary goal. Compression is an optional follow-on. Complete
this isolated prototype and investigate website integration; do not implement
iframe takeover in this stage. See the companion `automatic-web-video-vlc.md`.

## Goal and boundaries

Determine whether the pinned TVVLCKit can apply VLC's dynamic range compressor
to existing direct-web and torrent playback without rebuilding the framework.
This is a Debug-only, launch-argument-controlled prototype, disabled by default.
Do not change iframe routing, episode transitions, public controls, signing,
storage retention or release behavior. Do not claim audible improvement from
configuration success or a filter initialization message.

## Evidence and reference sources

- Bootstrap pin: TVVLCKit `3.7.3-319ed2c0-79128878`. The installed ignored
  `.deps/` framework is not established as that exact archive: bootstrap skips
  downloading when binaries already exist. All three local slices instead
  contain `3.0.23` and `3.0.23-2-47-g738f288a1c` strings. No runtime version call
  was executed, and no framework was replaced.
- VLC: `79128878ddb2c280bbb6c89c76a46b31a80ade1c` ([source](https://github.com/videolan/vlc/tree/79128878ddb2c280bbb6c89c76a46b31a80ade1c)).
- VLCKit: `319ed2c0724e3d4c4d34889a62fef1ae269491bc` ([source](https://github.com/videolan/vlckit/tree/319ed2c0724e3d4c4d34889a62fef1ae269491bc)).
- Local immutable source checkouts: ignored `.references/vlc-compressor` and
  `.references/vlckit-compressor`; upstream files must remain unchanged.
- The device and both simulator binary slices contain the compressor module and
  initialization string. Their dyld export tries expose `var_Create`, `var_Type`,
  `var_SetChecked` and `var_GetChecked`; child enumeration/release are also
  externally defined. This is binary inspection, not an executed adapter check.
- Also fetch the public 3.0.23 tag, commit
  `578d28f6c9f2379164516e689418f92ac74a3445`, into the VLC research repository.
  `git diff 79128878 FETCH_HEAD` is empty for the common/variable/object headers,
  player internals, audio output/filter management, object enumeration and
  compressor source. The local build's `738f288a1c` commit could not be resolved
  through the public GitHub commit API (HTTP 422); these comparisons do not prove
  all locally applied build patches are identical. Runtime guards admit only
  the archive changeset family or the exact inspected local build string.
- `lib/media_player.c` creates a non-inherited player `audio-filter`, then creates
  an audio output immediately. `src/audio_output/output.c` copies that variable.
  Setting only library options or only the player variable is insufficient.
- `modules/audio_filter/compressor.c` reads parameters on the audio output.
  `src/audio_output/filters.c` skips user filters for nonlinear output.

## Stages and acceptance criteria

1. [x] Create the isolated branch and record the implementation checkpoint.
2. [x] Add a version-pinned, checked core bridge and safe Debug logging.
3. [x] Configure the initial and EOF-replacement players through one factory.
4. [x] Record exact launch arguments, failure behavior and pending validation.
5. [x] Commit the prototype separately. No remote push or device work requested.

The prototype is implementation-complete when Release and default Debug retain
ordinary playback, an explicitly enabled experiment configures the player and
its unique existing audio output before play, failures leave ordinary playback,
and logs distinguish configuration, observed initialization and format evidence.
Runtime and listening acceptance remain pending until separately requested.

## Validation still required

No build or runtime checks are part of this implementation request. This host is
Linux with no Xcode. On a requested macOS Debug Simulator build, follow
`../SIMULATOR_RUNBOOK.md`. Confirm logging with an independent VLC Debug message
before interpreting absent compressor messages. Confirm decoded PCM, filter
initialization and absence of subsequent filter-conversion failures.

Exercise direct HTTP(S), completed torrent files and loopback streaming; repeat
after EOF, seek and audio-track changes. Compare OFF/ON on the same segment and
volume, first with 0 dB makeup and then +7 dB. Physical-TV work and subjective
listening require user permission/participation. An initialization log does not
prove that samples reach the speaker through the filter or that dialogue improves.

## Resume checkpoint

`BrowserVLCCreatePlayer()` in `BrowserVLCCompressor.m` replaces the controller's
two construction calls. Release and Debug without the enable argument return the
original shared-library player. The Debug-only compat header names the exact
64-bit union/list ABI and resolves six functions with `dlsym`; no player struct
offsets are used. Inspect only direct children of a fresh, unplayed player and
require exactly one child with audio-filter/string, device/string and
stereo-mode/integer variables. Verify PCM device selection, then set/read back
the seven parameters and preserve/append each object's filter chain. Failure
discards the entire unplayed experimental player and returns an ordinary one.

The experiment uses its own `VLCLibrary` so its logger/options do not affect the
shared library. It forces PCM and requests Debug logging for both explicit OFF
and ON runs. The logger forwards only numeric allowlisted facts, never raw VLC
messages, URLs, context strings or source paths; it respects the existing Debug
master switch. Initialization and decoded-output format events are separate
from configuration. Neither establishes audible success.

### Launch arguments (Debug only)

Set these in Xcode Scheme > Run > Arguments Passed On Launch, or append them to
an explicitly requested `xcrun simctl launch <SIMULATOR_UDID> <BUNDLE_ID>` command:

```text
-BrowserVLCCompressorEnabled NO
-BrowserVLCCompressorEnabled YES -BrowserVLCCompressorMakeupGain 0
-BrowserVLCCompressorEnabled YES -BrowserVLCCompressorMakeupGain 7
```

Each line is a separate run; do not combine them. Gain defaults to 7 dB and must
be finite in [0, 24]. Enable accepts YES/NO/1/0. Invalid arguments fall back to
ordinary playback. Only NSArgumentDomain is read; persistent preferences with
these names are ignored and no experimental preference is written. Restart to
change the mode; no live toggle/reopen behavior is introduced.

`[TorrentVLC] compressor` events include a numeric player generation. Interpret
`loggerDebug=1` as receipt of an independent VLC Debug message; `configured=1` as
stored/read-back settings; `initialized=1` as the compressor's exact message;
`outputFourcc`, `rate` and `pcm` as decoded-output evidence. `pcmRequested=1`
alone is only a request. Watch for `skipped=1` and `pipelineFailure=1` even after
initialization. Missing logs with the Debug switch OFF are inconclusive.

Failure `reason` codes: 1 unknown revision, 2 missing core symbols, 3 missing
private getter, 4 invalid player, 5 failed child enumeration, 6 nonunique/missing
audio output, 7 parameter set/read-back failure, 8 filter-chain set/read-back
failure, 9 PCM device selection failure. `argumentsValid=0` is invalid input.

No build or playback verification has run. Next executable check is a requested
macOS Debug build, followed by the runtime matrix above. Do not rebuild TVVLCKit
as an automatic fallback. Public settings and application version remain 2.21.9
because no user-facing feature or bug fix is completed by this disabled prototype.
