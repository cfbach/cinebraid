/* NEGATIVE CONTROLS FOR REFERENCES UX CONVERGENCE V1.
 *
 * A guarantee nobody has watched fail is a guarantee nobody has tested.
 *
 * Each control below breaks ONE mechanism this slice added, IN MEMORY, drives the
 * real page against the broken module, and requires the named bad state to
 * appear. The contract is the one tests/reference-truth-sheet-gate-negative-controls.js
 * established, and all seven conditions are enforced by controlAsync():
 *
 *   1. the baseline runs outside any catch-as-success region
 *   2. the mutation is CONFIRMED to have changed the shipped source
 *   3. the probe reaches its checkpoint under BOTH modules
 *   4. the invariant FAILS under the mutated module
 *   5. the failure is the NAMED one — an arbitrary AssertionError is not a pass
 *   6. an unrelated throw fails the suite loudly
 *   7. the invariant HOLDS under the real module
 *
 * WHY THESE. A presentation slice can go wrong in exactly two ways that matter:
 * it can make the screen CLAIM something that is not true, or it can make
 * something DISAPPEAR while calling it simplification. N1, N2, N4, N6 and N7 are
 * one or the other of those. N3 guards the hand-off, which is the thing a
 * filmmaker notices last and trusts least once it is wrong. N5 guards a way out.
 * N8, N9 and N10 guard the line between SAVING something and CHOOSING it — the
 * one distinction on this screen where getting it wrong silently changes what a
 * production is built from. N11 through N15 guard the effective-Required join in
 * BOTH directions, across every surface that words it.
 *
 * N16 AND N17 ARE A DIFFERENT KIND, AND THE REASON IS WORTH KEEPING. Neither
 * guards something this slice invented; each guards a rule this slice applied on
 * the surface where it was REPORTED and not on the second surface that had the
 * same defect — an empty provenance chooser (N16), and a target list describing
 * an occupied view through the key the writer deletes (N17). A per-surface fix is
 * what let both survive a merged pass, so both are pinned per surface here.
 *
 * IN MEMORY, ALWAYS. Nothing in the working tree is written, so no control can be
 * "restored" by a checkout that would also discard real work.
 *
 * NO PROJECT DATA IS TOUCHED, AND NO PROVIDER OR PAID CALL IS POSSIBLE.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { render, buildFixture, withCanon } = require("./render-harness");

let controls = 0;
const notes = [];

/* LINE ENDINGS ARE NOT PART OF AN ANCHOR. `core.autocrlf=true` checks these files
   out with CRLF, so a multi-line anchor written as LF matches ZERO times on a
   normal Windows clone — a loud, accurate-sounding failure about nothing. */
const toLF = (text) => String(text).split("\r\n").join("\n");

/* THE PROBE RECEIPT. A plain Error, never an assertion: a control whose anchor
   has moved must fail the suite loudly rather than be mistaken for a firing. */
function mutate(text, needle, replacement, label, expected = 1) {
  const body = toLF(text);
  const anchor = toLF(needle);
  const hits = body.split(anchor).length - 1;
  if (hits !== expected) {
    throw new Error(`probe receipt: ${label} expected ${expected} occurrence(s) of its anchor, found ${hits}. `
      + "The control is no longer mutating the live path and must be rewritten.");
  }
  return body.split(anchor).join(toLF(replacement));
}

/* THE PROBE'S OWN PROBE — both failure modes of mutate() pinned, not assumed. */
(function proveTheProbe() {
  const LF = ["  const a = one();", "  return a;", ""].join("\n");
  const CRLF = LF.split("\n").join("\r\n");
  const ANCHOR = ["  const a = one();", "  return a;"].join("\n");
  const ABSENT = ["  const a = two();", "  return a;"].join("\n");
  for (const [name, text] of [["LF", LF], ["CRLF", CRLF]]) {
    const out = mutate(text, ANCHOR, "  const a = BROKEN;\n  return a;", `self-check ${name}`);
    assert(out.includes("BROKEN"), `mutate() did not apply a multi-line anchor to ${name} source`);
    assert(!out.includes("\r"), `mutate() left carriage returns in ${name} source`);
    assert.throws(() => mutate(text, ABSENT, "x", `self-check absent ${name}`),
      /probe receipt: self-check absent/, `mutate() accepted an absent anchor in ${name} source`);
  }
})();

const pending = [];
function controlAsync(spec) {
  const { label, baseline, probe, reason, explain } = spec;
  controls += 1;
  pending.push((async () => {
    if (typeof baseline === "function") await baseline();
    const real = await probe(null);
    assert.ok(real && real.reached === true,
      `${label}: the probe did not reach its checkpoint against the REAL page, so it proves nothing about the mutated one`);
    assert.strictEqual(real.held, true,
      `${label}: the invariant does not hold in the shipped page, so this control describes a property that does not exist`);
    const after = await probe(spec.mutateSource);
    assert.ok(after && after.reached === true,
      `${label}: the probe did not reach its checkpoint against the MUTATED page — the break stopped execution instead of changing behaviour`);
    assert.strictEqual(after.held, false, `${label}: the invariant SURVIVED the break. ${explain}`);
    assert.strictEqual(after.reason, reason,
      `${label}: the invariant failed, but not in the way this control describes (expected ${JSON.stringify(reason)}, got ${JSON.stringify(after.reason)})`);
    notes.push(`  ${label} — held under the real page, failed as ${JSON.stringify(after.reason)} under the mutation`);
  })());
}

/* Break exactly one file, and only that file. */
const only = (target, apply) => (file, text) => (file === target ? apply(text) : text);

/* ---------------------------------------------------------------------------
   Shared fixture. Deliberately the DORMANT case: a reference no shot uses yet,
   which is the shape every one of these findings was observed on. */
