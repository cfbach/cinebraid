# CineBraid v6.6.2.2 — Integrity & Mobile Usability

## Summary

v6.6.2.2 is a focused hardening release for the clarity-consolidated v6.6.2.x interface. It repairs broken project relationships that previously disappeared from the UI, prevents Activity from covering mobile work, improves mobile accessibility and touch targets, and makes the ready-to-run archive test itself after extraction.

No provider, workflow stage, project field, automation capability, migration, recovery path, Project Bible feature, or video motion compiler was removed.

## Unresolved shot relationships are now recoverable

A shot may retain an ID after a character, location, prop, vehicle, voice, speaker, or other linked record is deleted, renamed outside CineBraid, or imported from an incomplete project. Earlier builds could normalize or omit those stale IDs, leaving the shot apparently clean while compilation still lacked its intended authority.

CineBraid now:

- preserves explicit relationship IDs even when their target is unavailable;
- shows a blocking **Reference issues** panel in **Shot → Inputs**;
- names the missing ID, its inferred type, and every field that still uses it;
- offers explicit **Relink** and **Remove** actions;
- updates all matching shot fields during relink, including cast arrays, codes, creation-brief location/prop/vehicle fields, shot and clip audio, motion-plan audio, continuity-state selections, and frame-workflow selection maps;
- includes unresolved relationships in **Project readiness** and links directly to the affected shot's Inputs stage;
- uses the same shared resolver for UI, readiness, deletion impact, and repair so those surfaces cannot silently disagree.

Relink and Remove remain human-controlled. CineBraid does not guess a replacement.

## Activity no longer obstructs mobile work

The global Activity strip is now active-only and participates in normal workspace layout.

- Idle Activity is hidden completely.
- Active or attention-needed status appears as a compact workspace row.
- The strip reserves its own space instead of floating over page controls or text.
- Completion returns the strip to hidden state.
- The Activity drawer and keyboard-close behavior remain available.

Real Chromium checks measured zero Activity overlap on Production, Shot, Reference, Reports, and Settings at 1600 px, 768 px, and 390 px widths.

## Typography and accessibility polish

- **Approved authority** and its assigned-state count are separate structural elements, including the compact mobile layout.
- Settings fields receive programmatic labels or accessible names, including the global visual-style textarea.
- Previous/next shot controls name the destination shot instead of announcing only chevron glyphs.
- Frequent compact controls receive a 40 px mobile hit area; previous/next shot controls receive 44 px.
- Candidate actions, pagination, review decisions, report filters, and collapse controls retain their existing functions and counts while becoming easier to operate on touch screens.
- The Reference Library continues to persist the last-selected category.

## Packaging and release hygiene

- Release-specific documentation now lives under `docs/releases/<version>/` instead of accumulating in the repository root.
- Obsolete audit output was removed from the distributable root.
- A release-package smoke test extracts a supplied ZIP into a clean temporary directory and runs the archive's own `npm run check` command.
- The root Markdown hygiene limit remains enforced.

## Control budgets

The v6.6.2.0 simplification remains intact:

| Surface | Measured | Ceiling |
|---|---:|---:|
| Default-visible shot controls | 9 | 10 |
| Total reachable shot controls | 23 | 24 |
| Global Activity controls | 4 | 4 |
| Automation-console controls | 1 | 1 |

This release adds no visible shot-route control.

## Compatibility

- No project schema migration is required.
- Existing projects, backups, automation runs, generation jobs, approvals, prompt builds, and reports load unchanged.
- The v6.0.7.1 recovery guard and composer fallback architecture are unchanged.
- The nine video motion compilers are unchanged.
- Existing local Ollama and FAL configuration remains compatible.

## Recommended upgrade path

Install over v6.6.2.1 using the incremental patch, or use the complete ready-to-run archive. Back up the existing CineBraid folder and project data before replacing files.

After upgrade:

1. Run `npm install` if dependencies are not already present.
2. Run `npm run check`.
3. Start CineBraid with `npm start`.
4. Open **Production → Project readiness** to find any unresolved relationships.
5. Open each affected shot's **Inputs** stage and choose **Relink** or **Remove**.
