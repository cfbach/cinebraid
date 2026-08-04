# CineBraid v6.6.4-studio.repair.9 Verification

## Focused browser regression

A real Chromium test created a four-frame approved MiniMax H3 shot and verified:
- Create motion does not change `#/shot/H3-01`;
- the assisted motion controls open;
- switching from Frames through the new CTA stays in the same shot;
- Motion & sound becomes the selected stage;
- the approved-frame preview remains at or below 302 px wide and 225 px high;
- the H3 multi-frame state remains intact;
- desktop and mobile layouts do not create horizontal overflow.

## Passed suites

- `npm run check:syntax`
- `npm run check:behavior`
- `npm run check:browser`
- `npm run check:manual-first`
- `npm run check:composer`
- `npm run check:reference-authority`
- `npm run check:repair`
- `npm run check:fal`
- `node tests/run-python-check.js tests/minimax-h3-real-browser.py`
- `node tests/run-python-check.js tests/ui-state-stability-real-browser.py`

## Result

No assertion failures remained in the completed suites. The frame preview and frame-to-motion route regressions were reproduced by the focused browser test and passed after repair.