function uxFixture({ models = [] } = {}) {
  const project = buildFixture();
  const character = project.characters[0];
  character.id = "CHAR-NC";
  character.name = "Nora";
  character.prefix = "CHAR-NC";
  character.approvedFile = "CHAR-NC-PRIMARY.png";
  character.continuityStates = [
    { id: "state-default", name: "Default", isDefault: true, approvedFile: "CHAR-NC-PRIMARY.png", notes: "Primary." },
  ];
  character.coverageSlots = [
    { id: "front", label: "Front", requirement: "required", selectedFile: "" },
    { id: "profile", label: "Profile", requirement: "required", selectedFile: "" },
  ];
  character.expressionSlots = [{ id: "neutral", label: "Neutral", requirement: "required", selectedFile: "" }];
  character.candidateFiles = [
    { stored: "CHAR-NC-PRIMARY.png", original: "CHAR-NC-PRIMARY.png", decision: "unreviewed" },
    { stored: "CHAR-NC-LOOSE.png", original: "loose.png", decision: "unreviewed", coverageJobType: "single-reference" },
  ];
  project.meta.models = models;
  for (const shot of project.shots || []) shot.characters = [];
  return withCanon(project, {
    kind: "entity-state", list: "characters", entityId: "CHAR-NC", stateId: "state-default",
    value: "CHAR-NC-PRIMARY.png",
  });
}

const uxScan = () => ({
  anchors: [
    { name: "CHAR-NC-PRIMARY.png", url: "/assets/anchors/CHAR-NC-PRIMARY.png" },
    { name: "CHAR-NC-LOOSE.png", url: "/assets/anchors/CHAR-NC-LOOSE.png" },
  ],
  plates: [], props: [], vehicles: [], audio: [], media: [],
  shots: { "L1-01": { takes: [], locked: [] } },
});

const COVERAGE_STORAGE = {
  "cinebraid-focused:fixture:entity-task:characters:CHAR-NC": "coverage",
  "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-NC": "coverage",
};

const draw = (project, storage, mutateSource) =>
  render("#/character/CHAR-NC", project, {
    scan: uxScan(), storage: { ...storage }, ...(mutateSource ? { mutateSource } : {}),
  });

/* ===========================================================================
   N1 — NO REVIEW IS NOT A PASS.

   The single highest-consequence claim this slice makes, because it is the one
   that is about EVIDENCE rather than layout. Put the "pass" default back on the
   factor severity and a candidate nobody has looked at reports six green
   factors underneath an overall result of NOT REVIEWED.
   =========================================================================== */
controlAsync({
  label: "N1 an unreviewed factor may not read PASS",
  mutateSource: only("review.js", (text) => mutate(
    text,
    "    const item = (review && categories[key]) || null;\n"
    + '    const severity = item ? entityReviewSeverity(item.severity) : "unreviewed";',
    "    const item = categories[key] || {};\n"
    + "    const severity = entityReviewSeverity(item.severity);",
    "N1")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), {}, mutateSource);
    const html = vm.runInContext(`(() => {
      openEntityCandidateReview('characters','CHAR-NC','CHAR-NC-LOOSE.png','state-default');
      return document.getElementById('modal').innerHTML;
    })()`, rendered.context);
    if (!html.includes("NOT REVIEWED")) return { reached: false, held: false, reason: "no-review-modal" };
    const tones = [...html.matchAll(/<article class="entity-review-factor severity-([a-z]+)">/g)].map((m) => m[1]);
    if (!tones.length) return { reached: false, held: false, reason: "no-factor-grid" };
    const green = tones.filter((tone) => tone === "pass").length;
    return {
      reached: true,
      held: green === 0,
      reason: green ? `unreviewed-candidate-reported-${green}-pass-factors` : "no-fabricated-pass",
    };
  },
  reason: "unreviewed-candidate-reported-6-pass-factors",
  explain: "A default that answers PASS when nothing was asked is a claim of evidence that does not exist.",
});

/* ===========================================================================
   N2 — STAGING MUST SHOW WHAT WAS STAGED.

   R9's defect, exactly: the filmmaker chose a file and the large preview stayed
   blank, so the choice looked like it had not registered. Blind the media lookup
   and the preview goes back to showing nothing.
   =========================================================================== */
controlAsync({
  label: "N2 a staged selection must preview immediately",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    "  const item = entity && chosen ? entityMedia(list, entity).find((row) => row.name === chosen) : null;",
    "  const item = null;",
    "N2")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), COVERAGE_STORAGE, mutateSource);
    const out = vm.runInContext(`(() => {
      const select = document.getElementById('coverage-slot-file');
      const preview = document.getElementById('coverage-slot-preview');
      if (!select || !preview) return null;
      select.dataset.committed = '';
      select.dataset.slotList = 'characters';
      select.dataset.slotEntity = 'CHAR-NC';
      select.value = 'CHAR-NC-LOOSE.png';
      stageSlotSelection('coverage-slot-file','coverage-slot-use');
      return { mode: preview.dataset.slotPreview, html: String(preview.innerHTML || '') };
    })()`, rendered.context);
    if (!out) return { reached: false, held: false, reason: "no-slot-editor" };
    if (out.mode !== "staged") return { reached: false, held: false, reason: `not-staged(${out.mode})` };
    const shown = out.html.includes("CHAR-NC-LOOSE.png");
    return {
      reached: true,
      held: shown,
      reason: shown ? "staged-image-visible" : "staged-selection-previewed-nothing",
    };
  },
  reason: "staged-selection-previewed-nothing",
  explain: "A choice the filmmaker cannot see is a choice they have to commit in order to check.",
});

/* ===========================================================================
   N3 — AN ASSIGNMENT LANDS ON THE VIEW IT NAMED.

   R4's hand-off. Remove the return and "Map & assign" writes the slot correctly
   and leaves the filmmaker looking at whatever stage they happened to be on,
   with no indication that anything happened.
   =========================================================================== */
controlAsync({
  label: "N3 an explicit assignment returns to its own view",
  mutateSource: only("coverage-automation.js", (text) => mutate(
    text,
    `        returnToCoverageSlot(current.list, current.entityId, kind === "expression" ? "expressions" : "angles", slot.id);\n`,
    "",
    "N3")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), {
      "cinebraid-focused:fixture:entity-task:characters:CHAR-NC": "reference",
    }, mutateSource);
    const out = vm.runInContext(`(() => {
      openImportedReferenceMapper('characters','CHAR-NC');
      const file = document.getElementById('import-reference-file');
      const target = document.getElementById('import-reference-target');
      if (!file || !target) return null;
      file.value = 'CHAR-NC-LOOSE.png';
      target.value = 'coverage:profile';
      confirmImportedReferenceMapping(true);
      return {
        task: localStorage.getItem('cinebraid-focused:fixture:entity-task:characters:CHAR-NC'),
        slot: localStorage.getItem('cinebraid-bounded:fixture:selected:coverage-slot:characters:CHAR-NC'),
      };
    })()`, rendered.context);
    if (!out) return { reached: false, held: false, reason: "no-mapper" };
    const landed = out.task === "coverage" && out.slot === "profile";
    return {
      reached: true,
      held: landed,
      reason: landed ? "landed-on-the-assigned-view" : `assignment-did-not-land(task=${out.task},slot=${out.slot})`,
    };
  },
  reason: "assignment-did-not-land(task=reference,slot=null)",
  explain: "An action that names a view and then leaves the filmmaker somewhere else has done invisible work.",
});

