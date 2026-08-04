# CineBraid v6.6.4-studio.4 — Storage Wiring, Brand Alignment, and Settings UX

## Summary
This side-branch release completes the three requested follow-up areas from `studio.3`:

1. wire restored storage settings into real backend behavior;
2. align the application more closely with the public CineBraid website;
3. simplify and clarify the top interface and Settings experience.

## Storage and path behavior
- `Project root` now controls the live project repository used by the server.
- Applying a new project root creates the destination, checks write access, and copies missing project files before switching.
- `Backup folder` now routes rotating/manual project backups to an external root, organized by project slug.
- `Output folder` now routes Markdown project exports to an external root, organized by project slug.
- `Media root` now supports assisted synchronization. When enabled, CineBraid copies new files from a matching external folder structure into the active project without overwriting existing files.
- Added `/api/workspace/status` and `/api/workspace/settings` for path inspection, write testing, migration, and effective-path reporting.
- Storage path values continue to persist through the existing config migration system.

## Brand alignment
- Updated the app shell toward the website’s deep navy / cyan visual system.
- Added and used the CineBraid mark in the main app, login screen, Project Bible, and favicon.
- Removed the remaining retired login branding.
- Refined navigation, top bar, buttons, panels, and settings surfaces to better match `cinebraid.com`.
- Added compact-density behavior to the updated shell.

## Settings and top-interface cleanup
- Settings navigation is now grouped into:
  - Workspace
  - Services & Recovery
- File settings explain which paths are active backend controls.
- Added an active-path status check.
- Added migration/write-access feedback directly in the Settings screen.
- Retained the restored Appearance, Files & Storage, Naming & Organization, Project, Assistant, Generation, and Recovery sections.
- Approval filename generation continues to use the configured naming template.

## Compatibility notes
- Existing project folder contents and project JSON schema remain unchanged.
- Project-root migration copies missing files rather than deleting or overwriting the previous root.
- Assisted media synchronization is opt-in and non-destructive.
- Environment variable `CINEBRAID_PROJECTS_ROOT` remains the default override when no saved project root is configured.
