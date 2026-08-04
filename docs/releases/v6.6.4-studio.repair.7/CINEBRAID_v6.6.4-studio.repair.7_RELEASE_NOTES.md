# CineBraid v6.6.4-studio.repair.7 — Private Preview UX & Review Workflow

## Purpose
Repair.7 focuses on the day-to-day usability issues found during demo rehearsal and independent review: blocking review discoverability, media inspection, motion-page hierarchy, bounded generation dialogs, H3 reference correctness, storage safety, and recoverable project management.

## Blocking AI review
- **Review all with AI** is now visible directly beside the blocking attempts instead of being buried inside Optional assisted blocking.
- The vision assistant reviews the entire option set together, saves a score/pass/flag/note on every attempt, and recommends the strongest passing guide.
- **Automatically review new options** can be enabled per shot. Newly uploaded or returned blocking attempts trigger one group review when the option set changes.
- Human guide selection remains explicit. Automatic review never approves a guide by itself.

## Full-size media inspection
- Approved stills in the shot status card and Motion workspace can be clicked for a large in-app preview.
- Source/reference tray thumbnails now open the same bounded preview.
- Returned and approved videos include **Larger preview**, opening a theatre-size player without switching the browser to fullscreen.
- Finish/Delivery media uses the same preview behavior.

## Motion workspace
- Motion is divided into three visible stages:
  1. Approved frames
  2. Returned video
  3. Assisted motion
- A compact navigation strip links directly to each stage.
- Type scale, labels, controls, frame grids, video cards, and responsive behavior are normalized.
- The MiniMax H3 confirmation dialog now uses a fixed header/footer with a contained scrollable middle instead of expanding beyond the viewport.

## H3 and prompt safety fixes
- H3 sequence roles now include imported/plain `keyframe` waypoints as well as CineBraid's `sequential-keyframe` role.
- Mixed first/keyframe/last packages retain every temporal waypoint in exact Image 1–N order.
- H3 warns whenever an image is numbered in the reference map but is not assigned to the temporal sequence.
- I2V and FLF compilation now names references excluded by the provider input policy.
- FLF warns explicitly when its final endpoint is missing.

## Workspace and project safety
- Storage roots can no longer be changed through the generic config endpoint. They must use the validated Files & storage workflow.
- Recently deleted projects are listed inside Project Management and can be restored without manually moving folders.
- Trash restore preserves the original slug when possible and chooses a non-destructive restored name when necessary.

## Theme and responsive consistency
- Media wells now use theme variables in Dark studio, Website navy, Warm studio, and Light canvas.
- Added broad containment rules for the primary application workspaces, prompts, images, videos, forms, and long text.
- A dedicated real-browser layout audit covers production, boards, scenes, all five shot tasks, references, entity pages, reports, settings, Project Bible, dark/light themes, and large/Deck/tablet/phone viewports.

## Compatibility
- No breaking project schema migration.
- Existing prompts, reviews, candidates, approvals, automation runs, H3 jobs, and media remain compatible.
- Patch excludes `projects/`, `data/config.json`, `node_modules`, API keys, model settings, and production media.