/* ===========================================================================
   N4 — COMPACT IS NOT DELETED.

   The risk this slice's own simplification carries. R6 asks the plan to stop
   occupying full-width rows; the line it must not cross is dropping the rows.
   Filter them out instead of compacting them and a filmmaker's whole coverage
   plan vanishes from the panel that is supposed to describe it.
   =========================================================================== */
controlAsync({
  label: "N4 compacting the plan may not remove it",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    "${leading.map((row) => entityDemandRowMarkup(list, entity, row, leadDensity(row))).join(\"\")}",
    "${leading.filter((row) => !leadDensity(row).compact).map((row) => entityDemandRowMarkup(list, entity, row, leadDensity(row))).join(\"\")}",
    "N4")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), COVERAGE_STORAGE, mutateSource);
    const html = rendered.html;
    const section = html.slice(html.indexOf('class="entity-demand"'));
    const dormant = Number((/data-demand-dormant="(\d+)"/.exec(section) || [])[1] || 0);
    if (!dormant) return { reached: false, held: false, reason: "fixture-has-no-dormant-plan" };
    const open = /<div class="entity-demand-rows entity-demand-open">([\s\S]*?)<\/div>\s*(?:<details|<\/section)/.exec(section);
    const listed = open ? (open[1].match(/<article class="entity-demand-row/g) || []).length : 0;
    return {
      reached: true,
      held: listed === dormant,
      reason: listed === dormant ? "every-planned-item-listed" : `plan-rows-dropped(${listed}/${dormant})`,
    };
  },
  reason: "plan-rows-dropped(0/8)",
  explain: "Simplification that removes the material is not simplification; it is a screen that no longer says what a project needs.",
});

/* ===========================================================================
   N5 — THE MEDIA IS NOT THE BACKDROP.

   R2 asks for one new way out and no new way to lose the picture. Widen the
   predicate to close on any click and looking closely at an image — clicking it
   to focus, pausing a video — throws the filmmaker out of the viewer.
   =========================================================================== */
controlAsync({
  label: "N5 clicking the media must not close the viewer",
  mutateSource: only("review.js", (text) => mutate(
    text,
    "      if (target === el || target?.classList?.contains?.(\"lb-stage\")) closeLB();",
    "      if (target) closeLB();",
    "N5")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), {}, mutateSource);
    vm.runInContext(`(() => {
      const realGet = document.getElementById.bind(document);
      const realCreate = document.createElement.bind(document);
      const bag = { listeners: [] };
      let lbEl = null;
      document.getElementById = (id) => (id === 'lb' ? lbEl : realGet(id));
      document.createElement = (tag) => {
        const el = realCreate(tag);
        el.addEventListener = (type, fn) => bag.listeners.push({ type, fn });
        el.remove = () => { lbEl = null; };
        return el;
      };
      document.body.appendChild = (child) => { lbEl = child; return child; };
      globalThis.__bag = bag;
      globalThis.__el = () => lbEl;
    })()`, rendered.context);
    const out = vm.runInContext(`(() => {
      openLBMedia(encodeURIComponent(JSON.stringify([{ name: 'CHAR-NC-PRIMARY.png', url: '/a/p.png' }])), 0, 'CHAR-NC');
      const listener = globalThis.__bag.listeners.find((l) => l.type === 'click');
      if (!listener || !globalThis.__el()) return null;
      listener.fn({ target: { classList: { contains: (name) => name === 'lb-image' } } });
      const afterMedia = !!globalThis.__el();
      listener.fn({ target: globalThis.__el() });
      return { afterMedia, afterBackdrop: !!globalThis.__el() };
    })()`, rendered.context);
    if (!out) return { reached: false, held: false, reason: "viewer-did-not-open" };
    if (out.afterBackdrop !== false) return { reached: false, held: false, reason: "backdrop-did-not-close" };
    return {
      reached: true,
      held: out.afterMedia === true,
      reason: out.afterMedia ? "media-click-kept-the-viewer-open" : "media-click-closed-the-viewer",
    };
  },
  reason: "media-click-closed-the-viewer",
  explain: "A viewer that closes when you click the thing you are looking at is worse than one you have to press Escape on.",
});

/* ===========================================================================
   N6 — HIDING A NON-CHOICE IS NOT HIDING THE CAPABILITY.

   R1's opposite failure. Hide the provenance chooser unconditionally and a
   project that genuinely has models to record loses the ability to record one —
   which is the difference between removing a non-choice and removing a feature.
   =========================================================================== */
controlAsync({
  label: "N6 real provenance choices must still be offered",
  mutateSource: only("library-tools.js", (text) => mutate(
    text,
    "  const provenanceModels = P.meta.models || [];",
    "  const provenanceModels = [];",
    "N6")),
  probe: async (mutateSource) => {
    const project = uxFixture({ models: [{ id: "m-a", name: "Model A" }, { id: "m-b", name: "Model B" }] });
    const rendered = await draw(project, {}, mutateSource);
    const out = vm.runInContext(`(() => {
      if ((P.meta.models || []).length < 2) return null;
      intakeModal('characters','CHAR-NC',[{ name: 'drop.png', type: 'image/png' }]);
      return document.getElementById('modal').innerHTML;
    })()`, rendered.context);
    if (out === null) return { reached: false, held: false, reason: "fixture-has-no-models" };
    if (!out.includes("What are these files?")) return { reached: false, held: false, reason: "no-intake-modal" };
    const offered = out.includes('id="in-model"') && out.includes("Model A") && out.includes("Model B");
    return {
      reached: true,
      held: offered,
      reason: offered ? "real-choices-offered" : "chooser-hidden-with-real-choices",
    };
  },
  reason: "chooser-hidden-with-real-choices",
  explain: "Hiding a control that has nothing to say is simplification; hiding one that does is a lost capability.",
});

