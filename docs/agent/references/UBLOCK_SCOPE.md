# uBlock Origin reference for tvOSofaBrowse

User-supplied source snapshot added on 2026-10-11 from [gorhill/uBlock](https://github.com/gorhill/uBlock). Upstream `dist/version` contains `1.75.1.10`; the exact commit and archive provenance were not supplied. This is a trimmed research reference, not a complete build checkout.

## Useful entry points

- `src/js/resources/`: scriptlet implementations and their helpers.
- `src/js/scriptlet-filtering*.js`, `src/js/make-scriptlets.js`, and scriptlet templates: rule selection and scriptlet generation/injection.
- `src/js/cosmetic-filtering.js`, `src/js/contentscript*.js`, and `src/js/scriptlets/`: cosmetic filtering and DOM-side behavior.
- `src/js/trusted-sites.js`: per-site protection exceptions.
- `src/js/logger.js`, `src/js/logger-ui*.js`, and `src/js/reverselookup.js`: diagnostics and filter provenance.
- `src/js/redirect-engine.js`, `src/js/redirect-resources.js`, and `src/web_accessible_resources/`: replacement resources and their selection.
- `src/js/static-filtering-parser.js`, `src/js/static-net-filtering.js`, and `src/js/static-dnr-filtering.js`: filter syntax and network-rule compilation.
- `assets/assets.json`: filter-source registry. The external uAssets filter corpus is not bundled in this snapshot; registry entries do not imply local filter files are present.
- `platform/mv3/`: uBlock Origin Lite compiler, scriptlet templates, and extension runtime; useful for comparing declarative filtering constraints.
- `platform/common/`, `platform/firefox/`, `platform/chromium/`, and other platform adapters: boundaries between core logic and browser APIs.
- `platform/npm/` and `platform/nodejs/`: use of the filtering core outside the full extension.
- `docs/tests/` and JSONPath tools: upstream examples and behavioral fixtures, retained for research; not run during cleanup.

## Cleanup scope

Removed GitHub workflows and issue templates, contribution instructions, root ESLint configuration and its npm development-only manifest/lockfile, store descriptions, Crowdin import tooling, the empty publishing submodule directory, and locale directories other than `en` and `uk`. The core source, UI examples, libraries, assets, platform code, build/transformation tooling, version metadata, upstream documentation, licenses, and attribution remain.

Build scripts are retained to explain source assembly and transformations. Their referenced descriptions, locales, publishing checkout, and lint setup may be absent after trimming. `.gitmodules` is retained as upstream dependency provenance; this archive does not establish that those dependencies were populated.

Do not assume browser extension APIs are available in our tvOS WebKit adapter. Consult the Ad Block section in `docs/agent/ROADMAP.md` in the tvOSofaBrowse repository before adapting these ideas. Preserve the upstream license and attribution when reusing code or resources.

The source-based feasibility review is in [docs/agent/UBLOCK_REFERENCE_REVIEW.md](../UBLOCK_REFERENCE_REVIEW.md). It distinguishes reusable functions and DOM tasks from extension-only wiring and records integration requirements in the current browser.
