# Ad Block integration

Goal: use maintained AdGuard filter conversion inside the tvOS browser and make long Center on the existing Ad Block menu tile open a configuration popup.

1. Keep the SafariConverterLib converter target at v4.3.0 and expose a small Objective-C bridge for native WebKit rule JSON. The source is vendored because the upstream package also links a tvOS 16-only FilterEngine helper.
2. Keep direct on-TV downloads with cached source files. Add Base and Ukrainian filters alongside the DNS filter, with source toggles and manual refresh.
3. Compile and apply rule lists asynchronously to all active browser tabs. Preserve the custom extension file for gaps not covered online.
4. Open a native configuration alert from long Center on Ad Block; Center press keeps the existing toggle.
5. Update guide, history, changelog, and version. Record any advanced-rule or playback limits exactly; no device verification without permission.

Status on 2026-10-07: Debug build 2.18.2 passed and was installed and launched on the authorized Apple TV. The user's observation of the long-press popup, filter downloads, and site3 playback is pending. Advanced Safari extension rules are not applied by the current WebKit integration.
