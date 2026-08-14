#!/usr/bin/env python3
"""Production-state honesty, read off a real Chromium.

Two of this batch's repairs cannot be established anywhere else.

  * ELEMENT SURVIVAL. The activity drawer re-renders every 3500 ms whether or not
    anything changed, and it used to do so by replacing its whole innerHTML - so every
    control in it was a new element every tick, and a click begun before a tick landed
    on a node that no longer existed. That is node identity across real time, which
    tests/render-harness.js FakeElement neither parses nor tracks. It is also the
    proven cause of the intermittent check:browser-real DISMISS timeout.

  * THE CLOCK. "Does this number stop?" is a question about wall-clock time passing in
    a live page, not about a string a helper returns once.

The suite seeds four runs whose shapes are the ones the writers really persist - a run
parked at a human gate, a run abandoned with a lapsed lease, a run genuinely leased and
running, and a failed run that renders a DISMISS control - and then asks the shipped
page what it says about each.

It carries its own NEGATIVE CONTROL: the reconciling painter is replaced, inside the
running page, with the whole-innerHTML behaviour it replaced, and the suite proves the
detachment comes straight back. Nothing on disk is touched.

NOTHING HERE IS PAID. Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are
never touched; the route guard aborts the paid route and anything off-loopback.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Production-state honesty real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-01"
SLUG = "dogfood-sample"
PAID_ROUTE = "/api/generation/fal/jobs"
REFRESH_MS = 3500

page_errors, offsite, paid_calls = [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def iso(offset_seconds):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + offset_seconds)) + ".000Z"


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-state-honesty-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / SLUG

# A two-frame shot whose ONLY blocking attempt belongs to Frame B: the dogfood shape.
takes = project_dir / "shots" / SHOT / "takes"
media_dir = project_dir / "media"
media_dir.mkdir(parents=True, exist_ok=True)
shutil.copyfile(takes / "SAMPLE-01-ARRIVAL.png", takes / "SAMPLE-01-BEAT-B.png")
shutil.copyfile(takes / "SAMPLE-01-ARRIVAL.png", media_dir / "SAMPLE-01_FRAME_B_BLOCKING.png")

project_file = project_dir / "project.json"
project = json.loads(project_file.read_text(encoding="utf-8"))
shot = next(row for row in project["shots"] if row["id"] == SHOT)
shot["keyframes"] = [
    {"id": "frame-a", "label": "A", "title": "Arrival", "winner": "SAMPLE-01-ARRIVAL.png",
     "description": "Courier steps onto the platform.", "required": True, "generationPackages": []},
    {"id": "frame-b", "label": "B", "title": "Bench", "winner": "SAMPLE-01-BEAT-B.png",
     "description": "Courier reaches the bench.", "required": True, "generationPackages": []},
]
project["mediaAssets"] = [{
    "id": "blocking-frame-b",
    "file": "SAMPLE-01_FRAME_B_BLOCKING.png",
    "storagePath": "media/SAMPLE-01_FRAME_B_BLOCKING.png",
    "title": "SAMPLE-01 - Frame B blocking",
    "kind": "image",
    "links": [{"id": "link-blocking-b", "targetType": "shot", "targetId": SHOT,
               "role": "blocking-frame", "blockingState": "returned", "blockingVersion": "B01",
               "blockingFrameId": "frame-b", "generationInput": False, "order": 1}],
}]
project_file.write_text(json.dumps(project, indent=2), encoding="utf-8")


def step(**extra):
    base = {"startedAt": iso(-600), "updatedAt": iso(-540)}
    base.update(extra)
    return base


runs = [
    # Parked at a human gate, exactly as v627PauseForHumanReview leaves it on a run
    # persisted BEFORE this batch: needs-review, updatedAt stamped, no completedAt. The
    # reader has to freeze this one without help from the writer.
    {"id": "state-waiting", "revision": 2, "type": "shot-chain", "targetId": SHOT, "scope": "stills",
     "label": "Parked at a human gate", "status": "awaiting-review", "stage": "Approve Frame A",
     "phase": "human-review", "summary": "CineBraid paused before approval.",
     "createdAt": iso(-600), "updatedAt": iso(-540), "completedAt": "", "runnerId": "", "leaseExpiresAt": "",
     "current": {"stepKey": "review", "label": "Frame A review", "phase": "human-review"},
     "config": {"frameRounds": 2, "maxImages": 21}, "usage": {},
     "steps": {"review": step(key="review", kind="frame-review", status="needs-review",
                              label="Frame A review", frameId="frame-a", attempt=1, maxAttempts=2,
                              files=["SAMPLE-01-ARRIVAL.png"])},
     "logs": []},
    # A closed tab left this at `running`; its lease lapsed nine minutes ago.
    {"id": "state-orphan", "revision": 1, "type": "shot-chain", "targetId": "SAMPLE-02", "scope": "stills",
     "label": "Abandoned by a closed tab", "status": "running", "stage": "Generating Frame A",
     "summary": "", "createdAt": iso(-1200), "updatedAt": iso(-900), "completedAt": "",
     "runnerId": "runner-that-went-away", "leaseAcquiredAt": iso(-1200), "leaseExpiresAt": iso(-540),
     "heartbeatAt": iso(-840), "current": {"stepKey": "generate"}, "config": {"maxImages": 21}, "usage": {},
     "steps": {"generate": step(key="generate", kind="generation", status="running", label="Generate Frame A",
                                startedAt=iso(-1200), updatedAt=iso(-900))},
     "logs": []},
    # Genuinely leased and running, so the repair cannot pass by calling everything idle.
    {"id": "state-live", "revision": 1, "type": "shot-chain", "targetId": "SAMPLE-03", "scope": "stills",
     "label": "Genuinely running", "status": "running", "stage": "Generating",
     "summary": "", "createdAt": iso(-120), "updatedAt": iso(-30), "completedAt": "",
     "runnerId": "runner-alive", "leaseAcquiredAt": iso(-120), "leaseExpiresAt": iso(600),
     "heartbeatAt": iso(-30), "current": {"stepKey": "generate"}, "config": {"maxImages": 21}, "usage": {},
     "steps": {"generate": step(key="generate", kind="generation", status="running", label="Generate Frame A",
                                startedAt=iso(-120), updatedAt=iso(-30))},
     "logs": []},
    # The row that renders a DISMISS control.
    {"id": "state-failed", "revision": 1, "type": "scene-chain", "targetId": "SC-01", "scope": "correction:pkg",
     "label": "Dismissable failure", "status": "failed", "stage": "Needs attention",
     "summary": "Correction failed.", "createdAt": iso(-2000), "updatedAt": iso(-1900), "completedAt": "",
     "current": {"stepKey": "generate"}, "config": {"maxImages": 9}, "usage": {},
     "steps": {"generate": step(key="generate", kind="generation", status="failed", label="Generate correction",
                                error="Missing source provenance.", startedAt=iso(-2000), updatedAt=iso(-1900))},
     "logs": []},
]
(project_dir / "automation-runs.json").write_text(
    json.dumps({"schemaVersion": 2, "updatedAt": iso(0), "runs": runs}, indent=2), encoding="utf-8")

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root),
         "FAL_KEY": "production-state-honesty-qa-placeholder-not-a-credential"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
        # The blocking console lives under the shot's "look" task.
        page.add_init_script(
            "try { localStorage.setItem('cinebraid-focused:%s:shot-task:%s', 'look'); } catch (e) {}" % (SLUG, SHOT))
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=20000)
        # Past one refresh tick, so every surface is painted from the loaded runs.
        page.wait_for_timeout(REFRESH_MS + 700)
        assert not page_errors, f"the workspace raised uncaught errors: {page_errors}"

        # ---- A/E. only leased, running work is active -------------------------------
        counted = page.evaluate("""() => {
            const status = v6602ActivityStatus();
            const button = document.getElementById('automation-activity-toggle');
            return {
              label: status.label, tone: status.tone,
              buttonSpins: !!button?.querySelector('.spin'),
              active: (AUTOMATION_RUNS || []).filter(v670MachineActiveRun).map(r => r.id),
              waiting: (AUTOMATION_RUNS || []).filter(v670WaitingForHumanRun).map(r => r.id),
            };
        }""")
        assert counted["active"] == ["state-live"], \
            f"A/E only the leased running run may count as active, got {counted['active']}"
        assert sorted(counted["waiting"]) == ["state-orphan", "state-waiting"], \
            f"A/E the human gate and the lapsed lease must both read as waiting, got {counted['waiting']}"
        assert counted["label"] == "Activity · 1 active", f"A/E toolbar said {counted['label']!r}"
        findings.append("A/E: a human gate and an abandoned run leave the Active count; a leased run keeps it")

        drawer = page.evaluate("""() => {
            openGlobalAutomationActivity();
            const html = document.getElementById('automation-activity-drawer').innerHTML;
            const active = (html.split('ACTIVE NOW')[1] || '').split('WAITING FOR YOU')[0];
            const waiting = (html.split('WAITING FOR YOU')[1] || '').split('PREVIOUS FAILURES')[0];
            return {
              heading: (document.querySelector('#automation-activity-drawer h2')?.textContent || '').trim(),
              activeIds: ['state-live', 'state-waiting', 'state-orphan'].filter(id => active.includes(id)),
              waitingIds: ['state-live', 'state-waiting', 'state-orphan'].filter(id => waiting.includes(id)),
              waitingSpinners: (waiting.match(/class="spin"/g) || []).length,
              waitingSaysSo: waiting.includes('Waiting for you'),
              waitingNamesResume: waiting.includes('Resume Run'),
            };
        }""")
        assert drawer["activeIds"] == ["state-live"], f"A/E ACTIVE NOW held {drawer['activeIds']}"
        assert sorted(drawer["waitingIds"]) == ["state-orphan", "state-waiting"], \
            f"A/E WAITING FOR YOU held {drawer['waitingIds']}"
        assert drawer["waitingSpinners"] == 0, "A/E nothing waiting on a person may spin"
        assert drawer["waitingSaysSo"], "A/E a waiting row must say so in words"
        assert drawer["waitingNamesResume"], "E an abandoned run must name the action that restarts it"
        assert drawer["heading"] == "1 operation active", f"A/E drawer heading said {drawer['heading']!r}"
        findings.append(f"A/E: the drawer separates ACTIVE NOW from WAITING FOR YOU and heads {drawer['heading']!r}")

        # ---- B. the clock stops at the gate and keeps running for live work ---------
        def clocks():
            return page.evaluate("""() => {
                const parked = (AUTOMATION_RUNS || []).find(r => r.id === 'state-waiting').steps.review;
                const live = (AUTOMATION_RUNS || []).find(r => r.id === 'state-live').steps.generate;
                return { parked: v670StepElapsedLabel(parked), live: v670StepElapsedLabel(live) };
            }""")

        first = clocks()
        page.wait_for_timeout(3000)
        second = clocks()
        assert first["parked"] == second["parked"], \
            f"B the human-gate clock must stop ({first['parked']} -> {second['parked']})"
        assert first["live"] != second["live"], \
            f"B genuinely running work must keep counting ({first['live']} -> {second['live']})"
        findings.append(f"B: across 3s the parked clock held at {first['parked']} while live work ran "
                        f"{first['live']} -> {second['live']}")

        # ---- C. the drawer refresh no longer detaches a control ---------------------
        def hovered_dismiss():
            page.evaluate("() => { closeGlobalAutomationActivity(); openGlobalAutomationActivity(); }")
            page.wait_for_timeout(400)
            handle = page.query_selector('[data-run-id="state-failed"] button.ghost-btn')
            assert handle, "C setup: the failed run must render a DISMISS control"
            handle.hover()
            return handle

        dismiss = hovered_dismiss()
        survived = []
        for _ in range(3):
            page.wait_for_timeout(REFRESH_MS + 700)
            survived.append(dismiss.evaluate("el => el.isConnected"))
        assert all(survived), f"C the control must survive the polling refresh, got {survived}"
        findings.append(f"C: a hovered DISMISS survived {len(survived)} consecutive {REFRESH_MS} ms refreshes")

        # ---- C2. THE ROW SURVIVES ITS OWN CONTENT CHANGING -------------------------
        # EVERY SELECTOR BELOW IS SCOPED TO THE DRAWER, and has to be from O3 onwards.
        # The Activity Terminal in the bottom dock keys its rows with the SAME
        # data-activity-key namespace — deliberately, so the two surfaces can be compared
        # run for run — and the dock precedes the drawer in document order, so an
        # unscoped querySelector returns the Terminal's row and these assertions would be
        # made about the wrong surface entirely.
        # An unchanged row surviving is the easy half and never needed protecting. A run
        # rewrites its label, its step text or its error EXACTLY when the director is
        # reaching for DISMISS, and the first version of this repair replaced the whole
        # row whenever its markup differed by a byte - taking the button with it. Driven
        # here rather than waited for, so the result is deterministic.
        row = page.query_selector('#automation-activity-drawer [data-activity-key="run:state-failed"]')
        assert row, "C2 setup: the failed run must render a keyed row"
        before = page.evaluate("""() => {
            const node = document.querySelector('#automation-activity-drawer [data-activity-key="run:state-failed"]');
            return { key: node.getAttribute('data-activity-key'), text: node.innerText };
        }""")
        page.evaluate("""() => {
            const run = (AUTOMATION_RUNS || []).find(r => r.id === 'state-failed');
            run.label = 'Dismissable failure (retry 2)';
            run.steps.generate.error = 'Missing source provenance. Retry scheduled.';
            v641RenderActivityDrawer();
        }""")
        after = page.evaluate("""() => {
            const node = document.querySelector('#automation-activity-drawer [data-activity-key="run:state-failed"]');
            return { key: node.getAttribute('data-activity-key'), text: node.innerText,
                     buttons: [...node.querySelectorAll('button')].map(b => b.textContent.trim()) };
        }""")
        assert after["key"] == before["key"] == "run:state-failed", \
            f"C2 the key must not move: {before['key']!r} -> {after['key']!r}"
        assert row.evaluate("el => el.isConnected"), "C2 the keyed row node must survive its content changing"
        assert dismiss.evaluate("el => el.isConnected"), \
            "C2 an unchanged control inside a changed row must keep its node identity"
        assert dismiss.evaluate("el => el.textContent.trim()") == "DISMISS", \
            "C2 the surviving handle must still be the DISMISS control"
        assert dismiss.evaluate(
            "el => el === document.querySelector('#automation-activity-drawer [data-activity-key=\\\"run:state-failed\\\"] button.ghost-btn')"), \
            "C2 the surviving handle must still be the node the drawer renders"
        # ...and the change must genuinely have landed, not been swallowed by the patch.
        assert "retry 2" in after["text"].lower(), f"C2 the changed label must display: {after['text']!r}"
        assert "Retry scheduled" in after["text"], f"C2 the changed error must display: {after['text']!r}"
        assert after["text"] != before["text"], "C2 the row must actually have updated"
        assert "DISMISS" in after["buttons"], "C2 the row must still offer its actions"
        findings.append("C2: a keyed row whose label and error changed kept its node and its DISMISS control, "
                        "and both changes are on screen")

        # ---- C2, NEGATIVE CONTROL --------------------------------------------------
        # Count the section's own <header> as a row again. That is the bug this repair
        # had first time: no header carries data-activity-key, so the keyed path became
        # unreachable and every section fell back to a whole-body rewrite. It hid
        # because an UNCHANGED row still survived - the rewrite was skipped when the
        # markup matched - so only a changed row exposes it. Restored in memory.
        page.evaluate("""() => {
            window.__cbSectionRows = v670SectionRows;
            window.v670SectionRows = (node) => [...(node?.children || [])];
        }""")
        broken_row = page.query_selector('#automation-activity-drawer [data-activity-key="run:state-failed"]')
        assert broken_row, "C2 control setup: the keyed row must be present before the probe"
        page.evaluate("""() => {
            const run = (AUTOMATION_RUNS || []).find(r => r.id === 'state-failed');
            run.label = 'Dismissable failure (retry 3)';
            v641RenderActivityDrawer();
        }""")
        broken_attached = broken_row.evaluate("el => el.isConnected")
        page.evaluate("() => { window.v670SectionRows = window.__cbSectionRows; }")
        assert not broken_attached, \
            "C2 NEGATIVE CONTROL DID NOT FIRE: with the section header counted as a row the changed row " \
            "survived anyway, so C2 is not testing the keyed path."
        findings.append("C2: negative control - counting the section header as a row makes the changed row "
                        "detach again, proving the keyed path is what saves it")
        # Re-acquire: the control above legitimately destroyed the live nodes.
        dismiss = page.query_selector('[data-run-id="state-failed"] button.ghost-btn')
        assert dismiss, "C2 control teardown: the DISMISS control must render again"

        # ...and a control that survived three refreshes AND a content change must act.
        dismiss.click()
        page.wait_for_timeout(1000)
        dismissed = page.evaluate("() => document.querySelectorAll('[data-run-id=\"state-failed\"]').length === 0")
        assert dismissed, "C the surviving control must still dismiss its run when clicked"
        findings.append("C: clicking the long-hovered control still archived the run")

        # ---- C, NEGATIVE CONTROL ----------------------------------------------------
        # Put the whole-innerHTML painter back, in memory, and require the detachment to
        # return. Without this the survival assertion above could pass for any reason -
        # a drawer that stopped refreshing at all would satisfy it too.
        control = page.evaluate("""async () => {
            const runs = (AUTOMATION_RUNS || []);
            runs.push({ id: 'control-failed', revision: 1, type: 'scene-chain', targetId: 'SC-01',
              scope: 'correction:pkg', label: 'Negative control failure', status: 'failed',
              stage: 'Needs attention', summary: 'Control.', createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(), config: {}, usage: {},
              steps: { generate: { key: 'generate', kind: 'generation', status: 'failed',
                                   label: 'Generate', error: 'Control.' } }, logs: [] });
            window.v670PaintDrawer = (drawer, shell) => { drawer.innerHTML = shell; };
            v641RenderActivityDrawer();
            return document.querySelectorAll('[data-run-id="control-failed"]').length;
        }""")
        assert control == 1, "C control setup: the control row must render before the probe"
        controlled = page.query_selector('[data-run-id="control-failed"] button.ghost-btn')
        assert controlled, "C control setup: the control row must render a DISMISS control"
        # No hover here, deliberately. The control has just made this row destructible,
        # so hovering it races the very behaviour it exists to demonstrate: on the CI
        # runner a 3500 ms refresh landed inside the hover's stability wait and
        # Playwright raised "Element is not attached to the DOM" before the assertion
        # below could observe the detachment. Detachment is a property of the node, not
        # of pointing at it - so drive one repaint and ask the handle directly. The
        # positive path above is where hovering carries meaning, and it still hovers.
        page.evaluate("() => v641RenderActivityDrawer()")
        control_attached = controlled.evaluate("el => el.isConnected")
        assert not control_attached, \
            "C NEGATIVE CONTROL DID NOT FIRE: with the whole-innerHTML painter restored the control " \
            "survived anyway, so the survival assertion above is not testing the painter."
        findings.append("C: negative control - restoring the whole-innerHTML painter detaches the control again")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=20000)
        page.wait_for_timeout(REFRESH_MS + 700)

        # ---- D. a visible frame-bound attempt has a reviewer that can read it -------
        blocking = page.evaluate("""shotId => {
            const s = shotById(shotId);
            const pools = blockingAttemptPools(s);
            const panel = document.getElementById('main').innerHTML;
            return {
              displayed: pools.rows.map(r => r.asset.id),
              opening: pools.opening.map(r => r.asset.id),
              frameB: v664BlockingRowsForReview(s, 'frame-b').map(r => r.asset.id),
              frameA: v664BlockingRowsForReview(s, 'frame-a').map(r => r.asset.id),
              offersFrameReview: panel.includes('REVIEW FRAME B WITH AI'),
              offersDeadReviewAll: panel.includes('REVIEW ALL WITH AI'),
            };
        }""", SHOT)
        assert blocking["displayed"] == ["blocking-frame-b"], f"D panel displayed {blocking['displayed']}"
        assert blocking["opening"] == [], "D the opening pool must stay free of frame-bound attempts"
        assert blocking["frameB"] == ["blocking-frame-b"], "D the frame's own reader must see its attempt"
        assert blocking["frameA"] == [], "D another frame's reader must not see it"
        assert blocking["offersFrameReview"], "D a visible frame-bound attempt must have a reviewer"
        assert not blocking["offersDeadReviewAll"], \
            "D the shot console must not offer REVIEW ALL over an empty opening pool"
        findings.append("D: the shot console no longer offers a review it cannot perform; the frame's own reviewer does")

        outcome = page.evaluate("""async shotId => {
            const calls = [];
            // Vision readiness is a separate gate and not what is under test; the
            // question is which attempts the frame reviewer sends and where the answer
            // is stored. No provider is reached - the review route is answered here.
            window.capabilityState = () => ({ ready: true, label: 'Vision', message: '' });
            const original = window.__cinebraidOriginalFetch || window.fetch;
            window.fetch = async (url, options) => {
              if (String(url).includes('/api/llm/review')) {
                calls.push(JSON.parse(options.body));
                return new Response(JSON.stringify({ files: ['SAMPLE-01_FRAME_B_BLOCKING.png'],
                  review: { suggested: 1, rationale: 'stub', reviews: [
                    { n: 1, score: 88, pass: true, explicitPass: true, explicitScore: true,
                      notes: 'Clear endpoint.' }] } }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } });
              }
              return original(url, options);
            };
            await reviewBlockingAttempts(shotId, 'frame-b', false);
            return {
              calls,
              toast: (document.getElementById('toast')?.textContent || '').trim(),
              badge: blockingAttemptReviewFor(shotById(shotId), 'blocking-frame-b', 'frame-b'),
            };
        }""", SHOT)
        assert outcome["calls"] and outcome["calls"][0]["frameId"] == "frame-b", \
            f"D the frame reviewer must send its own frame's attempts, got {outcome['calls']}"
        assert outcome["calls"][0]["fileNames"] == ["SAMPLE-01_FRAME_B_BLOCKING.png"], \
            f"D the frame reviewer must send the attempt bound to it, got {outcome['calls'][0]['fileNames']}"
        assert "Add at least one blocking attempt first" not in outcome["toast"], \
            f"D the dogfood refusal must be gone, got {outcome['toast']!r}"
        assert outcome["badge"] and outcome["badge"]["pass"], \
            "D the stored review must be readable by the card that displays the attempt"
        findings.append("D: the frame reviewer reaches the review route and its result reads back on the attempt card")

        browser.close()

    assert not paid_calls, f"a paid route was called: {paid_calls}"
    assert not offsite, f"a request left the machine: {offsite}"
    assert not page_errors, f"the workspace raised uncaught errors: {page_errors}"
    print("\n".join(f"  · {line}" for line in findings))
    print("Real Chromium production-state honesty check passed: machine-active is leased running work only, "
          "a human gate and an abandoned run read as WAITING FOR YOU without a spinner, the elapsed clock stops at "
          "the gate and keeps running for live work, a hovered control survives repeated drawer refreshes and its "
          "negative control proves the painter is why, and a frame-bound blocking attempt is reviewable by the "
          "reader that displays it. No paid call, no offsite request.")
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
