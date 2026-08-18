#!/usr/bin/env python3
"""Batch 2, Slice 2 — PROJECT ENTRY & IMPORT LANDING, read off a real Chromium.

WHY A BROWSER IS NEEDED AT ALL. tests/project-entry.js proves everything semantic about
this slice in Node: the three intents, the standing projection, the planning-marker
boundary against the real server, and that the landing renders the one next-action
renderer. Four claims cannot be proven there, and they are the four a filmmaker would
actually notice:

  * TYPING INTO THE BOX REALLY IS RETAINED. The defect was destruction by re-render:
    a genuine keystroke sequence, a genuine click on another intent, a genuine click
    back. The Node harness never parses rendered markup into live elements, so its
    textarea keeps its value across a re-render no matter what the product does — it
    cannot reproduce the defect and it cannot prove the fix.
  * THE CHOOSER IS REALLY THREE REACHABLE CONTROLS, clicked rather than called.
  * A REAL IMPORT REALLY LANDS somewhere other than the chooser, through the shipped
    validate -> review -> commit buttons and the shipped project reload.
  * THE MARKER REALLY IS ABSENT FROM THE PROJECT THE BROWSER THEN HOLDS, which is the
    document every editor on every other screen is bound to.
  * A GENUINELY IN-FLIGHT FILE READ KEEPS THE INTENT THAT STARTED IT. This is the one
    claim that cannot be made anywhere else at all: a real multi-megabyte file, read by
    a real FileReader, with a real intent switch happening while the bytes are still
    being decoded. The Node suite can only hold a stub read open.
  * THE LANDING FOLLOWS THE AUTHORITY IN A LIVE DOCUMENT, including when that authority
    names nothing - the case in which a locally chosen fallback would appear.
  * THE REVIEW KEEPS "WHO SAID IT" STRAIGHT in rendered columns, classes and labels.
  * AN ASYNC VALIDATION OR IMPORT KEEPS THE INTENT THAT STARTED IT, across a real HTTP
    round trip held open by the route guard, with the in-flight state asserted at the
    moment of the switch so none of it can pass vacuously.

IT CARRIES ITS OWN NEGATIVE CONTROLS, because a retention assertion that cannot fail is
worth nothing:

  N1 stubs the draft reader empty — the pre-slice behaviour, exactly — and requires the
     retention assertion to catch it.
  N2 puts the chooser back above the landing and requires the landing assertion to
     catch it.

NOTHING HERE IS PAID AND NOTHING LEAVES THE MACHINE. Config and projects live in a
temporary directory reached through CINEBRAID_CONFIG_PATH and CINEBRAID_PROJECTS_ROOT, so
data/ and the shipped sample are never touched; the route guard aborts the paid route and
anything off-loopback.
"""

import json, os, pathlib, socket, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_runtime import require_browser, launch_chromium

LABEL = "Project entry real-browser audit"
sync_playwright = require_browser(LABEL)

PAID_ROUTE = "/api/generation/fal/jobs"

page_errors, offsite, paid_calls = [], [], []
findings = []

# Typed by hand into the CineBraid-import box. Quotes and braces on purpose: the value
# is escaped on its way back into the textarea, so a fix that forgot to escape would
# corrupt exactly this string.
PASTED = '{"meta":{"title":"Two hours of work"},"scenes":[],"note":"a & b <c>"}'
SCRIPT = "INT. DOCK - NIGHT\nAda walks the length of the dock, coat heavy with rain."

# The import CineBraid is asked to structure. Every omission here provokes one of the
# planning inferences that used to be written into creative prose: no continuity state
# on the location, no tier on the scene, no keyframes and no duration on the shot.
IMPORT_SOURCE = {
    "meta": {"title": "Landing Audit", "format": "Short film"},
    "characters": [{
        "id": "CHAR-ADA", "name": "Ada", "description": "A dock engineer in a patched grey coat.",
        "continuityStates": [{"id": "state-clean", "name": "Clean coat",
                              "notes": "The coat is dry and the collar sits flat."}],
    }],
    "locations": [{"id": "LOC-DOCK", "name": "Dock",
                   "description": "A wet concrete dock under sodium light.", "continuityStates": []}],
    "props": [], "vehicles": [],
    "scenes": [{"id": "SC-01", "title": "Arrival", "whatHappens": "Ada walks the dock.",
                "howItFeels": "Cold and procedural."}],
    "shots": [{"id": "L1-01", "scene": "SC-01", "title": "Dock walk",
               "desc": "Ada walks the length of the dock.", "positioning": "Locked wide composition.",
               "characters": ["CHAR-ADA"], "codes": ["LOC-DOCK"],
               "notes": "Shoot this before the tide turns.",
               "clips": [{"kind": "i2v", "dur": 6, "motionPrompt": "She walks."}]}],
}

