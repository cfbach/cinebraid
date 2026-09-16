# CineBraid 6.9.0-alpha.1 — manual review checkout

Final human dogfood acceptance and publication remain pending. This is a local source-review candidate, not a published update or installer. Do not fetch, merge, move main, retag or replace production/settings folders as part of this review preparation.

## Review setup

The owner preparation record supplies the exact version-child commit and tree. It must be a direct child of qualified integration `b519b8aa613f39425f5b9c0d1f8ace0cd261c6b2` (tree `1ecf18515e3c8662ab2735ecb8b22bb1ad7d0ff1`). For manual review, prepare the source checkout clean and detached at that child; the published main and v6.8.0-alpha.1 must stay unchanged. The external owner preparation record confirms the resulting checkout.

Launch from your normal interactive Windows session so CineBraid sees your existing Windows AppData context. The agent does not launch the app, read credentials, or create, migrate or rewrite settings. Source launch requires Node.js 18 or newer; automated parent qualification used Node 24. The existing launcher installs dependencies only if node_modules is absent.

From PowerShell:

```powershell
Set-Location 'C:\CineBraid\CineBraid-Source'
.\start.bat
```

Or double-click `C:\CineBraid\CineBraid-Source\start.bat`. Confirm port 4477 is still free before starting a second instance. Hard-refresh the browser and verify **6.9.0-alpha.1** in About/the app version display. A source checkout may truthfully show **Development build**: the build-identity owner must not invent a packaged build ID.

## Human dogfood checklist

- Confirm Pandemonium Heights opens from the intended external project root. If the expected root or project is absent, stop and inspect the displayed location; do not create a replacement or migrate storage for this review.
- Open Production and Shot Desk; inspect context, reference requirements and navigation.
- Open Reference Desk and reference Results; distinguish enrollment, Candidate and Approved.
- Open Production Media and Inspector; inspect exact media identity and provenance.
- Review the working Project Bible and the separate Approved record.
- Open Settings & Connections; credentials stay masked. No paid request is required for this checklist.
- Review image Results/contact sheet and Screening, then motion Screening and independent comparison using existing local media.
- Return to the exact originating target/control and scroll context; try keyboard operation and Cancel/Escape.
- Read approval wording and its confirmation. Commit an approval only for a deliberate production decision, and verify success waits for the save.
- Confirm finishing remains separate from approval and delivery; each later decision must name its own authority.
- If practical, inspect 390, 1280, 1440 and 1920px layouts for usable controls, scannable cards and no horizontal overflow.

The oversized transient Approved treatment and mobile toast overlap remain non-blocking polish. Record other findings with their exact target and action. Final human acceptance and any publication decision are still pending.
