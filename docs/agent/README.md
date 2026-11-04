# Research and development notes

This directory contains the project's sanitized research, development history, runbooks and implementation plans. Historical entries describe what was known or observed at their recorded dates; they are not current authorization to resume a task, operate a device, or claim that an experiment shipped. Follow [AGENTS.md](../../AGENTS.md) for current working rules.

## Start here

- [Install and automatically renew from Linux](../DEPLOYMENT.md): Docker, atvloadly, Apple Account signing, TV pairing and release updates.
- [Build and delivery scripts](../../scripts/README.md): local Simulator/TV delivery and the alternative Xcode renewal workflow.
- [Development history](DEVELOPMENT_HISTORY.md): implementation decisions and verification boundaries.
- [Roadmap](ROADMAP.md): deferred and rejected directions.
- [Research source index](RESEARCH_SOURCES.md): upstream links, recorded revisions and known provenance gaps.

## Architecture and research

- [Torrent architecture](TORRENTS.md) and [historical torrent handoff](TORRENT_HANDOFF.md).
- [Firefox iOS iframe research](FIREFOX_IOS_IFRAME_RESEARCH.md), [fork survey](FORK_SURVEY_2026-10-04.md) and [uBlock reference review](UBLOCK_REFERENCE_REVIEW.md).
- [Simulator runbook](SIMULATOR_RUNBOOK.md), [Apple TV safeguards](APPLE_TV_RUNBOOK.md) and [tvOS interface style guide](TVOS_STYLE_GUIDE.md).
- [Brave reference scope](references/BRAVE_SCOPE.md) and [uBlock reference scope](references/UBLOCK_SCOPE.md).
- [Implementation plans and retained experiments](plans/).

## Publication boundary

Specific browsing addresses and home-device labels have been replaced with examples. Paths into `.data/` identify private evidence that is not published; some historical procedures refer to files that were not retained. The notes preserve observed results and their limits without publishing the underlying browsing state, screenshots, copied containers, account data or raw logs.

Local upstream source snapshots remain in ignored `.references/`; use the source index instead. Unknown snapshot commits are explicitly marked unknown. Historical notes retain their recorded language. New shared documentation is written in English, with the roadmap maintained in Ukrainian.
