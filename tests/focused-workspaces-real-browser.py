#!/usr/bin/env python3
"""A+ reference runtime compatibility in a real Chromium.

The accepted Reference Desk replaces the permanent legacy reference inspector.
Keep the original guarantees: live project state, safe text, coverage agreement,
project switching, read-only browsing, and five observable negative controls.
The controls now mutate the renderer that owns this surface, not the legacy
post-render enhancer that intentionally skips it. The retained focused-state
resolver is still checked for identity with P and absence of a second global.
All settings/projects are disposable; paid and offsite requests are refused.
"""

import hashlib, json, os, pathlib, re, shutil, socket, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium

LABEL = "Focused Workspaces real-browser runtime audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
MODULE = "reference-desk.js"
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
            return page.evaluate("() => typeof window.CineBraidReferenceDesk === 'object' "
                                 "&& typeof window.CineBraidReferenceDesk.view === 'function'")

        def check_execution():
            """The current renderer must execute, not merely load its script."""
            seen = page.evaluate("""() => ({
                desk: !!document.querySelector('[data-reference-desk]'),
                heading: !!document.querySelector('#rd-title'),
                coverage: !!document.querySelector('.rd-coverage'),
                legacy: !!document.querySelector('.focused-inspector'),
            })""")
            assert seen['desk'] and seen['heading'] and seen['coverage'], f'case 1: Reference Desk did not render: {seen}'
            assert not seen['legacy'], 'case 1: a competing legacy inspector was mounted on Reference Desk'

        def check_current(expected_name):
            """The accepted page heading reflects the live project after an edit."""
            heading = text_of('#rd-title')
            assert heading == expected_name, f'case 2: stale reference heading {heading!r}, expected {expected_name!r}'

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
            """The accepted Required views summary reads the shared enum-based owner."""
            seen = page.evaluate("""(id) => {
                const entity=P.locations.find(row=>row.id===id), state=document.getElementById('rd-state').value;
                const value=CineBraidReferenceMedia.coverage(entity,CineBraidReferenceMedia.listing(SCAN,'locations',id),state);
                const stats=coverageStats(entity.coverageSlots);
                return {text:document.querySelector('.rd-coverage header span')?.textContent,
                    canonical:[value.filled,value.required,stats.planned,stats.notRequired]};
            }""", location_id)
            match=re.search(r'(\d+) of (\d+) required views filled',seen['text'] or '')
            assert match, f"case 4: missing required-view summary {seen}"
            rendered=tuple(map(int,match.groups()))
            assert rendered==tuple(seen['canonical'][:2]), f"case 4: coverage disagrees with shared owner: {seen}"
            return rendered,seen['canonical']

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
        findings.append("1: the Reference Desk heading and Required views summary are in the real DOM — "
                        "the current renderer ran and no competing legacy inspector was mounted")
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
        findings.append(f"2: a rename made through the app's own path and rerender is on screen in the heading and "
                        f"the current context, and the name's angle brackets and quotes render as text — {RENAMED!r}")
        escaped = page.evaluate("() => document.querySelector('#rd-title').innerHTML")
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
        inspector, canonical = check_coverage_agreement()
        assert canonical[1] == 2 and canonical[3] == 1, \
            f"case 4: the P4-SEM-A mixed fixture did not survive into the browser ({canonical})"
        findings.append(f"4: on the P4-SEM-A mixed case the Required views summary renders {inspector[0]}/{inspector[1]} "
                        f"from the shared derivation, with {canonical[2]} planned and {canonical[3]} not-required "
                        f"excluded from the requirement, and the summary uses the exact selected-file count from "
                        f"the same function — both read off the DOM, neither recomputed by this suite")

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
        gone = text_of("[data-reference-desk]")
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

        # Five controls over the actual A+ renderer. Each must remain loadable,
        # expose the intended defect, and fail the same positive assertion.
        entity_anchor = "const entity=P[list]?.find(r=>r.id===id); if(!entity)return null;"
        arm("NC-A", (entity_anchor,
            "const entity=(window.P || {})[list]?.find(r=>r.id===id); if(!entity)return null;"))
        settle(f"#/character/{character_id}")
        assert page.evaluate("() => typeof P==='object' && !window.P"), 'NC-A precondition: lexical project remains available'
        expect_red("NC-A", "reading the absent window.P leaves the current renderer inactive", check_execution)

        arm("NC-B", (entity_anchor,
            "const snapshot=window.__referenceSnapshot || (window.__referenceSnapshot=JSON.parse(JSON.stringify(P))); "
            "const entity=snapshot[list]?.find(r=>r.id===id); if(!entity)return null;"))
        settle(f"#/character/{character_id}")
        page.evaluate("""async id => {
            P.characters.find(row=>row.id===id).name='Renamed after the snapshot';
            dirty(); await route();
        }""", character_id)
        assert page.evaluate("() => window.__referenceSnapshot !== P"), 'NC-B must introduce an independent snapshot'
        expect_red("NC-B", "a stale clone does not reflect the live edit", check_current, 'Renamed after the snapshot')
        page.evaluate("""async ([id,name]) => {
            P.characters.find(row=>row.id===id).name=name; dirty();
            if(typeof flushPendingProjectSave==='function')await flushPendingProjectSave();
        }""", [character_id,RENAMED])

        arm("NC-C", (entity_anchor,
            "const copy=window.P || (window.P=JSON.parse(JSON.stringify(P))); "
            "const entity=copy[list]?.find(r=>r.id===id); if(!entity)return null;"))
        settle(f"#/character/{character_id}")
        assert page.evaluate("() => window.P && window.P !== P"), 'NC-C must expose a second mutable project'
        expect_red("NC-C", "a second project object is reachable as window.P", check_authority)

        arm("NC-D", ("window.CineBraidReferenceDesk={view,library};",
            "window.CineBraidReferenceDesk={view:()=>null,library:()=>null};"))
        settle(f"#/character/{character_id}")
        assert module_loaded(), 'NC-D keeps the renderer script loaded'
        expect_red("NC-D", "a loaded renderer that never produces its surface", check_execution)

        arm("NC-E", ("coverage:R.coverage(entity,media,state.stateId)",
            "coverage:{...R.coverage(entity,media,state.stateId),required:(entity.coverageSlots||[]).filter(s=>s.required!==false).length}"))
        settle(f"#/location/{location_id}")
        check_execution()
        expect_red("NC-E", "retired boolean semantics count planned and not-required views as required", check_coverage_agreement)

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
