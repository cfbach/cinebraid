/* THE PROJECT LOAD TRANSACTION — PREPARE → VALIDATE → COMMIT.
 *
 * WHAT THIS SUITE IS FOR. `load()` used to be one function with one set of
 * endings, serving two different acts: replacing the record on screen, and
 * re-reading the record already open because the SERVER committed a finished
 * generation into it. Nine defects were reproduced against that shape by
 * independent review. Every one of them is a case of the same thing — an act
 * changing what it was part-way through, or authoritative state moving while an
 * `await` was outstanding.
 *
 *   F1  a deferred save trigger created under project A dispatches into B
 *   F2  a debounce dispatching inside the identity swap sends A's document to
 *       B's URL at B's revision
 *   F3  a same-project completion refresh silently deletes an authored edit
 *   F4  a stale refresh from A's open reverses an explicit switch to B
 *   F5  A -> B -> A revalidates the old A refresh, because the slug matches again
 *   F6  overlapping refreshes become response-order dependent
 *   F7  a delayed refresh 404 clears the workspace and loses authored work
 *   F8  the post-commit generation-ledger await overwrites a real typed 422 /
 *       SAVE_BLOCKED with a resting "Saved"
 *   F9  a refresh with no `P` / no slug silently performs a replacement
 *
 * THE STRUCTURE THE REPAIR RESTS ON, which every section below is really about:
 *
 *   PREPARE   gathers every asynchronous input — the generation ledger included
 *             — before anything authoritative moves.
 *   VALIDATE  one synchronous decision against the live window.
 *   COMMIT    one synchronous, await-free mutation section.
 *
 * ORDERING RULES CARRIED FORWARD, unchanged from the reproductions:
 *   - older response, then newer: the newer may commit afterward
 *   - newer response, then older: the older cannot roll the newer back
 *   - a later request merely STARTING does not invalidate an older valid response
 *   - an explicit replacement invalidates every refresh from the old open
 *   - dirty authored work always outranks refresh installation
 *   - no arbitrary client merge: a refresh commits whole or discards whole
 *
 * IT CARRIES ITS OWN NEGATIVE CONTROLS. Each removes one half of the mechanism
 * from live production source IN MEMORY, through the render harness's
 * `mutateSource` hook — nothing on disk is touched — observes the defect on the
 * wire or on screen FIRST, and only then requires the guarding section to go red.
 *
 * NO PAID PROVIDER CALL IS POSSIBLE HERE. Every route is answered from memory.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { render, buildFixture } = require("./render-harness");

const ROOT = path.join(__dirname, "..");
const A = "project-a";
const B = "project-b";
const SOLO = "solo-project";

/* Both product durations, stated here rather than inherited, so a section cannot
   quietly stop reproducing if either is ever retuned. */
const MIGRATION_TRIGGER_MS = 50;   // the commit's deferred migration write-back
const AUTOSAVE_DEBOUNCE_MS = 500;  // dirty()'s debounce
const PAST_BOTH_TIMERS_MS = MIGRATION_TRIGGER_MS + AUTOSAVE_DEBOUNCE_MS + 350;
const realDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(turns = 200) {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setImmediate(resolve));
}
const read = (context, expression) => vm.runInContext(expression, context);

/* The stored schema older than this build, which is what makes the commit
   schedule the migration write-back at all. */
function olderSchemaProject(title) {
  const project = buildFixture();
  project.meta.title = title;
  project.meta.hubVersion = "v5.5.0";
  return project;
}
function currentSchemaProject(title) {
  const project = buildFixture();
  project.meta.title = title;
  project.meta.hubVersion = "v6.0.0";
  project.meta.schemaVersion = "6.7";
  return project;
}

/* ===========================================================================
   THE SERVERS.

   One two-project server for the identity sections, one that INGESTS — commits
   new durable project data into the document and advances its revision, exactly
   as the shipped generation-refresh route does — for everything about refreshes.
   Both enforce the exact revision on every write, so a section cannot pass by
   quietly overwriting what it was supposed to preserve. */

const REV = {
  [A]: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
  [B]: '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
};
/* A two-project server with a transcript of every project write it received.
   `hold` parks the loads that follow the project response, which is the only way
   to stand inside the load's own identity window from out here. */
function twoProjectServer({ a, b, replyFor = () => ({ status: 200 }) }) {
  const projects = { [A]: a, [B]: b };
  const writes = [];
  let active = A;
  let held = null;
  return {
    writes,
    get active() { return active; },
    hold() { held = []; },
    release() {
      const parked = held || [];
      held = null;
      for (const resume of parked) resume();
    },
    async fetch(url, options = {}, response) {
      const write = /^\/api\/projects\/([^/]+)\/(project|canon-transition)$/.exec(url);
      if (write && (options.method === "PUT" || options.method === "POST")) {
        const body = JSON.parse(options.body || "{}");
        const index = writes.length;
        const record = {
          index,
          slug: write[1],
          kind: write[2],
          ifMatch: (options.headers || {})["If-Match"],
          /* WHICH PROJECT'S DOCUMENT this request actually carried, which is a
             different claim from which project's URL it was sent to. F2 is the
             two disagreeing. */
          title: (write[2] === "canon-transition" ? body.successor : body)?.meta?.title || "",
        };
        writes.push(record);
        const reply = replyFor(index, record) || { status: 200 };
        record.status = reply.status || 200;
        if (record.status === 200) return response({ ok: true, revision: REV[write[1]] || REV[A] });
        return response(reply.body || {}, record.status);
      }
      if (url === "/api/project")
        return response(projects[active], 200, {
          "x-cinebraid-project-slug": active,
          "x-cinebraid-project-revision": REV[active],
          etag: REV[active],
        });
      if (url === "/api/projects/switch" && options.method === "POST") {
        active = JSON.parse(options.body || "{}").slug;
        return response({ ok: true, slug: active });
      }
      if (url === "/api/projects")
        return response({ active, projects: Object.keys(projects).map((slug) => ({ slug, title: projects[slug].meta.title })) });
      /* Parked AFTER the project response has been read, so a suite can hold a
         load open at the exact point the old code had already installed the
         incoming slug and revision while `P` still belonged to the outgoing
         project. In the repaired shape nothing has moved there at all, which is
         precisely what the section proves. */
      if (url === "/api/scan" && held) {
        await new Promise((resolve) => held.push(resolve));
        return null;
      }
      return null;
    },
  };
}

/* The refresh server. Two projects, per-project revisions, a generation refresh
   that INGESTS, and parkable / failable / 404-able project reads. A parked
   response carries the project and revision that were current when it was ASKED
   FOR, because that is what a slow read is. */
function refreshServer({ a, b, replyForWrite = () => ({ status: 200 }), ledger = null }) {
  const docs = { [A]: structuredClone(a), [B]: structuredClone(b) };
  const counters = { [A]: 0, [B]: 0 };
  const revisionOf = (slug) => `"rev-${slug}-${counters[slug]}"`;
  const writes = [];
  let active = A;
  let armed = 0;
  let failNext = 0;
  let missNext = 0;
  let missAlways = false;
  let heldWrites = null;
  /* A park point INSIDE PREPARE but AFTER the project read has been answered.
     `/api/project` is awaited first and `/api/scan` rides in the Promise.all
     behind it, so holding the scan stands a refresh still in flight with its
     snapshot already in hand — which is the only place a save can land between a
     refresh reading a record and committing it. */
  let armedScan = 0;
  let parkedScan = [];
  let armedJobRefresh = 0;
  let parkedJobRefresh = [];
  let armedCancel = 0;
  let parkedCancel = [];
  /* THE SERVER'S BACKGROUND-RECOVERY NOTICE, modelled exactly as the shipped one
     is: appended when the reaper collects, returned to EVERY reader of the ledger
     route, and consumed only by the request that carries the claim header. */
  let recoveryNotice = null;
  let recoveryOwner = null;
  /* Whether an accepted cancel actually commits the project document — the
     condition the browser cannot see and the route now answers. */
  let cancelWritesProject = false;
  /* The refresh route answering 502 AFTER it has committed the project — a
     durable mutation and a failed request, which are two separate truths. */
  let refreshFailsAfterWrite = false;
  let armedRevision = 0;
  let parkedRevision = [];
  let failRevision = 0;
  /* Every request this fixture answered, so a section can prove what was NOT
     asked for as well as what was. */
  const requests = [];
  /* Parked reads in PARK ORDER, released individually — the only way to drive a
     chosen response order over overlapping refreshes. */
  let parked = [];
  const server = {
    writes,
    completions: 0,
    revisionOf,
    get active() { return active; },
    get docs() { return docs; },
    get parkedReads() { return parked.filter((row) => !row.done).length; },
    holdNextProjectRead() { armed += 1; },
    failNextProjectRead() { failNext += 1; },
    missNextProjectRead() { missNext += 1; },
    removeProject() { missAlways = true; },
    holdNextScanRead() { armedScan += 1; },
    /* A DURABLE ADVANCE WITH NO BROWSER CALL BEHIND IT — the server's own ingest
       reaper, or another window. It moves the stored document and revision
       exactly as the refresh route's ingest does, but the browser never learns of
       it, so it cannot and must not move the freshness generation. That is what
       makes the ordering sections below claims about ORDER rather than about
       freshness: two refreshes read different snapshots without either of them
       declaring anything. */
    serverSideIngest(slug = active, { announce = false } = {}) {
      server.completions += 1;
      const mark = `completion-${server.completions}`;
      docs[slug] = structuredClone(docs[slug]);
      docs[slug].meta.completionMarks = [...(docs[slug].meta.completionMarks || []), mark];
      counters[slug] += 1;
      /* The reaper records what it collected, per project, for the life of the
         process. `announce` is off by default so the ordering sections keep using
         an advance the browser genuinely cannot see. */
      if (announce) {
        const rows = [...((recoveryNotice && recoveryNotice.collections) || []), { jobId: mark, at: `t-${server.completions}` }];
        recoveryNotice = {
          jobs: rows.length,
          results: rows.length,
          collections: rows,
          message: `Collected ${rows.length} result${rows.length === 1 ? "" : "s"} through background recovery.`,
        };
        recoveryOwner = slug;
      }
      return mark;
    },
    /* Pin which project the ledger payload claims the notice belongs to, for the
       case where the server has moved on and a window has not. */
    announceRecoveryFor(slug) { recoveryOwner = slug; },
    get recoveryNotice() { return recoveryNotice; },
    setCancelWritesProject(value) { cancelWritesProject = !!value; },
    setRefreshFailsAfterWrite(value) { refreshFailsAfterWrite = !!value; },
    /* A DURABLE CHANGE WITH NO GENERATION ANYWHERE NEAR IT. Another window, an
       automation run, a restore, a writer that does not exist yet: the point of
       the revision watch is that it does not care which, so the fixture's
       stand-in for "somebody else wrote the project" is deliberately not a
       generation. */
    foreignWrite(slug = active, title = "changed by another window") {
      docs[slug] = structuredClone(docs[slug]);
      docs[slug].meta.title = title;
      counters[slug] += 1;
      return revisionOf(slug);
    },
    failNextRevisionRead() { failRevision += 1; },
    holdNextRevisionRead() { armedRevision += 1; },
    get parkedRevisionReads() { return parkedRevision.length; },
    releaseRevisionReads() {
      const waiting = parkedRevision;
      parkedRevision = [];
      for (const resume of waiting) resume();
    },
    get requests() { return requests; },
    countRequests(match) { return requests.filter((row) => row.includes(match)).length; },
    holdNextCancel() { armedCancel += 1; },
    get parkedCancels() { return parkedCancel.length; },
    releaseCancels() {
      const waiting = parkedCancel;
      parkedCancel = [];
      for (const resume of waiting) resume();
    },
    /* Park the REFRESH ROUTE's own response, which is the only way to stand
       between a completed ingest and the browser learning that it happened. */
    holdNextJobRefresh() { armedJobRefresh += 1; },
    get parkedJobRefreshes() { return parkedJobRefresh.length; },
    releaseJobRefreshes() {
      const waiting = parkedJobRefresh;
      parkedJobRefresh = [];
      for (const resume of waiting) resume();
    },
    get parkedScanReads() { return parkedScan.length; },
    releaseScanReads() {
      const waiting = parkedScan;
      parkedScan = [];
      for (const resume of waiting) resume();
    },
    holdWrites() { heldWrites = []; },
    releaseWrites() {
      const waiting = heldWrites || [];
      heldWrites = null;
      for (const resume of waiting) resume();
    },
    releaseRead(index) {
      const row = parked[index];
      assert(row && !row.done, `no parked read at index ${index}`);
      row.done = true;
      row.resolve();
    },
    releaseProjectReads() {
      for (const row of parked) if (!row.done) { row.done = true; row.resolve(); }
    },
    async fetch(url, options = {}, response) {
      requests.push(`${options.method || "GET"} ${url}`);
      /* THE SMALLEST READ. Byte-hash equality and nothing else: no document, no
         parse, no activity. */
      const revision = /^\/api\/projects\/([^/]+)\/revision$/.exec(url);
      if (revision && (options.method || "GET") === "GET") {
        if (failRevision > 0) {
          failRevision -= 1;
          return response({ error: "The project revision could not be read." }, 500);
        }
        const slug = revision[1];
        if (armedRevision > 0) {
          armedRevision -= 1;
          await new Promise((resolve) => parkedRevision.push(resolve));
        }
        if (!docs[slug]) return response({ error: `No such project: ${slug}`, slug }, 404);
        return response({ slug, revision: revisionOf(slug) });
      }
      const write = /^\/api\/projects\/([^/]+)\/project$/.exec(url);
      if (write && options.method === "PUT") {
        if (heldWrites) await new Promise((resolve) => heldWrites.push(resolve));
        const slug = write[1];
        const ifMatch = (options.headers || {})["If-Match"];
        const body = JSON.parse(options.body || "{}");
        const record = {
          slug,
          ifMatch,
          title: body?.meta?.title || "",
          marks: [...(body?.meta?.completionMarks || [])],
        };
        writes.push(record);
        const reply = replyForWrite(writes.length - 1, record) || { status: 200 };
        if (reply.status && reply.status !== 200) {
          record.status = reply.status;
          return response(reply.body || {}, reply.status);
        }
        /* THE EXACT REVISION, ENFORCED. A write from a view that has fallen
           behind the ingest is refused here rather than accepted. */
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
      if (url === "/api/project") {
        /* Captured at REQUEST time. */
        const slug = active;
        const snapshot = structuredClone(docs[slug]);
        const revision = revisionOf(slug);
        if (failNext > 0) {
          failNext -= 1;
          return response({ error: "The project could not be read." }, 500);
        }
        if (missAlways || missNext > 0) {
          if (!missAlways) missNext -= 1;
          if (armed > 0) {
            armed -= 1;
            await new Promise((resolve) => parked.push({ resolve, done: false }));
          }
          return response({ error: "No project is available yet." }, 404);
        }
        if (armed > 0) {
          armed -= 1;
          await new Promise((resolve) => parked.push({ resolve, done: false }));
        }
        return response(snapshot, 200, {
          "x-cinebraid-project-slug": slug,
          "x-cinebraid-project-revision": revision,
          etag: revision,
        });
      }
      if (url === "/api/scan" && armedScan > 0) {
        armedScan -= 1;
        await new Promise((resolve) => parkedScan.push(resolve));
        return null;
      }
      if (url === "/api/projects/switch" && options.method === "POST") {
        active = JSON.parse(options.body || "{}").slug;
        return response({ ok: true, slug: active });
      }
      if (url === "/api/projects")
        return response({ active, projects: Object.keys(docs).map((slug) => ({ slug, title: docs[slug].meta.title })) });
      const refresh = /^\/api\/generation\/fal\/jobs\/([^/]+)\/refresh$/.exec(url);
      if (refresh && options.method === "POST") {
        /* THE INGEST. The server takes delivery of the finished generation and
           commits it into the project document, which advances the stored
           revision — the whole reason a completion has to re-read at all. It
           lands in the project that was active when the request was MADE, exactly
           as the shipped route's captured owner does. */
        const slug = active;
        server.completions += 1;
        const mark = `completion-${server.completions}`;
        docs[slug] = structuredClone(docs[slug]);
        docs[slug].meta.completionMarks = [...(docs[slug].meta.completionMarks || []), mark];
        counters[slug] += 1;
        /* Parked AFTER the ingest and before the answer, which is the only place a
           project switch can land between the record moving and the browser
           learning that it moved. */
        if (armedJobRefresh > 0) {
          armedJobRefresh -= 1;
          await new Promise((resolve) => parkedJobRefresh.push(resolve));
        }
        /* The route wrote and then failed. It says both. */
        if (refreshFailsAfterWrite)
          return response({ error: "The provider did not answer.", job: { id: refresh[1], status: "IN_PROGRESS" }, projectUpdated: true }, 502);
        return response({ job: { id: refresh[1], status: "COMPLETED", shotId: "L1-01",
          outputs: [{ type: "candidate", assetId: mark }] } });
      }
      const cancel = /^\/api\/generation\/fal\/jobs\/([^/]+)\/cancel$/.exec(url);
      if (cancel && options.method === "POST") {
        const slug = active;
        /* The route writes the entity's coverage-automation status into the
           project document ONLY for an entity-reference job whose entity has
           coverage automation configured, and states which happened. */
        if (cancelWritesProject) {
          docs[slug] = structuredClone(docs[slug]);
          docs[slug].meta.coverageStatus = "cancelled";
          counters[slug] += 1;
        }
        if (armedCancel > 0) {
          armedCancel -= 1;
          await new Promise((resolve) => parkedCancel.push(resolve));
        }
        return response({ ok: true, job: { id: cancel[1], status: "CANCELLED" }, projectUpdated: cancelWritesProject });
      }
      /* RECONCILE WRITES THE LEDGER AND NOTHING ELSE. No project mutation, and so
         no `projectUpdated` to report. */
      const reconcile = /^\/api\/generation\/fal\/jobs\/([^/]+)\/reconcile$/.exec(url);
      if (reconcile && options.method === "POST")
        return response({ ok: true, job: { id: reconcile[1], status: "FAILED", reconciliation: { outcome: "not-accepted" } } });
      if (url === "/api/generation/fal/jobs") {
        if (ledger) return ledger(response, active);
        const claim = String((options.headers || {})["x-cinebraid-claim-recovery"] || "") === "1";
        const payload = { jobs: [], projectSlug: recoveryOwner || active };
        if (recoveryNotice) payload.backgroundRecovery = recoveryNotice;
        /* Claimed once, by the browser's initial ledger load. Every other reader —
           the activity poll included — leaves it where it is. */
        if (claim) { recoveryNotice = null; recoveryOwner = null; }
        return response(payload);
      }
      return null;
    },
  };
  return server;
}

/* ===========================================================================
   READERS. */

async function openFixture(server, project, options = {}) {
  /* `fal: true` puts the generation ledger in play — enabled and keyed on both
     sides. It is the condition the server's ingest reaper sweeps under, and
     therefore the condition the browser's recovery watch runs under. */
  const { fal = false, fetch: override, ...renderOptions } = options;
  const base = override || server.fetch;
  const fetchImpl = fal
    ? async (url, requestOptions, response) => {
        if (url === "/api/config")
          return response({ generation: { fal: { enabled: true, apiKey: "test-key", keySource: "config" } } });
        return base(url, requestOptions, response);
      }
    : base;
  const rendered = await render("#/production", project, { ...renderOptions, fetch: fetchImpl });
  return rendered.context;
}
const saveIndicator = (context) =>
  read(context, 'document.getElementById("save-state").querySelector("span:last-child").textContent');
/* Null-safe on `P`, because a control that reproduces the first-run terminal has
   to be able to describe the workspace it just cleared. */
const marks = (context) => JSON.parse(read(context, "JSON.stringify(P ? (P.meta.completionMarks || []) : [])"));
/* The state a discarded refresh must leave completely alone. */
function projectIdentity(context) {
  return {
    slug: read(context, "ACTIVE_PROJECT_SLUG"),
    revision: read(context, "PROJECT_REVISION"),
    title: read(context, "P ? P.meta.title : null"),
    epoch: read(context, "PROJECT_OPEN_EPOCH"),
    continuity: read(context, "CONTINUITY_RUNS.size"),
    topbar: read(context, 'document.getElementById("topbar-project").textContent'),
  };
}
const clientState = (context) => ({
  revision: read(context, "PROJECT_REVISION"),
  marks: marks(context),
  epoch: read(context, "PROJECT_OPEN_EPOCH"),
  refreshCommitted: read(context, "PROJECT_REFRESH_COMMITTED"),
  saveGeneration: read(context, "PROJECT_SAVE_GENERATION"),
  conflict: read(context, "PROJECT_CONFLICT"),
  blocked: read(context, "SAVE_BLOCKED"),
  authorityRefused: read(context, "AUTHORITY_SAVE_REFUSED"),
  baselineTitle: read(context, "SAVED_PROJECT_BASELINE ? SAVED_PROJECT_BASELINE.meta.title : null"),
  indicator: saveIndicator(context),
});
function workspaceState(context) {
  return {
    ...clientState(context),
    slug: read(context, "ACTIVE_PROJECT_SLUG"),
    title: read(context, "P ? P.meta.title : null"),
    dirty: read(context, "projectHasUnsavedEdits()"),
    topbar: read(context, 'document.getElementById("topbar-project").textContent'),
    projectTitle: read(context, 'document.getElementById("project-title").textContent'),
    firstRun: read(context, 'document.getElementById("main").innerHTML.includes("WELCOME TO CINEBRAID")'),
  };
}
/* Start a completion refresh whose read is parked, and hand back the park-order
   index the suite releases it by. */
async function beginParkedRefresh(server, context, handle, jobId, entry = "fal") {
  const index = server.parkedReads;
  server.holdNextProjectRead();
  /* "generic" enters the refresh lifecycle DIRECTLY, with no completion in front
     of it — the only way to reach a refresh terminal with the view still dirty,
     because both shipped completion paths persist authored work before they ask
     the server to ingest. */
  vm.runInContext(entry === "generic"
    ? `${handle} = load({ intent: "refresh" });`
    : entry === "automation"
      ? `${handle} = v626RefreshFalJob(${JSON.stringify(jobId)});`
      : `${handle} = refreshFalGeneration(${JSON.stringify(jobId)}, false);`, context);
  await settle();
  assert.strictEqual(server.parkedReads, index + 1, `precondition: ${handle}'s read must be parked in flight`);
  return index;
}
async function releaseAndSettle(server, context, index, handle) {
  server.releaseRead(index);
  await read(context, handle);
  await settle();
}
/* Park a refresh INSIDE PREPARE but PAST the project read, so it is holding a
   snapshot of the record as it was when it asked. This is the only place a
   durable advance can land between a refresh reading and committing. */
async function beginScanParkedRefresh(server, context, handle) {
  server.holdNextScanRead();
  vm.runInContext(`${handle} = load({ intent: "refresh" }).then((result) => JSON.stringify(result));`, context);
  await settle();
  assert.strictEqual(server.parkedScanReads, 1, `precondition: ${handle} must be parked inside PREPARE, past the project read`);
}
async function releaseScanParked(server, context, handle) {
  server.releaseScanReads();
  const outcome = JSON.parse(await read(context, handle));
  await settle();
  return outcome;
}

/* ===========================================================================
   PART 1 — INTENT IS IMMUTABLE.
   =========================================================================== */

/* F9. A refresh with no project open returns. It does not open one, it does not
   clear anything, it does not advance the epoch, and an explicit open afterwards
   still works normally. This is proof B from the brief. */
async function refreshWithNoProjectSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const epochWhenOpen = read(context, "PROJECT_OPEN_EPOCH");

  /* The two shapes the defect took: no record, and no identity. Each is set from
     out here rather than reached through a terminal, so the section is about the
     refresh lifecycle's own entry condition and nothing else. */
  for (const [label, setup] of [
    ["P is null", `P = null;`],
    ["the slug is empty", `ACTIVE_PROJECT_SLUG = "";`],
  ]) {
    vm.runInContext(`__saved = { P, slug: ACTIVE_PROJECT_SLUG }; ${setup}`, context);
    const before = { epoch: read(context, "PROJECT_OPEN_EPOCH"), sequence: read(context, "PROJECT_REFRESH_SEQUENCE") };
    const outcome = JSON.parse(await read(context, `load({ intent: "refresh" }).then((result) => JSON.stringify(result))`));
    await settle();

    assert.strictEqual(outcome.intent, "refresh", `${label}: the operation must still BE a refresh when it ends`);
    assert.strictEqual(outcome.committed, false, `${label}: and it must have discarded rather than committed`);
    assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), before.epoch,
      `${label}: a refresh with nothing to refresh must not advance the project-open epoch`);
    assert.strictEqual(read(context, "PROJECT_REFRESH_SEQUENCE"), before.sequence,
      `${label}: and must not even take a refresh ticket`);
    assert.strictEqual(read(context, 'document.getElementById("main").innerHTML.includes("WELCOME TO CINEBRAID")'), false,
      `${label}: the first-run screen belongs to an explicit open and must never appear here`);
    vm.runInContext(`P = __saved.P; ACTIVE_PROJECT_SLUG = __saved.slug;`, context);
  }

  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), epochWhenOpen, "no refresh above installed anything");
  /* AND THE EXPLICIT OPEN STILL WORKS. Without this the section could pass by
     having broken loading altogether. */
  await vm.runInContext(`load()`, context);
  await settle();
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "an explicit open after the discards still installs the project");
  assert.strictEqual(read(context, "P.meta.title"), "Project A", "with its record on screen");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH") > epochWhenOpen, true, "and it advances the epoch, because it is a replacement");
  console.log("  F9 refresh-with-no-project - a refresh with no record and a refresh with no slug both discard, and the explicit open still works");
}

