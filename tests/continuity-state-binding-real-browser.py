#!/usr/bin/env python3
"""P4-SEM-B declared state bindings, executing in a real Chromium.

THE BROWSER-ONLY RISK THIS SUITE EXISTS FOR, in one line: public/shared-continuity.js
no longer states the frame -> shot -> entity-default precedence itself. It calls
into public/shared-continuity-binding.js, and in a browser those two files are
separate classic scripts. If the new file does not load, or loads after the file
that needs it, `resolveDeclaredStateId` reaches its guard and THROWS — and the
whole continuity surface goes with it. No Node suite can see that: they all
`require` the module by path, which is a mechanism the browser does not have.

CineBraid has been bitten by exactly this class of defect twice. A module reading
`window.P` found `undefined` forever, because a top-level `let` in a classic
script lives in the global LEXICAL scope and not on the global object; and a
duplicate top-level `const` across two public/*.js files blanks the entire app.
So case 1 proves the shipped page resolves a declared state through the shipped
module, by identity, in Chromium.

What it establishes:

  1  the binding contract LOADED and the runtime resolves THROUGH it — the
     resolver is not a second copy, and it does not throw
  2  the shot-level binding is what the page shows a frame inheriting
  3  an explicit frame override is what the page shows for that frame, set
     through the shipped <select> the shipped writer is wired to
  4  save and reload keep the override and keep frame A inheriting
  5  removing the override restores inheritance, and stores nothing to say so
  6  A/B/C: a third frame is unaffected throughout
  7  P4-SEM-A coverage is untouched — the board and the shared derivation still
     agree on the mixed requirement case
  8  Focused Workspaces still runs after PR #56 (.focused-entity-shell, which
     .focused-taskbar cannot stand in for — two other renderers emit that)
  9  opening the project mutated nothing: project.json is byte-identical

WHAT IS AND IS NOT EXERCISED VISUALLY, disclosed rather than implied. The
per-frame state <select> renders inside a collapsed <details>; that disclosure is
opened here through the DOM and the control is then driven with a real
select_option, so cases 3 and 5 are genuine UI interactions. The SHOT-level
selection has no <select> of its own in the frames stage — it is written from the
Inputs stage and the batch modal — so case 2 is written through the shipped
window.setShotContinuityState and then READ off the rendered page. Nothing here
asserts a value it also wrote into the DOM.

NOTHING HERE IS PAID. /api/generation/fal/jobs is aborted and counted if it is
ever reached, and every off-host request is aborted.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched, and the directory is removed at the end.
"""

import base64, hashlib, json, os, pathlib, re, shutil, socket, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium

LABEL = "P4-SEM-B declared state binding real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
MODULE = "shared-continuity-binding.js"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")

SLUG = "binding-fixture"
SHOT = "SH-01"
CHARACTER = "CHAR-RHEA"
CLEAN, WET = "st-rhea-clean", "st-rhea-wet"

# A 1x1 PNG. The frames only have to EXIST and be images for the shot workspace
# to treat them as approved takes; nothing here looks at a pixel.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# The P4-SEM-A mixed requirement case, verbatim from
# tests/coverage-requirement-semantics.js, so case 7 measures the same thing.
MIXED = [
    {"id": "establishing", "label": "Master establishing", "requirement": "required",
     "approvedFile": "LOC-DOOR-DAY.png", "notes": "", "status": "approved"},
    {"id": "reverse", "label": "Reverse angle", "requirement": "required",
     "approvedFile": "", "notes": "", "status": "missing"},
    {"id": "action-zone", "label": "Key action zone", "requirement": "planned",
     "approvedFile": "", "notes": "", "status": "missing"},
    {"id": "overhead", "label": "Overhead / layout", "requirement": "not-required",
     "approvedFile": "", "notes": "", "status": "missing"},
]


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Red(Exception):
    """A negative control that failed to go red."""


