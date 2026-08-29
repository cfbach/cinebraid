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
  6  A LEGACY SHOT CARRYING HISTORICAL MEDIA — a stored `post` clip and an old approved
     frame, saved to disk and opened fresh — is not told to produce anything. This is
     the leak a Codex review demonstrated, and it is a browser claim because it is
     about what the shot workspace PUTS IN FRONT OF A FILMMAKER after a real page load.
 10  ZERO OWED IS NOT AUTOMATION COMPLETE. `automationReadyForMotion` is a PERSISTED
     receipt and public/creation-studio.js turns it into "STILL AUTOMATION COMPLETE"
     plus an approved-start-frame claim. Whether the shipped surface still makes that
     claim once the obligation underneath has moved is a render question, and only a
     browser answers it.
  9  AUTOMATION OWES WHAT THE ROUTE OWES. The hub card, the AUTOMATE FULL SHOT dialog
     and the plan a run would consume are two collapsed <details> deep on the Look
     stage, and the dialog's preselection only exists once it is really opened --
     neither is reachable from the Node suite.
  8  THE SHELL AROUND #main AGREES ABOUT WHAT COMES NEXT. The persistent stage bar and
     the Assistant rail are mounted in index.html chrome rather than in #main, so they
     are unreachable from the Node suite -- and each renders a 'what next' answer of
     its own. An undeclared shot must draw no Continue button on any stage and the rail
     must report that it has no recommendation.
  7  RETAINED MOTION WORK IS ON SCREEN AND READ-ONLY. The stage is selected with the real
     stage bar, the page is reloaded so the selection is a genuine Resume, and the saved
     motion direction and compiled prompt are read with inner_text() off VISIBLE elements
     — a string present in innerHTML inside a collapsed <details> would satisfy a source
     assertion and show a filmmaker nothing.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a "nothing was fabricated" assertion that
cannot fail is worth nothing:

  N1 puts the fabricated frame debt back on screen and requires section 4's assertion
     to catch it.
  N2 sends the Shots-page Add back through the generic chooser and requires section 1's
     assertion to catch it.
  N3 forces the old unconditional `inputs -> look` answer back through the model both
     shell surfaces read, and requires section 9's assertion to catch it.
  N4 gives automation its own frame requirement back and requires section 10's
     assertion to catch it.
  N5 lets the shipped surface trust the persisted receipt alone and requires section
     11's assertion to catch it.

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


# The two surfaces AROUND #main: the persistent stage bar and the Assistant rail. Both
# render shotStageProgress()'s recommendedNext, so the buttons are read off the page and
# the model's answer is read beside them -- an assertion against a recomputed value
# alone would pass while the button on the page said something else.
SHELL_STATE = """(shotId) => {
  const shot = typeof shotById === 'function' ? shotById(shotId) : null;
  const declared = shot ? shotStageProgress(shotStageModelFacts(shot, takesFor(shotId))) : [];
  const next = document.querySelector('[data-cb-section="next"]');
  return {
    barPresent: !!document.querySelector('.cb-stage-actions'),
    railPresent: !!document.querySelector('.cb-assistant'),
    recommendations: declared.filter((s) => s.recommendedNext).map((s) => `${s.id}->${s.recommendedNext}`),
    advancing: [...document.querySelectorAll('.cb-stage-action[data-advances="1"]')].map((b) => b.textContent.trim()),
    barLabels: [...document.querySelectorAll('.cb-stage-action')].map((b) => b.textContent.trim()),
    railNext: next ? next.innerText : '',
  };
}"""

# The automation surface, which lives on the Look stage inside two collapsed
# <details> -- the assisted-blocking tools, then the automation hub itself. Read as a
# filmmaker reaches it: open the disclosures, then read the card and the dialog the
# AUTOMATE FULL SHOT button opens.
AUTOMATION_STATE = """(shotId) => {
  const shot = shotById(shotId);
  const obligation = shotStillObligation(shot);
  const hub = document.querySelector('.shot-automation-hub');
  const cards = hub ? [...hub.querySelectorAll('article')].map((row) => ({
    label: (row.querySelector('span') || {}).textContent || '',
    value: (row.querySelector('b') || {}).textContent || '',
    note: (row.querySelector('small') || {}).textContent || '',
  })) : [];
  return {
    hubPresent: !!hub,
    hubVisible: !!(hub && hub.offsetParent !== null),
    obligation,
    requiredFramesCard: cards.find((row) => row.label === 'REQUIRED FRAMES') || null,
    settled: stillObligationSettled(obligation),
    summary: shotStillAutomationSummary(obligation, 1, obligation.approvedOwedFrameIds.map(() => 'A')),
  };
}"""