/* A refresh whose response describes ANOTHER project discards. It does not adopt
   the other project, and it does not escalate into a replacement of it. */
async function refreshAnsweredForAnotherProjectSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  /* THE ACTIVE PROJECT IS CHANGED ON THE SERVER ONLY — a second tab, or another
     machine on the LAN — so nothing on the client moves. The refresh that follows
     is answered for a project this window was never told about. The epoch and the
     ticket's own slug both still match, so the ONLY thing that can refuse this is
     the response's own stated owner. */
  await vm.runInContext(`fetch("/api/projects/switch", { method: "POST", headers: {}, body: JSON.stringify({ slug: ${JSON.stringify(B)} }) })`, context);
  const before = workspaceState(context);
  assert.strictEqual(server.active, B, "precondition: the server has moved to another project");
  assert.strictEqual(before.slug, A, "precondition: and this window still believes it has A open");

  const outcome = JSON.parse(await read(context, `load({ intent: "refresh" }).then((result) => JSON.stringify(result))`));
  await settle();
  assert.strictEqual(outcome.committed, false, "the refresh must have discarded");
  assert.strictEqual(outcome.reason, "the response describes a different project than the one open",
    "and for the response's own owner, not for staleness or dirtiness");
  assert.deepStrictEqual(workspaceState(context), before,
    "a refresh answered for another project must change nothing at all");
  assert.strictEqual(read(context, "P.meta.title"), "Project A", "the record on screen is still A's");
  console.log("  intent-immutable-foreign-response - a refresh answered for another project discards; it neither adopts it nor replaces with it");
}

/* THE STRUCTURAL HALF. The statements that perform a replacement exist only in
   the replacement lifecycle. This is a source claim on purpose: it is what makes
   the behavioural sections claims about a shape rather than about a set of
   branches that all happen to be guarded today. */
function intentIsStructuralSection() {
  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8").replace(/\r\n/g, "\n");
  const bodyOf = (signature, end = "\n}") => {
    const start = appSource.indexOf(signature);
    assert(start > 0, `${signature} must exist`);
    const stop = appSource.indexOf(end, start);
    assert(stop > start, `${signature} must terminate`);
    return appSource.slice(start, stop);
  };
  const refresh = bodyOf("async function runProjectRefresh()");
  const replacement = bodyOf("async function runProjectReplacement()");

  /* The four replacement acts named in the brief. */
  for (const [act, token] of [
    ["advance the project-open epoch", "beginProjectOpen"],
    ["enter first-run", "showFirstRunWorkspace"],
    ["clear the current workspace", "resetContinuityWorkspaceState"],
  ]) {
    assert(!refresh.includes(token), `a refresh must have no way to ${act}: it names ${token}`);
  }
  assert(replacement.includes("beginProjectOpen"), "the replacement lifecycle must be the one that advances the epoch");
  assert(replacement.includes("showFirstRunWorkspace"), "and the one that can enter first-run");
  /* PROJECT_OPEN_EPOCH is written in exactly one place. */
  const epochWrites = appSource.match(/PROJECT_OPEN_EPOCH\s*(\+=|=[^=])/g) || [];
  assert.strictEqual(epochWrites.length, 2,
    `the project-open epoch must be written by its declaration and by beginProjectOpen() and nowhere else, and it is written ${epochWrites.length} times`);
  assert(/function beginProjectOpen\(\)\s*\{\s*PROJECT_OPEN_EPOCH \+= 1;/.test(appSource),
    "and the one write must be beginProjectOpen()'s");
  /* The intent is read once, at entry, from the caller's own argument. */
  assert(/function requestedProjectIntent\(options\)\s*\{\s*return options && options\.intent === "refresh" \? "refresh" : "open";\s*\}/.test(appSource),
    "the intent must be classified from the requested argument alone, with no runtime state in the expression");
  const load = bodyOf("async function load(options = {})");
  assert(!/\bP\b|ACTIVE_PROJECT_SLUG|PROJECT_REVISION|SAVE_/.test(load.replace(/\/\*[\s\S]*?\*\//g, "")),
    "load() itself must only dispatch on the requested intent; it must not read project or save state to decide");
  console.log("  intent-immutable-structure - the statements that replace a project exist only in the replacement lifecycle, and the epoch has one writer");
}

/* ===========================================================================
   PART 2 — PREPARE, AND WHAT IT IS NOT ALLOWED TO TOUCH.
   =========================================================================== */

/* F8, AND PROOF A FROM THE BRIEF. The generation ledger read is PARKED while a
   filmmaker edit is refused with a typed 422. Releasing the ledger must not turn
   "Not saved — saving is paused" back into "Saved". */
async function ledgerParkedDuringPrepareSection(options = {}) {
  let releaseLedger = () => {};
  const parkedLedger = new Promise((resolve) => { releaseLedger = resolve; });
  let ledgerRequests = 0;
  const server = refreshServer({
    a: currentSchemaProject("Project A"),
    b: currentSchemaProject("Project B"),
    replyForWrite: () => ({
      status: 422,
      body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.",
        issues: ["shots[0].dur must be a positive number"] },
    }),
    ledger: async (response) => {
      ledgerRequests += 1;
      if (ledgerRequests === 1) await parkedLedger;
      return response({ jobs: [], projectSlug: A });
    },
  });
  /* fal enabled and keyed, which is the only condition under which the ledger is
     read at all — without it this section would park nothing. */
  const withFal = async (url, requestOptions, response) => {
    if (url === "/api/config")
      return response({ generation: { fal: { enabled: true, apiKey: "test-key", keySource: "config" } } });
    return server.fetch(url, requestOptions, response);
  };

  /* The open is started and left in flight, parked on the ledger read. */
  let context = null;
  const opening = render("#/production", currentSchemaProject("Project A"), { ...options, fetch: withFal })
    .then((rendered) => { context = rendered.context; });
  await realDelay(120);
  assert.strictEqual(ledgerRequests, 1, "precondition: the ledger read must be in flight");
  /* THE FIRST HALF OF THE CLAIM, not a precondition. The ledger is an INPUT to
     the open, so an open cannot finish while it is still being read. When the
     read sat after the commit instead, the open completed with a whole network
     round-trip still outstanding inside the transaction — and whatever that
     round-trip did on its way back was applied to a window that had already
     moved on. */
  assert.strictEqual(context, null,
    "the open must not be able to finish while the generation ledger is still being read: a ledger read that lands after the commit is a round-trip inside the transaction");

  /* THE WINDOW THE DEFECT LIVED IN. In the shipped shape the project was already
     installed here, so an edit made now was real, was refused by the server, and
     was then overwritten by the rest of load(). In the repaired shape nothing has
     been installed yet — which is itself the first half of the claim. */
  releaseLedger();
  await opening;
  await settle();
  assert(context, "the open must complete once the ledger is released");
  assert.strictEqual(read(context, "P.meta.title"), "Project A", "the project is installed by the commit, after the ledger");

  /* Now the same collision from the other side, which is the half that has to
     hold FOREVER rather than only during one open: a refused save, followed by a
     refresh whose ledger read is parked. */
  await vm.runInContext(`(async () => {
    P.meta.title = "an edit the server will not accept";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  await settle();
  assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "precondition: the typed 422 must have paused saving");
  assert.strictEqual(saveIndicator(context), "Not saved — project failed validation",
    "precondition: and the indicator must say so");
  const refusedTruth = clientState(context);

  let releaseSecond = () => {};
  const parkedSecond = new Promise((resolve) => { releaseSecond = resolve; });
  ledgerRequests = 1;
  const secondLedger = async (url, requestOptions, response) => {
    if (url === "/api/config")
      return response({ generation: { fal: { enabled: true, apiKey: "test-key", keySource: "config" } } });
    if (url === "/api/generation/fal/jobs") { await parkedSecond; return response({ jobs: [], projectSlug: A }); }
    return server.fetch(url, requestOptions, response);
  };
  context.fetch = (input, requestOptions = {}) => {
    const url = String(input);
    const response = (body, status = 200, headers = {}) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
      json: async () => structuredClone(body),
      text: async () => JSON.stringify(body),
    });
    return secondLedger(url, requestOptions, response).then((result) => result || response({}));
  };
  vm.runInContext(`__refresh = load({ intent: "refresh" });`, context);
  await settle();
  assert.deepStrictEqual(clientState(context), refusedTruth,
    "a refresh parked in PREPARE must not have touched save truth on its way in");
  releaseSecond();
  await read(context, "__refresh");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(read(context, "SAVE_BLOCKED"), true,
    "THE BLOCKER: releasing a parked ledger read must not clear the save-blocked latch");
  assert.notStrictEqual(saveIndicator(context), "Saved",
    "and nothing may report Saved over an edit the server refused and never wrote");
  assert.strictEqual(read(context, "P.meta.title"), "an edit the server will not accept",
    "the refused edit is still in this tab, for the filmmaker to decide about");
  assert.deepStrictEqual(clientState(context), refusedTruth,
    "in fact the whole of save truth must be exactly as the refusal left it");
  console.log("  F8 ledger-parked-in-prepare - a parked generation-ledger read cannot turn a typed 422 and a paused save back into Saved");
}

/* The structural half of the same claim: the ledger read happens in PREPARE, and
   there is nothing between the commit and the end of the lifecycle that could
   rewrite save truth. Proofs C and D from the brief. */
function commitIsAwaitFreeSection() {
  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8").replace(/\r\n/g, "\n");
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bodyOf = (signature) => {
    const start = appSource.indexOf(signature);
    assert(start > 0, `${signature} must exist`);
    const stop = appSource.indexOf("\n}", start);
    assert(stop > start, `${signature} must terminate`);
    return appSource.slice(start, stop);
  };

  /* C — NO AWAIT BETWEEN THE FINAL VALIDATION AND THE COMMIT. */
  const refresh = stripComments(bodyOf("async function runProjectRefresh()"));
  const validateAt = refresh.indexOf("const refusal = projectRefreshRefusal(");
  const commitAt = refresh.indexOf("commitPreparedProject(");
  assert(validateAt > 0 && commitAt > validateAt, "the refresh must validate and then commit, in that order");
  const between = refresh.slice(validateAt, commitAt);
  assert(!/\bawait\b/.test(between),
    `there must be no await between the final refresh validation and the commit, and there is:\n${between}`);
  assert(!/\bawait\b/.test(refresh.slice(commitAt)),
    "and none between the commit and the end of the lifecycle either");

  /* THE COMMIT ITSELF IS AWAIT-FREE, and so is everything it calls. */
  const commitChain = ["function commitPreparedProject(", "function applyProjectRecordDefaults(", "function beginProjectOpen(", "function beginProjectRefresh(", "function projectRefreshRefusal("];
  for (const signature of commitChain) {
    const body = stripComments(bodyOf(signature));
    assert(!/\bawait\b/.test(body), `${signature} is part of the synchronous commit path and must contain no await`);
    assert(!/^async /.test(signature.replace("function ", "")), `${signature} must not be async`);
    assert(!appSource.includes(`async ${signature}`), `${signature} must not be declared async`);
  }
  /* And it is reached synchronously: the lifecycle does not await it, because
     awaiting it would mean it could yield. */
  assert(/\n  commitPreparedProject\(prepared, ticket\);/.test(refresh),
    "the refresh must call the commit as a plain synchronous statement");

  /* D — POST-COMMIT WORK CANNOT REACH A SAVE-TRUTH MUTATOR. */
  const decoration = stripComments(bodyOf("function decorateProjectCommit("));
  for (const forbidden of [
    "SAVED_PROJECT_BASELINE", "SAVE_BLOCKED", "SAVE_REVISION", "SAVED_REVISION",
    "PROJECT_REVISION", "ACTIVE_PROJECT_SLUG", "PROJECT_OPEN_EPOCH", "PROJECT_REFRESH_COMMITTED",
    "setSaveState", "blockSaving", "dirty(", "commitPreparedProject", "beginProjectOpen",
    "resetContinuityWorkspaceState", "P =",
  ]) {
    assert(!decoration.includes(forbidden),
      `post-commit decoration must not name ${forbidden}; chrome that needs data takes it from the prepared snapshot`);
  }
  /* THERE IS NO GENERIC POST-COMMIT WRAPPER, AND NO LATCH.

     An earlier version of this file guarded the transaction's tail with a depth
     counter that every save-truth writer consulted. A counter raised around a
     synchronous call is not an asynchronous barrier — it falls the instant that
     call returns — and holding one across awaits would suppress the filmmaker's
     own later edits. The guarantee it claimed was false, so it is gone, and what
     replaces it is that the tail has no affordance to hand work to. */
  for (const absent of ["PROJECT_POST_COMMIT_DEPTH", "PROJECT_POST_COMMIT_REFUSALS", "afterProjectCommit", "scheduleProjectDecoration", "refuseFromProjectDecoration"]) {
    assert(!appSource.includes(absent),
      `${absent} is the false post-commit latch and must not exist: a depth counter cannot barrier an await, and a generic wrapper is the affordance that lets a later caller hand save-truth work to the transaction's tail`);
  }
  assert(/function decorateProjectCommit\(prepared\) \{/.test(appSource),
    "post-commit work must be ONE DEDICATED function taking the prepared snapshot as data");
  assert(!/async function decorateProjectCommit/.test(appSource), "which is synchronous");

  /* AND WHAT IT DEFERS IS A FIXED, NAMED SET. Every identifier the decoration
     calls is listed here; anything new has to be added deliberately, which is
     what makes "presentational only" a checkable claim rather than an intention. */
  const DECORATION_MAY_CALL = new Set([
    /* presentation */
    "applyTheme", "applyProductionFormat", "watchIntrinsicAspect", "$", "toast",
    "setAttribute", "route",
    /* A2. The shell's project title, format and topbar lines, which the
       decoration used to write inline through $ and setAttribute. It reads
       P.meta and writes text; it is on this list rather than exempt from it
       because that is the point of the list. */
    "applyProjectIdentity",
    /* hand-offs to independent product lifecycles, entered through their own
       shipped entry points and carrying no authority out of this transaction */
    "refreshAgentStatus", "resumeFalGenerationPolling",
    /* language and scheduling */
    "setTimeout", "if", "for", "while", "switch", "catch", "return", "typeof", "some", "includes",
  ]);
  /* From past the signature line, so the function's own name is not read as a
     call it makes — and a recursive call to itself would still be caught. */
  const decorationBody = stripComments(bodyOf("function decorateProjectCommit("));
  const called = new Set(
    [...decorationBody.slice(decorationBody.indexOf("\n")).matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
  );
  const unexpected = [...called].filter((name) => !DECORATION_MAY_CALL.has(name));
  assert.deepStrictEqual(unexpected, [],
    `post-commit decoration may only call presentation and the two documented lifecycle hand-offs; it also calls: ${unexpected.join(", ")}`);

  /* THE FRESHNESS TOKEN IS A GENERATION, AND IT IS COMPARED FOR EQUALITY. */
  assert(/if \(ticket\.saveGeneration !== PROJECT_SAVE_GENERATION\)/.test(appSource),
    "the refresh must require the successful-save generation it began in to be unchanged");
  const generationWrites = appSource.match(/PROJECT_SAVE_GENERATION\s*(\+=|=[^=])/g) || [];
  assert.strictEqual(generationWrites.length, 4,
    `the save generation must be written by its declaration, by an accepted write, by a rebase and by the one shared helper every external durable advance goes through — and it is written ${generationWrites.length} times`);
  assert(!/PROJECT_SAVE_GENERATION\s*[<>]/.test(appSource), "and never ordered, only compared for equality");
  assert(!/ticket\.revision\s*[<>!=]==?\s*PROJECT_REVISION|PROJECT_REVISION\s*[<>]/.test(appSource),
    "and the opaque revision string must never be compared for order or used as the freshness token, because a refresh COMMIT legitimately moves it");

  /* ORDERING IS INTEGERS, NEVER AN OPAQUE REVISION STRING. A revision is a
     server token this window can only compare for equality; treating it as an
     order would make the client's idea of "newer" depend on a format the server
     is free to change. */
  const validate = stripComments(bodyOf("function projectRefreshRefusal(ticket, prepared)"));
  /* A revision may be NAMED — the reason a discard is reported in says which
     revision the snapshot was read at, which is the useful half of carrying it —
     but it must never be part of a DECISION. Not ordered, and not used as the
     freshness token either: a refresh COMMIT legitimately moves PROJECT_REVISION,
     so requiring it to be unchanged would discard the second of two overlapping
     refreshes. */
  const comparators = "(===|!==|==|!=|<=|>=|<|>)";
  const revisionTokens = "(PROJECT_REVISION|ticket\\.revision|prepared\\.revision)";
  assert(!new RegExp(`${revisionTokens}\\s*${comparators}`).test(validate)
      && !new RegExp(`${comparators}\\s*${revisionTokens}`).test(validate),
    `the refresh decision must not compare a revision, and it does:\n${validate}`);
  assert(validate.includes("ticket.saveGeneration !== PROJECT_SAVE_GENERATION"),
    "freshness must be decided on the successful-save generation, which moves only when this window puts something on disk");
  assert(validate.includes("ticket.sequence <= PROJECT_REFRESH_COMMITTED"),
    "refreshes must be ordered by their own integer sequence against the committed watermark");

  /* NO ARBITRARY CLIENT MERGE. A refresh commits the prepared record whole or
     discards it whole; it never reconciles two divergent documents. */
  const commit = stripComments(bodyOf("function commitPreparedProject("));
  assert(/\n  P = prepared\.project;/.test(commit), "the commit must install the prepared record whole");
  for (const merge of ["Object.assign(P", "...P", "P.meta =", "merge"]) {
    assert(!commit.includes(merge), `the commit must not reconcile documents; it names ${merge}`);
  }

  /* PREPARE touches nothing authoritative. */
  for (const signature of ["async function prepareProjectSnapshot(", "async function prepareGenerationLedger(prepared,"]) {
    const body = stripComments(bodyOf(signature));
    for (const forbidden of [
      "P =", "ACTIVE_PROJECT_SLUG =", "PROJECT_REVISION =", "SAVE_REVISION", "SAVED_REVISION",
      "SAVED_PROJECT_BASELINE", "SAVE_BLOCKED", "setSaveState", "blockSaving", "dirty(",
      "PROJECT_OPEN_EPOCH", "PROJECT_REFRESH_COMMITTED", "resetContinuityWorkspaceState",
      "v670ScopeActivityToProject", "SCAN =", "CONFIG =", "FAL_GENERATION_JOBS =",
    ]) {
      assert(!body.includes(forbidden), `${signature} is PREPARE and must not write ${forbidden}`);
    }
  }
  /* THE LEDGER IS AN INPUT. It is read by PREPARE and installed by the commit;
     it is not read anywhere after a commit. */
  assert(bodyOf("async function prepareGenerationLedger(prepared,").includes('fetch("/api/generation/fal/jobs"'),
    "the generation ledger must be read during PREPARE");
  assert(stripComments(bodyOf("function commitPreparedProject(")).includes("FAL_GENERATION_JOBS = prepared.falJobs;"),
    "and installed by the commit from the prepared snapshot");
  console.log("  C/D commit-shape - no await between validate and commit, the commit chain is synchronous, and post-commit decoration cannot name a save-truth mutator");
}

/* The runtime half of D. THERE IS NO LATCH: an earlier version raised a depth
   counter around the decoration and had every save-truth writer consult it, which
   was a false guarantee — a counter raised around a synchronous call falls the
   instant that call returns, so nothing resuming after an await was ever inside
   it, and holding it across awaits would have suppressed the filmmaker's own
   later edits.

   What is claimed instead is structural narrowness, and this is the behaviour
   that follows from it: after a commit, letting EVERY deferred decoration timer
   fire changes nothing about save truth — over a dirty view, over a blocked view,
   and over a conflicted one — and ordinary later user-driven saving still works,
   so nothing was suppressed to get there. */
async function decorationCannotWriteSaveTruthSection(options = {}) {
  /* Past every timer decorateProjectCommit() schedules: 120ms, 200ms, 400ms and
     500ms, stated here rather than inherited so the section cannot stop covering
     one of them silently. */
  const PAST_EVERY_DECORATION_TIMER_MS = 500 + 350;

  /* D1. A DIRTY VIEW. The commit settles on "Saved" truthfully — the record on
     screen IS the stored one — and then an edit is authored while the decoration's
     deferred work is still queued. */
  {
    const server = soloServer();
    const context = await openSolo(server, options);
    assert.strictEqual(saveIndicator(context), "Saved", "precondition: the commit settled truthfully");
    vm.runInContext(`P.meta.title = "authored while the decoration was still queued"; dirty();`, context);
    const dirtyTruth = clientState(context);
    assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "precondition: there is save truth to protect");
    assert.notStrictEqual(dirtyTruth.indicator, "Saved", "precondition: and it says so");

    /* Everything the open deferred fires here — the two toasts, the agent-status
       re-read and the generation poller — with the debounce suppressed so the
       section observes decoration rather than the save that would follow it. */
    vm.runInContext(`clearTimeout(saveTimer); saveTimer = null;`, context);
    await realDelay(PAST_EVERY_DECORATION_TIMER_MS);
    await settle();
    assert.deepStrictEqual(clientState(context), dirtyTruth,
      "no deferred post-commit work may restate save truth over an authored edit");
    assert.strictEqual(read(context, "P.meta.title"), "authored while the decoration was still queued", "and the record is untouched");
    assert.deepStrictEqual(server.writes, [], `and nothing may have been written: ${JSON.stringify(server.writes)}`);
  }

  /* D2. A BLOCKED VIEW. The refusal arrives after the commit, and the decoration
     that was queued before it must not clear it. */
  {
    const server = soloServer({
      replyForWrite: () => ({ status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["shots[0].dur must be a positive number"] } }),
    });
    const context = await openSolo(server, options);
    await vm.runInContext(`(async () => { P.meta.title = "refused while the decoration was queued"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
    await settle();
    assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "precondition: the typed 422 paused saving");
    const blockedTruth = clientState(context);
    assert.notStrictEqual(blockedTruth.indicator, "Saved", "precondition: and the indicator says so");

    await realDelay(PAST_EVERY_DECORATION_TIMER_MS);
    await settle();
    assert.deepStrictEqual(clientState(context), blockedTruth,
      "THE BLOCKER: no deferred post-commit work may clear SAVE_BLOCKED or restate the indicator as Saved");
    assert.strictEqual(read(context, "P.meta.title"), "refused while the decoration was queued",
      "and the refused edit stays in this tab");
    assert.strictEqual(server.writes.length, 1, `with nothing further on the wire: ${JSON.stringify(server.writes)}`);
  }

  /* D3. THE DIRECT CONFLICT AND AUTHORITY SURFACES. A real 409 latches
     PROJECT_CONFLICT after the commit; the decoration cannot reach the mutator
     that would clear it, and cannot reach the one that would set it either. */
  {
    const server = soloServer();
    const context = await openSolo(server, options);
    /* The stored document moves under this window — another tab, or the server's
       own ingest — so the next write is genuinely stale. */
    await vm.runInContext(`refreshFalGeneration("job-1", false)`, context);
    await settle();
    vm.runInContext(`PROJECT_REVISION = '"rev-project-a-0"'; P.meta.title = "written from a view that has fallen behind"; dirty();`, context);
    await vm.runInContext(`(async () => { await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
    await settle();
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), true, "precondition: the 409 latched the conflict surface");
    const conflicted = clientState(context);

    await realDelay(PAST_EVERY_DECORATION_TIMER_MS);
    await settle();
    assert.deepStrictEqual(clientState(context), conflicted,
      "a latched conflict must survive every deferred post-commit path the open queued");
  }

  /* D4. ORDINARY LATER USER-DRIVEN WORK STILL FUNCTIONS. Without this the three
     sections above could pass against a product that had simply stopped saving. */
  {
    const server = soloServer();
    const context = await openSolo(server, options);
    await realDelay(PAST_EVERY_DECORATION_TIMER_MS);
    await settle();
    const ownedRevision = server.revisionOf(A);
    await vm.runInContext(`(async () => { P.meta.title = "an ordinary edit, made afterwards"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
    await settle();
    assert.deepStrictEqual(server.writes.map((row) => [row.title, row.ifMatch, row.status]),
      [["an ordinary edit, made afterwards", ownedRevision, 200]],
      `a user-driven save after every decoration timer has fired must still send exactly one accepted write: ${JSON.stringify(server.writes)}`);
    assert.strictEqual(saveIndicator(context), "Saved", "and settle truthfully");
    assert.strictEqual(read(context, "projectHasUnsavedEdits()"), false, "with the counters in step");
    /* And the blocking surfaces still ARM — the removal took away a latch, not
       the product's ability to report a refusal. */
    vm.runInContext(`blockSaving(); setSaveState("error", "Not saved — saving is paused");`, context);
    assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "blockSaving() still works when a real refusal calls it");
    assert.strictEqual(saveIndicator(context), "Not saved — saving is paused", "and the indicator still writes");
    vm.runInContext(`resumeProjectSaving();`, context);
    assert.strictEqual(read(context, "SAVE_BLOCKED"), false, "and the filmmaker can still resume");
  }
  console.log("  D decoration-cannot-write-save-truth - every deferred post-commit path leaves dirty, blocked and conflicted truth untouched, and ordinary later saving still works");
}

/* ===========================================================================
   THE PREPARED SNAPSHOT MUST STILL BE FRESH.

   A refresh is several awaits long, and a save can be authored, dispatched and
   ACCEPTED inside it. The window and storage then move on together to a revision
   the prepared snapshot predates — and the window is CLEAN again, so the
   unsaved-work rule has nothing left to catch. Committing there rolls the record
   back to a document the server no longer holds: R1 on the server, R0 on screen,
   the indicator resting on Saved, and nothing in flight to correct it.

   The token is a monotonic successful-save generation, compared for EQUALITY.
   It is deliberately NOT the revision string: a refresh COMMIT legitimately moves
   PROJECT_REVISION, so requiring the revision to be unchanged would discard the
   second of two overlapping refreshes — the ordering the sequence and the
   watermark exist to get right. Two tokens, two questions. */
async function preparedSnapshotFreshnessSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "precondition: the window is at R0");
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");

  /* PREPARE is entered and parked AFTER the project read has been answered, so
     the refresh is holding an R0 snapshot it has not yet committed. */
  server.holdNextScanRead();
  vm.runInContext(`__refresh = load({ intent: "refresh" }).then((result) => JSON.stringify(result));`, context);
  await settle();
  assert.strictEqual(server.parkedScanReads, 1, "precondition: the refresh is parked inside PREPARE, past the project read");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "precondition: and nothing has been installed by it");

  /* An authored edit is written and ACCEPTED while that snapshot is in flight.
     Client and server advance to R1 together, and the window is clean again. */
  await vm.runInContext(`(async () => { P.meta.title = "authored and saved while the refresh was in flight"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  const R1 = server.revisionOf(A);
  assert.notStrictEqual(R1, R0, "precondition: the accepted write must have moved the stored revision");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "precondition: and the window with it");
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), false,
    "precondition: THE WINDOW IS CLEAN — which is why the unsaved-work rule cannot be what catches this");
  assert.strictEqual(saveIndicator(context), "Saved", "precondition: and truthfully says so");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
    "precondition: exactly one accepted write, so exactly one generation");
  const atR1 = workspaceState(context);

  /* The prepared R0 snapshot is released. */
  server.releaseScanReads();
  const outcome = JSON.parse(await read(context, "__refresh"));
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(outcome.committed, false,
    "THE BLOCKER: a snapshot read before this window's own accepted write must be discarded, not installed");
  assert(/saved to storage while this refresh was in flight/.test(outcome.reason),
    `and discarded for the freshness reason, not another: ${JSON.stringify(outcome.reason)}`);
  assert(outcome.reason.includes(R0), `naming the revision it read: ${JSON.stringify(outcome.reason)}`);
  assert.deepStrictEqual(workspaceState(context), atR1,
    "the window must be exactly as the accepted write left it — record, revision, baseline and save truth");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "still R1, never rolled back to R0");
  assert.strictEqual(read(context, "P.meta.title"), "authored and saved while the refresh was in flight",
    "with the authored record still on screen");
  assert.strictEqual(read(context, "SAVED_PROJECT_BASELINE").meta.title, "authored and saved while the refresh was in flight",
    "and the saved baseline still describing it");
  assert.strictEqual(server.revisionOf(A), R1, "the server is unmoved");
  assert.strictEqual(server.docs[A].meta.title, "authored and saved while the refresh was in flight",
    "and still holds the authored document");

  /* AND A REFRESH STILL WORKS AFTERWARDS. Without this the section could pass by
     having broken refreshing outright. */
  await vm.runInContext(`refreshFalGeneration("job-1", false)`, context);
  await settle();
  assert.deepStrictEqual(marks(context), ["completion-1"], "a refresh taken after the discard commits normally");
  assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A), "and leaves the window level with the server");
  console.log("  R0/R1 prepared-snapshot-freshness - a snapshot read before this window's own accepted write is discarded, the record stays at R1, and refreshing still works");
}