/* ===========================================================================
   ALPHA BLOCKERS — four more mechanisms, four more watched failures.
   =========================================================================== */

/* The extractor needs two edges the render harness has no model for: an upload
   endpoint and a canvas. Everything between them is the shipped writer. */
const sheetFixture = () => {
  const project = uxFixture();
  const character = project.characters.find((row) => row.id === "CHAR-NC");
  character.candidateFiles.push({
    stored: "CHAR-NC-SHEET.png", original: "CHAR-NC-SHEET.png", decision: "unreviewed",
    coverageJobType: "sheet", coverageSheetType: "angles",
  });
  return project;
};
const drawExtractor = (mutateSource) => {
  const uploaded = [];
  const scan = (extra) => {
    const base = uxScan();
    return { ...base, anchors: [...base.anchors, { name: "CHAR-NC-SHEET.png", url: "/assets/anchors/CHAR-NC-SHEET.png" },
      ...extra.map((name) => ({ name, url: `/assets/anchors/${name}` }))] };
  };
  return {
    uploaded,
    render: () => render("#/character/CHAR-NC", sheetFixture(), {
      scan: scan([]),
      storage: { ...COVERAGE_STORAGE },
      ...(mutateSource ? { mutateSource } : {}),
      fetch: async (url, options, respond) => {
        const target = String(url || "");
        if (target.startsWith("/api/media/upload")) {
          const name = decodeURIComponent((/name=([^&]+)/.exec(target) || [])[1] || "");
          uploaded.push(name);
          return respond({ name });
        }
        if (target === "/api/scan") return respond(scan(uploaded));
        return null;
      },
    }),
  };
};
const EXTRACTOR_DRIVE = (assign) => `(async () => {
  const realCreate = document.createElement.bind(document);
  document.createElement = (tag) => String(tag).toLowerCase() === "canvas"
    ? { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (done) => done({ size: 12, type: "image/png" }) }
    : realCreate(tag);
  openCoverageSheetExtractor('characters','CHAR-NC','CHAR-NC-SHEET.png', true);
  const source = document.getElementById('coverage-crop-source');
  if (!source) return null;
  source.naturalWidth = 1200; source.naturalHeight = 400;
  selectCoverageCropSlot('profile');
  const held = () => slotSelectedFile(ensureCoverageSlots('characters', P.characters.find(x => x.id === 'CHAR-NC')).find(s => s.id === 'profile'));
  const before = held();
  await extractCoverageCrop({ assign: ${assign ? "true" : "false"} });
  return { before, after: held() };
})()`;

/* ===========================================================================
   N7 — A GAP NOTHING IS WAITING ON MAY NOT CLAIM ATTENTION.

   The alpha finding, exactly: the panel says "No shot uses this character yet,
   so nothing is required now" and the board twenty inches below it prints amber
   "Required — missing" chips for views the coverage TEMPLATE seeded. Blind the
   chip to the demand answer and the contradiction comes straight back.
   =========================================================================== */
controlAsync({
  label: "N7 a dormant coverage gap is never displayed as Required",
  /* Skip the join and the chip prints the STRUCTURAL answer again, which is the
     exact contradiction: "Required — missing" in amber under a panel that has just
     said nothing is required now. */
  mutateSource: only("entities.js", (text) => mutate(
    text,
    '  if (requirement !== "required" || isDefault || !demand) return requirement;',
    '  if (requirement !== "required" || isDefault || !demand || true) return requirement;',
    "N7")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), COVERAGE_STORAGE, mutateSource);
    const html = rendered.html;
    const strip = /data-demand-summary-now="(\d+)"/.exec(html);
    if (!strip) return { reached: false, held: false, reason: "no-demand-summary" };
    if (strip[1] !== "0") return { reached: false, held: false, reason: `strip-counts-${strip[1]}` };
    const start = html.indexOf('<nav class="bounded-slot-rail"');
    if (start < 0) return { reached: false, held: false, reason: "no-slot-rail" };
    const rail = html.slice(start, html.indexOf("</nav>", start));
    const claimed = /tone-attention/.test(rail) || /Required/.test(rail)
      || /data-slot-state="required-missing"/.test(rail);
    return {
      reached: true,
      held: !claimed,
      /* Count-free, because project normalisation seeds template slots beside the
         fixture's own and the number of chips is not the property. */
      reason: claimed ? "dormant-board-displayed-required" : "displayed-as-planned",
    };
  },
  reason: "dormant-board-displayed-required",
  explain: "One screen saying both 'nothing is required now' and 'Required — missing' is the contradiction this correction exists to remove.",
});

/* ===========================================================================
   N11 — AND "REQUIRED" MUST STILL APPEAR WHERE IT IS TRUE.

   The other direction of the same join, and the one that stops the collapse from
   being a blanket rename. Soften unconditionally and a continuity state a shot is
   actually waiting on stops asking for anything.
   =========================================================================== */
controlAsync({
  label: "N11 a target the production is waiting on still reads Required",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    '  return resolved.state === "required-now" ? "required" : "planned";',
    '  void resolved; return "planned";',
    "N11")),
  probe: async (mutateSource) => {
    const project = uxFixture();
    const character = project.characters.find((row) => row.id === "CHAR-NC");
    character.continuityStates.push({
      id: "state-soaked", name: "Soaked", isDefault: false, parentStateId: "state-default",
      approvedFile: "", notes: "Rain.", referenceRequirement: "required", generationMode: "derive",
    });
    for (const shot of project.shots || []) {
      shot.characters = ["CHAR-NC"];
      shot.continuityStateSelections = { "CHAR-NC": "state-soaked" };
    }
    const rendered = await draw(project, {
      ...COVERAGE_STORAGE,
      "cinebraid-bounded:fixture:selected:entity-coverage-view:characters:CHAR-NC": "states",
    }, mutateSource);
    const html = rendered.html;
    const start = html.indexOf('<nav class="continuity-state-rail"');
    if (start < 0) return { reached: false, held: false, reason: "no-state-rail" };
    const rail = html.slice(start, html.indexOf("</nav>", start));
    const owed = (/data-states-outstanding="(\d+)"/.exec(rail) || [])[1];
    if (owed === undefined) return { reached: false, held: false, reason: "no-outstanding-count" };
    const asks = /Soaked<\/b><small>Required</.test(rail) && owed !== "0";
    return {
      reached: true,
      held: asks,
      reason: asks ? "required-where-it-is-true" : "owed-target-stopped-asking",
    };
  },
  reason: "owed-target-stopped-asking",
  explain: "A join that only ever softens is a rename, and a state a shot is waiting on would go quiet.",
});

