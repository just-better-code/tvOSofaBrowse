# Apple TV Simulator runbook

Use the simulator for agent-driven previews unless the user authorizes work on a physical Apple TV. Keep simulator procedures out of the public README; that installation section is for a physical TV.

## Prepare

- Install Xcode with a tvOS Simulator runtime and open Xcode once to finish setup.
- From the repository root, run `./scripts/bootstrap-torrent-deps.sh` and `./scripts/bootstrap-vlc-deps.sh`. Both scripts install device and simulator slices in the ignored `.deps/` directory. Rerun the VLC script if an older `.deps/TVVLCKit.xcframework` has only `tvos-arm64`.
- Use the shared `Browser` scheme in `_Project/Browser.xcodeproj`. Simulator builds do not need a personal `Signing.local.xcconfig`.

## Xcode preview

1. Open `_Project/Browser.xcodeproj`.
2. Select the `Browser` scheme, `Debug` configuration and an Apple TV Simulator destination, preferably a 1080p device when checking menu fit.
3. Press Run (Command-R). Inspect actual interactions in the simulator; a successful build or launch alone does not prove the behavior works.

## Local delivery script

Use `scripts/push-to-simulator.sh` as the simulator counterpart to the test TV script:

```sh
scripts/push-to-simulator.sh deploy
scripts/push-to-simulator.sh build
scripts/push-to-simulator.sh install --launch
scripts/push-to-simulator.sh launch --url 'https://example.org/'
```

`deploy` builds, boots, installs and launches. `build` only compiles; `install` boots and installs the existing artifact without launching unless `--launch` is given. `launch` starts the already installed app. `--no-launch` overrides deploy/install, and `--configuration Debug|Release` selects the artifact. `--device <SIMULATOR_UDID>` explicitly selects an available tvOS simulator; the default prefers a booted tvOS device, then a 1080p Apple TV. `--dry-run` prints planned stages without booting or delivering the app. `--url` is accepted only with a Debug launch and creates a new tab through `SIMCTL_CHILD_BROWSER_OPEN_URL`.

The script builds with `CODE_SIGNING_ALLOWED=NO` into `.derived/simulator/`, reads the effective bundle identity from the artifact, and keeps stage logs under `.data/simulator-deploy-logs/`. It attempts each stage once and stops on failure with the private log path. It neither discovers nor changes a physical TV. Inspect actual simulator interactions separately; compilation and launch are not proof that playback works.

Use `xcrun simctl list devices available` to inspect destinations and `xcrun simctl io <SIMULATOR_UDID> screenshot /private/tmp/browser-preview.png` for an exact screenshot. Keep machine-specific IDs out of tracked files.

## Common failures

- A missing TVVLCKit simulator slice means the ignored dependency is incomplete; rerun `./scripts/bootstrap-vlc-deps.sh`.
- If a simulator service connection fails, check device status with `xcrun simctl list devices available` and reopen the Simulator app. Do not change signing as a response to a CoreSimulator service failure.
- The tvOS 18 Simulator may render light blur differently from tvOS 27. Use the user's tvOS 27 device photos for visual reference, and use the 1080p simulator for layout and interaction checks.