/* The control that makes the section above a claim about the ACCEPTED WRITE
   rather than about parking a read: the same park, with no save inside it,
   commits normally. */
async function parkedRefreshWithoutSaveSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");

  server.holdNextScanRead();
  vm.runInContext(`__refresh = load({ intent: "refresh" }).then((result) => JSON.stringify(result));`, context);
  await settle();
  assert.strictEqual(server.parkedScanReads, 1, "precondition: parked at exactly the same point");
  server.releaseScanReads();
  const outcome = JSON.parse(await read(context, "__refresh"));
  await settle();

  assert.strictEqual(outcome.committed, true, "with no write inside it, the same parked refresh commits");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
    "and a refresh commit is not a save, so the generation does not move");
  assert.strictEqual(read(context, "PROJECT_REFRESH_COMMITTED") > 0, true, "it takes its place in the refresh order instead");
  console.log("  parked-refresh-without-save - the same park with no accepted write inside it commits, so the freshness rule is about the write");
}

/* E8. AND THE FRESHNESS TOKEN IS NOT THE REVISION. Two overlapping refreshes
   both commit even though the first moves PROJECT_REVISION out from under the
   second's ticket — which is why the token is a save generation and not the
   revision string. A NORMAL REFRESH COMMIT MUST NOT ADVANCE THE GENERATION. */
async function refreshCommitDoesNotBreakFreshnessSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
  const revisionAtOpen = read(context, "PROJECT_REVISION");

  /* Three snapshots that genuinely differ, produced WITHOUT any browser-declared
     advance — the server's own ingest reaper moving the document under all of
     them, which is the one kind of advance the browser cannot know about. */
  server.serverSideIngest();
  const r1 = await beginParkedRefresh(server, context, "__r1", "", "generic");
  server.serverSideIngest();
  const r2 = await beginParkedRefresh(server, context, "__r2", "", "generic");

  await releaseAndSettle(server, context, r1, "__r1");
  assert.notStrictEqual(read(context, "PROJECT_REVISION"), revisionAtOpen,
    "precondition: R1's commit moved the revision out from under R2's ticket");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
    "E8: a refresh COMMIT must not advance the save generation — it is not a durable write, it is a read being installed");

  await releaseAndSettle(server, context, r2, "__r2");
  assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A),
    "R2 must still commit: a revision moved by a refresh commit is not evidence that R2's snapshot is behind");
  assert.deepStrictEqual(marks(context), ["completion-1", "completion-2"], "with the newest snapshot on screen");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
    "and two refresh commits still leave the generation exactly where the open left it");
  console.log("  E8 freshness-token-is-not-the-revision - a refresh commit moves the revision and never the generation, so overlapping refreshes still both commit");
}

/* ===========================================================================
   AN EXTERNAL DURABLE ADVANCE OF THE OPEN PROJECT.

   The freshness generation caught this window's OWN accepted write. A completion
   ingest is the same fact arriving from the other direction: the browser asks the
   SERVER to take delivery of a finished generation, and the server commits the
   results into the open project's document. The stored revision moves and this
   window wrote nothing, so a snapshot prepared before the ingest is behind the
   record in exactly the way an accepted save makes one behind.

   The order is the whole mechanism: ingest, then declare, then refresh. The
   completion's own follow-up refresh captures the NEW generation and commits
   normally; every snapshot prepared before the ingest is stale — INCLUDING when
   that follow-up fails, which is the case where nothing else would catch it. */

/* Drive one completion with an old, scan-parked refresh already holding a
   pre-ingest snapshot, and report what each of them did. */
async function completionOverOldSnapshot({ entry, failFollowUp, options }) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");

  await beginScanParkedRefresh(server, context, "__old");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "precondition: nothing installed by the parked refresh");

  if (failFollowUp) server.failNextProjectRead();
  await vm.runInContext(entry === "automation"
    ? `v626RefreshFalJob("job-1")`
    : `refreshFalGeneration("job-1", false)`, context).catch(() => {});
  await settle();

  const R1 = server.revisionOf(A);
  const afterCompletion = workspaceState(context);
  const oldOutcome = await releaseScanParked(server, context, "__old");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  return { server, context, R0, R1, generationAtOpen, afterCompletion, oldOutcome };
}

/* When the follow-up refresh SUCCEEDS, two independent rules would each refuse
   the old snapshot — it is behind the ingest, and a newer refresh has already
   installed. Either reason is a correct refusal there. When the follow-up FAILS
   there is no newer commit and the window is clean, so freshness is the only rule
   that can catch it: that case demands the freshness reason by name, which is
   what makes it the proof rather than a coincidence. */
function assertOldSnapshotRefused(oldOutcome, R0, { requireFreshness = false } = {}) {
  assert.strictEqual(oldOutcome.committed, false,
    "THE BLOCKER: a snapshot prepared before the ingest must be discarded, not installed");
  if (requireFreshness) {
    assert(/saved to storage while this refresh was in flight/.test(oldOutcome.reason),
      `nothing else could have caught this, so it must be the freshness rule: ${JSON.stringify(oldOutcome.reason)}`);
    assert(oldOutcome.reason.includes(R0), `naming the revision it read: ${JSON.stringify(oldOutcome.reason)}`);
    return;
  }
  assert(/saved to storage while this refresh was in flight|newer refresh of this open has already installed/.test(oldOutcome.reason),
    `and discarded for being behind the record: ${JSON.stringify(oldOutcome.reason)}`);
}

/* E1 / E3 — the completion's own follow-up refresh SUCCEEDS. */
async function completionAdvancesFreshnessSection(options = {}) {
  for (const entry of ["fal", "automation"]) {
    const label = entry === "fal" ? "E1" : "E3";
    const { server, context, R0, R1, generationAtOpen, oldOutcome } =
      await completionOverOldSnapshot({ entry, failFollowUp: false, options });

    assert.notStrictEqual(R1, R0, `${label}: the ingest must have moved the stored revision, or this section is vacuous`);
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
      `${label}: exactly one durable advance for one ingest`);
    assert.strictEqual(read(context, "PROJECT_REVISION"), R1,
      `${label}: the completion's own follow-up refresh captured the new generation and committed`);
    assert.deepStrictEqual(marks(context), ["completion-1"], `${label}: with the results on screen`);
    assertOldSnapshotRefused(oldOutcome, R0);
    assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A),
      `${label}: and the window ends level with the server`);
    assert.strictEqual(saveIndicator(context), "Saved", `${label}: truthfully`);
  }
  console.log("  E1/E3 completion-advances-freshness - one ingest is one durable advance; the completion's own refresh commits and the pre-ingest snapshot cannot");
}

/* E2 / E4 — the completion's own follow-up refresh FAILS. This is the case the
   generation exists for: nothing else in VALIDATE can tell that the record moved. */
async function completionFollowUpFailsSection(options = {}) {
  for (const entry of ["fal", "automation"]) {
    const label = entry === "fal" ? "E2" : "E4";
    const { server, context, R0, R1, generationAtOpen, oldOutcome } =
      await completionOverOldSnapshot({ entry, failFollowUp: true, options });

    assert.notStrictEqual(R1, R0, `${label}: the ingest must still have moved the stored revision`);
    assertOldSnapshotRefused(oldOutcome, R0, { requireFreshness: true });
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
      `${label}: and the mechanism is the ingest's own declaration — the generation advanced even though the refresh behind it failed`);

    /* The window may be temporarily pre-completion. What it must never be is
       falsely replaced by the stale snapshot it was holding. */
    assert.strictEqual(read(context, "PROJECT_REVISION"), R0,
      `${label}: the window stays where it was rather than adopting a snapshot it cannot trust`);
    assert.deepStrictEqual(marks(context), [],
      `${label}: the completion has not arrived here yet, which is honest`);
    assert.strictEqual(server.docs[A].meta.completionMarks.length, 1,
      `${label}: while the server holds it`);
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, `${label}: with no conflict manufactured`);

    /* AND RECOVERY IS TRUTHFUL. The next refresh captures the current generation
       and collects what the failed one could not. */
    await vm.runInContext(`load({ intent: "refresh" })`, context);
    await settle();
    assert.deepStrictEqual(marks(context), ["completion-1"], `${label}: a later refresh collects the results`);
    assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A),
      `${label}: and leaves the window level with the server`);
  }
  console.log("  E2/E4 completion-follow-up-fails - a failed follow-up still leaves the pre-ingest snapshot stale, the window honest, and the next refresh able to recover");
}

/* E5 — a completion for project A that lands after an explicit switch to B. */
async function completionForLeftProjectSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  /* The refresh ROUTE is parked, so the ingest has happened on the server and the
     browser has not yet learned of it — which is where a switch can land. */
  server.holdNextJobRefresh();
  vm.runInContext(`__completion = refreshFalGeneration("job-1", false);`, context);
  await settle();
  assert.strictEqual(server.parkedJobRefreshes, 1, "precondition: A's completion is parked on the wire");

  await context.switchProject(B);
  const afterSwitch = clientState(context);
  const identityAfterSwitch = projectIdentity(context);
  assert.strictEqual(identityAfterSwitch.slug, B, "precondition: the switch completed");

  server.releaseJobRefreshes();
  await read(context, "__completion");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), afterSwitch.saveGeneration,
    "THE BLOCKER: a completion for a project this window has LEFT must not perturb the new project's freshness");
  assert.deepStrictEqual(clientState(context), afterSwitch,
    "and must not change anything else about B either");
  assert.deepStrictEqual(projectIdentity(context), identityAfterSwitch, "B's identity and record are untouched");
  assert.strictEqual(server.active, B, "and client and server still agree");

  /* B still refreshes normally afterwards, so the guard is a scope and not a stop. */
  await vm.runInContext(`load({ intent: "refresh" })`, context);
  await settle();
  assert.strictEqual(read(context, "P.meta.title"), "Project B", "B's own refresh still commits");
  console.log("  E5 completion-for-left-project - an ingest for a project the window has left advances nothing here, and the new project still refreshes");
}

/* E6 — two completions overlapping. Each durable advance is accounted for, and
   the sequence/watermark ordering is unchanged: no double-count assumption is
   needed, because the generation is compared for equality and never counted. */
async function overlappingCompletionIngestsSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");

  const r1 = await beginParkedRefresh(server, context, "__r1", "job-1");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
    "precondition: the first ingest declared one advance");
  const r2 = await beginParkedRefresh(server, context, "__r2", "job-2");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 2,
    "precondition: and the second, one more — each ingest accounted for exactly once");
  assert.strictEqual(server.completions, 2, "precondition: two distinct snapshots");

  /* Older first. Its snapshot predates the second ingest, so it is behind the
     record and declines; the newer one installs. The client converges on the
     newest either way, which is the ordering rule's whole purpose. */
  await releaseAndSettle(server, context, r1, "__r1");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-0"',
    "the older completion's refresh is behind the second ingest and does not install");
  await releaseAndSettle(server, context, r2, "__r2");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-2"',
    "and the newer one commits the snapshot that carries both completions");
  assert.deepStrictEqual(marks(context), ["completion-1", "completion-2"], "with every completion present");
  assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A), "level with the server");
  assert.strictEqual(read(context, "PROJECT_REFRESH_COMMITTED") > 0, true, "and the refresh order recorded normally");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), 1, "with the open's epoch untouched throughout");
  console.log("  E6 overlapping-completion-ingests - each ingest is accounted for once, and the window still converges on the newest snapshot");
}

/* ===========================================================================
   A ROUTE THAT WRITES THE PROJECT ONLY SOMETIMES.

   Cancel, a failed submission and a failed collection all set an entity's
   coverage-automation status — and only when the job is an entity-reference job
   whose entity has coverage automation configured. The browser cannot see that
   condition. Guessing YES from a 2xx discards a perfectly good prepared refresh
   on every cancel; guessing NO lets a prepared snapshot reinstall the pre-cancel
   status. The route answers `projectUpdated` and one handler reads it. */

async function cancelFixture(options = {}, writes) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  server.setCancelWritesProject(writes);
  return { server, context };
}
/* The automation button reaches the same route through a run record. The run is
   stubbed rather than built, because what is under test is the RESULT HANDLING
   the two callers share, not the automation run store. */
function stubAutomationProviderJob(context) {
  vm.runInContext(`v626RefreshRun = async () => ({ id: "run-1", current: { stepKey: "generate" }, steps: { generate: { key: "generate", childJobId: "job-1" } } });`, context);
}

async function cancelWithoutProjectWriteSection(options = {}) {
  for (const entry of ["fal", "automation"]) {
    const label = entry === "fal" ? "C1" : "C3";
    const { server, context } = await cancelFixture(options, false);
    const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
    await beginScanParkedRefresh(server, context, "__parked");

    if (entry === "automation") stubAutomationProviderJob(context);
    await vm.runInContext(entry === "automation" ? `cancelAutomationProviderJob("run-1")` : `cancelFalGeneration("job-1")`, context);
    await settle();

    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
      `${label}: a cancel that wrote no project document must not declare a durable advance`);
    const outcome = await releaseScanParked(server, context, "__parked");
    assert.strictEqual(outcome.committed, true,
      `${label}: and a valid prepared refresh must remain valid — the job ledger changing is not the project changing`);
    assert.deepStrictEqual(server.writes, [], `${label}: with nothing written by any of it`);
  }
  console.log("  C1/C3 cancel-without-project-write - projectUpdated:false declares nothing, and a parked current-project refresh is still valid");
}

async function cancelWithProjectWriteSection(options = {}) {
  for (const entry of ["fal", "automation"]) {
    const label = entry === "fal" ? "C2" : "C4";
    const { server, context } = await cancelFixture(options, true);
    const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
    const R0 = server.revisionOf(A);
    await beginScanParkedRefresh(server, context, "__parked");

    if (entry === "automation") stubAutomationProviderJob(context);
    await vm.runInContext(entry === "automation" ? `cancelAutomationProviderJob("run-1")` : `cancelFalGeneration("job-1")`, context);
    await settle();

    assert.notStrictEqual(server.revisionOf(A), R0, `${label}: the cancel must actually have written the project`);
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
      `${label}: declared exactly once`);
    assert.strictEqual(read(context, "P.meta.coverageStatus"), "cancelled",
      `${label}: and the follow-up refresh installed the cancelled coverage status`);
    assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A), `${label}: level with the server`);

    const outcome = await releaseScanParked(server, context, "__parked");
    assert.strictEqual(outcome.committed, false,
      `${label}: THE BLOCKER: the snapshot prepared before the cancel must not reinstall the pre-cancel status`);
    assert.strictEqual(read(context, "P.meta.coverageStatus"), "cancelled", `${label}: which it did not`);
  }
  console.log("  C2/C4 cancel-with-project-write - projectUpdated:true declares once, refreshes, and the pre-cancel snapshot cannot reinstall the old status");
}

/* C5 — a cancel issued for A that lands after an explicit switch to B. */
async function cancelForLeftProjectSection(options = {}) {
  const { server, context } = await cancelFixture(options, true);
  server.holdNextCancel();
  vm.runInContext(`__cancel = cancelFalGeneration("job-1");`, context);
  await settle();
  assert.strictEqual(server.parkedCancels, 1, "precondition: A's cancel is parked on the wire");

  await context.switchProject(B);
  const afterSwitch = clientState(context);
  const identityAfterSwitch = projectIdentity(context);
  assert.strictEqual(identityAfterSwitch.slug, B, "precondition: the switch completed");

  server.releaseCancels();
  await read(context, "__cancel");
  await settle();

  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), afterSwitch.saveGeneration,
    "THE BLOCKER: the captured owner is A, so B's freshness is untouched by A's cancel");
  assert.deepStrictEqual(clientState(context), afterSwitch, "and nothing else about B moved either");
  assert.deepStrictEqual(projectIdentity(context), identityAfterSwitch, "B's identity and record are untouched");
  console.log("  C5 cancel-for-left-project - the owner captured before the request keeps A's cancel out of B's freshness");
}