/* ===========================================================================
   N8 — SAVE CROP & USE MUST ACTUALLY USE IT.

   The atomic action's whole content. Sever the assignment and the button still
   saves, still returns to Coverage, and leaves the view it named empty — which
   is the pre-slice defect the human pass reported as "I had to select it again".
   =========================================================================== */
controlAsync({
  label: "N8 Save crop & use converges into the view it named",
  mutateSource: only("coverage-automation.js", (text) => mutate(
    text, "    const approve = assign;", "    const approve = false; void assign;", "N8")),
  probe: async (mutateSource) => {
    const harness = drawExtractor(mutateSource);
    const rendered = await harness.render();
    const out = await vm.runInContext(EXTRACTOR_DRIVE(true), rendered.context);
    if (!out) return { reached: false, held: false, reason: "no-extractor" };
    if (out.before !== "") return { reached: false, held: false, reason: "view-was-not-empty" };
    if (!harness.uploaded.length) return { reached: false, held: false, reason: "no-crop-uploaded" };
    const landed = out.after === harness.uploaded[harness.uploaded.length - 1];
    return {
      reached: true,
      held: landed,
      reason: landed ? "view-holds-the-crop" : "save-crop-and-use-left-the-view-empty",
    };
  },
  reason: "save-crop-and-use-left-the-view-empty",
  explain: "An action that names a view and says USE must fill it, or the filmmaker has to make the decision twice.",
});

/* ===========================================================================
   N9 — AND SAVE AS CANDIDATE MUST NOT.

   The other half of the same distinction, and the more dangerous one: an
   assignment nobody asked for silently replaces what a view was holding.
   =========================================================================== */
controlAsync({
  label: "N9 Save as candidate assigns nothing",
  mutateSource: only("coverage-automation.js", (text) => mutate(
    text, "    const approve = assign;", "    const approve = true; void assign;", "N9")),
  probe: async (mutateSource) => {
    const harness = drawExtractor(mutateSource);
    const rendered = await harness.render();
    const out = await vm.runInContext(EXTRACTOR_DRIVE(false), rendered.context);
    if (!out) return { reached: false, held: false, reason: "no-extractor" };
    if (out.before !== "") return { reached: false, held: false, reason: "view-was-not-empty" };
    if (!harness.uploaded.length) return { reached: false, held: false, reason: "no-crop-uploaded" };
    const untouched = out.after === "";
    return {
      reached: true,
      held: untouched,
      reason: untouched ? "view-unchanged" : "save-as-candidate-assigned-the-view",
    };
  },
  reason: "save-as-candidate-assigned-the-view",
  explain: "Saving something for later is not choosing it, and a build that blurs the two decides for the filmmaker.",
});

/* ===========================================================================
   N10 — AN ACTION MAY NOT OFFER A DECISION THAT IS ALREADY MADE.

   Remove the state owner's answer and Candidate Review offers "ASSIGN TO FRONT"
   over a candidate the Front view is already holding — a press that re-commits
   the same file and rewrites the timestamp of a decision nobody changed.
   =========================================================================== */
controlAsync({
  label: "N10 a candidate the view already holds is offered no assignment",
  mutateSource: only("review.js", (text) => mutate(
    text,
    '  return slot && slotSelectedFile(slot) === String(fileName || "") ? slot : null;',
    "  void slot; return null;",
    "N10")),
  probe: async (mutateSource) => {
    const project = uxFixture();
    const character = project.characters.find((row) => row.id === "CHAR-NC");
    character.coverageSlots[0].selectedFile = "CHAR-NC-LOOSE.png";
    const row = character.candidateFiles.find((item) => item.stored === "CHAR-NC-LOOSE.png");
    row.targetCoverageSlotId = "front";
    row.targetCoverageSlotName = "Front";
    row.coverageGroup = "angles";
    row.decision = "selected-coverage";
    const rendered = await draw(project, COVERAGE_STORAGE, mutateSource);
    const out = vm.runInContext(`(() => {
      const entity = P.characters.find(x => x.id === 'CHAR-NC');
      const front = ensureCoverageSlots('characters', entity).find(s => s.id === 'front');
      openEntityCandidateReview('characters','CHAR-NC','CHAR-NC-LOOSE.png','state-default');
      return { held: slotSelectedFile(front), modal: document.getElementById('modal').innerHTML };
    })()`, rendered.context);
    if (out.held !== "CHAR-NC-LOOSE.png") return { reached: false, held: false, reason: `view-holds(${out.held})` };
    if (!out.modal.includes("CANDIDATE REVIEW")) return { reached: false, held: false, reason: "no-review-modal" };
    const offered = /ASSIGN TO FRONT/.test(out.modal);
    return {
      reached: true,
      held: !offered,
      reason: offered ? "offered-to-assign-what-the-view-already-holds" : "current-state-stated-instead",
    };
  },
  reason: "offered-to-assign-what-the-view-already-holds",
  explain: "An offer to make a decision already made is a control whose only effect is to overwrite its own timestamp.",
});

/* ===========================================================================
   CORRECTION 2 — THE AUTOMATION DIALOG'S COPY.
   =========================================================================== */

/* Opening the dialog needs image generation configured. The page's own config
   object is set here — nothing is contacted, START is never pressed, and the
   route guard is not involved because no request is made. */
const drawAutomation = (project, mutateSource) => draw(project, COVERAGE_STORAGE, mutateSource);
const AUTOMATION_DRIVE = `(() => {
  CONFIG.generation = CONFIG.generation || {};
  CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: true, keySource: "environment" };
  const e = P.characters.find(x => x.id === 'CHAR-NC');
  const slots = ensureCoverageSlots('characters', e).filter(s => !s.retired);
  openCoverageAutomationModal('characters','CHAR-NC','hybrid');
  const modal = document.getElementById('modal').innerHTML;
  return {
    opened: modal.includes('COVERAGE AUTOMATION'),
    unfilled: slots.filter(s => isRequiredCoverage(s) && !slotSelectedFile(s)).length,
    summary: (/id="coverage-missing-summary">([^<]*)</.exec(modal) || [])[1] || '',
  };
})()`;

