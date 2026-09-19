"""Reference-first canon: one immediate need and one first-canon action, walked in a real
Chromium at 1440px and 390px.

A disposable copy of the shipped sample gains a Folding Chair that two shots use and that
has no canon and no candidate. The route a filmmaker takes: References, the chair, Generate
primary reference, the existing paid confirmation, one returned candidate, approval. Every
request goes to a LOCAL synthetic provider started by this file; the server, the rules-based
compiler, the paid permit, the payload gate, the job ledger and the candidate ingest are the
shipped ones. Braidy is configured at a loopback address nothing listens on, so the
assistant is unreachable throughout. Nothing is paid and nothing leaves this machine.

What is asserted, at each width:
  1  the References card and the chair's page state one immediate need (1 primary
     reference) with coverage labelled as coverage (0/4 planned views)
  2  Generate primary reference is the one warm action: a real touch target, on screen,
     not under the Activity bar, with no horizontal overflow
  3  More options holds Production media and the prompt/Braidy builder, which opens with
     the manual controls showing and Braidy disabled for its stated reason
  4  keyboard activation compiles the prompt and opens the existing paid confirmation with
     the prompt shown, no stale notice over it, reachable controls, and ZERO provider
     requests; Escape closes it, sends nothing, and returns focus to the button
  5  START GENERATION sends exactly one text-to-image request carrying the prompt the
     dialog showed; the candidate returns; the need becomes "review", then, after approval
     through the real dialog, "None": nothing on the Desk is warm, no coverage control is
     styled as required, and coverage stays reachable, named in words ("Three-quarter view")
  6  no other reference, shot or scene record changed, and there were no console errors
"""
import json, os, pathlib, shutil, socket, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "Reference-first canon real-browser audit"
sync_playwright = require_browser(LABEL)

PNG = (ROOT / "tests" / "fixtures" / "ev2-6" / "frame-0.png").read_bytes()
CHAIR = "PROP-CHAIR"

provider_calls = []
class SyntheticProvider(BaseHTTPRequestHandler):
    def log_message(self, *_args): pass
    def send_json(self, value):
        data = json.dumps(value).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        request_id = f"img-{len(provider_calls) + 1}"
        provider_calls.append({"endpoint": self.path, "body": body})
        self.send_json({"request_id": request_id, "status_url": f"{origin}/status/{request_id}",
                        "response_url": f"{origin}/result/{request_id}", "cancel_url": f"{origin}/cancel/{request_id}"})
    def do_GET(self):
        parts = self.path.strip("/").split("/", 1)
        if parts[0] == "status": return self.send_json({"status": "COMPLETED"})
        if parts[0] == "result": return self.send_json({"images": [{"url": f"{origin}/image/{parts[1]}.png", "width": 1536, "height": 1024, "content_type": "image/png"}]})
        if parts[0] != "image": return self.send_error(404)
        self.send_response(200); self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(PNG))); self.end_headers(); self.wfile.write(PNG)

provider = ThreadingHTTPServer(("127.0.0.1", 0), SyntheticProvider)
origin = f"http://127.0.0.1:{provider.server_port}"
threading.Thread(target=provider.serve_forever, daemon=True).start()

def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]

def chair_fixture(project):
    project["props"].append({
        "id": CHAIR, "name": "Folding Chair", "prefix": CHAIR, "status": "NOT STARTED", "workflowStatus": "DRAFT",
        "visualDescription": "Slightly battered dull-gray metal folding chair with a small white label reading HALL PROPERTY.",
        "approvedFile": "",
        "continuityStates": [{"id": "state-default", "name": "Default", "isDefault": True, "approvedFile": ""}],
        "coverageSlots": [
            {"id": "hero", "label": "Front / hero", "requirement": "required", "selectedFile": ""},
            {"id": "three-quarter", "label": "3/4 view", "requirement": "required", "selectedFile": ""},
            {"id": "side", "label": "Side", "requirement": "required", "selectedFile": ""},
            {"id": "rear", "label": "Rear", "requirement": "planned", "selectedFile": ""},
            {"id": "top", "label": "Top", "requirement": "planned", "selectedFile": ""},
            {"id": "detail", "label": "Detail / function close-up", "requirement": "required", "selectedFile": ""},
        ],
    })
    for shot in project["shots"][:2]:
        shot["codes"] = [*shot.get("codes", []), CHAIR]
        shot.setdefault("continuityStateSelections", {})[CHAIR] = "state-default"
    return project