/* Q1 — RECONCILE WRITES NO PROJECT DOCUMENT, so it must declare nothing. */
async function reconcileDeclaresNothingSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  /* Client and server already level at a durable R1. */
  server.serverSideIngest(A);
  await vm.runInContext(`load({ intent: "refresh" })`, context);
  await settle();
  const R1 = server.revisionOf(A);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "precondition: client and server are level at R1");
  const generationAtR1 = read(context, "PROJECT_SAVE_GENERATION");

  await beginScanParkedRefresh(server, context, "__parked");
  await vm.runInContext(`reconcileFalGeneration("job-1", "not-accepted")`, context);
  await settle();

  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtR1,
    "THE BLOCKER: reconcile records an outcome on the job row and never touches project.json, so it must declare no durable advance");
  assert.strictEqual(server.revisionOf(A), R1, "and the stored revision is unmoved, which is why");
  const outcome = await releaseScanParked(server, context, "__parked");
  assert.strictEqual(outcome.committed, true,
    "so a refresh reading the CURRENT record stays valid and installs it");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "leaving the window level with the server");
  console.log("  Q1 reconcile-declares-nothing - a route that writes only the job ledger invalidates no refresh");
}

/* The workspace migration's owner, captured before the request. */
async function workspaceMigrationOwnerSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  let releaseSettings = () => {};
  const parked = new Promise((resolve) => { releaseSettings = resolve; });
  const context = await openFixture(server, currentSchemaProject("Project A"), {
    ...options,
    fetch: async (url, requestOptions, response) => {
      if (url === "/api/workspace/settings" && requestOptions.method === "POST") {
        await parked;
        return response({ ok: true, migration: { movedRoot: true, copied: 1, skipped: 0 } });
      }
      return server.fetch(url, requestOptions, response);
    },
  });
  vm.runInContext(`__settings = persistWorkspaceSettings("storage");`, context);
  await settle();

  await context.switchProject(B);
  const afterSwitch = clientState(context);
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), B, "precondition: the switch completed while the request was in flight");

  releaseSettings();
  await read(context, "__settings").catch(() => {});
  await settle();

  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), afterSwitch.saveGeneration,
    "a migration started under A must not declare a durable advance against B");
  assert.deepStrictEqual(clientState(context), afterSwitch, "and must not perturb B in any other way");
  console.log("  migration-owner - the workspace migration declares against the owner captured before its request, not the live slug");
}

/* ===========================================================================
   THE UNIVERSAL REVISION WATCH.

   Everything above this point taught the browser about one writer at a time — an
   accepted save, a completion ingest, a cancel, a restore, a migration, the ingest
   reaper. That list only ever grows, and the writer it has not been taught about
   is the one that leaves a window resting on "Saved" over a record the server has
   moved past. The reaper watch was the worst of them: it depended on THIS window
   having seen the job the sweep collected, so a generation started anywhere else
   was invisible to it by construction.

   The server's current revision answers all of them at once. It is a hash of the
   stored bytes, so whatever changed the file changed the revision, and comparing
   it needs no knowledge of who wrote or why. The sections below prove the CLASS —
   an unknown writer, an unknown job — rather than another table of known ones. */

/* One tick of the watch, and everything it starts. */
async function tickRevisionWatch(context) {
  await vm.runInContext(`watchProjectRevision()`, context);
  await settle();
}
/* The state a window must not silently sit in: behind the record, and saying
   Saved about it. */
function currentAgainstServer(context, server, slug = A) {
  return {
    clientRevision: read(context, "PROJECT_REVISION"),
    serverRevision: server.revisionOf(slug),
    indicator: saveIndicator(context),
  };
}

/* V3-1 — A WRITER THIS WINDOW HAS NEVER HEARD OF. No generation, no job, no
   local operation: another window simply wrote the project. */
async function unknownWriterConvergenceSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "precondition: the window is current at R0");
  assert.strictEqual(saveIndicator(context), "Saved", "and says so truthfully");

  const R1 = server.foreignWrite(A, "changed by a window this one has never heard of");
  assert.notStrictEqual(R1, R0, "precondition: the stored revision moved");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
    "precondition: and nothing in this window could possibly know — no request was made here");
  assert.deepStrictEqual(read(context, "JSON.stringify(FAL_GENERATION_JOBS)"), "[]",
    "precondition: with no generation job anywhere in this window, so nothing writer-specific can be doing the work");

  await tickRevisionWatch(context);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1,
    "THE INVARIANT: one watch interval is enough to notice and converge, with no user action and no knowledge of the writer");
  assert.strictEqual(read(context, "P.meta.title"), "changed by a window this one has never heard of",
    "installing the record the other window wrote");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
    "declared exactly once, through the same helper every other writer uses");
  assert.strictEqual(saveIndicator(context), "Saved", "and Saved is true again only now");
  const state = currentAgainstServer(context, server);
  assert.strictEqual(state.clientRevision, state.serverRevision, "client and server agree");
  console.log("  V3-1 unknown-writer-convergence - a change made by a writer this window has never heard of is detected and converged within one watch interval");
}

/* V3-2 — THE PRIOR HOLD, EXACTLY. An empty ledger, a job created elsewhere, the
   reaper ingesting it. The window is told by the revision, not by the job. */
async function unknownReaperJobSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), { ...options, fal: true });
  const R0 = server.revisionOf(A);
  assert.strictEqual(read(context, "FAL_GENERATION_LEDGER_LOADED"), true, "precondition: the ledger loaded");
  assert.deepStrictEqual(read(context, "JSON.stringify(FAL_GENERATION_JOBS)"), "[]",
    "precondition: AND IT IS EMPTY — this window has never seen the job the sweep is about to collect");

  /* A refresh prepared before the sweep, parked. */
  await beginScanParkedRefresh(server, context, "__old");
  /* The reaper collects a job created in another window and ingests it. */
  server.serverSideIngest(A);
  const R1 = server.revisionOf(A);

  /* The old snapshot lands first and commits, because nothing has told this
     window otherwise yet. That transient wrongness is allowed; staying wrong is
     not. */
  const oldOutcome = await releaseScanParked(server, context, "__old");
  assert.strictEqual(oldOutcome.committed, true, "precondition: the pre-sweep snapshot is indistinguishable from a fresh one and commits");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "so the window is briefly behind");
  assert.deepStrictEqual(marks(context), [], "without the collected result");

  await tickRevisionWatch(context);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1,
    "THE BLOCKER: the watch converges on the sweep's record with no dependency on this window having seen the job");
  assert.deepStrictEqual(marks(context), ["completion-1"], "collecting the result");
  assert.strictEqual(saveIndicator(context), "Saved", "and only now is Saved true");
  console.log("  V3-2 unknown-reaper-job - a sweep of a job this window never saw is caught by the revision, not by the ledger");
}

/* V3-3 — the mismatch is noticed BEFORE the stale snapshot is released. */
async function staleSnapshotAfterWatchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  await beginScanParkedRefresh(server, context, "__old");
  const R1 = server.foreignWrite(A, "written while a refresh was in flight");

  await tickRevisionWatch(context);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "precondition: the watch converged on R1");

  const oldOutcome = await releaseScanParked(server, context, "__old");
  assert.strictEqual(oldOutcome.committed, false,
    "THE INVARIANT: the R0 snapshot must fail freshness validation, because the watch declared the advance");
  assert(/saved to storage while this refresh was in flight|newer refresh of this open has already installed/.test(oldOutcome.reason),
    `and for a freshness reason: ${JSON.stringify(oldOutcome.reason)}`);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "the window stays on the current record");
  assert.notStrictEqual(R1, R0, "which is not the one the snapshot held");
  console.log("  V3-3 stale-snapshot-after-watch - a declaration from the watch invalidates an already-prepared snapshot generically");
}

/* V3-4 — the stale snapshot commits FIRST, and the watch corrects it. */
async function staleCommitThenWatchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  await beginScanParkedRefresh(server, context, "__old");
  const R1 = server.foreignWrite(A, "written while a refresh was in flight");

  const oldOutcome = await releaseScanParked(server, context, "__old");
  assert.strictEqual(oldOutcome.committed, true, "precondition: it commits, because nothing has told this window otherwise");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "leaving the window at R0 while the server is at R1");
  assert.strictEqual(saveIndicator(context), "Saved", "and briefly saying Saved about it");

  await tickRevisionWatch(context);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1,
    "THE INVARIANT: a false R0/Saved is not STABLE — the next tick converges it with no user action");
  assert.strictEqual(read(context, "P.meta.title"), "written while a refresh was in flight", "installing the current record");
  assert.strictEqual(saveIndicator(context), "Saved", "and Saved is true again");
  console.log("  V3-4 stale-commit-then-watch - a stale commit is transient, never stable: the next tick converges it");
}

/* V3-5 — authored work is never overwritten. */
async function dirtyWindowMismatchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  vm.runInContext(`P.meta.title = "authored, and unsaved"; dirty();`, context);
  const generationBefore = read(context, "PROJECT_SAVE_GENERATION");
  await beginScanParkedRefresh(server, context, "__old");
  const R1 = server.foreignWrite(A, "written by somebody else while this window was mid-edit");

  await tickRevisionWatch(context);
  assert.strictEqual(read(context, "P.meta.title"), "authored, and unsaved",
    "THE BLOCKER: the authored edit is preserved exactly — the server snapshot is not installed over it");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "and nothing was installed");
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), true,
    "the existing conflict surface says the project changed while this view was open");
  assert.notStrictEqual(saveIndicator(context), "Saved", "and nothing claims to be saved");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationBefore + 1,
    "with the advance still declared, so prepared snapshots are invalidated either way");

  const oldOutcome = await releaseScanParked(server, context, "__old");
  assert.strictEqual(oldOutcome.committed, false, "which the parked R0 snapshot then fails");
  assert.strictEqual(read(context, "P.meta.title"), "authored, and unsaved", "leaving the edit exactly where it was");
  assert.strictEqual(server.revisionOf(A), R1, "and the server unmoved");
  console.log("  V3-5 dirty-window-mismatch - authored work survives, the conflict surface is truthful, and prepared snapshots are still invalidated");
}

/* V3-5b — a window that has ALREADY stopped saving keeps what it is saying. */
async function blockedWindowMismatchSection(options = {}) {
  const server = refreshServer({
    a: currentSchemaProject("Project A"),
    b: currentSchemaProject("Project B"),
    replyForWrite: () => ({ status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["shots[0].dur must be a positive number"] } }),
  });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  await vm.runInContext(`(async () => { P.meta.title = "refused, and still mine"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "precondition: the typed 422 paused saving");
  const blocked = clientState(context);

  server.foreignWrite(A, "written by somebody else while this window was paused");
  await tickRevisionWatch(context);

  assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "the pause survives — it is the truest thing this window can say");
  assert.strictEqual(saveIndicator(context), blocked.indicator, "and its surface is not replaced by a second one");
  assert.strictEqual(read(context, "P.meta.title"), "refused, and still mine", "with the refused edit still in this tab");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), blocked.saveGeneration + 1,
    "while the advance is still declared, so nothing prepared before it can commit");
  console.log("  V3-5b blocked-window-mismatch - a window already refusing keeps its own surface, and the advance is still declared");
}

/* V3-6 — this window's own save is not a foreign change. */
async function saveInFlightWatchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const R0 = server.revisionOf(A);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");

  server.holdWrites();
  vm.runInContext(`P.meta.title = "saved by this very window"; dirty(); __save = flushPendingProjectSave();`, context);
  await settle();
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "precondition: this window's own save is in flight");

  /* The watch fires while the write is parked. It must wait rather than race. */
  vm.runInContext(`__watch = watchProjectRevision();`, context);
  await settle();
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), false,
    "a watch that fired mid-save must not manufacture a conflict out of this window's own write");

  server.releaseWrites();
  await read(context, "__save");
  await read(context, "__watch");
  await settle();

  const R1 = server.revisionOf(A);
  assert.notStrictEqual(R1, R0, "the accepted save moved the stored revision");
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "and this window's with it");
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), false, "nothing is unsaved");
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "and no conflict was invented");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
    "exactly one advance — the save's own, not a second one from the watch");

  /* AND THE NEXT COMPARISON NATURALLY AGREES. */
  const before = clientState(context);
  await tickRevisionWatch(context);
  assert.deepStrictEqual(clientState(context), before, "the next tick finds the two in agreement and does nothing");
  assert.strictEqual(saveIndicator(context), "Saved", "resting truthfully");
  console.log("  V3-6 save-in-flight - the watch waits for this window's own save rather than racing it into a conflict");
}

/* V3-7 — the revision could not be read. */
async function revisionReadFailureSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  vm.runInContext(`P.meta.title = "authored, and unsaved"; dirty();`, context);
  const before = workspaceState(context);
  const toastBefore = read(context, 'document.getElementById("toast").textContent');

  server.failNextRevisionRead();
  await tickRevisionWatch(context);
  assert.deepStrictEqual(workspaceState(context), before,
    "a revision that could not be read is not evidence of anything and must change nothing");
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "no conflict is invented out of a failed read");
  assert.strictEqual(read(context, 'document.getElementById("toast").textContent'), toastBefore, "and nothing is announced");

  /* A later tick simply asks again. */
  const R1 = server.foreignWrite(A, "written after the failed read");
  vm.runInContext(`clearTimeout(saveTimer); saveTimer = null; SAVE_REVISION = 0; SAVED_REVISION = 0; P.meta.title = "Project A";`, context);
  await tickRevisionWatch(context);
  assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "the next interval retries and converges normally");
  console.log("  V3-7 revision-read-failure - a failed revision read destroys nothing, invents no conflict, and simply asks again");
}

/* V3-8 — nothing changed. The watch must be silent. */
async function noChangeWatchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const before = clientState(context);
  const requestsBefore = server.requests.length;

  for (let tick = 0; tick < 3; tick += 1) await tickRevisionWatch(context);

  assert.deepStrictEqual(clientState(context), before,
    "three ticks against an unchanged server must move nothing — not the revision, not the generation, not the indicator");
  /* AND THE COST IS THREE CHEAP READS AND NOTHING ELSE. Not the project document,
     not the ledger, not the scan: an agreeing revision is the whole answer. */
  assert.deepStrictEqual(server.requests.slice(requestsBefore),
    Array.from({ length: 3 }, () => `GET /api/projects/${A}/revision`),
    `an agreeing revision must cost one revision read per tick and nothing else: ${JSON.stringify(server.requests.slice(requestsBefore))}`);
  assert.strictEqual(saveIndicator(context), "Saved", "with no indicator churn");
  console.log("  V3-8 no-change - an agreeing revision costs one cheap read and moves nothing");
}

/* V3-9 — a revision answer that outlived its open. */
async function revisionWatchAcrossSwitchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  server.foreignWrite(A, "A moved while this window was asking about it");

  server.holdNextRevisionRead();
  vm.runInContext(`__watch = watchProjectRevision();`, context);
  await settle();
  assert.strictEqual(server.parkedRevisionReads, 1, "precondition: A's revision read is parked on the wire");

  await context.switchProject(B);
  const afterSwitch = clientState(context);
  const identityAfterSwitch = projectIdentity(context);
  assert.strictEqual(identityAfterSwitch.slug, B, "precondition: the switch completed");

  server.releaseRevisionReads();
  await read(context, "__watch");
  await settle();

  assert.deepStrictEqual(clientState(context), afterSwitch,
    "THE BLOCKER: a revision answer begun under A must not touch B's freshness, record or indicator");
  assert.deepStrictEqual(projectIdentity(context), identityAfterSwitch, "B's identity is untouched");
  assert.strictEqual(read(context, "P.meta.title"), "Project B", "and B's record is still B's");
  console.log("  V3-9 revision-watch-across-switch - the answer is bound to the open that asked, and a late one is dropped");
}

/* V3-10 — the automation refresh answers 502 AFTER committing the project. */
async function automationRefreshFailureWritesSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
  await beginScanParkedRefresh(server, context, "__old");

  server.setRefreshFailsAfterWrite(true);
  const thrown = await vm.runInContext(
    `v626RefreshFalJob("job-1").then(() => "", (error) => String(error && error.message || ""))`, context);
  await settle();

  assert(thrown && /did not answer/.test(thrown),
    `THE FAILURE IS STILL SURFACED, truthfully: ${JSON.stringify(thrown)}`);
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen + 1,
    "THE BLOCKER: the payload said projectUpdated, so the mutation is processed BEFORE the failure is thrown");
  assert.deepStrictEqual(marks(context), ["completion-1"],
    "and the follow-up refresh installed what the route committed");

  const oldOutcome = await releaseScanParked(server, context, "__old");
  assert.strictEqual(oldOutcome.committed, false, "so the snapshot prepared before it is invalid");
  console.log("  V3-10 automation-502-writes - a failed request and a durable mutation are two truths, and the payload is read before the throw");
}

/* THE HELPER IS THE ONLY WAY IN, and it does nothing else. */
function durableAdvanceIsSharedSection() {
  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8").replace(/\r\n/g, "\n");
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bodyOf = (signature) => {
    const at = appSource.indexOf(signature);
    assert(at > 0, `${signature} must exist`);
    return appSource.slice(at, appSource.indexOf("\n}", at));
  };
  const start = appSource.indexOf("function noteCurrentProjectDurableAdvance(owner)");
  assert(start > 0, "the shared durable-advance helper must exist");
  const body = appSource.slice(start, appSource.indexOf("\n}", start));
  assert(/slug !== ACTIVE_PROJECT_SLUG\) return false;/.test(body),
    "it must refuse a mutation that belongs to a project this window no longer owns");
  assert(/PROJECT_SAVE_GENERATION \+= 1;/.test(body), "and advance the generation when it does");
  for (const [token, what] of [["P =", "the record"], ["PROJECT_REVISION", "the revision"], ["SAVED_PROJECT_BASELINE", "the saved baseline"], ["setSaveState", "the indicator"], ["SAVE_REVISION", "the counters"], ["SAVE_BLOCKED", "the latches"], ["PROJECT_OPEN_EPOCH", "the epoch"], ["PROJECT_REFRESH_COMMITTED", "the watermark"], ["dirty(", "the dirty path"]]) {
    assert(!body.includes(token), `and must touch nothing else — it names ${what}`);
  }
  /* NOBODY OUTSIDE app.js WRITES THE GENERATION DIRECTLY. One invariant, one
     expression of it; a second copy in another file is a second rule to drift. */
  for (const file of fs.readdirSync(path.join(ROOT, "public")).filter((n) => n.endsWith(".js") && n !== "app.js")) {
    const source = fs.readFileSync(path.join(ROOT, "public", file), "utf8");
    assert(!/PROJECT_SAVE_GENERATION\s*(\+=|=[^=])/.test(source),
      `${file} must declare a durable advance through noteCurrentProjectDurableAdvance(), not by writing the generation itself`);
  }
  /* ONE RESULT HANDLER FOR THE ROUTES THAT SAY WHETHER THEY WROTE. Both cancel
     callers read the same flag through the same function; neither carries its own
     opinion about what a 2xx meant. */
  for (const [file, caller] of [["fal-generation.js", "cancelFalGeneration"], ["automation.js", "cancelAutomationProviderJob"]]) {
    const source = fs.readFileSync(path.join(ROOT, "public", file), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf(`window.${caller} = async`);
    assert(start > 0, `${caller} must exist`);
    const body = source.slice(start, source.indexOf("\n};", start));
    assert(body.includes("applyProjectMutationResult("),
      `${caller} must read the route's own answer through the shared handler`);
    assert(body.includes("const owner = ACTIVE_PROJECT_SLUG;"),
      `${caller} must capture the owning project before the request goes out`);
    assert(!body.includes("noteCurrentProjectDurableAdvance("),
      `${caller} must not declare directly — that is a second opinion about the same route`);
  }
  const handler = stripComments(bodyOf("async function applyProjectMutationResult(owner, data)"));
  assert(/data\.projectUpdated !== true\) return false;/.test(handler),
    "the handler must act only on the route's explicit projectUpdated, never on the HTTP status");

  /* AND RECONCILE DECLARES NOTHING, because it writes no project document. */
  const falBrowser = fs.readFileSync(path.join(ROOT, "public", "fal-generation.js"), "utf8").replace(/\r\n/g, "\n");
  const reconcileStart = falBrowser.indexOf("window.reconcileFalGeneration = async");
  assert(reconcileStart > 0, "reconcileFalGeneration must exist");
  const reconcileBody = falBrowser.slice(reconcileStart, falBrowser.indexOf("\n};", reconcileStart));
  for (const forbidden of ["noteCurrentProjectDurableAdvance", "applyProjectMutationResult"]) {
    assert(!reconcileBody.includes(forbidden),
      `reconcile writes only the job ledger and must declare no durable advance; it names ${forbidden}`);
  }

  /* THE REVISION READ IS READ-ONLY, AND CHEAP. It exists so a live window can ask
     every few seconds; a route that parsed the document, recorded activity or took
     a backup would be a page-load's worth of work and a mutation on a timer. */
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/\r\n/g, "\n");
  const routeAt = serverSource.indexOf('app.get("/api/projects/:slug/revision"');
  assert(routeAt > 0, "the lightweight revision route must exist");
  const routeBody = stripComments(serverSource.slice(routeAt, serverSource.indexOf("\n});", routeAt)));
  for (const forbidden of ["writeProject", "persistProjectSuccessor", "noteProjectActivity", "createProjectBackup", "inspectProjectFile", "normalizePromptBuildHistory", "JSON.parse", "readJsonSync"]) {
    assert(!routeBody.includes(forbidden),
      `the revision route must read bytes and hash them and nothing else; it names ${forbidden}`);
  }
  assert(routeBody.includes("projectRevisionFor(file)"), "answering from the stored bytes");

  /* AND THE WATCH RIDES THE TIMER THE APPLICATION ALREADY RUNS. */
  const activitySource = fs.readFileSync(path.join(ROOT, "public", "live-activity.js"), "utf8").replace(/\r\n/g, "\n");
  assert(/V641_ACTIVITY_TIMER = setInterval\(\(\) => \{[\s\S]{0,400}watchProjectRevision\(\);/.test(activitySource),
    "the universal revision watch must ride the existing activity interval rather than starting a second one");
  assert((activitySource.match(/setInterval\(/g) || []).length === 1,
    "and there must still be exactly one interval in this file");
  /* THE WATCH DEPENDS ON NOTHING WRITER-SPECIFIC. This is what makes it able to
     see a change made by a window it has never heard of. */
  const watch = stripComments(bodyOf("window.watchProjectRevision = async () =>"));
  for (const forbidden of ["FAL_GENERATION_JOBS", "FAL_GENERATION_LEDGER_LOADED", "V641_ACTIVITY_DRAWER_OPEN", "AUTOMATION_RUNS", "backgroundRecovery", "falJobActive"]) {
    assert(!watch.includes(forbidden),
      `the revision watch must not depend on ${forbidden} — a writer-specific dependency is what made the previous watch blind cross-window`);
  }
  assert(watch.includes("/revision"), "it asks the lightweight revision route");
  assert(watch.includes("await SAVE_CHAIN"), "and lets this window's own save settle before asking");
  assert(/serverRevision === PROJECT_REVISION\) return null;/.test(watch),
    "comparing for exact equality");
  assert(!/serverRevision\s*[<>]/.test(watch), "and never for order");
  /* The reaper-specific watch is gone from both files. */
  for (const gone of ["noteBackgroundRecoveryAdvance", "backgroundRecoveryKey", "BACKGROUND_RECOVERY_DECLARED", "v670RecoveryWatchEnabled", "V670_RECOVERY_COLLECTABLE", "v670RecoveryCollectable"]) {
    assert(!appSource.includes(gone) && !activitySource.includes(gone),
      `${gone} was the writer-specific recovery watch and the universal one replaces it`);
  }

  /* And both completion paths declare it, in the right order: after the ingest
     has definitely succeeded, before the follow-up refresh starts. */
  for (const [file, fn] of [["fal-generation.js", "refreshFalGeneration"], ["automation.js", "v626RefreshFalJob"]]) {
    const source = fs.readFileSync(path.join(ROOT, "public", file), "utf8").replace(/\r\n/g, "\n");
    const declare = source.indexOf("noteCurrentProjectDurableAdvance(owner)");
    const refreshCall = source.indexOf('load({ intent: "refresh" })');
    assert(declare > 0, `${fn} must declare the durable advance`);
    assert(declare < refreshCall,
      `${fn} must declare it BEFORE the follow-up refresh, so that refresh captures the new generation`);
    assert(/const owner = ACTIVE_PROJECT_SLUG;/.test(source),
      `${fn} must capture the owning project BEFORE the request goes out`);
  }
  console.log("  shared-durable-advance - one helper, scoped to the owned project, doing nothing else, declared before the follow-up refresh in both completion paths");
}

/* ===========================================================================
   PART 3 — DEFERRED SAVE WORK BELONGS TO THE OPEN THAT CREATED IT (F1, F2).
   =========================================================================== */

/* F1. A's deferred migration write-back must not save B. */
async function deferredTriggerAcrossOpensSection(options = {}) {
  const server = twoProjectServer({ a: olderSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, olderSchemaProject("Project A"), options);

  /* The precondition the whole section rests on. If the trigger had already
     fired, everything below would pass against nothing. */
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "the older-schema project must be the one open");
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 1,
    "precondition: an older-schema open must have scheduled the migration write-back, and it must not have fired yet");
  assert.strictEqual(server.writes.length, 0, "precondition: nothing has been written yet");

  await context.switchProject(B);
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), B, "the switch must have completed");
  assert.strictEqual(read(context, "P.meta.title"), "Project B", "and the record on screen must be B's");

  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(server.writes.filter((row) => row.slug === B).map((row) => row.title), [],
    `THE DEFECT: project B received no edit, and A's deferred work saved it anyway: ${JSON.stringify(server.writes)}`);
  assert.deepStrictEqual(server.writes.map((row) => row.slug), [],
    `no save of any project may follow a switch nobody edited: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(read(context, "SAVE_REVISION"), 0, "and B must not even have been marked dirty by it");

  /* AND SAVING IS NOT BROKEN. */
  await vm.runInContext(`(async () => {
    P.meta.title = "Project B, edited by the filmmaker";
    dirty();
    await flushPendingProjectSave();
    await SAVE_CHAIN;
  })()`, context);
  await settle();
  assert.deepStrictEqual(server.writes.map((row) => [row.slug, row.title, row.ifMatch]),
    [[B, "Project B, edited by the filmmaker", REV[B]]],
    "a genuine edit to B must save exactly once, as B, at B's own revision");
  console.log("  F1 deferred-trigger-across-opens - A's migration write-back cannot save B, and B's own first edit still saves at B's revision");
}

/* The trigger fires just BEFORE the switch. Its save belongs to A, and the
   switch must not turn it into a save of B. */
async function triggerBeforeSwitchSection(options = {}) {
  const server = twoProjectServer({ a: olderSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, olderSchemaProject("Project A"), options);
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 1, "precondition: the write-back is queued");

  await realDelay(MIGRATION_TRIGGER_MS + 120);
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 0, "the trigger must have fired by now");
  assert.strictEqual(read(context, "SAVE_REVISION"), 1, "and it must have marked the migrated document dirty");
  assert.strictEqual(server.writes.length, 0, "but the debounce must not have dispatched yet");

  await context.switchProject(B);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(server.writes.map((row) => [row.slug, row.ifMatch]), [[A, REV[A]]],
    `A's pending migration must be written as A, once, and nothing may be written for B: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(server.writes[0].title, "Project A", "and the document it carried must be A's");
  console.log("  trigger-before-switch - a trigger that fired first is flushed as A, and never re-dispatched as B");
}