/* ===========================================================================
   N12 — THE DIALOG'S WORDS COME FROM THE JOIN, NOT FROM ITS OWN OPINION.

   The whole claim of correction 2 is that the automation copy consumes
   effectiveReferenceRequirement() rather than inferring demand for itself. Break
   the join so it answers `required` for everything, and the dialog must go back
   to calling a plan nothing is waiting on "required ... still missing" — on the
   same screen as a board that reads Planned.
   =========================================================================== */
controlAsync({
  label: "N12 the automation dialog describes work through the shared join",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    '  if (requirement !== "required" || isDefault || !demand) return requirement;',
    '  if (requirement !== "required" || isDefault || !demand || true) return requirement;',
    "N12")),
  probe: async (mutateSource) => {
    const rendered = await drawAutomation(uxFixture(), mutateSource);
    const out = vm.runInContext(AUTOMATION_DRIVE, rendered.context);
    if (!out.opened) return { reached: false, held: false, reason: "no-automation-dialog" };
    if (!out.unfilled) return { reached: false, held: false, reason: "nothing-unfilled" };
    if (!out.summary) return { reached: false, held: false, reason: "no-dialog-summary" };
    const claims = /required/i.test(String(out.summary).split(".")[0]);
    return {
      reached: true,
      held: !claims,
      reason: claims ? "dialog-called-a-dormant-plan-required" : "dialog-described-the-plan-as-planned",
    };
  },
  reason: "dialog-called-a-dormant-plan-required",
  explain: "A dialog that names its own demand answer is the second owner this correction exists to prevent.",
});

/* ===========================================================================
   N13 — AND THE STRUCTURAL WORK SET STILL DECIDES WHAT IS BUILT.

   The other direction, and the one that matters commercially: if the presentation
   answer ever reached the selection, "Generate coverage" would plan nothing on a
   reference no shot has cast — which is most of them, most of the time. Make
   missingCoverageSlots() select on the effective answer and the count the dialog
   offers must collapse.
   =========================================================================== */
controlAsync({
  label: "N13 generation still selects the structural coverage plan",
  mutateSource: only("coverage-automation.js", (text) => mutate(
    text,
    "    return slots.filter((slot) => !slotSelectedFile(slot) && (includeOptional || isRequiredCoverage(slot)));",
    "    return slots.filter((slot) => !slotSelectedFile(slot) && (includeOptional\n"
    + '      || effectiveReferenceRequirement(slot, entityDemandContext(list, entity)) === "required"));',
    "N13")),
  probe: async (mutateSource) => {
    const rendered = await drawAutomation(uxFixture(), mutateSource);
    const out = vm.runInContext(AUTOMATION_DRIVE, rendered.context);
    if (!out.opened) return { reached: false, held: false, reason: "no-automation-dialog" };
    if (!out.unfilled) return { reached: false, held: false, reason: "nothing-unfilled" };
    if (!out.summary) return { reached: false, held: false, reason: "no-dialog-summary" };
    /* AN EMPTY WORK SET IS THE DEFECT, NOT A MISSED CHECKPOINT. With nothing to
       offer the dialog stops printing a number at all and says every view is
       filled — which is exactly the collapse this control is watching for, so it
       reads as an offer of none rather than as a probe that failed to run. */
    const counted = /^(\d+)/.exec(String(out.summary));
    const offered = counted ? Number(counted[1]) : 0;
    return {
      reached: true,
      held: offered === out.unfilled,
      /* Count-free: project normalisation seeds template slots beside the fixture's
         own, so how MANY the plan holds is not the property — that generation
         offers fewer of them than the structural set is. */
      reason: offered === out.unfilled ? "structural-work-set-offered" : "generation-offered-less-than-the-plan",
    };
  },
  reason: "generation-offered-less-than-the-plan",
  explain: "Coverage automation exists to build the entity's plan; a plan nothing is waiting on is still the plan.",
});

/* ===========================================================================
   CORRECTION 3 — THE PRIMARY HERO.
   =========================================================================== */

const HERO_STORAGE = { "cinebraid-focused:fixture:entity-task:characters:CHAR-NC": "reference" };
const heroLineOf = (html) => (/class="reference-primary-remaining">([^<]*)</.exec(html) || [])[1] || "";
/* The plan the hero names, read from the structural owner rather than from the
   sentence — so "the plan is unchanged" is a claim about the set, not the prose. */
const HERO_PLAN = `(() => {
  const e = P.characters.find(x => x.id === 'CHAR-NC');
  return ensureCoverageSlots('characters', e)
    .filter(s => !s.retired && coverageRequirement(s) === 'required' && !slotSelectedFile(s))
    .map(s => s.label || s.id);
})()`;

/* ===========================================================================
   N14 — THE HERO MAY NOT CALL A DORMANT PLAN AN OBLIGATION.

   Put the structural answer back in front of the join and the top of the reference
   says "Views still needed" over chips that read Planned — the contradiction this
   correction exists to remove, on the surface a filmmaker reads first.
   =========================================================================== */
controlAsync({
  label: "N14 the hero describes a dormant plan as a plan",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    "  const heroOwed = heroMissing.filter((slot) => effectiveReferenceRequirement(slot, heroDemand) === \"required\").length;",
    "  const heroOwed = heroMissing.length; void heroDemand;",
    "N14")),
  probe: async (mutateSource) => {
    const rendered = await draw(uxFixture(), HERO_STORAGE, mutateSource);
    const line = heroLineOf(rendered.html);
    if (!line) return { reached: false, held: false, reason: "no-hero-remaining-line" };
    const plan = vm.runInContext(HERO_PLAN, rendered.context);
    if (!plan.length) return { reached: false, held: false, reason: "nothing-unfilled" };
    const claims = /still needed/.test(line);
    return {
      reached: true,
      held: !claims,
      /* THE PLAN ITSELF IS UNCHANGED EITHER WAY — the sentence moves, the set does
         not, and a control that let the set shrink would be proving the wrong thing. */
      named: plan.every((label) => line.includes(label) || /more\./.test(line)),
      reason: claims ? "hero-called-a-dormant-plan-still-needed" : "hero-described-the-plan-as-planned",
    };
  },
  reason: "hero-called-a-dormant-plan-still-needed",
  explain: "The first line of the reference is the one a fresh user believes, and it was the last one still saying it.",
});

