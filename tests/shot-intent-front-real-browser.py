#!/usr/bin/env python3
"""Dogfood remediation — SHOT INTENT AT THE FRONT, in a real Chromium.

WHY A BROWSER IS NEEDED. tests/shot-intent-front.js proves the derivations, the fact
record and the rendered markup in Node, and drives the shipped handlers inside the render
harness. Five claims cannot be proven there, and they are the five the dogfood pass
actually reported:

  1  CLICKING "+ Add" ON THE SHOTS PAGE really goes to New Shot. The harness can call
     openContextualAdd(); it cannot press the button that is on the page, and the defect
     was that the button on the page asked a question it had already been given.
  2  THE GLOBAL ADD IN THE SHELL still asks. That control lives in index.html chrome
     rather than in #main, so it is only reachable here.
  3  A SHOT CREATED THROUGH THE REAL FORM, left undecided, is written to disk with NO
     deliveryRoute key — read back out of the project file the server saved, after the
     debounce, rather than out of an in-memory object.
  4  THE WORKSPACE THAT SHOT LANDS ON carries no fabricated frame debt: no "Required
     frames 0/1", no PRODUCE THE FRAME button, the intent control expanded and saying
     the route was not chosen, and the reference controls in front of the filmmaker.
  5  CHOOSING AND CHANGING THE ROUTE from the real <select> moves the requirements and
     never the media, and every step survives the shipped save. This is the brief's
     human-smoke target, performed.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a "nothing was fabricated" assertion that
cannot fail is worth nothing:

  N1 puts the fabricated frame debt back on screen and requires section 4's assertion
     to catch it.
  N2 sends the Shots-page Add back through the generic chooser and requires section 1's
     assertion to catch it.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched. Every generation route is aborted before
it reaches the server, let alone a provider, and any off-site request fails the suite.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Shot intent at the front real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
GENERATION_ROUTE = "/api/generation/"

page_errors, offsite, paid_calls, generation_calls = [], [], [], []
findings = []

# What the filmmaker types. The brief's own smoke sentence, so the copy under test and
# the copy in the receipt are the same words.
SHOT_TITLE = "Kai crosses the docking bay"
SHOT_DESC = "Kai walks through the crowded docking bay while Mara's ship lifts away behind him."

ROUTES = ["t2v", "i2v", "flf", "r2v", "hybrid"]

# The shot workspace, read out of the live DOM rather than recomputed.
SHOT_STATE = """() => {
  const control = document.querySelector('.shot-intent-control');
  const summary = document.querySelector('.shot-command-summary');
  const tiles = summary ? [...summary.querySelectorAll('article')].map((row) => ({
    label: (row.querySelector('span') || {}).textContent || '',
    value: (row.querySelector('b') || {}).textContent || '',
    note: (row.querySelector('small') || {}).textContent || '',
  })) : [];
  const primary = document.querySelector('#main .shot-primary-action');
  const inputs = document.querySelector('#main details.guided-inputs-card');
  return {
    intentPresent: !!control,
    intentOpen: !!(control && control.open),
    intentReading: control ? control.dataset.shotIntentReading : '',
    intentRoute: control ? control.dataset.shotIntent : '',
    intentSummary: control ? (control.querySelector('summary span') || {}).textContent || '' : '',
    undeclaredNote: control ? [...control.querySelectorAll('[data-shot-intent-undeclared="1"]')].map((n) => n.textContent.trim()) : [],
    routeDeclaredAttr: summary ? summary.dataset.shotRouteDeclared : '',
    tiles,
    primary: primary ? primary.textContent.trim() : '',
    primaryCount: document.querySelectorAll('#main .shot-primary-action').length,
    selectedTask: (document.querySelector('#main [data-selected-task]') || {dataset:{}}).dataset.selectedTask || '',
    inputsPresent: !!inputs,
    inputsOpen: !!(inputs && inputs.open),
    attachmentControls: document.querySelectorAll('#main .guided-input-tray').length,
    mainText: (document.getElementById('main') || {}).innerText || '',
  };
}"""

FRAME_STATE = """(shotId) => {
  const shot = P.shots.find((row) => row.id === shotId);
  const readiness = shotReadinessFor(shot);
  return {
    storedRoute: Object.prototype.hasOwnProperty.call(shot, 'deliveryRoute') ? shot.deliveryRoute : null,
    reading: readShotRoute(shot).reading,
    requiredFrames: readiness.units.filter((u) => u.kind === 'frame' && u.required).map((u) => u.id),
    allFrames: readiness.units.filter((u) => u.kind === 'frame').map((u) => u.id),
    action: readiness.nextAction.code,
    status: readiness.status,
    keyframeWinners: (shot.keyframes || []).map((f) => f.winner || ''),
    candidateCount: (shot.candidateFiles || []).length,
    clipCount: (shot.clips || []).length,
  };
}"""


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-shot-intent-front-"))
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
        findings.append("0. Chromium launched against a sandboxed CineBraid server")
        context = browser.new_context(viewport={"width": 1600, "height": 1000})

        def guard(route):
            """No request leaves this machine, and nothing under /api/generation/ is
            called at all — not the plan, not the options, and not the job that bills."""
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if GENERATION_ROUTE in url:
                generation_calls.append(f"{route.request.method} {url}")
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if url.startswith("https://fonts."):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def project_file_for_page():
            """THE FILE THE PAGE IS ACTUALLY BOUND TO. The sandbox may hold more than one
            project, and picking the first one alphabetically would poll a document nothing
            under test ever writes."""
            slug = page.evaluate("() => ACTIVE_PROJECT_SLUG")
            return projects_root / str(slug) / "project.json"

        def saved_shot(shot_id, until=None, timeout=8.0):
            """WHAT THE PROJECT ON DISK SAYS. dirty() debounces for 500ms and then saves,
            so this polls the file the server actually wrote rather than sleeping once.

            `until` is the predicate the caller is waiting FOR. Without it a poll that
            merely finds the row returns the version saved before the edit under test,
            and the assertion after it reads a stale document as a failure."""
            deadline_at = time.time() + timeout
            last = None
            while time.time() < deadline_at:
                try:
                    rows = json.loads(project_file_for_page().read_text(encoding="utf-8"))["shots"]
                except Exception:
                    time.sleep(.15); continue
                row = next((r for r in rows if r["id"] == shot_id), None)
                if row is not None:
                    last = row
                    if until is None or until(row): return row
                time.sleep(.15)
            return last

        def open_shots_board():
            page.goto(f"{base}/#/shots/board", wait_until="domcontentloaded")
            page.wait_for_selector("#main .board-head", timeout=20000)
            page.wait_for_timeout(200)

        # ======================================================= 1 · CONTEXTUAL ADD
        open_shots_board()
        assert not page_errors, f"1. the Shots page raised uncaught errors: {page_errors}"
        page.locator("#main .board-head-actions .add-btn").click()
        page.wait_for_selector("#modal:not(.hidden)", timeout=10000)
        modal = page.locator("#modal").inner_text()
        assert "What are you adding?" not in modal, \
            "1. the Shots page Add must not re-ask which record the filmmaker meant"
        assert "New shot" in modal, f"1. it must open the New Shot form directly, got: {modal[:160]!r}"
        fields = page.evaluate("() => [...document.querySelectorAll('#modal .form-field label')].map((n) => n.textContent)")
        assert any("What happens in this shot?" == text for text in fields), \
            f"1. and must ask what happens in the shot, got {fields}"
        assert not any("still" in text.lower() for text in fields), \
            f"1. no field may assume the shot begins with a still, got {fields}"
        findings.append("1. clicking + Add on the Shots page opens New Shot directly, asking "
                        "'What happens in this shot?' and naming no still")

        # N2 — the same click, with the contextual entry sent back through the chooser.
        page.evaluate("() => { window.__realContextualAdd = window.openContextualAdd; window.openContextualAdd = (k) => openGlobalAdd(k); }")
        page.evaluate("() => closeModal()")
        page.locator("#main .board-head-actions .add-btn").click()
        page.wait_for_selector("#modal:not(.hidden)", timeout=10000)
        assert "What are you adding?" in page.locator("#modal").inner_text(), \
            "N2. precondition: the control must genuinely be the one section 1 asserts about"
        page.evaluate("() => { window.openContextualAdd = window.__realContextualAdd; }")
        page.evaluate("() => closeModal()")
        findings.append("N2. negative control: routing the Shots-page Add back through the chooser is caught "
                        "by the same assertion section 1 relies on")

        # ======================================================= 2 · THE GLOBAL ADD STILL ASKS
        page.locator("#global-add").click()
        page.wait_for_selector("#modal:not(.hidden)", timeout=10000)
        global_modal = page.locator("#modal").inner_text()
        assert "What are you adding?" in global_modal, \
            "2. the shell's own Add must still offer the generic chooser"
        keys = page.evaluate("() => [...document.querySelectorAll('#modal .global-add-grid button')].map((b) => (b.querySelector('b')||{}).textContent)")
        assert keys == ["Shot", "Scene", "Character", "Location", "Prop", "Audio", "New project"], \
            f"2. and must still offer every record it offered before, got {keys}"
        page.evaluate("() => closeModal()")
        findings.append(f"2. the shell's global Add still asks, and still offers all {len(keys)} records")

        # ======================================================= 3 · CREATE, UNDECIDED
        page.locator("#main .board-head-actions .add-btn").click()
        page.wait_for_selector("#modal:not(.hidden) #ff-deliveryRoute", timeout=10000)
        options = page.evaluate("""() => [...document.querySelectorAll('#ff-deliveryRoute option')].map((o) => ({
            value: o.value, label: o.textContent, selected: o.selected }))""")
        assert [row["value"] for row in options] == [""] + ROUTES, \
            f"3. the form offers the canonical vocabulary behind an undecided default, got {options}"
        assert [row["value"] for row in options if row["selected"]] == [""], \
            f"3. and nothing but 'not decided' may be preselected, got {options}"
        assert options[0]["label"] == "Not decided yet", f"3. named plainly, got {options[0]['label']!r}"

        page.fill("#ff-title", SHOT_TITLE)
        page.fill("#ff-desc", SHOT_DESC)
        page.locator("#modal .lock-btn").click()
        page.wait_for_selector("#main .shot-intent-control", timeout=20000)
        undecided_id = page.evaluate("() => P.shots[P.shots.length - 1].id")
        assert not page_errors, f"3. creating a shot raised uncaught errors: {page_errors}"

        row = saved_shot(undecided_id)
        assert row is not None, f"3. the created shot must reach the saved project, {undecided_id}"
        assert "deliveryRoute" not in row, \
            f"3. an undecided shot must be saved with NO deliveryRoute key, got {row.get('deliveryRoute')!r}"
        assert row["desc"] == SHOT_DESC, "3. and the durable description the filmmaker typed"
        findings.append(f"3. {undecided_id} created through the real form with the route left undecided: "
                        "the saved project carries no deliveryRoute key at all")

        # ======================================================= 4 · NO FABRICATED DEBT
        state = page.evaluate(SHOT_STATE)
        frames = page.evaluate(FRAME_STATE, undecided_id)
        assert frames["reading"] == "absent", f"4. the shot must read as undeclared, got {frames['reading']!r}"
        assert frames["requiredFrames"] == [], f"4. and require no frame, got {frames['requiredFrames']}"
        assert len(frames["allFrames"]) == 1, "4. while still carrying the frame record it was created with"
        assert frames["action"] == "declare-shot-route", f"4. the next action is the decision, got {frames['action']!r}"

        assert "Produce the frame" not in state["mainText"], "4. no PRODUCE THE FRAME control may be offered"
        assert "Produce Frame" not in state["mainText"], "4. and no Produce Frame A instruction"
        assert state["primary"].strip().lower() == "choose how this shot is made", \
            f"4. the one primary action is the decision, got {state['primary']!r}"
        assert state["primaryCount"] == 1, f"4. and there is exactly one, got {state['primaryCount']}"
        required_tile = next(row for row in state["tiles"] if row["label"] == "Required frames")
        assert required_tile["value"] == "0/0", f"4. the summary counts no required frame, got {required_tile}"
        assert "not required by this intent" not in required_tile["note"], \
            f"4. and must not call an undeclared shot's silence an intent, got {required_tile['note']!r}"
        assert state["routeDeclaredAttr"] == "0", "4. the summary states the undeclared reading for any reader"
        assert state["intentOpen"] is True, "4. the intent control is expanded, because it is the shot's next question"
        assert any("Execution route not chosen" in note for note in state["undeclaredNote"]), \
            f"4. and says so in the filmmaker's words, got {state['undeclaredNote']}"
        assert state["selectedTask"] == "inputs", f"4. the shot opens on Inputs, got {state['selectedTask']!r}"
        assert state["inputsOpen"] is True, "4. with the source & references panel open"
        assert state["attachmentControls"] >= 1, "4. and the shipped attachment controls actually rendered"
        findings.append("4. the new shot opens with no required frame, no PRODUCE THE FRAME control, "
                        "'0/0' required frames, the route control expanded saying the route was not chosen, "
                        "and the reference controls open on the Inputs stage")

        # N1 — put the fabricated debt back on screen.
        page.evaluate("""() => {
          window.__realFacts = window.shotStageModelFacts;
          window.shotStageModelFacts = (s, takes) => {
            const facts = window.__realFacts(s, takes);
            return { ...facts, requiredFrameCount: (s.keyframes || []).filter((f) => f.required !== false).length };
          };
          route();
        }""")
        page.wait_for_timeout(300)
        fabricated = page.evaluate(SHOT_STATE)
        fabricated_tile = next(row for row in fabricated["tiles"] if row["label"] == "Required frames")
        assert fabricated_tile["value"] == "0/1", \
            f"N1. precondition: the control must genuinely reproduce the reported defect, got {fabricated_tile}"
        page.evaluate("() => { window.shotStageModelFacts = window.__realFacts; route(); }")
        page.wait_for_timeout(300)
        assert next(row for row in page.evaluate(SHOT_STATE)["tiles"] if row["label"] == "Required frames")["value"] == "0/0", \
            "N1. and the assertion section 4 relies on catches it"
        findings.append("N1. negative control: restoring the stored-flag count puts 'Required frames 0/1' back on "
                        "the undeclared shot, and section 4's assertion catches it")

        # ======================================================= 5 · THE SMOKE TARGET, PERFORMED
        def declare(value):
            control = page.locator(".shot-intent-control").first
            if not control.evaluate("node => node.open"):
                control.locator("summary").click()
                page.wait_for_timeout(200)
            page.wait_for_selector(".shot-intent-control select", timeout=10000)
            page.locator(".shot-intent-control select").first.select_option(value)
            page.wait_for_timeout(500)
            page.wait_for_selector(".shot-intent-control", timeout=10000)

        walk = []
        for value in ("r2v", "i2v", "r2v", ""):
            declare(value)
            observed = page.evaluate(FRAME_STATE, undecided_id)
            expected_stored = value if value else None
            assert observed["storedRoute"] == expected_stored, \
                f"5. declaring {value or 'nothing'} must store {expected_stored!r}, got {observed['storedRoute']!r}"
            assert len(observed["allFrames"]) == 1, "5. the frame record survives every route change"
            assert observed["candidateCount"] == 0 and observed["clipCount"] == 0, \
                "5. and no clip or candidate is invented by declaring one"
            walk.append(f"{value or 'undecided'}:{len(observed['requiredFrames'])}")
            saved = saved_shot(undecided_id,
                until=(lambda row, v=value: row.get("deliveryRoute") == v) if value
                      else (lambda row: "deliveryRoute" not in row))
            if value:
                assert saved.get("deliveryRoute") == value, f"5. {value} must reach the saved project"
            else:
                assert "deliveryRoute" not in saved, "5. withdrawing must remove the key from the saved project"

        i2v_required = walk[1]
        assert i2v_required.endswith(":1"), f"5. i2v must require exactly one frame, got {i2v_required}"
        assert walk[0].endswith(":0") and walk[2].endswith(":0"), \
            f"5. r2v must require none, before and after i2v: {walk}"
        assert walk[3].endswith(":0"), f"5. and withdrawing the route leaves none required: {walk}"
        findings.append("5. the smoke target performed through the rendered <select>: " + " -> ".join(walk)
                        + " (route:required frames), each written to and withdrawn from the saved project, "
                        "with the frame record intact at every step")

        # ======================================================= 6 · A LEGACY SHOT IS NOT GUESSED AT
        page.goto(f"{base}/#/shot/SAMPLE-03", wait_until="domcontentloaded")
        page.wait_for_selector("#main .shot-intent-control", timeout=20000)
        legacy = page.evaluate(FRAME_STATE, "SAMPLE-03")
        assert legacy["storedRoute"] is None, \
            f"6. opening a legacy shot must not declare a route on its behalf, got {legacy['storedRoute']!r}"
        assert legacy["reading"] == "absent", "6. and it must still read as undeclared"
        legacy_state = page.evaluate(SHOT_STATE)
        assert legacy_state["intentOpen"] is True, "6. its route control is the question it is being asked"
        assert any("Execution route not chosen" in note for note in legacy_state["undeclaredNote"]), \
            "6. and says so plainly"
        findings.append("6. a legacy sample shot opened, and CineBraid guessed no route for it: the record still "
                        "carries no key and the surface says the execution route was not chosen")

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
print(f"generation endpoint calls: {len(generation_calls)} — provider calls: 0 — paid execution: 0 — off-site requests: 0")
print("Shot intent at the front real-browser audit passed")