/* F2. THE NON-ATOMIC IDENTITY WINDOW.
 *
 * The old shape set `ACTIVE_PROJECT_SLUG` and `PROJECT_REVISION` inside load()'s
 * own Promise.all and assigned `P` only after it resolved. A debounce
 * dispatching in between sent A's DOCUMENT to B's URL at B's revision.
 *
 * The window is gone because PREPARE installs nothing: the identity and the
 * record move together, in one synchronous commit. So the invariant this pins is
 * not "nothing is written" — it is the one that actually matters and that the
 * defect broke: NO REQUEST MAY CARRY ONE PROJECT'S DOCUMENT UNDER ANOTHER
 * PROJECT'S IDENTITY. A's own edit still reaches A, which is where the
 * filmmaker's work is supposed to go. */
async function debounceInsideTransitionSection(options = {}) {
  const server = twoProjectServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 0,
    "precondition: this section is about the debounce, so the project must queue no trigger");

  vm.runInContext(`P.meta.title = "Project A, mid-edit"; dirty();`, context);
  assert.strictEqual(read(context, "SAVE_REVISION"), 1, "precondition: A is dirty with a pending debounce");

  /* A project open that does NOT flush first — the shape a rollback and an
     import take — held open across the debounce. */
  server.hold();
  vm.runInContext(`__switching = fetch("/api/projects/switch", { method: "POST", headers: {}, body: JSON.stringify({ slug: ${JSON.stringify(B)} }) }).then(() => load());`, context);
  await settle();
  await realDelay(AUTOSAVE_DEBOUNCE_MS + 250);
  const duringLoad = server.writes.slice();
  server.release();
  await read(context, "__switching");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(duringLoad.map((row) => [row.slug, row.title, row.ifMatch]),
    [[A, "Project A, mid-edit", REV[A]]],
    `THE DEFECT: A's edit must go to A's URL carrying A's document at A's revision, and it went: ${JSON.stringify(duringLoad)}`);
  assert.deepStrictEqual(server.writes.filter((row) => row.slug === B), [],
    `nothing may be written for B, which received no edit: ${JSON.stringify(server.writes)}`);
  assert.deepStrictEqual(server.writes.filter((row) => row.slug !== row.title.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 9)).map((row) => [row.slug, row.title]),
    [], "and no request may carry one project's document under another project's identity");
  assert.strictEqual(read(context, "P.meta.title"), "Project B", "B is the record on screen");

  /* Still not suppression: B's own edit saves. */
  await vm.runInContext(`(async () => { P.meta.title = "Project B, edited"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  assert.deepStrictEqual(server.writes.slice(duringLoad.length).map((row) => [row.slug, row.title, row.ifMatch]),
    [[B, "Project B, edited", REV[B]]], "B's own edit must save once, as B, at B's revision");
  console.log("  F2 debounce-inside-transition - a debounce created under A carries A's document to A at A's revision, and B is never written by it");
}

/* A -> B -> A. Nothing is resurrected, and the reopen's own work is not
   invalidated with it. */
async function repeatedSwitchSection(options = {}) {
  const server = twoProjectServer({ a: olderSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, olderSchemaProject("Project A"), options);
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 1, "precondition: A's first open queued the write-back");

  await context.switchProject(B);
  await context.switchProject(A);
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "A is open again");
  /* The harness's stored copy of A is never mutated by a write, so this reopen
     genuinely migrates again — which is what makes the count below a claim.

     TWO, NOT ONE, AND DELIBERATELY. A trigger from a previous open is made INERT
     by the epoch it was bound to, not deleted out from under the timer: one
     mechanism, in the scheduler, rather than a binding plus a sweep that would
     mask each other. The first open's trigger is still queued here and will fire
     into nothing; the reopen's own is queued beside it. The single write below is
     what proves which of them acted. */
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 2,
    "the reopen must schedule its OWN write-back beside the previous open's inert one; invalidating the new open's work would be the opposite defect");

  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 0, "and both timers have fired and drained");

  assert.deepStrictEqual(server.writes.map((row) => [row.slug, row.title, row.ifMatch]),
    [[A, "Project A", REV[A]]],
    `exactly one write, from the CURRENT open of A: two would mean the first open's dropped work came back: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH") >= 3, true, "three opens must have advanced the epoch three times");
  console.log("  repeated-switch - A -> B -> A resurrects nothing, and the reopen's own write-back still runs");
}

/* A blocked project, then a switch. The block does not follow the project. */
async function blockedThenSwitchSection(options = {}) {
  const server = twoProjectServer({
    a: currentSchemaProject("Project A"),
    b: currentSchemaProject("Project B"),
    replyFor: (index) => (index === 0
      ? { status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["shots[0].dur must be a positive number"] } }
      : { status: 200 }),
  });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  await vm.runInContext(`(async () => { P.meta.title = "Project A, refused"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "precondition: A's refusal must have paused saving");
  assert.strictEqual(server.writes.length, 1, "precondition: exactly the one refused write");

  await context.switchProject(B);
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), B, "the switch must complete even from a blocked project");
  assert.strictEqual(read(context, "SAVE_BLOCKED"), false, "B must not inherit A's pause");
  assert.strictEqual(read(context, "AUTHORITY_SAVE_REFUSED"), false, "nor A's authority latch");
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "nor a conflict it never had");
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 0, "and nothing deferred may cross with it");

  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  assert.strictEqual(server.writes.length, 1, `opening a new project must send nothing by itself: ${JSON.stringify(server.writes)}`);

  await vm.runInContext(`(async () => { P.meta.title = "Project B, edited after A was blocked"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  assert.deepStrictEqual(server.writes.slice(1).map((row) => [row.slug, row.title, row.ifMatch]),
    [[B, "Project B, edited after A was blocked", REV[B]]], "and B's own edit must save normally");
  console.log("  blocked-then-switch - a paused project does not export its pause, its latches or its deferred work to the next project");
}

/* The control: a current-schema A to B queues nothing and writes nothing, so the
   sections above are claims about the deferred work rather than about switching. */
async function currentSchemaControlSection(options = {}) {
  const server = twoProjectServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 0, "a current-schema open queues no write-back");
  await context.switchProject(B);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  assert.deepStrictEqual(server.writes, [],
    `a switch between two current-schema projects writes nothing at all: ${JSON.stringify(server.writes)}`);
  console.log("  current-schema-control - with no deferred work to isolate, a switch writes nothing either way");
}

/* ===========================================================================
   PART 4 — THE SAME-PROJECT COMPLETION (F3).
   =========================================================================== */

async function openSolo(server, options = {}) {
  const rendered = await render("#/production", currentSchemaProject("Solo project"), { ...options, fetch: server.fetch });
  return rendered.context;
}
/* The refresh server addressed as one project, so a completion section reads
   like the shipped single-project case it is. */
function soloServer(overrides = {}) {
  const server = refreshServer({ a: currentSchemaProject("Solo project"), b: currentSchemaProject("Unused"), ...overrides });
  return server;
}

/* F3, THROUGH THE SHIPPED FAL COMPLETION PATH. */
async function completionWithLocalEditSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);
  const ownedRevision = server.revisionOf(A);

  vm.runInContext(`P.meta.title = "The filmmaker's unsaved title"; dirty();`, context);
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "precondition: the edit is unsaved");
  assert.strictEqual(read(context, "saveTimer !== null"), true, "precondition: its debounce is pending");
  assert.strictEqual(server.writes.length, 0, "precondition: nothing has been written yet");

  await context.refreshFalGeneration("job-1", false);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(server.completions, 1, "the server must actually have ingested, or this section is vacuous");
  assert.strictEqual(read(context, "P.meta.title"), "The filmmaker's unsaved title",
    "THE BLOCKER: a same-project completion refresh must not delete the filmmaker's unsaved edit");
  assert.deepStrictEqual(marks(context), ["completion-1"], "and the provider's completion data must be on screen as well");
  assert.strictEqual(server.docs[A].meta.title, "The filmmaker's unsaved title", "the stored document must hold the edit");
  assert.deepStrictEqual(server.docs[A].meta.completionMarks, ["completion-1"],
    "and the completion — neither side overwrote the other");
  assert.strictEqual(server.writes.length, 1, "the edit must be durably saved exactly once");
  assert.strictEqual(server.writes[0].ifMatch, ownedRevision,
    "at the revision this view owned BEFORE the ingest, which is the only one it could truthfully carry");
  assert.strictEqual(server.writes[0].status, 200, "and it must have been accepted, not refused as stale");
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), false, "the counters must be truthful: nothing is unsaved now");
  assert.strictEqual(saveIndicator(context), "Saved",
    "and the indicator may say Saved, because the record on screen IS the stored one");
  console.log("  F3 completion-with-local-edit - the shipped fal completion saves the edit first, ingests on top of it, and the re-read returns both");
}

/* The same completion with nothing unsaved writes nothing at all, so the section
   above is a claim about the edit rather than about completions. */
async function completionWithoutLocalEditSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), false, "precondition: nothing is unsaved");

  await context.refreshFalGeneration("job-1", false);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(server.writes, [], `a completion with nothing unsaved must write nothing: ${JSON.stringify(server.writes)}`);
  assert.deepStrictEqual(marks(context), ["completion-1"], "and the completion data must still arrive");
  assert.strictEqual(saveIndicator(context), "Saved", "and the indicator is truthful");
  console.log("  completion-without-local-edit - a clean view's completion refresh costs no write and still collects the results");
}

/* The completion arrives while a local save is still in flight. */
async function completionDuringSaveSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);

  server.holdWrites();
  vm.runInContext(`P.meta.title = "in flight when the job finished"; dirty(); __save = flushPendingProjectSave();`, context);
  await settle();
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "precondition: the save is parked in flight");

  vm.runInContext(`__completion = refreshFalGeneration("job-1", false);`, context);
  await settle();
  assert.strictEqual(server.completions, 0,
    "the ingest must not begin while this view still has an unsent write in flight");

  server.releaseWrites();
  await read(context, "__save");
  await read(context, "__completion");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(server.writes.length, 1, `exactly one write: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(server.writes[0].status, 200, "accepted, not refused as stale");
  assert.strictEqual(read(context, "P.meta.title"), "in flight when the job finished", "the edit survived");
  assert.deepStrictEqual(marks(context), ["completion-1"], "and the completion landed on top of it");
  console.log("  completion-during-save - a completion waits for the in-flight local save instead of racing it");
}

/* A paused project receives a completion. Nothing is written, nothing is
   overwritten, and nothing claims to be saved. */
async function completionWhileBlockedSection(options = {}) {
  const server = soloServer({
    replyForWrite: (index) => (index === 0
      ? { status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["shots[0].dur must be a positive number"] } }
      : { status: 200 }),
  });
  const context = await openSolo(server, options);

  await vm.runInContext(`(async () => { P.meta.title = "refused, and still mine"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "precondition: the refusal paused saving");
  assert.strictEqual(server.writes.length, 1, "precondition: exactly the one refused write");

  await context.refreshFalGeneration("job-1", false);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(server.completions, 1, "the server still ingested");
  assert.strictEqual(read(context, "P.meta.title"), "refused, and still mine",
    "a paused view's refused edit must stay in this tab across a completion refresh");
  assert.strictEqual(server.writes.length, 1, `and a paused view must send nothing further: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "the pause is frozen Save Truth behaviour and must survive");
  assert.notStrictEqual(saveIndicator(context), "Saved",
    "and nothing may report Saved over an edit that was refused and never written");
  console.log("  completion-while-blocked - a paused project keeps its refused edit, sends nothing, and never claims to be saved");
}

/* Repeated completions while the filmmaker keeps editing. */
async function repeatedCompletionsSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);

  vm.runInContext(`P.meta.title = "first edit"; dirty();`, context);
  await context.refreshFalGeneration("job-1", false);
  await settle();
  vm.runInContext(`P.meta.title = "second edit"; dirty();`, context);
  await context.refreshFalGeneration("job-2", false);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(server.completions, 2, "both completions must have ingested");
  assert.strictEqual(read(context, "P.meta.title"), "second edit", "the latest edit is on screen");
  assert.deepStrictEqual(marks(context), ["completion-1", "completion-2"], "and both completions with it");
  assert.strictEqual(server.docs[A].meta.title, "second edit", "storage holds the latest edit");
  assert.deepStrictEqual(server.docs[A].meta.completionMarks, ["completion-1", "completion-2"], "and both completions");
  assert.deepStrictEqual(server.writes.map((row) => [row.title, row.status]),
    [["first edit", 200], ["second edit", 200]],
    `one accepted write per edit, and no refusals: ${JSON.stringify(server.writes)}`);
  console.log("  repeated-completions - editing across two completions loses neither edit nor either set of results");
}

/* The automation half of the same shipped contract. */
async function automationCompletionSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);

  vm.runInContext(`P.meta.title = "unsaved when the automation step finished"; dirty();`, context);
  await vm.runInContext(`v626RefreshFalJob("job-1")`, context);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(server.completions, 1, "the automation path must have ingested");
  assert.strictEqual(read(context, "P.meta.title"), "unsaved when the automation step finished",
    "public/automation.js's completion refresh must preserve the edit exactly as fal-generation.js's does");
  assert.deepStrictEqual(marks(context), ["completion-1"], "and collect the results");
  assert.deepStrictEqual(server.writes.map((row) => [row.title, row.status]),
    [["unsaved when the automation step finished", 200]], "with exactly one accepted write");
  console.log("  automation-completion - v626RefreshFalJob keeps the same contract as refreshFalGeneration");
}

/* THE DIRTY-VIEW BACKSTOP, reached the only way the shipped path leaves open: an
   edit typed INSIDE the completion round-trip, after the pre-ingest flush has
   been and gone. The refresh declines, and what follows is truthful rather than
   silent. */
async function dirtyDuringRefreshSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);
  const ownedRevision = server.revisionOf(A);
  const epochBefore = read(context, "PROJECT_OPEN_EPOCH");

  const r1 = await beginParkedRefresh(server, context, "__completion", "job-1");
  /* WITHOUT THIS THE SECTION IS VACUOUS: the edit has to land while the refresh
     is genuinely in flight. */
  vm.runInContext(`P.meta.title = "typed while the results were arriving"; dirty();`, context);
  await releaseAndSettle(server, context, r1, "__completion");

  assert.strictEqual(read(context, "P.meta.title"), "typed while the results were arriving",
    "a refresh must not replace a record that became dirty while it was in flight");
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "the edit is still unsaved, and the view says so");
  assert.notStrictEqual(saveIndicator(context), "Saved", "and nothing claims otherwise");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), epochBefore,
    "and a declining refresh advances nothing, so this decline is the dirty-view rule and not the staleness one");

  /* AND WHAT FOLLOWS IS TRUTHFUL. The ingest advanced the stored revision and
     this view declined to adopt it, so the save waiting behind the edit really IS
     stale — and is refused as such, through the accepted conflict surface, rather
     than succeeding by overwriting the results it never took delivery of. */
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  assert.deepStrictEqual(server.writes.map((row) => [row.ifMatch, row.status]), [[ownedRevision, 409]],
    `the pending save must go out at the revision this view owns and be refused as stale: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), true, "and the refusal must latch the accepted conflict surface");
  assert.strictEqual(read(context, "P.meta.title"), "typed while the results were arriving",
    "the edit is still in this tab, for the filmmaker to decide about");
  assert.strictEqual(server.docs[A].meta.title, "Solo project", "storage never received it");
  assert.deepStrictEqual(server.docs[A].meta.completionMarks, ["completion-1"],
    "and, decisively, the completion data was NOT overwritten by the stale write");
  console.log("  dirty-during-refresh - an edit typed inside the round-trip stops the refresh, and its stale save is refused rather than overwriting the results");
}

/* REOPEN IS NOT REFRESH. An explicit reopen of the SAME project is a replacement
   — it advances the epoch and kills work deferred against the previous record —
   and it is not the lossy path, because every reopen caller persists first. */
async function explicitReopenSection(options = {}) {
  const server = soloServer();
  const context = await openSolo(server, options);
  const ownedRevision = server.revisionOf(A);

  vm.runInContext(`P.meta.title = "unsaved when the reopen began"; dirty();`, context);
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "precondition: the view is dirty");
  const beforeReopen = read(context, "PROJECT_OPEN_EPOCH");

  await context.switchProject(A);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH") > beforeReopen, true,
    "an explicit reopen advances the epoch, so work deferred against the previous record dies with it");
  assert.deepStrictEqual(server.writes.map((row) => [row.title, row.ifMatch, row.status]),
    [["unsaved when the reopen began", ownedRevision, 200]],
    `the reopen persists the edit before replacing the record: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(read(context, "P.meta.title"), "unsaved when the reopen began", "which is what comes back");
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), false, "with the counters truthful afterwards");
  console.log("  explicit-reopen - a deliberate reopen replaces the record and advances the epoch, having persisted first");
}

/* ===========================================================================
   PART 5 — A REFRESH THAT OUTLIVED ITS OPEN (F4, F5).
   =========================================================================== */

/* F4. An explicit switch outranks an older refresh. */
async function staleRefreshAfterSwitchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "precondition: project A is current");

  const r1 = await beginParkedRefresh(server, context, "__refresh", "job-1");
  assert.strictEqual(server.completions, 1, "precondition: A's completion ingested");

  await context.switchProject(B);
  /* Something project-local, established under B, that a stale refresh would
     discard on its way past. */
  vm.runInContext(`setContinuityRun("L1-01", { status: "done", pairId: "b-pair", data: null });`, context);
  const afterSwitch = projectIdentity(context);
  assert.strictEqual(afterSwitch.slug, B, "the switch must have completed on the client");
  assert.strictEqual(afterSwitch.title, "Project B", "and installed B's record");
  assert.strictEqual(server.active, B, "and on the server");
  assert.strictEqual(afterSwitch.continuity, 1, "precondition: B has project-local display state of its own");
  const writesBefore = server.writes.length;

  await releaseAndSettle(server, context, r1, "__refresh");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  const after = projectIdentity(context);
  assert.strictEqual(after.slug, B,
    `THE BLOCKER: a refresh that started under A must not reinstall A over an explicit switch to B — the slug is now ${after.slug}`);
  assert.strictEqual(after.title, "Project B", "the record on screen must still be B's");
  assert.strictEqual(after.revision, afterSwitch.revision, "and B's revision must be untouched");
  assert.strictEqual(after.epoch, afterSwitch.epoch, "a stale refresh must not advance the project-open epoch either");
  assert.strictEqual(after.continuity, 1, "nor discard B's project-local display state");
  assert.strictEqual(after.topbar, "Project B", "and the workspace chrome must still name B");
  assert.strictEqual(server.active, B, "the server's active project is unchanged, so client and server still agree");
  assert.strictEqual(server.writes.length, writesBefore,
    `and nothing may be written by a discarded refresh: ${JSON.stringify(server.writes.slice(writesBefore))}`);

  const bRevision = server.revisionOf(B);
  await vm.runInContext(`(async () => { P.meta.title = "Project B, edited after the stale refresh"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  assert.deepStrictEqual(server.writes.slice(writesBefore).map((row) => [row.slug, row.title, row.ifMatch, row.status]),
    [[B, "Project B, edited after the stale refresh", bRevision, 200]],
    "a genuine later edit to B must save exactly once, as B, at B's exact revision");
  console.log("  F4 stale-refresh-after-switch - an explicit switch outranks an older refresh, which installs nothing and advances nothing");
}

/* The control that makes the section above a claim about staleness rather than
   about holding a read: the same held refresh, with no switch, commits normally. */
async function heldRefreshWithoutSwitchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const before = projectIdentity(context);

  const r1 = await beginParkedRefresh(server, context, "__refresh", "job-1");
  await releaseAndSettle(server, context, r1, "__refresh");

  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "the project is unchanged");
  assert.deepStrictEqual(marks(context), ["completion-1"], "and a refresh nothing overtook must install its results normally");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), before.epoch,
    "a committing refresh must not advance the open's epoch: it is the same open reading a newer copy of its own record");
  assert.strictEqual(read(context, "PROJECT_REFRESH_COMMITTED") > 0, true,
    "it records its place in the refresh order instead, which is the token that orders overlapping refreshes");
  console.log("  held-refresh-without-switch - a held refresh that nothing overtakes commits, orders itself, and does not advance the open's epoch");
}

