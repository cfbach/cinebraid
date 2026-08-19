#!/usr/bin/env python3
"""Focused Workspaces, executing in a real Chromium against the real project state.

THE DEFECT THIS SUITE EXISTS FOR, in one line: public/focused-workspaces.js read
project state off `window.P`, and `window.P` does not exist in a browser — so the
module loaded on every route and did nothing at all.

public/app.js declares project state as `let P` at the top level of a classic
script. A top-level `let`/`const` lives in the page's global LEXICAL scope, which
is not the global object, so `window.P` was permanently `undefined` in Chromium,
`enhance()` returned at its own guard, and no reference navigator, no inspector,
no entity shell, no generated disclosure label and no blocked-action explanation
was ever built. The same access mistake covered ACTIVE_PROJECT_SLUG (workspace
storage keys collapsed to one namespace for every project), AUTOMATION_RUNS,
`esc` (so every rendered string would have gone in unescaped the moment anything
DID render), `shotById` and `sceneById` (so the shot inspector and the whole
scene workspace would still have been dead after a `window.P`-only repair).

Nothing caught it. tests/focused-workspaces.js evaluates the module in an empty
sandbox and only calls its pure functions; the render harness does not load the
file at all; and tests/coverage-requirement-semantics.js reaches the inspector's
arithmetic by handing it an entity directly. Every one of those can pass while
the shipped browser runs none of this code, which is why the proof has to be a
real page in a real browser and has to assert something only the module's RUNTIME
can produce.

What it establishes:

  1  the module's runtime ran — DOM only focused-workspaces.js builds is present
     (.focused-entity-shell / .focused-subnav / .focused-inspector), which is a
     different claim from "the script tag loaded"; NC-D holds the script loaded
     and the runtime skipped, and case 1 goes red for it
  2  what it shows is CURRENT — an edit made through the app's own path is on
     screen after the app's own rerender, not a value captured at load
  3  it reads the AUTHORITATIVE object — the module's own resolver returns the
     identical object the rest of CineBraid mutates, and no second project state
     is reachable as a global
  4  it still agrees with the coverage board on the P4-SEM-A mixed requirement
     case, both fractions read off the rendered DOM
  5  it follows an in-session project switch
  6  opening it mutates nothing: project.json is byte-identical, the in-memory
     project is JSON-identical, and the app's unsaved-edit counter never moves

NOTHING HERE IS PAID. /api/generation/fal/jobs is aborted and counted if it is
ever reached, and every off-host request is aborted.

Config and projects live in a temporary directory reached through
CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so data/ and the shipped
sample are never touched, and the directory is removed at the end.
"""

import hashlib, json, os, pathlib, re, shutil, socket, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium

LABEL = "Focused Workspaces real-browser runtime audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
MODULE = "focused-workspaces.js"
FONT_HOSTS = ("https://fonts.googleapis.com", "https://fonts.gstatic.com")
MODULE_SOURCE = (ROOT / "public" / MODULE).read_text(encoding="utf-8")

SECOND_SLUG = "second-project"
SECOND_CHARACTER = "CHAR-SECOND-PROJECT"

# The P4-SEM-A mixed requirement case, verbatim from
# tests/coverage-requirement-semantics.js. None of the four carries the retired
# `required` boolean, which is exactly what the legacy reading got wrong.
MIXED = [
    {"id": "establishing", "label": "Master establishing", "requirement": "required",
     "approvedFile": "LOC-YARD-MASTER.png", "notes": "", "status": "approved"},
    {"id": "reverse", "label": "Reverse angle", "requirement": "required",
     "approvedFile": "", "notes": "", "status": "missing"},
    {"id": "action-zone", "label": "Key action zone", "requirement": "planned",
     "approvedFile": "", "notes": "", "status": "missing"},
    {"id": "overhead", "label": "Overhead / layout", "requirement": "not-required",
     "approvedFile": "", "notes": "", "status": "missing"},
]

RENAMED = 'Courier <renamed> & "current"'


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Red(Exception):
    """A negative control that failed to go red."""


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-focused-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
config = json.loads(config_path.read_text(encoding="utf-8"))
active_slug = config.get("activeProject") or next(p.name for p in sorted(projects_root.iterdir()) if p.is_dir())
active_project_file = projects_root / active_slug / "project.json"

