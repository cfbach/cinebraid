# CineBraid v6.6.3.0 — Reference authority deep dive

## Root causes found

1. The server trusted the reviewer's top-level `pass` even when category findings reported major/blocking differences.
2. Prop review lacked a mandatory “same embedded content” concept, allowing the object state to match while its photograph/artwork changed.
3. Location review saw too little of the approved coverage set and treated alternate views as generic image similarity rather than one spatial system.
4. Coverage review and coverage assignment were separate internally but visually presented as variants of “approval,” so users reasonably believed reviewed views had filled slots.
5. Existing imported media had no first-class targeting step, leaving users to regenerate references they already possessed.
6. State automation stored review only inside its run, so the Review workspace could disagree with automation history and retry prompts lacked precise failure detail.
7. Failed Activity runs had retry/report actions but no archive lifecycle.

## Resolution model

The repaired pipeline is:

**Approved/imported source → explicit target mapping → bounded authority package → strict generation contract → hard-gated review → human target assignment → authority package for the next missing reference.**

Every stage now preserves target and authority provenance.