/* ===========================================================================
   N15 — AND IT MAY NOT SOFTEN WHAT IT CANNOT PROVE.

   The other direction. Make the join answer `planned` unconditionally and a
   reference whose demand cannot be established stops warning about work it has no
   way of knowing is safe to stand down.
   =========================================================================== */
controlAsync({
  label: "N15 an unprovable demand keeps the hero's warning",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    '  return resolved.state === "required-now" ? "required" : "planned";',
    '  void resolved; return "planned";',
    "N15")),
  probe: async (mutateSource) => {
    /* The reproduced ambiguity: a second character whose id is a PREFIX of this
       one, so the shot's token matches two entities and the demand answer cannot
       be given. */
    const project = uxFixture();
    project.characters.unshift({ id: "CHAR", name: "Other", prefix: "CHAR", approvedFile: "",
      continuityStates: [{ id: "state-default", name: "Default", isDefault: true, approvedFile: "" }],
      coverageSlots: [], expressionSlots: [], candidateFiles: [] });
    for (const shot of project.shots || []) { shot.characters = []; shot.codes = ["CHAR-NC"]; }
    const rendered = await draw(project, HERO_STORAGE, mutateSource);
    const line = heroLineOf(rendered.html);
    if (!line) return { reached: false, held: false, reason: "no-hero-remaining-line" };
    const known = vm.runInContext(`(() => {
      const e = P.characters.find(x => x.id === 'CHAR-NC');
      return entityReferenceDemandFor('characters', e).known;
    })()`, rendered.context);
    if (known !== false) return { reached: false, held: false, reason: "demand-was-answerable" };
    const warns = /still needed/.test(line);
    return {
      reached: true,
      held: warns,
      reason: warns ? "hero-failed-closed" : "hero-softened-an-unprovable-demand",
    };
  },
  reason: "hero-softened-an-unprovable-demand",
  explain: "Cannot-prove-safe is not known-no-demand, and the surface read first is the worst place to blur them.",
});

/* ===========================================================================
   N16 — A CHOOSER WITH NOTHING TO CHOOSE, ON THE SECOND SURFACE.

   R1 was applied to the intake modal and not to the generation-record fold, so
   the same empty <select> went on rendering one file over. Put the unconditional
   chooser back and a project with no model list is asked to pick from a list
   whose only entry is the placeholder.

   The mutation restores the SHIPPED-BEFORE markup exactly, so what this control
   watches fail is the real historical behaviour rather than an invented one.
   =========================================================================== */
controlAsync({
  label: "N16 a provenance chooser with one non-answer is not rendered",
  mutateSource: only("entities.js", (text) => mutate(
    text,
    "  if (!models.length) {\n"
    + '    return recorded ? `<span class="opt-id" data-provenance-model="static">${esc(recorded)}</span>` : "";\n'
    + "  }",
    "  /* mutated: the pre-R1 unconditional chooser */",
    "N16")),
  probe: async (mutateSource) => {
    const project = uxFixture();
    project.characters[0].made = [{ model: "", files: "CHAR-NC-PRIMARY.png", prompt: "p", date: "2026-08-01" }];
    const rendered = await draw(project, COVERAGE_STORAGE, mutateSource);
    const fold = vm.runInContext(
      `entityGenerationRecordsMarkup('characters', P.characters.find((x) => x.id === 'CHAR-NC'))`,
      rendered.context);
    if (!String(fold).includes("Generation records")) return { reached: false, held: false, reason: "no-fold" };
    const models = vm.runInContext("(P.meta.models || []).length", rendered.context);
    if (models !== 0) return { reached: false, held: false, reason: "fixture-had-models" };
    const chooser = /<select/.test(fold);
    return {
      reached: true,
      held: !chooser,
      reason: chooser ? "empty-chooser-rendered" : "no-chooser",
    };
  },
  reason: "empty-chooser-rendered",
  explain: "A control offering one non-answer asks for a decision that does not exist, and costs a field of space to do it.",
});

/* ===========================================================================
   N17 — THE TARGET LIST READS THE KEY THE WRITER DELETES.

   The highest-consequence of the two residuals, because it is the one that can
   cost work rather than attention: restore the `slot.approvedFile` read and the
   extraction panel offers an already-assigned view as though it were empty, with
   the panel's own default target still — correctly — skipping past it.

   The control asserts the PREMISE separately (the writer really did delete the
   legacy key), so a future change that stopped deleting it would fail this
   control loudly rather than let it pass for the wrong reason.
   =========================================================================== */
controlAsync({
  label: "N17 a target list names the view it would overwrite",
  mutateSource: only("coverage-automation.js", (text) => mutate(
    text,
    '${slotSelectedFile(slot) ? " · already assigned" : ""}',
    '${slot.approvedFile ? " · already assigned" : ""}',
    "N17")),
  probe: async (mutateSource) => {
    const project = uxFixture();
    project.characters[0].candidateFiles.push({
      stored: "CHAR-NC-SHEET.png", original: "CHAR-NC-SHEET.png", decision: "unreviewed",
      coverageJobType: "sheet", coverageSheetType: "angles",
    });
    const rendered = await render("#/character/CHAR-NC", project, {
      scan: {
        anchors: ["CHAR-NC-PRIMARY.png", "CHAR-NC-LOOSE.png", "CHAR-NC-SHEET.png"]
          .map((name) => ({ name, url: `/assets/anchors/${name}` })),
        plates: [], props: [], vehicles: [], audio: [], media: [],
        shots: { "L1-01": { takes: [], locked: [] } },
      },
      storage: { ...COVERAGE_STORAGE },
      ...(mutateSource ? { mutateSource } : {}),
    });
    const out = vm.runInContext(`(() => {
      const e = P.characters.find((x) => x.id === 'CHAR-NC');
      const first = ensureCoverageSlots('characters', e)[0];
      const wrote = assignSlotReference(first, { fileName: 'CHAR-NC-LOOSE.png', by: 'human', via: 'test', at: '2026-08-29T00:00:00Z' });
      openCoverageSheetExtractor('characters','CHAR-NC','CHAR-NC-SHEET.png', true);
      const html = document.getElementById('modal').innerHTML;
      const a = html.indexOf('<select id="coverage-crop-slot"');
      return {
        assigned: !!(wrote && wrote.assigned),
        legacyGone: first.approvedFile === undefined,
        list: a < 0 ? '' : html.slice(a, html.indexOf('</select>', a)),
      };
    })()`, rendered.context);
    if (!out.assigned) return { reached: false, held: false, reason: "writer-did-not-assign" };
    if (!out.legacyGone) return { reached: false, held: false, reason: "writer-kept-the-legacy-key" };
    if (!out.list) return { reached: false, held: false, reason: "no-target-list" };
    const named = out.list.includes("Front · already assigned");
    return {
      reached: true,
      held: named,
      reason: named ? "occupied-view-named" : "occupied-view-offered-as-empty",
    };
  },
  reason: "occupied-view-offered-as-empty",
  explain: "An occupied target that looks free is how an assignment gets silently overwritten by the next crop.",
});