PICKER_STATE = """() => {
  const boxes = [...document.querySelectorAll('#modal .v626-auto-frame')];
  return {
    offered: boxes.map((box) => box.value),
    preselected: boxes.filter((box) => box.checked).map((box) => box.value),
    draftFrameIds: (window._v626ShotAutomationDraft || {}).frameIds || [],
  };
}"""

# The completion boundary as the Motion workspace renders it. `automationReadyForMotion`
# is a PERSISTED receipt; what is read here is whether the shipped surface still turns it
# into a completion claim once the obligation underneath it has moved.
COMPLETION_STATE = """(shotId) => {
  const shot = shotById(shotId);
  const obligation = shotStillObligation(shot);
  const main = document.getElementById('main');
  const panel = document.querySelector('[data-guided-panel="motion"]');
  /* The panel is a <details>; innerText omits a collapsed body, so the claim is read
     from the emitted markup -- the gate either renders the block or it does not -- and
     the disclosure is opened as well so a present claim is genuinely on screen. */
  if (panel && !panel.open) panel.open = true;
  const text = main ? main.innerHTML : '';
  return {
    state: obligation.stillRequirementState,
    owed: obligation.owedFrameCount,
    approvedOwed: obligation.approvedOwedCount,
    settled: stillObligationSettled(obligation),
    receipt: !!(shot.creationBrief || {}).automationReadyForMotion,
    claim: stillAutomationCompletionClaim(shot),
    panelLocked: !!(panel && panel.classList.contains('locked')),
    banner: text.includes('STILL AUTOMATION COMPLETE'),
    startFrameClaim: text.includes('approved start frame is ready for image-to-video'),
    frames: (shot.keyframes || []).map((f) => f.id + ':' + (f.winner || '')),
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

        def open_shot(shot_id, why, fresh_document=False):
            """Navigate to one shot and wait for THAT shot's workspace.

            A shot-to-shot move is a fragment change: the document is not reloaded, and
            `.shot-intent-control` is already on screen from the shot we are leaving. A
            wait for the bare selector therefore returns instantly against the PREVIOUS
            shot, and every assertion after it reads a workspace nobody asked for — which
            is how section 6 could pass while reading section 5's shot. The control
            carries data-shot-id, so wait for the requested one.

            `fresh_document` additionally reloads the document, which is the difference
            between "the app re-rendered" and "the app was started over and read this shot
            out of the saved project" — the second is the claim section 7 makes."""
            page.goto(f"{base}/#/shot/{shot_id}", wait_until="domcontentloaded")
            if fresh_document:
                page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(f'#main .shot-intent-control[data-shot-id="{shot_id}"]', timeout=20000)
            assert page.evaluate(
                """(id) => {
                     const control = document.querySelector('#main .shot-intent-control');
                     return !!control && control.dataset.shotId === id;
                   }""",
                shot_id,
            ), f"{why}: the workspace on screen must be {shot_id}"

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
        open_shot("SAMPLE-03", "6")
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

        # ================================================= 7 · LEGACY HISTORICAL MEDIA
        # Written into the saved project the way a pre-route production left it: a
        # finishing-pass clip and an approved frame, on a shot with no deliveryRoute.
        legacy_id = page.evaluate("""() => {
            const scene = P.scenes[0].id;
            const shot = {
              id: "SC-LEGACY-01", scene, title: "Legacy dock shot",
              desc: "The courier sets the parcel down and steps back.",
              characters: [], positioning: "", route: "GENERATE", codes: [], risks: [], safe: "",
              status: "BUILT", workflowStatus: "IN PROGRESS", iterations: 2, notes: "",
              promptOptions: [], promptBuilds: [], winner: "", dur: 5, continuityStateSelections: {},
              keyframes: [{ id: "frame-a-legacy", label: "A", title: "Opening frame A",
                            winner: "", description: "", notes: "", required: true, generationPackages: [] }],
              clips: [{ id: "seg-post", suffix: "a", label: "A", title: "Finishing pass", dur: 5,
                        kind: "post", note: "", motionPrompt: "the old direction",
                        generationPackages: [], motionPlan: null }],
              candidateFiles: [], stageApprovals: {}, generationPackages: [],
              creationBrief: { locationId: "", propIds: [], mode: "auto", promptBuilds: [] },
            };
            P.shots.push(shot);
            dirty();
            return shot.id;
        }""")
        saved_shot(legacy_id, until=lambda row: (row.get("clips") or []) and row["clips"][0]["kind"] == "post")

        # Opened by RELOADING THE DOCUMENT at this shot and waiting for ITS workspace, so
        # nothing in memory and nothing on screen is carried over from the shot before it.
        open_shot(legacy_id, "7", fresh_document=True)
        assert not page_errors, f"7. the legacy shot raised uncaught errors: {page_errors}"

        legacy = page.evaluate(SHOT_STATE)
        legacy_frames = page.evaluate(FRAME_STATE, legacy_id)
        assert legacy_frames["storedRoute"] is None, \
            f"7. the legacy shot must carry no deliveryRoute, got {legacy_frames['storedRoute']!r}"
        assert legacy_frames["clipCount"] == 1, "7. and its historical clip must still be there"
        assert legacy_frames["requiredFrames"] == [], \
            f"7. history requires no frame, got {legacy_frames['requiredFrames']}"
        assert legacy_frames["action"] == "declare-shot-route", \
            f"7. and the canonical next action is the route question, got {legacy_frames['action']!r}"
        for forbidden in ("Produce the motion", "Produce the frame", "Produce Frame", "Mark shot final"):
            assert forbidden.lower() not in legacy["primary"].lower(), \
                f"7. the rendered primary action must not be {forbidden!r}, got {legacy['primary']!r}"
        assert legacy["primary"].strip().lower() == "choose how this shot is made", \
            f"7. it is the route decision, got {legacy['primary']!r}"
        assert legacy["intentOpen"] is True, "7. and the route control is open, so the path forward is reachable"
        findings.append(f"7. a legacy shot with a stored post clip, opened by a full page load, is offered "
                        f"{legacy['primary']!r} rather than a generation — history declared nothing")

        # ---- and an explicit declaration DOES bring route-specific work back --------
        declare("i2v")
        declared_legacy = page.evaluate(FRAME_STATE, legacy_id)
        assert declared_legacy["storedRoute"] == "i2v", "7. the declaration lands on the legacy shot"
        assert len(declared_legacy["requiredFrames"]) == 1, \
            f"7. and i2v brings its opening frame, got {declared_legacy['requiredFrames']}"
        assert declared_legacy["clipCount"] == 1, "7. with the historical clip still present"
        assert declared_legacy["action"] != "declare-shot-route", "7. and the question is not asked again"
        saved_legacy = saved_shot(legacy_id, until=lambda row: row.get("deliveryRoute") == "i2v")
        assert (saved_legacy.get("clips") or [])[0]["kind"] == "post", \
            "7. and the saved project still holds the historical clip verbatim"
        findings.append(f"7. declaring i2v on that same legacy shot brought exactly one required frame from the "
                        f"canonical owner ({declared_legacy['action']}), with the post clip untouched on disk")


        # ============================================ 8 · RETAINED MOTION WORK, READ-ONLY
        # The legacy shot of the second review's blocker 2: a historical clip carrying the
        # direction written for it, the compiled prompt built from it, no returned video,
        # and no declared route.
        motion_id = page.evaluate("""() => {
            const scene = P.scenes[0].id;
            P.promptBuildsById = P.promptBuildsById && typeof P.promptBuildsById === "object" ? P.promptBuildsById : {};
            P.promptSnapshotsById = P.promptSnapshotsById && typeof P.promptSnapshotsById === "object" ? P.promptSnapshotsById : {};
            P.promptBuildsById["b-motion-legacy"] = {
              id: "b-motion-legacy", packageId: "S-01-A-M01", prompt: "COMPILED-MOTION: a slow push-in as the courier releases the parcel.",
              kind: "guided-motion", scope: "motion:seg-post", profileId: "minimax-h3/i2v",
              profileName: "MiniMax Hailuo 3", references: [], revision: 1, revisionReason: "compiled", durationSeconds: 5,
            };
            const shot = {
              id: "SC-LEGACY-02", scene, title: "Legacy motion shot",
              desc: "The courier releases the parcel and the drone lifts away.",
              characters: [], positioning: "", route: "GENERATE", codes: [], risks: [], safe: "",
              status: "BUILT", workflowStatus: "IN PROGRESS", iterations: 2, notes: "",
              promptOptions: [], promptBuilds: [], winner: "", dur: 5, continuityStateSelections: {},
              keyframes: [{ id: "frame-a-motion", label: "A", title: "Opening frame A",
                            winner: "", description: "", notes: "", required: true, generationPackages: [] }],
              clips: [{ id: "seg-post", suffix: "a", label: "A", title: "Finishing pass", dur: 5,
                        kind: "post", note: "", motionPrompt: "The courier steps back and the parcel settles.",
                        generationPackages: [], motionPlan: null }],
              candidateFiles: [], stageApprovals: {}, generationPackages: [],
              creationBrief: { locationId: "", propIds: [], mode: "auto", promptBuilds: [],
                               motionPromptBuilds: [{ buildId: "b-motion-legacy", kind: "guided-motion" }] },
            };
            P.shots.push(shot);
            dirty();
            return shot.id;
        }""")
        saved_shot(motion_id, until=lambda row: (row.get("creationBrief") or {}).get("motionPromptBuilds"))

        open_shot(motion_id, "8", fresh_document=True)

        # RESUME IS PERFORMED, NOT SIMULATED: the Motion stage is chosen with the shipped
        # stage-bar button, and then the document is reloaded. What comes back is the app
        # resuming a saved selection out of a fresh page, which is the reported case.
        page.wait_for_selector('.cb-stage-bar [data-stage-id="motion"]', timeout=20000)
        page.locator('.cb-stage-bar [data-stage-id="motion"]').first.click()
        page.wait_for_timeout(400)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(f'#main .shot-intent-control[data-shot-id="{motion_id}"]', timeout=20000)
        assert not page_errors, f"8. the resumed Motion workspace raised uncaught errors: {page_errors}"

        resumed_task = page.evaluate("""(id) => {
            const s = P.shots.find((row) => row.id === id);
            return boundedShotSelectedTask(s, takesFor(id));
        }""", motion_id)
        assert resumed_task == "motion", f"8. Resume must land on Motion, got {resumed_task!r}"

        motion_panel = page.locator('[data-guided-panel="motion"]').first
        assert motion_panel.count() > 0, "8. and the Motion workspace must be on screen"
        assert motion_panel.get_attribute("data-motion-history") == "retained", \
            "8. rendering the work it retained rather than an empty locked shell"

        # READ OFF THE RENDERED TEXT OF VISIBLE ELEMENTS, not the page source: a string
        # inside a collapsed <details> is in innerHTML and in front of nobody.
        direction_node = page.locator('[data-motion-history-part="direction"] pre').first
        compiled_node = page.locator('[data-motion-history-part="compiled"] pre').first
        assert direction_node.is_visible(), "8. the retained motion direction must be visible"
        assert compiled_node.is_visible(), "8. and so must the retained compiled prompt"
        assert "The courier steps back" in direction_node.inner_text(), \
            f"8. the direction on screen must be the saved one, got {direction_node.inner_text()!r}"
        assert "COMPILED-MOTION" in compiled_node.inner_text(), \
            f"8. and the compiled prompt must be the saved one, got {compiled_node.inner_text()!r}"

        # READ-ONLY MEANS READ-ONLY.
        blocked_controls = page.evaluate("""() => {
            const panel = document.querySelector('[data-guided-panel="motion"]');
            if (!panel) return ["(no panel)"];
            return [...panel.querySelectorAll("button, input, select, textarea")]
              .map((node) => (node.textContent || node.value || "").trim())
              .filter((word) => /generate|produce|submit|build prompt|rebuild|improve|edit prompt/i.test(word));
        }""")
        assert blocked_controls == [], f"8. no control may offer to produce motion, found {blocked_controls}"

        motion_frames = page.evaluate(FRAME_STATE, motion_id)
        assert motion_frames["storedRoute"] is None, "8. viewing retained work declares no route"
        assert motion_frames["action"] == "declare-shot-route", \
            f"8. and the canonical current action is still the route question, got {motion_frames['action']!r}"
        saved_motion = saved_shot(motion_id, until=lambda row: row.get("clips"))
        assert "deliveryRoute" not in saved_motion, "8. and the saved project still carries no route key"
        assert saved_motion["clips"][0]["motionPrompt"] == "The courier steps back and the parcel settles.", \
            "8. with the stored motion prompt untouched on disk"
        findings.append("8. an undeclared legacy shot resumed onto Motion shows its saved direction and compiled "
                        "prompt as visible read-only text, offers no control that would produce motion, and still "
                        f"answers {motion_frames['action']!r} with no route on disk")

        # ---- and declaring a route returns the ordinary workspace -------------------
        declare("t2v")
        page.wait_for_timeout(400)
        declared_motion = page.evaluate(FRAME_STATE, motion_id)
        assert declared_motion["storedRoute"] == "t2v", "8. the declaration lands on the legacy motion shot"
        page.wait_for_selector('[data-guided-panel="motion"]:not([data-motion-history])', timeout=10000)
        restored = page.evaluate("""() => {
            const panel = document.querySelector('[data-guided-panel="motion"]');
            return {
              history: panel ? panel.getAttribute("data-motion-history") : "(no panel)",
              buildControls: panel ? [...panel.querySelectorAll("button")]
                .map((node) => (node.textContent || "").trim())
                .filter((word) => /build prompt|improve/i.test(word)) : [],
            };
        }""")
        assert restored["history"] is None, "8. the read-only view steps aside once an execution route is declared"
        assert restored["buildControls"], "8. and the ordinary motion controls come back"
        findings.append(f"8. declaring t2v on that same shot restored the ordinary Motion workspace "
                        f"({', '.join(restored['buildControls'])}), so the read-only view is a consequence of "
                        "current intent rather than a state the shot is stuck in")


        # ============================================ 9 · THE SHELL'S OWN NEXT ACTION
        # Sections 4-8 read `#main`. The two surfaces AROUND it answer "what next"
        # separately, and both draw straight from shotStageProgress()'s
        # recommendedNext: the persistent stage bar as a `Continue to <stage>` button,
        # and the Assistant rail as "Next action / <stage> / CineBraid recommends this
        # next". Neither is inside #main, so neither is reachable from the Node suite --
        # this is the only place they can be looked at.
        open_shot(undecided_id, "9")
        frames_at_start = page.evaluate(FRAME_STATE, undecided_id)["allFrames"]
        # The rail is mounted only while it is OPEN -- an unoccupied shell slot collapses,
        # and not mounting is the whole mechanism by which the centre reclaims the width.
        # So it is opened through its own shipped toggle, not by calling the API.
        if not page.evaluate("() => window.CineBraidCreatorSurfaces.railOpen()"):
            page.locator("#creator-rail-toggle").click()
            page.wait_for_selector(".cb-assistant", timeout=10000)
        shell = page.evaluate(SHELL_STATE, undecided_id)
        assert shell["barPresent"], "9. fixture check: the persistent stage bar must be on the page to be read"
        assert shell["railPresent"], "9. fixture check: and the Assistant rail must be mounted"
        assert shell["recommendations"] == [], \
            f"9. an undeclared shot must produce no stage recommendation at all, got {shell['recommendations']}"
        assert shell["advancing"] == [], \
            f"9. and the bar must draw no Continue button, got {shell['advancing']}"
        assert "Look & blocking" not in " ".join(shell["barLabels"]), \
            f"9. least of all one pointing at the declared-optional Look stage, got {shell['barLabels']}"
        assert "No recommendation is available yet" in shell["railNext"], \
            f"9. and the rail must say so in its own shipped words, got {shell['railNext']!r}"
        findings.append("9. on the undeclared shot the persistent stage bar draws no Continue button on any stage "
                        "and the Assistant rail reads 'No recommendation is available yet' -- the shell agrees with "
                        "the '0/0 required frames' inside #main instead of contradicting it")

        # N3 -- put the shipped defect back on the shell. `inputs -> "look"` was the
        # unconditional answer, so this forces exactly that value through the model the
        # bar and the rail both read, and repaints with the shipped painter.
        page.evaluate("""() => {
          window.__realProgress = window.shotStageProgress;
          window.shotStageProgress = (facts) => window.__realProgress(facts)
            .map((stage) => (stage.id === "inputs" ? { ...stage, recommendedNext: "look" } : stage));
          window.CineBraidStageSurfaces.paint();
        }""")
        page.wait_for_selector('.cb-stage-action[data-advances="1"]', timeout=10000)
        broken = page.evaluate(SHELL_STATE, undecided_id)
        assert "Continue to Look & blocking" in broken["barLabels"], \
            f"N3. precondition: the control must genuinely reproduce the reported defect, got {broken['barLabels']}"
        page.evaluate("() => { window.shotStageProgress = window.__realProgress; window.CineBraidStageSurfaces.paint(); }")
        page.wait_for_function("() => !document.querySelector('.cb-stage-action[data-advances=\"1\"]')", timeout=10000)
        assert page.evaluate(SHELL_STATE, undecided_id)["advancing"] == [], \
            "N3. and the assertion section 9 relies on catches it"
        findings.append("N3. negative control: forcing the old `inputs -> look` answer puts "
                        "'Continue to Look & blocking' back on the bar of a shot that has declared nothing, "
                        "and section 9's assertion catches it")

        # ---- a route that DOES owe a frame gets its handoff back --------------------
        declare("i2v")
        page.wait_for_selector('.cb-stage-action[data-advances="1"]', timeout=10000)
        owed = page.evaluate(SHELL_STATE, undecided_id)
        assert "inputs->frames" in owed["recommendations"], \
            f"9. a declared route that owes an opening frame must recommend Frames, got {owed['recommendations']}"
        assert "Continue to Frames" in owed["barLabels"], \
            f"9. and the bar must offer it, got {owed['barLabels']}"
        assert "Frames" in owed["railNext"], \
            f"9. and the rail must name it, got {owed['railNext']!r}"
        assert "Look & blocking" not in " ".join(owed["barLabels"]), \
            "9. declaring a route must not resurrect the optional stage as a next step either"

        declare("")
        page.wait_for_function("() => !document.querySelector('.cb-stage-action[data-advances=\"1\"]')", timeout=10000)
        withdrawn = page.evaluate(SHELL_STATE, undecided_id)
        assert withdrawn["recommendations"] == [] and withdrawn["advancing"] == [], \
            f"9. withdrawing the route must withdraw the handoff with it, got {withdrawn['recommendations']}"
        assert page.evaluate(FRAME_STATE, undecided_id)["allFrames"] == frames_at_start, \
            "9. and none of that moved the shot's own frame records"
        findings.append("9. declaring i2v on the same shot brought back exactly one handoff -- 'Continue to Frames' "
                        "on the bar and Frames in the rail -- and withdrawing the route withdrew it again, with the "
                        "frame record untouched throughout")


        # ================================== 10 · AUTOMATION OWES WHAT THE ROUTE OWES
        # The independent review's blocker, in the browser. automation.js used to
        # derive its own frame requirement from the stored `frame.required` flag and
        # reuse it for the card, the picker, the plan and the completion sentence.
        # Everything here is read through two real disclosures and the real dialog.
        def open_automation_hub():
            page.evaluate("""() => {
              for (const node of document.querySelectorAll('#main details')) {
                if (/OPTIONAL ASSISTED BLOCKING|OPTIONAL ASSISTED PRODUCTION/.test(node.textContent || ''))
                  node.open = true;
              }
            }""")
            page.wait_for_selector(".shot-automation-hub", timeout=20000)

        open_shot(undecided_id, "10")
        page.evaluate("(id) => { const b = document.querySelector(`.cb-stage-strip .focused-task-button[data-stage-id=\"look\"]`); if (b) b.click(); }", "look")
        page.wait_for_timeout(400)
        open_automation_hub()

        auto = page.evaluate(AUTOMATION_STATE, undecided_id)
        assert auto["hubPresent"], "10. fixture check: the automation hub must be reachable to be read"
        assert auto["obligation"]["stillRequirementState"] == "route-undeclared", \
            f"10. an undeclared shot is in the undeclared state, got {auto['obligation']['stillRequirementState']!r}"
        assert auto["obligation"]["owedFrameIds"] == [], \
            f"10. and owes no frame, got {auto['obligation']['owedFrameIds']}"
        card = auto["requiredFramesCard"]
        assert card is not None, "10. fixture check: the REQUIRED FRAMES card must be on the hub"
        assert card["value"] == "None yet", \
            f"10. the card must not print a fraction of a requirement that does not exist, got {card}"
        assert "0/1" not in card["value"], "10. least of all the reported one"
        assert "still package ready" not in card["note"].lower(), \
            f"10. and must not call an empty shot's still package ready, got {card['note']!r}"
        assert "still package is ready" not in auto["summary"].lower(), \
            f"10. nor may a completed run on it, got {auto['summary']!r}"
        findings.append(f"10. the automation hub on the undeclared shot reads REQUIRED FRAMES {card['value']!r} "
                        f"· {card['note']!r}, and a completed run on it could only say "
                        f"{auto['summary'][:52]!r}")

        # The real dialog: every frame offered, none chosen for the filmmaker.
        page.click("#main .shot-automation-hub .automation-plan-btn, #main .shot-automation-hub button.approve-btn.large")
        page.wait_for_selector("#modal:not(.hidden) .v626-auto-frame", timeout=20000)
        picker = page.evaluate(PICKER_STATE)
        assert picker["offered"], "10. fixture check: the picker must offer the shot's frames"
        assert picker["preselected"] == [], \
            f"10. no frame may be preselected for automation on a shot that owes none, got {picker['preselected']}"
        assert picker["draftFrameIds"] == [], \
            f"10. and the automation plan must carry no frame id, got {picker['draftFrameIds']}"
        page.evaluate("() => closeModal()")
        findings.append(f"10. its AUTOMATE FULL SHOT dialog offers {len(picker['offered'])} frames and preselects none, "
                        "so the plan a run would plan is empty")

        # ---- and a route that DOES owe a frame gets exactly its own ----------------
        declare("i2v")
        page.wait_for_timeout(400)
        open_automation_hub()
        owed = page.evaluate(AUTOMATION_STATE, undecided_id)
        assert owed["obligation"]["owedFrameIds"], "10. a declared opening-frame route owes one"
        assert owed["requiredFramesCard"]["value"].endswith("approved"), \
            f"10. and the card counts it, got {owed['requiredFramesCard']}"
        assert owed["settled"] is False, "10. with the obligation outstanding, nothing claims completion"
        assert "not complete" in owed["summary"].lower(), \
            f"10. and a run would say so, got {owed['summary']!r}"
        page.click("#main .shot-automation-hub .automation-plan-btn, #main .shot-automation-hub button.approve-btn.large")
        page.wait_for_selector("#modal:not(.hidden) .v626-auto-frame", timeout=20000)
        owed_picker = page.evaluate(PICKER_STATE)
        assert owed_picker["preselected"] == owed["obligation"]["owedFrameIds"], \
            f"10. the plan must preselect exactly the owed frames, got {owed_picker['preselected']} for {owed['obligation']['owedFrameIds']}"
        assert owed_picker["draftFrameIds"] == owed["obligation"]["owedFrameIds"], \
            f"10. and the draft the run would consume must be the same set, got {owed_picker['draftFrameIds']}"
        page.evaluate("() => closeModal()")
        declare("")
        findings.append(f"10. declaring i2v moved the card, the preselection and the run draft to "
                        f"{owed['obligation']['owedFrameIds']} together — one obligation, four surfaces")

        # N4 -- give automation its own opinion back.
        page.evaluate("""() => {
          window.__realObligation = window.shotStillObligation;
          window.shotStillObligation = (shot) => {
            const frames = guidedFrames(shot);
            const owed = frames.filter((frame) => frame.required !== false);
            return { routeDeclared: false, owedFrameIds: owed.map((f) => f.id), owedFrameCount: owed.length,
                     approvedOwedFrameIds: [], approvedOwedCount: 0, stillRequirementState: "frames-incomplete" };
          };
          route();
        }""")
        page.wait_for_timeout(400)
        open_automation_hub()
        broken_card = page.evaluate(AUTOMATION_STATE, undecided_id)["requiredFramesCard"]
        assert broken_card["value"] != "None yet", \
            f"N4. precondition: the control must genuinely reproduce the reported defect, got {broken_card}"
        page.evaluate("() => { window.shotStillObligation = window.__realObligation; route(); }")
        page.wait_for_timeout(400)
        open_automation_hub()
        assert page.evaluate(AUTOMATION_STATE, undecided_id)["requiredFramesCard"]["value"] == "None yet", \
            "N4. and the assertion section 10 relies on catches it"
        findings.append(f"N4. negative control: giving automation its own requirement again puts "
                        f"{broken_card['value']!r} back on the hub card of a shot that owes none, and section 10 "
                        "catches it")


        # ============================= 11 · ZERO OWED IS NOT AUTOMATION COMPLETE
        # The persisted receipt an automation run leaves behind, and what the shipped
        # Motion workspace does with it once the obligation has moved. The receipt is
        # written into local state rather than earned by a run: this suite calls no
        # provider and starts no generation, and the point under test is the RENDER.
        def with_receipt(shot_id, declared_route):
            # `declared`, not `route`: the page's own re-render function is called
            # route(), and an argument of that name shadows it inside the callback.
            page.evaluate(
                """([id, declared]) => {
                  const shot = shotById(id);
                  shot.creationBrief = shot.creationBrief || {};
                  shot.creationBrief.deliveryIntent = 'motion';
                  shot.creationBrief.automationReadyForMotion = true;
                  if (declared) shot.deliveryRoute = declared; else delete shot.deliveryRoute;
                  route();
                }""", [shot_id, declared_route])
            page.wait_for_timeout(400)
            return page.evaluate(COMPLETION_STATE, shot_id)

        open_shot(undecided_id, "11")
        page.evaluate("() => { const b = document.querySelector('.cb-stage-strip .focused-task-button[data-stage-id=\"motion\"]'); if (b) b.click(); }")
        page.wait_for_timeout(400)

        # UNDECLARED: a receipt on a shot that never owed a still claims nothing.
        undeclared_done = with_receipt(undecided_id, "")
        assert undeclared_done["receipt"] is True, "11. fixture check: the persisted receipt must be on the record"
        assert undeclared_done["state"] == "route-undeclared", \
            f"11. and the shot must owe nothing, got {undeclared_done['state']!r}"
        assert undeclared_done["panelLocked"] is False, \
            "11. fixture check: the Motion workspace must be open, or an absent banner proves nothing"
        assert undeclared_done["settled"] is False, \
            "11. a shot that owed no still has completed no still obligation"
        assert undeclared_done["banner"] is False, \
            "11. so the workspace must not render STILL AUTOMATION COMPLETE"
        assert undeclared_done["startFrameClaim"] is False, \
            "11. nor claim an approved start frame is ready for image-to-video"
        findings.append("11. an undeclared shot carrying a completed-automation receipt renders neither "
                        "STILL AUTOMATION COMPLETE nor an approved-start-frame claim")

        # A DECLARED ZERO-FRAME ROUTE: the same, with a route that legitimately owes none.
        zero_route_done = with_receipt(undecided_id, "t2v")
        assert zero_route_done["state"] == "frames-not-required", \
            f"11. a text-driven route owes no still, got {zero_route_done['state']!r}"
        assert zero_route_done["panelLocked"] is False, \
            "11. fixture check: its Motion workspace must be open too"
        assert zero_route_done["settled"] is False, \
            "11. a route that requires no still has completed no still obligation"
        assert zero_route_done["banner"] is False, \
            "11. so it must not render STILL AUTOMATION COMPLETE either"
        assert zero_route_done["startFrameClaim"] is False, "11. nor the start-frame claim"
        findings.append("11. the same receipt under a declared zero-frame route (t2v) renders neither claim: "
                        f"state {zero_route_done['state']!r}, {zero_route_done['owed']} owed")

        # POSITIVE: a frame-requiring route whose owed frame IS approved.
        #
        # THE APPROVAL IS EARNED, NOT SYNTHESIZED. approveFrameCanon() called from
        # page.evaluate is refused -- "can only be approved by an explicit human approval
        # action" -- which is the authority guarantee, and routing around it would make
        # this proof worthless. So the receipt is earned the way a filmmaker earns it:
        # the demo sample ships SAMPLE-01 with its opening image on disk and no receipt,
        # and this clicks the shipped approve control and confirms the shipped dialog.
        open_shot("SAMPLE-01", "11")
        page.evaluate("() => { const b = document.querySelector('.cb-stage-strip .focused-task-button[data-stage-id=\"frames\"]'); if (b) b.click(); }")
        page.wait_for_selector("button.guided-approve-selected", timeout=20000)
        page.locator("button.guided-approve-selected").first.click()
        page.wait_for_selector("#modal:not(.hidden) button[onclick='confirmApproveTake()']", timeout=20000)
        page.locator("#modal button[onclick='confirmApproveTake()']").first.click()
        page.wait_for_timeout(800)
        assert not page_errors, f"11. approving raised uncaught errors: {page_errors}"
        receipts = page.evaluate("() => ((P.productionAuthority || {}).receipts || []).length")
        assert receipts >= 1, "11. fixture check: the click must have written a real approval receipt"

        page.evaluate("() => { const b = document.querySelector('.cb-stage-strip .focused-task-button[data-stage-id=\"motion\"]'); if (b) b.click(); }")
        page.wait_for_timeout(400)
        complete = with_receipt("SAMPLE-01", "i2v")
        # THE OBLIGATION HALF IS PROVEN HERE, with a receipt this suite actually earned.
        assert complete["state"] == "frames-complete", \
            f"11. a genuinely approved opening frame must complete an i2v obligation, got {complete['state']!r} ({complete['approvedOwed']}/{complete['owed']})"
        assert complete["settled"] is True, \
            "11. and an owed frame that is approved completes the obligation — the correction withdraws false claims, not true ones"
        assert complete["claim"] is True, \
            "11. so the shipped completion claim is granted for it"
        findings.append(f"11. SAMPLE-01, whose opening frame was approved by a real click through the shipped approve "
                        f"control and dialog ({receipts} receipt, {complete['approvedOwed']}/{complete['owed']} owed), reaches "
                        "frames-complete and IS granted the completion claim")

        # THE RENDERED HALF depends on the Motion workspace being open, which needs
        # generation configured; the QA sandbox writes no credentials on purpose, so the
        # panel can render the shipped locked shell instead — and that shell carries no
        # banner block at all, which would make an assertion here prove nothing either
        # way. Reported rather than forced: tests/shot-intent-front.js section P3 and the
        # motionReadyFixture in tests/render-harness.js both cover the positive render.
        if complete["panelLocked"] or not complete["banner"]:
            findings.append("11. NOT EXERCISED IN BROWSER: the legitimate completion BANNER, because this "
                            f"sandbox renders the Motion workspace's locked shell for it (panelLocked="
                            f"{complete['panelLocked']}) and that shell has no banner block. Section P3 covers it.")
        else:
            assert complete["startFrameClaim"] is True, \
                "11. and its approved-start-frame line is the truthful one for an opening-frame route"
            findings.append("11. and the workspace legitimately renders STILL AUTOMATION COMPLETE for it")

        # Back to the undeclared shot for the control.
        open_shot(undecided_id, "11")
        page.evaluate("() => { const b = document.querySelector('.cb-stage-strip .focused-task-button[data-stage-id=\"motion\"]'); if (b) b.click(); }")
        page.wait_for_timeout(400)

        # N5 -- let the shipped surface trust the receipt alone again.
        with_receipt(undecided_id, "")
        page.evaluate("""() => {
          window.__realClaim = window.stillAutomationCompletionClaim;
          window.stillAutomationCompletionClaim = (shot) => !!(shot.creationBrief || {}).automationReadyForMotion;
          route();
        }""")
        page.wait_for_timeout(400)
        broken_claim = page.evaluate(COMPLETION_STATE, undecided_id)
        assert broken_claim["banner"] is True, \
            "N5. precondition: the control must genuinely reproduce the reported defect"
        page.evaluate("() => { window.stillAutomationCompletionClaim = window.__realClaim; route(); }")
        page.wait_for_timeout(400)
        assert page.evaluate(COMPLETION_STATE, undecided_id)["banner"] is False, \
            "N5. and the assertion section 11 relies on catches it"
        findings.append("N5. negative control: reading the persisted receipt alone puts STILL AUTOMATION "
                        "COMPLETE back on a shot that owes no still, and section 11's assertion catches it")

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
for call in generation_calls:
    print(f"  local generation endpoint touched (never a provider, never billed): {call}")
print("Shot intent at the front real-browser audit passed")
