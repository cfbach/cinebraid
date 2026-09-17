/* CineBraid EV2-7 — THE SHOT DESK READS AS ONE SYSTEM.
 *
 * The human dogfood ruling on the Shot Desk was a visual-coherence finding with four
 * behavioural halves, and this suite holds those halves rather than a screenshot:
 *
 *   A  ONE ACTION PER RESULT TARGET. When the hero leads with a returned result for Frame A,
 *      Frame A has exactly one action — the hero's exact-key review — and the rail says so in
 *      words instead of offering "Frame A Results" onto the same place under another name.
 *      Every other target keeps its one named Results button, resolved at the press.
 *
 *   B  ONE COMPACT LIST OF WHAT ELSE IS OUTSTANDING. Plain rows beneath the hero's body, not
 *      a bordered card nested inside it; at most three, then how many more; visible rather
 *      than folded away; the canonical label, the canonical reason and one quiet text link.
 *
 *   C  ONE WARM ACTION. var(--cb-action-warm) belongs to the hero's one control and to
 *      nothing else on this page.
 *
 *   D  MISSING APPROVED BYTES, TOLD HONESTLY AND WITHOUT DOWNGRADING THE RECEIPT. The stage
 *      strip, the facts line, the hero and the rail each say both true things — an approval
 *      is recorded, and its file is not in this project — and the one repair is built out of
 *      owners that already exist. Cancelling writes nothing.
 *
 * Four in-memory negative controls restore each defect and require this suite to go red.
 *
 * NO PROJECT DATA IS TOUCHED. NO SERVER IS STARTED. NO PROVIDER OR PAID CALL IS MADE.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { render, rawFixture, withCanon } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const readLF = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const equal = (a, b, m) => { checks += 1; assert.strictEqual(a, b, m); };
const deepEqual = (a, b, m) => { checks += 1; assert.deepStrictEqual(a, b, m); };
const ok = (v, m) => { checks += 1; assert(v, m); };
const evaluate = (context, body) => JSON.parse(vm.runInContext(`JSON.stringify((() => { ${body} })())`, context));

/* ---------------------------------------------------------------- fixtures
   The shipped shapes, built the way tests/ev2-7-shot-leading-action.js builds them. */
const CAST_CANON = [
  { kind: "entity-state", list: "characters", entityId: "KAI", stateId: "state-default", value: "KAI-ANCHOR.png" },
  { kind: "entity-state", list: "locations", entityId: "LOC-HULL", stateId: "state-default", value: "LOC-HULL-PLATE.png" },
  { kind: "entity-state", list: "props", entityId: "PR-TOOL", stateId: "state-default", value: "PR-TOOL-PLATE.png" },
];
const MOTION_CLIP = { id: "motion-a", label: "A", suffix: "a", title: "Panel check", kind: "i2v", fromFrame: "frame-a", toFrame: "", dur: 5, motionPrompt: "He checks the panel.", generationPackages: [] };
function projectOf(shots, { canon = CAST_CANON } = {}) {
  const project = rawFixture();
  const template = project.shots[0];
  project.shots = shots.map((spec) => ({
    ...JSON.parse(JSON.stringify(template)),
    id: spec.id,
    title: spec.title || `Shot ${spec.id}`,
    keyframes: (spec.frames || [{ id: "frame-a", label: "A" }]).map((frame) => ({
      id: frame.id, label: frame.label, title: `Frame ${frame.label}`, winner: frame.winner || "",
      description: "Worker at panel.", required: true, generationPackages: [],
    })),
    clips: spec.clips || [],
    candidateFiles: spec.candidates || [],
    creationBrief: { deliveryIntent: "still", ...(spec.creationBrief || {}) },
    promptBuilds: [],
    promptOptions: [],
  }));
  const frameCanon = [];
  for (const spec of shots)
    for (const frame of spec.frames || [])
      if (frame.winner) frameCanon.push({ kind: "shot-frame", shotId: spec.id, frameId: frame.id, value: frame.winner });
  return withCanon(project, [...canon, ...frameCanon]);
}
function scanWith(project, takesByShot) {
  const approved = (list, dir) => (project[list] || []).filter((x) => x.approvedFile).map((x) => ({ name: x.approvedFile, url: `/assets/${dir}/${x.approvedFile}` }));
  return {
    anchors: approved("characters", "anchors"), plates: approved("locations", "plates"), props: approved("props", "props"),
    vehicles: [], audio: [], media: [],
    shots: Object.fromEntries((project.shots || []).map((shot) => [shot.id, {
      takes: (takesByShot[shot.id] || []).map((name) => ({ name, url: `/assets/shots/${shot.id}/takes/${name}` })),
      locked: [],
    }])),
  };
}
const candidate = (name, extra = {}) => ({
  stored: name, original: name, notes: "", labels: [],
  addedAt: extra.addedAt || "2026-08-20T10:00:00.000Z",
  decision: extra.decision || "unreviewed",
  frameId: extra.frameId === undefined ? "frame-a" : extra.frameId,
  generationJobId: `job-${name}`, generationProvider: "fal", generationModel: "gpt-image-2",
});
const keyOf = (shotId, name) => `path:shots/${shotId}/takes/${name}`;