def start(sandbox):
    projects = sandbox / "projects"
    shutil.copytree(ROOT / "projects" / "cinebraid-sample", projects / "cinebraid-sample")
    document = projects / "cinebraid-sample" / "project.json"
    document.write_text(json.dumps(chair_fixture(json.loads(document.read_text(encoding="utf-8"))), indent=2), encoding="utf-8")
    config = sandbox / "config.json"
    dead = free_port()
    config.write_text(json.dumps({
        "activeProject": "cinebraid-sample",
        "assistant": {"provider": "custom", "visionProvider": "none"},
        "customBaseUrl": f"http://127.0.0.1:{dead}/v1", "customModel": "offline-braidy",
        "generation": {"fal": {
            "enabled": True, "apiKey": "reference-first-canon-placeholder-not-a-credential", "baseUrl": origin,
            "textModel": "openai/gpt-image-2", "editModel": "openai/gpt-image-2/edit",
            "frameOutputs": 1, "frameQuality": "low", "frameResolution": "2k", "maxConcurrent": 2}},
    }), encoding="utf-8")
    port = free_port()
    # Disposable settings and projects root, stated in the call; no FAL_KEY reaches the server.
    server = subprocess.Popen(["node", "server.js"], cwd=ROOT,
                              env={**{k: v for k, v in os.environ.items() if k != "FAL_KEY"}, "PORT": str(port),
                                   "CINEBRAID_CONFIG_PATH": str(config), "CINEBRAID_PROJECTS_ROOT": str(projects)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), .25): break
        except OSError: time.sleep(.1)
    else:
        server.kill(); raise RuntimeError("CineBraid server did not start")
    return server, f"http://127.0.0.1:{port}", document

def check(condition, message):
    if not condition: raise AssertionError(message)
    print(f"  ok  {message}")

NEEDS = """() => { const s = document.querySelector('[data-rd-needs]'); return s ? { now: s.dataset.rdNeedsNow, action: s.dataset.rdNeedsAction,
  text: s.innerText.replace(/\\s+/g, ' ').trim() } : null; }"""
WARM = "() => [...document.querySelectorAll('#main .rd-primary')].filter((b) => b.checkVisibility()).map((b) => b.innerText.trim())"
LAYOUT = """(sel) => { const b = document.querySelector(sel); b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const dock = document.getElementById('cb-shell-dock'), dockTop = dock && dock.checkVisibility() ? dock.getBoundingClientRect().top : innerHeight;
  return { height: Math.round(r.height), inside: r.left >= 0 && r.right <= document.documentElement.clientWidth,
    reachable: !!hit && (hit === b || b.contains(hit)), clearOfDock: r.bottom <= dockTop,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }"""

def records(document):
    project = json.loads(document.read_text(encoding="utf-8"))
    refs = {e["id"]: json.dumps(e, sort_keys=True) for key in ("characters", "locations", "props", "vehicles") for e in project.get(key, [])}
    return refs, {s["id"]: json.dumps(s, sort_keys=True) for s in project["shots"]}, json.dumps(project.get("scenes", []), sort_keys=True)

