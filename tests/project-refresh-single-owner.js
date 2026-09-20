/* ONE OWNER FOR EVERY PROJECT REFRESH — the forced interleavings.
 *
 * WHAT BROKE. After a Braidy automation image job finished, two refreshes of the
 * same project could overlap: the completed run re-read the project to collect its
 * returned candidates, and the 3.5-second revision watch noticed the same durable
 * change and started a refresh of its own. The watch declared a durable advance,
 * which made the automation's refresh stale; the automation carried on regardless,
 * claimed its candidates into the record it still had, and so made the window dirty;
 * the watch's refresh was then refused for that unsaved work. The project on disk
 * held the images and the window never received them, so the run reported "<state>
 * candidates are unavailable" and its dirty save later drew a 409.
 *
 * WHAT THIS SUITE PROVES. public/app.js requestProjectRefresh() is the only way to
 * start a refresh: one at a time, one shared follow-up for everything asked while it
 * runs, and every caller answered by the first refresh that commits after its
 * request. Each case below forces one interleaving by PARKING project reads in the
 * fixture and releasing them strictly oldest-first, so the order is decided here and
 * not by timing. Nothing sleeps to make a race happen; `--delay` only slows every
 * fixture answer, to prove the forced order still decides the outcome.
 *
 *   1  the result refresh starts, then the revision watch fires
 *   2  the watch's refresh starts, then the automation completion fires
 *   3  several watch observations arrive while one result refresh is active
 *   4  the filmmaker switches project while a refresh is in flight
 *   5  the durable revision moves again before an older refresh completes
 *   6  the window holds unsaved work when the watch asks
 *   7  requests made during a run never read beside it
 *   8  a write this window asked the SERVER to make is not a foreign change either
 *
 * The automation's post-job steps are the shipped functions, called in the order
 * public/automation.js calls them after v626WaitFalJob(): v626RefreshFalJob(),
 * v627ClaimGeneratedEntityCandidates(), then entityMedia() filtered by
 * jobOutputMatcher() — the check that threw "candidates are unavailable".
 *
 * IT CARRIES ITS OWN NEGATIVE CONTROLS, applied to live source IN MEMORY through the
 * render harness's `mutateSource`; nothing on disk is touched.
 *
 * NO PROVIDER IS CONTACTED. Every route is answered from memory.
 *
 *   node tests/project-refresh-single-owner.js [--only 1,5] [--repeat N] [--delay MS] [--skip-controls]
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const A = "project-a";
const B = "project-b";
const SUBJECT = "RACE_SUBJECT";
const STATE = "state-default";
const AUTOSAVE_PAST_MS = 500 + 350;

const realDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(turns = 200) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}
const read = (context, expression) => vm.runInContext(expression, context);

function projectWithSubject(title) {
  const project = buildFixture();
  project.meta.title = title;
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.7";
  project.characters = [...(project.characters || []), {
    id: SUBJECT, name: "Race Subject", status: "IN PROGRESS", workflowStatus: "IN PROGRESS",
    block: "A subject whose reference is being generated.", approvedFile: "", candidateFiles: [],
    continuityStates: [{ id: STATE, name: "Default", isDefault: true, notes: "" }],
  }];
  return project;
}
function projectWithoutSubject(title) {
  const project = buildFixture();
  project.meta.title = title;
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.7";
  return project;
}

/* ===========================================================================
   THE SERVER. Two projects, per-project revisions, a generation refresh route that
   INGESTS exactly as the shipped one does — candidate rows written into the entity,
   files added to the scan, the stored revision moved — and project reads that can be
   parked and released one at a time, oldest first. */
