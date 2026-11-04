#!/usr/bin/env python3
"""Validate release tags and unsigned Apple TV packages without Apple tools."""

import argparse
import pathlib
import plistlib
import re
import stat
import struct
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent


def version(tag):
    project = (ROOT / "_Project/Browser.xcodeproj/project.pbxproj").read_text()
    versions = re.findall(r"MARKETING_VERSION = ([^;]+);", project)
    if len(versions) != 2 or len(set(versions)) != 1:
        raise ValueError("Debug and Release must have the same MARKETING_VERSION")
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag) or tag != "v" + versions[0]:
        raise ValueError(f"Release tag must be v{versions[0]}")
    print(versions[0])


def verify(path, expected):
    with zipfile.ZipFile(path) as ipa:
        bad = ipa.testzip()
        if bad:
            raise ValueError(f"Corrupt ZIP entry: {bad}")
        names = ipa.namelist()
        prefix = "Payload/Browser.app/"
        if any(not name.startswith("Payload/") for name in names):
            raise ValueError("IPA must contain only Payload")
        apps = {name.split('/')[1] for name in names if name.startswith('Payload/') and len(name.split('/')) > 2}
        if apps != {"Browser.app"}:
            raise ValueError("IPA must contain exactly one app: Browser.app")
        info = plistlib.loads(ipa.read(prefix + "Info.plist"))
        if info.get("CFBundleShortVersionString") != expected:
            raise ValueError("IPA version does not match release")
        if info.get("CFBundleSupportedPlatforms") != ["AppleTVOS"]:
            raise ValueError("IPA must target AppleTVOS, not the Simulator")
        if info.get("CFBundlePackageType") != "APPL" or not info.get("CFBundleIdentifier"):
            raise ValueError("Invalid app identity")
        executable = info["CFBundleExecutable"]
        if pathlib.PurePosixPath(executable).name != executable:
            raise ValueError("Invalid executable name")
        binary = ipa.read(prefix + executable)
        # Device binaries are thin little-endian arm64 Mach-O images.
        if len(binary) < 32 or struct.unpack_from("<II", binary) != (0xFEEDFACF, 0x0100000C):
            raise ValueError("App executable must be an arm64 Mach-O")
        if not stat.S_IMODE(ipa.getinfo(prefix + executable).external_attr >> 16) & 0o111:
            raise ValueError("App executable permissions were lost")
        for required in (
            "Frameworks/TVVLCKit.framework/TVVLCKit",
            "ThirdPartyNotices/README.md",
            "ThirdPartyNotices/TVVLCKit-LICENSE.txt",
            "ThirdPartyNotices/libtorrent-LICENSE.txt",
            "ThirdPartyNotices/Boost-LICENSE.txt",
            "ThirdPartyNotices/AdGuard-GPL-3.0.txt",
        ):
            if ipa.getinfo(prefix + required).file_size == 0:
                raise ValueError(f"Empty required file: {required}")
        for name in names:
            if any(part in {"Signing.local.xcconfig", "embedded.mobileprovision", "_CodeSignature"}
                   or part.endswith((".p12", ".p8", ".key")) for part in name.split('/')):
                raise ValueError(f"Unexpected signing material: {name}")
    print(f"Verified AppleTVOS arm64 IPA {expected}: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("version").add_argument("tag")
    package = commands.add_parser("verify")
    package.add_argument("ipa", type=pathlib.Path)
    package.add_argument("version")
    args = parser.parse_args()
    try:
        if args.command == "version":
            version(args.tag)
        else:
            verify(args.ipa, args.version)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        parser.exit(1, f"Release validation failed: {error}\n")


if __name__ == "__main__":
    main()
