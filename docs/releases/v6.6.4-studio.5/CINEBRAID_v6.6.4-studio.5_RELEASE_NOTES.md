# CineBraid v6.6.4-studio.5 — Theme Unification + Shell Cleanup

## Focus
This update addresses the regressions called out in the latest Studio build:
- broken / cluttered sidebar branding
- appearance settings only partially affecting the UI
- insufficient contrast from white text over mid-blue surfaces
- no light mode option
- no font-choice option

## What changed
- **Brand shell cleanup**
  - reduced the sidebar logo lockup to a smaller, cleaner mark
  - removed the extra `CB` chip / pseudo-wordmark treatment
  - keeps the CineBraid name on one readable line
- **Darker default working theme**
  - new **Dark studio** surface becomes the preferred darker, near-black production workspace
  - **Website navy** remains available
  - **Warm studio** remains available
  - **Light canvas** added
- **Expanded appearance controls**
  - accent color
  - surface theme
  - interface density
  - interface scale
  - font system
  - help mode
- **Font choices**
  - Studio sans
  - System UI
  - Editorial / condensed
- **Theme propagation**
  - more shell, settings, form, shot, reference, and card surfaces now follow the selected theme variables
  - improved consistency between newer website-aligned pieces and older workflow surfaces
- **Readability improvements**
  - darker panel interiors in dark themes
  - improved muted/primary text contrast
  - form fields and top bar now sit on darker, more readable surfaces

## Validation performed
- `node --check config.js`
- `node --check public/app.js`
- `node --check public/settings.js`
- `node --check public/views.js`
- local server boot test
- `/api/config` response check

## Notes
This is a UI / theming pass rather than a workflow rewrite. It is intended to make the app look cleaner and more professional while ensuring the appearance controls have a much more noticeable effect across the interface.