function raceServer({ a, b, delayMs = 0 }) {
  const docs = { [A]: structuredClone(a), [B]: structuredClone(b) };
  const counters = { [A]: 0, [B]: 0 };
  const files = { [A]: [], [B]: [] };
  const jobs = { [A]: [], [B]: [] };
  const revisionOf = (slug) => `"rev-${slug}-${counters[slug]}"`;
  let active = A;
  let holdAll = false;
  let armed = 0;
  const parked = [];
  const server = {
    delayMs,
    writes: [],
    projectReads: [],
    revisionReads: 0,
    maxParked: 0,
    revisionOf,
    counterOf: (revision) => Number(/-(\d+)"$/.exec(String(revision || ""))?.[1] ?? NaN),
    get active() { return active; },
    get docs() { return docs; },
    get parkedCount() { return parked.length; },
    holdAllProjectReads(value = true) { holdAll = !!value; },
    holdNextProjectReads(count = 1) { armed += count; },
    releaseOldest() {
      const next = parked.shift();
      assert(next, "no parked project read to release");
      next();
    },
    /* Another window writes the project. No browser call is behind it. */
    foreignWrite(slug, title) {
      docs[slug] = structuredClone(docs[slug]);
      docs[slug].meta.title = title;
      counters[slug] += 1;
      return revisionOf(slug);
    },
    candidateNames(slug, jobId) {
      const entity = (docs[slug].characters || []).find((row) => row.id === SUBJECT);
      return (entity?.candidateFiles || []).filter((row) => !jobId || row.generationJobId === jobId).map((row) => row.stored);
    },
    async fetch(url, options = {}, response) {
      const method = options.method || "GET";
      if (delayMs) await realDelay(delayMs);
      if (url === "/api/project") {
        /* Captured at REQUEST time, which is what a slow read is. */
        const slug = active;
        const snapshot = structuredClone(docs[slug]);
        const revision = revisionOf(slug);
        server.projectReads.push({ slug, revision });
        if (holdAll || armed > 0) {
          if (armed > 0) armed -= 1;
          await new Promise((resolve) => {
            parked.push(resolve);
            server.maxParked = Math.max(server.maxParked, parked.length);
          });
        }
        return response(snapshot, 200, { "x-cinebraid-project-slug": slug, "x-cinebraid-project-revision": revision, etag: revision });
      }
      if (url === "/api/scan" || url.startsWith("/api/scan?")) {
        const slug = active;
        return response({
          anchors: files[slug].map((name) => ({ name, url: `/assets/anchors/${name}` })),
          plates: [], props: [], vehicles: [], audio: [], media: [],
          shots: Object.fromEntries((docs[slug].shots || []).map((shot) => [shot.id, { takes: [], locked: [] }])),
        });
      }
      const revisionRoute = /^\/api\/projects\/([^/]+)\/revision$/.exec(url);
      if (revisionRoute && method === "GET") {
        server.revisionReads += 1;
        return response({ slug: revisionRoute[1], revision: revisionOf(revisionRoute[1]) });
      }
      const write = /^\/api\/projects\/([^/]+)\/project$/.exec(url);
      if (write && method === "PUT") {
        const slug = write[1];
        const ifMatch = (options.headers || {})["If-Match"];
        const body = JSON.parse(options.body || "{}");
        const record = { slug, ifMatch, title: body?.meta?.title || "" };
        server.writes.push(record);
        if (ifMatch !== revisionOf(slug)) {
          record.status = 409;
          return response({ ok: false, code: "PROJECT_REVISION_CONFLICT", action: "reload",
            error: "The project changed before this write, so the entire operation was refused." }, 409);
        }
        docs[slug] = body;
        counters[slug] += 1;
        record.status = 200;
        return response({ ok: true, revision: revisionOf(slug) });
      }
      if (url === "/api/projects/switch" && method === "POST") {
        active = JSON.parse(options.body || "{}").slug;
        return response({ ok: true, slug: active });
      }
      if (url === "/api/projects")
        return response({ active, projects: Object.keys(docs).map((slug) => ({ slug, title: docs[slug].meta.title })) });
      const refresh = /^\/api\/generation\/fal\/jobs\/([^/]+)\/refresh$/.exec(url);
      if (refresh && method === "POST") {
        /* THE INGEST, into the project that was active when the request was made. */
        const slug = active;
        const jobId = refresh[1];
        const names = ["A", "B", "C"].map((letter) => `${SUBJECT}-${jobId}-${letter}.png`);
        docs[slug] = structuredClone(docs[slug]);
        const entity = (docs[slug].characters || []).find((row) => row.id === SUBJECT);
        if (entity) {
          for (const name of names) {
            entity.candidateFiles.push({ stored: name, original: name, decision: "unreviewed", generationJobId: jobId,
              targetStateId: STATE, ownershipClaim: { actor: "automation", basis: "generated-for-this-reference", via: "entity-reference-generation" } });
            files[slug].push(name);
          }
        }
        counters[slug] += 1;
        const job = { id: jobId, status: "COMPLETED", purpose: "entity-reference", provider: "fal", model: "GPT Image 2",
          entityList: "characters", entityId: SUBJECT, continuityStateId: STATE,
          outputs: names.map((name) => ({ name, type: "candidate" })) };
        jobs[slug] = [...jobs[slug].filter((row) => row.id !== jobId), job];
        return response({ job, projectUpdated: true });
      }
      if (url === "/api/generation/fal/jobs") return response({ jobs: jobs[active].map((row) => structuredClone(row)), projectSlug: active });
      return null;
    },
  };
  return server;
}

/* ===========================================================================
   THE WINDOW. The real application, opened on A, with the commit and the save
   indicator observed rather than replaced: every call still reaches the shipped
   function. Top-level function declarations are properties of the realm's global
   object, so rebinding them here is what internal callers reach too. */
async function openWindow(server, project, options = {}) {
  const rendered = await render("#/production", project, { ...options, fetch: server.fetch });
  const context = rendered.context;
  vm.runInContext(`
    __commits = [];
    __indicator = [];
    __done = {};
    __results = {};
    const __shippedCommit = commitPreparedProject;
    commitPreparedProject = function (prepared, ticket) {
      const installed = __shippedCommit(prepared, ticket);
      if (installed !== false) __commits.push({ intent: ticket && ticket.intent, slug: prepared.slug, revision: prepared.revision });
      return installed;
    };
    const __shippedSetSaveState = setSaveState;
    setSaveState = function (state, label) { __indicator.push(String(label)); return __shippedSetSaveState(state, label); };
  `, context);
  return context;
}
/* The automation's own post-job steps, in its own order (public/automation.js,
   entity chain, after v626WaitFalJob returns). */
function startAutomationStep(context, handle, jobId) {
  vm.runInContext(`__done[${JSON.stringify(handle)}] = false;
    (async () => {
      const job = await v626RefreshFalJob(${JSON.stringify(jobId)});
      v627ClaimGeneratedEntityCandidates("characters", ${JSON.stringify(SUBJECT)}, job, { stateId: ${JSON.stringify(STATE)}, runId: "run-race", stepKey: "generate" });
      const entity = (P.characters || []).find((row) => row.id === ${JSON.stringify(SUBJECT)});
      const media = entity ? entityMedia("characters", entity).filter(jobOutputMatcher(job)) : [];
      if (!media.length) throw new Error("Default candidates are unavailable");
      return { status: job.status, media: media.map((row) => row.name).sort() };
    })().then((value) => ({ ok: true, value }), (error) => ({ ok: false, error: String(error && error.message || error) }))
      .then((result) => { __results[${JSON.stringify(handle)}] = result; __done[${JSON.stringify(handle)}] = true; });`, context);
}
function startWatch(context, handle) {
  vm.runInContext(`__done[${JSON.stringify(handle)}] = false;
    Promise.resolve(watchProjectRevision()).then((value) => { __results[${JSON.stringify(handle)}] = value; __done[${JSON.stringify(handle)}] = true; });`, context);
}
const done = (context, handles) => handles.every((handle) => read(context, `__done[${JSON.stringify(handle)}] === true`));
const result = (context, handle) => JSON.parse(read(context, `JSON.stringify(__results[${JSON.stringify(handle)}] ?? null)`));

/* Release parked reads strictly oldest-first until every named operation has
   finished and nothing is parked. `afterRelease` lets a case act between releases. */
async function driveOldestFirst(server, context, handles, { afterRelease } = {}) {
  for (let step = 0; step < 2000; step += 1) {
    await settle();
    if (server.parkedCount) {
      server.releaseOldest();
      if (afterRelease) await afterRelease();
      continue;
    }
    if (done(context, handles)) { await settle(); if (!server.parkedCount) return; continue; }
    await realDelay(Math.max(2, server.delayMs));
  }
  assert.fail(`THE LOOP: the forced interleaving never settled — ${server.projectReads.length} project reads so far, still waiting on ${handles.filter((h) => !done(context, [h])).slice(0, 6).join(", ")}`);
}
async function waitForParked(server, count, label) {
  for (let step = 0; step < 2000 && server.parkedCount < count; step += 1) {
    await settle();
    if (server.parkedCount < count) await realDelay(Math.max(2, server.delayMs));
  }
  assert.strictEqual(server.parkedCount, count, `precondition: ${label}`);
}
function windowState(context) {
  return {
    slug: read(context, "ACTIVE_PROJECT_SLUG"),
    title: read(context, "P ? P.meta.title : null"),
    revision: read(context, "PROJECT_REVISION"),
    epoch: read(context, "PROJECT_OPEN_EPOCH"),
    dirty: read(context, "projectHasUnsavedEdits()"),
    conflict: read(context, "PROJECT_CONFLICT"),
    indicator: read(context, 'document.getElementById("save-state").querySelector("span:last-child").textContent'),
  };
}
const commits = (context) => JSON.parse(read(context, "JSON.stringify(__commits)"));
const indicatorHistory = (context) => JSON.parse(read(context, "JSON.stringify(__indicator)"));
const candidateRows = (context) => JSON.parse(read(context,
  `JSON.stringify(((P.characters || []).find((row) => row.id === ${JSON.stringify(SUBJECT)}) || {}).candidateFiles || [])`));
const jobStatus = (context, jobId) => read(context, `((FAL_GENERATION_JOBS || []).find((row) => row.id === ${JSON.stringify(jobId)}) || {}).status || ""`);
function assertEachOnce(names, label) {
  const counts = names.reduce((map, name) => map.set(name, (map.get(name) || 0) + 1), new Map());
  const twice = [...counts].filter(([, count]) => count !== 1).map(([name]) => name);
  assert.deepStrictEqual(twice, [], `${label}: every candidate must be imported exactly once: ${JSON.stringify(names)}`);
}
function assertRevisionNeverBackward(server, context, label) {
  const seen = commits(context).map((row) => server.counterOf(row.revision));
  for (let at = 1; at < seen.length; at += 1)
    assert(seen[at] >= seen[at - 1], `${label}: the project revision moved backward across commits: ${JSON.stringify(commits(context))}`);
}
function assertResultArrived(context, handle, server, jobId, label) {
  const outcome = result(context, handle);
  assert(outcome && outcome.ok,
    `THE RACE (${label}): a completed automation job must reach the open project on its own, and the step reported ${JSON.stringify(outcome && outcome.error)}`);
  assert.deepStrictEqual(outcome.value.media, [...server.candidateNames(A, jobId)].sort(),
    `${label}: the step must see exactly the candidates the server ingested for ${jobId}`);
  assert.strictEqual(jobStatus(context, jobId), "COMPLETED", `${label}: and the job must read COMPLETED`);
}

/* ===========================================================================
   THE CASES. Each returns nothing and throws on the first broken invariant. */

/* 1 — the result refresh starts, then the watch fires. The reproduction. */
async function resultThenWatchCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const readsAtOpen = server.projectReads.length;
  const commitsAtOpen = commits(context).length;
  server.holdAllProjectReads();

  startAutomationStep(context, "step", "job-1");
  await waitForParked(server, 1, "the automation's result refresh is reading");
  assert.strictEqual(server.candidateNames(A, "job-1").length, 3, "precondition: the server ingested the results");
  startWatch(context, "watch");
  await driveOldestFirst(server, context, ["step", "watch"]);
  await realDelay(AUTOSAVE_PAST_MS);
  await settle();

  assertResultArrived(context, "step", server, "job-1", "1");
  const state = windowState(context);
  assert.strictEqual(state.revision, server.revisionOf(A), "1: the window ends level with the server");
  assertEachOnce(candidateRows(context).map((row) => row.stored), "1 (window)");
  assertEachOnce(server.candidateNames(A), "1 (storage)");
  assert.strictEqual(commits(context).length - commitsAtOpen, 1, `1: exactly one import: ${JSON.stringify(commits(context))}`);
  assert.strictEqual(server.projectReads.length - readsAtOpen, 1,
    "1: one read — the watch saw the window already re-reading and did not declare the result refresh stale");
  assertRevisionNeverBackward(server, context, "1");
  assert.deepStrictEqual(server.writes, [], `1: nothing dirty, so nothing written and no 409: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(state.dirty, false, "1: no unsaved work was manufactured");
  assert.strictEqual(state.conflict, false, "1: no conflict");
  assert.strictEqual(state.indicator, "Saved", "1: and the indicator is truthful");
  assert.strictEqual(result(context, "watch"), null, "1: the watch stood aside for the refresh already in flight");
  assert(!indicatorHistory(context).includes("Project changed — refresh required"),
    `1: the window must never claim to be behind while its refresh is on the way: ${JSON.stringify(indicatorHistory(context))}`);
  const settled = server.projectReads.length;
  startWatch(context, "again");
  await driveOldestFirst(server, context, ["again"]);
  assert.strictEqual(server.projectReads.length, settled, "1: and the next watch tick agrees and reads nothing");
}

/* 2 — the watch's refresh starts, then the automation completion fires. */
async function watchThenResultCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const readsAtOpen = server.projectReads.length;
  const commitsAtOpen = commits(context).length;
  server.foreignWrite(A, "written by another window");
  server.holdAllProjectReads();

  startWatch(context, "watch");
  await waitForParked(server, 1, "the watch's refresh is reading");
  startAutomationStep(context, "step", "job-1");
  /* The completion has ingested and declared its advance before anything is released. */
  for (let step = 0; step < 2000 && server.candidateNames(A, "job-1").length === 0; step += 1) await realDelay(2);
  await settle();
  await driveOldestFirst(server, context, ["step", "watch"]);
  await realDelay(AUTOSAVE_PAST_MS);
  await settle();

  assertResultArrived(context, "step", server, "job-1", "2");
  const state = windowState(context);
  assert.strictEqual(state.title, "written by another window", "2: the other window's change arrived too");
  assert.strictEqual(state.revision, server.revisionOf(A), "2: level with the server");
  assertEachOnce(candidateRows(context).map((row) => row.stored), "2 (window)");
  assert.strictEqual(commits(context).length - commitsAtOpen, 1, `2: exactly one import: ${JSON.stringify(commits(context))}`);
  assert.strictEqual(server.projectReads.length - readsAtOpen, 2, "2: the watch's read, made stale by the ingest, and one follow-up");
  assertRevisionNeverBackward(server, context, "2");
  assert.deepStrictEqual(server.writes, [], "2: nothing written");
  assert.strictEqual(state.indicator, "Saved", "2: truthfully Saved");
  assert.strictEqual(result(context, "watch"), "refreshed",
    "2: THE WATCH MUST NOT REPORT THE WINDOW BEHIND when the refresh that carries its change was already queued");
  assert(!indicatorHistory(context).includes("Project changed — refresh required"),
    `2: and never said so on the way: ${JSON.stringify(indicatorHistory(context))}`);
}

/* 3 — several watch observations while one result refresh is active. */
async function repeatedWatchCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const readsAtOpen = server.projectReads.length;
  const commitsAtOpen = commits(context).length;
  server.holdAllProjectReads();

  startAutomationStep(context, "step", "job-1");
  await waitForParked(server, 1, "the automation's result refresh is reading");
  const handles = ["step"];
  for (let tick = 0; tick < 3; tick += 1) {
    startWatch(context, `tick-${tick}`);
    handles.push(`tick-${tick}`);
    await settle();
  }
  let extra = 0;
  await driveOldestFirst(server, context, handles, {
    afterRelease: async () => { startWatch(context, `late-${extra}`); handles.push(`late-${extra}`); extra += 1; await settle(); },
  });
  await realDelay(AUTOSAVE_PAST_MS);
  await settle();

  assertResultArrived(context, "step", server, "job-1", "3");
  assert.strictEqual(commits(context).length - commitsAtOpen, 1, `3: one import however many times the watch looked: ${JSON.stringify(commits(context))}`);
  assert.strictEqual(server.projectReads.length - readsAtOpen, 1,
    "3: no observation made during the run adds a read — the watch does not compete with a refresh in flight");
  assertEachOnce(candidateRows(context).map((row) => row.stored), "3 (window)");
  assert.strictEqual(windowState(context).revision, server.revisionOf(A), "3: level with the server");
  assert.deepStrictEqual(server.writes, [], "3: nothing written");
  assert.strictEqual(windowState(context).indicator, "Saved", "3: truthfully Saved");
  const settled = server.projectReads.length;
  for (let tick = 0; tick < 2; tick += 1) { startWatch(context, `after-${tick}`); await driveOldestFirst(server, context, [`after-${tick}`]); }
  assert.strictEqual(server.projectReads.length, settled, "3: and it cannot loop — quiet ticks afterwards read nothing");
}

/* 4 — the filmmaker switches project while a refresh is in flight. */
async function switchDuringRefreshCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const bBefore = structuredClone(server.docs[B]);
  server.holdNextProjectReads(1);

  startAutomationStep(context, "step", "job-1");
  await waitForParked(server, 1, "A's result refresh is reading");
  startWatch(context, "watch");
  await settle();
  const readsBeforeSwitch = server.projectReads.length;
  await context.switchProject(B);
  const afterSwitch = windowState(context);
  assert.strictEqual(afterSwitch.slug, B, "precondition: the switch completed while A's refresh was still reading");
  const commitsAfterSwitch = commits(context).length;
  const readsAfterSwitch = server.projectReads.length;

  await driveOldestFirst(server, context, ["step", "watch"]);
  await realDelay(AUTOSAVE_PAST_MS);
  await settle();

  const state = windowState(context);
  assert.deepStrictEqual({ slug: state.slug, title: state.title, revision: state.revision, epoch: state.epoch },
    { slug: afterSwitch.slug, title: afterSwitch.title, revision: afterSwitch.revision, epoch: afterSwitch.epoch },
    "4: A's refresh must install nothing over B");
  assert.strictEqual(commits(context).length, commitsAfterSwitch, `4: no commit after the switch: ${JSON.stringify(commits(context))}`);
  assert.strictEqual(server.projectReads.length, readsAfterSwitch,
    "4: and no follow-up is started for an open that has been replaced");
  assert(readsAfterSwitch - readsBeforeSwitch === 1, "precondition: the switch read B exactly once");
  assert.deepStrictEqual(candidateRows(context), [], "4: B's record holds none of A's candidates");
  assert.deepStrictEqual(server.docs[B], bBefore, "4: and B's stored document is untouched");
  assert.deepStrictEqual(server.writes, [], "4: nothing written anywhere");
  assert.strictEqual(state.indicator, "Saved", "4: B's indicator is not repainted by an answer about A");
  assert(!indicatorHistory(context).slice(-3).includes("Project changed — refresh required"),
    `4: nothing claims B is behind: ${JSON.stringify(indicatorHistory(context))}`);
  const outcome = result(context, "step");
  assert(outcome && !outcome.ok, "4: the step for A cannot find A's results in B, and says so rather than claiming them");
  assert.strictEqual(server.candidateNames(A, "job-1").length, 3, "4: the results are safe in A, where the server put them");

  /* 4b. The WATCH's own refresh is the one in flight when the switch lands. */
  {
    const serverB = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
    const contextB = await openWindow(serverB, projectWithSubject("Project A"), options);
    serverB.foreignWrite(A, "written by another window");
    serverB.holdNextProjectReads(1);
    startWatch(contextB, "watch");
    await waitForParked(serverB, 1, "4b: the watch's refresh of A is reading");
    await contextB.switchProject(B);
    const switched = windowState(contextB);
    assert.strictEqual(switched.slug, B, "4b precondition: the switch completed while the watch's refresh was reading");
    const commitsAtSwitch = commits(contextB).length;
    await driveOldestFirst(serverB, contextB, ["watch"]);
    const after = windowState(contextB);
    assert.deepStrictEqual({ slug: after.slug, title: after.title, revision: after.revision }, { slug: B, title: "Project B", revision: switched.revision },
      "4b: the watch's refresh of A installs nothing over B");
    assert.strictEqual(commits(contextB).length, commitsAtSwitch, "4b: no commit after the switch");
    assert.strictEqual(after.indicator, "Saved", "4b: B's indicator is not repainted by an answer about A");
    assert.strictEqual(result(contextB, "watch"), null, "4b: the answer about A is dropped, not reported");
  }
}

/* 5 — the durable revision moves again before an older refresh completes. */
async function revisionMovesAgainCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const readsAtOpen = server.projectReads.length;
  const commitsAtOpen = commits(context).length;
  server.holdAllProjectReads();

  startAutomationStep(context, "first", "job-1");
  await waitForParked(server, 1, "the first result refresh is reading a snapshot that holds job-1 only");
  const staleRevision = server.projectReads[server.projectReads.length - 1].revision;
  startAutomationStep(context, "second", "job-2");
  for (let step = 0; step < 2000 && server.candidateNames(A, "job-2").length === 0; step += 1) await realDelay(2);
  await settle();
  assert.notStrictEqual(server.revisionOf(A), staleRevision, "precondition: the second ingest moved the stored revision past the first read");
  await driveOldestFirst(server, context, ["first", "second"]);
  await realDelay(AUTOSAVE_PAST_MS);
  await settle();

  assertResultArrived(context, "first", server, "job-1", "5 (first)");
  assertResultArrived(context, "second", server, "job-2", "5 (second)");
  assert.deepStrictEqual(commits(context).slice(commitsAtOpen).map((row) => row.revision), [server.revisionOf(A)],
    `5: exactly one import, of the newest snapshot — the one read before the second ingest is never installed: ${JSON.stringify(commits(context))}`);
  assert.strictEqual(server.projectReads.length - readsAtOpen, 2, "5: the stale read and one follow-up");
  assertRevisionNeverBackward(server, context, "5");
  assertEachOnce(candidateRows(context).map((row) => row.stored), "5 (window)");
  assert.strictEqual(candidateRows(context).length, 6, "5: both jobs' candidates are present");
  assert.deepStrictEqual(server.writes, [], "5: nothing written");
  assert.strictEqual(windowState(context).indicator, "Saved", "5: truthfully Saved");
}

/* 6 — the window holds unsaved work when the watch asks. */
async function dirtyWhenWatchAsksCase(options = {}) {
  /* 6a. Nothing in flight: the watch must surface the conflict and request nothing. */
  {
    const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
    const context = await openWindow(server, projectWithSubject("Project A"), options);
    const R0 = server.revisionOf(A);
    const readsAtOpen = server.projectReads.length;
    const commitsAtOpen = commits(context).length;
    server.foreignWrite(A, "written by another window");
    vm.runInContext(`P.meta.title = "unsaved local edit"; dirty();`, context);
    startWatch(context, "watch");
    await driveOldestFirst(server, context, ["watch"]);
    const state = windowState(context);
    assert.strictEqual(result(context, "watch"), "conflict", "6a: the watch reports the conflict");
    assert.strictEqual(state.title, "unsaved local edit", "6a: the unsaved edit is untouched");
    assert.strictEqual(state.revision, R0, "6a: nothing was installed over it");
    assert.strictEqual(state.conflict, true, "6a: through the accepted conflict surface");
    assert.notStrictEqual(state.indicator, "Saved", "6a: and nothing claims to be saved");
    assert.strictEqual(server.projectReads.length, readsAtOpen, "6a: no refresh was requested at all");
    assert.strictEqual(commits(context).length, commitsAtOpen, "6a: and nothing imported");
  }
  /* 6b. A result refresh in flight, an edit typed inside it, then the watch. */
  {
    const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
    const context = await openWindow(server, projectWithSubject("Project A"), options);
    const R0 = server.revisionOf(A);
    const readsAtOpen = server.projectReads.length;
    const commitsAtOpen = commits(context).length;
    server.holdAllProjectReads();
    startAutomationStep(context, "step", "job-1");
    await waitForParked(server, 1, "the result refresh is reading");
    vm.runInContext(`P.meta.title = "typed while the results were arriving"; dirty();`, context);
    startWatch(context, "watch");
    await driveOldestFirst(server, context, ["step", "watch"]);
    await realDelay(AUTOSAVE_PAST_MS);
    await settle();
    const state = windowState(context);
    assert.strictEqual(state.title, "typed while the results were arriving", "6b: the edit is never overwritten");
    assert.strictEqual(state.revision, R0, "6b: no snapshot was installed over unsaved work");
    assert.strictEqual(commits(context).length, commitsAtOpen, "6b: nothing imported");
    assert.strictEqual(server.projectReads.length - readsAtOpen, 1, "6b: the watch asked for nothing while the window was dirty");
    assert.strictEqual(result(context, "watch"), null, "6b: the watch stood aside while the window was already re-reading");
    assert.strictEqual(state.conflict, true, "6b: the conflict is latched — by the stale save's own refusal");
    assert.deepStrictEqual(server.writes.map((row) => [row.ifMatch, row.status]), [[R0, 409]],
      `6b: the stale save is refused rather than overwriting the results: ${JSON.stringify(server.writes)}`);
    assert.strictEqual(server.candidateNames(A, "job-1").length, 3, "6b: and the stored results survive it");
    startWatch(context, "later");
    await driveOldestFirst(server, context, ["later"]);
    assert.strictEqual(result(context, "later"), "already-refusing", "6b: and a later tick keeps the conflict on screen rather than refreshing over the edit");
    assert.strictEqual(windowState(context).title, "typed while the results were arriving", "6b: which is still in the tab");
  }
}

/* 7 — requests made during a run never read beside it. */
async function oneAtATimeCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const readsAtOpen = server.projectReads.length;
  server.holdAllProjectReads();
  vm.runInContext(`__done.r1 = false; load({ intent: "refresh" }).then(() => { __done.r1 = true; });`, context);
  await waitForParked(server, 1, "the first refresh is reading");
  server.foreignWrite(A, "moved while the first refresh was reading");
  for (const handle of ["r2", "r3", "r4"]) vm.runInContext(`__done.${handle} = false; load({ intent: "refresh" }).then(() => { __done.${handle} = true; });`, context);
  await settle();
  assert.strictEqual(server.parkedCount, 1, "7: THREE REQUESTS MADE DURING A RUN MUST NOT START A SECOND READ BESIDE IT");
  await driveOldestFirst(server, context, ["r1", "r2", "r3", "r4"]);
  assert.strictEqual(server.maxParked, 1, "7: at no point were two project reads in flight");
  assert.strictEqual(server.projectReads.length - readsAtOpen, 2, "7: the three requests shared one follow-up");
  assert.strictEqual(windowState(context).title, "moved while the first refresh was reading", "7: which read the newer record");
  assert.strictEqual(windowState(context).revision, server.revisionOf(A), "7: and ends level with the server");
  assertRevisionNeverBackward(server, context, "7");
}

/* 8 — a write this window ASKED THE SERVER to make is not a foreign change.

   The other half of "this window's own work", and the one the stand-aside above cannot
   answer for: between the server writing and this window installing the result there is
   an interval with NO refresh running — the request itself is still on the wire. The
   window declares it with beginProjectServerWrite(), and the watch waits for that
   declaration before it compares. Nothing else is in play here: no refresh is running,
   nothing is unsaved, and the revision moves exactly as an enrolment's server write
   moves it (public/reference-desk.js enrollExact). */
async function declaredServerWriteCase(options = {}) {
  const server = raceServer({ a: projectWithSubject("Project A"), b: projectWithoutSubject("Project B"), delayMs: options.delayMs });
  const context = await openWindow(server, projectWithSubject("Project A"), options);
  const R0 = read(context, "PROJECT_REVISION");
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
  const readsAtOpen = server.projectReads.length;

  /* The window declares the write it is about to ask the server for, and the server
     makes it: the stored revision moves and this window's has not caught up. */
  vm.runInContext(`__release = beginProjectServerWrite();`, context);
  server.foreignWrite(A, "written by the server, because this window asked it to");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "precondition: the window has not installed the result yet");
  startWatch(context, "watch");
  /* The watch may read the revision; what it must not do is act on the difference. */
  for (let step = 0; step < 200 && !server.revisionReads; step += 1) await settle();
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
    "8: a write this window asked the server to make is not a foreign change, and must not be declared as one");
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "8: nor raise a conflict over this window's own request");
  assert.strictEqual(server.projectReads.length, readsAtOpen, "8: nor send this window to re-read behind its own request");

  /* The window installs the result of its own request, exactly as the enrolment's
     confirmation refresh does, and only then releases the declaration. */
  vm.runInContext(`__confirm = load({ intent: "refresh" }).then(() => { __release(); });`, context);
  await driveOldestFirst(server, context, ["watch"]);
  const state = windowState(context);
  assert.strictEqual(result(context, "watch"), null, "8: so the watch answers nothing about it");
  assert.strictEqual(state.revision, server.revisionOf(A), "8: the window ends level with the server");
  assert.strictEqual(state.title, "written by the server, because this window asked it to", "8: holding what the server wrote");
  assert.strictEqual(state.conflict, false, "8: with no conflict");
  assert.strictEqual(state.indicator, "Saved", "8: and a truthful indicator");
  startWatch(context, "after");
  await driveOldestFirst(server, context, ["after"]);
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
    "8: and the tick after the release agrees, because the window is level");
}

const CASES = [
  ["1", "result-then-watch", resultThenWatchCase],
  ["2", "watch-then-result", watchThenResultCase],
  ["3", "repeated-watch", repeatedWatchCase],
  ["4", "switch-during-refresh", switchDuringRefreshCase],
  ["5", "revision-moves-again", revisionMovesAgainCase],
  ["6", "dirty-when-watch-asks", dirtyWhenWatchAsksCase],
  ["7", "one-at-a-time", oneAtATimeCase],
  ["8", "declared-server-write", declaredServerWriteCase],
];

/* ===========================================================================
   THE SHAPE. One entry, one caller of the single-run transaction, no ordering
   tokens left over from when refreshes could overlap. */
function ownershipIsStructuralSection() {
  const source = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8").replace(/\r\n/g, "\n");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(/requestedProjectIntent\(options\) === "refresh"\s*\?\s*requestProjectRefresh\(\)/.test(code),
    "load({ intent: \"refresh\" }) must be the owner's request and nothing else");
  const calls = [...code.matchAll(/\brunProjectRefresh\(\)/g)].length;
  const declared = /async function runProjectRefresh\(\)/.test(code) ? 1 : 0;
  assert.strictEqual(calls - declared, 1, "runProjectRefresh() must have exactly one caller");
  const starter = code.slice(code.indexOf("function startProjectRefreshRun("), code.indexOf("\n}", code.indexOf("function startProjectRefreshRun(")));
  assert(starter.includes("runProjectRefresh()"), "and that caller must be the owner's startProjectRefreshRun()");
  for (const file of fs.readdirSync(path.join(ROOT, "public")).filter((name) => name.endsWith(".js") && name !== "app.js")) {
    const other = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
    assert(!/\brunProjectRefresh\(/.test(other), `${file} must not start a refresh around the owner`);
  }
  for (const gone of ["PROJECT_REFRESH_SEQUENCE", "PROJECT_REFRESH_COMMITTED"])
    assert(!code.includes(gone), `${gone} ordered overlapping refreshes; with one at a time it must not survive`);
  assert(/ONE OWNER FOR EVERY REFRESH OF THE OPEN PROJECT\.\s+INVARIANT\./.test(source), "the ownership seam must state its invariant");
  console.log("  shape - load({intent:\"refresh\"}) is the owner's request, the owner is the transaction's only caller, and the overlap watermark is gone");
}

/* ===========================================================================
   NEGATIVE CONTROLS. */
function sourceMutator(file, edits) {
  const applied = new Set();
  const mutate = (name, original) => {
    if (name !== file) return original;
    let code = original.replace(/\r\n/g, "\n");
    for (const [from, to] of edits) {
      assert(code.includes(from), `negative control anchor no longer exists in ${file}; update the control rather than deleting it:\n${from}`);
      assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${file}:\n${from}`);
      code = code.replace(from, to);
    }
    applied.add(name);
    return code;
  };
  mutate.applied = applied;
  return mutate;
}
async function expectCaughtBy(label, pattern, run) {
  let message = "";
  try {
    await run();
  } catch (error) {
    if (!(error instanceof assert.AssertionError))
      throw new Error(`${label}: the case failed with something that is not an assertion, so it is not a receipt:\n${error.stack || error.message}`);
    message = error.message.split("\n")[0];
  }
  assert(message, `${label}: the case PASSED with the defect reintroduced`);
  assert(pattern.test(message), `${label}: caught, but by the wrong assertion — expected ${pattern}, got: ${message}`);
  return message;
}
const QUEUED = `    if (!PROJECT_REFRESH_RUN) return startProjectRefreshRun([caller]);
    if (!PROJECT_REFRESH_FOLLOW_UP) PROJECT_REFRESH_FOLLOW_UP = [];
    PROJECT_REFRESH_FOLLOW_UP.push(caller);`;
