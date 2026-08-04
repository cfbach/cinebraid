# CineBraid v6.6.3.5 verification

## Focused acceptance

- Assisted Look & blocking displays **Automate Blocking**.
- The planner states that it creates a grayscale guide only and exposes a bounded paid-image cap.
- Manual-first keeps the assisted section collapsed.
- Blocking-only runs reuse the existing durable opening-blocking pipeline.
- Build Prompt still reveals the manual Generate action.
- UI-state preservation remains green for Build, Improve, Generate, and same-route rerenders.
- Shot control budgets remain 9 default-visible and 24 reachable.

## Regression status

Syntax, rendering, current behavior, manual-first parity, automation diagnostics, FAL generation, real Chromium workflows, and UI-state stability passed. The combined full runner reached the external timeout only while entering the final UI-state suite; that suite and release/environment checks were run separately.

No paid FAL request was submitted during verification.
