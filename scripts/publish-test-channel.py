#!/usr/bin/env python3
"""Publish verified test artifacts, then atomically advance atvloadly's source."""

import argparse
import base64
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote

DEPLOY_LABEL = "deploy to develop"
FEED_BRANCH = "develop-channel"
BUNDLE_ID = "org.example.tvosofabrowse.test"
APP_NAME = "tvOSofaBrowse Test"
BOT = {"name": "github-actions[bot]", "email": "41898282+github-actions[bot]@users.noreply.github.com"}


def gh(*args, payload=None):
    command = ["gh", *args]
    if payload is not None:
        command += ["--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=True)
    return result.stdout


def api(endpoint, payload=None, method=None):
    return json.loads(gh("api", "--method", method or ("POST" if payload is not None else "GET"),
                         endpoint, payload=payload))


def load_feed(repo):
    refs = api(f"repos/{repo}/git/matching-refs/heads/{FEED_BRANCH}")
    if not any(ref["ref"] == f"refs/heads/{FEED_BRANCH}" for ref in refs):
        return None, None
    file = api(f"repos/{repo}/contents/source.json?ref={FEED_BRANCH}")
    if file.get("encoding") != "base64":
        raise ValueError("Unexpected source file encoding")
    feed = json.loads(base64.b64decode(file["content"]))
    # Refuse to overwrite a pre-existing unrelated branch/file.
    if (feed.get("identifier") != BUNDLE_ID + ".source"
            or feed.get("_tvOSofaBrowse", {}).get("channel") != "develop"):
        raise ValueError("The develop-channel branch contains an unrelated source")
    return feed, file["sha"]


def is_current_revision(repo, pr_number, sha):
    pr = api(f"repos/{repo}/pulls/{pr_number}")
    if (pr["state"] == "open" and pr["head"]["sha"] == sha
            and (pr["head"].get("repo") or {}).get("full_name") == repo
            and any(label["name"] == DEPLOY_LABEL for label in pr["labels"])):
        return True
    print("Skip publication: PR closed, label removed, revision superseded or head repository untrusted.")
    return False


def advance_feed(repo, feed, previous_file_sha):
    content = json.dumps(feed, indent=2) + "\n"
    message = f"Update test source to {feed['_tvOSofaBrowse']['commit'][:12]}"
    if previous_file_sha is not None:
        # Contents API rejects concurrent updates when the file SHA has changed.
        api(f"repos/{repo}/contents/source.json", method="PUT", payload={
            "message": message, "branch": FEED_BRANCH, "sha": previous_file_sha,
            "content": base64.b64encode(content.encode()).decode(), "committer": BOT,
        })
        return
    # Bootstrap a data-only root commit; do not copy app sources or workflows.
    tree = api(f"repos/{repo}/git/trees", payload={"tree": [{
        "path": "source.json", "mode": "100644", "type": "blob", "content": content,
    }]})
    commit = api(f"repos/{repo}/git/commits", payload={
        "message": message, "tree": tree["sha"], "parents": [], "author": BOT,
    })
    api(f"repos/{repo}/git/refs", payload={
        "ref": f"refs/heads/{FEED_BRANCH}", "sha": commit["sha"],
    })


def publish(directory):
    repo, sha = os.environ["GH_REPO"], os.environ["SOURCE_SHA"]
    build_sha = os.environ["GITHUB_SHA"]
    pr_number = int(os.environ["PR_NUMBER"])
    if (not re.fullmatch(r"[\w.-]+/[\w.-]+", repo)
            or not all(re.fullmatch(r"[0-9a-f]{40}", value) for value in (sha, build_sha))):
        raise ValueError("Invalid GitHub repository or source commit")
    if (os.environ["GITHUB_REF"] != f"refs/pull/{pr_number}/merge"
            or os.environ["GITHUB_EVENT_NAME"] != "pull_request"):
        raise ValueError("Publish only from a labeled pull request")
    run_id = str(int(os.environ["GITHUB_RUN_ID"]))
    run_number = int(os.environ["GITHUB_RUN_NUMBER"])
    attempt = int(os.environ["GITHUB_RUN_ATTEMPT"])
    version = os.environ["VERSION"]
    # A failed publisher can be rerun without rebuilding successful build jobs.
    # Preserve the build number embedded in that artifact, not the retry number.
    build = os.environ["TEST_BUILD_NUMBER"]
    if not re.fullmatch(r"\d+\.\d+", build):
        raise ValueError("Invalid test artifact build number")
    build_run, build_attempt = map(int, build.split("."))
    prefix = f"tvOSofaBrowse-test-{version}-{build}"
    if (not re.fullmatch(r"\d+\.\d+\.\d+", version)
            or os.environ["PACKAGE_PREFIX"] != prefix
            or build_run != run_number or not 1 <= build_attempt <= attempt):
        raise ValueError("Unexpected test package version or name")
    assets = [directory / (prefix + "-unsigned.ipa"),
              directory / (prefix + "-notices.tar.gz"), directory / "SHA256SUMS"]
    if not all(path.is_file() and path.stat().st_size > 0 for path in assets):
        raise ValueError("Missing test package, notices or checksums")

    if not is_current_revision(repo, pr_number, sha):
        return
    old_feed, file_sha = load_feed(repo)
    if old_feed is not None:
        old = old_feed["_tvOSofaBrowse"]
        if (int(old["runNumber"]), int(old["runAttempt"])) >= (run_number, build_attempt):
            print("Skip test publication: this build or a later build is already advertised.")
            return

    # GITHUB_TOKEN cannot gain Workflows:write. GitHub requires that permission
    # when a release target changes workflow files relative to the default branch.
    default_branch = api(f"repos/{repo}")["default_branch"]
    comparison = api(f"repos/{repo}/compare/{quote(default_branch, safe='')}...{build_sha}")
    if any(file.get(key, "").startswith(".github/workflows/")
           for file in comparison.get("files", []) for key in ("filename", "previous_filename")):
        raise ValueError(
            "GitHub cannot publish this workflow-changing PR with GITHUB_TOKEN. "
            "Merge the CI changes into the default branch first; the verified IPA "
            "remains available in this run's artifacts and the develop feed is unchanged.")

    tag = f"test-pr-{pr_number}-{run_id}-{attempt}"
    release_url = f"https://github.com/{repo}/releases/tag/{tag}"
    download_url = f"https://github.com/{repo}/releases/download/{tag}/{assets[0].name}"
    source_url = f"https://raw.githubusercontent.com/{repo}/{FEED_BRANCH}/source.json"
    run_url = f"https://github.com/{repo}/actions/runs/{run_id}"
    # Upload to a draft first; the feed never points to incomplete assets.
    with tempfile.TemporaryDirectory() as scratch:
        notes = pathlib.Path(scratch) / "notes.md"
        notes.write_text(
            f"Automatic PR #{pr_number} test build {version} ({build}) from merge `{build_sha}` "
            f"(PR head `{sha}`); stable Latest is unchanged.\n\n"
            "### Added\n\n"
            f"- Deliver the separate {APP_NAME} app from the develop channel "
            f"([source]({source_url}), [build]({run_url})).\n")
        gh("release", "create", tag, *map(str, assets), "--repo", repo,
           "--target", build_sha, "--draft", "--prerelease", "--latest=false",
           "--title", f"{APP_NAME} {version} ({build})", "--notes-file", str(notes))
    # The release-by-tag endpoint is for published releases. List with the write
    # token so this just-created draft is visible before publishing it by ID.
    uploaded = next((release for release in api(f"repos/{repo}/releases?per_page=100")
                     if release["tag_name"] == tag and release["draft"]), None)
    if uploaded is None:
        raise ValueError("Cannot find the uploaded draft; leave the feed unchanged")
    sizes = {asset["name"]: asset["size"] for asset in uploaded["assets"]}
    if any(sizes.get(path.name) != path.stat().st_size for path in assets):
        raise ValueError("Uploaded test release assets are incomplete; leave the feed unchanged")
    api(f"repos/{repo}/releases/{uploaded['id']}", method="PATCH", payload={
        "draft": False, "prerelease": True, "make_latest": "false",
    })

    if not is_current_revision(repo, pr_number, sha):
        return
    date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    feed = {
        "name": "tvOSofaBrowse Develop (Apple TV)", "identifier": BUNDLE_ID + ".source",
        "apps": [{
            "name": APP_NAME, "bundleIdentifier": BUNDLE_ID,
            "developerName": repo.split("/")[0], "subtitle": f"tvOS / Apple TV develop, PR #{pr_number}",
            "localizedDescription": "Automatic PR test builds, installed separately from stable.",
            "versions": [{"version": version, "buildVersion": build, "date": date,
                          "downloadURL": download_url, "size": assets[0].stat().st_size}],
        }],
        "_tvOSofaBrowse": {"channel": "develop", "pullRequest": pr_number,
                           "commit": build_sha, "headCommit": sha,
                           "runNumber": run_number, "runAttempt": build_attempt,
                           "publicationAttempt": attempt},
    }
    advance_feed(repo, feed, file_sha)
    print(f"Published test release: {release_url}\nAltStore source: {source_url}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(f"## {APP_NAME} {version} ({build})\n\n"
                          f"[Download IPA]({download_url}) · [Prerelease]({release_url})\n\n"
                          f"atvloadly **AltStore source**: `{source_url}`\n\n"
                          "Install once from this source and enable automatic updates and "
                          "Apple Account signature renewal in atvloadly.\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=pathlib.Path, help="Verified test artifacts directory")
    args = parser.parse_args()
    try:
        publish(args.directory)
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr)
        return 1
    except (KeyError, ValueError, OSError) as error:
        print(f"Test channel publication failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