def walk(browser, base, document, width, height):
    print(f"\n{width}px")
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    before_calls = len(provider_calls)

    # 1. References: one immediate need, coverage named as coverage. A no-op save first, so the
    #    record comparison at the end is not confused by the app's own load normalisation.
    page.goto(f"{base}/?rfc={width}#/library")
    page.wait_for_selector("[data-reference-library]")
    page.evaluate("async () => { dirty(); await flushPendingProjectSave(); }")
    refs0, shots0, scenes0 = records(document)
    card = page.locator("a.rd-library-card", has_text="Folding Chair")
    text = card.inner_text()
    check("Needed now · 1 primary reference" in text and "Coverage · 0/4 planned views" in text, "the References card states one immediate need and names coverage as coverage")

    # 2. The chair.
    card.click()
    page.wait_for_selector("[data-rd-needs]")
    needs = page.evaluate(NEEDS)
    check(needs["now"] == "1" and needs["action"] == "generate-primary", f"the chair needs one thing now, the first canon ({needs})")
    check("1 primary reference" in needs["text"] and "0/4 planned views" in needs["text"], "needed now and coverage are separate, labelled lines")
    check(page.evaluate(WARM) == ["Generate primary reference"], "Generate primary reference is the only warm action")
    facts = page.evaluate(LAYOUT, "#rd-generate-primary")
    check(facts["height"] >= 44, f"it is a {facts['height']}px touch target")
    check(facts["inside"] and facts["reachable"] and facts["clearOfDock"], "on screen and not covered by the Activity bar")
    check(facts["overflow"] <= 0, f"no horizontal overflow ({facts['overflow']}px)")
    clipped = page.evaluate("""() => {
      const els = [...document.querySelectorAll('[data-rd-needs] span, [data-rd-needs] b, [data-rd-needs] small, .rd-first-canon h2, .rd-first-canon p, .rd-first-actions .rd-button, #rd-more > summary')];
      const clip = els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim());
      const boxes = [...document.querySelectorAll('[data-rd-needs] .rd-need, .rd-first-actions .rd-button')].map((el) => ({ t: el.textContent.trim().slice(0, 30), r: el.getBoundingClientRect() }));
      const overlap = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap.push(boxes[i].t + ' / ' + boxes[j].t);
      }
      return { clip, overlap };
    }""")
    check(not clipped["clip"] and not clipped["overlap"], f"no clipped, overlapping or run-together labels ({clipped})")

    # 3. More options: the specialist paths are one disclosure away, and the builder opens ready.
    page.locator("#rd-more > summary").click()
    check(page.locator("#rd-more [data-rd-action='choose']").is_visible() and page.locator("#rd-more [data-rd-action='prompt']").is_visible(), "More options holds Production media and the prompt/Braidy builder")
    page.locator("#rd-more [data-rd-action='prompt']").click()
    page.wait_for_selector("details.reference-create-more[open] .reference-create-manual:not([hidden])", timeout=15000)
    braidy = page.get_by_role("button", name="Start Braidy run")
    check(braidy.is_disabled() and "cannot reach" in (braidy.get_attribute("title") or ""), "the builder opens with the manual controls showing, and Braidy disabled for its stated reason")
    check(page.locator(".reference-generate-btn").is_visible(), "Generate primary reference is on the primary workspace too")
    page.goto(f"{base}/?rfc={width}-back#/prop/{CHAIR}")
    page.wait_for_selector("#rd-generate-primary")

    # 4. Keyboard activation opens the existing paid confirmation, and sends nothing.
    page.focus("#rd-generate-primary")
    page.keyboard.press("Enter")
    page.wait_for_selector("#modal:not(.hidden) .fal-entity-actions .approve-btn", timeout=30000)
    page.wait_for_selector("#fal-entity-generation-view select", timeout=10000)
    check(len(provider_calls) == before_calls, "no provider request before confirmation")
    dialog = page.locator("#modal .modal-box")
    check("START GENERATION" in dialog.inner_text() and "This submits a paid FAL image request" in dialog.inner_text(), "the existing paid confirmation is open and says it is paid")
    page.locator("[data-fal-entity-prompt] > summary").click()
    shown = page.inner_text("[data-fal-entity-prompt] pre")
    check("Folding Chair" in shown, "it shows the prompt that will be sent")
    check(not page.locator("#toast").is_visible(), "no stale notice sits over it")
    confirm = page.evaluate(LAYOUT.replace("block: 'center'", "block: 'nearest'"), "#modal .fal-entity-actions .approve-btn")
    check(confirm["reachable"] and confirm["inside"] and (width >= 768 or confirm["height"] >= 44), f"its confirm control is reachable ({confirm})")
    page.keyboard.press("Escape")
    page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')")
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'rd-generate-primary'", timeout=5000)
    check(True, "Escape closes it and returns focus to Generate primary reference")
    check(len(provider_calls) == before_calls, "and nothing was sent")

    # 5. Confirm, receive, review, approve.
    page.click("#rd-generate-primary")
    page.wait_for_selector("#modal:not(.hidden) .fal-entity-actions .approve-btn", timeout=30000)
    page.wait_for_selector("#fal-entity-generation-view select", timeout=10000)
    shown = page.eval_on_selector("[data-fal-entity-prompt] pre", "(el) => el.textContent")
    page.locator("#modal .fal-entity-actions .approve-btn").click()
    page.wait_for_function("() => document.querySelectorAll('[data-rd-candidate]').length >= 1", timeout=45000)
    check(len(provider_calls) == before_calls + 1, "START GENERATION sent exactly one request")
    call = provider_calls[before_calls]
    check(call["endpoint"] == "/openai/gpt-image-2" and "image_urls" not in call["body"], "a text-to-image request with no image input")
    check(call["body"].get("prompt") == shown, "carrying exactly the prompt the dialog showed")
    page.wait_for_function("() => document.querySelector('[data-rd-needs]')?.dataset.rdNeedsAction === 'review-primary'", timeout=15000)
    check("candidate waiting" in page.evaluate(NEEDS)["text"], "with a candidate back, the need is to review it")
    check(page.evaluate(WARM) == ["Approve reference…"], "and approval is the only warm action")
    page.locator("[data-rd-action='approve']").click()
    page.wait_for_selector("#entity-approval-readiness[data-state='ready']", timeout=30000)
    page.click("#entity-approve-confirm")
    page.wait_for_function("() => document.getElementById('rd-approval-status')?.dataset.rdApproval === 'approved'", timeout=30000)
    page.wait_for_function("() => document.querySelector('[data-rd-needs]')?.dataset.rdNeedsAction === 'complete'", timeout=15000)
    # THE COMPLETED STATE. Nothing is needed now, so optional coverage must not look required: it
    # stays reachable in its section as a secondary control, and nothing on the Desk is warm.
    needs = page.evaluate(NEEDS)
    check(needs["now"] == "0" and needs["text"].startswith("NEEDED NOW None"), f"after approval, Needed now reads None ({needs['text']!r})")
    check("1/4 planned views" in needs["text"], "coverage is still offered and still named coverage (approval seeded the hero view)")
    check(page.evaluate(WARM) == [], "with nothing needed now, no control on the Desk is warm")
    styled = page.evaluate("""() => {
      const warm = document.createElement('button'); warm.className = 'rd-button rd-primary'; document.body.appendChild(warm);
      const warmColour = getComputedStyle(warm).backgroundColor; warm.remove();
      const coverage = [...document.querySelectorAll('.rd-coverage button, [data-rd-needs] button')].filter((b) => b.checkVisibility());
      return { warmColour, count: coverage.length,
        styledRequired: coverage.filter((b) => b.classList.contains('rd-primary') || getComputedStyle(b).backgroundColor === warmColour).map((b) => b.innerText.trim()) };
    }""")
    check(styled["count"] > 0 and not styled["styledRequired"], f"no optional coverage action is styled as required ({styled})")
    nxt = page.locator("[data-rd-coverage-next]")
    check(nxt.inner_text().strip() == "Continue coverage — Three-quarter view", f"the next view is named in words, not as a fraction beside 1/4 ({nxt.inner_text()!r})")
    check("3/4" not in page.inner_text("[data-reference-desk]"), "no \"3/4\" appears anywhere on the Desk")
    facts = page.evaluate(LAYOUT, "[data-rd-coverage-next]")
    check(facts["reachable"] and facts["inside"] and facts["clearOfDock"] and (width >= 768 or facts["height"] >= 44), f"coverage stays reachable ({facts})")
    check(facts["overflow"] <= 0, "still no horizontal overflow")
    nxt.click()
    page.wait_for_selector("[data-build-coverage]", timeout=15000)
    check("Three-quarter view" in page.inner_text("#bc-target"), "and it opens Build coverage on the three-quarter view")
    page.locator("[data-build-coverage] [data-bc-action='close']").first.click()
    page.wait_for_selector("#modal.hidden", state="attached", timeout=15000)

    # 6. Nothing else moved.
    page.wait_for_timeout(800)
    refs1, shots1, scenes1 = records(document)
    changed = sorted(k for k in set(refs0) | set(refs1) if refs0.get(k) != refs1.get(k))
    check(changed == [CHAIR], f"only the Folding Chair's record changed ({changed})")
    check(shots0 == shots1 and scenes0 == scenes1, "no shot or scene record changed")
    check(not errors, f"no console errors: {errors}")
    page.close()

sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-reference-first-canon-"))
server = None
try:
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        for width, height in ((1440, 1000), (390, 844)):
            server, base, document = start(sandbox / f"w{width}")
            try:
                walk(browser, base, document, width, height)
            finally:
                server.kill(); server.wait(timeout=10); server = None
        browser.close()
    print(f"\n{LABEL} passed: one immediate need, one first-canon action, the existing paid confirmation with nothing sent before it, and approval, at 1440px and 390px with a local provider only.")
finally:
    if server: server.kill()
    provider.shutdown()
    shutil.rmtree(sandbox, ignore_errors=True)