# Two authored markers and one field CineBraid will also decide about, so section 9
# can prove the review keeps "who said it" straight.
ORIGIN_SOURCE = {
    "meta": {"title": "Origin Matrix", "format": "Short film"},
    "characters": [{
        "id": "CHAR-ADA", "name": "Ada", "description": "A dock engineer in a patched grey coat.",
        "continuityStates": [
            {"id": "state-clean", "name": "Clean coat",
             "notes": "[INFERRED FOR PLANNING] my own note about the convention."},
            {"id": "state-wet", "name": "Wet coat", "parentStateId": "state-clean",
             "notes": "house style: [inferred for planning] then a reason"},
        ],
    }],
    "locations": [{"id": "LOC-DOCK", "name": "Dock", "description": "A wet concrete dock.", "continuityStates": []}],
    "props": [], "vehicles": [],
    "scenes": [{"id": "SC-01", "title": "Arrival", "whatHappens": "Ada walks the dock.", "howItFeels": "Cold."}],
    "shots": [{"id": "L1-01", "scene": "SC-01", "title": "Dock walk", "desc": "Ada walks the dock.",
               "positioning": "Locked wide.", "characters": ["CHAR-ADA"], "codes": ["LOC-DOCK"],
               "clips": [{"kind": "i2v", "dur": 6, "motionPrompt": "She walks."}]}],
}

# Section 10 holds the import routes open by delaying RESOLUTION inside the page, so
# the product's own `await fetch(...)` is genuinely suspended while the filmmaker
# switches intents. A sleep in the Playwright route handler cannot be used: the sync
# driver serialises on it, so the response would always be delivered before the click
# it is supposed to race.
IMPORT_DELAY_HOOK = (
    "() => {"
    "  if (window.__importDelayInstalled) return;"
    "  window.__importDelayInstalled = true;"
    "  window.__importDelayMs = 0;"
    "  const real = window.fetch;"
    "  window.fetch = async (input, init) => {"
    "    const url = String(input && input.url ? input.url : input);"
    "    const response = await real(input, init);"
    r"    if (window.__importDelayMs && /\/api\/projects\/(preview-)?import-json/.test(url))"
    "      await new Promise((r) => setTimeout(r, window.__importDelayMs));"
    "    return response;"
    "  };"
    "}"
)