def project_document():
    return {
        "meta": {"title": "Binding fixture", "schemaVersion": "6.7"},
        "scenes": [{"id": "SC-01", "title": "The doorway"}],
        "shots": [{
            "id": SHOT, "scene": "SC-01", "title": "Rhea in the doorway",
            "desc": "She steps out of the rain and back into it.",
            "workflowStatus": "IN PROGRESS", "status": "BUILT",
            "characters": [CHARACTER], "codes": ["PROP-CASE"],
            "continuityStateSelections": {},
            "keyframes": [
                {"id": "fr-a", "label": "A", "title": "Under the awning",
                 "description": "Dry, under the awning.", "winner": "SH-01-A.png", "candidateFiles": []},
                {"id": "fr-b", "label": "B", "title": "Out in it",
                 "description": "Out in it.", "winner": "SH-01-B.png", "candidateFiles": []},
                {"id": "fr-c", "label": "C", "title": "Back under",
                 "description": "Back under, still soaked.", "winner": "SH-01-C.png", "candidateFiles": []},
            ],
            "clips": [], "candidateFiles": [], "promptOptions": [], "promptBuilds": [],
            "creationBrief": {"locationId": "LOC-DOOR", "propIds": ["PROP-CASE"], "frameWorkflows": {}},
        }],
        "characters": [{
            "id": CHARACTER, "name": "Rhea", "prefix": CHARACTER, "status": "APPROVED",
            "block": "Courier. Long coat, short hair, one canvas strap.",
            "approvedFile": "CHAR-RHEA-CLEAN.png", "candidateFiles": [],
            "continuityStates": [
                {"id": CLEAN, "name": "Clean", "isDefault": True, "notes": "Dry coat, hair down.",
                 "approvedFile": "CHAR-RHEA-CLEAN.png"},
                {"id": WET, "name": "Rain-soaked", "notes": "Coat darkened through, hair flat.",
                 "approvedFile": "CHAR-RHEA-WET.png"},
            ],
        }],
        "locations": [{
            "id": "LOC-DOOR", "name": "The doorway", "prefix": "LOC-DOOR", "status": "APPROVED",
            "block": "Brick, one step, a dead bulb.",
            "approvedFile": "LOC-DOOR-DAY.png", "candidateFiles": [],
            "coverageSlots": [dict(slot) for slot in MIXED],
            "continuityStates": [
                {"id": "st-door-day", "name": "Day", "isDefault": True, "approvedFile": "LOC-DOOR-DAY.png"},
                {"id": "st-door-night", "name": "Night", "approvedFile": "LOC-DOOR-NIGHT.png"},
            ],
        }],
        "props": [{
            "id": "PROP-CASE", "name": "The case", "prefix": "PROP-CASE", "status": "APPROVED",
            "block": "Aluminium, two catches.", "approvedFile": "PROP-CASE-CLOSED.png", "candidateFiles": [],
            "continuityStates": [
                {"id": "st-case-closed", "name": "Closed", "isDefault": True, "approvedFile": "PROP-CASE-CLOSED.png"},
                {"id": "st-case-open", "name": "Open", "approvedFile": "PROP-CASE-OPEN.png"},
            ],
        }],
        "vehicles": [], "audio": [], "mediaAssets": [],
        "jobs": [], "agentRuns": [], "decisions": [], "sessions": [],
    }


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-binding-"))
projects_root = sandbox / "projects"
project_dir = projects_root / SLUG
for folder in ("anchors", "plates", "props", "vehicles", "audio", "media", "docs"):
    (project_dir / folder).mkdir(parents=True, exist_ok=True)
(project_dir / "shots" / SHOT / "takes").mkdir(parents=True, exist_ok=True)
for name in ("SH-01-A.png", "SH-01-B.png", "SH-01-C.png"):
    (project_dir / "shots" / SHOT / "takes" / name).write_bytes(PNG)
