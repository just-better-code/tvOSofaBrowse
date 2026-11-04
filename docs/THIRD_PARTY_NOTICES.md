# Third-party notices

tvOSofaBrowse is a personal-use fork of [tvOS Browser](https://github.com/jvanakker/tvOSBrowser). Upstream provides the project as-is, without warranty or liability, and asks that builds not be distributed on the App Store. This fork retains that notice. No blanket license is assigned here to the upstream application or to third-party code.

The release IPA contains `ThirdPartyNotices/`; the same files are attached separately to the release. Original notices in vendored source remain intact. GitHub's source archive for the release tag contains the application, modified adapters, vendored sources and build scripts used for that release.

| Component | Version / provenance | License and source |
| --- | --- | --- |
| uBlock Origin engine and scriptlets | User-provided 1.75.1.10 snapshot; exact upstream commit unavailable | GPL-3.0-or-later; [`_Project/Vendor/UBlock`](../_Project/Vendor/UBlock/README.md), [upstream](https://github.com/gorhill/uBlock) |
| uAssets | Pinned inputs and SHA-256 digests in `uassets-pin.json` | GPL-3.0; [vendored source and pin](../_Project/Vendor/UBlock/), [upstream](https://github.com/uBlockOrigin/uAssets) |
| CSS Tree | Source retained with the uBlock snapshot | MIT; [license](../_Project/Vendor/UBlock/src/lib/csstree/LICENSE) |
| AdGuard SafariConverterLib | ContentBlockerConverter target from v4.3.0 | GPL-3.0; [vendored source](../_Project/Vendor/AdGuardConverter/README.md), [upstream source](https://github.com/AdguardTeam/SafariConverterLib/tree/v4.3.0) |
| Public Suffix List | Bundled `PublicSuffixList.dat` | MPL-2.0; [license](licenses/MPL-2.0.txt), [bundled source](../_Project/Vendor/UBlock/PublicSuffixList.dat), [upstream](https://publicsuffix.org/list/) |
| libtorrent | 1.2.17 prebuilt tvOS library from danylokos/libtorrent-Apple | BSD and included component notices; [license](licenses/libtorrent-LICENSE.txt), [source](https://github.com/arvidn/libtorrent/tree/v1.2.17), [binary build project](https://github.com/danylokos/libtorrent-Apple/releases/tag/1.2.17) |
| Boost | 1.69.0 headers | Boost Software License 1.0; [license](licenses/Boost-LICENSE.txt), [source archive](https://archives.boost.io/release/1.69.0/source/boost_1_69_0.tar.gz) |
| TVVLCKit / VLC | Pinned TVVLCKit 3.7.3 binary archive | LGPL-2.1 and upstream component notices; `TVVLCKit-LICENSE.txt` copied unchanged from the archive, [VLCKit source and build tooling](https://code.videolan.org/videolan/VLCKit), [VLC source](https://code.videolan.org/videolan/vlc) |

The two dependency bootstrap scripts pin the exact download URLs and archive SHA-256 values. TVVLCKit's archive name includes upstream revision identifiers (`319ed2c0`, `79128878`); retain those identifiers when locating its corresponding sources and build inputs. The binary framework is redistributed unmodified; no claim is made that its transitive dependencies share one license.