MARKER_SCAN = """
() => {
  const hits = [];
  const walk = (value, at) => {
    if (typeof value === 'string') { if (/\\[INFERRED FOR PLANNING\\]/i.test(value)) hits.push(at); }
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}[${index}]`));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, at ? `${at}.${key}` : key));
  };
  walk(P, '');
  return hits;
}
"""


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-project-entry-"))
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

        # Installed on the CONTEXT, before a page exists, so nothing can escape through
        # a navigation that begins before a page-level route is armed.
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(f"{base}/#/create", wait_until="domcontentloaded")
        page.wait_for_selector(".creation-start-choice", timeout=20000)
        assert not page_errors, f"the create screen raised uncaught errors: {page_errors}"

        # ---- 1. three reachable intents, in the frozen order ----------------------------
        chooser = page.evaluate("""() => [...document.querySelectorAll('.creation-path-buttons button')].map((b) => ({
            intent: b.dataset.creationIntent,
            title: (b.querySelector('b') || {}).textContent || '',
            recommended: !!b.querySelector('.creation-path-recommended'),
            pressed: b.getAttribute('aria-pressed'),
            clickable: b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0,
        }))""")
        assert [row["intent"] for row in chooser] == ["assisted", "cinebraid", "scratch"], \
            f"1. the entry must offer the three frozen intents in order, got {chooser}"
        assert [row["title"] for row in chooser] == [
            "Build from a script/story with AI", "Import a CineBraid project", "Start from scratch"], \
            f"1. with the frozen words, got {[row['title'] for row in chooser]}"
        assert [row["recommended"] for row in chooser] == [True, False, False], \
            "1. exactly the assisted path is marked Recommended"
        assert all(row["clickable"] for row in chooser), "1. all three must actually be on screen"
        assert sum(1 for row in chooser if row["pressed"] == "true") == 1, \
            "1. exactly one intent is announced as selected"
        assert page.locator("text=Import with an LLM").count() == 0, \
            "1. the retired LLM framing must not be anywhere on this screen"
        findings.append("1. the chooser offers three clickable intents in the frozen order, only the assisted one "
                        "marked Recommended, and the retired 'Import with an LLM' label is gone")

        # ---- 2. typed material survives switching intents -------------------------------
        # THE DEFECT, RUN FORWARDS. Before this slice, clicking another intent rebuilt
        # #main and the box came back empty.
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        page.click("#project-builder-json")
        page.type("#project-builder-json", PASTED)
        assert page.input_value("#project-builder-json") == PASTED, "2. precondition: the text was really typed"

        page.click('[data-creation-intent="assisted"]')
        page.wait_for_selector("#creation-source-material", timeout=10000)
        page.click("#creation-source-material")
        page.type("#creation-source-material", SCRIPT)
        # The two intents must not share one buffer.
        assert page.input_value("#project-builder-json") == "", \
            "2. the assistant-output box starts empty on its own path — the two intents keep separate material"

        page.click('[data-creation-intent="scratch"]')
        page.wait_for_selector("#creation-scratch", timeout=10000)
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        recovered = page.input_value("#project-builder-json")
        assert recovered == PASTED, \
            f"2. switching away and back must return the pasted document byte for byte, got {recovered!r}"

        page.click('[data-creation-intent="assisted"]')
        page.wait_for_selector("#creation-source-material", timeout=10000)
        recovered_script = page.input_value("#creation-source-material")
        assert recovered_script == SCRIPT, \
            f"2. and the script the filmmaker was writing, got {recovered_script!r}"
        findings.append("2. a typed CineBraid document and a typed script both survive two intent switches, "
                        "byte for byte, and neither leaks into the other's field")

        # ---- N1. the retention assertion can fail ---------------------------------------
        n1 = page.evaluate("""() => {
            const real = window.creationDraft;
            /* The pre-slice behaviour, exactly: the re-render does not consult the buffer. */
            window.creationDraft = () => '';
            window.setCreationStartPath('cinebraid');
            return new Promise((resolve) => setTimeout(() => {
              const box = document.getElementById('project-builder-json');
              const dropped = box ? box.value : 'NO BOX';
              window.creationDraft = real;
              window.setCreationStartPath('cinebraid');
              setTimeout(() => {
                const restored = document.getElementById('project-builder-json');
                resolve({ dropped, restored: restored ? restored.value : 'NO BOX' });
              }, 250);
            }, 250));
        }""")
        assert n1["dropped"] == "", \
            f"N1. the break must land — a chooser that ignores the buffer must render an empty box, got {n1['dropped']!r}"
        assert n1["restored"] == PASTED, \
            f"N1. and restoring the reader must restore the document, got {n1['restored']!r}"
        findings.append("N1. stubbing the draft reader empty reproduces the pre-slice destruction and the retention "
                        "assertion catches it; restoring the reader restores the pasted document")

        # ---- 3. the review step states the standing -------------------------------------
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        page.fill("#project-builder-json", json.dumps(IMPORT_SOURCE))
        page.click("#creation-cinebraid button.assemble-btn")
        page.wait_for_selector(".project-builder-review", timeout=25000)
        review_standing = page.evaluate("""() => {
            const node = document.querySelector('.project-builder-review [data-entry-standing]');
            return node ? { key: node.dataset.entryStanding, label: (node.querySelector('b') || {}).textContent } : null;
        }""")
        assert review_standing and review_standing["key"] in ("ready", "needs-review", "blocked"), \
            f"3. the review step must state the standing in the three user-facing words, got {review_standing}"
        assert review_standing["label"] in ("Ready", "Needs review", "Blocked"), \
            f"3. in exactly those words, got {review_standing}"
        findings.append(f"3. the review step states the project standing as \"{review_standing['label']}\" before the "
                        f"filmmaker is asked to press Import")

        # ---- 4. a successful import lands on next steps, not on the chooser --------------
        page.click(".creation-next-step button.assemble-btn")
        page.wait_for_selector("[data-project-entry-landing]", timeout=30000)
        landing = page.evaluate("""() => ({
            hash: location.hash,
            slug: (typeof ACTIVE_PROJECT_SLUG !== 'undefined' && ACTIVE_PROJECT_SLUG) || '',
            title: (document.querySelector('.view-title') || {}).textContent || '',
            choosers: document.querySelectorAll('.creation-start-choice').length,
            intentButtons: document.querySelectorAll('[data-creation-intent]').length,
            standing: (document.querySelector('[data-entry-standing]') || {}).dataset?.entryStanding || '',
            standingLabel: (document.querySelector('[data-entry-standing] b') || {}).textContent || '',
            counts: [...document.querySelectorAll('.project-entry-landing .creation-metrics div')].map((n) => n.textContent),
            recommendedKind: (document.querySelector('[data-recommended-kind]') || {}).dataset?.recommendedKind || '',
            recommendedLabel: (document.querySelector('[data-recommended-kind] button, [data-recommended-kind] a') || {}).textContent || '',
            blocks: [...document.querySelectorAll('.project-entry-landing-block > .creation-kicker')].map((n) => n.textContent),
        })""")
        assert landing["choosers"] == 0 and landing["intentButtons"] == 0, \
            f"4. a successful import must not return the filmmaker to the chooser, found {landing}"
        assert landing["title"] == "Landing Audit", \
            f"4. the landing must name the project it created, got {landing['title']!r}"
        assert landing["slug"] and landing["slug"] != "sample", \
            f"4. and the imported project must be the open one, got {landing['slug']!r}"
        assert landing["blocks"] == ["WHAT WAS CREATED", "DOES ANYTHING NEED REVIEW?", "WHAT TO DO NEXT"], \
            f"4. the landing must answer the three questions in order, got {landing['blocks']}"
        assert any("scenes" in row for row in landing["counts"]) and any("shots" in row for row in landing["counts"]), \
            f"4. it must say what was created, got {landing['counts']}"
        assert landing["standingLabel"] in ("Ready", "Needs review", "Blocked"), \
            f"4. and whether anything needs review, got {landing['standingLabel']!r}"
        findings.append(f"4. the import landed on the created state for \"{landing['title']}\" ({landing['slug']}) with "
                        f"zero chooser controls, counts {landing['counts']}, and standing \"{landing['standingLabel']}\"")

        # ---- 5. the next action is the one authority ------------------------------------
        # Read the authority directly and require the rendered card to be its answer.
        authority = page.evaluate("() => { const n = projectNextProductionAction(); return n ? { kind: n.kind, title: n.title, actionLabel: n.actionLabel, href: n.href } : null; }")
        assert authority, "5. readiness must produce a next action for the imported project"
        assert landing["recommendedKind"] == authority["kind"], \
            f"5. the landing's card must carry projectNextProductionAction()'s kind, got {landing['recommendedKind']!r} vs {authority['kind']!r}"
        assert authority["actionLabel"] in landing["recommendedLabel"], \
            f"5. and its action label, got {landing['recommendedLabel']!r} vs {authority['actionLabel']!r}"
        rendered_matches = page.evaluate("""() => {
            const card = document.querySelector('[data-recommended-kind]');
            return card ? card.outerHTML === creationRecommendedActionMarkup() : false;
        }""")
        assert rendered_matches, \
            "5. the landing's card must be creationRecommendedActionMarkup() itself — the single renderer over the single derivation"
        findings.append(f"5. the landing's next action is projectNextProductionAction() rendered through "
                        f"creationRecommendedActionMarkup(): kind \"{authority['kind']}\", label \"{authority['actionLabel']}\"")

        # ---- N2. the no-chooser assertion can fail --------------------------------------
        n2 = page.evaluate("""() => {
            const main = document.getElementById('main');
            const probe = document.createElement('div');
            probe.dataset.entryProbe = '1';
            probe.innerHTML = creationStartChooser();
            main.insertBefore(probe, main.firstChild);
            const seen = { choosers: document.querySelectorAll('.creation-start-choice').length,
                           intents: document.querySelectorAll('[data-creation-intent]').length };
            probe.remove();
            return { seen, after: document.querySelectorAll('.creation-start-choice').length };
        }""")
        assert n2["seen"]["choosers"] == 1 and n2["seen"]["intents"] == 3, \
            f"N2. the break must land — putting the chooser back must be visible to the assertion, got {n2}"
        assert n2["after"] == 0, "N2. and the probe must leave nothing behind"
        findings.append("N2. re-adding the chooser above the landing is seen by the same assertion that reported zero, "
                        "so section 4 is capable of failing")

        # ---- 6. the project the browser now holds carries no planning marker -------------
        marker_hits = page.evaluate(MARKER_SCAN)
        assert marker_hits == [], \
            f"6. the imported project must contain no planning annotation, found {marker_hits}"
        prose = page.evaluate("""() => ({
            stateDelta: P.characters[0].continuityStates.find((s) => s.id === 'state-clean').notes,
            shotNote: P.shots[0].notes,
            beat: P.scenes[0].whatHappens,
        })""")
        assert prose["stateDelta"] == "The coat is dry and the collar sits flat.", \
            f"6. the state delta the filmmaker wrote must be exactly what it was, got {prose['stateDelta']!r}"
        assert prose["shotNote"] == "Shoot this before the tide turns.", \
            f"6. and a shot note CineBraid appended to must keep the human sentence, got {prose['shotNote']!r}"
        assert prose["beat"] == "Ada walks the dock.", f"6. and the scene beat, got {prose['beat']!r}"
        # The state-delta editor is where the marker used to be read back as authored text.
        page.goto(f"{base}/#/character/CHAR-ADA", wait_until="domcontentloaded")
        page.wait_for_timeout(700)
        editor_text = page.evaluate("""() => [...document.querySelectorAll('#main textarea')].map((n) => n.value).join('\\n')""")
        assert "[INFERRED FOR PLANNING]" not in editor_text, \
            "6. and no editable field on the reference workspace may show CineBraid's planning annotation as authored text"
        findings.append("6. the imported project holds zero planning annotations, every authored sentence survived "
                        "byte for byte, and no editable field on the reference workspace shows one")

        # Section 4 left a landing in place, and a landing is what #/create renders while
        # one exists. Dismissing it through the shipped control is also a check that the
        # control works.
        page.goto(f"{base}/#/create", wait_until="domcontentloaded")
        page.wait_for_selector("[data-project-entry-landing]", timeout=20000)
        page.evaluate("() => dismissProjectEntryLanding()")
        page.wait_for_selector(".creation-start-choice", timeout=20000)
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        findings.append("6b. 'Start another project' dismisses the landing and returns the chooser")

        # ---- 7. an in-flight file read belongs to the intent that started it ------------
        # 7a. THE REAL INPUT ELEMENT, with a real 16 MiB file on disk, chosen the way a
        # filmmaker chooses one. This proves the shipped wiring; 7b then proves the
        # ownership rule across a read that is provably still running.
        big_path = sandbox / "big-project.json"
        filler = "x" * (1 << 20)
        big_path.write_text('{"meta":{"title":"Sixteen Mebibytes"},"filler":"' + filler * 16 + '"}', encoding="utf-8")
        big_size = big_path.stat().st_size
        page.evaluate("() => { setCreationDraft('cinebraid:json', ''); setCreationDraft('assisted:json', ''); }")
        page.set_input_files("#project-builder-file", str(big_path))
        page.wait_for_function("() => creationDraft('cinebraid:json').length > 0", timeout=30000)
        chosen = page.evaluate("() => ({ cine: creationDraft('cinebraid:json').length, visible: (document.getElementById('project-builder-json') || {}).value.length })")
        assert chosen["cine"] == big_size, f"7a. the chosen file must reach its buffer, got {chosen['cine']} of {big_size}"
        assert chosen["visible"] == big_size, "7a. and the box the filmmaker is looking at, because they are still on that intent"
        findings.append(f"7a. a real {big_size}-byte file chosen through the shipped input reaches cinebraid:json and the visible box")

        # 7b. THE OWNERSHIP RULE, ACROSS A READ THAT IS PROVABLY STILL RUNNING.
        # The read is started and the intent switched inside ONE synchronous task, so the
        # FileReader cannot possibly have finished: the assertion below states that as a
        # measured fact rather than hoping for it. The bytes and the reader are real - a
        # real File of real length decoded by the browser's own FileReader.
        OWNERSHIP = (
            "async () => {"
            "  setCreationDraft('cinebraid:json', ''); setCreationDraft('assisted:json', '');"
            "  const bytes = 'y'.repeat(1 << 24);"
            "  const file = new File([bytes], 'owned.json', { type: 'application/json' });"
            "  readProjectBuilderFile({ files: [file] });"
            "  setCreationStartPath('assisted');"
            "  const atSwitch = { cine: creationDraft('cinebraid:json').length, assisted: creationDraft('assisted:json').length };"
            "  await new Promise((r) => setTimeout(r, 60));"
            "  return { size: file.size, atSwitch };"
            "}"
        )
        ownership = page.evaluate(OWNERSHIP)
        assert ownership["atSwitch"] == {"cine": 0, "assisted": 0}, \
            f"7b. the read must still be in flight when the intent changes, got {ownership['atSwitch']}"
        page.wait_for_selector("#creation-assisted", timeout=10000)
        page.wait_for_function("() => creationDraft('cinebraid:json').length > 0", timeout=30000)
        delivered = page.evaluate("() => ({ cine: creationDraft('cinebraid:json').length, assisted: creationDraft('assisted:json').length, visible: (document.getElementById('project-builder-json') || {}).value, path: creationStartPath() })")
        assert delivered["path"] == "assisted", "7b. the filmmaker must still be on the intent they switched to"
        assert delivered["cine"] == ownership["size"], \
            f"7b. all {ownership['size']} bytes must land in the buffer that owned the file, got {delivered['cine']}"
        assert delivered["assisted"] == 0, \
            f"7b. and none in the intent that merely happened to be selected, got {delivered['assisted']}"
        assert delivered["visible"] == "", "7b. nor may they overwrite the box the filmmaker is now looking at"
        findings.append(f"7b. a {ownership['size']}-byte read started on the CineBraid intent, with both buffers measured empty at "
                        f"the moment of the switch, delivered every byte to cinebraid:json, none to assisted:json, and left the "
                        f"visible assisted box untouched")

        # 7c. rapid switching during the read, and a stale older read.
        SWITCHING = (
            "async () => {"
            "  setCreationStartPath('cinebraid');"
            "  await new Promise((r) => setTimeout(r, 30));"
            "  setCreationDraft('cinebraid:json', '');"
            "  const older = new File(['z'.repeat(1 << 24)], 'older.json');"
            "  const newer = new File(['{\"meta\":{\"title\":\"Newer\"}}'], 'newer.json');"
            "  readProjectBuilderFile({ files: [older] });"
            "  readProjectBuilderFile({ files: [newer] });"
            "  for (const p of ['assisted', 'scratch', 'cinebraid']) setCreationStartPath(p);"
            "  await new Promise((r) => setTimeout(r, 1500));"
            "  return { held: creationDraft('cinebraid:json'), assisted: creationDraft('assisted:json').length, olderSize: older.size };"
            "}"
        )
        switching = page.evaluate(SWITCHING)
        assert "Newer" in switching["held"] and len(switching["held"]) < 1000, \
            (f"7c. the newer selection must win and the older {switching['olderSize']}-byte read must not resurrect itself, "
             f"got {len(switching['held'])} bytes")
        assert switching["assisted"] == 0, "7c. and three switches during the reads moved nothing into another intent"
        findings.append(f"7c. an older {switching['olderSize']}-byte read and a newer small one on the same buffer, with three "
                        f"intent switches in between, leave exactly the newer selection ({len(switching['held'])} bytes)")

        # ---- 8. the landing follows the authority, including when it names nothing -------
        page.goto(f"{base}/#/create", wait_until="domcontentloaded")
        page.wait_for_selector(".creation-start-choice, [data-project-entry-landing]", timeout=20000)
        if page.locator("[data-project-entry-landing]").count():
            page.evaluate("() => dismissProjectEntryLanding()")
        page.wait_for_selector(".creation-start-choice", timeout=20000)
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        authority_source = dict(IMPORT_SOURCE)
        authority_source["meta"] = {"title": "Authority Landing", "format": "Short film"}
        page.fill("#project-builder-json", json.dumps(authority_source))
        page.click("#creation-cinebraid button.assemble-btn")
        page.wait_for_selector(".project-builder-review", timeout=25000)
        page.click(".creation-next-step button.assemble-btn")
        page.wait_for_selector("[data-project-entry-landing]", timeout=30000)

        SENTINEL = (
            "async () => {"
            "  window.__realNext = projectNextProductionAction;"
            "  window.projectNextProductionAction = () => ({ kind: 'control', href: '#/production',"
            "    title: 'MOVED THE AUTHORITY', message: 'This came from the one derivation.', actionLabel: 'PROVE IT' });"
            "  await route();"
            "  const card = document.querySelector('[data-recommended-kind]');"
            "  return { kind: card && card.dataset.recommendedKind, html: card ? card.outerHTML : '' };"
            "}"
        )
        sentinel = page.evaluate(SENTINEL)
        assert sentinel["kind"] == "control" and "MOVED THE AUTHORITY" in sentinel["html"] and "PROVE IT" in sentinel["html"], \
            f"8. a sentinel authority must control every part of the landing's card, got {sentinel}"

        NULLED = (
            "async () => {"
            "  window.projectNextProductionAction = () => null;"
            "  await route();"
            "  const card = document.querySelector('[data-recommended-kind]');"
            "  const landing = document.querySelector('.project-entry-landing');"
            "  return {"
            "    kind: card && card.dataset.recommendedKind,"
            "    html: card ? card.outerHTML : '',"
            "    controlsInCard: card ? card.querySelectorAll('button, a').length : -1,"
            "    openShotsInCard: card ? /OPEN SHOTS/i.test(card.textContent) : true,"
            "    landingHasNavigation: !!landing && /OR LOOK AROUND/.test(landing.textContent),"
            "  };"
            "}"
        )
        nulled = page.evaluate(NULLED)
        assert nulled["kind"] == "none", f"8. a null authority must render the declared no-action state, got {nulled}"
        assert nulled["controlsInCard"] == 0, \
            f"8. and that card must offer no control at all, found {nulled['controlsInCard']}"
        assert not nulled["openShotsInCard"], "8. and must not name a production destination"
        assert "Nothing outstanding" not in nulled["html"], "8. nor restate the retired locally-chosen verdict"
        assert nulled["landingHasNavigation"], \
            "8. while the landing's ordinary navigation, which is not the next action, is still there"
        page.evaluate("() => { window.projectNextProductionAction = window.__realNext; }")
        findings.append("8. a sentinel next action drives the landing's kind, headline and label; a null one renders a "
                        "no-action card with zero controls, no OPEN SHOTS and no production hand-off, while the landing's "
                        "separate navigation block is unaffected")

        # ---- 9. the review never attributes the filmmaker's own prose to CineBraid ------
        page.goto(f"{base}/#/create", wait_until="domcontentloaded")
        page.wait_for_selector(".creation-start-choice, [data-project-entry-landing]", timeout=20000)
        if page.locator("[data-project-entry-landing]").count():
            page.evaluate("() => dismissProjectEntryLanding()")
        page.wait_for_selector(".creation-start-choice", timeout=20000)
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        page.fill("#project-builder-json", json.dumps(ORIGIN_SOURCE))
        page.click("#creation-cinebraid button.assemble-btn")
        page.wait_for_selector(".project-builder-review", timeout=25000)
        origins = page.evaluate(
            "() => {"
            "  const col = (title) => [...document.querySelectorAll('.import-review-column')]"
            "    .find((n) => (n.querySelector('header span') || {}).textContent === title);"
            "  const rows = (n) => n ? [...n.querySelectorAll('[data-origin]')].map((r) => r.dataset.origin) : null;"
            "  const cards = [...document.querySelectorAll('[data-continuity-origin]')].map((c) => ({"
            "    origin: c.dataset.continuityOrigin,"
            "    id: (c.querySelector('strong') || {}).textContent || '',"
            "    label: (c.querySelector('.continuity-origin') || {}).textContent || '',"
            "    inferredClass: c.classList.contains('inferred'),"
            "  }));"
            "  return {"
            "    cine: rows(col('CineBraid planning decisions')),"
            "    source: rows(col('Marked in your source')),"
            "    legacyHeading: [...document.querySelectorAll('.import-review-column header span')].some((n) => n.textContent === 'Inferred values'),"
            "    cards,"
            "  };"
            "}")
        assert origins["cine"] is not None and origins["source"] is not None, \
            f"9. the review must offer both origin columns, got {origins}"
        assert origins["cine"] and all(o == "cinebraid" for o in origins["cine"]), \
            f"9. the CineBraid column may hold only CineBraid rows, got {origins['cine']}"
        assert origins["source"] and all(o == "source" for o in origins["source"]), \
            f"9. and the source column only the source's, got {origins['source']}"
        assert not origins["legacyHeading"], \
            "9. the undifferentiated 'Inferred values' heading must be gone"
        by_id = {c["id"].split(" · ")[0]: c for c in origins["cards"]}
        assert by_id["state-wet"]["origin"] == "source", \
            f"9. a state marked only by the source must be labelled the source's, got {by_id['state-wet']}"
        assert not by_id["state-wet"]["inferredClass"], \
            "9. and must not carry the class that means a CineBraid inference"
        assert "Marked in your source" in by_id["state-wet"]["label"], \
            f"9. in words too, got {by_id['state-wet']['label']!r}"
        assert by_id["state-clean"]["origin"] == "cinebraid+source", \
            f"9. a state carrying both must say both, got {by_id['state-clean']}"
        assert by_id["state-default"]["origin"] == "cinebraid", \
            f"9. and one CineBraid really created is its own, got {by_id['state-default']}"
        findings.append(f"9. {len(origins['cine'])} CineBraid rows and {len(origins['source'])} source-authored rows render in "
                        f"separate columns with zero crossover; state-wet reads \"{by_id['state-wet']['label']}\", state-clean "
                        f"declares both origins, and the old 'Inferred values' heading is gone")

        # ---- 10. an async validation or import belongs to the intent that started it -----
        # THE RESPONSES ARE GENUINELY DELAYED, by a route handler that sleeps before it
        # lets the request through. Every attack below asserts the operation was still in
        # flight at the moment of the switch, so none of them can pass vacuously.
        page.goto(f"{base}/#/create", wait_until="domcontentloaded")
        page.wait_for_selector(".creation-start-choice, [data-project-entry-landing]", timeout=20000)
        if page.locator("[data-project-entry-landing]").count():
            page.evaluate("() => dismissProjectEntryLanding()")
        page.wait_for_selector(".creation-start-choice", timeout=20000)

        OWNED = dict(IMPORT_SOURCE)
        OWNED["meta"] = {"title": "Owned Import", "format": "Short film"}
        STATE = ("() => ({"
                 " cineJson: creationDraft('cinebraid:json'),"
                 " assistedJson: creationDraft('assisted:json'),"
                 " assistedStory: creationDraft('assisted:story'),"
                 " visible: creationStartPath(),"
                 " candidateOwners: [...window.__cinebraidCreationCandidates.keys()].sort(),"
                 " resultOwners: [...window.__cinebraidCreationResults.keys()].sort(),"
                 " visibleCandidate: !!window._projectBuilderCandidate,"
                 "})")

        def seed():
            page.evaluate("(s) => { setCreationDraft('assisted:story', s); setCreationDraft('assisted:json', '{\"assisted\":true}');"
                          " setCreationDraft('cinebraid:json', ''); window.__cinebraidCreationCandidates.clear();"
                          " window.__cinebraidCreationResults.clear(); window.__cinebraidProjectEntryLanding = null; }", SCRIPT)

        def start_on(intent):
            page.click(f'[data-creation-intent="{intent}"]')
            page.wait_for_selector(f"#creation-{intent}", timeout=10000)

        page.evaluate(IMPORT_DELAY_HOOK)
        page.evaluate("() => { window.__importDelayMs = 1200; }")
        seed()

        # 10a. CineBraid validation -> immediate switch to assisted -> SUCCESS.
        start_on("cinebraid")
        page.fill("#project-builder-json", json.dumps(OWNED))
        page.evaluate("() => { window.__op = false; importProjectBuilderJSON().then(() => { window.__op = true; }); }")
        page.wait_for_timeout(120)
        page.click('[data-creation-intent="assisted"]')
        page.wait_for_selector("#creation-assisted", timeout=10000)
        assert page.evaluate("() => window.__op") is False, \
            "10a. the validation must still be in flight when the intent changes, or this proves nothing"
        page.wait_for_function("() => window.__op === true", timeout=30000)
        page.wait_for_timeout(150)
        a = page.evaluate(STATE)
        assert a["candidateOwners"] == ["cinebraid"], f"10a. the candidate belongs to the initiating intent, got {a}"
        assert a["resultOwners"] == ["cinebraid"], f"10a. and so does its result, got {a}"
        assert a["visibleCandidate"] is False, "10a. the visible intent must not be handed another's candidate"
        assert a["assistedStory"] == SCRIPT and a["assistedJson"] == '{"assisted":true}', \
            f"10a. and the assisted material is byte-identical, got {a}"
        assert page.evaluate("() => (document.getElementById('project-builder-result') || {}).innerHTML") == "", \
            "10a. the assisted result region shows nothing, because nothing of its own has happened"

        # 10f. returning to the initiating intent finds the review waiting.
        start_on("cinebraid")
        assert page.locator(".project-builder-review").count() == 1, \
            "10f. returning to the intent that started the validation must show its review"
        assert page.evaluate("() => !!window._projectBuilderCandidate"), "10f. and re-point the visible candidate"

        # 10g. import -> switch away -> SUCCESS: only the initiating source is consumed.
        before_import = page.evaluate(STATE)
        page.evaluate("() => { window.__op = false; commitProjectBuilderImport().then(() => { window.__op = true; }); }")
        page.wait_for_timeout(120)
        page.evaluate("() => setCreationStartPath('assisted')")
        assert page.evaluate("() => window.__op") is False, "10g. the import must still be in flight when the intent changes"
        page.wait_for_function("() => window.__op === true", timeout=40000)
        page.wait_for_selector("[data-project-entry-landing]", timeout=30000)
        g = page.evaluate(STATE)
        assert g["cineJson"] == "", "10g. the source that WAS consumed is cleared"
        assert g["assistedStory"] == before_import["assistedStory"], \
            f"10g. the assisted script is byte-identical, got {g['assistedStory']!r}"
        assert g["assistedJson"] == before_import["assistedJson"], "10g. as is the assisted document"
        assert page.evaluate("() => window.__cinebraidProjectEntryLanding.path") == "cinebraid", \
            "10g. and the landing belongs to the intent that started the import"
        findings.append("10a/f/g. a CineBraid validation and a CineBraid import each completed after a switch to assisted, kept "
                        "their own candidate/result/landing, consumed only the CineBraid document, and left the assisted script "
                        "and document byte-identical; returning to CineBraid showed the review waiting")

        # 10b. CineBraid validation -> switch -> FAILURE. Nothing of anyone's is cleared.
        page.evaluate("() => dismissProjectEntryLanding()")
        page.wait_for_selector(".creation-start-choice", timeout=20000)
        seed()
        start_on("cinebraid")
        # Typed the way a filmmaker types it: `fill` fires `input`, which is what writes
        # the buffer. A JSON ARRAY parses locally and is refused by the server ("must be
        # one JSON object"), so what fails is the request rather than the paste — which
        # is the case this control is about.
        page.fill("#project-builder-json", "[]")
        page.evaluate("() => { window.__op = false; importProjectBuilderJSON().then(() => { window.__op = true; }); }")
        page.wait_for_timeout(120)
        page.click('[data-creation-intent="assisted"]')
        page.wait_for_selector("#creation-assisted", timeout=10000)
        assert page.evaluate("() => window.__op") is False, "10b. the failing validation must still be in flight at the switch"
        page.wait_for_function("() => window.__op === true", timeout=30000)
        page.wait_for_timeout(150)
        b = page.evaluate(STATE)
        assert b["cineJson"] == "[]", f"10b. a failed validation consumes nothing, got {b['cineJson']!r}"
        assert b["assistedStory"] == SCRIPT and b["assistedJson"] == '{"assisted":true}', \
            "10b. and touches no other intent's material"
        assert b["candidateOwners"] == [], f"10b. it leaves no candidate anywhere, got {b['candidateOwners']}"
        assert b["resultOwners"] == ["cinebraid"], f"10b. and its error belongs to the intent that asked, got {b}"
        assert page.evaluate("() => (document.getElementById('project-builder-result') || {}).innerHTML") == "", \
            "10b. the assisted region is not handed the CineBraid failure"

        # 10c. an ASSISTED validation switched away from: the same rule, other direction.
        seed()
        start_on("assisted")
        page.fill("#project-builder-json", json.dumps(OWNED))
        page.evaluate("() => { window.__op = false; importProjectBuilderJSON().then(() => { window.__op = true; }); }")
        page.wait_for_timeout(120)
        page.click('[data-creation-intent="cinebraid"]')
        page.wait_for_selector("#creation-cinebraid", timeout=10000)
        assert page.evaluate("() => window.__op") is False, "10c. the assisted validation must still be in flight at the switch"
        page.wait_for_function("() => window.__op === true", timeout=30000)
        page.wait_for_timeout(150)
        c = page.evaluate(STATE)
        assert c["candidateOwners"] == ["assisted"], f"10c. an assisted-started validation belongs to assisted, got {c}"
        assert c["visibleCandidate"] is False, "10c. and is not shown under the CineBraid heading"
        assert c["cineJson"] == "", "10c. nor may it write into the CineBraid buffer"

        # 10d. an older request followed by a newer one for the same intent.
        seed()
        start_on("cinebraid")
        page.fill("#project-builder-json", json.dumps(OWNED))
        page.evaluate("() => { window.__older = null; window.__newer = null;"
                      " importProjectBuilderJSON().then(() => { window.__older = true; });"
                      " setTimeout(() => importProjectBuilderJSON().then(() => { window.__newer = true; }), 300); }")
        page.wait_for_function("() => window.__older === true && window.__newer === true", timeout=40000)
        page.wait_for_timeout(150)
        d = page.evaluate("() => ({ owners: [...window.__cinebraidCreationCandidates.keys()], token: (window.__cinebraidCreationCandidates.get('cinebraid') || {}).previewToken })")
        assert d["owners"] == ["cinebraid"] and d["token"], f"10d. one candidate survives two overlapping validations, got {d}"

        # 10e. A -> B -> C switching during an in-flight request.
        seed()
        start_on("cinebraid")
        page.fill("#project-builder-json", json.dumps(OWNED))
        page.evaluate("() => { window.__op = false; importProjectBuilderJSON().then(() => { window.__op = true; }); }")
        page.wait_for_timeout(100)
        for intent in ("assisted", "scratch", "assisted"):
            page.evaluate("(i) => setCreationStartPath(i)", intent)
            page.wait_for_timeout(60)
        assert page.evaluate("() => window.__op") is False, "10e. the request must still be in flight after three switches"
        page.wait_for_function("() => window.__op === true", timeout=30000)
        page.wait_for_timeout(150)
        e = page.evaluate(STATE)
        assert e["candidateOwners"] == ["cinebraid"], f"10e. three switches mid-flight do not move ownership, got {e}"
        assert e["assistedStory"] == SCRIPT and e["assistedJson"] == '{"assisted":true}', \
            "10e. and nothing was touched on the way past"
        page.evaluate("() => { window.__importDelayMs = 0; }")
        findings.append("10b/c/d/e. a failed CineBraid validation consumed nothing and kept its error to itself; an "
                        "assisted-started validation stayed assisted's; two overlapping validations left one candidate; and "
                        "three switches during an in-flight request moved no ownership and touched no other intent's material")

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
print("no offsite request and no paid route: 0 blocked, 0 attempted")
print("project entry real-browser audit passed")
