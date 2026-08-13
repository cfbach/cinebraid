#!/usr/bin/env python3
"""The declared stage model, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. Everything semantic about O1 is proven in Node by
tests/stage-model.js. Exactly one claim cannot be: that the DOM is no longer the
workflow model. That is a statement about a live document - what is actually in the
page, how many children the work stack really has, and what happens when somebody
reorders or inserts nodes into it - and tests/render-harness.js FakeElement neither
parses HTML nor tracks node identity.

WHAT THIS SUITE ESTABLISHES, and nothing more:

  1. The declared model is genuinely loaded in the page, not merely present on disk.
  2. The shot workspace still renders, and its taskbar carries the DECLARED stages in
     the DECLARED order with the DECLARED labels.
  3. Selecting a stage still works, and survives a normal re-render.
  4. The rendered children CANNOT be the source of the stage list - the work stack holds
     one child while the taskbar declares five - and inserting or reordering nodes in the
     workspace changes neither the stage list nor the selection.
  5. The blocking-automation handoff, whose write went to a key nothing read before O1,
     now actually moves the workspace.

It carries its own NEGATIVE CONTROL: the DOM-inference helpers that still serve the
scene and legacy entity routes are pointed at the shot workspace inside the running
page, and the suite proves they produce a different, wrong answer - so "the declared
stages match the DOM" can never pass by coincidence.

NOTHING HERE IS PAID. Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are
never touched; the route guard aborts the paid route and anything off-loopback.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Declared stage model real-browser audit"
sync_playwright = require_browser(LABEL)

SHOT = "SAMPLE-01"
SLUG = "dogfood-sample"
PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-stage-model-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"

port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root)},
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
        page.add_init_script(
            "try { localStorage.setItem('cinebraid-focused:%s:shot-task:%s', 'frames'); } catch (e) {}" % (SLUG, SHOT))
        page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
        page.wait_for_selector(".bounded-shot-taskbar", timeout=20000)
        page.wait_for_timeout(400)
        assert not page_errors, f"the shot workspace raised uncaught errors: {page_errors}"

        # ---- 1. the declaration is loaded, and it is the same object the app reads ----
        declared = page.evaluate("""() => ({
            present: Array.isArray(window.SHOT_STAGES),
            ids: (window.SHOT_STAGE_IDS || []).slice(),
            labels: (window.SHOT_STAGES || []).map(s => s.label),
            orders: (window.SHOT_STAGES || []).map(s => s.order),
            scope: window.SHOT_STAGE_SCOPE,
            frozen: (window.SHOT_STAGES || []).every(s => Object.isFrozen(s)),
        })""")
        assert declared["present"], "the declared stage model did not load in the browser"
        assert declared["frozen"], "the declaration must reach the browser frozen"
        assert declared["scope"] == "shot-task", f"unexpected declared scope {declared['scope']}"
        assert len(declared["ids"]) >= 2, "the browser received an empty declaration"
        findings.append(f"1. declaration loaded in Chromium: {' -> '.join(declared['ids'])}")

        # ---- 2. the taskbar renders the declared stages, in declared order ------------
        rendered = page.evaluate("""() => {
            const nav = document.querySelector('.bounded-shot-taskbar');
            const buttons = [...nav.querySelectorAll('button[onclick]')];
            return {
              count: buttons.length,
              ids: buttons.map(b => (b.getAttribute('onclick').match(/'([a-z-]+)'\\)$/) || [])[1] || ''),
              labels: buttons.map(b => b.querySelector('b')?.textContent || ''),
              selected: document.querySelector('[data-selected-task]')?.dataset.selectedTask || '',
              stackChildren: document.querySelector('.guided-work-stack')?.children.length ?? -1,
            };
        }""")
        assert rendered["ids"] == declared["ids"], \
            f"2. the taskbar order is not the declared order: {rendered['ids']} vs {declared['ids']}"
        assert rendered["labels"] == declared["labels"], \
            f"2. the taskbar labels are not the declared labels: {rendered['labels']}"
        assert rendered["selected"] == "frames", f"2. stored selection was not honoured, got {rendered['selected']}"
        findings.append(f"2. taskbar renders {rendered['count']} declared stages in declared order")

        # ---- 3. THE RENDERED CHILDREN CANNOT BE THE STAGE LIST ------------------------
        # The bounded workspace renders ONE stage's body, and that body's own panel count
        # has nothing to do with how many stages exist - Frames alone renders two. Any
        # model derived from the work stack's children would therefore count something
        # that is not the workflow. This is the arithmetic that makes DOM inference
        # impossible here rather than merely absent.
        assert rendered["stackChildren"] >= 1, "3. the selected stage rendered no body at all"
        assert rendered["stackChildren"] != rendered["count"], \
            f"3. the work stack happens to hold exactly as many children as there are stages " \
            f"({rendered['stackChildren']}), so this suite cannot tell the two apart"
        findings.append(f"3. work stack holds {rendered['stackChildren']} children of one stage while {rendered['count']} stages are declared")

        # ---- 4. selecting a stage still works, for every declared stage ---------------
        for stage_id, label in zip(declared["ids"], declared["labels"]):
            page.evaluate("id => selectBoundedTask('shot-task', %s, id)" % json.dumps(SHOT), stage_id)
            page.wait_for_timeout(250)
            state = page.evaluate("""() => ({
                selected: document.querySelector('[data-selected-task]')?.dataset.selectedTask || '',
                body: document.querySelector('.guided-work-stack')?.dataset.boundedTask || '',
                marked: document.querySelector('.bounded-shot-taskbar button.selected b')?.textContent || '',
            })""")
            assert state["selected"] == stage_id, f"4. selecting {stage_id} left the workspace on {state['selected']}"
            assert state["body"] == stage_id, f"4. selecting {stage_id} rendered the {state['body']} body"
            assert state["marked"] == label, f"4. selecting {stage_id} marked '{state['marked']}' in the taskbar"
        findings.append(f"4. all {len(declared['ids'])} declared stages select and render in the live page")

        # ---- 5. stage semantics survive a normal re-render ----------------------------
        page.evaluate("() => selectBoundedTask('shot-task', %s, 'motion')" % json.dumps(SHOT))
        page.wait_for_timeout(250)
        page.evaluate("() => route()")
        page.wait_for_timeout(400)
        after = page.evaluate("""() => {
            const nav = document.querySelector('.bounded-shot-taskbar');
            return {
              ids: [...nav.querySelectorAll('button[onclick]')].map(b => (b.getAttribute('onclick').match(/'([a-z-]+)'\\)$/) || [])[1] || ''),
              selected: document.querySelector('[data-selected-task]')?.dataset.selectedTask || '',
              bars: document.querySelectorAll('.focused-taskbar').length,
            };
        }""")
        assert after["ids"] == declared["ids"], "5. a re-render changed the stage order"
        assert after["selected"] == "motion", f"5. a re-render lost the selection, got {after['selected']}"
        assert after["bars"] == 1, f"5. a re-render produced {after['bars']} taskbars"
        findings.append("5. stage list and selection survive a normal re-render, with one taskbar")

        # ---- 6. inserting and reordering nodes changes nothing semantic ---------------
        # A presentational node is inserted into the work stack and the taskbar's buttons
        # are physically reversed, then the focused-workspace enhancer is invited to run.
        # Before O1 this branch would have rebuilt the shot's stages from these children.
        page.evaluate("""() => {
            const stack = document.querySelector('.guided-work-stack');
            const decoy = document.createElement('details');
            decoy.className = 'creation-card';
            decoy.innerHTML = '<summary><b>Decoy panel</b></summary><p>Not a stage.</p>';
            stack.insertBefore(decoy, stack.firstChild);
            const nav = document.querySelector('.bounded-shot-taskbar');
            [...nav.children].reverse().forEach(node => nav.appendChild(node));
            window.enhanceFocusedWorkspace?.();
        }""")
        page.wait_for_timeout(300)
        disturbed = page.evaluate("""() => ({
            bars: document.querySelectorAll('.focused-taskbar').length,
            selected: document.querySelector('[data-selected-task]')?.dataset.selectedTask || '',
            body: document.querySelector('.guided-work-stack')?.dataset.boundedTask || '',
        })""")
        assert disturbed["bars"] == 1, \
            f"6. disturbing the DOM produced {disturbed['bars']} taskbars — an inferred one was built"
        assert disturbed["selected"] == "motion", \
            f"6. disturbing the DOM changed the selected stage to {disturbed['selected']}"
        assert disturbed["body"] == "motion", "6. disturbing the DOM changed which workspace is rendered"
        # And the declaration is the authority on the way back: one re-render restores the
        # order the DOM was just holding backwards.
        page.evaluate("() => route()")
        page.wait_for_timeout(400)
        restored = page.evaluate("""() => [...document.querySelectorAll('.bounded-shot-taskbar button[onclick]')]
            .map(b => (b.getAttribute('onclick').match(/'([a-z-]+)'\\)$/) || [])[1] || '')""")
        assert restored == declared["ids"], f"6. the declared order was not restored, got {restored}"
        findings.append("6. inserting a panel and reversing the taskbar changed no stage identity, order or selection")

        # ---- 7. the declared panel handoff moves the workspace ------------------------
        # selectGuidedPanelTask is the one helper every cross-workspace action routes
        # through, and it now resolves the target stage and its sub-view from the
        # declaration. It is exercised directly here: no automation runs, and no provider
        # is contacted. What it proves is that a panel key names a stage the live
        # workspace actually moves to, which is the property callers depend on.
        page.evaluate("() => selectBoundedTask('shot-task', %s, 'deliver')" % json.dumps(SHOT))
        page.wait_for_timeout(250)
        page.evaluate("""() => {
            const shot = shotById(%s);
            selectGuidedPanelTask(shot, 'blocking');
            route();
        }""" % json.dumps(SHOT))
        page.wait_for_timeout(400)
        handoff = page.evaluate("""() => ({
            selected: document.querySelector('[data-selected-task]')?.dataset.selectedTask || '',
            stored: localStorage.getItem('cinebraid-focused:%s:shot-task:%s') || '',
            view: document.querySelector('.entity-subworkspace-tabs button.selected')?.textContent || '',
        })""" % (SLUG, SHOT))
        assert handoff["selected"] == "look", \
            f"7. the blocking handoff left the workspace on {handoff['selected']}"
        assert handoff["stored"] == "look", \
            f"7. the handoff wrote '{handoff['stored']}' to the key the workspace reads"
        assert "Blocking" in handoff["view"], \
            f"7. the handoff did not land on the blocking sub-view, got '{handoff['view']}'"
        findings.append("7. the blocking handoff now writes the key the workspace reads and moves it to Look & blocking")

        # ---- NEGATIVE CONTROL --------------------------------------------------------
        # The DOM-inference helpers still serve the scene and legacy entity routes. Point
        # them at the shot workspace and they produce a DIFFERENT, WRONG answer - which is
        # what makes every assertion above a real check rather than a coincidence. This
        # runs last because taskIdForElement stamps data-task-id onto the nodes it reads.
        control = page.evaluate("""() => {
            const focused = window.__CINEBRAID_FOCUSED;
            const stack = document.querySelector('.guided-work-stack');
            const kids = [...stack.children].filter(el => el.matches('details,section,.creation-card,.automation-card'));
            return {
              available: !!focused && typeof focused.taskIdForElement === 'function',
              inferred: kids.map((el, i) => focused.taskIdForElement(el, i)),
            };
        }""")
        assert control["available"], "the DOM-inference helpers must still exist for the scene and entity routes"
        assert control["inferred"] != declared["ids"], \
            "NEGATIVE CONTROL DID NOT FIRE: DOM inference produced the declared stage list, so this suite cannot tell the two apart"
        findings.append(f"NC. DOM inference over the same workspace yields {control['inferred'] or '[]'}, not the declared {len(declared['ids'])} stages")

        assert not page_errors, f"the page raised uncaught errors: {page_errors}"

    assert not offsite, f"requests attempted to leave this machine: {offsite}"
    assert not paid_calls, f"a paid route was called: {paid_calls}"

    print("\n".join(findings))
    print("declared stage model real-browser audit passed — no offsite request, no paid call")
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
