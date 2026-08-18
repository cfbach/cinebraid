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