/* F5. A -> B -> back to A. The old refresh does not become valid again merely
   because its project is current once more. */
async function staleRefreshAfterSwitchBackSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  const r1 = await beginParkedRefresh(server, context, "__refresh", "job-1");

  await context.switchProject(B);
  await context.switchProject(A);
  const afterReturn = projectIdentity(context);
  assert.strictEqual(afterReturn.slug, A, "A is current again");
  assert.deepStrictEqual(marks(context), ["completion-1"], "and the reopen read A's CURRENT record, ingest included");

  await releaseAndSettle(server, context, r1, "__refresh");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), afterReturn.epoch,
    "the old refresh must stay stale: matching slugs are not the same thing as the same open");
  assert.strictEqual(read(context, "PROJECT_REVISION"), afterReturn.revision,
    "and it must not install the revision it read three opens ago");
  console.log("  F5 stale-refresh-after-switch-back - an old refresh does not become valid merely because its project is current again");
}

/* Repeated stale refreshes cannot advance anything between them. */
async function repeatedStaleRefreshSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  await beginParkedRefresh(server, context, "__one", "job-1");
  await beginParkedRefresh(server, context, "__two", "job-2");

  await context.switchProject(B);
  const afterSwitch = projectIdentity(context);

  server.releaseProjectReads();
  await read(context, "__one");
  await read(context, "__two");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(projectIdentity(context), afterSwitch,
    "two stale refreshes must leave the project identity, the record and the epoch exactly as the switch left them");
  console.log("  repeated-stale-refresh - stale refreshes cannot advance anything, however many of them return");
}

/* The automation completion path obeys the same invariant. */
async function automationStaleRefreshSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  const r1 = await beginParkedRefresh(server, context, "__refresh", "job-1", "automation");

  await context.switchProject(B);
  const afterSwitch = projectIdentity(context);

  await releaseAndSettle(server, context, r1, "__refresh");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(projectIdentity(context), afterSwitch,
    "public/automation.js's completion refresh must be outranked by an explicit switch exactly as fal-generation.js's is");
  assert.strictEqual(server.active, B, "and the server is still on B");
  console.log("  automation-stale-refresh - the invariant lives in the refresh lifecycle, not in either completion path");
}

/* ===========================================================================
   PART 6 — OVERLAPPING SAME-PROJECT REFRESHES (F6).
   =========================================================================== */

/* O1. Older response first, then newer. Both commit, in order.

   THE TWO SNAPSHOTS DIFFER BECAUSE THE SERVER MOVED THE DOCUMENT ITSELF — its own
   ingest reaper, or another window — rather than because this browser asked for an
   ingest. That is deliberate: an ingest this window requested is a DURABLE ADVANCE
   it declares, which correctly makes a pre-ingest snapshot stale (see E6). This
   section is about ORDER on its own, so it uses the one kind of advance the
   browser cannot know about and therefore cannot be made stale by. */
async function overlappingOlderThenNewerSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const epoch = read(context, "PROJECT_OPEN_EPOCH");
  const generation = read(context, "PROJECT_SAVE_GENERATION");

  const r1 = await beginParkedRefresh(server, context, "__r1", "", "generic");
  server.serverSideIngest();
  const r2 = await beginParkedRefresh(server, context, "__r2", "", "generic");
  assert.strictEqual(server.completions, 1, "precondition: the two snapshots differ by one server-side ingest");

  await releaseAndSettle(server, context, r1, "__r1");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-0"', "R1's snapshot is installed when it lands first");
  assert.deepStrictEqual(marks(context), [], "showing the record as it was when it read");

  await releaseAndSettle(server, context, r2, "__r2");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-1"', "and R2's newer snapshot commits over it");
  assert.deepStrictEqual(marks(context), ["completion-1"], "with the newer record on screen");
  assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A), "client and server agree on the revision");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), epoch, "and neither refresh advanced the open's epoch");
  assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generation, "nor the freshness generation");
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "no conflict was manufactured");
  assert.strictEqual(saveIndicator(context), "Saved", "and the indicator is truthful");
  console.log("  O1 older-then-newer - both refreshes commit in order, and the client ends level with the server");
}

/* O2. Newer response first. The older one that follows changes nothing. */
async function overlappingNewerThenOlderSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  /* Server-side advances, so neither refresh declares anything and the ONLY rule
     that can stop the older response rolling the record back is the order token
     — which is what NC-7 removes. */
  const r1 = await beginParkedRefresh(server, context, "__r1", "", "generic");
  server.serverSideIngest();
  const r2 = await beginParkedRefresh(server, context, "__r2", "", "generic");

  await releaseAndSettle(server, context, r2, "__r2");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-1"', "R2's snapshot is installed");
  assert.deepStrictEqual(marks(context), ["completion-1"], "with the newer record");
  const afterNewer = clientState(context);

  await releaseAndSettle(server, context, r1, "__r1");
  assert.deepStrictEqual(clientState(context), afterNewer,
    "THE BLOCKER, from the other side: an older response must not roll the record back over a newer one that already committed");
  assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A), "client and server still agree");
  console.log("  O2 newer-then-older - an older response landing after a newer commit leaves the client byte-identical");
}

/* O3. Three refreshes, two out-of-order permutations. */
async function overlappingThreeRefreshesSection(options = {}) {
  for (const order of [[1, 0, 2], [2, 0, 1]]) {
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), options);
    const handles = ["__a", "__b", "__c"];
    const parked = [];
    for (let index = 0; index < 3; index += 1) {
      if (index) server.serverSideIngest();
      parked.push(await beginParkedRefresh(server, context, handles[index], "", "generic"));
    }
    assert.strictEqual(server.completions, 2, "precondition: three snapshots, two server-side advances apart");

    const seen = [];
    for (const index of order) {
      await releaseAndSettle(server, context, parked[index], handles[index]);
      seen.push(read(context, "PROJECT_REVISION"));
    }
    assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-2"',
      `release order ${order.join(" -> ")} must end on the newest snapshot, and the client is at ${read(context, "PROJECT_REVISION")} after ${JSON.stringify(seen)}`);
    assert.deepStrictEqual(marks(context), ["completion-1", "completion-2"], "with every advance present");
    assert.strictEqual(read(context, "PROJECT_REVISION"), server.revisionOf(A), "and level with the server");
  }
  console.log("  O3 three-refreshes - out-of-order responses converge on the newest snapshot, and an older one never rolls a newer commit back");
}

/* O4. A NEWER REQUEST THAT FAILED must not disqualify a valid older response.
   "Latest started wins" is deliberately not the rule; what is ordered is what
   actually committed. */
async function newerRefreshFailedSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  const r1 = await beginParkedRefresh(server, context, "__r1", "", "generic");
  server.serverSideIngest();
  /* A later refresh that MERELY STARTED and then failed. It carries no durable
     advance of its own — that is what separates it from a completion, whose
     ingest genuinely does move the record (E2). It takes a later sequence number
     and never commits. */
  server.failNextProjectRead();
  await vm.runInContext(`load({ intent: "refresh" })`, context);
  await settle();
  assert.strictEqual(read(context, "PROJECT_REFRESH_COMMITTED"), 0,
    "precondition: the failed refresh must not have recorded itself as committed");
  assert.strictEqual(read(context, "PROJECT_REFRESH_SEQUENCE") >= 2, true,
    "precondition: but it must have TAKEN a later sequence number, or the section proves nothing");

  await releaseAndSettle(server, context, r1, "__r1");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-0"',
    "the older but valid response must still commit: a later request that FAILED cannot disqualify it");
  assert.deepStrictEqual(marks(context), [], "installing what it actually read");
  assert.strictEqual(read(context, "PROJECT_REFRESH_COMMITTED") > 0, true, "and taking its place in the refresh order");
  console.log("  O4 newer-request-failed - a failed later request does not throw away a valid older response");
}

/* O5. An explicit replacement still dominates, whatever the refresh order. */
async function overlappingRefreshesThenSwitchSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  const r1 = await beginParkedRefresh(server, context, "__r1", "job-1");
  const r2 = await beginParkedRefresh(server, context, "__r2", "job-2");

  await context.switchProject(B);
  const afterSwitch = projectIdentity(context);
  assert.strictEqual(afterSwitch.slug, B, "precondition: the switch completed");

  await releaseAndSettle(server, context, r2, "__r2");
  await releaseAndSettle(server, context, r1, "__r1");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();

  assert.deepStrictEqual(projectIdentity(context), afterSwitch,
    "an explicit replacement outranks every refresh of the previous open, in any order");
  assert.strictEqual(server.active, B, "and client and server still agree");
  console.log("  O5 replacement-dominates - refresh ordering never lets a previous open's read past the epoch check");
}

/* O6. The dirty-view backstop between two refresh commits. */
async function dirtyBetweenRefreshCommitsSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  /* Server-side advances again, so this section is about the DIRTY rule between
     two refresh commits rather than about freshness — see O1. */
  const r1 = await beginParkedRefresh(server, context, "__r1", "", "generic");
  server.serverSideIngest();
  const r2 = await beginParkedRefresh(server, context, "__r2", "", "generic");

  await releaseAndSettle(server, context, r1, "__r1");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-0"', "precondition: R1 committed");

  const ownedRevision = read(context, "PROJECT_REVISION");
  vm.runInContext(`P.meta.title = "edited between two refreshes"; dirty();`, context);
  await releaseAndSettle(server, context, r2, "__r2");

  assert.strictEqual(read(context, "P.meta.title"), "edited between two refreshes",
    "R2 must not overwrite an authored edit made since R1 committed");
  assert.strictEqual(read(context, "PROJECT_REVISION"), ownedRevision,
    "and must not install its revision over a record it was not allowed to replace");
  assert.notStrictEqual(saveIndicator(context), "Saved", "nothing claims to be saved");

  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  assert.deepStrictEqual(server.writes.map((row) => [row.ifMatch, row.status]), [[ownedRevision, 409]],
    `the stale save must be refused, not accepted: ${JSON.stringify(server.writes)}`);
  assert.strictEqual(read(context, "PROJECT_CONFLICT"), true, "through the accepted conflict surface");
  assert.deepStrictEqual(server.docs[A].meta.completionMarks, ["completion-1"],
    "and, decisively, the newer record was not overwritten by it");
  console.log("  O6 dirty-between-commits - an edit made between two refresh commits survives, and its stale save is refused rather than overwriting the newer record");
}

/* O7. The automation entry path runs the same lifecycle, including ordering. */
async function overlappingAutomationRefreshSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  const epoch = read(context, "PROJECT_OPEN_EPOCH");

  const r1 = await beginParkedRefresh(server, context, "__r1", "job-1", "automation");
  const r2 = await beginParkedRefresh(server, context, "__r2", "job-2", "automation");

  await releaseAndSettle(server, context, r2, "__r2");
  const afterNewer = clientState(context);
  assert.strictEqual(afterNewer.revision, '"rev-project-a-2"', "the newer automation refresh commits");

  await releaseAndSettle(server, context, r1, "__r1");
  assert.deepStrictEqual(clientState(context), afterNewer,
    "and the older one that follows it changes nothing — the ordering lives in the refresh lifecycle, not in either entry path");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), epoch, "with the epoch untouched throughout");
  console.log("  O7 automation-ordering - v626RefreshFalJob inherits the same ordering as refreshFalGeneration, without either being special-cased");
}

/* ===========================================================================
   PART 7 — A REFRESH'S FAILURE TERMINALS (F7).
   =========================================================================== */

/* L1. A refresh 404 landing after a newer refresh already committed. */
async function refreshMissAfterNewerCommitSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);

  server.missNextProjectRead();
  const r1 = await beginParkedRefresh(server, context, "__r1", "job-1");
  const r2 = await beginParkedRefresh(server, context, "__r2", "job-2");

  await releaseAndSettle(server, context, r2, "__r2");
  assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-2"', "precondition: R2 committed");
  const committed = workspaceState(context);
  assert.strictEqual(committed.firstRun, false, "precondition: a real workspace is on screen");

  await releaseAndSettle(server, context, r1, "__r1");
  assert.deepStrictEqual(workspaceState(context), committed,
    "THE BLOCKER: a refresh answered 404 must leave the committed workspace byte-identical, not clear it into first-run");
  assert.strictEqual(read(context, "P") === null, false, "P must still hold the project");
  assert.strictEqual(server.active, A, "and the server still has the project the client is showing");
  console.log("  F7a refresh-404-after-commit - a delayed 404 cannot clear a workspace a newer refresh already committed");
}

/* L2. A refresh 404 while the filmmaker has unsaved work. */
async function refreshMissWhileDirtySection(options = {}) {
  /* L2a. THE TERMINAL ITSELF, through the generic lifecycle entry. */
  {
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), options);
    const ownedRevision = server.revisionOf(A);
    vm.runInContext(`P.meta.title = "unsaved when the read went missing"; dirty();`, context);
    assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "precondition: the view is dirty");
    assert.strictEqual(read(context, "saveTimer !== null"), true, "precondition: its debounce is armed");

    server.missNextProjectRead();
    const r1 = await beginParkedRefresh(server, context, "__r1", "job-1", "generic");
    await releaseAndSettle(server, context, r1, "__r1");

    assert.strictEqual(read(context, "P.meta.title"), "unsaved when the read went missing",
      "THE BLOCKER: a refresh 404 must not clear a record that holds unsaved authored work");
    assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "and the dirty state must survive with it");
    assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "the project is still open");
    assert.strictEqual(read(context, 'document.getElementById("main").innerHTML.includes("WELCOME TO CINEBRAID")'), false,
      "and the first-run screen must never appear over an open project");

    /* AND THE AUTHORED WORK STILL REACHES DISK. With `P` cleared,
       captureProjectSave() answers null and the debounce expires writing nothing
       — which is how the work was lost with nothing on the wire and nothing on
       screen. Here the debounce finds a record and writes it. */
    await realDelay(PAST_BOTH_TIMERS_MS);
    await settle();
    assert.deepStrictEqual(server.writes.map((row) => [row.title, row.ifMatch, row.status]),
      [["unsaved when the read went missing", ownedRevision, 200]],
      `the debounce must still write the edit, once, at the revision this view owns: ${JSON.stringify(server.writes)}`);
    assert.strictEqual(server.docs[A].meta.title, "unsaved when the read went missing", "and it must reach storage");
  }

  /* L2b. THE SAME TERMINAL BEHIND A SHIPPED COMPLETION, where the ingest HAS
     advanced the stored revision. The edit still survives; its save is then
     truthfully refused as stale rather than overwriting the completion. */
  {
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), options);
    const ownedRevision = server.revisionOf(A);
    server.missNextProjectRead();
    const r1 = await beginParkedRefresh(server, context, "__r1", "job-1");
    vm.runInContext(`P.meta.title = "typed while the read was missing"; dirty();`, context);
    await releaseAndSettle(server, context, r1, "__r1");

    assert.strictEqual(read(context, "P.meta.title"), "typed while the read was missing", "the edit survives");
    assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "and is still marked unsaved");
    assert.strictEqual(read(context, 'document.getElementById("main").innerHTML.includes("WELCOME TO CINEBRAID")'), false,
      "with no first-run screen");
    await realDelay(PAST_BOTH_TIMERS_MS);
    await settle();
    assert.deepStrictEqual(server.writes.map((row) => [row.ifMatch, row.status]), [[ownedRevision, 409]],
      `and its save is refused as the stale write it is: ${JSON.stringify(server.writes)}`);
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), true, "through the accepted conflict surface");
    assert.deepStrictEqual(server.docs[A].meta.completionMarks, ["completion-1"], "without overwriting the completion");
  }
  console.log("  F7b refresh-404-while-dirty - authored work and the dirty state both survive a refresh 404, and the save that follows is truthful");
}

/* L3 + L4. A refresh 404 after an explicit switch, and after a switch back. */
async function refreshMissAcrossReplacementSection(options = {}) {
  for (const [label, switches] of [["A -> B", [B]], ["A -> B -> A", [B, A]]]) {
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), options);
    server.missNextProjectRead();
    const r1 = await beginParkedRefresh(server, context, "__r1", "job-1");
    for (const slug of switches) await context.switchProject(slug);
    const afterSwitches = workspaceState(context);
    assert.strictEqual(afterSwitches.firstRun, false, `precondition (${label}): a real workspace is open`);

    await releaseAndSettle(server, context, r1, "__r1");
    await realDelay(PAST_BOTH_TIMERS_MS);
    await settle();
    assert.deepStrictEqual(workspaceState(context), afterSwitches,
      `${label}: a 404 from an older open's refresh must change nothing about the current open`);
    assert.strictEqual(server.active, switches[switches.length - 1], `${label}: client and server still agree`);
  }
  console.log("  F7c refresh-404-across-replacement - a previous open's 404 cannot touch the open that replaced it, or the one after that");
}

/* L5. The first-run terminal still belongs to an EXPLICIT open, and still works.
   Without this, gating the branch could be passing by disabling it. */
async function explicitOpenOfMissingProjectSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "precondition: a project is open");
  const epochBefore = read(context, "PROJECT_OPEN_EPOCH");

  server.removeProject();
  await vm.runInContext(`load()`, context);
  await settle();

  assert.strictEqual(read(context, "P"), null, "an explicit open of a machine with no project clears the record");
  assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), "", "and the slug");
  assert.strictEqual(read(context, "PROJECT_REVISION"), "", "and the revision it can no longer identify");
  assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH") > epochBefore, true,
    "the first-run terminal is a replacement, so it advances the epoch and kills work deferred against the record it cleared");
  assert.strictEqual(read(context, 'document.getElementById("main").innerHTML.includes("WELCOME TO CINEBRAID")'), true,
    "and installs the first-run screen, which is the intended behaviour of the branch the refresh is barred from");
  assert.strictEqual(read(context, 'document.getElementById("topbar-project").textContent'), "CineBraid",
    "with the chrome relabelled to match");
  console.log("  F7d explicit-open-missing-project - the first-run terminal still belongs to an explicit open, still works, and still advances the epoch");
}

/* L8. A typed/network refresh failure is as non-destructive as the 404. */
async function refreshFailureNonDestructiveSection(options = {}) {
  const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), options);
  vm.runInContext(`P.meta.title = "unsaved when the read failed"; dirty();`, context);
  const before = workspaceState(context);

  server.failNextProjectRead();
  await vm.runInContext(`load({ intent: "refresh" })`, context);
  await settle();

  assert.deepStrictEqual(workspaceState(context), before,
    "a refresh whose read failed must change nothing at all — not the record, not the identity, not the dirty state");
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  assert.deepStrictEqual(server.writes.map((row) => [row.title, row.status]),
    [["unsaved when the read failed", 200]], "and the authored work still saves itself");
  console.log("  F7e refresh-failure-non-destructive - a failed refresh read mutates nothing and does not strand authored work");
}

/* ===========================================================================
   NEGATIVE CONTROLS. Each removes one half of the mechanism from live production
   source IN MEMORY, observes the defect first, and then requires the guarding
   section to go red.
   =========================================================================== */

/* THE REPAIRED SHAPES, and the shapes the reproduced defects had. */
const REPAIRED_TRIGGER_BINDING = `  const epoch = PROJECT_OPEN_EPOCH;
  const timer = setTimeout(() => {
    PENDING_SAVE_TRIGGERS.delete(timer);
    if (epoch !== PROJECT_OPEN_EPOCH) return;
    run();
  }, ms);`;
const TRIGGER_WITHOUT_BINDING = `  const timer = setTimeout(() => {
    PENDING_SAVE_TRIGGERS.delete(timer);
    run();
  }, ms);`;
/* The identity swap as it shipped: the slug and revision installed from the
   response BEFORE the record, with an await still to come. */
const REPAIRED_PREPARE_IDENTITY = `    slug: projectResponse.headers?.get?.("x-cinebraid-project-slug") || "",
    revision:
      projectResponse.headers?.get?.("x-cinebraid-project-revision") ||
      projectResponse.headers?.get?.("etag") ||
      "",`;
const PREPARE_INSTALLS_IDENTITY = `    slug: (ACTIVE_PROJECT_SLUG = projectResponse.headers?.get?.("x-cinebraid-project-slug") || ACTIVE_PROJECT_SLUG || "fixture"),
    revision: (PROJECT_REVISION =
      projectResponse.headers?.get?.("x-cinebraid-project-revision") ||
      projectResponse.headers?.get?.("etag") ||
      ""),`;
/* The ledger read where it used to be: after the record is installed and before
   the baseline and the indicator are settled. */
const REPAIRED_LEDGER_IN_PREPARE = `  prepared.automationRuns = loaded[5]?.runs || [];
  await prepareGenerationLedger(prepared, { claimRecovery });
  return prepared;`;
const LEDGER_AFTER_COMMIT = `  prepared.automationRuns = loaded[5]?.runs || [];
  return prepared;`;
const REPAIRED_COMMIT_BASELINE = `  SAVED_PROJECT_BASELINE = structuredClone(P);`;
const COMMIT_AWAITS_LEDGER = `  __ledgerAfterCommit = prepareGenerationLedger(prepared, { claimRecovery: true }).then(() => {
    FAL_GENERATION_JOBS = prepared.falJobs;
    FAL_GENERATION_LEDGER_LOADED = prepared.falLedgerLoaded;
    SAVED_PROJECT_BASELINE = structuredClone(P);
    setSaveState("saved", "Saved");
  });
  SAVED_PROJECT_BASELINE = structuredClone(P);`;
/* THE WHOLE BINDING TO THE OPEN A REFRESH STARTED UNDER — the epoch it was
   taken in, the project it was taken for, and the project the response describes.
   All three together are "this response is still about the open that asked for
   it", and a control that removed only one of them would be caught by the other
   two, which is a claim about defence in depth rather than about the defect. */