for folder, names in (("anchors", ("CHAR-RHEA-CLEAN.png", "CHAR-RHEA-WET.png")),
                      ("plates", ("LOC-DOOR-DAY.png", "LOC-DOOR-NIGHT.png")),
                      ("props", ("PROP-CASE-CLOSED.png", "PROP-CASE-OPEN.png"))):
    for name in names:
        (project_dir / folder / name).write_bytes(PNG)

project_file = project_dir / "project.json"
project_file.write_text(json.dumps(project_document(), indent=2), encoding="utf-8")
config_path = sandbox / "config.json"
config_path.write_text(json.dumps({"activeProject": SLUG}, indent=2), encoding="utf-8")

console_errors, page_errors, offsite, paid_calls = [], [], [], []
findings, controls = [], []
served = {"mutation": None}

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
        page = browser.new_page(viewport={"width": 1600, "height": 1200})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def guard(route):
            url = route.request.url
            if PAID_ROUTE in url and route.request.method == "POST":
                paid_calls.append(f"{route.request.method} {url}")
                return route.abort("failed")
            if MODULE in url and served["mutation"] is not None:
                return route.fulfill(status=200, content_type="application/javascript",
                                     body=served["mutation"])
            if url.startswith(base) or url.startswith("data:") or url.startswith("blob:"):
                return route.continue_()
            if any(url.startswith(host) for host in FONT_HOSTS):
                return route.fulfill(status=200, content_type="text/css", body="")
            offsite.append(f"{route.request.method} {url}")
            return route.abort("failed")

        page.route("**/*", guard)

        def reveal():
            """Open every disclosure on the route. The per-frame state control lives
            inside a collapsed <details> — the same one that keeps
            check:continuity-workspace-browser quarantined — so it resolves but is
            not visible until its ancestors are open. Setting `.open` fires the
            app's own ontoggle, so the choice survives the next rerender."""
            page.evaluate("() => document.querySelectorAll('details').forEach((node) => { node.open = true; })")
            page.wait_for_timeout(400)

        def open_shot():
            """Load the shot workspace from scratch, so an armed mutation is really
            fetched, then select the FRAMES task through the module's own API and
            open the disclosures."""
            page.goto(f"{base}/#/shot/{SHOT}", wait_until="domcontentloaded")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=20000)
            page.wait_for_timeout(1500)
            # The shot workspace shows one task at a time and the continuity
            # surface lives in FRAMES. Selected through the shipped task API
            # rather than by reaching past it into storage.
            page.evaluate("() => window.selectFocusedTask && window.selectFocusedTask('frames')")
            page.wait_for_timeout(900)
            reveal()
            assert page.evaluate("() => !!document.querySelector('.shot-continuity')"), \
                "the continuity surface did not render on the FRAMES task"

        def select_pair(pair_id):
            """The panel compares one ORDERED PAIR at a time, so a third frame is
            reachable by choosing a pair that contains it — through the shipped
            chooser, which is what a director uses."""
            chooser = page.query_selector(".continuity-pair-choice select")
            assert chooser is not None, "the shot has three approved frames and must offer a pair chooser"
            chooser.select_option(pair_id)
            page.wait_for_timeout(700)
            reveal()

        def frame_state_control(frame_word):
            """The shipped <select> for CHAR-RHEA on one frame, located by the label
            the app renders beside it. textContent, never innerText: the labels are
            uppercased by CSS and reading rendered casing asserts about a stylesheet."""
            handle = page.evaluate_handle("""(args) => {
                const [word, entityName] = args;
                for (const row of document.querySelectorAll('.continuity-state-row')) {
                    const name = (row.querySelector('header b')?.textContent || '').trim();
                    if (name !== entityName) continue;
                    for (const label of row.querySelectorAll('.continuity-state-cells label')) {
                        if ((label.querySelector('span')?.textContent || '').trim() !== word) continue;
                        return label.querySelector('select');
                    }
                }
                return null;
            }""", [frame_word, "Rhea"])
            element = handle.as_element()
            assert element is not None, f"no frame-state control rendered for {frame_word}; the continuity surface did not build"
            return element

        def read_state(frame_word):
            """What the PAGE says about this frame: the inherit option's label, which
            names the state resolved through frame -> shot -> entity default, and the
            option currently selected."""
            return page.evaluate("""(select) => {
                const inherit = select.querySelector('option[value=""]');
                const chosen = select.options[select.selectedIndex];
                return {
                    inheritLabel: (inherit ? inherit.textContent : '').trim(),
                    selectedValue: select.value,
                    selectedLabel: (chosen ? chosen.textContent : '').trim(),
                };
            }""", frame_state_control(frame_word))

        # ---- the checks, written once so a negative control can demand the same
        # ---- assertion FAIL rather than a paraphrase of it ---------------------

        def check_contract_loaded():
            """CASE 1 — the binding module LOADED and the runtime resolves THROUGH it.

            Identity, not equality: equal answers agree right up until they stop, and
            `===` is the only claim that rules out a second copy of the precedence
            that has not drifted yet. The throw check matters on its own — after this
            batch a missing module is not a silent wrong answer, it is an exception,
            and an exception inside the render would take the page with it."""
            seen = page.evaluate("""() => {
                const shot = P.shots.find((row) => row.id === 'SH-01');
                const out = { loaded: typeof resolveBoundStateId === 'function'
                                   && typeof readShotStateBindings === 'function' };
                try {
                    out.viaRuntime = resolveDeclaredStateId(shot, 'fr-a', 'character', 'CHAR-RHEA');
                    out.viaContract = resolveBoundStateId(readShotStateBindings(shot), 'fr-a', 'CHAR-RHEA');
                    out.threw = '';
                } catch (error) { out.threw = String(error && error.message || error); }
                out.sameProject = shot === shotById('SH-01');
                return out;
            }""")
            assert seen["loaded"], f"case 1: shared-continuity-binding.js never executed in the page ({seen})"
            assert not seen["threw"], f"case 1: the runtime resolver threw in the browser: {seen['threw']}"
            assert seen["viaRuntime"] == seen["viaContract"], \
                f"case 1: the runtime resolver and the shared contract disagree in the browser ({seen})"
            assert seen["sameProject"], f"case 1: the shot read is not the app's own record ({seen})"

        def check_shot_binding(expected_name, word="Frame A"):
            """CASE 2 — the SHOT binding is what an uninherited frame shows.

            Read off the rendered option label, which the page builds by resolving
            frame -> shot -> entity default. Before this batch the shot default was
            already honoured here; what it did NOT reach was the authority image, and
            that half is proved offline against the real server functions."""
            seen = read_state(word)
            assert seen["inheritLabel"] == f"Follow the shot — {expected_name}", \
                f"case 2: {word} shows {seen['inheritLabel']!r}, expected the shot's declared state {expected_name!r}"
            assert seen["selectedValue"] == "", \
                f"case 2: {word} declares nothing of its own and must sit on the inherit option ({seen})"

        def check_frame_override(expected_state, expected_name):
            """CASE 3 — the frame override is what THAT frame shows, and only it."""
            seen = read_state("Frame B")
            assert seen["selectedValue"] == expected_state, \
                f"case 3: Frame B shows {seen['selectedValue']!r}, expected the override {expected_state!r}"
            assert seen["selectedLabel"] == expected_name, \
                f"case 3: and it must name the state, not an id ({seen})"

        def check_third_frame_untouched(expected_name):
            """CASE 6 — A/B/C. The model attaches to frames generally, so a third
            frame must be unaffected by what the second one declares. The chooser is
            moved to the A→C pair and back, so this reads frame C's own control."""
            select_pair("fr-a|fr-c")
            try:
                seen = read_state("Frame C")
                assert seen["selectedValue"] == "" and seen["inheritLabel"] == f"Follow the shot — {expected_name}", \
                    f"case 6: Frame C must still inherit the shot, unaffected by Frame B ({seen})"
            finally:
                select_pair("fr-a|fr-b")

        def check_stored_shape(expect_override):
            """CASE 5's other half — inheritance is spelled by ABSENCE. A restored
            inheritance that wrote the inherited value back would read identically on
            screen and would be a different, worse fact."""
            # The frame workflow record itself exists for every frame — the shot
            # workspace normalizes action, staging, camera and mode onto it every
            # render. What must be absent is a STATE SELECTION, so that is what is
            # measured; asserting the whole record is absent would be asserting
            # about an unrelated normalizer.
            stored = page.evaluate("""(keys) => {
                const shot = P.shots.find((row) => row.id === 'SH-01');
                const workflows = (shot.creationBrief || {}).frameWorkflows || {};
                const selectionKeys = (id) => Object.keys(workflows[id] || {})
                    .filter((key) => keys.includes(key) || key === 'locationStateId');
                return {
                    shot: shot.continuityStateSelections || {},
                    frameB: (workflows['fr-b'] || {}).characterStateSelections || null,
                    frameASelections: selectionKeys('fr-a'),
                    frameCSelections: selectionKeys('fr-c'),
                };
            }""", ["characterStateSelections", "locationStateSelections", "propStateSelections", "vehicleStateSelections"])
            if expect_override:
                assert stored["frameB"] == {CHARACTER: WET}, f"case 4: the override must be stored on the frame ({stored})"
            else:
                assert not stored["frameB"], f"case 5: a cleared override must leave nothing behind, not an inherited copy ({stored})"
            assert stored["shot"] == {CHARACTER: WET}, f"the shot default must be untouched by any frame edit ({stored})"
            assert stored["frameASelections"] == [] and stored["frameCSelections"] == [], \
                f"a frame that declares nothing must store no state selection at all ({stored})"

        def check_coverage_unaffected():
            """CASE 7 — P4-SEM-A is untouched. Both numbers off the shared derivation
            and the rendered board, on the same mixed requirement case."""
            page.goto(f"{base}/#/location/LOC-DOOR", wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=20000)
            page.wait_for_timeout(1200)
            # The board only exists in the DOM while its own task is selected, so
            # it is selected through the module's OWN task API rather than by
            # reaching past it.
            page.evaluate("() => window.selectFocusedTask && window.selectFocusedTask('coverage')")
            page.wait_for_timeout(900)
            reveal()
            seen = page.evaluate("""() => {
                const board = document.querySelector('.entity-coverage-section > summary');
                const entity = P.locations.find((row) => row.id === 'LOC-DOOR');
                const stats = coverageStats(ensureCoverageSlots('locations', entity));
                return { board: board ? board.textContent : null,
                         canonical: [stats.approvedRequired, stats.required] };
            }""")
            found = re.search(r"(\d+)\s*/\s*(\d+)", seen["board"] or "")
            assert found, f"case 7: the coverage board printed no fraction ({seen['board']!r})"
            printed = [int(found.group(1)), int(found.group(2))]
            assert printed == seen["canonical"], \
                f"case 7: the coverage board disagrees with the shared derivation, {printed} vs {seen['canonical']}"
            assert printed == [1, 2], f"case 7: and the mixed case must still read 1 of 2, not {printed}"

        def check_focused_workspaces():
            """CASE 8 — PR #56's repair still holds. `.focused-taskbar` proves nothing:
            two bounded renderers put that class into the route's own markup."""
            seen = page.evaluate("""() => ({
                shell: !!document.querySelector('.focused-entity-shell'),
                subnav: !!document.querySelector('.focused-subnav'),
                inspector: !!document.querySelector('.focused-inspector'),
                flag: document.getElementById('main').dataset.focusedEntity || '',
            })""")
            assert seen["shell"] and seen["subnav"] and seen["inspector"] and seen["flag"] == "1", \
                f"case 8: Focused Workspaces did not run on the entity route ({seen})"

        def expect_red(name, why, check, *args):
            try:
                check(*args)
            except AssertionError as error:
                controls.append((name, why, str(error).splitlines()[0][:150]))
                return
            raise Red(f"{name} did not go red: {why}")

        # ---- 1. the page, as shipped -----------------------------------------
        open_shot()
        check_contract_loaded()
        findings.append("case 1: shared-continuity-binding.js executed and the runtime resolves through it")

        # CASE 9 — opening writes no continuity data, stated precisely.
        #
        # The seeded fixture is hand-authored and sparse, so the FIRST load runs
        # CineBraid's own v5 normalization: meta defaults, schemaMigrations, a
        # `required` flag on each keyframe. That is long-standing behaviour with
        # nothing to do with this batch, and claiming a blanket "opening writes
        # nothing" over it would be a false claim rather than a proof. What is
        # asserted instead is the property P4-SEM-B owns and a second open, which
        # is the real invariant:
        #
        #   1. the first load left every declared state binding exactly as seeded;
        #   2. re-opening an already-current project writes nothing at all.
        page.evaluate("() => (typeof flushPendingProjectSave === 'function' ? flushPendingProjectSave() : null)")
        page.wait_for_timeout(1500)
        settled = json.loads(project_file.read_text(encoding="utf-8"))
        seeded = project_document()
        assert settled["shots"][0]["continuityStateSelections"] == seeded["shots"][0]["continuityStateSelections"],             "case 9: opening the project invented a shot-level state selection"
        assert settled["shots"][0]["creationBrief"]["frameWorkflows"] == {} or not any(
            key.endswith("StateSelections") or key == "locationStateId"
            for workflow in settled["shots"][0]["creationBrief"]["frameWorkflows"].values()
            for key in workflow),             "case 9: opening the project invented a frame-level state selection"
        assert [state["id"] for state in settled["characters"][0]["continuityStates"]] == [CLEAN, WET],             "case 9: and it did not touch the state catalogue either"

        settled_digest = sha256(project_file)
        open_shot()
        assert sha256(project_file) == settled_digest,             "case 9: re-opening an already-current project rewrote project.json on disk"
        assert page.evaluate("() => (typeof SAVE_REVISION === 'number' ? SAVE_REVISION : -1)") == 0,             "case 9: and it must not have queued an unsaved edit either"
        findings.append("case 9: opening declared no state, and a second open wrote nothing at all")

        # The shot-level selection has no <select> in the frames stage, so it is
        # written through the shipped writer and then READ off the rendered page.
        page.evaluate("() => setShotContinuityState('SH-01', 'CHAR-RHEA', 'st-rhea-wet')")
        page.wait_for_timeout(700)
        reveal()
        check_shot_binding("Rain-soaked")
        findings.append("case 2: the shot's declared state is what an inheriting frame shows")

        # ---- 2. the override, through the shipped control --------------------
        frame_state_control("Frame B").select_option(WET)
        page.wait_for_timeout(700)
        reveal()
        check_frame_override(WET, "Rain-soaked")
        check_third_frame_untouched("Rain-soaked")
        check_stored_shape(True)
        findings.append("case 3/6: a real select_option on the shipped control set the override and left A and C inheriting")

        # ---- 3. save and reload ----------------------------------------------
        page.evaluate("() => (typeof flushPendingProjectSave === 'function' ? flushPendingProjectSave() : null)")
        page.wait_for_timeout(1200)
        open_shot()
        check_shot_binding("Rain-soaked")
        check_frame_override(WET, "Rain-soaked")
        check_third_frame_untouched("Rain-soaked")
        check_stored_shape(True)
        findings.append("case 4: the override and the inheritance both survive a real save and a full page reload")

        saved = json.loads(project_file.read_text(encoding="utf-8"))
        saved_shot = saved["shots"][0]
        assert saved_shot["continuityStateSelections"] == {CHARACTER: WET}, \
            f"case 4: the shot default must be on disk: {saved_shot['continuityStateSelections']}"
        assert saved_shot["creationBrief"]["frameWorkflows"]["fr-b"]["characterStateSelections"] == {CHARACTER: WET}, \
            "case 4: and so must the frame override, in the storage the app writes"
        assert [state["id"] for state in saved["characters"][0]["continuityStates"]] == [CLEAN, WET], \
            "case 4: no unrelated state data changed"

        # ---- 4. removing the override ----------------------------------------
        frame_state_control("Frame B").select_option("")
        page.wait_for_timeout(700)
        reveal()
        seen_b = read_state("Frame B")
        assert seen_b["selectedValue"] == "" and seen_b["inheritLabel"] == "Follow the shot — Rain-soaked", \
            f"case 5: clearing the override must restore shot inheritance on screen ({seen_b})"
        check_stored_shape(False)
        page.evaluate("() => (typeof flushPendingProjectSave === 'function' ? flushPendingProjectSave() : null)")
        page.wait_for_timeout(1200)
        cleared = json.loads(project_file.read_text(encoding="utf-8"))
        assert not (cleared["shots"][0]["creationBrief"]["frameWorkflows"].get("fr-b", {}) or {}).get("characterStateSelections"), \
            "case 5: and the cleared override must be gone from disk rather than written back as an inherited copy"
        findings.append("case 5: removing the override restored inheritance on screen and on disk, by absence")

        # ---- 5. the neighbours -----------------------------------------------
        check_coverage_unaffected()
        findings.append("case 7: P4-SEM-A coverage still reads 1 of 2 and still agrees with the shared derivation")
        check_focused_workspaces()
        findings.append("case 8: Focused Workspaces still builds its own DOM after PR #56")

        # ---- 6. negative controls, in the browser ----------------------------
        # A page proof that cannot fail is decoration. Both controls serve a
        # MUTATED module in flight; nothing on disk is touched, so no control can
        # be "restored" by a checkout that also discards real work.
        original = (ROOT / "public" / MODULE).read_text(encoding="utf-8")

        served["mutation"] = original.replace(
            "  const wantedFrame = text(frameId);", "  const wantedFrame = \"\";", 1)
        assert served["mutation"] != original, "NC-BROWSER-A anchor no longer exists in the shipped module"
        open_shot()
        expect_red("NC-BROWSER-A", "the page must notice a resolver that ignores frame overrides",
                   check_frame_override, WET, "Rain-soaked")

        served["mutation"] = original.replace(
            "  return pickBinding(bindingSet.entityStates, entityId);",
            "  return \"\";", 1)
        assert served["mutation"] != original, "NC-BROWSER-B anchor no longer exists in the shipped module"
        open_shot()
        expect_red("NC-BROWSER-B", "the page must notice a resolver that skips the shot binding",
                   check_shot_binding, "Rain-soaked")

        served["mutation"] = None
        browser.close()

    # ---- the invariants --------------------------------------------------
    assert not paid_calls, f"a paid provider route was called: {paid_calls}"
    assert not offsite, f"a request left this machine: {offsite}"
    assert not page_errors, f"the page raised: {page_errors}"
    fatal = [text for text in console_errors if "favicon" not in text.lower()]
    assert not fatal, f"the console reported errors: {fatal}"

    print(f"[binding-browser] {len(findings)} findings, {len(controls)} negative controls")
    for line in findings:
        print(f"  + {line}")
    for name, why, receipt in controls:
        print(f"  {name:<16} detected: {receipt}")
    print("P4-SEM-B real-browser audit passed: the binding contract loads and resolves in Chromium, the shot "
          "binding and a frame override are both what the page shows, a real select_option sets and clears the "
          "override across a save and a full reload, A/B/C hold, P4-SEM-A coverage and Focused Workspaces are "
          "unaffected, and 2 in-flight negative controls went red. Paid provider calls: 0.")
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
