# Automatic Apple TV test channel

## Outcome and acceptance

PRs with the exact label `deploy to develop` build Apple TV Release without
signing and publish a separate `tvOSofaBrowse Test` app. Adding the label and
subsequent PR commits trigger the separate `develop.yml` workflow. A permanent
AltStore-compatible source lets atvloadly install/update this app independently
of the user's existing stable installation. Apple credentials and TV operations
remain on the user's signing host.

- Keep the existing `build.yml` workflow, stable release packaging, signing
  defaults and published tags unchanged. Do not hardcode a branch or PR number.
- Give test IPAs the fixed `org.example.tvosofabrowse.test` identity and a unique
  numeric build number even when the marketing version is unchanged.
- Publish immutable `test-pr-NUMBER-RUN_ID-ATTEMPT` prereleases, never mark them Latest.
- Publish `source.json` on an isolated `develop-channel` data branch only after the
  IPA and notices are verified and the prerelease assets are available.
- Recheck the PR's open state, deployment label and head before publication.
- Do not advertise superseded PR revisions or roll the feed back on reruns.
- All eligible PRs share one develop source; the newest successful run wins.
- Fork PRs build artifacts only; never give their code a write token.
- Failed builds/publications leave the last working feed in place.
- Use the repository GITHUB_TOKEN; require no extra account, hosting or secrets.

## Design and references

Use a new PR workflow with the established Apple TV Release build/package steps
and the existing package verifier; leave the stable workflow unchanged.
Override bundle ID/build number only for test builds and rename the unsigned
artifact's display name before packaging. Do not alter local signing settings or
the app's default identity/name. Use atvloadly's AltStore adapter rather than its
GitHub prerelease inclusion switch, which also includes ordinary stable releases.

Reference: atvloadly v0.8.2 (`b50e45e`), `internal/source/altstore.go` reads
`bundleIdentifier`, `versions[].version/buildVersion/date/downloadURL/size`;
`internal/service/app_source.go` compares build identities and includes the build
number in the version, so same-marketing-version builds remain discoverable.
GitHub's [token-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
prevent bot-created prereleases/feed commits from recursively starting builds.
The PR merge revision includes base-side tooling even when the PR head has not
rebased. Releases tag that actual merge commit and separately record/check the
PR head. The workflow becomes generally available once merged into the default
branch; merge conflicts prevent ordinary `pull_request` runs. Same-repository
PRs can publish; fork publication would need a separate trusted publisher and is
not enabled by granting elevated permissions to fork code.

GitHub's [release API](https://docs.github.com/en/rest/releases/releases#create-a-release)
requires Workflows:write for release targets that change workflow files relative
to default; GITHUB_TOKEN cannot receive it. Bootstrap by merging the CI setup into
default first. Workflow-changing PRs retain downloadable artifacts but fail the
publication preflight with an actionable explanation. Do not silently add a PAT
(its release events would also trigger the unchanged stable workflow).

The [Git references](https://docs.github.com/en/rest/git/refs) and
[Contents APIs](https://docs.github.com/en/rest/repos/contents) support isolated
feed creation and compare-and-update publication without a personal token.

## Stages and validation

1. Add label-gated `develop.yml` and extend the existing IPA verifier.
2. Add publication helper: verify identity, publish draft assets, publish release,
   then advance the source file with current-label/head and stale-build guards.
3. Document first install, automatic update/renewal settings and failure behavior.
4. Inspect source/diff and run syntax/lint checks only; application tests and
   builds have not been requested. Commit locally in the PR branch.

After the user pushes the commit and labels the PR, observe the Actions run and
verify its IPA, prerelease and public source URL when verification is requested.
The user then installs from the source, confirms
both apps coexist and checks a later update and signature renewal. CI alone does
not verify those TV outcomes. Do not push Git or operate the TV without the
corresponding authorization.

## Checkpoint

Implementation complete locally in `research/automatic-web-video-vlc` (PR #20),
based on `d70fdfc`. The original release workflow was restored after user feedback;
the final design uses label gating and discovers PR metadata from the event/API.
Source review and syntax checks are recorded in development history. No remote
changes, Actions build or TV operations performed. Next user steps: push the
commit, merge the CI setup into default for publication activation, create/apply
`deploy to develop` on the intended code PR, then connect the source after a
successful publication. Exact source URL and atvloadly steps are in
`docs/DEPLOYMENT.md`. The current PR also changes workflows, so its initial run can
build artifacts but cannot publish before that activation.