# A second project, so case 5 is a real in-session switch rather than a reload.
second_dir = projects_root / SECOND_SLUG
second_dir.mkdir(parents=True, exist_ok=True)
(second_dir / "project.json").write_text(json.dumps({
    "meta": {"title": "Second project", "schemaVersion": "6.6"},
    "scenes": [], "shots": [],
    "characters": [{"id": SECOND_CHARACTER, "name": "Signal operator", "prefix": SECOND_CHARACTER,
                    "status": "DRAFT", "block": "Only this project has this reference.",
                    "approvedFile": "", "candidateFiles": [], "continuityStates": []}],
    "locations": [], "props": [], "vehicles": [], "audio": [], "mediaAssets": [],
    "jobs": [], "agentRuns": [], "decisions": [], "sessions": [],
}, indent=2), encoding="utf-8")

console_errors, page_errors, offsite, paid_calls, failed_requests = [], [], [], [], []
findings, controls = [], []
# When armed, the guard below serves a MUTATED module instead of the shipped one.
# This is the browser analogue of the render harness's `mutateSource` hook: the
# defect is reintroduced in flight, nothing on disk is touched, and no negative
# control can be "restored" by a checkout that also discards real work.
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
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda request: failed_requests.append(
            f"{request.method} {request.url} ({(request.failure or '')})"))

        def guard(route):
            """No request leaves this machine, the paid route is never called, and
            an armed negative control gets its mutated module."""
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

        def open_route(hash_route, reload=True):
            """Load a route from scratch, so an armed mutation is really fetched."""
            page.goto(f"{base}/{hash_route}", wait_until="domcontentloaded")
            if reload:
                page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#main", timeout=15000)
            page.wait_for_timeout(1200)

        def text_of(selector):
            node = page.locator(selector)
            return node.first.inner_text() if node.count() else ""

        def fraction(text):
            found = re.search(r"(\d+)\s*/\s*(\d+)", text or "")
            return (int(found.group(1)), int(found.group(2))) if found else None

        # ---- the checks, written once so a negative control can demand the
        # ---- same assertion FAIL rather than a paraphrase of it ---------------

        def module_loaded():
            """True of a script tag that merely loaded. Deliberately not proof of
            anything: NC-D keeps this true and case 1 red."""
            return page.evaluate("() => typeof window.__CINEBRAID_FOCUSED === 'object' "
                                 "&& typeof window.enhanceFocusedWorkspace === 'function'")

        def check_execution():
            """CASE 1 — the runtime ran, not merely the script tag.

            Every selector here is built by focused-workspaces.js at runtime and by
            nothing else. `.focused-taskbar` is NOT usable as a signal: the bounded
            renderers in public/entities.js and public/creation-studio.js put that
            same class into the route's own markup, so a taskbar was on screen for
            the entire life of the defect."""
            seen = page.evaluate("""() => ({
                shell: !!document.querySelector('.focused-entity-shell'),
                subnav: !!document.querySelector('.focused-subnav'),
                inspector: !!document.querySelector('.focused-inspector'),
                flag: document.getElementById('main').dataset.focusedEntity || '',
            })""")
            assert seen["shell"], f"case 1: focused-workspaces.js built no entity shell ({seen})"
            assert seen["subnav"], f"case 1: no reference navigator was built ({seen})"
            assert seen["inspector"], f"case 1: no reference inspector was built ({seen})"
            assert seen["flag"] == "1", f"case 1: the module never marked the route enhanced ({seen})"
            inspector = text_of(".focused-inspector")
            assert "REFERENCE INSPECTOR" in inspector, f"case 1: the inspector is not the module's ({inspector!r})"

        def check_current(expected_name):
            """CASE 2 — what is on screen is the CURRENT project, not a snapshot."""
            inspector = text_of(".focused-inspector")
            navigator = text_of(".focused-subnav")
            assert expected_name in inspector, \
                f"case 2: the inspector shows stale state, expected {expected_name!r} in {inspector!r}"
            assert expected_name in navigator, \
                f"case 2: the reference navigator shows stale state: {navigator!r}"

        def check_authority():
            """CASE 3 — one authoritative project state, proved by IDENTITY.

            Equal numbers would not settle it: a snapshot agrees with its source
            right up until the moment it stops. `===` is the only claim that rules
            out a second copy that has not drifted yet."""
            seen = page.evaluate("""() => {
                const resolved = window.__CINEBRAID_FOCUSED.activeProject();
                return {
                    sameObject: resolved === P,
                    resolvedIsProject: !!resolved && typeof resolved === 'object',
                    windowPDeclared: 'P' in window,
                    windowPIsSame: window.P === P,
                };
            }""")
            assert seen["resolvedIsProject"], f"case 3: the module resolved no project at all ({seen})"
            assert seen["sameObject"], \
                f"case 3: the workspace is reading a different object than the app's own P ({seen})"
            assert not seen["windowPDeclared"] or seen["windowPIsSame"], \
                f"case 3: a second, independently writable project state is reachable as window.P ({seen})"
            # A write through the app's binding is visible through the module's
            # resolver with no synchronisation step, because they are one object.
            live = page.evaluate("""() => {
                const token = 'authority-probe-' + P.characters.length;
                P.meta.__focusedAuthorityProbe = token;
                const seen = window.__CINEBRAID_FOCUSED.activeProject().meta.__focusedAuthorityProbe;
                delete P.meta.__focusedAuthorityProbe;
                return { seen, token, cleared: window.__CINEBRAID_FOCUSED.activeProject().meta.__focusedAuthorityProbe };
            }""")
            assert live["seen"] == live["token"] and live["cleared"] is None, \
                f"case 3: a write to the app's project was not visible through the workspace's resolver ({live})"

        def check_coverage_agreement():
            """CASE 4 — the P4-SEM-A mixed case, both fractions read off the DOM.

            The board only exists in the DOM while its own task is selected, so it
            is selected through the module's OWN exported task API rather than by
            reaching past it. textContent, not innerText: the labels are uppercased
            by CSS, and a suite that reads the rendered casing is asserting about a
            stylesheet."""
            page.evaluate("() => window.selectFocusedTask('coverage')")
            page.wait_for_timeout(900)
            # BATCH 2 SLICE 3: that task leads with the demand list and keeps the
            # angle / expression / continuity boards behind a toggle, so the board
            # this case reads is opened the way a filmmaker opens it. Waiting for the
            # board itself rather than for a delay, because the click re-renders.
            toggle = page.locator(".entity-coverage-detail-toggle")
            if toggle.count():
                if page.locator('.entity-coverage-detail[data-coverage-detail-open="1"]').count() == 0:
                    toggle.first.click()
                page.wait_for_selector(".entity-coverage-section > summary", timeout=10000)
            seen = page.evaluate("""([list, id]) => {
                const board = document.querySelector('.entity-coverage-section > summary');
                const facts = [...document.querySelectorAll('.focused-inspector .focused-inspector-facts article')];
                const row = facts.find((article) =>
                    (article.querySelector('span')?.textContent || '').trim().toLowerCase() === 'coverage');
                const entity = P[list].find((item) => item.id === id);
                const stats = coverageStats(ensureCoverageSlots(list, entity));
                return {
                    board: board ? board.textContent : null,
                    inspector: row ? row.querySelector('b').textContent : null,
                    canonical: [stats.approvedRequired, stats.required, stats.planned, stats.notRequired],
                };
            }""", ["locations", location_id])
            board = fraction(seen["board"])
            inspector = fraction(seen["inspector"])
            canonical = seen["canonical"]
            assert board is not None, f"case 4: the coverage board printed no fraction ({seen['board']!r})"
            assert inspector is not None, f"case 4: the inspector printed no coverage fraction ({seen['inspector']!r})"
            assert board == tuple(canonical[:2]), \
                f"case 4: the coverage board disagrees with the shared derivation, {board} vs {canonical[:2]}"
            assert inspector == board, \
                f"case 4: the Reference Inspector prints {inspector} where the coverage board prints {board}"
            return board, canonical

        def expect_red(name, why, check, *args):
            """Run a positive check that MUST now fail, and record the receipt."""
            try:
                check(*args)
            except AssertionError as error:
                controls.append((name, why, str(error).splitlines()[0][:140]))
                return
            raise Red(f"{name} did not go red: {why}")

        # =====================================================================
        # PART 1 — the positive cases, against the shipped module.
        # =====================================================================

        open_route("#/production")
        assert module_loaded(), "the focused workspace module did not load at all"
        ids = page.evaluate("""() => ({
            characters: (P.characters || []).map((row) => row.id),
            locations: (P.locations || []).map((row) => row.id),
            shots: (P.shots || []).map((row) => row.id),
            scenes: (P.scenes || []).map((row) => row.id),
        })""")
        character_id = ids["characters"][0]
        location_id = ids["locations"][0]
        shot_id = ids["shots"][0]

        # ---- 6. opening mutates nothing --------------------------------------
        # The disk hash is taken once the app has finished loading, so any
        # legitimate load-time work is already written and what is measured is the
        # act of opening the workspace. The in-memory claim is scoped tighter still:
        # it brackets a second, explicit full pass of the module's OWN runtime, so
        # a difference could only have come from this module rather than from the
        # route renderer around it.
        before_disk = sha256(active_project_file)
        before_revision = page.evaluate("() => SAVE_REVISION")

        open_route(f"#/character/{character_id}", reload=False)
        check_execution()
        before_state = page.evaluate("() => JSON.stringify(P)")
        page.evaluate("() => { window.enhanceFocusedWorkspace(); window.enhanceFocusedWorkspace(); }")
        page.wait_for_timeout(1600)  # longer than the autosave debounce
        after = page.evaluate("() => [JSON.stringify(P), SAVE_REVISION]")
        assert sha256(active_project_file) == before_disk, \
            "case 6: opening the focused workspace rewrote project.json"
        assert after[0] == before_state, \
            "case 6: running the workspace's own enhancement mutated the in-memory project"
        assert after[1] == before_revision, \
            f"case 6: opening the workspace marked the project dirty ({before_revision} -> {after[1]})"
        findings.append("6: opening the workspace left project.json byte-identical, two further explicit passes of "
                        "its own enhancement left the in-memory project JSON-identical, and the unsaved-edit "
                        "counter never moved")

        # ---- 1 & 3. execution, and one authoritative state -------------------
        check_execution()
        findings.append("1: the reference navigator, entity shell and Reference Inspector are in the real DOM — "
                        "markup only focused-workspaces.js builds, and none of it existed before this repair")
        check_authority()
        findings.append("3: the module's resolver returns the identical object as the app's own P, a write through "
                        "one is immediately visible through the other, and no second project state is reachable")

        # ---- 2. current state, through the app's own path --------------------
        page.evaluate("""async ([id, name]) => {
            P.characters.find((row) => row.id === id).name = name;
            dirty();
            if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
            await route();
        }""", [character_id, RENAMED])
        page.wait_for_timeout(900)
        check_execution()
        check_current(RENAMED)
        findings.append(f"2: a rename made through the app's own path and rerender is on screen in the inspector and "
                        f"the navigator, and the name's angle brackets and quotes render as text — {RENAMED!r}")
        escaped = page.evaluate("() => document.querySelector('.focused-inspector').innerHTML")
        assert "&lt;renamed&gt;" in escaped and "<renamed>" not in escaped, \
            "the inspector interpolated a project value into innerHTML without escaping it"

        # ---- 4. still agrees with the coverage board -------------------------
        page.evaluate("""async ([id, slots]) => {
            P.locations.find((row) => row.id === id).coverageSlots = slots;
            dirty();
            if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
        }""", [location_id, MIXED])
        open_route(f"#/location/{location_id}", reload=False)
        check_execution()
        board, canonical = check_coverage_agreement()
        assert canonical[1] == 2 and canonical[3] == 1, \
            f"case 4: the P4-SEM-A mixed fixture did not survive into the browser ({canonical})"
        findings.append(f"4: on the P4-SEM-A mixed case the coverage board and the Reference Inspector both render "
                        f"{board[0]}/{board[1]}, with {canonical[2]} planned and {canonical[3]} not-required excluded "
                        f"from the requirement — read off the DOM of both surfaces, not recomputed by this suite")

        # ---- 5. an in-session project switch ---------------------------------
        page.evaluate("([slug]) => switchProject(slug)", [SECOND_SLUG])
        page.wait_for_function(f"() => ACTIVE_PROJECT_SLUG === {json.dumps(SECOND_SLUG)}", timeout=15000)
        page.wait_for_timeout(900)
        switched = page.evaluate("() => ({ slug: ACTIVE_PROJECT_SLUG, ids: (P.characters || []).map((r) => r.id) })")
        assert switched["slug"] == SECOND_SLUG and switched["ids"] == [SECOND_CHARACTER], \
            f"case 5: the app did not switch project in-session ({switched})"
        open_route(f"#/character/{SECOND_CHARACTER}", reload=False)
        check_execution()
        check_current("Signal operator")
        gone = text_of(".focused-subnav")
        assert character_id not in gone, \
            f"case 5: the reference navigator still lists the previous project's references ({gone!r})"
        findings.append("5: after an in-session switchProject() the workspace rebuilds against the newly active "
                        "project and the previous project's references are gone from the navigator")

        # =====================================================================
        # PART 2 — negative controls. Each reintroduces one defect IN FLIGHT and
        # must make the case above it fail. A load crash proves nothing, so every
        # control also asserts the module still loaded, the page raised no error,
        # and the intended defect is observably live.
        # =====================================================================

        # Back to the project the controls below are written against. The switch is
        # server-side as well as client-side, so the reload each control performs
        # comes up in the right project.
        page.evaluate("([slug]) => switchProject(slug)", [active_slug])
        page.wait_for_function(f"() => ACTIVE_PROJECT_SLUG === {json.dumps(active_slug)}", timeout=15000)
        page.wait_for_timeout(900)

        def arm(name, *pairs):
            source = MODULE_SOURCE
            for before, after in pairs:
                assert source.count(before) == 1, \
                    f"{name}: the anchor it patches appears {source.count(before)} times: {before[:70]!r}"
                source = source.replace(before, after)
            served["mutation"] = source

        def settle(hash_route):
            del page_errors[:]
            open_route(hash_route)
            assert module_loaded(), "the mutated module failed to load — a load crash proves nothing"
            assert not page_errors, f"the mutated module raised an uncaught error: {page_errors}"

        # ---- NC-A: put the undefined global back -----------------------------
        arm("NC-A", ("function activeProject() { return typeof P === \"undefined\" ? null : P; }",
                     "function activeProject() { return typeof window.P === \"undefined\" ? null : window.P; }"))
        settle(f"#/character/{character_id}")
        live = page.evaluate("() => ({ resolved: window.__CINEBRAID_FOCUSED.activeProject(), hasP: typeof P })")
        assert live["resolved"] is None and live["hasP"] == "object", \
            f"NC-A: the defect is not live — the module still resolved a project ({live})"
        expect_red("NC-A", "project state read back off window.P, the exact pre-fix defect", check_execution)

        # ---- NC-B: a stale snapshot instead of the live object ---------------
        arm("NC-B", ("function activeProject() { return typeof P === \"undefined\" ? null : P; }",
                     "let SNAPSHOT = null;\n  function activeProject() { "
                     "if (!SNAPSHOT && typeof P !== \"undefined\" && P) SNAPSHOT = JSON.parse(JSON.stringify(P)); "
                     "return SNAPSHOT; }"))
        settle(f"#/character/{character_id}")
        page.evaluate("""async ([id]) => {
            P.characters.find((row) => row.id === id).name = "Renamed after the snapshot";
            dirty();
            await route();
        }""", [character_id])
        page.wait_for_timeout(900)
        live = page.evaluate("() => window.__CINEBRAID_FOCUSED.activeProject() === P")
        assert live is False, "NC-B: the defect is not live — the module is still reading the authoritative object"
        expect_red("NC-B", "the workspace reads a clone taken once, so a later edit never reaches it",
                   check_current, "Renamed after the snapshot")
        page.evaluate("""async ([id, name]) => {
            P.characters.find((row) => row.id === id).name = name;
            dirty();
            if (typeof flushPendingProjectSave === "function") await flushPendingProjectSave();
        }""", [character_id, RENAMED])
        page.wait_for_timeout(600)

        # ---- NC-C: a second, independently writable project state ------------
        arm("NC-C", ("function activeProject() { return typeof P === \"undefined\" ? null : P; }",
                     "function activeProject() { "
                     "if (!window.P) window.P = typeof P === \"undefined\" ? null : JSON.parse(JSON.stringify(P)); "
                     "return window.P; }"))
        settle(f"#/character/{character_id}")
        live = page.evaluate("() => ({ exists: 'P' in window, diverges: window.P !== P })")
        assert live["exists"] and live["diverges"], \
            f"NC-C: the defect is not live — no second project object was created ({live})"
        expect_red("NC-C", "a window.P clone the app never writes to, free to diverge from the real project",
                   check_authority)

        # ---- NC-D: the script loads, the enhancement pass never runs ----------
        # Both entry points have to go, because there are two: schedule() behind a
        # rAF, and the direct window.enhanceFocusedWorkspace?.() call app.js makes
        # after every route render. Everything else about the file still executes —
        # it defines its functions, publishes __CINEBRAID_FOCUSED, attaches its
        # listeners and runs syncFocusedRouteMode — so this is precisely the state a
        # "did the script load?" check cannot tell apart from a working module.
        arm("NC-D",
            ("requestAnimationFrame(() => requestAnimationFrame(enhance));", "void enhance;"),
            ("window.enhanceFocusedWorkspace = enhance;", "window.enhanceFocusedWorkspace = () => {};"))
        settle(f"#/character/{character_id}")
        assert module_loaded(), "NC-D: the module must still load — that is the whole point of this control"
        assert page.evaluate("() => document.body.dataset.focusedRoute === 'character'"), \
            "NC-D: the defect is not live — the module did not even run its own top level"
        expect_red("NC-D", "the script loads, exports its API and syncs the route, and the enhancement never runs",
                   check_execution)

        # ---- NC-E: the pre-P4-SEM-A boolean-only coverage reading ------------
        arm("NC-E", ("const summary = window.summariseCoverage ? window.summariseCoverage(slots) "
                     ": { required: 0, approvedRequired: 0 };",
                     "const kept = slots.filter((slot) => slot.required !== false);\n    const summary = "
                     "{ required: kept.length, approvedRequired: kept.filter((slot) => slot.approvedFile).length };"))
        settle(f"#/location/{location_id}")
        check_execution()
        live = page.evaluate("""([list, id]) => {
            const entity = P[list].find((row) => row.id === id);
            return { legacy: window.__CINEBRAID_FOCUSED.inspectorCoverage(entity),
                     canonical: coverageStats(ensureCoverageSlots(list, entity)).required };
        }""", ["locations", location_id])
        assert live["legacy"]["required"] != live["canonical"], \
            f"NC-E: the defect is not live — the legacy reading happened to agree ({live})"
        expect_red("NC-E", "the inspector counts every slot without a `required: false` twin, the exact "
                           "reading P4-SEM-A retired", check_coverage_agreement)

        served["mutation"] = None
        open_route(f"#/location/{location_id}")
        check_execution()
        check_coverage_agreement()
        findings.append("the shipped module was re-served after the controls and every case passed again, so the "
                        "five red results came from the mutations and not from the environment")

        assert not page_errors, f"the audit raised uncaught errors: {page_errors}"
        assert not console_errors, f"the audit logged console errors: {console_errors}; failed: {failed_requests}"
        browser.close()

    assert not paid_calls, f"a paid route was called: {paid_calls}"
    assert not offsite, f"a request left this machine: {offsite}"
    assert len(controls) == 5, f"expected 5 negative controls, recorded {len(controls)}"

    print(f"{LABEL} passed: Focused Workspaces executes in a real Chromium against the same authoritative project "
          f"state as the rest of CineBraid, follows edits and project switches, agrees with the coverage board on "
          f"the P4-SEM-A mixed case, mutates nothing by rendering, and contacted no paid route "
          f"({len(controls)} negative controls reintroduced, {len(controls)} caught, 0 paid calls).")
    for line in findings:
        print(f"  - {line}")
    for name, why, detail in controls:
        print(f"  {name}   detected: {why}\n           receipt: {detail}")

finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