const EVERY_REQUEST_STARTS = `    return startProjectRefreshRun([caller]);`;
const HAND_ON = `  const handOn = !error && !outcome?.committed && wanted.length > 0;`;
const NO_HAND_ON = `  const handOn = false;`;
const FRESHNESS = `  if (ticket.saveGeneration !== PROJECT_SAVE_GENERATION)
    return "this window saved to storage while this refresh was in flight, so the snapshot it read at "
      + (ticket.revision || "an unidentified revision") + " is behind the record";
`;
const WATCH_STANDS_ASIDE = `      if (PROJECT_REFRESH_RUN) return null;
      if (serverRevision === PROJECT_REVISION) return null;`;
const WATCH_COMPETES = `      if (serverRevision === PROJECT_REVISION) return null;`;
const SERVER_WRITE_GATE = `      await PROJECT_SERVER_WRITE.catch(() => {});`;
const NO_SERVER_WRITE_GATE = "";
const WATCH_BOUND = `  if (owner.epoch !== PROJECT_OPEN_EPOCH) return null;
  /* A committed refresh settles the indicator itself`;
const WATCH_UNBOUND = `  /* A committed refresh settles the indicator itself`;

async function negativeControlsSection() {
  const controls = [];
  const run = async (id, defect, edits, pattern, cases) => {
    for (const [label, section] of cases) {
      const mutate = sourceMutator("app.js", edits);
      const detected = await expectCaughtBy(`${id}/${label}`, pattern, () => section({ mutateSource: mutate }));
      assert(mutate.applied.has("app.js"), `${id}: app.js was never evaluated, so the defect never ran`);
      controls.push({ id: `${id}/${label}`, defect, detected });
    }
  };
  await run("NC-1", "no queue: a request made during a run starts a second refresh beside it",
    [[QUEUED, EVERY_REQUEST_STARTS]], /THE RACE|MUST NOT START A SECOND READ/,
    [["case-5", revisionMovesAgainCase], ["case-7", oneAtATimeCase]]);
  await run("NC-2", "no hand-on: a run made stale by a newer request answers its callers with the refusal",
    [[HAND_ON, NO_HAND_ON]], /THE RACE|THE WATCH MUST NOT REPORT THE WINDOW BEHIND/,
    [["case-2", watchThenResultCase], ["case-5", revisionMovesAgainCase]]);
  await run("NC-3", "no stale-snapshot guard: a snapshot read before a declared durable advance is installed",
    [[FRESHNESS, ""]], /exactly one import, of the newest snapshot/,
    [["case-5", revisionMovesAgainCase]]);
  await run("NC-4", "the watch's answer is not bound to its open: a replaced open's refusal repaints the new one",
    [[WATCH_BOUND, WATCH_UNBOUND]], /B's indicator is not repainted/,
    [["case-4", switchDuringRefreshCase]]);
  await run("NC-5", "the watch competes with a refresh in flight: it declares that refresh stale, and every later tick does the same to the follow-up",
    [[WATCH_STANDS_ASIDE, WATCH_COMPETES]], /one read — the watch saw the window already re-reading|THE LOOP/,
    [["case-1", resultThenWatchCase], ["case-3", repeatedWatchCase]]);
  await run("NC-6", "the watch does not wait for a write this window asked the server to make",
    [[SERVER_WRITE_GATE, NO_SERVER_WRITE_GATE]], /is not a foreign change, and must not be declared as one/,
    [["case-8", declaredServerWriteCase]]);
  console.log("Project refresh single-owner negative controls");
  for (const row of controls) console.log(`  ${row.id} - ${row.defect}\n        detected: ${row.detected}`);
  return controls.length;
}