/* ---------------------------------------------------------------- readers */
const mainOf = (page) => page.context.document.getElementById("main").innerHTML;
const heroOf = (html) => (html.match(/<section class="guided-next-action[\s\S]*?<\/section>/) || [""])[0];
const railOf = (html) => (html.match(/<section class="shot-results-rail[\s\S]*?<\/section>/) || [""])[0];
const factsOf = (html) => (html.match(/<p class="shot-facts"[\s\S]*?<\/p>/) || [""])[0];
const targetOf = (html, kind, frameId = "") =>
  (railOf(html).match(new RegExp(`<article class="shot-results-target" data-results-target="${kind}"${frameId ? ` data-frame-id="${frameId}"` : ""}[\\s\\S]*?</article>`)) || [""])[0];
const railEntries = (html) => [...railOf(html).matchAll(/<button type="button" class="ghost-btn shot-results-open" onclick="([^"]*)">([^<]*)<\/button>/g)]
  .map((match) => `${match[2]} → ${match[1]}`);
const primaryActions = (html) => [...html.matchAll(/class="assemble-btn shot-primary-action"[^>]*onclick="([^"]*)"[^>]*>([^<]*)/g)].map((m) => ({ call: m[1], label: m[2] }));
const listOf = (html) => (heroOf(html).match(/<ul class="shot-outstanding"[\s\S]*?<\/ul>/) || [""])[0];
const listRows = (html) => [...listOf(html).matchAll(/<li class="shot-outstanding-row"[^>]*data-shot-outstanding="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g)]
  .map((m) => ({ kind: m[1], text: m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), markup: m[2] }));

/* ===========================================================================
   A — ONE ACTION PER RESULT TARGET.
   =========================================================================== */
async function oneActionPerTarget(options = {}) {
  /* A waiting Frame A result, a second declared frame, and a motion unit: three targets, and
     the one the hero is leading is the only one without a button of its own. */
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    clips: [MOTION_CLIP],
    candidates: [candidate("FRAME_A.png")],
  }]);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }), mutateSource: options.mutate });
  const html = mainOf(page);
  const hero = heroOf(html);
  const key = keyOf("L1-01", "FRAME_A.png");

  deepEqual(primaryActions(html).map((row) => `${row.label} → ${row.call}`),
    [`Review Frame A result → openReturnedResultReview('L1-01','${key}')`],
    "A: the Desk offers exactly one primary action, and it is the hero's exact-key review");
  const frameA = targetOf(html, "frame", "frame-a");
  ok(/data-results-led="1"/.test(frameA), "A: the rail marks Frame A as the target being led: " + frameA);
  ok(frameA.includes("Being reviewed above") && !/<button/.test(frameA),
    "A: and says so in words rather than with a second control: " + frameA);
  ok(/data-results-count="1"/.test(frameA) && /data-results-waiting="1"/.test(frameA) && /data-results-approved="none"/.test(frameA),
    "A: while keeping its count, its waiting count and its Approved state: " + frameA);
  deepEqual(railEntries(html), [
    "Frame B Results → openShotResults('L1-01','frame','frame-b')",
    "Motion Results → openShotResults('L1-01','motion','')",
  ], "A: every other target keeps exactly one named Results button, resolved by openShotResults at the press");
  ok(railOf(html).indexOf('data-frame-id="frame-a"') < railOf(html).indexOf('data-frame-id="frame-b"'),
    "A: and the rail's order and structure are unchanged");
  ok(!/Frame A Results/.test(html), "A: 'Review Frame A result' and 'Frame A Results' are never presented at once");

  /* The same rule from the other side: when MOTION is what came back, Motion is the target
     without a button and both frames keep theirs. */
  const motion = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }, { id: "frame-b", label: "B", winner: "FRAME_B.png" }],
    clips: [MOTION_CLIP],
    candidates: [candidate("SHOT_MOTION.mp4", { frameId: "", addedAt: "2026-08-20T12:00:00.000Z" })],
  }]);
  const motionPage = await render("#/shot/L1-01", motion, { scan: scanWith(motion, { "L1-01": ["FRAME_A.png", "FRAME_B.png", "SHOT_MOTION.mp4"] }), mutateSource: options.mutate });
  const motionHtml = mainOf(motionPage);
  equal(primaryActions(motionHtml).length, 1, "A: still exactly one primary action when motion leads");
  ok(/Review motion result/.test(primaryActions(motionHtml)[0].label), "A: and it is the motion review: " + primaryActions(motionHtml)[0].label);
  ok(/data-results-led="1"/.test(targetOf(motionHtml, "motion")) && targetOf(motionHtml, "motion").includes("Being reviewed above"),
    "A: Motion is the led target");
  deepEqual(railEntries(motionHtml), [
    "Frame A Results → openShotResults('L1-01','frame','frame-a')",
    "Frame B Results → openShotResults('L1-01','frame','frame-b')",
  ], "A: while both frames keep their own one entry");

  /* And with nothing waiting, every declared target keeps its named entry. */
  const quiet = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A", winner: "FRAME_A.png" }], clips: [MOTION_CLIP] }]);
  const quietPage = await render("#/shot/L1-01", quiet, { scan: scanWith(quiet, { "L1-01": ["FRAME_A.png"] }), mutateSource: options.mutate });
  deepEqual(railEntries(mainOf(quietPage)), [
    "Frame A Results → openShotResults('L1-01','frame','frame-a')",
    "Motion Results → openShotResults('L1-01','motion','')",
  ], "A: with nothing returned, every target keeps exactly one named Results entry");
  ok(!/data-results-led/.test(mainOf(quietPage)), "A: and no target is marked as led");
}

