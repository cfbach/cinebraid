#!/usr/bin/env python3
"""Batch 2, Slice 3 — THE REFERENCE REFRAME, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. tests/reference-reframe.js proves everything semantic
about this slice in Node: that the unauthored-slot default was not flipped, that the
demand tier is a total rename of the shipped requirement tokens, that no parent is ever
guessed, and that the hand-off names a task the workspace declares. Six claims cannot
be proven there, and they are the six a filmmaker would actually notice:

  * THE PRIMARY REFERENCE IS PHYSICALLY FIRST. "Leads the surface" is a claim about
    LAYOUT. The Node harness never lays anything out, so a string-order assertion there
    passes even if CSS stacks the candidate grid above the hero. This measures bounding
    boxes.
  * THE TASKBAR REALLY IS THREE REACHABLE CONTROLS, clicked rather than called, with no
    `Choose & approve` among them.
  * THE COVERAGE DETAIL REALLY IS CLOSED to a person, and re-opens on the hand-off path.
    A collapsed region is a string in Node and real geometry in a browser; only here can
    the boards be shown to occupy no space until asked for. This suite is also what
    proved the region could not be a `<details>` at all: app.js restores every
    disclosure's prior open state across a same-route re-render, so a freshly computed
    `open` was overridden and the Slice 1 state hand-off landed on a shut door.
  * THE CONTEXTUAL GENERATE ACTION REALLY IS CLICKABLE, and clicking it really writes
    nothing — the "no mutation merely from viewing the option" rule, exercised by a
    real click through the real event path rather than by calling the handler.
  * THE PAGE DOES NOT SCROLL SIDEWAYS at 1600 or at 1280 with the reframed surfaces on
    screen.
  * THE RECOMMENDED ACTION'S HELPER LINE IS LEGIBLE ON ITS OWN BUTTON. Contrast is a
    property of the resolved cascade against a resolved background; Node has neither,
    so a correct string there passed while the rendered helper sat at 1.14:1.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a detector that can only ever report one
answer is worth nothing. Both work by changing the PROJECT rather than the code, so the
same shipped renderer is asked two questions with opposite correct answers:

  N1 gives the orphan state a recorded, approved parent and requires the generate action
     to APPEAR — proving the "no guessed parent" assertion is measuring something that
     can be present, not an element that never exists.
  N2 writes the coverage sub-view key — the same key the Slice 1 hand-off writes — and
     requires the boards to OPEN and render, proving the "ships closed" assertion is not
     passing against a missing element and that a completed state run lands somewhere.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback.
"""

import json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Reference reframe real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []

ENTITY = "CHAR-REFRAME"

# The same shape tests/reference-reframe.js uses, for the same reason: one entity that
# carries every case at once, so a single page answers all of them and no assertion can
# be made about a fixture that does not contain its case.
#
#   state-soot        parent recorded AND canon   -> the generate action MUST appear
#   state-orphan      no parent recorded          -> it MUST NOT, and N1 flips this
#   state-dangling    parent recorded, missing    -> it MUST NOT
#   state-unapproved  parent recorded, not canon  -> it MUST NOT
CHARACTER = {
    "id": ENTITY,
    "prefix": ENTITY,
    "anchorPrefix": ENTITY,
    "name": "Nora Reframe",
    "approvedFile": f"{ENTITY}-PRIMARY.png",
    "coverageSlots": [
        {"id": "front", "label": "Front", "requirement": "required", "selectedFile": ""},
        {"id": "profile", "label": "Profile", "required": False, "selectedFile": ""},
        {"id": "rear", "label": "Rear", "requirement": "not-required", "selectedFile": ""},
    ],
    "expressionSlots": [{"id": "neutral", "label": "Neutral", "requirement": "not-required", "selectedFile": ""}],
    "continuityStates": [
        {"id": "state-default", "name": "Clean overall", "isDefault": True, "approvedFile": f"{ENTITY}-PRIMARY.png", "notes": "Primary identity."},
        {"id": "state-soot", "name": "Heavy soot", "isDefault": False, "parentStateId": "state-default", "referenceRequirement": "required", "notes": "Soot over every surface."},
        {"id": "state-orphan", "name": "Torn sleeve", "isDefault": False, "parentStateId": "", "referenceRequirement": "required", "notes": "Left sleeve torn."},
        {"id": "state-dangling", "name": "Night lighting", "isDefault": False, "parentStateId": "state-does-not-exist", "referenceRequirement": "required", "notes": "Cold key."},
        {"id": "state-unapproved", "name": "Rain soaked", "isDefault": False, "parentStateId": "state-soot", "referenceRequirement": "planned", "notes": "Wet through."},
    ],
    "candidateFiles": [
        {"stored": f"{ENTITY}-FRONT-A.png", "original": f"{ENTITY}-FRONT-A.png", "decision": "unreviewed", "targetStateId": "state-default"},
        {"stored": f"{ENTITY}-FRONT-B.png", "original": f"{ENTITY}-FRONT-B.png", "decision": "unreviewed", "targetStateId": "state-default"},
    ],
    "made": [{"model": "fixture-model", "files": f"{ENTITY}-PRIMARY.png", "prompt": "a long compiled provenance prompt", "date": "2026-08-01"}],
}

