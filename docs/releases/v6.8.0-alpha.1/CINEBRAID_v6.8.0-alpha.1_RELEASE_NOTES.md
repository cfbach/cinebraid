# CineBraid 6.8.0-alpha.1 — Experience V2 milestone

This Alpha advances the active product version for the combined Shot Desk and
References milestone. These notes describe the changes since the immutable
[v6.7.0-alpha.1 release](https://github.com/cfbach/cinebraid/releases/tag/v6.7.0-alpha.1),
including storage improvements published on main after that release.

Published on 2026-09-15 as the source-only GitHub pre-release
[v6.8.0-alpha.1](https://github.com/cfbach/cinebraid/releases/tag/v6.8.0-alpha.1); the tag names `d5342b98c3d9f7a824c74ca48a483a1702f183c8`.
No release archive was uploaded and there is no native installer: GitHub's generated
source downloads are source archives, not installers.
See the [verification basis](CINEBRAID_v6.8.0-alpha.1_VERIFICATION_REPORT.md) and
[source update guide](CINEBRAID_v6.8.0-alpha.1_PATCH_INSTALL.md).

## Productions and settings survive application updates

New installations keep production projects outside the application by default:
`%USERPROFILE%\CineBraid Projects` on Windows, or `~/CineBraid Projects` elsewhere.
A saved project-root choice takes precedence. Existing installations with projects
inside their application folder continue opening those projects in place; startup
does not move them automatically.

**Settings → Files & storage** provides a deliberate copy to a selected project
root, checks the result and retains the old root. Existing media identities and
production decisions remain part of the production. The original projects are
rollback copies, not files this update automatically cleans up.

Settings now normally live in `%LOCALAPPDATA%\CineBraid\config.json` on Windows,
`~/Library/Application Support/CineBraid/config.json` on macOS, or
`${XDG_CONFIG_HOME:-~/.config}/CineBraid/config.json` on Linux. An explicit
`CINEBRAID_CONFIG_PATH` remains authoritative. On first start without a per-user
settings file, CineBraid copies usable legacy application settings, verifies the
copy and leaves the originals intact. If per-user settings already exist, they
are used; legacy settings are not merged into them. Retained legacy settings may
still contain credentials and must continue to be protected.

## A+ Shot Desk

The representative image-review journey now keeps the production, scene, shot
and frame in view while the image occupies the main workspace. Candidate
selection, comparison and the deliberate approval decision sit together.
Comparison actions distinguish candidates, the guide and the current approved
image, and appear only when their target is available. Provenance remains
accessible without dominating the image.

The layout adapts to 1280, 1440 and 1920 desktop widths. At 1280 the inspection
rail starts closed. Approval identifies the image and target, explains what will
change, and opens with keyboard focus on Cancel. Selection and comparison do not
approve anything.

## References and existing Production media

An incomplete reference now offers **Choose from production media** and
**Upload new**. The media selector prefers images already linked to that
reference. The filmmaker chooses a continuity state and required view, previews
the assignment, then explicitly adds a candidate. Returning from a reference
opened through a shot preserves the shot origin; global entry invents none.

A Media Library link is relevance, not reference enrollment. Enrollment creates
an explicit reference/state/view binding to the existing durable asset ID. The
original production asset stays in place: it is not moved or duplicated to make
it a reference. The same resolution contract supports previews, coverage,
approval preparation, approved display and downstream reference loading.
Existing folder-backed candidates and receipt-backed approvals remain supported.
Unavailable or foreign bindings fail closed rather than substituting a similar
filename.

**Enrollment is not approval.** Filling a required view does not create canon or
mark a design complete. Approval remains a separate user decision through the
existing authority writer. The visible production status is **Approved**; AI may
review or recommend but never holds production approval authority. The mixed
imported/generated library is called **Production media**, with its existing
route retained.

## Saved crops are ready for review

**Save as candidate** now prepares the crop's durable identity and persists its
reference and continuity-state ownership before checking it through the shared
resolver. Successful completion leaves a reviewable candidate on its existing
candidate card, available after reload, without approving it. A failed save
reports failure and keeps the operation recoverable; retry reuses the crop
already uploaded instead of creating another copy.

Reference-details navigation closes its dialog and transfers focus to the
destination. Ordinary dismissal restores the originating control, including
when a responsive render has replaced that control's DOM node.

## Scope and remaining work

This is an Alpha and a bounded Experience V2 foundation, not whole-application
completion. Production media selector search/filtering for large productions is
deferred; linked-first ordering is implemented. EV2-3, broader visual propagation,
Generation Routing, Project Bible restructuring, audio/dubbing and ElevenLabs
integration are not included. No external source-media collection is imported.

PSS-4, CS-4 and local workspace cleanup are not completed by this milestone.
Legacy project/config copies remain retained. No automatic credential cleanup,
rotation, project repair or destructive migration is part of this update. The
existing v6.7.0-alpha.1 annotated tag and GitHub release remain unchanged.
