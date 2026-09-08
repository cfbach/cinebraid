#!/usr/bin/env python3
"""References UX — ALPHA BLOCKERS, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. tests/reference-ux-convergence.js proves every
semantic claim of this slice in Node: that the four coverage states are unchanged,
that the demand gate is the one shared resolution, that Save crop & use assigns and
Save as candidate does not, and that a candidate a view already holds is offered no
assignment. Six claims cannot be proven there, and they are the six a fresh user
would actually notice:

  * THE ATTENTION TONE IS A COLOUR ON SCREEN. Node compares class names; only a
    browser resolves the cascade, so only here can "the amber is gone and the chip
    is legible" be measured rather than asserted about a string.
  * THE COVERAGE WORKSPACE IS REACHABLE WITHOUT SCROLLING PAST A SECOND COPY OF
    ITSELF. That is a claim about geometry — how much page sits between the compact
    strip and the editable board — and Node lays nothing out.
  * A STAGED CHOICE PREVIEWS UNDER A REAL CLICK. The Node suite calls the handler.
    This clicks a card in the visual chooser through the real event path and reads
    the preview element's own resolved state.
  * CANCEL REALLY CANCELS. Closing a modal is a DOM lifecycle, not a function call.
  * SAVE CROP & USE IS ONE PRESS, END TO END. The canvas, the upload, the server's
    scan and the assignment all run for real against a sandboxed server, which is
    the only place the whole chain exists at once.
  * AND NOTHING TAKES THE EXTRACTOR'S PLACE. "Candidate Review did not open" is a
    statement about what is on screen after an action, which needs a screen.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a detector that can only ever report
one answer is worth nothing. Both work by changing the PROJECT rather than the code,
so the same shipped renderer is asked two questions with opposite correct answers:

  N1 casts the character into a shot whose dependency reading is AMBIGUOUS, so the
     demand answer cannot be given — and requires the amber to come BACK, proving
     the "no attention claimed" assertion measures a state that can be present.
  N2 opens a candidate the view does NOT hold and requires the assign action to
     APPEAR, proving the "no stale assign" assertion is not passing against a
     button that never exists.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config, project and media live
in a temporary directory reached through CINEBRAID_CONFIG_PATH and
CINEBRAID_PROJECTS_ROOT, so data/ and the shipped sample are never touched; the route
guard aborts the paid route and anything off-loopback.
"""

import base64, json, os, pathlib, re, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "References alpha blockers real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"
# The sandbox's own copied project, overwritten in place. A directory invented
# beside it is not a project the server knows about, so its saves land nowhere.
SLUG = "dogfood-sample"
ENTITY = "CHAR-ALPHA"
SHOT = "L1-01"

page_errors, offsite, paid_calls = [], [], []
findings = []

# A three-panel strip is what a turnaround sheet is, and the extractor's default
# 3x1 preset takes the left third of it. 96x32 with three differently coloured
# thirds keeps the upload trivial while still giving canvas real pixels to copy.
SHEET_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAgCAIAAABiouoDAAAAUklEQVR4nO3QMQ0AIBAEsJeDCGZE"
    "MCMCiS8LFTeQNKmCVo8ddVfWPFklSJAgQYIECRIkSJAgQYIECRIkSJAgQYIECRIkSJAgQYIECRIk"
    "SNC/QQ8c0XDEeFVB8AAAAABJRU5ErkJggg=="
)
PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

PRIMARY = f"{ENTITY}-PRIMARY.png"
SHEET = f"{ENTITY}-SHEET.png"
LOOSE = f"{ENTITY}-LOOSE.png"

RECEIPT = {
    "id": "authority-000001", "sequence": 1, "actor": "human", "act": "explicit-approval",
    "command": "approve-entity-state", "kind": "entity-state",
    "targetKey": f"entity-state:characters:{ENTITY}#state-default",
    "shotId": "", "frameId": "", "unitKey": "", "list": "characters",
    "entityId": ENTITY, "stateId": "state-default", "slotId": "",
    "value": PRIMARY, "assetId": "", "at": "2026-08-15T00:00:00.000Z",
    "status": "current", "supersededBy": "", "supersededAt": "", "revokedAt": "",
    "revocationReason": "", "note": "",
    "provenance": {"manualAction": "gesture-browser-fixture", "via": "real-browser-fixture", "gesture": "click"},
}


def character():
    """A dormant reference: an approved primary, four required views nobody has
    filled, and no shot using it — the exact shape the fresh-user pass reported as
    "nothing is required now" over four amber Required — missing chips."""
    return {
        "id": ENTITY, "prefix": ENTITY, "anchorPrefix": ENTITY, "name": "Nora Alpha",
        "approvedFile": PRIMARY,
        "coverageSlots": [
            {"id": "front", "label": "Front", "requirement": "required", "selectedFile": ""},
            {"id": "front-three-quarter", "label": "3/4 front", "requirement": "required", "selectedFile": ""},
            {"id": "profile", "label": "Profile", "requirement": "required", "selectedFile": ""},
            {"id": "rear", "label": "Rear", "requirement": "planned", "selectedFile": ""},
        ],
        "expressionSlots": [{"id": "neutral", "label": "Neutral", "requirement": "required", "selectedFile": ""}],
        "continuityStates": [
            {"id": "state-default", "name": "Default", "isDefault": True, "approvedFile": PRIMARY,
             "notes": "Primary identity."},
        ],
        "candidateFiles": [
            {"stored": PRIMARY, "original": PRIMARY, "decision": "unreviewed"},
            {"stored": LOOSE, "original": "loose-drop.png", "decision": "unreviewed",
             "coverageJobType": "single-reference"},
            {"stored": SHEET, "original": SHEET, "decision": "unreviewed",
             "coverageJobType": "sheet", "coverageSheetType": "angles"},
        ],
    }


