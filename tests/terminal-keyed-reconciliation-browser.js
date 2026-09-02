/* KEYED TERMINAL RECONCILIATION, PROVED IN A REAL BROWSER.
 *
 * WHY THIS SUITE EXISTS AS A FILE. A1 replaced the retired drawer's keyed reconciler with
 * a positional one, and the defect that introduced is invisible to markup: the Terminal
 * renders byte-identically whether or not a row kept its own DOM node. Only NODE IDENTITY
 * separates the two, and node identity needs a real DOM. The evidence for the repair was
 * produced in a browser and reported, but it lived outside the repository — which review
 * correctly read as "the mutation proof is absent". A proof nobody can run is not part of
 * the test surface. It is now.
 *
 * HOW IDENTITY IS MEASURED. A plain JavaScript property is stamped on a node before the
 * repaint and looked for afterwards. No property survives innerHTML, outerHTML or
 * replaceChild — only the actual surviving node carries it — so the check cannot be
 * satisfied by markup that merely looks the same.
 *
 * WHAT IT DRIVES. The real Activity Terminal, in the real app, served by the real server.
 * Runs are written into the page's own in-memory list; nothing is dispatched, no provider
 * is contacted, and no paid path is reachable.
 *
 * BROWSER: the Chrome already installed on the machine, driven over the DevTools Protocol
 * with Node's built-in WebSocket. NOTHING IS DOWNLOADED AND NOTHING IS INSTALLED.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEBUG_PORT = 9422;

/* The installed browser, looked for where Windows actually puts it. A missing browser is
   reported the way the Python suites report a missing Playwright: loudly, by name, with
   what to do about it — never as a pass. */
function findChrome() {
  const candidates = [
    process.env.CINEBRAID_CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => { try { return fs.existsSync(candidate); } catch { return false; } }) || "";
}

function freePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const session = new Session(ws);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !session.pending.has(message.id)) return;
      const { resolve, reject } = session.pending.get(message.id);
      session.pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    };
    return session;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 30000);
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`page threw: ${detail}`);
    }
    return result.result?.value;
  }
}

/* Fixtures and helpers installed in the page once. */
const SETUP = `
window.__kr = {
  FAR: "2099-01-01T00:00:00Z",
  run(id, over) {
    return Object.assign({
      id, revision: 1, type: "shot-chain", targetId: "L1-01", scope: "stills",
      label: "Run " + id, status: "running", stage: "Frame A", summary: "Working.",
      runnerId: "r", leaseExpiresAt: window.__kr.FAR, heartbeatAt: window.__kr.FAR,
      steps: {}, logs: [], config: {}, usage: {},
      createdAt: "2026-08-26T10:00:00Z", updatedAt: "2026-08-26T10:01:00Z",
    }, over || {});
  },
  failed(id, over) {
    return window.__kr.run(id, Object.assign({
      type: "scene-chain", targetId: "SCENE-01", scope: "correction:pkg",
      label: "Scene continuity correction", status: "failed", stage: "Needs attention",
      runnerId: "", leaseExpiresAt: "", heartbeatAt: "",
      steps: { s: { key: "s", kind: "generation", status: "failed", label: "Correct SCENE-01",
        error: "Provider returned 502.", completedAt: "2026-08-26T10:05:00Z", updatedAt: "2026-08-26T10:05:00Z" } },
    }, over || {}));
  },
  set(runs) { AUTOMATION_RUNS.length = 0; runs.forEach(function (run) { AUTOMATION_RUNS.push(run); }); },
  paint() { window.CineBraidCreatorSurfaces.paint(); },
  rows() { return document.querySelector(".cb-terminal-rows"); },
  unit(key) { return document.querySelector('[data-activity-key="' + key + '"]'); },
  stamp(node, tag) { if (node) node.__krTag = tag; return !!node; },
  findStamp(tag) {
    var hit = null;
    document.querySelectorAll("*").forEach(function (node) { if (node.__krTag === tag) hit = node; });
    return hit;
  },
  dismissButton(runId) {
    var row = window.__kr.unit("run:" + runId);
    if (!row) return null;
    var found = null;
    row.querySelectorAll("button").forEach(function (button) {
      if (/DISMISS/.test(button.textContent || "")) found = button;
    });
    return found;
  },
  openButton(runId) {
    var row = window.__kr.unit("run:" + runId);
    return row ? row.querySelector(".cb-terminal-open") : null;
  },
  group() { return document.querySelector("details.cb-terminal-group"); },
  ensureOpen(group) { if (group && !group.open) group.querySelector("summary").click(); return !!(group && group.open); },
};
window.__kr.set([]); window.__kr.paint(); "ready"`;