/* ===========================================================================
   B — THE COMPACT LIST OF WHAT ELSE IS OUTSTANDING.
   =========================================================================== */
async function compactOutstandingList(options = {}) {
  /* A returned Frame A result, a genuine outstanding prerequisite (an unconfirmed
     reference), a second returned result and a result whose file is gone. */
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    clips: [MOTION_CLIP],
    candidates: [
      candidate("FRAME_A.png"),
      candidate("FRAME_B.png", { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" }),
      candidate("LOST.png", { frameId: "frame-b", addedAt: "2026-08-20T10:09:00.000Z" }),
    ],
  }], { canon: CAST_CANON.filter((row) => row.entityId !== "KAI") });
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png", "FRAME_B.png"] }), mutateSource: options.mutate });
  const html = mainOf(page);
  const hero = heroOf(html);
  const readiness = evaluate(page.context, `
    const row = shotReadinessFor(shotById("L1-01"));
    return { code: row.nextAction.code, message: row.nextAction.message, label: readinessActionWords(row.nextAction) };`);
  equal(readiness.code, "confirm-existing-reference", "B: precondition — a genuine prerequisite is outstanding");

  const list = listOf(html);
  ok(list, "B: the hero carries one compact list");
  ok(!/<div class="returned-review-secondary"/.test(html), "B: and no nested secondary card survives anywhere on the Desk");
  ok(!/border|panel/i.test((list.match(/<ul class="shot-outstanding"[^>]*>/) || [""])[0]), "B: the list element carries no card of its own");
  const rows = listRows(html);
  ok(rows.length <= 3, "B: at most three rows are shown, and this one shows " + rows.length);
  deepEqual(rows.map((row) => row.kind), ["readiness", "waiting", "missing"],
    "B: the genuine prerequisite leads, then what else came back, then what cannot be shown");
  ok(rows[0].text.startsWith("Also needed ·"), "B: each row names what kind of outstanding thing it is: " + rows[0].text);
  ok(rows[0].text.includes(readiness.label), "B: the readiness row keeps its canonical label");
  ok(rows[0].text.includes(readiness.message.slice(0, 40)), "B: and its canonical message: " + rows[0].text);
  ok(/onclick="openShotReadinessAction\('L1-01','confirm-existing-reference'\)"/.test(rows[0].markup),
    "B: with a working control, so nothing became unreachable: " + rows[0].markup);
  ok(/class="text-link-btn shot-outstanding-action"/.test(rows[0].markup) && !/assemble-btn|chip|approve-btn/.test(rows[0].markup),
    "B: which is a quiet text link, not a second button competing with the hero: " + rows[0].markup);
  ok(rows[1].text.includes("Review Frame B result") && !/<button/.test(rows[1].markup),
    "B: a waiting result is named, and opened where that target is owned: " + rows[1].markup);
  ok(rows[2].text.includes("cannot be shown"), "B: an unaccounted-for result is never invisible: " + rows[2].text);
  equal((html.match(/shot-primary-action/g) || []).length, 1, "B: and the page still has exactly one primary action");
  /* Visible, not folded: the list is not inside a closed disclosure. */
  ok(!/<details[^>]*>(?:(?!<\/details>)[\s\S])*<ul class="shot-outstanding"/.test(html),
    "B: the list is visible rather than hidden inside a disclosure");
  ok(/data-returned-review-secondary="confirm-existing-reference"/.test(list),
    "B: the readiness code stays readable on the list for every reader that asks");

  /* MORE THAN THREE: the list caps and says how many more. */
  const many = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A" }, { id: "frame-b", label: "B" }],
    candidates: [candidate("A.png"), candidate("B.png", { frameId: "frame-b", addedAt: "2026-08-20T10:05:00.000Z" })],
  }], { canon: CAST_CANON.filter((row) => row.entityId !== "KAI") });
  const manyPage = await render("#/shot/L1-01", many, { scan: scanWith(many, { "L1-01": ["A.png", "B.png"] }), mutateSource: options.mutate });
  const capped = evaluate(manyPage.context, `
    const rows = [
      { kind: "readiness", lead: "Also needed", label: "One", detail: "first" },
      { kind: "waiting", lead: "Also waiting", label: "Two", detail: "second" },
      { kind: "waiting", lead: "Also waiting", label: "Three", detail: "third" },
      { kind: "missing", lead: "Also missing", label: "Four", detail: "fourth" },
      { kind: "missing", lead: "Also missing", label: "Five", detail: "fifth" },
    ];
    const markup = shotOutstandingListMarkup(rows, "produce-frame");
    return { markup, shown: (markup.match(/class="shot-outstanding-row"/g) || []).length };`);
  equal(capped.shown, 3, "B: the list never grows past three rows");
  ok(/<li class="shot-outstanding-more">and 2 more<\/li>/.test(capped.markup), "B: and says how many more there are: " + capped.markup);
  ok(!/Four|Five/.test(capped.markup), "B: without printing them");

  /* A COMPETING "PRODUCE ANOTHER" STAYS SUPPRESSED while a result is waiting, and a real
     outstanding action is never suppressed. */
  const moveOn = projectOf([{ id: "L1-01", candidates: [candidate("FRAME_A.png")] }]);
  const moveOnPage = await render("#/shot/L1-01", moveOn, { scan: scanWith(moveOn, { "L1-01": ["FRAME_A.png"] }), mutateSource: options.mutate });
  const moveOnCode = evaluate(moveOnPage.context, `return shotReadinessFor(shotById("L1-01")).nextAction.code;`);
  equal(moveOnCode, "produce-frame", "B: precondition — readiness would have the filmmaker produce another frame");
  ok(!/produce/i.test(listOf(mainOf(moveOnPage)) || ""), "B: which is not listed while a returned result is unresolved");
  ok(!/produce/i.test(primaryActions(mainOf(moveOnPage))[0].label), "B: and is certainly not the primary action");
}

