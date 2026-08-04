# CineBraid v6.6.4-studio.repair.8 — Contextual Reference Angles

## Fixed
- Shot reference selection now infers rear, profile, three-quarter, overhead, and detail views from the written shot context instead of treating the legacy default `front` camera value as authoritative.
- A character described as facing away, shown from behind, or with their back to camera now selects the approved rear reference when available.
- Circular angle scoring now correctly treats rear three-quarter views as close to rear rather than incorrectly distant.
- Automatic supporting references no longer add an opposite-facing single-angle image that can confuse the image model.
- Manually changing the primary angle no longer silently enables every other angle as a supporting input.

## Added
- A per-entity **Reference angle** control in the shot reference tray.
- The tray reports the contextually inferred angle, such as **Auto-selected from shot context: Rear**.
- A focused regression suite for contextual angle routing and prompt-package contents.