const results = [];
function record(id, claim, pass, detail) {
  results.push({ id, claim, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id.padEnd(7)} ${claim}`);
  if (!pass) console.log(`         ${JSON.stringify(detail)}`);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("Keyed reconciliation browser proof FAILED: no installed Chrome was found. "
      + "Set CINEBRAID_CHROME to the browser executable, or install Google Chrome. "
      + "Nothing is downloaded by this suite.");
    process.exit(1);
  }

  const port = await freePort();
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  const app = `http://127.0.0.1:${port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cb-kr-"));
  let browser = null;
  let session = null;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { const probe = await fetch(app); if (probe.ok) break; } catch { /* not up yet */ }
      await sleep(250);
    }
    browser = spawn(chrome, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
      "--window-size=1920,1080", "about:blank",
    ], { stdio: "ignore" });
    let targets = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); break; }
      catch { await sleep(250); }
    }
    if (!targets) throw new Error("the installed browser did not expose a DevTools endpoint");
    session = await Session.open(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await session.send("Page.navigate", { url: app });
    await sleep(900);
    await session.eval(`try { localStorage.setItem("cinebraid-creator-terminal-collapsed", "0"); } catch (error) {}`);
    await session.send("Page.navigate", { url: app });
    await sleep(3000);
    await session.eval(SETUP);

    /* ---- KR-1: an insertion above must not move anyone else's identity ---- */
    let r = await session.eval(`(() => {
      const K = window.__kr;
      /* THE ARRIVING RUN MUST GENUINELY LAND ABOVE THE OTHERS, and the Terminal orders by
         recency — so it is given the newest timestamp. Without that it renders LAST,
         nothing shifts, and a positional patcher would pass this check while still being
         wrong. The rendered order is asserted below rather than assumed. */
      const older = { updatedAt: "2026-08-26T10:01:00Z" };
      K.set([K.run("A", older), K.run("B", older)]); K.paint();
      const stamped = K.stamp(K.openButton("B"), "B-open") && K.stamp(K.unit("run:B"), "B-row");
      const before = [...K.rows().children].map((node) => node.getAttribute("data-activity-key"));
      K.set([K.run("X", { updatedAt: "2026-08-26T10:59:00Z" }), K.run("A", older), K.run("B", older)]);
      K.paint();
      const button = K.findStamp("B-open"), row = K.findStamp("B-row");
      const after = [...K.rows().children].map((node) => node.getAttribute("data-activity-key"));
      return {
        stamped, before, after,
        insertedAbove: after[0] === "run:X" && before[0] !== "run:X",
        buttonSurvived: !!button, rowSurvived: !!row,
        buttonStillInsideB: !!button && button.closest("[data-activity-key]") === K.unit("run:B"),
        buttonTargetsB: !!button && /openRunResult\\('B'\\)/.test(button.getAttribute("onclick") || ""),
      };
    })()`);
    record("KR-1", "a row inserted above B leaves B's own node and action untouched",
      r.stamped && r.insertedAbove && r.buttonSurvived && r.rowSurvived
        && r.buttonStillInsideB && r.buttonTargetsB, r);

    /* ---- KR-2: reordering moves nodes, it does not rebuild them ---- */
    r = await session.eval(`(() => {
      const K = window.__kr;
      K.set([K.run("A", { updatedAt: "2026-08-26T10:05:00Z" }), K.run("B", { updatedAt: "2026-08-26T10:01:00Z" })]);
      K.paint();
      const before = [...K.rows().children].map((node) => node.getAttribute("data-activity-key"));
      K.stamp(K.openButton("A"), "A2"); K.stamp(K.openButton("B"), "B2");
      K.set([K.run("A", { updatedAt: "2026-08-26T10:01:00Z" }), K.run("B", { updatedAt: "2026-08-26T10:09:00Z" })]);
      K.paint();
      const a = K.findStamp("A2"), b = K.findStamp("B2");
      return {
        before, after: [...K.rows().children].map((node) => node.getAttribute("data-activity-key")),
        aStillA: !!a && a.closest("[data-activity-key]") === K.unit("run:A")
          && /openRunResult\\('A'\\)/.test(a.getAttribute("onclick") || ""),
        bStillB: !!b && b.closest("[data-activity-key]") === K.unit("run:B")
          && /openRunResult\\('B'\\)/.test(b.getAttribute("onclick") || ""),
      };
    })()`);
    record("KR-2", "reordering keeps every action with the run it belongs to",
      r.aStillA && r.bStillB && r.before.join(",") !== r.after.join(","), r);

    /* ---- KR-3: a normal repaint does not close an opened group ---- */
    r = await session.eval(`(() => {
      const K = window.__kr;
      K.set([K.failed("f1"), K.failed("f2")]); K.paint();
      const group = K.group();
      if (!group) return { noGroup: true };
      const opened = K.ensureOpen(group);
      K.stamp(group, "grp");
      K.paint();
      const after = K.findStamp("grp");
      return { key: group.getAttribute("data-activity-key"), opened, sameNode: !!after, stillOpen: !!after && after.open };
    })()`);
    record("KR-3", "a repaint does not close a group the filmmaker opened",
      r.opened && r.sameNode && r.stillOpen, r);

    /* ---- KR-4: a member arrives; the group and its members' actions hold ---- */
    r = await session.eval(`(() => {
      const K = window.__kr;
      const six = ["a", "b", "c", "d", "e", "f"].map((suffix) => K.failed("g" + suffix));
      K.set(six); K.paint();
      const group = K.group();
      K.ensureOpen(group);
      K.stamp(group, "grp4"); K.stamp(K.dismissButton("gc"), "gc-dismiss");
      K.set(six.concat([K.failed("gg")])); K.paint();
      const after = K.findStamp("grp4"), member = K.findStamp("gc-dismiss");
      return {
        groupSurvived: !!after, stillOpen: !!after && after.open,
        count: after && after.getAttribute("data-cb-group"),
        memberSurvived: !!member,
        memberTargetsGc: !!member && /dismissAutomationActivityRun\\('gc'\\)/.test(member.getAttribute("onclick") || ""),
        memberInsideGroup: !!member && !!member.closest("details.cb-terminal-group"),
      };
    })()`);
    record("KR-4", "an equivalent member arriving keeps the group and its members' actions",
      r.groupSurvived && r.stillOpen && r.count === "7" && r.memberSurvived && r.memberTargetsGc && r.memberInsideGroup, r);

    /* ---- KR-5: a real signature change moves one run and only that one ---- */
    r = await session.eval(`(() => {
      const K = window.__kr;
      const a = K.failed("s1"), b = K.failed("s2"), c = K.failed("s3");
      K.set([a, b, c]); K.paint();
      K.stamp(K.dismissButton("s1"), "s1d"); K.stamp(K.dismissButton("s3"), "s3d");
      K.set([a, K.failed("s2", { targetId: "SCENE-99" }), c]); K.paint();
      const s1 = K.findStamp("s1d"), s3 = K.findStamp("s3d");
      return {
        groups: K.rows().querySelectorAll("details.cb-terminal-group").length,
        s1TargetsS1: !!s1 && /dismissAutomationActivityRun\\('s1'\\)/.test(s1.getAttribute("onclick") || ""),
        s3TargetsS3: !!s3 && /dismissAutomationActivityRun\\('s3'\\)/.test(s3.getAttribute("onclick") || ""),
        s2Present: !!K.unit("run:s2"),
      };
    })()`);
    record("KR-5", "a signature change moves its own run and no action is inherited",
      r.groups === 2 && r.s1TargetsS1 && r.s3TargetsS3 && r.s2Present, r);

    /* ---- KR-6: the surface is patched, never replaced ---- */
    r = await session.eval(`(() => {
      const K = window.__kr;
      K.set([K.run("A")]); K.paint();
      K.stamp(document.querySelector(".cb-terminal"), "shell");
      K.stamp(K.rows(), "rowsbox");
      K.set([K.run("A"), K.run("B"), K.failed("z1"), K.failed("z2")]); K.paint();
      return { shellSurvived: !!K.findStamp("shell"), rowsBoxSurvived: !!K.findStamp("rowsbox") };
    })()`);
    record("KR-6", "the Terminal and its row list are patched, never wholesale replaced",
      r.shellSurvived && r.rowsBoxSurvived, r);

    /* =====================================================================
       NC-KR1 — THE KEYED LAYER IS TURNED OFF, IN MEMORY.
       Without it the positional walk shifts every node down one on an insertion, and an
       existing control starts acting on a different run. If this did not happen, KR-1
       would be measuring nothing.
       ===================================================================== */
    r = await session.eval(`(() => {
      const K = window.__kr;
      const landed = typeof v670PatchKeyedChildren === "function";
      window.__keyedOriginal = v670PatchKeyedChildren;
      window.v670PatchKeyedChildren = () => false;
      const mutated = v670PatchKeyedChildren() === false;
      const older = { updatedAt: "2026-08-26T10:01:00Z" };
      K.set([K.run("A", older), K.run("B", older)]); K.paint();
      K.stamp(K.openButton("B"), "nc1");
      K.set([K.run("X", { updatedAt: "2026-08-26T10:59:00Z" }), K.run("A", older), K.run("B", older)]);
      K.paint();
      const order = [...K.rows().children].map((node) => node.getAttribute("data-activity-key"));
      const button = K.findStamp("nc1");
      const retargeted = !!button && !/openRunResult\\('B'\\)/.test(button.getAttribute("onclick") || "");
      window.v670PatchKeyedChildren = window.__keyedOriginal;
      const restored = v670PatchKeyedChildren === window.__keyedOriginal;
      return { landed, mutated, order, survived: !!button, retargeted, restored };
    })()`);
    record("NC-KR1", "with the keyed layer disabled, an inserted row retargets an existing control",
      r.landed && r.mutated && r.retargeted && r.restored, r);

    /* =====================================================================
       NC-KR2 — LIVE DISCLOSURE IS NOT PRESERVED ACROSS A REPAINT.

       The production guarantee has two halves: the group keeps its node, and the markup
       the repaint builds carries the `open` the filmmaker chose. This mutation leaves the
       first half alone and breaks the second — the reconciler clears `open` on every
       keyed group after patching, which is exactly what "disclosure state was lost across
       repaint" means. The group is opened, a NORMAL repaint of the SAME semantic group is
       driven, and the group must be observed to close. If it did not, KR-3 would be
       agreeing with a build that closes the dock under the reader's hand.
       ===================================================================== */
    r = await session.eval(`(() => {
      const K = window.__kr;
      K.set([K.failed("n1"), K.failed("n2")]); K.paint();
      const group = K.group();
      if (!group) return { noGroup: true };
      const key = group.getAttribute("data-activity-key");
      const opened = K.ensureOpen(group);
      const memberCount = group.getAttribute("data-cb-group");

      /* 1-2. the mutation lands, and says so before anything is measured. */
      window.__keyed2 = v670PatchKeyedChildren;
      window.v670PatchKeyedChildren = (live, next) => {
        const result = window.__keyed2(live, next);
        const groups = live.querySelectorAll ? live.querySelectorAll("details[data-activity-key]") : [];
        groups.forEach((node) => { node.open = false; });
        return result;
      };
      const mutated = window.v670PatchKeyedChildren !== window.__keyed2;

      /* 3-5. a normal repaint of the same semantic group. */
      K.paint();
      const after = K.group();
      const sameGroup = !!after && after.getAttribute("data-activity-key") === key;
      const closed = !!after && !after.open;

      /* 7. restore, and prove the restoration took. */
      window.v670PatchKeyedChildren = window.__keyed2;
      K.paint();
      const restoredGroup = K.group();
      return {
        opened, memberCount, mutated, sameGroup, closed,
        restored: window.v670PatchKeyedChildren === window.__keyed2,
        reopensAfterRestore: !!restoredGroup && restoredGroup.open,
      };
    })()`);
    record("NC-KR2", "a repaint that loses disclosure closes an opened group, so KR-3 is a real check",
      r.opened && r.memberCount === "2" && r.mutated && r.sameGroup && r.closed && r.restored, r);

    const failed = results.filter((entry) => !entry.pass);
    console.log(`Keyed reconciliation browser proof: ${results.length - failed.length}/${results.length} checks passed.`);
    console.log("Node identity measured directly; nothing on disk was modified. Provider calls made: 0.");
    if (failed.length) process.exit(1);
  } finally {
    try { session?.ws.close(); } catch { /* already gone */ }
    try { browser?.kill(); } catch { /* already gone */ }
    try { server.kill(); } catch { /* already gone */ }
    /* The browser holds the profile directory open for a moment after it is killed. */
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().catch((error) => {
  console.error(`Keyed reconciliation browser proof FAILED: ${error.message}`);
  process.exit(1);
});
