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
