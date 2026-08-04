# CineBraid v6.6.4-studio.4 Release Notes

## Focus
This update restores the settings that had gone missing in the latest Studio build and brings the application shell back closer to the public CineBraid site styling.

## What changed
- **Website-aligned shell refresh**
  - Navy / cyan brand defaults
  - branded sidebar lockup with CineBraid mark
  - refined top bar and settings card styling
- **Restored Settings sections**
  - Appearance
  - Files & storage
  - Naming & organization
  - Project
  - Assistant
  - Generation
  - Recovery & advanced
- **Appearance controls**
  - accent color
  - surface theme
  - UI scale
  - interface density
  - help mode
- **Storage controls restored**
  - project root
  - media root
  - output folder
  - backup folder
  - folder strategy
  - sync mode
- **Naming controls restored**
  - approval filename template
  - export filename template
  - version padding
  - collision behavior
  - live filename preview
- **Filename generation improvement**
  - approval-name suggestions now use the saved naming template

## Validation performed
- `node --check config.js`
- `node --check public/app.js`
- `node --check public/settings.js`
- `node --check public/library-tools.js`
- `node --check public/views.js`
- booted local server and confirmed `/` and `/api/config` respond

## Notes
- File/storage fields currently act as persisted workspace controls/documentation. They are restored to the UI and saved to config, but they do not yet fully rewire all backend path behavior.
- Appearance preview is immediate in the current session through local storage + saved config defaults.