const REPAIRED_OPEN_BINDING = `  if (ticket.epoch !== PROJECT_OPEN_EPOCH)
    return "the project was explicitly replaced while this refresh was in flight";
  if (ticket.slug !== ACTIVE_PROJECT_SLUG)
    return "the project this refresh was started for is no longer the one open";
  if (!prepared.slug || prepared.slug !== ACTIVE_PROJECT_SLUG)
    return "the response describes a different project than the one open";
`;
/* And the response-owner half on its own, which is the one that answers a
   different question: not "did this window move" but "is the server even
   answering about the project this window has open". */
const REPAIRED_RESPONSE_OWNER = `  if (!prepared.slug || prepared.slug !== ACTIVE_PROJECT_SLUG)
    return "the response describes a different project than the one open";
`;
/* The refresh ordering token. */
const REPAIRED_ORDER_CHECK = `  if (ticket.sequence <= PROJECT_REFRESH_COMMITTED)
    return "a newer refresh of this open has already installed its snapshot";
`;
/* The dirty-view backstop. */
const REPAIRED_DIRTY_CHECK = `  if (projectHasUnsavedEdits())
    return "this view holds unsaved authored work a refresh would overwrite";
`;
/* The refresh's own terminal: a discard, not the first-run replacement. */
const REPAIRED_REFRESH_MISS = `    return { intent: "refresh", committed: false, reason: error?.message || "the project could not be re-read" };
  }`;
const REFRESH_MISS_ESCALATES = `    return { intent: "refresh", committed: false, reason: error?.message || "the project could not be re-read" };
  }
  if (!prepared.available) {
    await showFirstRunWorkspace(prepared.message);
    return { intent: "refresh", committed: false, reason: "no project is available" };
  }`;
/* F9's shape: the refresh entry that falls through to a replacement when there
   is no project to refresh. */
const REPAIRED_NO_PROJECT_GUARD = `  if (!P || !ACTIVE_PROJECT_SLUG)
    return { intent: "refresh", committed: false, reason: "no project is open for a refresh to refresh" };
  const ticket = beginProjectRefresh();`;
const NO_PROJECT_BECOMES_REPLACEMENT = `  if (!P || !ACTIVE_PROJECT_SLUG) return runProjectReplacement();
  const ticket = beginProjectRefresh();`;
/* The shipped completion path's halves. The flush anchor keeps the owner capture
   beside it, because `owner` is still referenced below — a control removes the
   PERSIST, not the ownership. */
const REPAIRED_PRE_INGEST_FLUSH = `    await flushPendingProjectSave();
    /* The project this refresh is being made FOR`;
const NO_PRE_INGEST_FLUSH = `    /* The project this refresh is being made FOR`;
const REPAIRED_REFRESH_INTENT = `      if (noteCurrentProjectDurableAdvance(owner)) await load({ intent: "refresh" });`;
const REPLACEMENT_INTENT = `      await load();`;
/* THE UNIVERSAL WATCH'S TWO HALVES: acting on a mismatch, and being bound to the
   open that asked. */
const REPAIRED_WATCH_ACTION = `      if (serverRevision === PROJECT_REVISION) return null;
      return applyForeignProjectRevision(owner);`;
const WATCH_OBSERVES_NOTHING = `      if (serverRevision === PROJECT_REVISION) return null;
      return null;`;
const REPAIRED_WATCH_BINDING = `      if (owner.epoch !== PROJECT_OPEN_EPOCH || owner.slug !== ACTIVE_PROJECT_SLUG) return null;
      if (owner.revision !== PROJECT_REVISION) return null;
      if (serverRevision === PROJECT_REVISION) return null;
      return applyForeignProjectRevision(owner);`;
const WATCH_READS_LIVE_STATE = `      if (serverRevision === PROJECT_REVISION) return null;
      return applyForeignProjectRevision({ slug: ACTIVE_PROJECT_SLUG, epoch: PROJECT_OPEN_EPOCH, revision: PROJECT_REVISION });`;
/* THE AUTOMATION 502 FAST PATH, and the response-ordering mistake it corrects. */
const REPAIRED_AUTOMATION_502 = `  if (!response.ok) {
    await applyProjectMutationResult(owner, data);
    throw new Error(data.error || "Could not refresh generation");
  }`;
const AUTOMATION_502_THROWS_FIRST = `  if (!response.ok) throw new Error(data.error || "Could not refresh generation");`;
/* THE CANCEL RESULT HANDLER. The route still answers projectUpdated; the browser
   stops reading it. */
const REPAIRED_CANCEL_RESULT = `is not inferred from the 2xx. */
  await applyProjectMutationResult(owner, data);`;
const CANCEL_RESULT_IGNORED = `is not inferred from the 2xx. */
  /* control: what the route said it wrote is ignored */`;
/* THE RECONCILE DECLARATION, restored to the false shape the held candidate had. */
const REPAIRED_RECONCILE = `    /* RECONCILE WRITES NO PROJECT DOCUMENT.`;
const RECONCILE_DECLARES_FALSELY = `    noteCurrentProjectDurableAdvance(ACTIVE_PROJECT_SLUG);
    /* RECONCILE WRITES NO PROJECT DOCUMENT.`;
/* THE COMPLETION INGEST'S DECLARATION OF ITS OWN DURABLE ADVANCE. The control
   removes the DECLARATION and keeps the re-read, which is exactly the shape the
   held candidate had: the ingest moves the record and nothing says so. */
const REPAIRED_COMPLETION_ADVANCE = `      if (noteCurrentProjectDurableAdvance(owner)) await load({ intent: "refresh" });`;
const COMPLETION_WITHOUT_ADVANCE = `      await load({ intent: "refresh" });`;
/* THE PREPARED SNAPSHOT'S FRESHNESS PRECONDITION. */
const REPAIRED_FRESHNESS = `  if (ticket.saveGeneration !== PROJECT_SAVE_GENERATION)
    return "this window saved to storage while this refresh was in flight, so the snapshot it read at "
      + (ticket.revision || "an unidentified revision") + " is behind the record";
`;
/* THE TAIL OF THE TRANSACTION GIVEN SOMETHING ASYNCHRONOUS TO FINISH. This is the
   shape the removed latch pretended to prevent and could not: a chrome helper that
   comes back later and restates the save state from data the commit handed it. */
const REPAIRED_DECORATION_TAIL = `  if (typeof resumeFalGenerationPolling === "function")
    setTimeout(() => resumeFalGenerationPolling(), 500);`;
const DECORATION_OWNS_SAVE_TRUTH = `  if (typeof resumeFalGenerationPolling === "function")
    setTimeout(() => resumeFalGenerationPolling(), 500);
  setTimeout(() => {
    SAVED_PROJECT_BASELINE = structuredClone(P);
    SAVE_BLOCKED = false;
    setSaveState("saved", "Saved");
  }, 250);`;

function sourceMutator(editsByFile) {
  const edits = Array.isArray(editsByFile) ? { "app.js": editsByFile } : editsByFile;
  const applied = new Set();
  const mutate = (file, original) => {
    if (!edits[file]) return original;
    let code = original.replace(/\r\n/g, "\n");
    for (const [from, to] of edits[file]) {
      assert(code.includes(from), `negative control anchor no longer exists in ${file}; update the control rather than deleting it:\n${from}`);
      assert.strictEqual(code.split(from).length - 1, 1, `the anchor must be unique in ${file}:\n${from}`);
      const before = code;
      code = code.replace(from, to);
      assert.notStrictEqual(code, before, `the edit did not change ${file}`);
    }
    applied.add(file);
    return code;
  };
  mutate.applied = applied;
  return mutate;
}
async function expectRed(label, run) {
  try {
    await run();
  } catch (error) {
    if (error instanceof assert.AssertionError) return error.message.split("\n")[0];
    throw new Error(`${label}: the guard threw something that is not an assertion failure, so this is not a valid receipt:\n${error.stack || error.message}`);
  }
  throw new Error(`${label}: the guarded section PASSED with the defect reintroduced. The regression does not detect it.`);
}

/* NC-1's observation: with the binding uninstalled, does A's write-back really
   put a B save on the wire? */