function parseArgs(argv) {
  const args = { only: null, repeat: 1, delays: [0, 15], controls: true };
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    if (flag === "--only") args.only = new Set(String(argv[++at] || "").split(",").filter(Boolean));
    else if (flag === "--repeat") args.repeat = Math.max(1, Number(argv[++at]) || 1);
    else if (flag === "--delay") args.delays = [Math.max(0, Number(argv[++at]) || 0)];
    else if (flag === "--skip-controls") args.controls = false;
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const selected = CASES.filter(([id, name]) => !args.only || args.only.has(id) || args.only.has(name));
  console.log("Project refresh single owner - forced interleavings");
  let passes = 0;
  for (let iteration = 1; iteration <= args.repeat; iteration += 1) {
    for (const delayMs of args.delays) {
      for (const [id, name, section] of selected) {
        await section({ delayMs });
        passes += 1;
        if (args.repeat === 1) console.log(`  ${id} ${name} (fixture delay ${delayMs}ms)`);
      }
    }
    if (args.repeat > 1) console.log(`  iteration ${iteration}/${args.repeat}: ${selected.length} case(s) x ${args.delays.length} timing(s) passed`);
  }
  if (!args.only) ownershipIsStructuralSection();
  const controls = args.controls && !args.only ? await negativeControlsSection() : 0;
  console.log(`Project refresh single owner passed - ${passes} forced interleavings, ${controls} reintroduced defects detected. Provider calls made: 0.`);
}

module.exports = { main, CASES };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
