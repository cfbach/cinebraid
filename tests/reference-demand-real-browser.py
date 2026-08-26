#!/usr/bin/env python3
"""Public Alpha UX Slice 5 — REFERENCE DEMAND + REVERSIBLE STRUCTURE, in a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. tests/reference-demand.js proves everything semantic in
Node: that the demand projection is total and fails closed, that RD1-RD10 hold, that the
authority ledger is byte-identical across a structural clear, and that no shipped route
narrows entity reference demand. Six claims cannot be proven there, and they are the six
a filmmaker would actually notice:

  A  A DORMANT REFERENCE DOES NOT GREET YOU WITH A BACKLOG. The Node harness reads a
     string; this reads what a person sees on the reference strip and in the panel body
     after a real navigation.
  B  CASTING THE REFERENCE MAKES THE WORK APPEAR, through the shipped cast control,
     clicked rather than called.
  C  UN-CASTING IT MAKES THE WORK DISAPPEAR AGAIN and deletes nothing from the Project
     Bible — asserted against the live document after the click, not against a fixture.
  D  THE LOCATION CAN BE CLEARED THROUGH THE SHIPPED UI. "A control exists" is a string
     claim in Node. Here the button is found by what it says, hit-tested, and CLICKED
     through the real event path.
  E  THE SHOT'S VISIBLE STATE UPDATES IMMEDIATELY. app.js re-renders on the mutation, and
     only a browser can show that the plate stops being presented as primary in the same
     interaction rather than at the next reload.
  F  THE APPROVED MEDIA AND HISTORY ARE STILL REACHABLE after both clears. A pointer
     surviving in JSON is not the same as a filmmaker still being able to get to it.
  G  A vehicleIds-ONLY VEHICLE IS VISIBLY ATTACHED AND CAN BE CLEARED. "Renders
     selected" is a class in Node and a hit-testable control here.
  H  A SATISFIED REFERENCE DOES NOT PRESENT ITS TEMPLATE AS BLOCKING WORK, and the
     template stays reachable. Both halves are geometry, not strings.
  I  A CLEARED PRIMARY LOCATION SURVIVES THE SAVE/NORMALISE/RE-RENDER PATH with a
     supporting location present, and the support is offered rather than promoted.
     Only a real page runs that path end to end.
  J  A SUFFIXED PROP/VEHICLE RELATION IS ATTACHED, NOT PICKER-OWNED. "Renders
     dashed" is a class in Node and a hit-testable control here.
  K  AN EXPLICIT SELECTION LAYERS ON without deleting the suffix, clicked through
     the real event path.
  L  CLEARING THAT LAYER LEAVES THE CODE-BACKED ATTACHMENT VISIBLE, after a full
     save/normalise/re-render.
  M  THE SUFFIXED LOCATION ROUND TRIP — the half with 276 real corpus instances.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a detector that can only ever report one
answer is worth nothing. Both work by changing the PROJECT rather than the code, so the
same shipped renderer is asked two questions with opposite correct answers:

  N1 casts the dormant character into a shot and requires the backlog to APPEAR — so
     section A's zero is a measurement, not an element that never exists.
  N2 re-selects the cleared location and requires "primary plate" to COME BACK — so
     section E's absence is a measurement, not a selector that never matched.

WAIT FOR THE REQUESTED THING, never for a fixed delay. Every mutation below is followed
by a wait on the specific DOM the mutation was supposed to produce; a fixed sleep reads
the page the browser was on a moment ago and is green on a fast machine and red on CI.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Reference demand + reversible structure real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []

CHAR = "RD-BROWSER"
LOC = "LOC-RD"
SHOT = "RD1-01"

TINY = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='48'"
        "%3E%3Crect width='32' height='48' fill='%23343c44'/%3E%3C/svg%3E")

# A newly added character, exactly as public/mutations.js seeds one: a template's worth
# of required coverage slots and nothing selected. NOTHING in the project references it.
CHARACTER = {
    "id": CHAR, "prefix": CHAR, "anchorPrefix": CHAR, "name": "Rennick Dock",
    "status": "IN PROGRESS", "workflowStatus": "IN PROGRESS",
    "block": "A dock supervisor.", "approvedFile": f"{CHAR}-PRIMARY.png",
    "coverageSlots": [
        {"id": "front", "label": "Front", "requirement": "required", "selectedFile": ""},
        {"id": "front-three-quarter", "label": "3/4 front", "requirement": "required", "selectedFile": ""},
        {"id": "profile", "label": "Profile", "requirement": "required", "selectedFile": ""},
        {"id": "rear", "label": "Rear", "requirement": "required", "selectedFile": ""},
    ],
    "expressionSlots": [],
    "continuityStates": [
        {"id": "state-default", "name": "Clean", "isDefault": True,
         "approvedFile": f"{CHAR}-PRIMARY.png", "notes": "Primary identity."},
        # A state with no approved image. When a shot DECLARES it the production
        # genuinely owes it, which is what section B measures; when no shot uses
        # the character it is coverage plan like everything else.
        {"id": "state-soot", "name": "Sooty", "isDefault": False,
         "parentStateId": "state-default", "notes": "Soot over every surface."},
    ],
    # Real history, so section F has something that must survive both clears.
    "made": [{"model": "fixture-model", "files": f"{CHAR}-PRIMARY.png",
              "prompt": "a compiled provenance prompt", "date": "2026-08-20"}],
}

# A SUPPORTING location, for the multi-location clear. It reaches the shot
# through `codes[]` only, which is exactly how a supporting location is recorded.
SUPPORT = {
    "id": "LOC-SUPPORT", "name": "Support bay", "status": "APPROVED", "workflowStatus": "APPROVED",
    "notes": "Secondary plate.", "approvedFile": "LOC-SUPPORT-PLATE.png",
    "coverageSlots": [],
    "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                          "approvedFile": "LOC-SUPPORT-PLATE.png"}],
}

# A vehicle attached the way an imported document attaches one: through
# `creationBrief.vehicleIds`, which no shipped control has ever written.
# A prop reached ONLY through a suffixed code token. `shotEntityTokenMatches`
# accepts an id followed by "-", so PROP-CRATE-LEFT names PROP-CRATE and also says
# LEFT — and what LEFT meant is not recoverable from the document.
PROP = {
    "id": "PROP-CRATE", "name": "Dock crate", "status": "APPROVED", "workflowStatus": "APPROVED",
    "notes": "Stacked crate.", "approvedFile": "PROP-CRATE-PLATE.png",
    "coverageSlots": [{"id": "hero", "label": "Front / hero", "requirement": "required", "selectedFile": ""}],
    "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                          "approvedFile": "PROP-CRATE-PLATE.png"}],
}

VEHICLE = {
    "id": "VEH-DOCK", "name": "Dock tug", "status": "APPROVED", "workflowStatus": "APPROVED",
    "notes": "Yard tug.", "approvedFile": "VEH-DOCK-PLATE.png",
    "coverageSlots": [{"id": "front", "label": "Front", "requirement": "required", "selectedFile": ""}],
    "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True,
                          "approvedFile": "VEH-DOCK-PLATE.png"}],
}

LOCATION = {
    "id": LOC, "name": "Dock exterior", "status": "APPROVED", "workflowStatus": "APPROVED",
    "notes": "Wide dock plate.", "approvedFile": f"{LOC}-PLATE.png",
    "coverageSlots": [
        {"id": "establishing", "label": "Master establishing", "requirement": "required", "selectedFile": ""},
        {"id": "reverse", "label": "Reverse angle", "requirement": "required", "selectedFile": ""},
    ],
    "continuityStates": [
        {"id": "state-default", "name": "Default", "isDefault": True,
         "approvedFile": f"{LOC}-PLATE.png", "notes": "Docking camera."},
    ],
}

SHOT_RECORD = {
    "id": SHOT, "scene": "SC-01", "title": "Dock arrival",
    "desc": "A supervisor walks the dock.", "positioning": "Locked wide.",
    "workflowStatus": "IN PROGRESS", "status": "BUILT", "reviewStatus": "PENDING",
    "characters": [], "codes": [LOC], "risks": [], "notes": "",
    # frame-a is APPROVED and stays approved through every clear below, which is
    # what section F proves. frame-b is NOT, so the shot has an outstanding unit —
    # without one the shot owes nothing at all and section B would have no
    # obligation to measure, because a completed unit's requirement rows are not
    # blocking anything.
    "keyframes": [{"id": "frame-a", "label": "A", "title": "Opening frame",
                   "winner": f"{SHOT}-FRAME_A.png", "description": "Supervisor at the rail.",
                   "required": True, "generationPackages": []},
                  {"id": "frame-b", "label": "B", "title": "Closing frame",
                   "winner": "", "description": "Supervisor walks out of frame.",
                   "required": True, "generationPackages": []}],
    "clips": [], "promptBuilds": [], "promptOptions": [],
    "creationBrief": {"locationId": LOC, "propIds": [], "vehicleIds": ["VEH-DOCK"],
                      "promptBuilds": [], "mode": "auto"},
    # The shot's continuity decision for the character. It is STALE while no shot
    # relationship carries the character, and live the moment one does.
    "continuityStateSelections": {CHAR: "state-soot"},
}

# Only what a person actually approved. The location plate and the character's primary
# are canon; the shot's frame is canon too, so section F has an approval to lose.
def receipt(n, kind, **fields):
    row = {"id": f"authority-{n:06d}", "sequence": n, "actor": "human", "act": "explicit-approval",
           "command": {"entity-state": "approve-entity-state", "shot-frame": "approve-shot-frame"}[kind],
           "kind": kind, "shotId": "", "frameId": "", "unitKey": "", "list": "", "entityId": "",
           "stateId": "", "slotId": "", "assetId": "", "at": "2026-08-20T00:00:00.000Z",
           "status": "current", "supersededBy": "", "supersededAt": "", "revokedAt": "",
           "revocationReason": "", "note": "",
           "provenance": {"manualAction": f"gesture-browser-{n}", "via": "real-browser-fixture", "gesture": "click"}}
    row.update(fields)
    return row


RECEIPTS = [
    receipt(1, "entity-state", list="characters", entityId=CHAR, stateId="state-default",
            value=f"{CHAR}-PRIMARY.png", targetKey=f"entity-state:characters:{CHAR}#state-default"),
    receipt(2, "entity-state", list="locations", entityId=LOC, stateId="state-default",
            value=f"{LOC}-PLATE.png", targetKey=f"entity-state:locations:{LOC}#state-default"),
    receipt(3, "shot-frame", shotId=SHOT, frameId="frame-a", value=f"{SHOT}-FRAME_A.png",
            targetKey=f"shot-frame:{SHOT}#frame-a"),
]


# The shipped plate control, addressed by the exact call it makes. Built by
# concatenation rather than as an f-string: the selector needs single quotes
# INSIDE a double-quoted attribute value, which an f-string cannot carry.
PLATE_BUTTON = ('button.guided-asset-choice[onclick*="setShotCreationLocation('
                + chr(39) + SHOT + chr(39) + "," + chr(39) + LOC + chr(39) + ')"]')


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-reference-demand-"))
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
        page.goto(f"{base}/#/production", wait_until="domcontentloaded")
        page.wait_for_selector("#main", timeout=20000)
        page.wait_for_function("() => typeof P === 'object' && P && Array.isArray(P.characters)", timeout=20000)

        def install(shot_overrides=None, character_overrides=None):
            """Install the fixture into the live document. The character is dormant: the
            one shot names the location and no character at all."""
            shot = json.loads(json.dumps(SHOT_RECORD))
            shot.update(shot_overrides or {})
            character = json.loads(json.dumps(CHARACTER))
            character.update(character_overrides or {})
            page.evaluate(
                """(payload) => {
                    P.characters = [payload.character];
                    P.locations = [payload.location, payload.support];
                    P.props = [payload.prop]; P.vehicles = [payload.vehicle]; P.audio = [];
                    P.scenes = [{ id: 'SC-01', title: 'Dock', tier: 'A', whatHappens: '', howItFeels: '' }];
                    P.shots = [payload.shot];
                    P.productionAuthority = { version: 1, receipts: payload.receipts };
                    SCAN.anchors = payload.anchors;
                    SCAN.plates = payload.plates;
                    SCAN.vehicles = payload.vehicleMedia;
                    SCAN.props = payload.propMedia;
                    SCAN.shots = payload.shotMedia;
                }""",
                {"character": character, "location": LOCATION, "support": SUPPORT, "vehicle": VEHICLE, "prop": PROP,
                 "shot": shot, "receipts": RECEIPTS,
                 "anchors": [{"name": f"{CHAR}-PRIMARY.png", "url": TINY}],
                 "plates": [{"name": f"{LOC}-PLATE.png", "url": TINY}, {"name": "LOC-SUPPORT-PLATE.png", "url": TINY}],
                 "vehicleMedia": [{"name": "VEH-DOCK-PLATE.png", "url": TINY}],
                 "propMedia": [{"name": "PROP-CRATE-PLATE.png", "url": TINY}],
                 "shotMedia": {SHOT: {"takes": [{"name": f"{SHOT}-FRAME_A.png", "url": TINY}], "locked": []}}})

        def open_reference(entity_id, kind="character", task=None):
            """Navigate to a reference and, when asked, click through to one of its
            declared tasks. Waits on the surface each step is supposed to produce."""
            page.evaluate("(hash) => { location.hash = hash; }", f"#/{kind}/{entity_id}")
            page.evaluate("() => route()")
            page.wait_for_selector(".bounded-entity-page[data-selected-task]", timeout=15000)
            if task:
                page.locator(".bounded-entity-taskbar .focused-task-button", has_text=task).click()
                page.wait_for_selector("#main section.entity-demand", timeout=15000)

        def demand_panel():
            return page.evaluate("""() => {
                const node = document.querySelector('section.entity-demand');
                if (!node) return null;
                const open = node.querySelector('.entity-demand-rows.entity-demand-open');
                return {
                    required: Number(node.dataset.demandRequired),
                    missing: Number(node.dataset.demandMissing),
                    now: Number(node.dataset.demandNow),
                    dormant: Number(node.dataset.demandDormant),
                    plan: Number(node.dataset.demandPlan),
                    obligations: node.dataset.demandObligations || "",
                    production: node.dataset.demandProduction,
                    lead: node.dataset.demandLead || '',
                    caption: ((node.querySelector('.entity-demand-lead-note') || {}).textContent || '').trim(),
                    /* Is the leading list inside a disclosure? The first design put
                       dormant material behind one and made its generate action
                       unclickable, so this is measured rather than assumed. */
                    leadInDisclosure: (() => {
                        const open = node.querySelector('.entity-demand-rows.entity-demand-open');
                        if (!open) return false;
                        for (let n = open; n && n !== node; n = n.parentElement) if (n.tagName === 'DETAILS') return true;
                        return false;
                    })(),
                    /* Every control the leading list offers, hit-tested. */
                    leadButtons: [...(node.querySelectorAll('.entity-demand-rows.entity-demand-open button') || [])]
                        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length,
                    headline: (node.querySelector('header b') || {}).textContent || '',
                    openRows: open ? open.querySelectorAll('.entity-demand-row').length : 0,
                    /* Real geometry: does the outstanding list occupy space on screen? */
                    openHeight: open ? Math.round(open.getBoundingClientRect().height) : 0,
                    groupLabels: [...node.querySelectorAll('.entity-demand-group > summary')]
                        .map((s) => s.textContent.replace(/\\s+/g, ' ').trim()),
                    groupsOpen: [...node.querySelectorAll('.entity-demand-group')].filter((d) => d.open).length,
                };
            }""")

        def coverage_strip():
            return page.evaluate("""() => {
                const button = [...document.querySelectorAll('.bounded-entity-taskbar .focused-task-button')]
                    .find((b) => /What this production needs/.test(b.textContent || ''));
                if (!button) return null;
                return {
                    tone: [...button.classList].find((c) => c.startsWith('tone-')) || '',
                    status: ((button.querySelector('em') || {}).textContent || '').trim(),
                    note: ((button.querySelector('small') || {}).textContent || '').trim(),
                };
            }""")

        def open_shot_inputs():
            """Reach the shot's Source & References panel and OPEN the cast manager.

            The manager is a `<details>` that ships closed once anything is attached, so
            every control inside it is present in the markup and invisible to a person.
            Opened by clicking its own summary rather than by setting `.open`, so what
            the rest of this suite hit-tests is what a filmmaker would actually be
            looking at."""
            page.evaluate("(hash) => { location.hash = hash; }", f"#/shot/{SHOT}")
            page.evaluate("() => route()")
            # WAIT FOR THE SHOT WORKSPACE, not for `#main`: that element already exists
            #  from the previous route, so waiting on it resolves against the DOM the
            #  browser was on a moment ago.
            page.wait_for_selector(".bounded-shot-workspace", timeout=15000)
            page.evaluate("(id) => selectBoundedTask('shot-task', id, 'inputs')", SHOT)
            page.wait_for_selector(".guided-cast-assets", state="attached", timeout=15000)
            reveal_cast()

        def reveal_cast():
            """Open every closed `<details>` between the page and the cast manager.

            Both the Source & References panel and the cast manager itself remember
            their own open state, so which of them is shut depends on what the
            filmmaker last did rather than on anything this slice changed. Each is
            opened by dispatching a click on its own summary — the real control through
            the real event path, which is what makes the `ontoggle` bookkeeping run.

            This is SCAFFOLDING, not the thing under test: every control this suite
            actually judges is clicked with Playwright, hit-tested and measured."""
            for _ in range(5):
                remaining = page.evaluate("""() => {
                    const node = document.querySelector('.guided-cast-assets');
                    if (!node) return -1;
                    const shut = [];
                    for (let n = node; n; n = n.parentElement) if (n.tagName === 'DETAILS' && !n.open) shut.unshift(n);
                    if (!shut.length) return 0;
                    const summary = shut[0].querySelector('summary');
                    if (summary) summary.click();
                    return shut.length;
                }""")
                if remaining == 0:
                    return
                assert remaining > 0, "the cast manager must be on the page at all"

        def click_in_cast(selector, description):
            """Reveal the cast manager and click one of its controls, as ONE retried unit.

            THE PAGE RE-RENDERS ON ITS OWN. app.js polls, and a poll landing between
            "the control is visible" and "click it" rebuilds the panel with its
            disclosures back at their remembered state — the same 3.5s-poll race that has
            already made another browser suite flaky on a warm machine. Waiting longer
            does not fix that; re-establishing the precondition does. Each attempt
            re-opens the disclosures and then gives the click a short window, so a lost
            race costs one retry instead of the whole suite."""
            failure = None
            for _ in range(8):
                try:
                    reveal_cast()
                    page.locator(selector).click(timeout=2500)
                    return
                except Exception as error:      # noqa: BLE001 - re-raised below with context
                    failure = error
            raise AssertionError(f"{description}: could not click {selector} after 8 attempts - {failure}")

        def cast_state():
            """Picker state read from classes and text rather than from geometry, so a
            poll landing mid-read cannot turn a correct answer into a flake. The
            geometry claims are made separately, by location_grid()."""
            return page.evaluate("""(shot) => {
                const clear = document.querySelector('button[data-clear-location="' + shot + '"]');
                const notes = [...document.querySelectorAll('.guided-asset-picker-section')]
                    .filter((s) => /LOCATION PLATE/.test((s.querySelector('b') || {}).textContent || ''))
                    .flatMap((s) => [...s.querySelectorAll('button.guided-asset-choice small')].map((n) => n.textContent.trim()));
                return { clearPresent: !!clear, clearOn: !!clear && clear.classList.contains('on'), notes };
            }""", SHOT)

        def location_grid():
            return page.evaluate("""() => {
                const section = [...document.querySelectorAll('.guided-asset-picker-section')]
                    .find((s) => /LOCATION PLATE/.test((s.querySelector('b') || {}).textContent || ''));
                if (!section) return null;
                return [...section.querySelectorAll('button.guided-asset-choice')].map((b) => ({
                    label: ((b.querySelector('b') || {}).textContent || '').trim(),
                    note: ((b.querySelector('small') || {}).textContent || '').trim(),
                    on: b.classList.contains('on'),
                    clear: b.dataset.clearLocation || '',
                    /* Hit-testable, not merely present in the markup. */
                    box: (() => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
                }));
            }""")

        def prop_vehicle_state(entity_id):
            """The picker's own three-state answer for one prop or vehicle, plus the
            geometry that proves the control is real. `code-backed` is the state a
            suffixed token produces: attached, visibly not picker-owned, and its
            click ADDS rather than clears."""
            return page.evaluate(
                "(id) => {"
                " const button = [...document.querySelectorAll('.guided-asset-picker-grid button.guided-asset-choice')]"
                "   .find(function (node) { return (node.getAttribute('onclick') || '').indexOf(\"toggleShotCreationProp('RD1-01','\" + id + \"')\") >= 0; });"
                " if (!button) return null;"
                " const box = button.getBoundingClientRect();"
                " return { state: button.classList.contains('on') ? 'selected'"
                "   : button.classList.contains('code-backed') ? 'code-backed' : 'unattached',"
                "   note: ((button.querySelector('small') || {}).textContent || '').trim(),"
                "   w: Math.round(box.width), h: Math.round(box.height) }; }", entity_id)

        def wait_for_picker_state(entity_id, css_class, why):
            """Wait for the picker to REPAINT into a state, never for a delay. The
            click re-renders the panel, so reading the class straight after it reads
            whichever paint the browser happened to be on."""
            reveal_cast()
            probe = ("(args) => {"
                     " const b = [...document.querySelectorAll('.guided-asset-picker-grid button.guided-asset-choice')]"
                     "   .find(function (n) { return (n.getAttribute('onclick') || '')"
                     "     .indexOf(\"toggleShotCreationProp('RD1-01','\" + args[0] + \"')\") >= 0; });"
                     " if (!b) return false;"
                     " const on = b.classList.contains('on');"
                     " return args[1] === 'on' ? on : (!on && b.classList.contains('code-backed')); }")
            try:
                page.wait_for_function(probe, arg=[entity_id, css_class], timeout=10000)
            except Exception as error:                      # noqa: BLE001 - re-raised with context
                raise AssertionError(f"{why} (waiting for {css_class} on {entity_id}) - {error}")

        def shot_codes():
            return page.evaluate("(id) => (P.shots.find(function (s) { return s.id === id; }).codes || []).slice()", SHOT)

        def location_state(entity_id):
            return page.evaluate(
                "(id) => {"
                " const button = [...document.querySelectorAll('.guided-asset-picker-grid button.guided-asset-choice')]"
                "   .find(function (node) { return (node.getAttribute('onclick') || '').indexOf(\"setShotCreationLocation('RD1-01','\" + id + \"')\") >= 0; });"
                " if (!button) return null;"
                " return { note: ((button.querySelector('small') || {}).textContent || '').trim(),"
                "   on: button.classList.contains('on') }; }", entity_id)

        def reload_through_normalise():
            """Serialise what the page holds and hand it back through the shipped
            load, which normalises on the way in exactly as reopening the project
            does. A repair that only survived one render would pass a weaker test."""
            page.evaluate("""() => {
                const saved = JSON.parse(JSON.stringify(P));
                for (const key of Object.keys(P)) delete P[key];
                Object.assign(P, saved);
                normalizeProjectV5(P);
                location.hash = '#/shot/' + P.shots[0].id;
                route();
            }""")
            page.wait_for_selector(".bounded-shot-workspace", timeout=15000)
            open_shot_inputs()

        def shot_structure():
            return page.evaluate("""(id) => {
                const shot = (P.shots || []).find((row) => row.id === id);
                return {
                    locationId: (shot.creationBrief || {}).locationId || '',
                    codes: shot.codes || [],
                    characters: shot.characters || [],
                    resolvedLocations: resolveShotEntities(P, shot).locations.map((row) => row.id),
                };
            }""", SHOT)

        def bible_state(entity_id):
            """What the Project Bible still holds for this reference, and whether the
            kernel still recognises its approval."""
            return page.evaluate("""(id) => {
                const entity = (P.characters || []).concat(P.locations || []).find((row) => row.id === id);
                const list = (P.characters || []).some((row) => row.id === id) ? 'characters' : 'locations';
                return {
                    present: !!entity,
                    approvedFile: entity ? entity.approvedFile || '' : '',
                    states: entity ? (entity.continuityStates || []).map((s) => s.id) : [],
                    slots: entity ? (entity.coverageSlots || []).length : 0,
                    history: entity ? (entity.made || []).length : 0,
                    canon: !!currentHumanAuthority(P, { kind: 'entity-state', list, entityId: id, stateId: 'state-default' }),
                    receipts: ((P.productionAuthority || {}).receipts || []).length,
                };
            }""", entity_id)

        install()

        # ---- A. a dormant reference does not greet a filmmaker with a backlog ----------
        open_reference(CHAR, "character", "What this production needs")
        assert not page_errors, f"the reference page raised uncaught errors: {page_errors}"

        panel = demand_panel()
        assert panel, "A. the demand panel must render"
        assert panel["required"] > 0, \
            "A. (the fixture must actually carry required coverage, or the zero below proves nothing)"
        assert panel["now"] == 0, \
            f"A. a character no shot uses must owe ZERO current reference work, got {panel['now']}"
        assert panel["production"] == "dormant", \
            f"A. and the surface must say why, got data-demand-production={panel['production']!r}"
        assert "required reference" not in panel["headline"], \
            f"A. the headline must not count required references nothing is asking for: {panel['headline']!r}"
        assert panel["headline"].startswith("No shot uses this character yet"), \
            f"A. it must say what is actually true, got {panel['headline']!r}"
        # WHAT IS ABSENT IS THE CLAIM, NOT THE MATERIAL.
        # The first version of this slice collapsed the dormant list, and this gate
        # caught what that cost: the contextual "Use approved <parent> reference to
        # generate <state>" control — the most useful thing on the screen — went
        # behind a disclosure and stopped being clickable. A filmmaker building
        # their Project Bible before the shot list exists has a reference where
        # everything is dormant, so folding the workspace shut answers a false
        # backlog with an empty screen. The list leads either way and the honesty
        # lives in the label.
        assert panel["lead"] == "available", \
            f"A. with nothing required now, the available material must lead, got {panel['lead']!r}"
        assert panel["openHeight"] > 0, \
            "A. and it must occupy real space — a dormant reference is still where the work gets done"
        assert not panel["leadInDisclosure"], \
            "A. and must not sit inside a disclosure, which is what made its controls unclickable"
        assert panel["leadButtons"] > 0, \
            "A. so every control it offers is hit-testable rather than merely present"
        assert panel["caption"].startswith("Available") and "None of it is required now" in panel["caption"], \
            f"A. and the label must carry what the headline no longer claims, got {panel['caption']!r}"

        strip = coverage_strip()
        assert strip, "A. the reference strip must render the coverage task"
        assert strip["status"] == "Nothing waiting", \
            f"A. the strip must not call a dormant capability Incomplete, got {strip['status']!r}"
        assert "required view" not in strip["note"], \
            f"A. nor count required views, got {strip['note']!r}"
        assert strip["tone"] != "tone-attention", \
            f"A. nor draw attention to work that does not exist, got {strip['tone']!r}"

        # NOTHING WAS DELETED and nothing was quietly dropped.
        assert panel["dormant"] == panel["required"], \
            f"A. every required item must still be filed, got {panel['dormant']} of {panel['required']}"
        assert panel["openRows"] == panel["dormant"], \
            f"A. and every one of them must be in the list a person can see, got {panel['openRows']}"
        assert panel["groupsOpen"] == 0, \
            "A. while Recommended and Not-currently-needed keep the Slice 3 collapsed treatment"
        findings.append(f"A. a character no shot uses reports \"{panel['headline']}\" with 0 current work; all "
                        f"{panel['required']} required views still LEAD the screen over {panel['openHeight']}px with "
                        f"{panel['leadButtons']} hit-testable controls, outside any disclosure, under "
                        f"\"{panel['caption']}\"; the strip reads \"{strip['status']} · {strip['note']}\"")

        # ---- B. casting the character through the shipped control makes work appear -----
        open_shot_inputs()
        click_in_cast(f'.guided-cast-assets button[onclick*="toggleShotCreationCharacter"][onclick*="{CHAR}"]',
                      "B. casting the character")
        page.wait_for_function("(id) => (P.shots[0].characters || []).includes(id)", arg=CHAR, timeout=10000)
        open_reference(CHAR, "character", "What this production needs")
        cast = demand_panel()
        assert cast["production"] == "demanded", \
            f"B. once a shot casts the character it must read demanded, got {cast['production']!r}"
        # WHAT THE PRODUCTION OWES, NOT THE WHOLE TEMPLATE. An independent review
        # found the earlier expectation here — every unmet template row becomes
        # current work — asserting the defect the slice exists to remove. What
        # casting the character makes current is the continuity state the shot
        # DECLARES and has no approved image for; the four seeded coverage views
        # stay coverage plan.
        assert cast["now"] == 1, \
            f"B. casting must raise exactly the production's own obligation, got {cast['now']}"
        assert cast["now"] < cast["required"], \
            f"B. and it must be fewer than the entity's template ({cast['now']} of {cast['required']})"
        assert cast["obligations"] == "readiness", \
            f"B. derived from readiness rather than from the template, got {cast['obligations']!r}"
        assert cast["plan"] == cast["missing"] - cast["now"], \
            f"B. with everything else still counted as coverage plan ({cast['plan']})"
        assert cast["openRows"] == cast["now"], \
            f"B. listed where a filmmaker can see them, got {cast['openRows']} rows"
        assert cast["openHeight"] > 0, "B. and occupying real space on screen"
        assert "required reference" in cast["headline"], \
            f"B. with a headline that says so, got {cast['headline']!r}"
        assert cast["lead"] == "required-now", \
            f"B. and the leading list is now genuinely required work, got {cast['lead']!r}"
        assert not cast["caption"], \
            f"B. so the \"nothing here is required now\" caption must be gone, got {cast['caption']!r}"
        findings.append(f"B. clicking the shot's cast control makes the same reference read demanded and raises "
                        f"exactly {cast['now']} current obligation — \"{cast['headline']}\" — over a "
                        f"{cast['openHeight']}px list, while its other {cast['plan']} template rows stay coverage plan")

        # ---- C. un-casting it removes the demand and deletes nothing --------------------
        before_bible = bible_state(CHAR)
        open_shot_inputs()
        click_in_cast(f'.guided-cast-assets button[onclick*="toggleShotCreationCharacter"][onclick*="{CHAR}"]',
                      "C. un-casting the character")
        page.wait_for_function("(id) => !(P.shots[0].characters || []).includes(id)", arg=CHAR, timeout=10000)
        open_reference(CHAR, "character", "What this production needs")
        released = demand_panel()
        after_bible = bible_state(CHAR)
        assert released["now"] == 0, \
            f"C. removing the shot's use must remove the demand, got {released['now']}"
        assert released["production"] == "dormant", "C. and the surface must say so again"
        assert after_bible == before_bible, \
            f"C. and NOTHING about the reference may change: {before_bible} -> {after_bible}"
        assert after_bible["canon"] is True, \
            "C. its approved primary is still Canon — the kernel says so, not a pointer"
        assert after_bible["history"] > 0, "C. and its generation history is still on it"
        findings.append(f"C. un-casting the character returns it to 0 current work with the Project Bible record "
                        f"byte-identical — {after_bible['slots']} coverage slots, {after_bible['states']} states, "
                        f"{after_bible['history']} history record(s), canon intact, "
                        f"{after_bible['receipts']} receipts unchanged")

        # ---- D. the Location can be cleared through the shipped UI ----------------------
        open_shot_inputs()
        grid = location_grid()
        assert grid, "D. the location picker must render"
        clear = next((row for row in grid if row["clear"]), None)
        assert clear, f"D. the picker must offer a way to select no location, got {grid!r}"
        assert clear["label"] == "No location", f"D. named for what it does, got {clear['label']!r}"
        assert clear["box"]["w"] > 0 and clear["box"]["h"] > 0, \
            f"D. and it must be a real, hit-testable control, measured {clear['box']!r}"
        assert not clear["on"], "D. and read as not chosen while a location IS selected"
        primary = next((row for row in grid if row["note"] == "primary plate"), None)
        assert primary and primary["label"] == "Dock exterior", \
            f"D. (precondition) the shot must have a primary plate, got {grid!r}"

        before_structure = shot_structure()
        assert before_structure["locationId"] == LOC, "D. (precondition) the shot names the location"
        click_in_cast(f'button[data-clear-location="{SHOT}"]', "D. clearing the location")
        page.wait_for_function("(id) => !((P.shots.find((s) => s.id === id).creationBrief || {}).locationId || '')",
                               arg=SHOT, timeout=10000)
        after_structure = shot_structure()
        assert after_structure["locationId"] == "", "D. the shot's location selection is gone"
        assert LOC not in after_structure["codes"], \
            f"D. and its code token with it, so nothing infers it back: {after_structure['codes']!r}"
        assert after_structure["resolvedLocations"] == [], \
            f"D. so the shot structurally uses no location, got {after_structure['resolvedLocations']!r}"
        findings.append(f"D. the shipped \"No location\" control is a {clear['box']['w']}x{clear['box']['h']}px "
                        f"button in the same grid the plate was chosen in; clicking it takes the shot from "
                        f"{before_structure['resolvedLocations']} to {after_structure['resolvedLocations']}")

        # ---- E. the shot's visible state updates in the same interaction ----------------
        # No re-navigation: this is the SAME interaction. app.js re-renders on the
        # mutation, so the only wait here is for the repainted control to be visible
        # again — a fixed delay would read the pre-click DOM on a slow machine.
        page.wait_for_selector(".guided-cast-assets", state="attached", timeout=15000)
        page.wait_for_function(
            "(shot) => { const c = document.querySelector('button[data-clear-location=\"' + shot + '\"]');"
            " return !!c && c.classList.contains('on'); }", arg=SHOT, timeout=10000)
        immediate = cast_state()
        assert immediate["clearOn"], "E. the cleared state must be visible on the control that produced it"
        assert "primary plate" not in immediate["notes"], \
            f"E. and no plate may still be presented as this shot's primary, got {immediate['notes']!r}"
        reveal_cast()
        after_grid = location_grid()
        cleared_choice = next((row for row in after_grid if row["clear"]), None)
        assert cleared_choice and cleared_choice["on"], \
            "E. the cleared state must be visible on the control that produced it, without a reload"
        assert not any(row["note"] == "primary plate" for row in after_grid), \
            f"E. and no plate may still be presented as this shot's primary, got {after_grid!r}"
        assert any(row["label"] == "Dock exterior" for row in after_grid), \
            "E. while the same plate stays selectable — clearing is a change of mind, not a deletion"

        # ...and the released location goes dormant on its OWN surface, immediately.
        open_reference(LOC, "location", "What this production needs")
        location_panel = demand_panel()
        assert location_panel["production"] == "dormant", \
            f"E. the released location must now read dormant, got {location_panel['production']!r}"
        assert location_panel["now"] == 0, "E. and owe no current reference work"
        findings.append(f"E. the picker repaints in the same interaction — the no-location choice reads chosen, "
                        f"nothing is presented as the primary plate, the plate stays selectable, and the released "
                        f"location's own surface reads \"{location_panel['headline']}\"")

        # ---- F. approved media and history survive both clears --------------------------
        location_bible = bible_state(LOC)
        assert location_bible["canon"] is True, \
            "F. the location's approved plate is still Canon after the shot released it"
        assert location_bible["approvedFile"] == f"{LOC}-PLATE.png", "F. and still on the record"
        assert location_bible["receipts"] == len(RECEIPTS), \
            f"F. with the whole receipt ledger intact, got {location_bible['receipts']}"
        shot_media = page.evaluate("""(id) => {
            const shot = (P.shots || []).find((row) => row.id === id);
            return {
                winners: (shot.keyframes || []).map((f) => f.winner || ''),
                frameCanon: !!currentHumanAuthority(P, { kind: 'shot-frame', shotId: id, frameId: 'frame-a' }),
            };
        }""", SHOT)
        assert shot_media["winners"] == [f"{SHOT}-FRAME_A.png", ""], \
            f"F. the shot's approved frame survived both clears, got {shot_media['winners']!r}"
        assert shot_media["frameCanon"] is True, "F. and the kernel still recognises the approval"

        # REACHABLE, not merely present: the shot workspace still RENDERS the approved
        # frame's media after the clear. Waited on the shot shell rather than on `#main`,
        # which survives every route and would resolve against the previous page.
        page.evaluate("(hash) => { location.hash = hash; }", f"#/shot/{SHOT}")
        page.evaluate("() => route()")
        page.wait_for_selector(".bounded-shot-workspace", timeout=15000)
        page.wait_for_function("(id) => (document.querySelector('.bounded-shot-workspace') || {}).textContent !== undefined",
                               arg=SHOT, timeout=10000)
        reachable = page.evaluate("""(name) => {
            const shell = document.querySelector('.bounded-shot-workspace');
            if (!shell) return { shell: false };
            const html = shell.innerHTML;
            return {
                shell: true,
                named: html.includes(name),
                /* And it is a rendered picture, not only a filename in an attribute. */
                pictured: [...shell.querySelectorAll('img[src], video[src]')]
                    .some((node) => (node.getAttribute('src') || '').startsWith('data:image')),
            };
        }""", f"{SHOT}-FRAME_A.png")
        assert reachable["shell"], "F. the shot workspace must render at all"
        assert reachable["named"],             "F. and the approved frame must still be named on it after the clear"
        assert reachable["pictured"],             "F. and its media must still be rendered, not merely recorded"
        findings.append(f"F. after both clears the location keeps its Canon plate, the whole "
                        f"{location_bible['receipts']}-receipt ledger is intact, the shot's approved frame is "
                        f"still its winner, the kernel still recognises it, and it still renders on the shot")

        # ---- G. a vehicleIds-only vehicle is visibly attached and can be cleared --------
        # The dialect no shipped control has ever written. Before this repair the
        # vehicle rendered UNSELECTED while readiness and reference demand both
        # counted it, so a filmmaker could neither see the attachment nor remove it.
        install()
        open_shot_inputs()
        vehicle = page.evaluate(r"""() => {
            const button = [...document.querySelectorAll('.guided-asset-picker-grid button.guided-asset-choice')]
                .find((node) => /toggleShotCreationProp\('RD1-01','VEH-DOCK'\)/.test(node.getAttribute('onclick') || ''));
            if (!button) return null;
            const box = button.getBoundingClientRect();
            return { on: button.classList.contains('on'), w: Math.round(box.width), h: Math.round(box.height),
                     label: ((button.querySelector('b') || {}).textContent || '').trim() };
        }""")
        assert vehicle, "G. the vehicle must render in the Props & Vehicles picker"
        assert vehicle["on"], \
            f"G. a vehicle attached through `vehicleIds` must render as selected, got {vehicle!r}"
        assert vehicle["w"] > 0 and vehicle["h"] > 0, "G. and be a real, hit-testable control"
        before_vehicle = page.evaluate("""() => ({
            vehicleIds: P.shots[0].creationBrief.vehicleIds, propIds: P.shots[0].creationBrief.propIds,
            demanded: entityReferenceDemand(P, 'vehicle', 'VEH-DOCK').demanded,
            receipts: ((P.productionAuthority || {}).receipts || []).length,
            plate: P.vehicles[0].approvedFile,
        })""")
        assert before_vehicle["demanded"], "G. (precondition) and reference demand must already count it"
        click_in_cast("button.guided-asset-choice[onclick*=\"toggleShotCreationProp('RD1-01','VEH-DOCK')\"]",
                      "G. clearing the vehicle")
        page.wait_for_function("() => !(P.shots[0].creationBrief.vehicleIds || []).length", timeout=10000)
        after_vehicle = page.evaluate("""() => ({
            vehicleIds: P.shots[0].creationBrief.vehicleIds, propIds: P.shots[0].creationBrief.propIds,
            demanded: entityReferenceDemand(P, 'vehicle', 'VEH-DOCK').demanded,
            receipts: ((P.productionAuthority || {}).receipts || []).length,
            plate: P.vehicles[0].approvedFile,
        })""")
        assert after_vehicle["vehicleIds"] == [] and after_vehicle["propIds"] == [], \
            f"G. one click must clear the relationship in every dialect, got {after_vehicle!r}"
        assert not after_vehicle["demanded"], "G. so the vehicle no longer demands its references"
        assert after_vehicle["receipts"] == before_vehicle["receipts"], "G. and no receipt was touched"
        assert after_vehicle["plate"] == before_vehicle["plate"], "G. nor the vehicle's approved plate"
        findings.append(f"G. a vehicle attached only through the legacy `vehicleIds` dialect renders as a "
                        f"{vehicle['w']}x{vehicle['h']}px SELECTED control and one click clears it in both "
                        f"dialects — demanded {before_vehicle['demanded']} -> {after_vehicle['demanded']}, "
                        f"{after_vehicle['receipts']} receipts and its plate untouched")

        # ---- H. a satisfied reference does not present its template as blocking work ----
        # The headline defect of the independent review: an active character whose
        # primary was already Canon reported "8 required references still needed"
        # while Production said MARK SHOT FINAL.
        install(shot_overrides={"characters": [CHAR], "continuityStateSelections": {}})
        open_reference(CHAR, "character", "What this production needs")
        satisfied = demand_panel()
        production_says = page.evaluate("""() => {
            const feed = projectShotReadiness();
            return {
                blockers: projectSharedBlockers(feed).map((row) => row.key)
                    .filter((key) => key.indexOf('RD-BROWSER') >= 0),
                next: (projectNextProductionAction() || {}).actionLabel || '',
            };
        }""")
        assert satisfied["production"] == "demanded", "H. (precondition) the character is in use"
        assert production_says["blockers"] == [], \
            f"H. (precondition) and Production must owe nothing on it, got {production_says['blockers']!r}"
        assert satisfied["now"] == 0, \
            f"H. so the reference surface must claim no current work either, got {satisfied['now']}"
        assert satisfied["plan"] > 0, \
            "H. while its unfilled coverage is still counted as plan rather than lost"
        assert "required reference" not in satisfied["headline"], \
            f"H. and the headline must not count a backlog, got {satisfied['headline']!r}"
        assert satisfied["lead"] == "available" and not satisfied["leadInDisclosure"], \
            "H. the coverage remains ACCESSIBLE — leading the screen, outside any disclosure"
        assert satisfied["leadButtons"] > 0, "H. with its controls hit-testable"
        satisfied_strip = coverage_strip()
        assert satisfied_strip["status"] == "Nothing waiting", \
            f"H. and the strip must agree, got {satisfied_strip['status']!r}"
        findings.append(f"H. an active character whose Canon already satisfies readiness reports 0 current work "
                        f"and \"{satisfied['headline']}\" while Production owes nothing on it and says "
                        f"{production_says['next']}; its {satisfied['plan']} unfilled coverage rows stay on screen "
                        f"with {satisfied['leadButtons']} reachable controls, and the strip reads "
                        f"\"{satisfied_strip['status']}\"")

        # ---- I. a cleared primary Location survives the save/normalise/re-render path ---
        install(shot_overrides={"codes": [LOC, "LOC-SUPPORT"]})
        open_shot_inputs()
        before_locations = page.evaluate("(id) => resolveShotEntities(P, P.shots.find((s) => s.id === id)).locations.map((x) => x.id)", SHOT)
        assert before_locations == [LOC, "LOC-SUPPORT"], \
            f"I. (precondition) the shot must have a primary and a supporting location, got {before_locations!r}"
        click_in_cast(f'button[data-clear-location="{SHOT}"]', "I. clearing the primary with a support present")
        page.wait_for_function("(id) => !((P.shots.find((s) => s.id === id).creationBrief || {}).locationId || '')",
                               arg=SHOT, timeout=10000)
        # THE REAL PATH: serialise what the page holds, hand it back through the
        # shipped load, and re-render. This is what a save and a reopen do, and it
        # is where the cleared primary used to be silently replaced.
        page.evaluate("""() => {
            const saved = JSON.parse(JSON.stringify(P));
            for (const key of Object.keys(P)) delete P[key];
            Object.assign(P, saved);
            normalizeProjectV5(P);
            location.hash = '#/shot/' + P.shots[0].id;
            route();
        }""")
        page.wait_for_selector(".bounded-shot-workspace", timeout=15000)
        open_shot_inputs()
        reloaded = page.evaluate("""(id) => {
            const shot = P.shots.find((s) => s.id === id);
            return {
                locationId: (shot.creationBrief || {}).locationId || '',
                resolved: resolveShotEntities(P, shot).locations.map((x) => x.id),
                codes: shot.codes,
            };
        }""", SHOT)
        assert reloaded["locationId"] == "", \
            f"I. the explicitly cleared primary must survive save/normalise/re-render, got {reloaded['locationId']!r}"
        assert reloaded["resolved"] == ["LOC-SUPPORT"], \
            f"I. and the supporting location must remain, as support, got {reloaded['resolved']!r}"
        reloaded_grid = location_grid()
        assert not any(row["note"] == "primary plate" for row in reloaded_grid), \
            f"I. with nothing shown as this shot's primary plate, got {reloaded_grid!r}"
        support_row = next((row for row in reloaded_grid if row["label"] == "Support bay"), None)
        assert support_row and not support_row["on"], \
            "I. the support is available to choose and is not silently promoted"
        assert next((row for row in reloaded_grid if row["clear"]), {}).get("on"), \
            "I. and the no-location choice reads chosen"
        findings.append(f"I. clearing the primary on a shot that also has a SUPPORTING location survives a full "
                        f"save/normalise/re-render: locationId stays empty, {reloaded['resolved']} remains attached "
                        f"as support, nothing is shown as the primary plate, and the support is offered rather "
                        f"than promoted")

        # ---- J. a suffixed relation is attached, NOT ordinary picker-owned --------------
        # normalizeShotV5 bridges the code-resolved id into creationBrief.propIds, so
        # the brief says the entity is there; what the picker must not do is read that
        # bridge as its own selection and offer to delete the token behind it.
        install(shot_overrides={"codes": [LOC, "VEH-DOCK-REAR", "PROP-CRATE-LEFT"],
                                "creationBrief": {"locationId": LOC, "propIds": [], "vehicleIds": [],
                                                  "promptBuilds": [], "mode": "auto"}})
        open_shot_inputs()
        bridged = page.evaluate("(id) => (P.shots.find(function (s) { return s.id === id; }).creationBrief.propIds || []).slice()", SHOT)
        assert sorted(bridged) == ["PROP-CRATE", "VEH-DOCK"], \
            f"J. (precondition) normalization must have bridged both ids into the brief, got {bridged!r}"
        for entity_id, token in (("VEH-DOCK", "VEH-DOCK-REAR"), ("PROP-CRATE", "PROP-CRATE-LEFT")):
            state = prop_vehicle_state(entity_id)
            assert state, f"J. {entity_id} must render in the picker"
            assert state["state"] == "code-backed", \
                f"J. {entity_id} is named only by {token}, so it must not read as an ordinary selection, got {state!r}"
            assert state["note"] == "attached by a shot code · select to choose it here", \
                f"J. and must say what it is and what a click does, got {state['note']!r}"
            assert state["w"] > 0 and state["h"] > 0, f"J. {entity_id} must be a real, hit-testable control"
        findings.append("J. a vehicle and a prop reached only through the suffixed tokens VEH-DOCK-REAR and "
                        "PROP-CRATE-LEFT render as dashed, hit-testable \"attached by a shot code · select to "
                        "choose it here\" controls, even though normalization has bridged both ids into "
                        "creationBrief.propIds")

        # ---- K. the explicit layer goes ON, and the suffix survives ---------------------
        before_codes = shot_codes()
        click_in_cast("button.guided-asset-choice[onclick*=\"toggleShotCreationProp('RD1-01','VEH-DOCK')\"]",
                      "K. choosing the code-backed vehicle")
        page.wait_for_function("(id) => (P.shots.find(function (s) { return s.id === id; }).codes || []).indexOf('VEH-DOCK') >= 0",
                               arg=SHOT, timeout=10000)
        layered = shot_codes()
        assert "VEH-DOCK-REAR" in layered, \
            f"K. the suffixed token must survive an explicit selection, got {layered!r}"
        assert "VEH-DOCK" in layered, \
            "K. and the selection must record its own exact token, or it could never be taken back"
        wait_for_picker_state("VEH-DOCK", "on", "K. the picker must repaint as owning it")
        assert prop_vehicle_state("VEH-DOCK")["state"] == "selected", \
            "K. so the picker may now truthfully own it"
        findings.append(f"K. selecting the code-backed vehicle takes codes {before_codes} -> {layered}: the legacy "
                        f"suffixed token is untouched and the explicit choice records its own exact token")

        # ---- L. clearing that layer leaves the code-backed attachment visible ----------
        click_in_cast("button.guided-asset-choice[onclick*=\"toggleShotCreationProp('RD1-01','VEH-DOCK')\"]",
                      "L. clearing the explicit layer")
        page.wait_for_function("(id) => (P.shots.find(function (s) { return s.id === id; }).codes || []).indexOf('VEH-DOCK') < 0",
                               arg=SHOT, timeout=10000)
        reload_through_normalise()
        wait_for_picker_state("VEH-DOCK", "code-backed", "L. the picker must repaint as attached-not-owned")
        after_clear = shot_codes()
        assert "VEH-DOCK-REAR" in after_clear, \
            f"L. clearing the picker's own layer must leave the suffixed token alone, got {after_clear!r}"
        assert "VEH-DOCK" not in after_clear, "L. removing only the exact token it added"
        restored = prop_vehicle_state("VEH-DOCK")
        assert restored["state"] == "code-backed", \
            f"L. and the vehicle returns to attached-not-owned rather than vanishing from a shot that names it, got {restored!r}"
        assert restored["w"] > 0 and restored["h"] > 0, "L. still a real control"
        findings.append(f"L. clearing the explicit layer leaves codes {after_clear} through a full "
                        f"save/normalise/re-render, and the vehicle is visibly attached-not-owned again")

        # ---- M. the suffixed Location, which is where the real data is ------------------
        # 276 suffixed location tokens exist in this repository's corpus and zero
        # suffixed prop/vehicle ones, so this is the half a filmmaker would hit.
        install(shot_overrides={"codes": ["LOC-RD-A", "LOC-SUPPORT"],
                                "creationBrief": {"propIds": [], "vehicleIds": [], "promptBuilds": [], "mode": "auto"}})
        open_shot_inputs()
        inferred = page.evaluate("(id) => (P.shots.find(function (s) { return s.id === id; }).creationBrief || {}).locationId || ''", SHOT)
        assert inferred == LOC, \
            f"M. (precondition) the suffixed token must still infer a primary, got {inferred!r}"
        assert location_state(LOC)["note"] == "primary plate", "M. (precondition) shown as the primary"

        click_in_cast(f'button[data-clear-location="{SHOT}"]', "M. No location over a suffixed token")
        page.wait_for_function("(id) => !((P.shots.find(function (s) { return s.id === id; }).creationBrief || {}).locationId || '')",
                               arg=SHOT, timeout=10000)
        reload_through_normalise()
        cleared_codes = shot_codes()
        cleared_primary = page.evaluate("(id) => (P.shots.find(function (s) { return s.id === id; }).creationBrief || {}).locationId || ''", SHOT)
        assert "LOC-RD-A" in cleared_codes, \
            f"M. No location must preserve the suffixed token, got {cleared_codes!r}"
        assert cleared_primary == "", \
            f"M. and the primary must stay explicitly empty through normalise and re-render, got {cleared_primary!r}"
        assert location_state(LOC)["note"] == "supporting location · select to make primary", \
            "M. with the location visibly attached as SUPPORT, in the words this picker already uses"
        assert next((row for row in location_grid() if row["clear"]), {}).get("on"), \
            "M. and the no-location choice reading chosen"

        click_in_cast(f'button.guided-asset-choice[onclick*="setShotCreationLocation(\'{SHOT}\',\'{LOC}\')"]',
                      "M. explicit reselect")
        page.wait_for_function("(id) => ((P.shots.find(function (s) { return s.id === id; }).creationBrief || {}).locationId || '') !== ''",
                               arg=SHOT, timeout=10000)
        reload_through_normalise()
        reselected = shot_codes()
        assert "LOC-RD-A" in reselected and LOC in reselected, \
            f"M. an explicit reselect preserves the suffix and records its own exact token, got {reselected!r}"
        assert location_state(LOC)["note"] == "primary plate", "M. and reads as the primary again"

        click_in_cast(f'button[data-clear-location="{SHOT}"]', "M. second clear")
        page.wait_for_function("(id) => !((P.shots.find(function (s) { return s.id === id; }).creationBrief || {}).locationId || '')",
                               arg=SHOT, timeout=10000)
        reload_through_normalise()
        final_codes = shot_codes()
        assert "LOC-RD-A" in final_codes and LOC not in final_codes, \
            f"M. a second clear removes only the exact layer, got {final_codes!r}"
        assert location_state(LOC)["note"] == "supporting location · select to make primary", \
            "M. back to support"
        ledger = page.evaluate("() => ((P.productionAuthority || {}).receipts || []).length")
        assert ledger == len(RECEIPTS), f"M. and the whole round trip wrote no receipt, got {ledger}"
        findings.append(f"M. a suffixed Location survives the whole round trip: No location keeps LOC-RD-A and "
                        f"leaves the primary explicitly empty through normalise and re-render, the location shows "
                        f"as support, an explicit reselect adds its own exact token without touching the suffix, a "
                        f"second clear removes only that token, and the {ledger}-receipt ledger is untouched")

        # ---- N1. the backlog CAN appear, so section A's zero means something -------------
        install(shot_overrides={"characters": [CHAR]})
        open_reference(CHAR, "character", "What this production needs")
        armed = demand_panel()
        assert armed["now"] > 0, \
            "N1: with a shot casting the character the backlog MUST appear — section A's zero is vacuous otherwise"
        assert armed["lead"] == "required-now", \
            f"N1: and the lead marker MUST flip, so section A's 'available' is a measurement, got {armed['lead']!r}"
        findings.append(f"N1. the same detectors report {armed['now']} required references and a lead marker of "
                        f"{armed['lead']!r} once a shot casts the character — so section A's 0 and its 'available' "
                        f"lead are measurements rather than an element that never changes")

        # ---- N2. "primary plate" CAN come back, so section E's absence means something ---
        install()
        open_shot_inputs()
        click_in_cast(f'button[data-clear-location="{SHOT}"]', "N2. clearing the location")
        page.wait_for_function("(id) => !((P.shots.find((s) => s.id === id).creationBrief || {}).locationId || '')",
                               arg=SHOT, timeout=10000)
        click_in_cast(PLATE_BUTTON, "N2. re-selecting the plate")
        page.wait_for_function("(id) => ((P.shots.find((s) => s.id === id).creationBrief || {}).locationId || '') !== ''",
                               arg=SHOT, timeout=10000)
        page.wait_for_function(
            "(shot) => { const c = document.querySelector('button[data-clear-location=\"' + shot + '\"]');"
            " return !!c && !c.classList.contains('on'); }", arg=SHOT, timeout=10000)
        reveal_cast()
        restored_grid = location_grid()
        assert any(row["note"] == "primary plate" for row in restored_grid), \
            f"N2: re-selecting the plate MUST restore it as primary — section E's absence is vacuous otherwise, got {restored_grid!r}"
        restored_clear = next((row for row in restored_grid if row["clear"]), None)
        assert restored_clear and not restored_clear["on"], \
            "N2: and the no-location choice must read as not chosen again"
        restored_receipts = page.evaluate("() => ((P.productionAuthority || {}).receipts || []).length")
        assert restored_receipts == len(RECEIPTS), \
            f"N2: and the round trip must write no receipt, got {restored_receipts}"
        findings.append("N2. the same detector reports \"primary plate\" back once the plate is re-selected, and the "
                        "round trip writes no receipt — so section E's absence is a measurement, and clearing a "
                        "location is genuinely reversible")

        assert not page_errors, f"the audit raised uncaught page errors: {page_errors}"
        assert not offsite, f"requests attempted to leave the machine: {offsite}"
        assert not paid_calls, f"a paid route was called: {paid_calls}"

    print(f"{LABEL} passed:")
    for line in findings:
        print("  " + line)
    print("  provider calls: 0 · paid calls: 0 · off-site requests: 0")
finally:
    server.terminate()
    try: server.wait(timeout=10)
    except Exception: server.kill()
    shutil.rmtree(sandbox, ignore_errors=True)