async function observedForeignSave(mutate) {
  const server = twoProjectServer({ a: olderSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, olderSchemaProject("Project A"), { mutateSource: mutate });
  assert.strictEqual(read(context, "PENDING_SAVE_TRIGGERS.size"), 1, "NC-1 probe: the write-back must be queued");
  await context.switchProject(B);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  return server.writes;
}
/* NC-2's observation: with the identity installed during PREPARE, does A's
   document really reach B's URL at B's revision? */
async function observedForeignBody(mutate) {
  const server = twoProjectServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
  const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
  vm.runInContext(`P.meta.title = "Project A, mid-edit"; dirty();`, context);
  server.hold();
  vm.runInContext(`__switching = fetch("/api/projects/switch", { method: "POST", headers: {}, body: JSON.stringify({ slug: ${JSON.stringify(B)} }) }).then(() => load());`, context);
  await settle();
  await realDelay(AUTOSAVE_DEBOUNCE_MS + 250);
  const duringLoad = server.writes.slice();
  server.release();
  await read(context, "__switching");
  await settle();
  return duringLoad;
}
/* NC-4 and NC-5's observation: drive the SHIPPED completion path with an unsaved
   edit and report what happened to it, to the wire, and to the indicator. */
async function observedCompletionWithEdit(mutate) {
  const server = soloServer();
  const context = await openSolo(server, { mutateSource: mutate });
  vm.runInContext(`P.meta.title = "The filmmaker's unsaved title"; dirty();`, context);
  assert.strictEqual(read(context, "projectHasUnsavedEdits()"), true, "probe: the edit must start out unsaved");
  await context.refreshFalGeneration("job-1", false);
  await realDelay(PAST_BOTH_TIMERS_MS);
  await settle();
  const after = {
    title: read(context, "P.meta.title"),
    marks: marks(context),
    indicator: saveIndicator(context),
    writes: server.writes.slice(),
    stored: structuredClone(server.docs[A].meta),
  };
  /* And the proof that a lost edit is lost PERMANENTLY rather than merely late. */
  await vm.runInContext(`(async () => { P.meta.title = "a later edit"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
  await settle();
  after.laterWrites = server.writes.slice(after.writes.length);
  return after;
}

async function negativeControlsSection() {
  const controls = [];

  /* NC-1 — THE DEFERRED TRIGGER IS NOT BOUND TO ITS OPEN. F1 exactly: A's
     migration write-back survives the switch and saves whatever is open when it
     fires. */
  {
    const edits = [[REPAIRED_TRIGGER_BINDING, TRIGGER_WITHOUT_BINDING]];
    const mutate = sourceMutator(edits);
    const writes = await observedForeignSave(mutate);
    assert(mutate.applied.has("app.js"), "NC-1: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(writes.length, 1,
      `NC-1 probe: the defect must actually put one write on the wire, and it sent ${writes.length}: ${JSON.stringify(writes)}`);
    assert.strictEqual(writes[0].slug, B,
      `NC-1 probe: and that write must be addressed to project B, which received no edit: ${JSON.stringify(writes[0])}`);
    assert.strictEqual(writes[0].ifMatch, REV[B],
      "NC-1 probe: carrying B's revision — a save of B produced by work created for A");
    const detected = await expectRed("NC-1", () => deferredTriggerAcrossOpensSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-1", defect: "a deferred save trigger is not bound to the open that created it, so A's migration write-back saves B", detected });
  }

  /* NC-2 — PREPARE INSTALLS THE IDENTITY, exactly as the shipped load() did:
     the slug and revision move from the response while `P` is still the outgoing
     project and an await is still to come. A debounce dispatching there sends A's
     DOCUMENT to B's URL at B's revision. */
  {
    const edits = [[REPAIRED_PREPARE_IDENTITY, PREPARE_INSTALLS_IDENTITY]];
    const mutate = sourceMutator(edits);
    const writes = await observedForeignBody(mutate);
    assert(mutate.applied.has("app.js"), "NC-2: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(writes.length, 1,
      `NC-2 probe: the defect must actually dispatch inside the open, and it sent ${writes.length}: ${JSON.stringify(writes)}`);
    assert.strictEqual(writes[0].slug, B, "NC-2 probe: to project B's URL");
    assert.strictEqual(writes[0].title, "Project A, mid-edit",
      `NC-2 probe: carrying project A's OWN document — one project's record written over another's: ${JSON.stringify(writes[0])}`);
    assert.strictEqual(writes[0].ifMatch, REV[B], "NC-2 probe: authorised by B's revision");
    const detected = await expectRed("NC-2", () => debounceInsideTransitionSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-2", defect: "PREPARE installs the project identity before the record, so a debounce dispatching in the gap sends A's document as B", detected });
  }

  /* NC-3 — THE LEDGER READ IS MOVED BACK AFTER THE COMMIT, where it was: an
     await between installing the record and settling the baseline and the
     indicator. A refusal that lands in that window is overwritten with "Saved". */
  {
    const edits = [
      [REPAIRED_LEDGER_IN_PREPARE, LEDGER_AFTER_COMMIT],
      [REPAIRED_COMMIT_BASELINE, COMMIT_AWAITS_LEDGER],
    ];
    const mutate = sourceMutator(edits);
    /* Observed directly: a refusal, then the parked ledger landing on top of it. */
    let releaseLedger = () => {};
    const parked = new Promise((resolve) => { releaseLedger = resolve; });
    let ledgerRequests = 0;
    const server = refreshServer({
      a: currentSchemaProject("Project A"),
      b: currentSchemaProject("Project B"),
      replyForWrite: () => ({ status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["shots[0].dur must be a positive number"] } }),
      ledger: async (response) => {
        ledgerRequests += 1;
        if (ledgerRequests > 1) await parked;
        return response({ jobs: [], projectSlug: A });
      },
    });
    const withFal = async (url, requestOptions, response) => {
      if (url === "/api/config") return response({ generation: { fal: { enabled: true, apiKey: "test-key", keySource: "config" } } });
      return server.fetch(url, requestOptions, response);
    };
    const rendered = await render("#/production", currentSchemaProject("Project A"), { mutateSource: mutate, fetch: withFal });
    const context = rendered.context;
    assert(mutate.applied.has("app.js"), "NC-3: app.js was never evaluated, so the defect never ran");
    vm.runInContext(`__second = load({ intent: "refresh" });`, context);
    await settle();
    await vm.runInContext(`(async () => { P.meta.title = "an edit the server will not accept"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
    await settle();
    assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "NC-3 probe: the typed 422 must have paused saving");
    releaseLedger();
    await read(context, "__second").catch(() => {});
    await read(context, "__ledgerAfterCommit").catch(() => {});
    await settle();
    assert.strictEqual(saveIndicator(context), "Saved",
      `NC-3 probe: the defect must actually overwrite the refusal with a resting Saved, and the indicator reads ${JSON.stringify(saveIndicator(context))}`);
    assert.strictEqual(read(context, "SAVED_PROJECT_BASELINE").meta.title, "an edit the server will not accept",
      "NC-3 probe: with the refused document adopted as the saved baseline, so the view believes storage holds it");
    const detected = await expectRed("NC-3", () => ledgerParkedDuringPrepareSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-3", defect: "the generation-ledger read sits after the commit, so releasing it overwrites a real typed 422 and SAVE_BLOCKED with a resting Saved", detected });
  }

  /* NC-4 — THE COMPLETION PATH REPLACES INSTEAD OF REFRESHING and does not
     persist first, which is F3 as reproduced: the pending debounce is cancelled,
     the server's copy replaces `P`, and the indicator settles on "Saved" over an
     edit that was never sent anywhere. */
  {
    const edits = { "fal-generation.js": [
      [REPAIRED_PRE_INGEST_FLUSH, NO_PRE_INGEST_FLUSH],
      [REPAIRED_REFRESH_INTENT, REPLACEMENT_INTENT],
    ] };
    const mutate = sourceMutator(edits);
    const after = await observedCompletionWithEdit(mutate);
    assert(mutate.applied.has("fal-generation.js"), "NC-4: fal-generation.js was never evaluated, so the defect never ran");
    assert.notStrictEqual(after.title, "The filmmaker's unsaved title",
      `NC-4 probe: the defect must actually delete the edit from memory, and P still holds ${JSON.stringify(after.title)}`);
    assert.deepStrictEqual(after.writes, [],
      `NC-4 probe: and nothing may have carried it to the server: ${JSON.stringify(after.writes)}`);
    assert.notStrictEqual(after.stored.title, "The filmmaker's unsaved title", "NC-4 probe: storage must never have received it");
    assert.strictEqual(after.indicator, "Saved",
      `NC-4 probe: and the indicator must report Saved over the edit it just dropped, which is the silent part — it read ${JSON.stringify(after.indicator)}`);
    assert.strictEqual(after.laterWrites.length, 1,
      "NC-4 probe: a later edit saves normally, so the first one was permanently lost rather than merely delayed");
    const detected = await expectRed("NC-4", () => completionWithLocalEditSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-4", defect: "the completion path replaces the record without persisting first, so a same-project refresh silently deletes the filmmaker's unsaved edit", detected });
  }

  /* NC-5 — THE PRE-INGEST FLUSH ALONE IS REMOVED, leaving the refresh intent in
     place. The backstop holds — the edit is NOT lost — but the refresh has to
     decline, so the results it came to collect never reach the record. That is
     what makes the flush the fix rather than the guard. */
  {
    const edits = { "fal-generation.js": [[REPAIRED_PRE_INGEST_FLUSH, NO_PRE_INGEST_FLUSH]] };
    const mutate = sourceMutator(edits);
    const after = await observedCompletionWithEdit(mutate);
    assert(mutate.applied.has("fal-generation.js"), "NC-5: fal-generation.js was never evaluated, so the defect never ran");
    assert.strictEqual(after.title, "The filmmaker's unsaved title", "NC-5 probe: the backstop must still refuse to overwrite the edit");
    assert.deepStrictEqual(after.marks, [],
      `NC-5 probe: but the completion data must be missing, because the refresh declined: ${JSON.stringify(after.marks)}`);
    assert.notStrictEqual(after.indicator, "Saved", "NC-5 probe: and nothing claims to be saved");
    const detected = await expectRed("NC-5", () => completionWithLocalEditSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-5", defect: "without the pre-ingest flush the edit survives but the completion data cannot land, so both sides are never present", detected });
  }

  /* NC-6 — THE REFRESH IS NOT BOUND TO THE OPEN IT STARTED UNDER. An explicit
     switch to B is reversed by a read that started under A: the workspace shows A
     while every active-project route still answers as B. */
  {
    const edits = [[REPAIRED_OPEN_BINDING, ""]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const r1 = await beginParkedRefresh(server, context, "__refresh", "job-1");
    await context.switchProject(B);
    const afterSwitch = projectIdentity(context);
    assert.strictEqual(afterSwitch.slug, B, "NC-6 probe: the switch must have succeeded before the stale refresh returns");
    await releaseAndSettle(server, context, r1, "__refresh");
    const after = projectIdentity(context);
    assert(mutate.applied.has("app.js"), "NC-6: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(after.slug, A,
      `NC-6 probe: the defect must actually reinstall project A over the switch, and the slug is ${after.slug}`);
    assert.strictEqual(after.title, "Project A", "NC-6 probe: with A's record back on screen");
    assert.strictEqual(server.active, B,
      "NC-6 probe: while the server is still on B — which is the split identity this control exists to show");
    const detected = await expectRed("NC-6", () => staleRefreshAfterSwitchSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-6", defect: "a refresh is not bound to the open it started under, so one that outlived an explicit switch reinstalls the project the filmmaker left", detected });
  }

  /* NC-7 — THE REFRESH ORDER TOKEN IS REMOVED. Overlapping refreshes become
     response-order dependent: an older response landing after a newer commit
     rolls the record back, and the view rests on "Saved" a revision behind the
     server with nothing left in flight to correct it. */
  {
    const edits = [[REPAIRED_ORDER_CHECK, ""]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const r1 = await beginParkedRefresh(server, context, "__r1", "", "generic");
    server.serverSideIngest();
    const r2 = await beginParkedRefresh(server, context, "__r2", "", "generic");
    await releaseAndSettle(server, context, r2, "__r2");
    assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-1"', "NC-7 probe: R2 must have committed first");
    await releaseAndSettle(server, context, r1, "__r1");
    assert(mutate.applied.has("app.js"), "NC-7: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "PROJECT_REVISION"), '"rev-project-a-0"',
      `NC-7 probe: the defect must actually roll the client back to the older snapshot, and it is at ${read(context, "PROJECT_REVISION")}`);
    assert.deepStrictEqual(marks(context), [], "NC-7 probe: losing the server-side advance from the record on screen");
    assert.strictEqual(server.revisionOf(A), '"rev-project-a-1"', "NC-7 probe: while the server is a revision ahead");
    assert.strictEqual(saveIndicator(context), "Saved",
      "NC-7 probe: and the view rests on Saved over a record the server has moved past, which is the silent part");
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "NC-7 probe: with no conflict surface and nothing left in flight to correct it");
    const detected = await expectRed("NC-7", () => overlappingNewerThenOlderSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-7", defect: "the refresh order token is gone, so overlapping refreshes become response-order dependent and an older response rolls a newer commit back", detected });
  }

  /* NC-8 — A REFRESH PERFORMS THE FIRST-RUN REPLACEMENT TERMINAL. Answered 404,
     it clears the workspace behind a newer refresh that already committed — and
     with an unsaved edit in the tab, clearing `P` makes captureProjectSave()
     answer null so the debounce expires writing nothing. */
  {
    const edits = [[REPAIRED_REFRESH_MISS, REFRESH_MISS_ESCALATES]];

    /* NC-8a — the clean workspace is cleared into first-run. */
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    server.missNextProjectRead();
    const r1 = await beginParkedRefresh(server, context, "__r1", "job-1");
    const r2 = await beginParkedRefresh(server, context, "__r2", "job-2");
    await releaseAndSettle(server, context, r2, "__r2");
    const committed = workspaceState(context);
    assert.strictEqual(committed.revision, '"rev-project-a-2"', "NC-8 probe: R2 must have committed first");
    await releaseAndSettle(server, context, r1, "__r1");
    assert(mutate.applied.has("app.js"), "NC-8: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "P"), null,
      "NC-8 probe: the defect must actually clear the record out from under the committed refresh");
    assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), "", "NC-8 probe: and empty the active slug");
    assert.strictEqual(workspaceState(context).firstRun, true, "NC-8 probe: installing the first-run screen over an open project");
    assert.strictEqual(server.active, A, "NC-8 probe: and the server still has that project");

    /* NC-8b — and with unsaved work, the work is lost with nothing on the wire. */
    const mutateDirty = sourceMutator(edits);
    const dirtyServer = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const dirtyContext = await openFixture(dirtyServer, currentSchemaProject("Project A"), { mutateSource: mutateDirty });
    vm.runInContext(`P.meta.title = "unsaved when the read went missing"; dirty();`, dirtyContext);
    dirtyServer.missNextProjectRead();
    const d1 = await beginParkedRefresh(dirtyServer, dirtyContext, "__d1", "job-1", "generic");
    await releaseAndSettle(dirtyServer, dirtyContext, d1, "__d1");
    await realDelay(PAST_BOTH_TIMERS_MS);
    await settle();
    assert.strictEqual(read(dirtyContext, "P"), null, "NC-8 probe: the dirty record is cleared too");
    assert.deepStrictEqual(dirtyServer.writes, [],
      `NC-8 probe: and nothing is written, because captureProjectSave() answers null with no record — the authored work is simply gone: ${JSON.stringify(dirtyServer.writes)}`);
    assert.strictEqual(dirtyServer.docs[A].meta.title, "Project A", "NC-8 probe: storage never received it");
    assert.strictEqual(read(dirtyContext, "projectHasUnsavedEdits()"), false, "NC-8 probe: with nothing left to say anything was unsaved");

    const detected = await expectRed("NC-8", () => refreshMissAfterNewerCommitSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-8", defect: "a refresh answered 404 performs the first-run replacement terminal, clearing the workspace and losing unsaved authored work with nothing on the wire", detected });
  }

  /* NC-9 — A REFRESH WITH NO PROJECT BECOMES A REPLACEMENT. F9 exactly: the
     intent changes because runtime state did. */
  {
    const edits = [[REPAIRED_NO_PROJECT_GUARD, NO_PROJECT_BECOMES_REPLACEMENT]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const epochBefore = read(context, "PROJECT_OPEN_EPOCH");
    vm.runInContext(`P = null;`, context);
    await vm.runInContext(`load({ intent: "refresh" })`, context);
    await settle();
    assert(mutate.applied.has("app.js"), "NC-9: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH") > epochBefore, true,
      "NC-9 probe: the defect must actually turn the refresh into a replacement and advance the epoch");
    assert.strictEqual(read(context, "P") === null, false, "NC-9 probe: installing a project a refresh was never entitled to install");
    const detected = await expectRed("NC-9", () => refreshWithNoProjectSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-9", defect: "a refresh with no record falls through to the replacement lifecycle, so the requested intent changes because runtime state did", detected });
  }

  /* NC-10 — THE DIRTY-VIEW BACKSTOP IS REMOVED. An edit typed inside the
     round-trip is replaced by the server's copy. */
  {
    const edits = [[REPAIRED_DIRTY_CHECK, ""]];
    const mutate = sourceMutator(edits);
    const server = soloServer();
    const context = await openSolo(server, { mutateSource: mutate });
    const r1 = await beginParkedRefresh(server, context, "__completion", "job-1");
    vm.runInContext(`P.meta.title = "typed while the results were arriving"; dirty();`, context);
    await releaseAndSettle(server, context, r1, "__completion");
    assert(mutate.applied.has("app.js"), "NC-10: app.js was never evaluated, so the defect never ran");
    assert.notStrictEqual(read(context, "P.meta.title"), "typed while the results were arriving",
      "NC-10 probe: the defect must actually delete the edit typed inside the round-trip");
    assert.strictEqual(saveIndicator(context), "Saved",
      "NC-10 probe: and rest on Saved over it, which is the silent part");
    const detected = await expectRed("NC-10", () => dirtyDuringRefreshSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-10", defect: "the dirty-view backstop is gone, so a refresh replaces a record that became dirty while it was in flight", detected });
  }

  /* NC-11 — THE TRANSACTION'S TAIL IS GIVEN SOMETHING ASYNCHRONOUS TO FINISH,
     which is the shape the removed depth counter pretended to prevent and could
     not: a decoration step that comes back 250ms later and restates the save
     state from data the commit handed it. It lands on top of a refusal that
     arrived in the meantime — SAVE_BLOCKED cleared, the refused document adopted
     as the saved baseline, and the indicator resting on Saved over an edit the
     server explicitly would not write. */
  {
    const edits = [[REPAIRED_DECORATION_TAIL, DECORATION_OWNS_SAVE_TRUTH]];
    const mutate = sourceMutator(edits);
    const server = soloServer({
      replyForWrite: () => ({ status: 422, body: { ok: false, code: "PROJECT_VALIDATION_FAILED", error: "Project validation failed.", issues: ["shots[0].dur must be a positive number"] } }),
    });
    const context = await openSolo(server, { mutateSource: mutate });
    await vm.runInContext(`(async () => { P.meta.title = "refused while the decoration was queued"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
    await settle();
    assert(mutate.applied.has("app.js"), "NC-11: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "SAVE_BLOCKED"), true, "NC-11 probe: the typed 422 must have paused saving first");
    await realDelay(500);
    await settle();
    assert.strictEqual(read(context, "SAVE_BLOCKED"), false,
      "NC-11 probe: the defect must actually clear the save-blocked latch from the transaction's tail");
    assert.strictEqual(saveIndicator(context), "Saved",
      `NC-11 probe: and rest the indicator on Saved over an edit the server refused — it read ${JSON.stringify(saveIndicator(context))}`);
    assert.strictEqual(read(context, "SAVED_PROJECT_BASELINE").meta.title, "refused while the decoration was queued",
      "NC-11 probe: with the refused document adopted as the saved baseline, so the window believes storage holds it");
    const detected = await expectRed("NC-11", () => decorationCannotWriteSaveTruthSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-11", defect: "the transaction's tail is given asynchronous work that owns save truth, so a chrome helper clears a real refusal and reports Saved over it", detected });
  }

  /* NC-12 — THE RESPONSE-OWNER CHECK ALONE IS REMOVED, with the epoch binding
     left in place. Nothing about this window moved, so no staleness check can
     catch it: the ACTIVE PROJECT CHANGED SOMEWHERE ELSE — a second tab, another
     machine on the LAN — and the refresh adopts a document belonging to a project
     this window never opened, under the slug and revision of the one it did. */
  {
    const edits = [[REPAIRED_RESPONSE_OWNER, ""]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    await vm.runInContext(`fetch("/api/projects/switch", { method: "POST", headers: {}, body: JSON.stringify({ slug: ${JSON.stringify(B)} }) })`, context);
    assert.strictEqual(read(context, "ACTIVE_PROJECT_SLUG"), A, "NC-12 probe: this window must still believe it has A open");
    await vm.runInContext(`load({ intent: "refresh" })`, context);
    await settle();
    assert(mutate.applied.has("app.js"), "NC-12: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "P.meta.title"), "Project B",
      `NC-12 probe: the defect must actually install another project's document, and P holds ${JSON.stringify(read(context, "P.meta.title"))}`);
    assert.strictEqual(read(context, "PROJECT_OPEN_EPOCH"), 1,
      "NC-12 probe: with no replacement having happened — nothing about this window moved, so no staleness check could have caught it");
    assert.strictEqual(saveIndicator(context), "Saved",
      "NC-12 probe: and the indicator rests on Saved over a record from a project this window never opened");
    const detected = await expectRed("NC-12", () => refreshAnsweredForAnotherProjectSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-12", defect: "a refresh does not check the owner of the response, so a project switched elsewhere lands another project's document in this window", detected });
  }

  /* NC-13 — THE PREPARED SNAPSHOT'S FRESHNESS PRECONDITION IS REMOVED. Every
     other refusal passes: the epoch has not moved, the slugs agree, no later
     refresh has committed, and the window is CLEAN — because the write that
     overtook this snapshot was accepted. The R0 snapshot commits over R1 and the
     client silently rolls back to a document the server no longer has. */
  {
    const edits = [[REPAIRED_FRESHNESS, ""]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const R0 = server.revisionOf(A);
    server.holdNextScanRead();
    vm.runInContext(`__refresh = load({ intent: "refresh" });`, context);
    await settle();
    assert.strictEqual(server.parkedScanReads, 1, "NC-13 probe: the refresh must be parked holding an R0 snapshot");
    await vm.runInContext(`(async () => { P.meta.title = "authored and saved while the refresh was in flight"; dirty(); await flushPendingProjectSave(); await SAVE_CHAIN; })()`, context);
    await settle();
    const R1 = server.revisionOf(A);
    assert.notStrictEqual(R1, R0, "NC-13 probe: the accepted write must have moved the stored revision");
    assert.strictEqual(read(context, "PROJECT_REVISION"), R1, "NC-13 probe: and the client with it");
    server.releaseScanReads();
    await read(context, "__refresh");
    await settle();
    assert(mutate.applied.has("app.js"), "NC-13: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "PROJECT_REVISION"), R0,
      `NC-13 probe: the defect must actually roll the client back from R1 to R0, and it is at ${read(context, "PROJECT_REVISION")}`);
    assert.strictEqual(server.revisionOf(A), R1, "NC-13 probe: while the server is still at R1");
    assert.notStrictEqual(read(context, "P.meta.title"), "authored and saved while the refresh was in flight",
      "NC-13 probe: with the authored document gone from the screen");
    assert.strictEqual(server.docs[A].meta.title, "authored and saved while the refresh was in flight",
      "NC-13 probe: even though storage still holds it");
    assert.strictEqual(saveIndicator(context), "Saved",
      "NC-13 probe: and the indicator resting on Saved over a rollback, which is the silent part");
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "NC-13 probe: with no conflict surface and nothing left in flight to correct it");
    const detected = await expectRed("NC-13", () => preparedSnapshotFreshnessSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-13", defect: "a prepared snapshot is not checked for freshness, so one read before this window's own accepted write commits over it and rolls the record back from R1 to R0", detected });
  }

  /* NC-14 — THE COMPLETION INGEST DOES NOT DECLARE ITS DURABLE ADVANCE. Every
     other refusal passes: the epoch has not moved, the slugs agree, no later
     refresh has committed, the window is clean, and this window wrote nothing —
     so the save generation is unchanged and the pre-ingest snapshot looks fresh.
     With the completion's own follow-up refresh failing there is nothing left to
     correct it: the old R0 commits, the results the filmmaker paid for are
     missing from the screen while the server holds them, and the indicator rests
     on Saved. */
  {
    const edits = { "fal-generation.js": [[REPAIRED_COMPLETION_ADVANCE, COMPLETION_WITHOUT_ADVANCE]] };
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const R0 = server.revisionOf(A);
    const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");

    await beginScanParkedRefresh(server, context, "__old");
    server.failNextProjectRead();
    await vm.runInContext(`refreshFalGeneration("job-1", false)`, context);
    await settle();
    assert(mutate.applied.has("fal-generation.js"), "NC-14: fal-generation.js was never evaluated, so the defect never ran");
    const R1 = server.revisionOf(A);
    assert.notStrictEqual(R1, R0, "NC-14 probe: the ingest must have moved the stored revision");
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
      "NC-14 probe: the defect must actually leave the freshness generation unmoved by the ingest");

    const oldOutcome = await releaseScanParked(server, context, "__old");
    await realDelay(PAST_BOTH_TIMERS_MS);
    await settle();
    assert.strictEqual(oldOutcome.committed, true,
      `NC-14 probe: and the pre-ingest snapshot must actually commit: ${JSON.stringify(oldOutcome.reason)}`);
    assert.strictEqual(read(context, "PROJECT_REVISION"), R0,
      `NC-14 probe: leaving the client at R0 while the server is at R1 — it is at ${read(context, "PROJECT_REVISION")}`);
    assert.strictEqual(server.revisionOf(A), R1, "NC-14 probe: with the server unmoved");
    assert.deepStrictEqual(marks(context), [],
      "NC-14 probe: and the completion missing from the client entirely");
    assert.strictEqual(server.docs[A].meta.completionMarks.length, 1,
      "NC-14 probe: even though the server holds it");
    assert.strictEqual(saveIndicator(context), "Saved",
      "NC-14 probe: with the indicator resting on Saved over it, which is the silent part");
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "NC-14 probe: and no conflict surface to correct it");

    const detected = await expectRed("NC-14", () => completionFollowUpFailsSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-14", defect: "a completion ingest does not declare its durable advance, so a snapshot prepared before it commits over the result and the client silently loses the completion it paid for", detected });
  }

  /* NC-16 — THE CANCEL ROUTE SAYS IT WROTE AND THE BROWSER IGNORES IT. The
     coverage status the cancel committed is reinstalled from a snapshot prepared
     before it. */
  {
    const edits = { "fal-generation.js": [[REPAIRED_CANCEL_RESULT, CANCEL_RESULT_IGNORED]] };
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    server.setCancelWritesProject(true);
    const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
    await beginScanParkedRefresh(server, context, "__parked");
    await vm.runInContext(`cancelFalGeneration("job-1")`, context);
    await settle();
    assert(mutate.applied.has("fal-generation.js"), "NC-16: fal-generation.js was never evaluated, so the defect never ran");
    assert.strictEqual(server.docs[A].meta.coverageStatus, "cancelled", "NC-16 probe: the route must actually have written the project");
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
      "NC-16 probe: and the defect must actually leave that write undeclared");
    const outcome = await releaseScanParked(server, context, "__parked");
    assert.strictEqual(outcome.committed, true, "NC-16 probe: so the pre-cancel snapshot commits");
    assert.strictEqual(read(context, "P.meta.coverageStatus"), undefined,
      "NC-16 probe: reinstalling the pre-cancel coverage status over the cancelled one");
    assert.strictEqual(server.docs[A].meta.coverageStatus, "cancelled", "NC-16 probe: while storage still says cancelled");
    const detected = await expectRed("NC-16", () => cancelWithProjectWriteSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-16", defect: "the browser ignores what the cancel route says it wrote, so a snapshot prepared before the cancel reinstalls the pre-cancel coverage status", detected });
  }

  /* NC-17 — RECONCILE DECLARES A DURABLE ADVANCE IT DID NOT MAKE. The project
     document never changed, and a refresh reading the CURRENT record is thrown
     away for it — leaving the window behind for a change that never happened. */
  {
    const edits = { "fal-generation.js": [[REPAIRED_RECONCILE, RECONCILE_DECLARES_FALSELY]] };
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    server.serverSideIngest(A);
    const R1 = server.revisionOf(A);
    const R0 = read(context, "PROJECT_REVISION");
    assert.notStrictEqual(R0, R1, "NC-17 probe: the window starts behind a record it is entitled to read");
    const generationBefore = read(context, "PROJECT_SAVE_GENERATION");
    await beginScanParkedRefresh(server, context, "__parked");
    await vm.runInContext(`reconcileFalGeneration("job-1", "not-accepted")`, context);
    await settle();
    assert(mutate.applied.has("fal-generation.js"), "NC-17: fal-generation.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationBefore + 1,
      "NC-17 probe: the defect must actually declare an advance the project never received");
    assert.strictEqual(server.revisionOf(A), R1, "NC-17 probe: the stored revision is unmoved by the reconcile");
    const outcome = await releaseScanParked(server, context, "__parked");
    assert.strictEqual(outcome.committed, false,
      "NC-17 probe: so a refresh reading the CURRENT record is discarded");
    assert.strictEqual(read(context, "PROJECT_REVISION"), R0,
      "NC-17 probe: leaving the window stale at R0 while the server is at R1");
    assert.strictEqual(saveIndicator(context), "Saved", "NC-17 probe: and still saying Saved about it");
    const detected = await expectRed("NC-17", () => reconcileDeclaresNothingSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-17", defect: "reconcile declares a durable advance although it writes only the job ledger, discarding a refresh that was reading the current record", detected });
  }

  /* NC-18 — THE UNIVERSAL WATCH OBSERVES AND DOES NOTHING. The read still
     happens; the mismatch is simply not acted on. Nothing else in the browser can
     see a change made by a window it has never heard of, so the window sits at R0
     while the server is at R1, saying Saved, and stays there. */
  {
    const edits = [[REPAIRED_WATCH_ACTION, WATCH_OBSERVES_NOTHING]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const R0 = server.revisionOf(A);
    const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
    const R1 = server.foreignWrite(A, "changed by a window this one has never heard of");
    for (let tick = 0; tick < 3; tick += 1) await tickRevisionWatch(context);
    assert(mutate.applied.has("app.js"), "NC-18: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
      "NC-18 probe: the defect must actually leave the mismatch undeclared");
    assert.strictEqual(read(context, "PROJECT_REVISION"), R0,
      `NC-18 probe: leaving the client at R0 while the server is at R1 — it is at ${read(context, "PROJECT_REVISION")}`);
    assert.strictEqual(server.revisionOf(A), R1, "NC-18 probe: with the server unmoved");
    assert.notStrictEqual(read(context, "P.meta.title"), "changed by a window this one has never heard of",
      "NC-18 probe: and the other window's record never arriving");
    assert.strictEqual(saveIndicator(context), "Saved",
      "NC-18 probe: with the indicator resting on Saved over it — and three ticks prove it is STABLE, not merely slow");
    assert.strictEqual(read(context, "PROJECT_CONFLICT"), false, "NC-18 probe: with no conflict surface to correct it");
    const detected = await expectRed("NC-18", () => unknownWriterConvergenceSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-18", defect: "the universal revision watch observes a mismatch and does nothing, so a change by an unknown writer leaves the client stably at R0 saying Saved while the server is at R1", detected });
  }

  /* NC-19 — THE WATCH READS LIVE STATE INSTEAD OF WHAT IT CAPTURED. An answer
     about A, arriving after an explicit switch to B, is applied to B. */
  {
    const edits = [[REPAIRED_WATCH_BINDING, WATCH_READS_LIVE_STATE]];
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    server.foreignWrite(A, "A moved while this window was asking about it");
    server.holdNextRevisionRead();
    vm.runInContext(`__watch = watchProjectRevision();`, context);
    await settle();
    await context.switchProject(B);
    const afterSwitch = clientState(context);
    server.releaseRevisionReads();
    await read(context, "__watch");
    await settle();
    assert(mutate.applied.has("app.js"), "NC-19: app.js was never evaluated, so the defect never ran");
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), afterSwitch.saveGeneration + 1,
      "NC-19 probe: the defect must actually let A's late answer advance B's freshness");
    assert.notDeepStrictEqual(clientState(context), afterSwitch,
      "NC-19 probe: and perturb B's state with it");
    const detected = await expectRed("NC-19", () => revisionWatchAcrossSwitchSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-19", defect: "the revision watch reads live state instead of the owner and epoch it captured, so an answer about A is applied to B", detected });
  }

  /* NC-20 — THE AUTOMATION 502 THROWS BEFORE READING THE PAYLOAD, treating
     `!response.ok` as proof that project.json did not change. The immediate
     consequence is that a snapshot prepared before the write stays valid.

     AND THEN THE POINT OF V3: with the universal watch still enabled, the stale
     state is corrected anyway. The fast path buys immediacy; the watch provides
     completeness, and losing one does not lose the other. */
  {
    const edits = { "automation.js": [[REPAIRED_AUTOMATION_502, AUTOMATION_502_THROWS_FIRST]] };
    const mutate = sourceMutator(edits);
    const server = refreshServer({ a: currentSchemaProject("Project A"), b: currentSchemaProject("Project B") });
    const context = await openFixture(server, currentSchemaProject("Project A"), { mutateSource: mutate });
    const R0 = server.revisionOf(A);
    const generationAtOpen = read(context, "PROJECT_SAVE_GENERATION");
    await beginScanParkedRefresh(server, context, "__old");
    server.setRefreshFailsAfterWrite(true);
    await vm.runInContext(`v626RefreshFalJob("job-1").catch(() => null)`, context);
    await settle();
    assert(mutate.applied.has("automation.js"), "NC-20: automation.js was never evaluated, so the defect never ran");
    const R1 = server.revisionOf(A);
    assert.notStrictEqual(R1, R0, "NC-20 probe: the route must actually have committed before failing");
    assert.strictEqual(read(context, "PROJECT_SAVE_GENERATION"), generationAtOpen,
      "NC-20 probe: and the defect must actually leave that write undeclared");
    const oldOutcome = await releaseScanParked(server, context, "__old");
    assert.strictEqual(oldOutcome.committed, true,
      "NC-20 probe: so the snapshot prepared before the write is still treated as valid");
    assert.strictEqual(read(context, "PROJECT_REVISION"), R0, "NC-20 probe: leaving the window at R0");

    /* THE COMPLETENESS HALF. Nothing was taught about this route; the revision
       simply disagrees, and one tick is enough. */
    await tickRevisionWatch(context);
    assert.strictEqual(read(context, "PROJECT_REVISION"), R1,
      "NC-20 probe: and the universal watch corrects it anyway — the fast path is immediacy, not correctness");
    assert.strictEqual(saveIndicator(context), "Saved", "NC-20 probe: truthfully");

    const detected = await expectRed("NC-20", () => automationRefreshFailureWritesSection({ mutateSource: sourceMutator(edits) }));
    controls.push({ id: "NC-20", defect: "the automation refresh throws on 502 before reading projectUpdated, so a durable write goes undeclared — recovered by the universal watch, which is why it is immediacy and not correctness", detected });
  }

  console.log("Project load transaction negative controls");
  for (const row of controls) console.log(`  ${row.id} - ${row.defect}\n        detected: ${row.detected}`);
  assert.strictEqual(controls.length, 19, "every declared control must have produced a receipt");
  return controls.length;
}

const SECTIONS = [
  refreshWithNoProjectSection,
  refreshAnsweredForAnotherProjectSection,
  ledgerParkedDuringPrepareSection,
  decorationCannotWriteSaveTruthSection,
  preparedSnapshotFreshnessSection,
  parkedRefreshWithoutSaveSection,
  refreshCommitDoesNotBreakFreshnessSection,
  completionAdvancesFreshnessSection,
  completionFollowUpFailsSection,
  completionForLeftProjectSection,
  overlappingCompletionIngestsSection,
  unknownWriterConvergenceSection,
  unknownReaperJobSection,
  staleSnapshotAfterWatchSection,
  staleCommitThenWatchSection,
  dirtyWindowMismatchSection,
  blockedWindowMismatchSection,
  saveInFlightWatchSection,
  revisionReadFailureSection,
  noChangeWatchSection,
  revisionWatchAcrossSwitchSection,
  automationRefreshFailureWritesSection,
  cancelWithoutProjectWriteSection,
  cancelWithProjectWriteSection,
  cancelForLeftProjectSection,
  reconcileDeclaresNothingSection,
  workspaceMigrationOwnerSection,
  deferredTriggerAcrossOpensSection,
  triggerBeforeSwitchSection,
  debounceInsideTransitionSection,
  repeatedSwitchSection,
  blockedThenSwitchSection,
  currentSchemaControlSection,
  completionWithLocalEditSection,
  completionWithoutLocalEditSection,
  completionDuringSaveSection,
  completionWhileBlockedSection,
  repeatedCompletionsSection,
  automationCompletionSection,
  dirtyDuringRefreshSection,
  explicitReopenSection,
  staleRefreshAfterSwitchSection,
  heldRefreshWithoutSwitchSection,
  staleRefreshAfterSwitchBackSection,
  repeatedStaleRefreshSection,
  automationStaleRefreshSection,
  overlappingOlderThenNewerSection,
  overlappingNewerThenOlderSection,
  overlappingThreeRefreshesSection,
  newerRefreshFailedSection,
  overlappingRefreshesThenSwitchSection,
  dirtyBetweenRefreshCommitsSection,
  overlappingAutomationRefreshSection,
  refreshMissAfterNewerCommitSection,
  refreshMissWhileDirtySection,
  refreshMissAcrossReplacementSection,
  explicitOpenOfMissingProjectSection,
  refreshFailureNonDestructiveSection,
];

async function main() {
  console.log("Project load transaction - PREPARE, VALIDATE, COMMIT");
  intentIsStructuralSection();
  commitIsAwaitFreeSection();
  durableAdvanceIsSharedSection();
  for (const section of SECTIONS) await section();
  const controls = await negativeControlsSection();
  console.log(`Project load transaction passed - ${SECTIONS.length + 2} claims proven and ${controls} reintroduced defects detected. Provider calls made: 0.`);
}

module.exports = { main, SECTIONS, intentIsStructuralSection, commitIsAwaitFreeSection };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