# Only the DEFAULT state is canon, which is what makes state-soot derivable and
# state-unapproved not. A raw pointer is historic until a receipt says otherwise.
RECEIPT = {
    "id": "authority-000001", "sequence": 1, "actor": "human", "act": "explicit-approval",
    "command": "approve-entity-state", "kind": "entity-state",
    "targetKey": f"entity-state:characters:{ENTITY}#state-default",
    "shotId": "", "frameId": "", "unitKey": "", "list": "characters",
    "entityId": ENTITY, "stateId": "state-default", "slotId": "",
    "value": f"{ENTITY}-PRIMARY.png", "assetId": "", "at": "2026-08-15T00:00:00.000Z",
    "status": "current", "supersededBy": "", "supersededAt": "", "revokedAt": "",
    "revocationReason": "", "note": "",
    "provenance": {"manualAction": "gesture-browser-fixture", "via": "real-browser-fixture", "gesture": "click"},
}

TINY = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='48'%3E%3Crect width='32' height='48' fill='%23343c44'/%3E%3C/svg%3E"
ANCHORS = [{"name": f"{ENTITY}-PRIMARY.png", "url": TINY},
           {"name": f"{ENTITY}-FRONT-A.png", "url": TINY},
           {"name": f"{ENTITY}-FRONT-B.png", "url": TINY}]


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-reference-reframe-"))
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

        def install(character=CHARACTER):
            """Install the fixture into the live document and render the reference.

            WAIT FOR THE REQUESTED THING, never for a fixed delay: route() is async and
            reading straight after it returns reads the page the browser was on a moment
            ago. This waits for the reference page the call asked for."""
            page.evaluate(
                """(payload) => {
                    P.characters = [payload.character];
                    P.productionAuthority = { version: 1, receipts: [payload.receipt] };
                    SCAN.anchors = payload.anchors;
                    location.hash = '#/character/' + payload.id;
                }""",
                {"character": character, "receipt": RECEIPT, "anchors": ANCHORS, "id": ENTITY})
            page.evaluate("() => route()")
            page.wait_for_selector(f'.bounded-entity-page[data-selected-task]', timeout=15000)

        def selected_task():
            return page.get_attribute(".bounded-entity-page", "data-selected-task")

        def taskbar():
            return page.evaluate("""() => [...document.querySelectorAll('.bounded-entity-taskbar .focused-task-button')]
                .map((b) => ((b.querySelector('b') || {}).textContent || '').trim())""")

        def generate_action(state_id):
            """The contextual 'Use approved [parent] reference to generate [state]' control
            for one demand row, or None. Returns its exact label so a guessed parent is
            visible rather than merely counted."""
            return page.evaluate(
                """(id) => {
                    const row = document.querySelector(`.entity-demand-row[data-demand-id="${id}"]`);
                    if (!row) return { present: false, row: false };
                    const button = [...row.querySelectorAll('button')]
                        .find((b) => /^Use approved .* reference to generate /.test((b.textContent || '').trim()));
                    return { present: !!button, row: true, label: button ? button.textContent.trim() : '',
                             status: (row.querySelector('small') || {}).textContent || '' };
                }""", state_id)

        def detail_open():
            """The coverage detail is deliberately NOT a `<details>`: app.js restores
            every disclosure's prior open state across a same-route re-render, which
            would override a freshly computed `open` and leave the Slice 1 hand-off on
            a shut door. Its state is derived from the selected sub-view instead, so
            this reads that, and separately measures whether the boards occupy space."""
            return page.evaluate("""() => {
                const node = document.querySelector('.entity-coverage-detail');
                if (!node) return None_MARKER;
                const body = node.querySelector('.entity-subworkspace-tabs');
                return {
                    open: node.dataset.coverageDetailOpen === '1',
                    expanded: (node.querySelector('.entity-coverage-detail-toggle') || {}).getAttribute
                        ? node.querySelector('.entity-coverage-detail-toggle').getAttribute('aria-expanded') : '',
                    tabsVisible: !!body && body.getBoundingClientRect().height > 0,
                    boardsRendered: document.querySelectorAll('[data-entity-subworkspace]').length,
                };
            }""".replace('None_MARKER', 'null'))

        install()

        # ---- 1. the reference opens on its primary, and the primary is physically first -
        assert not page_errors, f"the reference page raised uncaught errors: {page_errors}"
        assert selected_task() == "reference", \
            f"1. a reference must open on its primary reference, got {selected_task()!r}"

        labels = taskbar()
        assert labels == ["Primary reference", "What this production needs", "Details & history"], \
            f"1. the reference workspace must offer exactly these three stages, got {labels!r}"
        assert not any("Choose & approve" in label or label == "Review" for label in labels), \
            "1. `Choose & approve` must no longer be a peer top-level production stage"

        geometry = page.evaluate("""() => {
            const box = (selector) => { const n = document.querySelector(selector); return n ? n.getBoundingClientRect().top : null; };
            return {
                hero: box('#main .reference-primary-hero'),
                candidates: box('#main .entity-candidate-section'),
                hub: box('#main .reference-manual-hub'),
                assisted: box('#main details.reference-assisted-tools'),
                standing: (document.querySelector('#main .reference-primary-hero') || {}).dataset?.primaryStanding || '',
            };
        }""")
        assert geometry["hero"] is not None, "1. the primary reference must be on the page"
        for key in ("candidates", "hub", "assisted"):
            assert geometry[key] is not None, f"1. {key} must still be reachable on the reference surface"
            assert geometry["hero"] < geometry[key], \
                f"1. the primary reference must sit ABOVE {key} on screen, got {geometry['hero']} vs {geometry[key]}"
        assert geometry["standing"] == "canon", \
            f"1. the surface must state the primary's standing from the receipt ledger, got {geometry['standing']!r}"
        findings.append("1. a reference opens on Primary reference; three peer stages and no `Choose & approve`; "
                        "the primary sits above the candidate grid, the upload hub and the assisted tools by "
                        f"real geometry ({int(geometry['hero'])}px vs {int(geometry['candidates'])}px)")

        # ---- 2. candidate review is contextual, and clickable, on the reference ---------
        candidates = page.evaluate("""() => ({
            section: document.querySelectorAll('#main .entity-candidate-section').length,
            cards: document.querySelectorAll('#main .entity-candidate-card').length,
            heading: (document.querySelector('#main .entity-candidate-section header span') || {}).textContent || '',
            names: (document.querySelector('#main .entity-candidate-section header small') || {}).textContent || '',
        })""")
        assert candidates["section"] == 1, \
            f"2. exactly one candidate surface must exist on the reference, got {candidates['section']}"
        assert candidates["cards"] >= 2, f"2. with its real candidate cards, got {candidates['cards']}"
        assert candidates["heading"] == "CANDIDATES FOR THIS CHARACTER REFERENCE", \
            f"2. the grid must name the kind of reference it belongs to, got {candidates['heading']!r}"
        assert "Nora Reframe" in candidates["names"], \
            f"2. and the reference itself, got {candidates['names']!r}"

        # The other two stages must offer no second home for the same decision.
        for label in ("What this production needs", "Details & history"):
            page.locator(".bounded-entity-taskbar .focused-task-button", has_text=label).click()
            page.wait_for_function(
                """(want) => { const n = document.querySelector('.bounded-entity-page'); return n && n.dataset.selectedTask === want; }""",
                arg="coverage" if label.startswith("What") else "details", timeout=10000)
            assert page.locator("#main .entity-candidate-section").count() == 0, \
                f"2. `{label}` must not offer a second home for candidate approval"
        findings.append("2. the candidate grid renders on the reference, names the character it belongs to, "
                        "carries its real cards, and exists on none of the other two stages")

        # ---- 3. what this production needs, with the boards behind a disclosure ---------
        page.locator(".bounded-entity-taskbar .focused-task-button", has_text="What this production needs").click()
        page.wait_for_selector("#main section.entity-demand", timeout=10000)

        demand = page.evaluate("""() => {
            const node = document.querySelector('#main section.entity-demand');
            const groups = [...document.querySelectorAll('#main .entity-demand-group')].map((g) => ({
                summary: (g.querySelector('summary') || {}).textContent || '', open: g.open,
                bodyHeight: (g.querySelector('.entity-demand-rows') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height,
            }));
            return {
                required: Number(node.dataset.demandRequired), missing: Number(node.dataset.demandMissing),
                recommended: Number(node.dataset.demandRecommended), notNeeded: Number(node.dataset.demandNotNeeded),
                groups,
                words: node.querySelector('header small').textContent,
            };
        }""")
        assert demand["required"] >= 1 and demand["recommended"] >= 1 and demand["notNeeded"] >= 1, \
            f"3. the fixture must exercise all three tiers, got {demand}"
        for word in ("Required", "Recommended", "Not currently needed"):
            assert word in demand["words"], f"3. the surface must speak in filmmaker language, missing {word!r}"
        assert demand["groups"], "3. the non-required material must be present in groups"
        for group in demand["groups"]:
            assert not group["open"], f"3. {group['summary']!r} must be collapsed rather than dumped"
            assert group["bodyHeight"] == 0, f"3. and must occupy no space until asked for, got {group['bodyHeight']}px"

        state = detail_open()
        assert state is not None, "3. the coverage detail must exist"
        assert state["open"] is False, "3. the angle / expression / continuity-state boards must ship closed"
        assert state["tabsVisible"] is False, \
            "3. and must occupy no space on screen until the filmmaker opens them"
        findings.append(f"3. `What this production needs` leads with {demand['required']} required / "
                        f"{demand['recommended']} recommended / {demand['notNeeded']} not currently needed in "
                        "filmmaker language; every non-required group and the coverage-detail boards are "
                        "collapsed to zero height")

        # ---- 4. the contextual continuity action, and the three it must refuse ----------
        derivable = generate_action("state-soot")
        assert derivable["present"], "4. a required state with an approved parent must offer the generate action"
        assert derivable["label"] == "Use approved Clean overall reference to generate Heavy soot", \
            f"4. and must name the ACTUAL recorded parent, got {derivable['label']!r}"

        for state_id, why, expect in [
            ("state-orphan", "records no parent at all", "Source not recorded"),
            ("state-dangling", "records a parent that does not exist", "Source not recorded"),
            ("state-unapproved", "records a parent that is not approved", "is not approved"),
        ]:
            answer = generate_action(state_id)
            assert answer["row"], f"4. the state that {why} must still be visible"
            assert not answer["present"], f"4. a state that {why} must not be offered a parent to derive from"
            assert expect in answer["status"], \
                f"4. and must say why it is blocked, got {answer['status']!r}"
            assert "Clean overall" not in answer["status"], \
                f"4. and must never name the default state as its parent — that is the guess"
        findings.append("4. `Use approved Clean overall reference to generate Heavy soot` is offered for the one "
                        "state whose parent is recorded AND approved; no parent, a dangling parent and an "
                        "unapproved parent each get their own explanation and none is offered the default state")

        # ---- 5. clicking the option writes nothing -------------------------------------
        # WHAT "WRITES NOTHING" MEANS HERE, stated precisely rather than as byte-identity.
        #
        # Clicking navigates to the state, which renders the state editor, which calls the
        # SHIPPED ensureEntityStateList() (app.js:2672) — and that materialises an empty
        # `assetPromptBuilds: []` on the state being edited. That normalisation predates
        # this slice, lives in a file this slice does not touch, and happens identically
        # when a filmmaker selects a state on the states board at the baseline.
        #
        # So this asserts the facts Section F actually names: lineage, authority,
        # generation mode, requirement and approval. A byte-identity assertion here would
        # be asserting app.js's normalisation policy, which is not this slice's to make.
        LINEAGE_SNAPSHOT = """() => JSON.stringify({
            lineage: P.characters[0].continuityStates.map((s) => [s.id, s.parentStateId || '', s.isDefault === true]),
            modes: P.characters[0].continuityStates.map((s) => s.generationMode || ''),
            approvals: P.characters[0].continuityStates.map((s) => s.approvedFile || ''),
            requirements: P.characters[0].continuityStates.map((s) => s.referenceRequirement || ''),
            primary: P.characters[0].approvedFile || '',
            receipts: P.productionAuthority.receipts.length,
        })"""
        before = page.evaluate(LINEAGE_SNAPSHOT)
        page.locator('.entity-demand-row[data-demand-id="state-soot"] button', has_text="Use approved").first.click()
        # WAIT FOR EACH REQUESTED THING IN TURN, so a failure names the step that broke
        # rather than timing out on a symptom three steps downstream. The selection is
        # written first, the disclosure opens because of it, and only then is the card a
        # thing a person could look at.
        page.wait_for_function(
            """(id) => localStorage.getItem(`cinebraid-bounded:${ACTIVE_PROJECT_SLUG}:selected:continuity-state:characters:${id}`) === 'state-soot'""",
            arg=ENTITY, timeout=10000)
        page.wait_for_function(
            """() => { const n = document.querySelector('.entity-coverage-detail'); return !!n && n.dataset.coverageDetailOpen === '1'; }""",
            timeout=10000)
        page.wait_for_selector('[data-continuity-state-id="state-soot"]', state="visible", timeout=10000)
        after = page.evaluate(LINEAGE_SNAPSHOT)
        assert after == before, \
            "5. opening the state workflow must write nothing — not a parent, not a generation mode, not an approval"
        assert page.evaluate("() => P.productionAuthority.receipts.length") == 1, \
            "5. and it must create no authority receipt"
        # AND THE SNAPSHOT IS NOT VACUOUS: prove it notices a real lineage write.
        page.evaluate("() => { P.characters[0].continuityStates.find((s) => s.id === 'state-orphan').parentStateId = 'state-default'; }")
        assert page.evaluate(LINEAGE_SNAPSHOT) != after, \
            "5. the lineage snapshot must be able to notice a parent write, or the assertion above proves nothing"
        findings.append("5. clicking the contextual generate action through the real event path navigates to the "
                        "state and changes no lineage, no generation mode, no requirement, no approval and adds "
                        "no receipt; the same snapshot does notice a deliberate parent write")

        # ---- 6. details, history and provenance survive under disclosure ----------------
        # OPENED FRESH, not navigated into. app.js applyRouteDisclosureState() restores
        # disclosure open-state across a SAME-ROUTE re-render and keys entries by position
        # among the details on the page — so switching stages inside one reference can
        # carry an `open` from the coverage boards onto whatever now sits at that index.
        # That behaviour predates this slice and is not this slice's to change; what this
        # section is about is what a filmmaker OPENS INTO, which is a route change.
        page.evaluate(
            """(id) => {
                localStorage.setItem(`cinebraid-focused:${ACTIVE_PROJECT_SLUG}:entity-task:characters:${id}`, 'details');
                localStorage.setItem(`cinebraid-bounded:${ACTIVE_PROJECT_SLUG}:selected:entity-detail-view:characters:${id}`, 'history');
                location.hash = '#/production';
            }""", ENTITY)
        page.wait_for_function("() => location.hash === '#/production'", timeout=10000)
        page.evaluate("() => route()")
        page.evaluate("(id) => { location.hash = '#/character/' + id; }", ENTITY)
        page.evaluate("() => route()")
        page.wait_for_function(
            """() => { const n = document.querySelector('.bounded-entity-page'); return n && n.dataset.selectedTask === 'details'; }""",
            timeout=10000)
        page.wait_for_selector("#main .entity-subworkspace", timeout=10000)
        provenance = page.evaluate("""() => {
            const node = [...document.querySelectorAll('#main details')]
                .find((d) => /Generation records/.test((d.querySelector('summary') || {}).textContent || ''));
            if (!node) return null;
            return { open: node.open, text: node.textContent.includes('a long compiled provenance prompt') };
        }""")
        assert provenance is not None, "6. generation provenance must remain available"
        assert provenance["text"], "6. including the exact prompt that made the approved file"
        assert provenance["open"] is False, "6. but it must no longer open by default"
        findings.append("6. generation provenance and its exact prompt are still present and reachable, inside a "
                        "disclosure that no longer opens by default")

        # ---- 7. no sideways scroll at two widths ---------------------------------------
        for width in (1600, 1280):
            page.set_viewport_size({"width": width, "height": 1000})
            page.locator(".bounded-entity-taskbar .focused-task-button", has_text="Primary reference").click()
            page.wait_for_selector("#main .reference-primary-hero", timeout=10000)
            overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert overflow <= 0, f"7. the reference page scrolls sideways at {width}px by {overflow}px"
        page.set_viewport_size({"width": 1600, "height": 1000})
        findings.append("7. no horizontal overflow at 1600px or 1280px with the reframed surfaces on screen")

        # ---- 7b. the recommended action's own helper line must be legible ---------------
        #
        # The Primary Reference hero renders its next action as a button carrying a label
        # AND a helper line. On the filled-accent branch the helper kept the generic
        # `--muted` grey, which is a muted colour for a PANEL, not for a cyan fill:
        # measured at 1.14:1 in Chromium, i.e. invisible. Only a browser can catch this —
        # the markup is correct, and Node has no cascade and no computed colour.
        #
        # Ratios are computed from RESOLVED colours against the nearest ancestor that
        # actually paints, so any later rule reaching this button is judged on what a
        # person really sees rather than on what the stylesheet says.
        CONTRAST = r"""
        () => {
          const button = document.querySelector('#main .reference-primary-actions button');
          if (!button) return null;
          const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const channel = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
          const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
          const painted = (node) => {
            for (let n = node; n; n = n.parentElement) {
              const bg = getComputedStyle(n).backgroundColor;
              const rgb = parse(bg);
              if (rgb.length === 3 && (bg.match(/[\d.]+/g) || [])[3] !== '0') return rgb;
            }
            return [0, 0, 0];
          };
          const ratio = (fg, bg) => {
            const a = luminance(fg), b = luminance(bg);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          const background = painted(button);
          const read = (selector) => {
            const node = button.querySelector(selector);
            if (!node) return null;
            return { text: node.textContent.trim(),
                     ratio: Math.round(ratio(parse(getComputedStyle(node).color), background) * 100) / 100 };
          };
          return { label: read('span'), hint: read('small'),
                   filled: button.classList.contains('approve-btn'),
                   standing: (document.querySelector('#main .reference-primary-hero') || {}).dataset?.primaryStanding || '' };
        }
        """

        def primary_cta():
            page.locator(".bounded-entity-taskbar .focused-task-button", has_text="Primary reference").click()
            page.wait_for_selector("#main .reference-primary-hero", timeout=10000)
            return page.evaluate(CONTRAST)

        # 4.5:1 is the ordinary body-text bar. The helper is small text carrying real
        # instruction, not decoration, so it is held to that rather than to the
        # large-text exemption.
        def assert_legible(where, cta):
            assert cta and cta["hint"], f"7b. {where}: the action must still carry its helper line"
            assert cta["hint"]["ratio"] >= 4.5, (
                f"7b. {where}: the helper line {cta['hint']['text']!r} renders at "
                f"{cta['hint']['ratio']}:1 against what it sits on")
            assert cta["label"]["ratio"] >= 4.5, (
                f"7b. {where}: the label {cta['label']['text']!r} renders at {cta['label']['ratio']}:1")

        canon_cta = primary_cta()
        assert canon_cta["standing"] == "canon", \
            f"7b. precondition: the fixture's primary is approved, got {canon_cta['standing']!r}"
        assert not canon_cta["filled"], "7b. precondition: an approved primary offers the quiet variant"
        assert_legible("approved primary", canon_cta)

        # AND THE BRANCH THE DEFECT LIVED ON. The filled variant only appears when the
        # primary is a raw pointer, so the surface is put into that real state rather than
        # a synthesised one: the receipt is withdrawn, which is exactly what makes a
        # pointer historic, and put back immediately afterwards.
        page.evaluate("() => { window.__reframeReceipts = P.productionAuthority.receipts; "
                      "P.productionAuthority = { ...P.productionAuthority, receipts: [] }; route(); }")
        page.wait_for_timeout(400)
        historic_cta = primary_cta()
        assert historic_cta["standing"] == "historic", \
            f"7b. precondition: withdrawing the receipt must make the pointer historic, got {historic_cta['standing']!r}"
        assert historic_cta["filled"], "7b. precondition: an unapproved primary must offer the filled recommended action"
        assert_legible("unapproved primary", historic_cta)

        page.evaluate("() => { P.productionAuthority = { ...P.productionAuthority, "
                      "receipts: window.__reframeReceipts }; delete window.__reframeReceipts; route(); }")
        page.wait_for_timeout(400)
        restored = primary_cta()
        assert restored["standing"] == "canon", \
            f"7b. the receipt must be back where it was, got {restored['standing']!r}"
        findings.append(f"7b. the Primary Reference action is legible on both branches: approved "
                        f"{canon_cta['label']['ratio']}:1 / {canon_cta['hint']['ratio']}:1, and the filled "
                        f"recommended action an unapproved primary offers "
                        f"{historic_cta['label']['ratio']}:1 / {historic_cta['hint']['ratio']}:1")

        # ---- 7c. the header names the fact its control carries --------------------------
        #
        # THE COLLISION THIS PREVENTS. The reference header's lifecycle control is a
        # <select> whose value is a WORKFLOW state. Unlabelled, it read as a bare verdict
        # about the reference -- "SIGNED OFF" -- sitting directly above the Primary
        # Reference band reading "NOT APPROVED" about something else entirely: the canon
        # standing of an image. Two true statements about two different facts, one of
        # which looked like a denial of the other.
        #
        # The fix is that the header names its fact, in the SAME word the inspector uses,
        # so the assertion is that the two surfaces agree rather than that either one
        # says a particular string.
        header = page.evaluate(r"""() => {
            const select = document.querySelector('#main .workflow-select');
            if (!select) return null;
            const id = select.getAttribute('id');
            const label = id ? document.querySelector(`label[for="${id}"]`) : null;
            const inspector = [...document.querySelectorAll('.focused-inspector-facts article')]
                .map((a) => ({ label: (a.querySelector('span') || {}).textContent || '',
                               value: (a.querySelector('b') || {}).textContent || '' }));
            return {
                labelText: label ? label.textContent.trim() : null,
                labelVisible: label ? label.getBoundingClientRect().width > 0 : false,
                selected: select.options[select.selectedIndex].text.trim(),
                storedValue: select.value,
                inspector,
            };
        }""")
        assert header, "7c. the reference header must still carry its workflow control"
        assert header["labelText"], "7c. the lifecycle control must be labelled, not a bare verdict"
        assert header["labelVisible"], "7c. and the label must be visible, not only an accessible name"
        review = next((row for row in header["inspector"]
                       if row["label"].strip().lower() == header["labelText"].strip().lower()), None)
        assert review, (
            f"7c. the header labels this fact {header['labelText']!r}, which names no field in the "
            f"inspector: {[row['label'] for row in header['inspector']]}")
        assert review["value"].strip().lower() == header["selected"].strip().lower(), (
            f"7c. the header and the inspector must state the same value for the same fact: "
            f"{header['selected']!r} vs {review['value']!r}")
        # AND THE STORED TOKEN IS UNTOUCHED. The whole contract is that only the word a
        # person reads changed; a suite that let the option VALUE drift would have missed
        # the one thing that would have been a data change.
        #
        # Asserted against the LABEL FUNCTION rather than against this fixture's current
        # state. The header only offers APPROVED once a reference has reached it, so a
        # DRAFT fixture cannot show the one mapping that matters -- and "DRAFT" vs "Draft"
        # differs only in case, so a same-fixture comparison would pass on a build that
        # had never renamed anything.
        vocabulary = page.evaluate(r"""() => {
            const select = document.querySelector('#main .workflow-select');
            const options = [...select.options].map((o) => ({ value: o.value, text: o.text.trim() }));
            return {
                options,
                /* Every rendered option must be the label function's answer, so no surface
                   can quietly go back to printing the raw token. */
                mismatched: options.filter((o) => o.text !== workflowStatusLabel(o.value)),
                approvedLabel: workflowStatusLabel("APPROVED"),
                states: (typeof WORKFLOW_STATES !== "undefined") ? WORKFLOW_STATES.slice() : null,
            };
        }""")
        assert not vocabulary["mismatched"], (
            f"7c. every option must read the label function's answer, these do not: {vocabulary['mismatched']}")
        assert vocabulary["states"] == ["DRAFT", "IN PROGRESS", "READY FOR REVIEW",
                                        "CHANGES REQUESTED", "APPROVED"], (
            f"7c. the STORED vocabulary must be untouched, got {vocabulary['states']}")
        for option in vocabulary["options"]:
            assert option["value"] in vocabulary["states"], (
                f"7c. an option value drifted off the stored vocabulary: {option}")
        # THE MAPPING THE WHOLE CONTRACT EXISTS FOR: the lifecycle token that collides
        # with image approval must not be READ as the word "approved".
        assert vocabulary["approvedLabel"].strip().lower() != "approved", (
            f"7c. the lifecycle token APPROVED must not be read back as {vocabulary['approvedLabel']!r} -- "
            "that is the collision with canon approval this contract exists to prevent")
        assert header["storedValue"] in vocabulary["states"], (
            f"7c. the stored workflow token must remain the shipped vocabulary, got {header['storedValue']!r}")
        findings.append(f"7c. the header labels its lifecycle control {header['labelText']!r} and reads "
                        f"{header['selected']!r}, the same fact and the same word as the inspector; every option "
                        f"matches the label function, the stored vocabulary is unchanged, and APPROVED reads back "
                        f"as {vocabulary['approvedLabel']!r} rather than 'approved'")

        # ---- 8. TYPED IDENTITY, the exact Codex collision, in a real browser -----------
        #
        # An entity id is not an entity identity. A project may legitimately hold the
        # same id in more than one collection, and the reproduced defect was that
        # entityProductionUse() matched dependency rows on the raw id: a shot that
        # referenced only the CHARACTER made the PROP of the same id headline
        # "Used by 1 shot in this production" on its own default Reference surface.
        #
        # This drives the shipped surfaces, one route per collection, and reads the
        # sentence a filmmaker actually sees.
        COLLIDE = "X-COLLIDE"

        def collide_project(shot_spec, collections=("characters", "locations", "props", "vehicles")):
            names = {"characters": "Colliding character", "locations": "Colliding location",
                     "props": "Colliding prop", "vehicles": "Colliding vehicle"}
            payload = {"collections": {}, "shot": shot_spec, "id": COLLIDE}
            for key in ("characters", "locations", "props", "vehicles"):
                payload["collections"][key] = ([{
                    "id": COLLIDE, "name": names[key],
                    "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True}],
                }] if key in collections else [])
            return payload

        def install_collision(payload):
            page.evaluate(
                """(payload) => {
                    for (const [list, rows] of Object.entries(payload.collections)) P[list] = rows;
                    P.productionAuthority = { version: 1, receipts: [] };
                    const base = (P.shots || [])[0] || {};
                    P.shots = [{ ...base, id: 'X1-01', codes: [], audio: payload.shot.audio || {}, clips: [],
                                 characters: payload.shot.characters || [],
                                 creationBrief: { locationId: payload.shot.location || '',
                                                  propIds: payload.shot.propIds || [],
                                                  vehicleIds: payload.shot.vehicleIds || [] } }];
                    SCAN.anchors = []; SCAN.plates = []; SCAN.props = []; SCAN.vehicles = [];
                }""", payload)

        def usage_sentence(route, entity_id):
            """The line the Primary Reference surface prints, read off the rendered page."""
            page.evaluate("(hash) => { location.hash = hash; }", f"#/{route}/{entity_id}")
            page.evaluate("() => route()")
            page.wait_for_selector("#main .reference-primary-hero", timeout=15000)
            return page.evaluate(
                """() => { const n = document.querySelector('#main .reference-primary-usage'); return n ? n.textContent.trim() : ''; }""")

        # 8a — THE REPRODUCED CASE: only the character is referenced.
        install_collision(collide_project({"characters": [COLLIDE]}))
        character_line = usage_sentence("character", COLLIDE)
        prop_line = usage_sentence("prop", COLLIDE)
        location_line = usage_sentence("location", COLLIDE)
        vehicle_line = usage_sentence("vehicle", COLLIDE)
        assert character_line == "Used by 1 shot in this production.", \
            f"8a: the referenced character must state its real usage, got {character_line!r}"
        for label, line in (("prop", prop_line), ("location", location_line), ("vehicle", vehicle_line)):
            assert "Used by" not in line, \
                f"8a: the {label} sharing that id must not claim the character's shot, got {line!r}"
            assert line == f"No shot references this {label} yet.", \
                f"8a: and must say so in its own words, got {line!r}"

        # 8b — A SECOND CROSS-TYPE COLLISION, in the other direction: only the prop is
        # referenced, and the character of the same id must now be the one at zero.
        install_collision(collide_project({"propIds": [COLLIDE]}))
        assert usage_sentence("prop", COLLIDE) == "Used by 1 shot in this production.", \
            "8b: the referenced prop must state its usage"
        assert usage_sentence("character", COLLIDE) == "No shot references this character yet.", \
            "8b: and the character of the same id must report zero"
        assert usage_sentence("location", COLLIDE) == "No shot references this location yet.", \
            "8b: as must the location"

        # 8c — BOTH HALVES OF THE IDENTITY. A different character of the SAME type must
        # also stay at zero, or the fix would be matching on the type alone.
        install_collision(collide_project({"characters": [COLLIDE]}, collections=("characters",)))
        page.evaluate(
            """(id) => { P.characters.push({ id: 'Y-OTHER', name: 'Unreferenced character',
                 continuityStates: [{ id: 'state-default', name: 'Default', isDefault: true }] }); void id; }""",
            COLLIDE)
        assert usage_sentence("character", COLLIDE) == "Used by 1 shot in this production.", \
            "8c: the referenced character still states its usage"
        assert usage_sentence("character", "Y-OTHER") == "No shot references this character yet.", \
            "8c: and a different character of the same type must report zero"

        findings.append("8. typed identity in Chromium: with X-COLLIDE present as a character, location, prop and "
                        "vehicle, a shot referencing only the character leaves the other three surfaces reading "
                        "\"No shot references this <kind> yet.\"; referencing only the prop reverses it; and a "
                        "second character of the same type stays at zero, so both halves of the identity hold")

        # Back to the reframe fixture for the controls below.
        install()

        # ---- N1. the generate action CAN appear, so its absence means something ---------
        # Same detector, same renderer, a project in which the orphan legitimately has an
        # approved parent. If this did not appear, section 4's absences would be proving
        # nothing but that the element never exists.
        repaired = json.loads(json.dumps(CHARACTER))
        for state in repaired["continuityStates"]:
            if state["id"] == "state-orphan":
                state["parentStateId"] = "state-default"
        install(repaired)
        page.locator(".bounded-entity-taskbar .focused-task-button", has_text="What this production needs").click()
        page.wait_for_selector("#main section.entity-demand", timeout=10000)
        repaired_answer = generate_action("state-orphan")
        assert repaired_answer["present"], \
            "N1: with a recorded, approved parent the generate action MUST appear — section 4's absences are vacuous otherwise"
        assert repaired_answer["label"] == "Use approved Clean overall reference to generate Torn sleeve", \
            f"N1: and must name that parent, got {repaired_answer['label']!r}"
        findings.append("N1. the same detector reports the action PRESENT once the orphan records an approved "
                        "parent, so its absence in section 4 is a measurement rather than a missing element")

        # ---- N2. the disclosure CAN open, so "closed" means something -------------------
        install()
        page.evaluate("""() => {
            localStorage.setItem(`cinebraid-bounded:${ACTIVE_PROJECT_SLUG}:selected:entity-coverage-view:characters:%s`, 'states');
        }""" % ENTITY)
        page.locator(".bounded-entity-taskbar .focused-task-button", has_text="What this production needs").click()
        opened = detail_open()
        assert opened["open"] is True, \
            "N2: an explicitly selected sub-view MUST open the coverage detail — section 3's `closed` is vacuous otherwise"
        assert opened["tabsVisible"] is True, "N2: and its boards must then occupy real space"
        findings.append("N2. the same detector reports the coverage detail OPEN once a sub-view is explicitly "
                        "selected, which is also the Slice 1 hand-off path — so section 3's `closed` is a "
                        "measurement, and a completed state run never lands on a shut door")

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
