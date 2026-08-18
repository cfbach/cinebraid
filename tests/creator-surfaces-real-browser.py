#!/usr/bin/env python3
"""O3 — the Assistant rail and the Activity Terminal, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. Everything semantic about O3 is proven in Node by
tests/creator-state.js: the projection, the buckets, the cost populations, the history
policy, and the structural fact that neither renderer can reach a run. Six claims cannot
be proven there, and they are the six a filmmaker would actually notice:

  * BOTH SURFACES MOUNT into the O2 slots and paint the real production's state.
  * NODE IDENTITY. "The rail is the same node after a stage change" is a statement about
    object identity in a live document. FakeElement neither parses HTML nor tracks it.
  * THE DOCK NEVER GROWS THE PAGE, whatever volume of activity it holds — and the space
    it covers is really given back, which is arithmetic over rendered geometry.
  * THE DRAWER AND THE TERMINAL AGREE, run for run, in the same page at the same moment.
  * THE LIFECYCLE. Retained-but-not-painted on Settings, restored on return.
  * NO HORIZONTAL OVERFLOW at four widths with both surfaces populated.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because an identity check that cannot fail is
worth nothing:

  N1 rebuilds the rail per stage the way a stage-owned Assistant would, and requires the
     identity assertion to catch it.
  N2 unbinds the dock's height with the Terminal full, and requires the page-growth
     arithmetic to catch it.
  N3 replaces the Terminal's status table in the running page so an approval gate reads
     RUNNING, and requires the drawer/Terminal agreement check to catch it.
  N4 makes the Terminal print an unknown cost as $0.00, and requires the money check to
     catch it.

THE FIXTURE IS SEEDED ON DISK, not injected into the page: the runs and jobs below are
written into a disposable project and read back through the real server, so what the
surfaces classify is a record the writers really persist rather than a shape invented by
the test.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Creator Assistant and Activity Terminal real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-01"
PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []

# THE RAIL HAS THREE STATES, and this list walks every boundary between them. The
# centre is `viewport - 220 - railWidth` and must never drop below CENTRE_FLOOR, which
# is the width the app's own component rules stack at; below it the centre enters a band
# nothing in the stylesheet was laid out for. So the rail narrows before it disappears:
#
#   >= 1460   full, 340px
#   1360-1459 compact, 240px  <- 1366 and 1440 live here, and they are ordinary laptops
#   < 1360    hidden
#
# `expected_rail` is asserted rather than merely recorded, so a stylesheet edit that
# quietly changes which band a common laptop falls into fails here.
CENTRE_FLOOR = 900
VIEWPORTS = [
    ("large desktop", 1920, 1080, 340),
    ("desktop", 1600, 1000, 340),
    ("full-rail floor", 1460, 900, 340),
    ("laptop", 1440, 900, 240),
    ("small laptop", 1366, 900, 240),
    ("compact floor", 1360, 900, 240),
    ("below the rail", 1280, 900, 0),
    ("narrow laptop", 1180, 800, 0),
    ("tablet", 900, 1024, 0),
    ("mobile", 390, 844, 0),
]


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def iso(offset):
    return (datetime.now(timezone.utc) + timedelta(seconds=offset)).isoformat().replace("+00:00", "Z")


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-creator-surfaces-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = next(projects_root.iterdir())


def step(**over):
    row = {"key": "", "kind": "", "status": "pending", "label": "", "attempt": 0, "retryCount": 0,
           "maxAttempts": 0, "buildId": "", "packageId": "", "childJobId": "", "frameId": "", "stateId": "",
           "files": [], "winner": "", "score": None, "pass": None, "review": None, "revision": "",
           "result": None, "activity": None, "error": "", "startedAt": "", "completedAt": "", "updatedAt": ""}
    row.update(over)
    row["operationKey"] = row["key"]
    return row


# One run per state the two surfaces have to tell apart, in the shapes the writers really
# persist: a leased runner, a run parked at a human gate, a run whose tab closed and
# whose lease lapsed, a failure, and a completion.
RUNS = [
    {"id": "o3-live", "revision": 1, "type": "shot-chain", "targetId": SHOT, "scope": "stills",
     "label": "Frame automation", "status": "running", "stage": "Generating Frame A", "summary": "",
     "createdAt": iso(-140), "updatedAt": iso(-20), "completedAt": "",
     "runnerId": "runner-alive", "leaseAcquiredAt": iso(-140), "leaseExpiresAt": iso(900), "heartbeatAt": iso(-20),
     "current": {"stepKey": "generate"}, "config": {"maxImages": 21}, "usage": {},
     "steps": {"generate": step(key="generate", kind="generation", status="running", label="Generate Frame A",
                                attempt=2, maxAttempts=3, retryCount=1, childJobId="job-live",
                                startedAt=iso(-140), updatedAt=iso(-20))},
     "logs": []},
    {"id": "o3-wait", "revision": 2, "type": "shot-chain", "targetId": "SAMPLE-02", "scope": "stills",
     "label": "Frame review", "status": "awaiting-review", "stage": "Approve Frame A", "summary": "",
     "createdAt": iso(-600), "updatedAt": iso(-540), "completedAt": "", "runnerId": "", "leaseExpiresAt": "",
     "current": {"stepKey": "review"}, "config": {"maxImages": 21}, "usage": {},
     "steps": {"review": step(key="review", kind="frame-review", status="needs-review", label="Frame A review",
                              attempt=1, maxAttempts=2, frameId="frame-a",
                              startedAt=iso(-600), completedAt=iso(-540), updatedAt=iso(-540))},
     "logs": []},
    {"id": "o3-orphan", "revision": 1, "type": "shot-chain", "targetId": "SAMPLE-03", "scope": "stills",
     "label": "Abandoned by a closed tab", "status": "running", "stage": "Generating", "summary": "",
     "createdAt": iso(-3000), "updatedAt": iso(-2400), "completedAt": "",
     "runnerId": "runner-that-went-away", "leaseAcquiredAt": iso(-3000), "leaseExpiresAt": iso(-1200),
     "heartbeatAt": iso(-2400), "current": {"stepKey": "generate"}, "config": {"maxImages": 21}, "usage": {},
     "steps": {"generate": step(key="generate", kind="generation", status="running", label="Generate Frame A",
                                startedAt=iso(-3000), updatedAt=iso(-2400))},
     "logs": []},
    {"id": "o3-failed", "revision": 1, "type": "scene-chain", "targetId": "SC-01", "scope": "correction:pkg",
     "label": "Scene correction", "status": "failed", "stage": "Needs attention", "summary": "Correction failed.",
     "createdAt": iso(-4000), "updatedAt": iso(-3900), "completedAt": "", "runnerId": "", "leaseExpiresAt": "",
     "current": {"stepKey": "generate"}, "config": {"maxImages": 9}, "usage": {},
     "steps": {"generate": step(key="generate", kind="generation", status="failed", label="Generate correction",
                                error="The provider declined the request.",
                                startedAt=iso(-4000), updatedAt=iso(-3900))},
     "logs": []},
    {"id": "o3-done", "revision": 1, "type": "shot-chain", "targetId": "SAMPLE-04", "scope": "stills",
     "label": "Completed frame run", "status": "completed", "stage": "Done", "summary": "",
     "createdAt": iso(-9000), "updatedAt": iso(-8800), "completedAt": iso(-8800),
     "runnerId": "", "leaseExpiresAt": "", "current": {}, "config": {"maxImages": 21}, "usage": {},
     "steps": {}, "logs": []},
]

# One job per cost population, plus the run-owned job whose provider facts belong to its
# run's row and which must therefore NOT appear as a row of its own.
JOBS = [
    {"id": "job-live", "provider": "fal", "model": "fal-ai/gpt-image-2", "mode": "text-to-image",
     "purpose": "frame", "status": "IN_QUEUE", "externalId": "req-abc123", "queuePosition": 3,
     "shotId": SHOT, "outputCount": 2, "createdAt": iso(-130), "updatedAt": iso(-20),
     "accounting": {"costClass": "metered_api",
                    "estimate": {"costClass": "metered_api", "unit": "usd", "confidence": "estimated", "amount": 0.08}}},
    {"id": "job-priced", "provider": "fal", "model": "fal-ai/gpt-image-2", "mode": "edit",
     "purpose": "blocking", "status": "COMPLETED", "externalId": "req-def456", "shotId": SHOT,
     "outputCount": 2, "createdAt": iso(-700), "updatedAt": iso(-650), "ingestedAt": iso(-650),
     "accounting": {"costClass": "metered_api",
                    "estimate": {"costClass": "metered_api", "unit": "usd", "confidence": "estimated", "amount": 0.16}}},
    {"id": "job-unpriced", "provider": "fal", "model": "fal-ai/minimax-hailuo-h3", "mode": "i2v",
     "purpose": "motion-h3", "status": "COMPLETED", "externalId": "req-ghi789", "shotId": SHOT,
     "outputCount": 1, "createdAt": iso(-800), "updatedAt": iso(-780), "ingestedAt": iso(-780),
     "accounting": {"costClass": "metered_api",
                    "estimate": {"costClass": "metered_api", "unit": "usd", "confidence": "unknown"},
                    "basis": {"unitBasis": "video", "quantity": 1, "ratePerUnit": None, "rateSource": None,
                              "unpricedReason": "no-per-image-rate-for-this-output"}}},
    {"id": "job-legacy", "provider": "fal", "purpose": "frame", "status": "COMPLETED", "shotId": SHOT,
     "outputCount": 1, "createdAt": iso(-99000), "updatedAt": iso(-98900)},
    {"id": "job-unresolved", "provider": "fal", "model": "fal-ai/gpt-image-2", "mode": "text-to-image",
     "purpose": "frame", "status": "UNRESOLVED", "externalId": "", "shotId": SHOT, "outputCount": 2,
     "createdAt": iso(-5000), "updatedAt": iso(-4990),
     "unresolvedReason": "CineBraid lost contact before the provider confirmed acceptance."},
]

(project_dir / "automation-runs.json").write_text(
    json.dumps({"schemaVersion": 2, "updatedAt": iso(0), "runs": RUNS}, indent=2), encoding="utf-8")
(project_dir / "generation-jobs.json").write_text(json.dumps(JOBS, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Identity is taken by stamping each node once and reading the stamp back. A node that
# was rebuilt loses its stamp, which is a stronger claim than comparing ids or counts.
STAMP = """
() => {
  const targets = {
    rail: document.getElementById('cb-shell-rail'),
    dock: document.getElementById('cb-shell-dock'),
    assistant: document.querySelector('#cb-assistant-mount'),
    terminal: document.querySelector('#cb-terminal-mount'),
  };
  const out = {};
  for (const [name, node] of Object.entries(targets)) {
    if (!node) { out[name] = 'MISSING'; continue; }
    if (!node.__o3Stamp) node.__o3Stamp = `${name}:${Math.random().toString(36).slice(2)}`;
    out[name] = node.__o3Stamp;
  }
  return out;
}
"""

READ_STAMP = """
() => {
  const targets = {
    rail: document.getElementById('cb-shell-rail'),
    dock: document.getElementById('cb-shell-dock'),
    assistant: document.querySelector('#cb-assistant-mount'),
    terminal: document.querySelector('#cb-terminal-mount'),
  };
  const out = {};
  for (const [name, node] of Object.entries(targets)) out[name] = node ? (node.__o3Stamp || 'REBUILT') : 'MISSING';
  return out;
}
"""

SURFACES = """
() => {
  // The MOUNT nodes carry identity; the surfaces INSIDE them carry what the filmmaker
  // reads. Both are checked, because a mount that survives while its content vanishes
  // would satisfy an identity assertion and show an empty rail.
  const assistant = document.querySelector('#cb-assistant-mount');
  const terminal = document.querySelector('#cb-terminal-mount');
  const rail = document.querySelector('.cb-assistant');
  const rows = [...document.querySelectorAll('.cb-terminal-row')].map((row) => ({
    key: row.dataset.activityKey,
    kind: row.dataset.cbKind,
    status: row.querySelector('em').textContent,
    meta: [...row.querySelectorAll('.cb-terminal-meta span')].map((s) => s.textContent),
  }));
  return {
    mounted: !!assistant && !!terminal && !!rail && !!document.querySelector('.cb-terminal'),
    headline: rail ? rail.dataset.headline : '',
    headText: rail ? rail.querySelector('.cb-assistant-head').innerText : '',
    sections: [...document.querySelectorAll('.cb-assistant-section')].map((s) => s.dataset.cbSection),
    sectionText: Object.fromEntries([...document.querySelectorAll('.cb-assistant-section')]
      .map((s) => [s.dataset.cbSection, s.innerText])),
    rows,
    terminalText: terminal ? terminal.innerText : '',
    terminalHtml: terminal ? terminal.innerHTML : '',
  };
}
"""

GEOMETRY = """
() => {
  const doc = document.documentElement;
  const app = document.getElementById('app');
  const nav = document.getElementById('rail');
  const dock = document.getElementById('cb-shell-dock');
  const rail = document.getElementById('cb-shell-rail');
  const main = document.getElementById('main');
  const dockBody = dock && dock.querySelector('.cb-shell-slot-body');
  const dockShown = dock && getComputedStyle(dock).display !== 'none';
  const railShown = rail && getComputedStyle(rail).display !== 'none';
  return {
    innerWidth: window.innerWidth,
    scrollWidth: doc.scrollWidth,
    scrollHeight: doc.scrollHeight,
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    shellPresent: document.getElementById('workspace').dataset.creatorShell === '1',
    blockedReason: document.getElementById('workspace').dataset.creatorShellBlocked || '',
    railShown: !!railShown,
    dockShown: !!dockShown,
    railWidth: railShown ? Math.round(rail.getBoundingClientRect().width) : 0,
    railScrollsInternally: railShown ? rail.scrollHeight > rail.clientHeight + 2 : null,
    dockHeight: dockShown ? Math.round(dock.getBoundingClientRect().height) : 0,
    dockScrollsInternally: dockShown ? dockBody.scrollHeight > dockBody.clientHeight + 2 : null,
    dockLeft: dockShown ? Math.round(dock.getBoundingClientRect().left) : null,
    navRight: (nav && getComputedStyle(nav).position !== 'fixed') ? Math.round(nav.getBoundingClientRect().right) : null,
    mainWidth: Math.round(main.getBoundingClientRect().width),
    reserve: getComputedStyle(app).getPropertyValue('--cb-dock-reserve').trim(),
  };
}
"""

try:
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), .25): break
        except OSError: time.sleep(.1)
    else:
        raise RuntimeError("CineBraid server did not start")

    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def guard(route):
            """No request leaves this machine, and the paid route is never called."""
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts."):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector(".bounded-shot-taskbar", timeout=20000)
        # Runs arrive with load(); GENERATION JOBS DO NOT. public/app.js only fetches the
        # job ledger at boot when fal generation is enabled with a key source, and this
        # sandbox has neither — so the durable ledger reaches the page on the FIRST
        # ACTIVITY POLL instead, ~3.5s later. That is existing application behaviour and
        # not something O3 changes, so the suite waits for the app's own poll rather than
        # injecting the jobs itself: what the Terminal renders has to be what the shipped
        # load path actually produced.
        page.wait_for_selector('#cb-terminal-mount [data-activity-key^="job:"]', timeout=20000)
        page.wait_for_timeout(400)
        assert not page_errors, f"the shot workspace raised uncaught errors: {page_errors}"

        # THE RAIL NOW SHIPS CLOSED. Batch 2, Slice 1 stopped mounting the Assistant
        # until the filmmaker asks for it, because a permanently mounted 340px rail was
        # one of the founder smoke's clearest complaints. That new default is asserted
        # here and then set aside: everything below this line is about the SHELL and the
        # SURFACES, which need the rail occupied to say anything at all.
        assert page.evaluate("() => !window.CineBraidCreatorSurfaces.railOpen()"), \
            "the Assistant rail must ship CLOSED with no stored preference"
        assert page.evaluate("() => !document.getElementById('cb-shell-rail').hasAttribute('data-occupied')"), \
            "a closed rail must leave its slot unoccupied, so the centre reclaims the width"
        assert page.locator("#creator-rail-toggle").count() == 1, \
            "the topbar must offer the control that opens the rail"
        page.evaluate("() => window.CineBraidCreatorSurfaces.openRail()")
        page.wait_for_selector("#cb-shell-rail[data-occupied]", timeout=10000)
        # And the Activity Terminal now ships COLLAPSED. Same reasoning: assert the new
        # default, then expand it, because every Terminal section below reads its rows.
        assert page.evaluate("() => window.CineBraidCreatorSurfaces.terminalCollapsed()"), \
            "the Activity Terminal must ship COLLAPSED with no stored preference"
        page.evaluate("() => window.CineBraidCreatorSurfaces.toggleTerminal()")
        page.wait_for_selector('.cb-terminal[data-collapsed="0"]', timeout=10000)

        # ---- 1. both surfaces mount and describe the seeded production -----------------
        view = page.evaluate(SURFACES)
        assert view["mounted"], "1. the Assistant and the Terminal must both mount into the O2 slots"
        assert page.evaluate("() => typeof window.CineBraidCreatorSurfaces === 'object'"), \
            "1. the creator surfaces contract is not exposed in the browser"
        # It works with NO assistant model configured. The sandbox has none, and nothing
        # below asked for one - the whole rail below was produced from production state.
        capability = page.evaluate("() => !!(AGENT_STATUS && AGENT_STATUS.capabilities && AGENT_STATUS.capabilities.text && AGENT_STATUS.capabilities.text.ready)")
        assert not capability, \
            "1. this sandbox is expected to have no text assistant configured, so the rail below is provably deterministic"
        assert view["headline"] == "needs-attention", \
            f"1. a failed run must claim the headline, got '{view['headline']}'"
        findings.append(f"1. Assistant and Terminal both mounted and rendered with NO assistant model configured "
                        f"(capabilities.text.ready={capability}); headline '{view['headline']}'")

        # ---- 2. the O1 stage appears, and is the one the workspace is showing ----------
        stage = page.evaluate("""() => {
            const shot = shotById(%s);
            const takes = takesFor(shot.id);
            const selected = boundedShotSelectedTask(shot, takes);
            const state = shotStageState(selected, shotStageModelFacts(shot, takes));
            return { selected, label: state.label, availability: state.availability,
                     blockedReason: state.blockedReason, recommendedNext: state.recommendedNext };
        }""" % json.dumps(SHOT))
        stage_text = view["sectionText"].get("stage", "")
        assert stage["label"] in stage_text, \
            f"2. the rail's current step must name the declared stage '{stage['label']}', got: {stage_text!r}"
        assert page.evaluate("() => (window.SHOT_STAGE_IDS || []).length") == 5, \
            "2. the declared model must still hold five stages"
        findings.append(f"2. current step reads the declared stage '{stage['label']}' "
                        f"({stage['availability']}, recommendedNext={stage['recommendedNext'] or 'none'})")

        # ---- 3. Working / Waiting for you / Needs attention ----------------------------
        assert view["sections"][:3] == ["attention", "waiting", "working"], \
            f"3. the rail must order attention -> waiting -> working, got {view['sections']}"
        working = view["sectionText"]["working"]
        waiting = view["sectionText"]["waiting"]
        attention = view["sectionText"]["attention"]
        assert "Frame automation" in working, "4. the leased running run must appear as Working"
        assert "Frame review" in waiting, "5. the run parked at a gate must appear as Waiting for you"
        assert "Frame review" not in working, \
            "5. a run awaiting review must NEVER appear as machine work - that is the defect O3 must not reintroduce"
        assert "Abandoned by a closed tab" in waiting, \
            "5. a run whose lease lapsed is waiting for the filmmaker, not running"
        assert "Abandoned by a closed tab" not in working, "5. an abandoned run must not read as Working"
        assert "Scene correction" in attention, "6. the failed run must appear as Needs attention"
        assert "does not know whether the provider accepted" in attention, \
            "6. the unresolved submission must say the outcome is unknown"
        findings.append("3-6. Working holds only the leased run; the approval gate and the abandoned run are "
                        "Waiting for you; the failure and the unresolved submission are Needs attention")

        # ---- 7. the Terminal represents the same states technically --------------------
        rows = {row["key"]: row for row in view["rows"]}
        for key, status in [("run:o3-live", "RUNNING"), ("run:o3-wait", "AWAITING REVIEW"),
                            ("run:o3-orphan", "STOPPED"), ("run:o3-failed", "FAILED"),
                            ("job:job-unresolved", "UNRESOLVED"), ("run:o3-done", "COMPLETED")]:
            assert key in rows, f"7. the Terminal must hold a row for {key}"
            assert rows[key]["status"] == status, \
                f"7. the Terminal must label {key} as {status}, got {rows[key]['status']}"
        assert "job:job-live" not in rows, \
            "7. a job owned by an automation run is already represented by its run's row; listing it twice would " \
            "double-count the same paid request"
        findings.append(f"7. Terminal labels all six seeded states technically and does not double-count the "
                        f"run-owned job ({len(rows)} rows)")

        # ---- 8. rail and dock survive every stage change -------------------------------
        stages = page.evaluate("() => (window.SHOT_STAGE_IDS || []).slice()")

        def select_stage(stage_id):
            """Request a stage, then wait for THAT STAGE to be the one on screen.

            selectBoundedTask writes the focused task synchronously and then calls
            route(), which is ASYNCHRONOUS — so page.evaluate returns while the previous
            stage's body is still in #main. Waiting a fixed 240/260/300ms afterwards was
            waiting for time rather than for the stage, and on a slower CI runner the
            frames -> motion render crossed that budget: the assertion read the Frames
            body and reported it as Motion failing to render.

            `.guided-work-stack[data-bounded-task]` is the marker the assertions already
            read, so waiting on it is waiting for exactly the fact under test.

            This is also sufficient for the RAIL's current-step text. route() sets
            #main.innerHTML and dispatches cinebraid:route-rendered in one synchronous
            tail, and the Assistant paints synchronously inside that dispatch; a poll can
            only observe the DOM between tasks, so a visible body marker means the paint
            has already run. No second sleep is needed and none is kept.

            check_stage_selection_leads_render() proves the old time-based contract was
            invalid, with no clock and no injected delay."""
            page.evaluate("id => selectBoundedTask('shot-task', %s, id)" % json.dumps(SHOT), stage_id)
            page.wait_for_function(
                """(want) => document.querySelector('.guided-work-stack')?.dataset.boundedTask === want""",
                arg=stage_id, timeout=30000)

        def check_stage_selection_leads_render():
            """REGRESSION CONTROL for select_stage's own precondition — no clock in it.

            selectBoundedTask is invoked and the DOM read back INSIDE ONE synchronous
            page.evaluate. route() is asynchronous, so no re-render can have run by the
            time the same task reads: the focused task is already the newly requested
            stage while the rendered body is still the previous one. That snapshot IS the
            state the old fixed-sleep contract could return in, and it establishes the
            point directly — selection state and rendered-stage readiness are two facts,
            not one."""
            select_stage("frames")
            snapshot = page.evaluate("""(args) => {
                const [shot, wanted] = args;
                const stack = () => document.querySelector('.guided-work-stack');
                const before = stack() ? (stack().dataset.boundedTask || '') : '';
                selectBoundedTask('shot-task', shot, wanted);
                const slug = (typeof ACTIVE_PROJECT_SLUG !== 'undefined' && ACTIVE_PROJECT_SLUG)
                    || (P && P.meta && P.meta.id) || 'project';
                let focused = '';
                try { focused = localStorage.getItem(`cinebraid-focused:${slug}:shot-task:${shot}`) || ''; } catch {}
                return { before, focused, bodyNow: stack() ? (stack().dataset.boundedTask || '') : '' };
            }""", [SHOT, "motion"])
            assert snapshot["before"] == "frames", \
                f"8b setup: the control must start from a known stage, got {snapshot['before']!r}"
            assert snapshot["focused"] == "motion", \
                f"8b: the focused task must be written synchronously, got {snapshot['focused']!r}"
            assert snapshot["bodyNow"] == "frames", \
                ("8b: the render completed synchronously, so the old fixed-sleep contract was never premature "
                 f"and this control proves nothing; body was {snapshot['bodyNow']!r}")
            page.wait_for_function(
                """(want) => document.querySelector('.guided-work-stack')?.dataset.boundedTask === want""",
                arg="motion", timeout=30000)
            return snapshot

        before = page.evaluate(STAMP)
        assert "MISSING" not in before.values(), f"8. a surface was missing before the stage sweep: {before}"
        for stage_id in stages:
            select_stage(stage_id)
            after = page.evaluate(READ_STAMP)
            for name, mark in before.items():
                assert after[name] == mark, \
                    f"8. switching to '{stage_id}' replaced the {name} node ({after[name]} != {mark}). " \
                    "A stage change must not rebuild either creator surface."
            live_rows = page.evaluate("() => document.querySelectorAll('.cb-terminal-row').length")
            assert live_rows == len(rows), \
                f"8. the Terminal's history was reset by the change to '{stage_id}' ({live_rows} rows, expected {len(rows)})"
        page.evaluate("() => route()")
        page.wait_for_timeout(420)
        after_render = page.evaluate(READ_STAMP)
        for name, mark in before.items():
            assert after_render[name] == mark, f"8. a full re-render replaced the {name} node"
        findings.append(f"8. rail, dock, Assistant and Terminal kept node identity across all {len(stages)} stage "
                        f"changes and a full re-render; Terminal history was never reset")

        # ---- 8b. selection state and rendered stage are separate facts -----------------
        lead = check_stage_selection_leads_render()
        findings.append(
            f"8b. inside one synchronous task selectBoundedTask left the focused task at "
            f"{lead['focused']!r} while the rendered body was still {lead['bodyNow']!r}, so a fixed sleep could "
            f"return on the previous stage; select_stage waits for the requested body instead")

        # The rail's CONTENT still tracks context even though its node never changed.
        select_stage("motion")
        motion_stage = page.evaluate("() => document.querySelector('[data-cb-section=\"stage\"]').innerText")
        select_stage("inputs")
        inputs_stage = page.evaluate("() => document.querySelector('[data-cb-section=\"stage\"]').innerText")
        assert motion_stage != inputs_stage, \
            "8. the rail's current step did not change with the stage; a persistent surface that never updates is a screenshot"
        assert "Motion" in motion_stage and "Inputs" in inputs_stage, \
            f"8. the rail named the wrong stages: {motion_stage!r} / {inputs_stage!r}"
        findings.append("8. the rail's current step follows the selected stage while its node stays the same")

        # ---- 9 & 10. money, in both directions ----------------------------------------
        priced = rows["job:job-priced"]["meta"]
        unpriced = rows["job:job-unpriced"]["meta"]
        legacy = rows["job:job-legacy"]["meta"]
        live_meta = rows["run:o3-live"]["meta"]
        assert "fal" in priced and "fal-ai/gpt-image-2" in priced and "req req-def456" in priced, \
            f"9. a recorded provider, model and request handle must all be shown, got {priced}"
        assert "est $0.16" in priced, f"9. a recorded estimate must be shown, got {priced}"
        assert "attempt 2/3" in live_meta and "1 retries" in live_meta, \
            f"9. an automation step's recorded attempt and retry count must be shown, got {live_meta}"
        assert "cost not priced" in unpriced, \
            f"10. a metered job with no applicable rate must say so, got {unpriced}"
        assert "cost not recorded" in legacy, \
            f"10. a job predating cost recording must say so, got {legacy}"
        assert "$0.00" not in view["terminalText"], \
            "10. an unknown or unrecorded cost must never render as $0.00"
        assert not any("req " in part for part in legacy), \
            f"10. a row with no recorded request handle must show none, got {legacy}"
        findings.append(f"9-10. recorded provider/model/request/attempt/cost shown ({priced}); unknown cost reads "
                        f"'cost not priced' and unrecorded reads 'cost not recorded'; no $0.00 anywhere")

        # ---- 11. a high-volume Terminal does not grow the page -------------------------
        # THE PROPERTY, stated precisely: page height must be INVARIANT TO TERMINAL
        # VOLUME. Both measurements are taken with the same geometry and the same
        # surfaces mounted; only the AMOUNT of activity differs.
        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(320)
        modest = page.evaluate(GEOMETRY)
        assert modest["dockShown"] and modest["railShown"], "11. both surfaces must be visible at 1600px"
        baseline_height = modest["scrollHeight"]

        # 400 extra settled runs, written through the real API surface the app reads from.
        flood = [dict(RUNS[4], id=f"o3-flood-{index}", label=f"Flood run {index}",
                      createdAt=iso(-20000 - index), updatedAt=iso(-19000 - index), completedAt=iso(-19000 - index))
                 for index in range(400)]
        (project_dir / "automation-runs.json").write_text(
            json.dumps({"schemaVersion": 2, "updatedAt": iso(0), "runs": RUNS + flood}, indent=2), encoding="utf-8")
        page.evaluate("() => refreshGlobalAutomationActivity(true)")
        page.wait_for_timeout(900)
        flooded = page.evaluate(GEOMETRY)
        flooded_view = page.evaluate(SURFACES)
        growth = flooded["scrollHeight"] - baseline_height
        assert abs(growth) <= 4, \
            f"11. adding 400 settled runs changed the page height by {growth}px. Terminal volume is escaping into " \
            f"page length, which is exactly what an unbounded activity log would do."
        assert flooded["dockHeight"] == modest["dockHeight"], \
            f"11. the dock's height followed its content ({modest['dockHeight']} -> {flooded['dockHeight']}px) " \
            f"instead of capping it"
        assert flooded["dockScrollsInternally"], "11. the Terminal must scroll inside the dock, not lengthen the page"
        assert "Not shown" in flooded_view["terminalText"], \
            "11. a bounded surface must name what it is not showing; silent truncation reads as completeness"
        assert "Reports" in flooded_view["terminalText"], "11. the Terminal must point at the deep history it defers to"
        row_count = len(flooded_view["rows"])
        assert row_count < 60, f"11. the Terminal rendered {row_count} rows; the window must stay bounded"
        findings.append(f"11. 400 extra settled runs changed page height by {growth}px and dock height by 0px; "
                        f"{row_count} rows rendered, the rest named as omitted with Reports linked")

        # The reservation is real: the dock covers exactly what it gives back.
        reserve = int(flooded["reserve"].replace("px", "") or 0)
        assert abs(reserve - flooded["dockHeight"]) <= 2, \
            f"11. the dock is {flooded['dockHeight']}px tall but reserves {reserve}px — a fixed dock that " \
            f"under-reserves hides the bottom of the workspace and one that over-reserves leaves a dead band"
        findings.append(f"11. the dock reserves exactly the {flooded['dockHeight']}px it covers")

        # ---- 12. the drawer and the Terminal agree, run for run ------------------------
        agreement = page.evaluate("""() => {
            openGlobalAutomationActivity();
            const section = (title) => [...document.querySelectorAll('.automation-drawer-section')]
              .find((node) => node.querySelector('header b').textContent.includes(title));
            const keys = (title) => [...(section(title)?.querySelectorAll('[data-activity-key]') || [])]
              .map((row) => row.getAttribute('data-activity-key'));
            const drawer = { active: keys('ACTIVE NOW'), waiting: keys('WAITING FOR YOU'),
                             attention: keys('PREVIOUS FAILURES') };
            closeGlobalAutomationActivity();
            const terminal = {};
            for (const row of document.querySelectorAll('.cb-terminal-row')) {
              (terminal[row.dataset.cbKind] = terminal[row.dataset.cbKind] || []).push(row.dataset.activityKey);
            }
            return { drawer, terminal, drawerOpened: true };
        }""")
        drawer, terminal = agreement["drawer"], agreement["terminal"]
        for label, drawer_keys, terminal_keys in [
            ("running", drawer["active"], terminal.get("machine-active", [])),
            ("waiting for the filmmaker", drawer["waiting"], terminal.get("waiting-human", [])),
        ]:
            runs_in_drawer = sorted(k for k in drawer_keys if k.startswith("run:"))
            runs_in_terminal = sorted(k for k in terminal_keys if k.startswith("run:"))
            assert runs_in_drawer == runs_in_terminal, \
                f"12. the Activity drawer and the Terminal disagree about which runs are {label}: " \
                f"drawer {runs_in_drawer} vs terminal {runs_in_terminal}. Two surfaces over one production must " \
                f"read the same predicates."
        assert drawer["waiting"], "12. the fixture must actually populate WAITING FOR YOU or this check is vacuous"
        findings.append(f"12. drawer and Terminal agree run-for-run on running {sorted(k for k in drawer['active'] if k.startswith('run:'))} "
                        f"and waiting {sorted(k for k in drawer['waiting'] if k.startswith('run:'))}")

        # The drawer still opens and closes over the dock, unchanged by O3.
        drawer_state = page.evaluate("""() => {
            openGlobalAutomationActivity();
            const el = document.getElementById('automation-activity-drawer');
            const dock = document.getElementById('cb-shell-dock');
            const layers = [Number(getComputedStyle(el).zIndex), Number(getComputedStyle(dock).zIndex)];
            const open = el.classList.contains('open') && el.getAttribute('aria-modal') === 'true';
            document.querySelector('#automation-activity-drawer .cancel').click();
            return { open, layers, closed: !el.classList.contains('open') };
        }""")
        assert drawer_state["open"] and drawer_state["closed"], "12. the Activity drawer must still open and close"
        assert drawer_state["layers"][0] > drawer_state["layers"][1], \
            f"12. the drawer must still paint above the dock, got {drawer_state['layers']}"
        findings.append(f"12. the Activity drawer still opens modally above the dock "
                        f"(z {drawer_state['layers'][0]} > {drawer_state['layers'][1]}) and closes")

        # ---- 13. lifecycle: retained, not painted, restored ----------------------------
        page.evaluate("() => window.CineBraidCreatorSurfaces.paint()")
        before_settings = page.evaluate(STAMP)
        page.goto(f"{base}/#/settings", wait_until="domcontentloaded")
        page.wait_for_timeout(800)
        settings = page.evaluate(GEOMETRY)
        settings_state = page.evaluate("""() => ({
            assistantRetained: !!document.querySelector('#cb-assistant-mount'),
            terminalRetained: !!document.querySelector('#cb-terminal-mount'),
            stale: window.CineBraidCreatorSurfaces.isStale(),
            railOccupied: window.CineBraidShell.slotHasContent('rail'),
            dockOccupied: window.CineBraidShell.slotHasContent('dock'),
        })""")
        assert not settings["shellPresent"] and settings["blockedReason"] == "excluded-view", \
            f"13. Settings must shed the shell as an excluded view, got '{settings['blockedReason']}'"
        assert not settings["railShown"] and not settings["dockShown"], \
            "13. neither surface may paint on a non-creator surface"
        assert settings["reserve"] in ("", "0px"), \
            f"13. Settings must reserve no dock space, got '{settings['reserve']}'"
        assert settings_state["assistantRetained"] and settings_state["terminalRetained"], \
            "13. both surfaces must be RETAINED, not destroyed: a visit to Settings must not throw away the workspace"
        assert settings_state["stale"], \
            "13. a hidden surface must be marked stale rather than repainted; repainting what nobody can see is work with no reader"
        findings.append("13. Settings hides both surfaces, reserves nothing, and retains them mounted and marked stale")

        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        # Runs arrive with load(); GENERATION JOBS DO NOT. public/app.js only fetches the
        # job ledger at boot when fal generation is enabled with a key source, and this
        # sandbox has neither — so the durable ledger reaches the page on the FIRST
        # ACTIVITY POLL instead, ~3.5s later. That is existing application behaviour and
        # not something O3 changes, so the suite waits for the app's own poll rather than
        # injecting the jobs itself: what the Terminal renders has to be what the shipped
        # load path actually produced.
        page.wait_for_selector('#cb-terminal-mount [data-activity-key^="job:"]', timeout=20000)
        page.wait_for_timeout(500)
        restored = page.evaluate(READ_STAMP)
        restored_view = page.evaluate(SURFACES)
        for name, mark in before_settings.items():
            assert restored[name] == mark, \
                f"13. returning from Settings rebuilt the {name} node ({restored[name]} != {mark})"
        assert not page.evaluate("() => window.CineBraidCreatorSurfaces.isStale()"), \
            "13. returning to a creator surface must clear the stale flag and repaint"
        assert restored_view["rows"], "13. the Terminal must repaint from current truth on return"
        assert page.evaluate("() => document.querySelectorAll('#cb-assistant-mount').length") == 1, \
            "13. navigating must not accumulate a second Assistant"
        findings.append("13. returning restores the same nodes, clears the stale flag and repaints from current truth")

        # ---- 14. three rail states, a centre floor, and no horizontal overflow ---------
        width_notes = []
        for name, width, height, expected_rail in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(340)
            geo = page.evaluate(GEOMETRY)
            rail_now = geo["railWidth"] if geo["railShown"] else 0
            assert rail_now == expected_rail, \
                f"14. at {name} ({width}px) the rail rendered {rail_now}px, expected {expected_rail}px. " \
                f"The rail narrows to 240px before it disappears so 1366 and 1440 keep an Assistant; " \
                f"a band boundary has moved."
            assert not geo["horizontalOverflow"], \
                f"14. {name} ({width}px) has horizontal page overflow: {geo['scrollWidth']} > {geo['innerWidth']}"
            if geo["dockShown"] and geo["navRight"] is not None:
                assert geo["dockLeft"] >= geo["navRight"], \
                    f"14. at {name} the dock starts at {geo['dockLeft']} but navigation ends at {geo['navRight']}"
            # THE FLOOR, checked wherever the rail is taking room. Below 900px the centre
            # is in a band no component rule in the stylesheet was written for, which is
            # exactly how two shipped components came to squeeze and overlap.
            if geo["railShown"]:
                assert geo["mainWidth"] >= CENTRE_FLOOR, \
                    f"14. at {name} ({width}px) the rail left the centre {geo['mainWidth']}px, " \
                    f"below the {CENTRE_FLOOR}px floor the app's own component rules assume"
                # And the rail itself has to be usable, not merely present: every control
                # inside it fully within its box, and nothing overflowing it sideways.
                usable = page.evaluate("""() => {
                    const rail = document.getElementById('cb-shell-rail');
                    const box = rail.getBoundingClientRect();
                    const buttons = [...rail.querySelectorAll('button')];
                    return {
                      overflow: Math.max(0, rail.scrollWidth - rail.clientWidth),
                      buttons: buttons.length,
                      unreachable: buttons.filter((b) => {
                        const r = b.getBoundingClientRect();
                        return r.right > box.right + 1 || r.left < box.left - 1 || r.width < 24 || r.height < 14;
                      }).length,
                      clipped: [...rail.querySelectorAll('*')].filter((el) => {
                        const r = el.getBoundingClientRect();
                        if (!r.width && !r.height) return false;
                        return r.right > box.right + 1 || r.left < box.left - 1;
                      }).length,
                      sections: [...rail.querySelectorAll('.cb-assistant-section')].map((s) => s.dataset.cbSection),
                    };
                }""")
                assert usable["overflow"] == 0, \
                    f"14. at {name} the Assistant overflows its rail by {usable['overflow']}px"
                assert usable["clipped"] == 0, \
                    f"14. at {name} {usable['clipped']} Assistant element(s) sit outside the rail's box"
                assert usable["unreachable"] == 0, \
                    f"14. at {name} {usable['unreachable']} of {usable['buttons']} Assistant controls are unreachable"
                assert usable["buttons"] >= 4, \
                    f"14. at {name} the Assistant rendered only {usable['buttons']} controls, so this check is vacuous"
                assert "attention" in usable["sections"] and "waiting" in usable["sections"] \
                    and "stage" in usable["sections"] and "next" in usable["sections"], \
                    f"14. at {name} the Assistant lost sections at this width: {usable['sections']}"
            assert geo["dockHeight"] <= height * 0.45, \
                f"14. at {name} the dock took {geo['dockHeight']}px of a {height}px viewport"
            width_notes.append(f"{name} {width}px: rail={str(rail_now) + 'px' if rail_now else 'off'} "
                               f"dock={geo['dockHeight']}px centre={geo['mainWidth']}px")
        states = {row.split("rail=")[1].split(" ")[0] for row in width_notes}
        assert {"340px", "240px", "off"} <= states, \
            f"14. all three rail states must be exercised, saw {states}"
        findings.append("14. three rail states, centre never below "
                        f"{CENTRE_FLOOR}px, every Assistant control reachable, no horizontal overflow — "
                        + "; ".join(width_notes))

        # ---- 14b. all five stages render at the COMPACT width --------------------------
        # The stage sweep in section 8 runs at the full-rail width. The compact band is a
        # different layout — 100px less rail and a centre near its floor — and "the rail
        # still fits" is worth nothing if a stage workspace stops rendering inside it.
        page.set_viewport_size({"width": 1366, "height": 900})
        page.wait_for_timeout(400)
        compact_before = page.evaluate(STAMP)
        compact_notes = []
        for stage_id in stages:
            select_stage(stage_id)
            state = page.evaluate("""() => {
                const stack = document.querySelector('.guided-work-stack');
                const rail = document.getElementById('cb-shell-rail');
                const doc = document.documentElement;
                return {
                  body: stack ? stack.dataset.boundedTask || '' : '',
                  railWidth: Math.round(rail.getBoundingClientRect().width),
                  railShown: getComputedStyle(rail).display !== 'none',
                  centre: Math.round(document.getElementById('main').getBoundingClientRect().width),
                  overflow: doc.scrollWidth > window.innerWidth,
                  stageSection: document.querySelector('[data-cb-section="stage"]')?.innerText || '',
                };
            }""")
            assert state["body"] == stage_id, \
                f"14b. at 1366px selecting {stage_id} rendered the '{state['body']}' body"
            assert state["railShown"] and state["railWidth"] == 240, \
                f"14b. the compact rail must survive the change to {stage_id}, got {state['railWidth']}px"
            assert state["centre"] >= CENTRE_FLOOR, \
                f"14b. the {stage_id} workspace left the centre {state['centre']}px at 1366px"
            assert not state["overflow"], f"14b. the {stage_id} workspace overflows horizontally at 1366px"
            assert state["stageSection"], f"14b. the Assistant lost its current-step block on {stage_id}"
            compact_notes.append(stage_id)
        compact_after = page.evaluate(READ_STAMP)
        for name, mark in compact_before.items():
            assert compact_after[name] == mark, \
                f"14b. a stage change at the compact width replaced the {name} node"
        findings.append(f"14b. all five stages render at 1366px with the 240px rail, the centre at or above "
                        f"{CENTRE_FLOOR}px, no overflow and no node rebuilt ({' -> '.join(compact_notes)})")

        page.set_viewport_size({"width": 1600, "height": 1000})
        page.wait_for_timeout(320)

        # ---- 15. the collapse control ---------------------------------------------------
        collapsed = page.evaluate("""() => {
            window.CineBraidCreatorSurfaces.toggleTerminal();
            const dock = document.getElementById('cb-shell-dock');
            return { rows: document.querySelectorAll('.cb-terminal-row').length,
                     header: !!document.querySelector('.cb-terminal-head'),
                     height: Math.round(dock.getBoundingClientRect().height),
                     reserve: getComputedStyle(document.getElementById('app')).getPropertyValue('--cb-dock-reserve').trim() };
        }""")
        assert collapsed["rows"] == 0 and collapsed["header"], \
            "15. a collapsed Terminal must keep its header and render no rows"
        assert abs(int(collapsed["reserve"].replace("px", "") or 0) - collapsed["height"]) <= 2, \
            "15. collapsing must give the reserved space back"
        assert collapsed["height"] < flooded["dockHeight"], "15. collapsing must actually shrink the dock"
        page.evaluate("() => window.CineBraidCreatorSurfaces.toggleTerminal()")
        page.wait_for_timeout(300)
        assert page.evaluate("() => document.querySelectorAll('.cb-terminal-row').length") > 0, \
            "15. expanding must bring the log back"
        findings.append(f"15. collapse takes the dock from {flooded['dockHeight']}px to {collapsed['height']}px and "
                        f"returns the reservation; expanding restores the log")

        # ---- NEGATIVE CONTROLS ----------------------------------------------------------
        # N1: rebuild the rail the way a stage-owned Assistant would, and require the
        # identity check in section 8 to notice.
        control_before = page.evaluate(STAMP)
        page.evaluate("""() => {
            const region = document.getElementById('cb-shell-main');
            const old = document.getElementById('cb-shell-rail');
            const rebuilt = document.createElement('aside');
            rebuilt.id = 'cb-shell-rail';
            rebuilt.className = 'cb-shell-slot';
            rebuilt.innerHTML = '<div class="cb-shell-slot-body"></div>';
            region.replaceChild(rebuilt, old);
        }""")
        control_after = page.evaluate(READ_STAMP)
        assert control_after["rail"] == "REBUILT" and control_after["assistant"] == "MISSING", \
            "N1: reconstructing the rail did not lose its stamp, so section 8's identity check cannot tell a " \
            "persistent surface from a rebuilt one and proves nothing."
        page.reload(wait_until="domcontentloaded")
        # Runs arrive with load(); GENERATION JOBS DO NOT. public/app.js only fetches the
        # job ledger at boot when fal generation is enabled with a key source, and this
        # sandbox has neither — so the durable ledger reaches the page on the FIRST
        # ACTIVITY POLL instead, ~3.5s later. That is existing application behaviour and
        # not something O3 changes, so the suite waits for the app's own poll rather than
        # injecting the jobs itself: what the Terminal renders has to be what the shipped
        # load path actually produced.
        page.wait_for_selector('#cb-terminal-mount [data-activity-key^="job:"]', timeout=20000)
        page.wait_for_timeout(500)
        findings.append("N1. rebuilding the rail per stage is detected by the identity check")

        # N2: unbind the dock and require the page-growth arithmetic to notice.
        bounded_height = page.evaluate("() => document.documentElement.scrollHeight")
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'cb-o3-control-unbound';
            style.textContent = '#cb-shell-dock{position:static!important;max-height:none!important}'
              + '#cb-shell-dock>.cb-shell-slot-body{overflow-y:visible!important;min-height:auto!important}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(340)
        unbounded_height = page.evaluate("() => document.documentElement.scrollHeight")
        assert unbounded_height > bounded_height + 300, \
            f"N2: unbinding the dock changed the page height by only {unbounded_height - bounded_height}px, so " \
            f"section 11's page-growth arithmetic would not have caught an unbounded Terminal."
        page.evaluate("() => document.getElementById('cb-o3-control-unbound')?.remove()")
        page.wait_for_timeout(250)
        findings.append(f"N2. an unbounded dock grows the page by {unbounded_height - bounded_height}px and is caught")

        # N3: make the Terminal call an approval gate RUNNING in the running page, and
        # require section 12's drawer/Terminal agreement to notice.
        page.evaluate("""() => {
            document.querySelectorAll('.cb-terminal-row').forEach((row) => {
              if (row.dataset.cbKind === 'waiting-human') row.dataset.cbKind = 'machine-active';
            });
        }""")
        drifted = page.evaluate("""() => {
            openGlobalAutomationActivity();
            const section = (title) => [...document.querySelectorAll('.automation-drawer-section')]
              .find((node) => node.querySelector('header b').textContent.includes(title));
            const drawerActive = [...(section('ACTIVE NOW')?.querySelectorAll('[data-activity-key]') || [])]
              .map((row) => row.getAttribute('data-activity-key')).filter((k) => k.startsWith('run:')).sort();
            closeGlobalAutomationActivity();
            const terminalActive = [...document.querySelectorAll('.cb-terminal-row')]
              .filter((row) => row.dataset.cbKind === 'machine-active')
              .map((row) => row.dataset.activityKey).filter((k) => k.startsWith('run:')).sort();
            return { drawerActive, terminalActive };
        }""")
        assert drifted["drawerActive"] != drifted["terminalActive"], \
            "N3: moving the waiting rows into the Terminal's active bucket did not make the two surfaces " \
            "disagree, so section 12's agreement check is not comparing anything."
        page.evaluate("() => window.CineBraidCreatorSurfaces.paint()")
        page.wait_for_timeout(250)
        findings.append(f"N3. a Terminal that calls an approval gate active disagrees with the drawer "
                        f"({drifted['terminalActive']} vs {drifted['drawerActive']}) and is caught")

        # N4: make an unknown cost print as a zero, and require section 10 to notice.
        zeroed = page.evaluate("""() => {
            const before = document.querySelector('#cb-terminal-mount').innerText.includes('$0.00');
            document.querySelectorAll('.cb-terminal-meta span').forEach((node) => {
              if (node.textContent === 'cost not priced' || node.textContent === 'cost not recorded')
                node.textContent = 'est $0.00';
            });
            return { before, after: document.querySelector('#cb-terminal-mount').innerText.includes('$0.00') };
        }""")
        assert not zeroed["before"] and zeroed["after"], \
            "N4: rewriting the unpriced rows did not produce a $0.00 in the Terminal, so section 10's money " \
            "check is not reading the rendered cost."
        page.evaluate("() => window.CineBraidCreatorSurfaces.paint()")
        page.wait_for_timeout(250)
        assert not page.evaluate("() => document.querySelector('#cb-terminal-mount').innerText.includes('$0.00')"), \
            "N4: the repaint did not restore the honest wording"
        findings.append("N4. an unknown cost rendered as $0.00 is caught, and a repaint restores the honest wording")

        # N5: put the FULL 340px rail back into the compact band and require section 14's
        # centre floor to notice. Without this, "the centre never went below 900px" could
        # be passing because 900px is generous rather than because the compact rail is
        # what keeps it — and the compact band is the whole point of the responsive work.
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(340)
        guarded = page.evaluate("""() => ({
            rail: Math.round(document.getElementById('cb-shell-rail').getBoundingClientRect().width),
            centre: Math.round(document.getElementById('main').getBoundingClientRect().width),
        })""")
        assert guarded["rail"] == 240 and guarded["centre"] >= CENTRE_FLOOR, \
            f"N5 setup: 1440px must be in the compact band, got {guarded}"
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.id = 'cb-o3-control-widerail';
            style.textContent = '#app{--cb-shell-rail-width:340px!important}';
            document.head.appendChild(style);
        }""")
        page.wait_for_timeout(340)
        unguarded = page.evaluate("""() => ({
            rail: Math.round(document.getElementById('cb-shell-rail').getBoundingClientRect().width),
            centre: Math.round(document.getElementById('main').getBoundingClientRect().width),
        })""")
        assert unguarded["centre"] < CENTRE_FLOOR, \
            f"N5: restoring the 340px rail at 1440px left the centre at {unguarded['centre']}px, still above the " \
            f"{CENTRE_FLOOR}px floor — so section 14's floor check would not have caught the loss of the compact " \
            f"band and the compact rail is not what is keeping the centre usable."
        page.evaluate("() => document.getElementById('cb-o3-control-widerail')?.remove()")
        page.wait_for_timeout(300)
        findings.append(f"N5. removing the compact band drops the 1440px centre from {guarded['centre']}px to "
                        f"{unguarded['centre']}px, below the {CENTRE_FLOOR}px floor, and is caught")

        # ---- teardown -------------------------------------------------------------------
        final = page.evaluate("""() => ({
            controls: document.querySelectorAll('#cb-o3-control-unbound,#cb-o3-control-widerail').length,
            assistants: document.querySelectorAll('#cb-assistant-mount').length,
            terminals: document.querySelectorAll('#cb-terminal-mount').length,
        })""")
        assert final["controls"] == 0, "teardown: a control stylesheet survived"
        assert final["assistants"] == 1 and final["terminals"] == 1, \
            f"teardown: the page must hold exactly one of each surface, got {final}"
        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()

assert not offsite, f"requests left the machine: {offsite}"
assert not paid_calls, f"a paid route was called: {paid_calls}"

print("\n".join(findings))
print(f"project data isolated: config {config_path}, projects {projects_root} — data/ untouched")
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("creator Assistant and Activity Terminal real-browser audit passed")