def base_project():
    return {
        "meta": {"title": "References Alpha", "format": "Test", "version": "v1",
                 "hubVersion": "v6.0.0", "schemaVersion": "6.6", "aiPolicy": "project-default",
                 "world": {}, "models": []},
        "qcChecklist": [], "characters": [character()], "locations": [], "props": [],
        "vehicles": [], "audio": [], "mediaAssets": [], "jobs": [], "agentRuns": [],
        "decisions": [], "sessions": [], "finishJobs": [],
        "productionAuthority": {"version": 1, "receipts": [RECEIPT]},
        "scenes": [{"id": "SC-01", "title": "Scene", "whatHappens": "A test beat.",
                    "howItFeels": "Exact.", "characters": [], "audio": {}}],
        "shots": [{
            "id": SHOT, "scene": "SC-01", "title": "Shot", "desc": "A controlled browser test.",
            "positioning": "Locked frame.", "dur": 5, "workflowStatus": "DRAFT", "status": "BUILT",
            "characters": [], "codes": [], "risks": [], "candidateFiles": [],
            "creationBrief": {},
            "keyframes": [{"id": "fr-a", "label": "A", "title": "Opening",
                           "description": "Opening frame.", "generationPackages": []}],
            "clips": [],
        }],
    }


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-references-alpha-"))
subprocess.run(["node", "scripts/qa-sandbox.js", "--out", str(sandbox / "env"), "--demo", "--force"],
               cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
config_path = sandbox / "env" / "config.json"
projects_root = sandbox / "env" / "projects"
project_dir = projects_root / SLUG
anchors_dir = project_dir / "anchors"
anchors_dir.mkdir(parents=True, exist_ok=True)
(project_dir / "project.json").write_text(json.dumps(base_project(), indent=2), encoding="utf-8")
(anchors_dir / PRIMARY).write_bytes(PIXEL_PNG)
(anchors_dir / LOOSE).write_bytes(PIXEL_PNG)
(anchors_dir / SHEET).write_bytes(SHEET_PNG)

config = json.loads(config_path.read_text(encoding="utf-8"))
config["activeProject"] = SLUG
config["assistant"] = {"provider": "none", "visionProvider": "none"}
config.setdefault("generation", {}).setdefault("fal", {})["enabled"] = False
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")


port = free_port()
server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT,
    env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config_path),
         "CINEBRAID_PROJECTS_ROOT": str(projects_root), "FAL_KEY": ""},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), .25):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError("CineBraid server did not start")

    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        findings.append("0. Chromium launched against a sandboxed CineBraid server")
        context = browser.new_context(viewport={"width": 1600, "height": 1000})

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

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        def open_reference():
            """DRIVE THE ROUTE, do not wait on boot timing. A hash in the initial URL
            races the project load: the app can finish booting on whatever surface it
            resolved first, and then nothing re-renders, so a wait for the entity page
            expires against a page that is perfectly healthy. Setting the hash and
            calling route() AFTER the project is in hand asks for the surface the suite
            actually needs, which is the same thing every other reference suite does."""
            page.evaluate("(id) => { location.hash = '#/character/' + id; }", ENTITY)
            page.evaluate("() => route()")
            try:
                page.wait_for_selector(".bounded-entity-page[data-selected-task]", timeout=25000)
            except Exception:
                surface = page.evaluate(
                    """() => ({ hash: location.hash,
                                modal: !document.getElementById('modal').classList.contains('hidden'),
                                modalHead: (document.getElementById('modal').textContent || '').slice(0, 200),
                                main: (document.getElementById('main').textContent || '').slice(0, 200) })""")
                raise AssertionError(f"the reference page never rendered; the page was showing {surface}")

        page.goto(f"{base}/", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=25000)
        page.wait_for_function(
            "(id) => typeof P === 'object' && P && (P.characters || []).some((c) => c && c.id === id)",
            arg=ENTITY, timeout=25000)
        open_reference()

        def open_coverage():
            """WAIT FOR THE REQUESTED THING, never for a fixed delay. Selecting a stage
            re-renders asynchronously, so this waits for the stage the click asked for."""
            page.locator(".bounded-entity-taskbar .focused-task-button",
                         has_text="Production needs").click()
            page.wait_for_function(
                """() => { const n = document.querySelector('.bounded-entity-page');
                           return n && n.dataset.selectedTask === 'coverage'; }""", timeout=25000)
            page.wait_for_selector("#main section.entity-demand", timeout=25000)

        def open_board():
            """The coverage detail is derived from the selected sub-view, not a
            <details> — see tests/reference-reframe-real-browser.py for why."""
            node = page.locator(".entity-coverage-detail")
            if node.get_attribute("data-coverage-detail-open") != "1":
                page.locator(".entity-coverage-detail-toggle").click()
            page.wait_for_selector(".coverage-slot-grid .coverage-slot-card", timeout=15000)

        def slot_files():
            return page.evaluate(
                """(id) => Object.fromEntries((P.characters.find((c) => c.id === id).coverageSlots || [])
                     .map((s) => [s.id, s.selectedFile || s.approvedFile || '']))""", ENTITY)

        def select_view(slot_id):
            page.locator(f'.bounded-slot-rail button[onclick*="\'{slot_id}\'"]').click()
            page.wait_for_function(
                """(id) => { const c = document.querySelector('.coverage-slot-card header b');
                             return !!c; }""", arg=slot_id, timeout=15000)

        # ---- 1. the coverage stage leads with a compact summary, not a second board ----
        open_coverage()
        assert not page_errors, f"the reference page raised uncaught errors: {page_errors}"

        summary = page.evaluate("""() => {
            const strip = document.querySelector('.entity-demand-summary');
            const demand = document.querySelector('section.entity-demand');
            if (!strip || !demand) return null;
            return {
                now: Number(strip.dataset.demandSummaryNow || -1),
                headline: (demand.querySelector('header b') || {}).textContent || '',
                coverage: (strip.querySelector('b') || {}).textContent || '',
                needed: (strip.querySelector('.entity-demand-summary-now b') || {}).textContent || '',
                stripTop: strip.getBoundingClientRect().top,
                stripHeight: strip.getBoundingClientRect().height,
                demandHeight: demand.getBoundingClientRect().height,
                rows: document.querySelectorAll('section.entity-demand .entity-demand-row').length,
                compact: document.querySelectorAll('section.entity-demand .entity-demand-row.is-compact').length,
            };
        }""")
        assert summary, "1. the production-needs panel must render"
        assert summary["now"] == 0, f"1. no shot uses this reference, so nothing may be owed, got {summary['now']}"
        assert "nothing is required now" in summary["headline"], \
            f"1. the headline must say so, got {summary['headline']!r}"
        assert summary["needed"].strip().lower() == "none", \
            f"1. and the compact strip must agree, got {summary['needed']!r}"
        assert "Views" in summary["coverage"], f"1. the strip must summarise the plan, got {summary['coverage']!r}"
        assert summary["rows"] >= 4, f"1. the plan is still listed in full, got {summary['rows']} rows"
        assert summary["compact"] >= 4, \
            f"1. and coverage rows are drawn compact rather than as a second board, got {summary['compact']}"
        assert summary["demandHeight"] < 1000, \
            f"1. the panel must not be a full second inventory, got {int(summary['demandHeight'])}px tall"
        findings.append(
            f"1. the coverage stage leads with a {int(summary['stripHeight'])}px compact strip reading "
            f"{summary['coverage']!r} · NEEDED NOW {summary['needed']!r}, over a {int(summary['demandHeight'])}px "
            f"panel whose {summary['rows']} plan rows are all compact")

        # ---- 2. and nothing on the board claims attention ------------------------------
        open_board()
        chips = page.evaluate("""() => {
            const rail = document.querySelector('.bounded-slot-rail');
            if (!rail) return null;
            const buttons = [...rail.querySelectorAll('button')];
            return {
                states: buttons.map((b) => b.dataset.slotState),
                tones: buttons.map((b) => [...b.classList].find((c) => c.startsWith('tone-')) || ''),
                labels: buttons.map((b) => ((b.querySelector('small') || {}).textContent || '').trim()),
                dotColours: buttons.map((b) => getComputedStyle(b.querySelector('i')).backgroundColor),
                amberVar: getComputedStyle(document.documentElement).getPropertyValue('--amber').trim(),
                card: [...(document.querySelector('.coverage-slot-card') || { classList: [] }).classList],
                board: (document.querySelector('.entity-coverage-section') || {}).dataset || {},
                foldSummary: ((document.querySelector('.entity-coverage-section > summary span') || {}).textContent || '').trim(),
            };
        }""")
        assert chips, "2. the coverage rail must render"
        assert "tone-attention" not in chips["tones"], \
            f"2. no chip may claim attention while nothing is waiting, got {chips['tones']}"
        # THE WORD ITSELF, not merely the colour. A chip that says Required beside a
        # panel that has just said nothing is required is the contradiction however
        # it is painted, and "Required — not needed yet" was a fifth state in all
        # but name. Four display states, and only one of them says Required.
        assert not any("Required" in label for label in chips["labels"]), \
            f"2. and none may use the word Required, got {chips['labels']}"
        assert "Planned" in chips["labels"], \
            f"2. the effective state is Planned, in the vocabulary that already means it, got {chips['labels']}"
        assert "required-missing" not in chips["states"], \
            f"2. and required-missing appears on no chip, got {chips['states']}"
        assert set(chips["states"]) <= {"satisfied", "required-missing", "planned", "optional"}, \
            f"2. every chip state must be one of the four display states, got {chips['states']}"
        assert "needs-attention" not in chips["card"], \
            f"2. and the slot card's own amber border follows the same answer, got {chips['card']}"
        assert chips["board"].get("boardOutstanding") == "0", \
            f"2. the board publishes nothing outstanding, got {chips['board'].get('boardOutstanding')!r}"
        assert "none needed now" in chips["foldSummary"], \
            f"2. and its fold summary says so, got {chips['foldSummary']!r}"
        assert "required" not in chips["foldSummary"].lower(), \
            f"2. without using the word required while nothing is, got {chips['foldSummary']!r}"
        findings.append(
            f"2. every chip reads {chips['labels'][0]!r} in tone {chips['tones'][0]!r} with dot colour "
            f"{chips['dotColours'][0]}, the board reports 0 outstanding, and the fold says {chips['foldSummary']!r}")

        # ---- 2b. and the automation dialog says the same thing ------------------------
        # THE HOLD BLOCKER, ON ONE SCREEN. The board read Planned / none needed now
        # while the shipped automation dialog read "4 required coverage slots still
        # missing" about the same four views. Image generation is enabled on the
        # page's own config object so the dialog will open; nothing is contacted and
        # START is never pressed.
        automation = page.evaluate("""() => {
            CONFIG.generation = CONFIG.generation || {};
            CONFIG.generation.fal = { ...(CONFIG.generation.fal || {}), enabled: true, keySource: "environment" };
            const entity = P.characters.find((c) => c.id === 'CHAR-ALPHA');
            const slots = ensureCoverageSlots('characters', entity).filter((s) => !s.retired);
            openCoverageAutomationModal('characters', 'CHAR-ALPHA', 'hybrid');
            const summary = document.getElementById('coverage-missing-summary');
            const out = {
                opened: !document.getElementById('modal').classList.contains('hidden'),
                unfilled: slots.filter((s) => isRequiredCoverage(s) && !slotSelectedFile(s)).length,
                copy: summary ? summary.textContent.trim() : '',
                visible: !!summary && summary.getBoundingClientRect().height > 0,
            };
            closeModal();
            return out;
        }""")
        assert automation["opened"], "2b. the coverage automation dialog must open"
        assert automation["visible"], "2b. and its work summary must be on screen"
        assert automation["unfilled"] >= 1, \
            f"2b. baseline: the structural plan still has unfilled views ({automation['unfilled']})"
        assert automation["copy"].startswith(f"{automation['unfilled']} planned coverage view"), \
            f"2b. it must offer the whole structural plan, in current-demand words, got {automation['copy']!r}"
        assert "Nothing is required by current shots." in automation["copy"], \
            f"2b. and say why it is not calling it required, got {automation['copy']!r}"
        claim = automation["copy"].split(".")[0]
        for word in ("required", "missing", "blocking"):
            assert word not in claim.lower(), \
                f"2b. the dialog must not use {word} language beside a board reading Planned, got {claim!r}"
        findings.append(f"2b. the automation dialog offers the same {automation['unfilled']} structural views as "
                        f"{automation['copy']!r} — the same screen as a board reading "
                        f"{chips['foldSummary']!r}, with no second answer between them")

        # ---- 2c. and so does the first line of the reference ---------------------------
        # THE SURFACE A FRESH USER READS FIRST, and the last one still naming the
        # structural plan as an obligation: "Views still needed: Front, 3/4 front,
        # Profile" over chips reading Planned. The hero lives on the reference stage,
        # so this steps back to it and returns.
        page.locator(".bounded-entity-taskbar .focused-task-button", has_text="Primary reference").click()
        page.wait_for_function(
            """() => { const n = document.querySelector('.bounded-entity-page');
                       return n && n.dataset.selectedTask === 'reference'; }""", timeout=25000)
        page.wait_for_selector(".reference-primary-hero", timeout=25000)
        hero = page.evaluate("""() => {
            const line = document.querySelector('.reference-primary-remaining');
            const entity = P.characters.find((c) => c.id === 'CHAR-ALPHA');
            const plan = ensureCoverageSlots('characters', entity)
                .filter((s) => !s.retired && coverageRequirement(s) === 'required' && !slotSelectedFile(s))
                .map((s) => s.label || s.id);
            return {
                text: line ? line.textContent.trim() : '',
                visible: !!line && line.getBoundingClientRect().height > 0,
                plan,
            };
        }""")
        assert hero["text"], "2c. the hero must state what the coverage plan still holds"
        assert hero["visible"], "2c. visibly"
        assert hero["text"].startswith("Planned view"), \
            f"2c. and describe it as a plan, got {hero['text']!r}"
        assert "still needed" not in hero["text"], \
            f"2c. never as an obligation, got {hero['text']!r}"
        # WHAT THE PLAN CONTAINS DID NOT CHANGE — the same views, still named.
        assert hero["plan"] and hero["plan"][0] in hero["text"], \
            f"2c. and still name the plan's own views, got {hero['text']!r} for {hero['plan']}"
        findings.append(f"2c. the primary hero reads {hero['text']!r} — the same {len(hero['plan'])} structural "
                        f"views, described as the plan they are, on the same reference whose board reads "
                        f"{chips['foldSummary']!r}")
        open_coverage()
        open_board()

        # ---- 3-5. browse visually, preview, cancel -------------------------------------
        select_view("profile")
        before_browse = slot_files()
        assert before_browse["profile"] == "", f"3. baseline: Profile starts empty, got {before_browse['profile']!r}"

        page.locator('.slot-commit-row button[onclick*="openReferenceMediaChooser"]').click()
        page.wait_for_selector(".reference-media-chooser", timeout=15000)
        cards = page.locator(".reference-media-chooser-grid .results-card")
        assert cards.count() >= 1, "3. the visual chooser must offer at least one eligible image"
        findings.append(f"3. Browse visually is a primary control and opened a chooser with {cards.count()} card(s)")

        page.locator(f'.reference-media-chooser [onclick*="{LOOSE}"]').first.click()
        page.wait_for_function(
            """() => { const p = document.getElementById('coverage-slot-preview');
                       return p && p.dataset.slotPreview === 'staged'; }""", timeout=15000)
        staged = page.evaluate("""() => {
            const preview = document.getElementById('coverage-slot-preview');
            const note = document.querySelector('.coverage-slot-staged-note');
            const button = document.getElementById('coverage-slot-use');
            const image = preview.querySelector('img, video');
            return {
                mode: preview.dataset.slotPreview,
                src: image ? image.getAttribute('src') : '',
                visible: !!image && image.getBoundingClientRect().height > 0,
                noteVisible: !!note && note.getBoundingClientRect().height > 0,
                noteText: note ? note.textContent.trim() : '',
                label: (button.textContent || '').trim(),
                /* closeModal() hides the dialog rather than emptying it, so the
                   question is whether the modal is SHOWING, not whether its markup
                   is still in the document. */
                chooserOpen: !document.getElementById('modal').classList.contains('hidden'),
            };
        }""")
        assert staged["mode"] == "staged", "4. clicking a card must stage the choice"
        assert LOOSE in staged["src"], f"4. and preview the image it chose, got {staged['src']!r}"
        assert staged["visible"], "4. visibly — a preview with no height is not a preview"
        assert staged["noteVisible"] and "PREVIEWING" in staged["noteText"], \
            f"4. and say it is only previewing, got {staged['noteText']!r}"
        assert staged["label"] == "USE THIS IMAGE", f"4. with the commit still to come, got {staged['label']!r}"
        assert not staged["chooserOpen"], "4. the chooser closes on the pick"
        assert slot_files()["profile"] == "", "4. and the committed view is untouched by a preview"
        findings.append("4. clicking a card previewed it immediately, labelled PREVIEWING, and wrote nothing")

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=25000)
        page.wait_for_function(
            "(id) => typeof P === 'object' && P && (P.characters || []).some((c) => c && c.id === id)",
            arg=ENTITY, timeout=25000)
        open_reference()
        open_coverage()
        open_board()
        assert slot_files()["profile"] == "", "5. abandoning a staged choice leaves the committed view alone"
        cancelled = page.evaluate("""() => {
            const preview = document.getElementById('coverage-slot-preview');
            const button = document.getElementById('coverage-slot-use');
            return { mode: preview ? preview.dataset.slotPreview : '', label: button ? button.textContent.trim() : '',
                     disabled: button ? button.disabled : null };
        }""")
        assert cancelled["mode"] == "committed", \
            f"5. and the preview returns to the committed image, got {cancelled['mode']!r}"
        assert cancelled["disabled"] is True, "5. with the commit control back at rest"
        findings.append("5. leaving without committing restored the committed preview and the resting control")

        # ---- 6. use this image commits, once ------------------------------------------
        select_view("profile")
        page.locator('.slot-commit-row button[onclick*="openReferenceMediaChooser"]').click()
        page.wait_for_selector(".reference-media-chooser", timeout=15000)
        page.locator(f'.reference-media-chooser [onclick*="{LOOSE}"]').first.click()
        page.wait_for_function(
            """() => { const b = document.getElementById('coverage-slot-use'); return b && !b.disabled; }""",
            timeout=15000)
        page.locator("#coverage-slot-use").click()
        page.wait_for_function("""(want) => (P.characters[0].coverageSlots || [])
              .some((s) => s.id === 'profile' && (s.selectedFile || '') === want)""", arg=LOOSE, timeout=15000)
        committed = page.evaluate("""() => ({
            modal: !document.getElementById('modal').classList.contains('hidden'),
            state: (document.querySelector('.coverage-slot-state') || {}).dataset || {},
            label: ((document.querySelector('.coverage-slot-state') || {}).textContent || '').trim(),
            use: ((document.getElementById('coverage-slot-use') || {}).textContent || '').trim(),
        })""")
        assert not committed["modal"], "6. filling an empty view needs no second confirmation"
        assert committed["state"].get("slotState") == "satisfied", \
            f"6. and the board reports it satisfied at once, got {committed['state']}"
        assert committed["use"] == "IN USE", f"6. with the control now reading IN USE, got {committed['use']!r}"
        assert slot_files()["profile"] == LOOSE, "6. through the one slot writer"
        findings.append(f"6. Use this image committed Profile to {LOOSE} in one press, with no second confirmation")

        # ---- 7-8. Save crop & use ------------------------------------------------------
        page.evaluate("""(name) => openCoverageSheetExtractor('characters', P.characters[0].id, name, true)""", SHEET)
        page.wait_for_selector(".coverage-extractor-modal", timeout=15000)
        page.wait_for_function(
            """() => { const i = document.getElementById('coverage-crop-source'); return i && i.naturalWidth > 0; }""",
            timeout=15000)
        actions = page.evaluate("""() => ({
            buttons: [...document.querySelectorAll('.coverage-extractor-actions button')].map((b) => b.textContent.trim()),
            checkbox: !!document.getElementById('coverage-crop-approve'),
            advancedOpen: (document.querySelector('.coverage-crop-advanced') || {}).open === true,
            surface: [...document.querySelectorAll('.coverage-extractor-layout aside > *')].map((n) => n.className || n.tagName),
        })""")
        assert not actions["checkbox"], "7. the redundant save-and-use checkbox must be gone"
        assert "SAVE CROP & USE" in actions["buttons"], \
            f"7. the one-action assign must be a named button, got {actions['buttons']}"
        assert "SAVE AS CANDIDATE" in actions["buttons"], \
            f"7. beside a distinct non-assigning save, got {actions['buttons']}"
        assert not actions["advancedOpen"], "7. and the machinery stays behind Fine tune"
        findings.append(f"7. the extractor offers {actions['buttons']} with no checkbox and Fine tune closed")

        page.evaluate("() => selectCoverageCropSlot('front')")
        page.locator('.coverage-extractor-actions button:has-text("SAVE CROP & USE")').click()
        page.wait_for_function("""() => (P.characters[0].coverageSlots || [])
              .some((s) => s.id === 'front' && (s.selectedFile || '') !== '')""", timeout=20000)
        after_use = page.evaluate("""() => ({
            modalOpen: !document.getElementById('modal').classList.contains('hidden'),
            modal: document.getElementById('modal').innerHTML,
            front: (P.characters[0].coverageSlots.find((s) => s.id === 'front') || {}).selectedFile || '',
            rows: (P.characters[0].candidateFiles || []).filter((r) => r.coverageJobType === 'extracted-crop')
                    .map((r) => ({ file: r.stored, decision: r.decision, target: r.targetCoverageSlotId,
                                   sheet: (r.coverageCrop || {}).sourceSheet })),
            task: (document.querySelector('.bounded-entity-page') || {}).dataset?.selectedTask || '',
        })""")
        assert not after_use["modalOpen"], "8. the extractor closes and nothing takes its place"
        assert "CANDIDATE REVIEW" not in after_use["modal"], \
            "8. Candidate Review must not open after the filmmaker has already decided"
        assert len(after_use["rows"]) == 1, f"8. one press produces one crop, got {after_use['rows']}"
        assert after_use["rows"][0]["target"] == "front", "8. recording the view it was made for"
        assert after_use["rows"][0]["sheet"] == SHEET, "8. and the sheet it came from"
        assert after_use["rows"][0]["decision"] == "selected-coverage", "8. as a selection"
        assert after_use["front"] == after_use["rows"][0]["file"], \
            f"8. and the view it named is holding it, got {after_use['front']!r}"
        assert after_use["task"] == "coverage", f"8. landing back on Coverage, got {after_use['task']!r}"
        open_board()
        front_state = page.evaluate("""() => {
            const button = document.querySelector('.bounded-slot-rail button[onclick*="\\'front\\'"]');
            return button ? { state: button.dataset.slotState, tone: [...button.classList].find((c) => c.startsWith('tone-')) } : null;
        }""")
        assert front_state and front_state["state"] == "satisfied", \
            f"8. and the board shows the view satisfied without a second selection, got {front_state}"
        # WHAT THIS SUITE DOES NOT CLAIM. Whether the edit reaches the project file is
        # the durable-save seam's property and is measured by check:authority-write-seam
        # against a project the server itself created; a hand-seeded fixture installed
        # under the sandbox slug does not exercise that path honestly, and asserting on
        # it here would report a save-transaction result as a References UX result.
        findings.append(f"8. Save crop & use wrote {after_use['front']}, assigned Front, returned to Coverage and "
                        "opened no review")

        # ---- 9. Save as candidate assigns nothing --------------------------------------
        page.evaluate("""(name) => openCoverageSheetExtractor('characters', P.characters[0].id, name, true)""", SHEET)
        page.wait_for_selector(".coverage-extractor-modal", timeout=15000)
        page.wait_for_function(
            """() => { const i = document.getElementById('coverage-crop-source'); return i && i.naturalWidth > 0; }""",
            timeout=15000)
        # ---- 8b. the target list names the view it would overwrite ---------------------
        # Front was assigned in step 8 by the shipped writer, and assignSlotReference()
        # DELETES the legacy `approvedFile` key this marker used to be read from — so
        # "· already assigned" is reachable only through slotSelectedFile(). Its absence
        # was invisible rather than obvious: the extractor still OPENED on the first
        # empty view, so the panel's own default target disagreed with the list beside
        # it, and a filmmaker cropping a second panel was offered an occupied view that
        # looked free.
        #
        # Asserted as SET EQUALITY rather than by naming Front, because a marker that
        # every option wears is not a warning either.
        targets = page.evaluate("""() => {
            const sel = document.getElementById('coverage-crop-slot');
            const options = [...(sel ? sel.options : [])].map((o) => ({ id: o.value, text: o.textContent.trim() }));
            const slots = P.characters[0].coverageSlots || [];
            const holds = (id) => {
                const s = slots.find((x) => x.id === id) || {};
                return !!(s.selectedFile || s.approvedFile || '');
            };
            const front = slots.find((s) => s.id === 'front') || {};
            return {
                marked: options.filter((o) => o.text.includes('already assigned')).map((o) => o.id).sort(),
                holding: options.filter((o) => holds(o.id)).map((o) => o.id).sort(),
                texts: options.map((o) => o.text),
                selected: sel ? sel.value : '',
                legacyKey: front.approvedFile === undefined ? '(deleted)' : front.approvedFile,
                frontFile: front.selectedFile || '',
            };
        }""")
        assert targets["legacyKey"] == "(deleted)", \
            f"8b. premise: the shipped writer removes the legacy key, got {targets['legacyKey']!r}"
        assert targets["frontFile"], "8b. premise: and Front really is holding a file after step 8"
        assert "front" in targets["holding"], "8b. premise: so Front is in the occupied set"
        assert targets["marked"] == targets["holding"], \
            ("8b. exactly the occupied views may be marked — "
             f"marked {targets['marked']}, occupied {targets['holding']}, options {targets['texts']}")
        assert not targets["marked"] == [], "8b. and at least one view is occupied here, or the check is vacuous"
        findings.append(f"8b. reopening the extractor marks exactly the occupied views {targets['marked']} "
                        f"and still defaults to {targets['selected']!r}")

        # ---- 8c. a provenance chooser with nothing to choose is not rendered -----------
        # R1's rule on the surface the first pass did not reach: the generation-record
        # fold, headed "Generation records — provenance", kept rendering a <select>
        # whose only option was the placeholder. Driven through the page's own renderer
        # in the real browser, in all three shapes the rule distinguishes.
        provenance = page.evaluate("""() => {
            const e = P.characters[0];
            const list = 'characters';
            e.made = [{ model: '', files: '', prompt: 'p', date: '2026-08-01' }];
            P.meta.models = [];
            const empty = entityGenerationRecordsMarkup(list, e);
            P.meta.models = [{ id: 'm1', name: 'Model One' }, { id: 'm2', name: 'Model Two' }];
            const choice = entityGenerationRecordsMarkup(list, e);
            P.meta.models = [];
            e.made[0].model = 'legacy-model-id';
            const recorded = entityGenerationRecordsMarkup(list, e);
            e.made = [];
            return {
                emptyHasSelect: /<select/.test(empty),
                emptyHasPlaceholder: empty.indexOf('model\\u2026') >= 0,
                choiceHasSelect: /<select/.test(choice),
                choiceOffersBoth: /Model One/.test(choice) && /Model Two/.test(choice),
                recordedShowsValue: /legacy-model-id/.test(recorded),
                recordedHasSelect: /<select/.test(recorded),
            };
        }""")
        assert not provenance["emptyHasSelect"], "8c. no models is not a choice, so there is no chooser"
        assert not provenance["emptyHasPlaceholder"], "8c. and not the placeholder standing in for one"
        assert provenance["choiceHasSelect"] and provenance["choiceOffersBoth"], \
            f"8c. two models is a real choice and must still be offered, got {provenance}"
        assert provenance["recordedShowsValue"], "8c. a recorded model survives an emptied model list"
        assert not provenance["recordedHasSelect"], "8c. but is stated rather than offered as a choice"
        findings.append("8c. the provenance fold renders no chooser with nothing to choose, a chooser with two "
                        "models, and a recorded model as static text")

        page.evaluate("() => selectCoverageCropSlot('front-three-quarter')")
        before_candidate = slot_files()
        page.locator('.coverage-extractor-actions button:has-text("SAVE AS CANDIDATE")').click()
        # WAIT FOR THE END OF THE ACTION, not for its first visible effect. The
        # candidate row is pushed before the upload's scan refresh, the dirty mark
        # and the close, so waiting on the row alone reads the page mid-flight and
        # reports an extractor that "did not close" when it simply had not yet.
        page.wait_for_function("""() => (P.characters[0].candidateFiles || [])
              .filter((r) => r.coverageJobType === 'extracted-crop').length === 2
              && document.getElementById('modal').classList.contains('hidden')""", timeout=20000)
        after_candidate = page.evaluate("""() => ({
            modalOpen: !document.getElementById('modal').classList.contains('hidden'),
            modal: document.getElementById('modal').innerHTML,
            rows: (P.characters[0].candidateFiles || []).filter((r) => r.coverageJobType === 'extracted-crop')
                    .map((r) => ({ file: r.stored, decision: r.decision, target: r.targetCoverageSlotId })),
        })""")
        assert slot_files() == before_candidate, \
            f"9. saving a candidate must change no view, got {slot_files()} vs {before_candidate}"
        assert len(after_candidate["rows"]) == 2, "9. the crop is preserved"
        fresh = [r for r in after_candidate["rows"] if r["target"] == "front-three-quarter"]
        assert fresh and fresh[0]["decision"] == "unreviewed", \
            f"9. as a candidate, not a decision, got {after_candidate['rows']}"
        assert not after_candidate["modalOpen"], "9. and the extractor closes"
        assert "CANDIDATE REVIEW" not in after_candidate["modal"], \
            "9. without opening a review on the filmmaker's behalf either"
        findings.append(f"9. Save as candidate preserved {fresh[0]['file']} and left every view exactly as it was")

        # ---- 10. an unreviewed candidate has no green factors --------------------------
        page.evaluate("""(name) => openEntityCandidateReview('characters', P.characters[0].id, name, 'state-default')""",
                      fresh[0]["file"])
        page.wait_for_selector(".entity-candidate-review-modal", timeout=15000)
        review = page.evaluate("""() => ({
            overall: ((document.querySelector('.entity-review-summary b') || {}).textContent || '').trim(),
            status: ((document.querySelector('.entity-review-score') || {}).textContent || '').trim(),
            factors: [...document.querySelectorAll('.entity-review-factor')].map((n) => ({
                severity: [...n.classList].find((c) => c.startsWith('severity-')),
                word: ((n.querySelector('header b') || {}).textContent || '').trim(),
                colour: getComputedStyle(n.querySelector('header b')).color,
                border: getComputedStyle(n).borderLeftColor,
            })),
            primary: ((document.querySelector('.entity-candidate-review-actions .approve-btn.large') || {}).textContent || '').trim(),
        })""")
        assert "NOT REVIEWED" in review["status"], f"10. baseline: nobody reviewed this, got {review['status']!r}"
        assert review["factors"], "10. the factor grid must render"
        greens = [f for f in review["factors"] if f["severity"] == "severity-pass" or f["word"] == "PASS"]
        assert not greens, f"10. no factor may read PASS with no review behind it, got {greens}"
        assert all(f["word"] == "NOT REVIEWED" for f in review["factors"]), \
            f"10. every factor reads as unreviewed instead, got {[f['word'] for f in review['factors']]}"
        green_borders = [f["border"] for f in review["factors"] if "87, 255" in f["border"] or "92, 201" in f["border"]]
        assert not green_borders, f"10. and none of them is drawn green, got {green_borders}"
        assert "ASSIGN TO 3/4 FRONT" in review["primary"].upper(), \
            f"10. a candidate the view does NOT hold is still assignable, got {review['primary']!r}"
        findings.append(f"10. an unreviewed candidate reads {review['status']!r} with "
                        f"{len(review['factors'])} neutral factors and no green border")
        page.evaluate("() => closeModal()")

        # ---- N2. and the assign action is a control that can be present ----------------
        page.evaluate("""(name) => openEntityCandidateReview('characters', P.characters[0].id, name, 'state-default')""",
                      after_use["rows"][0]["file"])
        page.wait_for_selector(".entity-candidate-review-modal", timeout=15000)
        held = page.evaluate("""() => {
            const block = document.querySelector('.entity-review-current-target');
            const footer = document.querySelector('.entity-candidate-review-actions');
            const box = block ? block.getBoundingClientRect() : null;
            const bounds = footer ? footer.getBoundingClientRect() : null;
            return {
                assign: document.body.innerHTML.includes('ASSIGN TO FRONT'),
                current: !!document.querySelector('[data-review-target-current]'),
                words: block ? (block.querySelector('span') || {}).textContent.trim() : '',
                visible: !!box && box.height > 0 && box.width > 0,
                insideFooter: !!box && !!bounds && box.right <= bounds.right + 1 && box.left >= bounds.left - 1,
                open: !!block && !!block.querySelector('button'),
            };
        }""")
        assert not held["assign"], "N2. the view already holds this crop, so no assignment may be offered"
        assert held["current"] and "ALREADY IN USE FOR FRONT" in held["words"], \
            f"N2. the current fact is stated instead, got {held['words']!r}"
        # A replacement that overflows its own footer is a worse control than the one
        # it replaced, so the geometry is measured rather than assumed.
        assert held["visible"] and held["insideFooter"], \
            f"N2. and it must sit inside the action row it replaced, got {held}"
        assert held["open"], "N2. with the way back to the view it names"
        findings.append("N2. control: the assign action appears for a candidate the view does not hold (step 10) and "
                        "is replaced by 'ALREADY IN USE FOR FRONT' for one it does")
        page.evaluate("() => closeModal()")

        # ---- 11. no demand -> real current demand, on the same target ------------------
        # The one target kind a shot can actually be waiting on. Readiness raises one
        # kind of row about an entity, `entity-state`, and none at all for a coverage
        # or expression slot — public/shared-shot-readiness.js says so outright: "a
        # required coverage slot is an ENTITY completeness fact, not a shot
        # prerequisite". So this declares a state the character has no approved image
        # for, which is exactly what turns into a current obligation.
        page.evaluate("""(id) => {
            const entity = P.characters.find((c) => c.id === id);
            entity.continuityStates.push({ id: 'state-soaked', name: 'Soaked', isDefault: false,
              parentStateId: 'state-default', approvedFile: '', notes: 'Rain sequence.',
              referenceRequirement: 'required', generationMode: 'derive' });
            boundedWriteState('selected:entity-coverage-view', 'characters:' + id, 'states');
        }""", ENTITY)
        page.evaluate("() => route()")
        page.wait_for_selector(".continuity-state-rail", timeout=25000)

        def state_rail():
            return page.evaluate("""() => {
                const rail = document.querySelector('.continuity-state-rail');
                if (!rail) return null;
                const soaked = [...rail.querySelectorAll('button')]
                    .find((b) => ((b.querySelector('b') || {}).textContent || '').trim() === 'Soaked');
                return {
                    outstanding: rail.dataset.statesOutstanding,
                    label: soaked ? (soaked.querySelector('small') || {}).textContent.trim() : '',
                    tone: soaked ? ([...soaked.classList].find((c) => c.startsWith('tone-')) || '') : '',
                    dot: soaked ? getComputedStyle(soaked.querySelector('i')).backgroundColor : '',
                    strip: (document.querySelector('.entity-demand-summary') || { dataset: {} }).dataset.demandSummaryNow,
                    needed: ((document.querySelector('.entity-demand-summary-now b') || {}).textContent || '').trim(),
                };
            }""")

        before = state_rail()
        assert before, "11. the continuity-state rail must render"
        assert before["label"] == "Planned", \
            f"11. with no shot waiting on it the declared state reads Planned, got {before['label']!r}"
        assert before["tone"] != "tone-attention", f"11. and claims no attention, got {before['tone']!r}"
        assert before["outstanding"] == "0", f"11. owing nothing, got {before['outstanding']!r}"
        assert before["strip"] == "0", f"11. and the strip agrees, got {before['strip']!r}"

        # THE TRANSITION. One shot now uses this character AND declares that state.
        page.evaluate("""(id) => {
            for (const shot of P.shots || []) {
                shot.characters = [id];
                shot.continuityStateSelections = { [id]: 'state-soaked' };
            }
        }""", ENTITY)
        page.evaluate("() => route()")
        page.wait_for_function(
            """() => { const r = document.querySelector('.continuity-state-rail');
                       return r && r.dataset.statesOutstanding !== '0'; }""", timeout=25000)
        after = state_rail()
        assert after["label"] == "Required", \
            f"11. the very same target now reads Required, got {after['label']!r}"
        assert after["tone"] == "tone-attention", f"11. in the attention tone, got {after['tone']!r}"
        assert after["outstanding"] == "1", f"11. the board reports one outstanding, got {after['outstanding']!r}"
        assert after["strip"] == "1", f"11. and the compact strip reports the same one, got {after['strip']!r}"
        assert "1 required reference" in after["needed"], \
            f"11. in words, on the strip read first, got {after['needed']!r}"
        assert after["dot"] != before["dot"], (
            f"11. and the dot changed colour, got {before['dot']} -> {after['dot']}")
        # RESOLVED, not read off a class name. `--ok` and `--warn` are declared nowhere
        # in the stylesheet, so both dots on this rail used to resolve to rgba(0,0,0,0):
        # a state a shot is waiting on has to be visible before it is a signal.
        channels = [int(value) for value in re.findall(r"\d+", after["dot"])[:3]]
        assert len(channels) == 3 and channels[0] > 180 and channels[0] > channels[2], (
            f"11. and it must resolve to a real warm colour rather than transparent, got {after['dot']}")
        findings.append(
            f"11. the same target went {before['label']!r}/{before['dot']} with 0 outstanding to "
            f"{after['label']!r}/{after['dot']} with 1 outstanding and a strip reading {after['needed']!r}, "
            "the moment a shot declared it")

        # And back: withdraw the declaration and the word goes with it.
        page.evaluate("""() => { for (const shot of P.shots || []) shot.continuityStateSelections = {}; }""")
        page.evaluate("() => route()")
        page.wait_for_function(
            """() => { const r = document.querySelector('.continuity-state-rail');
                       return r && r.dataset.statesOutstanding === '0'; }""", timeout=25000)
        restored = state_rail()
        assert restored["label"] == "Planned" and restored["tone"] != "tone-attention", \
            f"11. and withdrawing the declaration returns it to Planned, got {restored}"
        findings.append("11b. withdrawing the declaration returned the same target to Planned with 0 outstanding")

        # ---- N1. the amber can come back ----------------------------------------------
        # An AMBIGUOUS dependency reading: a second character whose id is a prefix of
        # this one, so the shot's token matches two entities and shared-entities.js
        # refuses to answer. The gate must then fail closed and the amber return.
        page.evaluate("""(id) => {
            P.characters.unshift({ id: 'CHAR', name: 'Other', prefix: 'CHAR', approvedFile: '',
              continuityStates: [{ id: 'state-default', name: 'Default', isDefault: true, approvedFile: '' }],
              coverageSlots: [], expressionSlots: [], candidateFiles: [] });
            for (const shot of P.shots || []) { shot.characters = []; shot.codes = [id]; shot.continuityStateSelections = {}; }
            boundedWriteState('selected:entity-coverage-view', 'characters:' + id, 'coverage');
        }""", ENTITY)
        page.evaluate("() => route()")
        page.wait_for_selector(".bounded-entity-page[data-selected-task]", timeout=25000)
        open_coverage()
        open_board()
        control = page.evaluate("""() => {
            const rail = document.querySelector('.bounded-slot-rail');
            const demand = document.querySelector('section.entity-demand');
            return {
                production: demand ? demand.dataset.demandProduction : '',
                tones: rail ? [...rail.querySelectorAll('button')].map((b) => [...b.classList].find((c) => c.startsWith('tone-'))) : [],
                labels: rail ? [...rail.querySelectorAll('button')].map((b) => ((b.querySelector('small') || {}).textContent || '').trim()) : [],
                outstanding: (document.querySelector('.entity-coverage-section') || {}).dataset?.boardOutstanding || '',
            };
        }""")
        assert control["production"] == "unknown", \
            f"N1. baseline: an ambiguous token must leave the demand answer unknown, got {control['production']!r}"
        assert "tone-attention" in control["tones"], \
            f"N1. with no confident answer the amber must come back, got {control['tones']}"
        assert "Required — missing" in control["labels"], \
            f"N1. and the words with it — cannot-prove-safe is not the same as known-safe, got {control['labels']}"
        assert control["outstanding"] != "0", \
            f"N1. and the board must report outstanding work again, got {control['outstanding']!r}"
        findings.append("N1. control: with the demand answer unknown the board fails closed — the amber, the words "
                        f"'Required — missing' and {control['outstanding']} outstanding all return")

        # ---- the page never scrolls sideways ------------------------------------------
        for width in (1600, 1280):
            page.set_viewport_size({"width": width, "height": 1000})
            page.wait_for_function("() => document.readyState === 'complete'", timeout=10000)
            overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert overflow <= 1, f"the references stage must not scroll sideways at {width}px, got {overflow}px"
        findings.append("the coverage stage does not scroll sideways at 1600 or 1280")

        assert not page_errors, f"the page raised uncaught errors: {page_errors}"
        assert not offsite, f"requests left the machine: {offsite}"
        assert not paid_calls, f"a paid route was called: {paid_calls}"
        browser.close()

    print(f"{LABEL} passed:")
    for line in findings:
        print("  " + line)
    print("  no provider call, no paid call, nothing outside the sandbox, data/ untouched")
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()