/* ===========================================================================
   C — ONE WARM ACTION ON THE DESK.
   =========================================================================== */
async function oneWarmAction() {
  const project = projectOf([{ id: "L1-01", frames: [{ id: "frame-a", label: "A" }], clips: [MOTION_CLIP], candidates: [candidate("FRAME_A.png")] }]);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["FRAME_A.png"] }) });
  equal((mainOf(page).match(/shot-primary-action/g) || []).length, 1, "C: one control on the Desk is the current action");

  /* The stylesheet says the same thing: inside the Desk's own sections, the warm accent is
     declared for the hero's primary and for nothing else. The section boundaries are the
     file's own comment banners, so this reads what the Desk owns rather than the whole app. */
  const css = readLF("public/experience-coherence.css");
  const section = (title) => {
    const start = css.indexOf(`/* EV2-7 Checkpoint 2 — ${title}`);
    ok(start >= 0, `C: the stylesheet still declares the "${title}" section`);
    const next = css.indexOf("\n/* EV2-7 ", start + 10);
    return css.slice(start, next < 0 ? css.length : next);
  };
  const desk = ["Stage bar & Shot layout", "Shot Desk", "Shot Desk stage-body type & target floor"].map(section).join("\n");
  /* Comments are stripped before this reads the rules: the notes explaining the one-warm-action
     rule necessarily NAME the token, which is exactly what a presence check must not trip over. */
  const rules = desk.replace(/\/\*[\s\S]*?\*\//g, "");
  const warmRules = rules.split("\n").filter((line) => line.includes("--cb-action-warm"));
  ok(warmRules.length > 0, "C: the hero's action is warm");
  /* Everything these sections scope to the Desk itself. The repair context Results carries is
     declared here too and is deliberately not on this page, so it is named rather than ignored:
     a new leak onto the Desk cannot hide behind the same exemption. */
  const deskScoped = warmRules.filter((line) => /#main \.bounded-shot-workspace|#cb-stage-mount/.test(line));
  const elsewhere = warmRules.filter((line) => !deskScoped.includes(line));
  for (const rule of deskScoped)
    ok(/\.guided-next-action .shot-primary-action/.test(rule),
      "C: the warm accent is declared for the hero's one action and nothing else: " + rule);
  for (const rule of elsewhere)
    ok(/^\.results-desk .rx-repair,\.rx-request .rx-repair/.test(rule.trim()),
      "C: the only warm rule these sections declare off the Desk is the repair context Results carries: " + rule);
  ok(!/border-left:3px solid var\(--acc\)/.test(rules), "C: and no coloured left stripe survives on the Desk's cards");
}

/* ===========================================================================
   D — MISSING APPROVED BYTES, TOLD HONESTLY.
   =========================================================================== */
async function missingApprovedBytes(options = {}) {
  /* The SH-15 state: one declared frame, an approval receipt whose file the project cannot
     show, and a newer candidate waiting for a decision. */
  const project = projectOf([{
    id: "L1-01",
    frames: [{ id: "frame-a", label: "A", winner: "TAKE_01.png" }],
    candidates: [candidate("TAKE_02.png", { addedAt: "2026-08-21T09:00:00.000Z" })],
  }]);
  const page = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["TAKE_02.png"] }), mutateSource: options.mutate });
  const html = mainOf(page);
  const before = evaluate(page.context, `
    const s = shotById("L1-01");
    const takes = takesFor("L1-01");
    const receipt = currentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" });
    const facts = shotStageModelFacts(s, takes);
    const stage = shotStageState("frames", facts);
    return {
      note: boundedShotTaskStatus(s, takes, "frames", facts).note || "",
      status: boundedShotTaskStatus(s, takes, "frames", facts).label,
      completion: stage.completion,
      availability: stage.availability,
      requiredFramesApproved: facts.requiredFramesApproved,
      frameApprovedCount: facts.frameApprovedCount,
      recorded: facts.frameApprovalsRecorded,
      unavailable: facts.frameApprovalsUnavailable,
      readiness: shotReadinessFor(s).nextAction.code,
      receipt: receipt ? { id: receipt.id, value: receipt.value } : null,
      project: JSON.stringify(P),
      revision: SAVE_REVISION,
    };`);

  /* 1. THE STAGE STRIP. */
  equal(before.note, "1 approval recorded · image unavailable",
    "D: the stage strip counts the approval and says its image is unavailable, instead of '0 of 1 frame approved'");
  /* 2. THE FACTS LINE. */
  const facts = factsOf(html);
  ok(/1 approval recorded/.test(facts) && /Approved image unavailable/.test(facts) && !/1 of 1 approved/.test(facts),
    "D: the facts line says both halves rather than '1 of 1 approved': " + facts);
  ok(/data-approved-media="unavailable"/.test(facts), "D: and declares the condition for any reader: " + facts);
  /* 3. THE HERO. */
  const hero = heroOf(html);
  ok(/data-approved-media-unavailable="1"/.test(hero) && /<h2>Locate or replace image<\/h2>/.test(hero),
    "D: integrity repair leads the hero: " + hero);
  deepEqual(primaryActions(html).map((row) => `${row.label} → ${row.call}`),
    ["Locate or replace image → openApprovedMediaRepair('L1-01','frame','frame-a')"],
    "D: with one action, which opens the repair for that exact target");
  ok(/The approval for Frame A is recorded, but TAKE_01\.png is not in this project/.test(hero),
    "D: naming the recorded approval and the file that is missing: " + hero);
  ok(/until you approve a replacement in Results/.test(hero) && !/no longer approved|withdraw|unapproved/i.test(hero),
    "D: and never downgrading the receipt: " + hero);
  ok(/Also waiting ·/.test(hero) && /Review Frame A result/.test(hero) && /TAKE_02\.png came back/.test(hero),
    "D: the waiting candidate appears first in the compact list: " + hero);
  ok(!/<img[^>]*TAKE_02\.png/.test(hero.split('<ul class="shot-outstanding"')[0]),
    "D: and nothing newer stands in for the approved image");
  /* 4. THE RAIL. */
  const target = targetOf(html, "frame", "frame-a");
  ok(/data-results-approved="unavailable"/.test(target) && target.includes("Approved image unavailable")
    && target.includes("TAKE_01.png · receipt kept, file not found"),
    "D: the rail says the same thing, by name: " + target);
  ok(!/<img|<video/.test(target), "D: and shows nothing in its place: " + target);
  /* 5. NOTHING ABOUT AUTHORITY MOVED. */
  const after = evaluate(page.context, `
    const receipt = currentHumanAuthority(P, { kind: "shot-frame", shotId: "L1-01", frameId: "frame-a" });
    return { receipt: receipt ? { id: receipt.id, value: receipt.value } : null, project: JSON.stringify(P), revision: SAVE_REVISION };`);
  deepEqual(after.receipt, before.receipt, "D: the approval receipt is exactly what it was");
  equal(after.project, before.project, "D: the project record is byte-identical");
  equal(after.revision, before.revision, "D: and nothing was marked dirty");
  equal(before.frameApprovedCount, 0, "D: the media-aware evidence count is unchanged by the new presentation facts");
  equal(before.requiredFramesApproved, false, "D: and so is requiredFramesApproved");
  equal(before.completion, "needs-review", "D: the stage's completion is the one it derived before");
  equal(before.availability, "available", "D: and its availability");
  deepEqual([before.recorded, before.unavailable], [1, 1], "D: the two presentation facts are the counts they claim to be");

  /* 6. THE REPAIR DIALOG, MADE OF EXISTING OWNERS. */
  const modal = () => page.context.document.getElementById("modal").innerHTML;
  page.context.openApprovedMediaRepair("L1-01", "frame", "frame-a");
  const dialog = modal();
  ok(/data-approved-media-repair="L1-01"/.test(dialog) && /data-frame-id="frame-a"/.test(dialog), "D: the dialog names the exact target: " + dialog);
  ok(/shots\/L1-01\/takes\/TAKE_01\.png/.test(dialog), "D: it says where the file belongs, in the project's own terms");
  ok(/the approval stays recorded/.test(dialog) && /arrives as a new candidate/.test(dialog),
    "D: it states that the approval stays and that a replacement is a new candidate");
  const controls = [...dialog.matchAll(/<button type="button"[^>]*onclick="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((m) => `${m[2]} → ${m[1]}`);
  deepEqual(controls, [
    "Check again → checkApprovedMediaAgain('L1-01','frame','frame-a')",
    "Import a replacement for Frame A → replaceApprovedMedia('L1-01','frame','frame-a')",
  ], "D: two controls, both scoped to that target: " + JSON.stringify(controls));

  /* Check again asks the SHIPPED local-folder sync (#rescan), and nothing else. */
  const rescan = page.context.document.getElementById("rescan");
  let pressed = 0;
  rescan.click = () => { pressed += 1; };
  const quiet = evaluate(page.context, `return { project: JSON.stringify(P), revision: SAVE_REVISION };`);
  page.context.checkApprovedMediaAgain("L1-01", "frame", "frame-a");
  equal(pressed, 1, "D: Check again presses the shipped local-folder sync rather than reading a path itself");
  const afterCheck = evaluate(page.context, `return { project: JSON.stringify(P), revision: SAVE_REVISION };`);
  deepEqual(afterCheck, quiet, "D: and checking writes nothing");

  /* Replace goes to the SHIPPED import path, for that exact frame. */
  const reached = [];
  page.context.openShotImportChooser = (shotId) => reached.push(`openShotImportChooser(${shotId})`);
  page.context.chooseShotImportTarget = (shotId, kind, frameId) => reached.push(`chooseShotImportTarget(${shotId},${kind},${frameId})`);
  page.context.replaceApprovedMedia("L1-01", "frame", "frame-a");
  deepEqual(reached, ["openShotImportChooser(L1-01)", "chooseShotImportTarget(L1-01,frame,frame-a)"],
    "D: Replace reaches the existing import owner with the exact target, and creates no second store");

  /* Cancel writes nothing at all. */
  page.context.closeModal();
  const afterCancel = evaluate(page.context, `
    const modal = document.getElementById("modal");
    return { project: JSON.stringify(P), revision: SAVE_REVISION, hidden: !!modal.classList.contains("hidden") };`);
  equal(afterCancel.project, before.project, "D: cancelling leaves the project byte-identical");
  equal(afterCancel.revision, before.revision, "D: and marks nothing dirty");
  ok(afterCancel.hidden, "D: and the dialog is dismissed through the shipped door");

  /* 7. AND WHEN THE FILE COMES BACK, everything above simply stops saying it. */
  const restored = await render("#/shot/L1-01", project, { scan: scanWith(project, { "L1-01": ["TAKE_01.png", "TAKE_02.png"] }), mutateSource: options.mutate });
  const restoredHtml = mainOf(restored);
  ok(!/data-approved-media-unavailable/.test(restoredHtml), "D: with the file present the integrity repair disappears");
  ok(!/unavailable|not in this project|receipt kept/.test(restoredHtml),
    "D: and nothing on the Desk still says the approved image is missing");
  ok(/1 of 1 approved/.test(factsOf(restoredHtml)), "D: the facts line counts the approval normally: " + factsOf(restoredHtml));
  ok(/data-results-approved="retained"/.test(targetOf(restoredHtml, "frame", "frame-a"))
    && /<img src="\/assets\/shots\/L1-01\/takes\/TAKE_01\.png"/.test(targetOf(restoredHtml, "frame", "frame-a")),
    "D: and the rail shows the approved image again: " + targetOf(restoredHtml, "frame", "frame-a"));
  equal(evaluate(restored.context, `return boundedShotTaskStatus(shotById("L1-01"), takesFor("L1-01"), "frames").note || "";`),
    "1 of 1 frame approved", "D: and so does the stage strip");
}

/* ===========================================================================
   NEGATIVE CONTROLS. Each one restores exactly one defect the ruling named.
   =========================================================================== */
function replacing(file, needle, replacement) {
  return (name, source) => {
    if (name !== file) return source;
    const text = String(source).replace(/\r\n/g, "\n");
    assert.strictEqual(text.split(needle).length - 1, 1, `probe receipt: ${file} must contain its anchor exactly once: ${needle.slice(0, 90)}`);
    return text.split(needle).join(replacement);
  };
}
async function mustFail(label, because, body) {
  checks += 1;
  let failure = null;
  try { await body(); } catch (error) { failure = error; }
  assert(failure, `NEGATIVE CONTROL DID NOT FIRE: ${label}`);
  assert(String(failure.message).includes(because), `NEGATIVE CONTROL FIRED FOR THE WRONG REASON: ${label}: ${failure.message}`);
}
async function negativeControls() {
  /* NC-D1 — the rail offers its button again for the target the hero is leading, so one
     result target has two controls with two different names. */
  await mustFail("NC-D1 duplicate action for the led target", "the rail marks Frame A as the target being led",
    () => oneActionPerTarget({ mutate: replacing("creation-studio.js",
      `  const led = shotResultsTargetLeads(lead, kind, frame);`,
      `  const led = false;`) }));
  /* NC-D2 — the outstanding rows are drawn as the old bordered card nested in the hero, which
     is both halves of the same defect: the compact list stops existing and a card appears
     inside a card. The suite catches it at the first of those. */
  await mustFail("NC-D2 the list becomes a card again", "the hero carries one compact list",
    () => compactOutstandingList({ mutate: replacing("creation-studio.js",
      `  return `+"`"+`<ul class="shot-outstanding" data-shot-also="1" data-shot-also-count="\${attr(String(rows.length))}"`+"`",
      `  return `+"`"+`<div class="returned-review-secondary" data-shot-also="1" data-shot-also-count="\${attr(String(rows.length))}"`+"`") }));
  /* NC-D3 — the stage note falls back to the fraction, so the strip says nobody approved
     anything while the facts line says the approval is recorded. */
  await mustFail("NC-D3 the strip counts a recorded approval as none", "the stage strip counts the approval",
    () => missingApprovedBytes({ mutate: replacing("shared-stage-model.js",
      `    const note = facts.frameApprovalsUnavailable`,
      `    const note = false`) }));
  /* NC-D4 — the integrity read is removed from the facts line, so the Desk reports finished
     work for a frame whose approved image it cannot show. */
  await mustFail("NC-D4 the facts line claims the frame is approved", "the facts line says both halves",
    () => missingApprovedBytes({ mutate: replacing("creation-studio.js",
      `  const rows = gaps || shotApprovedMediaGaps(s, takes);`,
      `  const rows = [];`) }));
}

(async () => {
  for (const [name, fn] of [
    ["A one action per result target", oneActionPerTarget],
    ["B the compact outstanding list", compactOutstandingList],
    ["C one warm action", oneWarmAction],
    ["D missing approved bytes", missingApprovedBytes],
    ["negative controls", negativeControls],
  ]) {
    await fn();
    console.log(`  ok  (${name})`);
  }
  console.log(`ev2-7 desk hierarchy: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