/* ===========================================================================
   N18 — BATCH APPROVAL MAY NOT PRESENT AN OCCUPIED TARGET AS FREE.

   The same deleted key as N17, on the surface where reading it stale is most
   expensive: this is the human confirmation step, and confirming it REPLACES the
   reference. The replacement path itself asks slotSelectedFile() and records
   `CURRENT-FRONT.png -> NEW-FRONT.png` correctly, so the defect was never that
   the product lost track of the occupant — it was that the sentence a person
   reads before saying yes did not mention it.

   The mutation restores the exact `?.approvedFile` optional chain that shipped,
   so what fails here is the real historical behaviour.
   =========================================================================== */
controlAsync({
  label: "N18 batch approval names the reference it would replace",
  mutateSource: only("review.js", (text) => mutate(
    text,
    "slotSelectedFile([...(entity.coverageSlots || []), ...(entity.expressionSlots || [])].find((slot) => slot.id === item.best.slotId))",
    "[...(entity.coverageSlots || []), ...(entity.expressionSlots || [])].find((slot) => slot.id === item.best.slotId)?.approvedFile",
    "N18")),
  probe: async (mutateSource) => {
    const project = uxFixture();
    project.characters[0].candidateFiles.push(
      { stored: "CURRENT-FRONT.png", original: "CURRENT-FRONT.png", decision: "unreviewed" },
      { stored: "NEW-FRONT.png", original: "NEW-FRONT.png", decision: "unreviewed" },
    );
    const rendered = await draw(project, COVERAGE_STORAGE, mutateSource);
    const out = vm.runInContext(`(() => {
      const e = P.characters.find((x) => x.id === 'CHAR-NC');
      const slot = ensureCoverageSlots('characters', e).find((s) => s.id === 'front');
      const wrote = assignSlotReference(slot, { fileName: 'CURRENT-FRONT.png', by: 'human', via: 'test', at: '2026-08-29T00:00:00Z' });
      e.candidateReviewBatches = [{ id: 'batch-nc', status: 'completed', results: [{
        fileName: 'NEW-FRONT.png', status: 'completed', pass: true, score: 91, approvable: true,
        contractVersion: 'reference-authority-v3',
        targetKey: 'coverage:front', targetLabel: 'Front', type: 'coverage', slotId: 'front',
      }] }];
      openEntityBatchApproval('characters', 'CHAR-NC', 'batch-nc');
      const html = document.getElementById('modal').innerHTML;
      const a = html.indexOf('entity-batch-approval-list');
      return {
        assigned: !!(wrote && wrote.assigned),
        legacyGone: slot.approvedFile === undefined,
        canonical: slotSelectedFile(slot),
        body: a < 0 ? '' : html.slice(a, html.indexOf('modal-actions', a)),
      };
    })()`, rendered.context);
    if (!out.assigned) return { reached: false, held: false, reason: "writer-did-not-assign" };
    if (!out.legacyGone) return { reached: false, held: false, reason: "writer-kept-the-legacy-key" };
    if (out.canonical !== "CURRENT-FRONT.png") return { reached: false, held: false, reason: "slot-does-not-hold-the-file" };
    if (!out.body) return { reached: false, held: false, reason: "no-batch-approval-modal" };
    const named = out.body.includes("replaces CURRENT-FRONT.png");
    return {
      reached: true,
      held: named,
      reason: named ? "replacement-named" : "occupied-target-confirmed-as-empty",
    };
  },
  reason: "occupied-target-confirmed-as-empty",
  explain: "Confirming this replaces the reference, so a confirmation that cannot name the occupant is the one place this defect costs work.",
});

/* ---------------------------------------------------------------------------
   NO CATCH-AS-SUCCESS. Enforced, not promised. */
function testNoCatchAsSuccess() {
  const text = toLF(fs.readFileSync(__filename, "utf8"));
  assert.ok(!/catch\s*\([^)]*\)\s*\{[^}]*controls\s*\+\+/.test(text),
    "a control must never count itself as passed from inside a catch");
  /* The real hazard is CLASSIFYING an assertion failure as the firing this suite
     was looking for. Naming the word in prose is not that; branching on it is. */
  assert.ok(!/instanceof\s+(assert\.)?AssertionError/.test(text),
    "no control may branch on an AssertionError");
  /* Built rather than written, so this line does not match itself. */
  assert.ok(!new RegExp(["ERR", "ASSERTION"].join("_")).test(text),
    "no control may recognise an assertion failure code as a result");
  /* And every control must state the exact bad state it expects. */
  const declared = (text.match(/^\s*reason: "/gm) || []).length;
  assert.strictEqual(declared, controls,
    `every control must name its expected failure (${controls} controls, ${declared} named reasons)`);
}

async function main() {
  await Promise.all(pending);
  testNoCatchAsSuccess();
  console.log(`References UX convergence negative controls: ${controls} controls, each broken in memory and watched to fail.`);
  for (const note of notes) console.log(note);
  console.log("No file in the working tree was modified. Provider calls made: 0.");
}

main().catch((error) => { console.error(error); process.exit(1); });
