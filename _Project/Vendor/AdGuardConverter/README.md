# AdGuard converter component

This directory contains the `Sources/ContentBlockerConverter` target from [SafariConverterLib v4.3.0](https://github.com/AdguardTeam/SafariConverterLib/releases/tag/v4.3.0), plus its upstream license. The local `Package.swift` exposes only that target because the upstream package also links `FilterEngine`, whose unrelated URL helper requires tvOS 16. The converter itself supports this project's tvOS 15.6 deployment target.

The source is maintained by AdGuard Software Ltd. See `LICENSE` for upstream terms. When upgrading, replace the complete converter target from a tagged upstream release and review its package dependencies.

The local package manifest also applies Swift `-O` to this target in Debug builds. The app target's optimization settings do not propagate into Swift package targets; optimizing both avoids running CPU-heavy filter conversion without optimization on a development-installed TV build. Debug compilation conditions remain unchanged.

The host adds the optional `preserveAllRules` conversion argument. Its default retains upstream behavior; the browser enables it and splits oversized output itself instead of truncating compatible entries. Every split list includes the later exceptions that can cancel its actions, preserving the original order's effect. A list that cannot fit its required exceptions fails preparation rather than dropping rules. Reserve one entry per list for the browser's policy action.
