#!/usr/bin/env python3
"""Real Chromium regression for same-route UI state stability.

No paid requests are sent: prompt and FAL endpoints are intercepted.
"""
import copy, json, os, pathlib, re, shutil, socket, subprocess, sys, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "UI state stability browser check"
sync_playwright = require_browser(LABEL)

def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port

def wait_server(port, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3): return
        except OSError: time.sleep(.12)
    raise RuntimeError("CineBraid server did not start")

project = json.loads((ROOT / "projects" / "cinebraid-sample" / "project.json").read_text())
project = copy.deepcopy(project)
project["meta"]["workflowEmphasis"] = "manual"
project["props"][0]["creationDescription"] = "A compact blue parcel with pale straps, shown as a clean production reference."
scan_svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%232a3038'/%3E%3C/svg%3E"
scan = {
    "anchors": [{"name": "CHAR-COURIER-FRONT.png", "url": scan_svg}, {"name": "CHAR-COURIER-PROFILE.png", "url": scan_svg}],
    "plates": [{"name": "LOC-PLATFORM-MASTER.png", "url": scan_svg}, {"name": "LOC-PLATFORM-REVERSE.png", "url": scan_svg}],
    "props": [{"name": "PROP-PARCEL-CLOSED.png", "url": scan_svg}, {"name": "PROP-PARCEL-OPEN.png", "url": scan_svg}],
    "vehicles": [], "audio": [], "media": [], "shots": {},
}
SCREENSHOT_DIR = os.environ.get("CINEBRAID_UI_STATE_SCREENSHOT_DIR", "").strip()
if SCREENSHOT_DIR:
    pathlib.Path(SCREENSHOT_DIR).mkdir(parents=True, exist_ok=True)

port = free_port(); env = dict(os.environ, PORT=str(port))
server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    wait_server(port)
    upstream = f"http://127.0.0.1:{port}"; base = "http://cinebraid.test"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_default_timeout(6000)
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
          Object.defineProperty(window,'sessionStorage',{value:storage,configurable:true});
        }""")
        generation_job = {"id": "ui-state-job", "status": "COMPLETED", "purpose": "entity-reference", "entityList": "props", "entityId": "PROP-PARCEL", "outputCount": 1, "model": "mock", "outputs": [], "createdAt": "2026-07-31T16:00:00Z"}
        def proxy(route):
            request = route.request
            suffix = request.url[len(base):] if request.url.startswith(base) else "/"
            if suffix == "/api/project" and request.method == "GET":
                route.fulfill(status=200, headers={"content-type": "application/json", "x-cinebraid-project-slug": "ui-state-audit"}, body=json.dumps(project)); return
            if suffix == "/api/project" and request.method in {"PUT", "POST"}:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True})); return
            if suffix == "/api/scan" and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(scan)); return
            if suffix == "/api/config" and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"generation": {"fal": {"enabled": True, "apiKey": "mock", "keySource": "config", "frameOutputs": 1, "frameQuality": "low", "frameResolution": "1k"}}, "assistant": {"provider": "ollama"}})); return
            if suffix == "/api/agents/status":
                cap = {"standing": "ready", "ready": True, "label": "Mock assistant", "provider": "ollama", "model": "mock", "message": "Ready", "action": ""}
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"enabled": True, "capabilities": {"text": cap, "vision": cap, "verifier": cap, "embedding": cap, "technical": cap}, "runs": [], "agents": [], "index": {}})); return
            if suffix == "/api/system/health":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"assistant": {"provider": "ollama", "configured": True, "label": "Mock"}, "ollama": {"ok": True, "models": ["mock"], "plannerReady": True, "visionReady": True, "embeddingReady": True}, "ffmpeg": {"ok": True}})); return
            if suffix == "/api/automation/runs":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"runs": []})); return
            if suffix == "/api/prompt/asset-compile" and request.method == "POST":
                payload = json.loads(request.post_data or "{}")
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"compiledPrompt": "Compiled stable reference prompt.", "profile": {"id": payload.get("profileId", "gpt-image-2/t2i"), "name": "GPT Image 2 — Text to Image", "profileVersion": "ui-state"}, "warnings": [], "confirmations": [], "spec": {}, "providerPayload": None, "llmUsed": bool(payload.get("useLLM"))})); return
            if suffix == "/api/generation/fal/jobs" and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"jobs": []})); return
            if suffix == "/api/generation/fal/jobs" and request.method == "POST":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"job": generation_job})); return
            if suffix == "/api/generation/fal/jobs/ui-state-job/refresh" and request.method == "POST":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"job": generation_job})); return
            target = upstream + (suffix or "/")
            headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "connection", "content-length", "accept-encoding"}}
            data = request.post_data_buffer if request.method not in {"GET", "HEAD"} else None
            req = urllib.request.Request(target, data=data, headers=headers, method=request.method)
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                    route.fulfill(status=response.status, headers=response_headers, body=response.read())
            except urllib.error.HTTPError as error:
                response_headers = {k: v for k, v in error.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                route.fulfill(status=error.code, headers=response_headers, body=error.read())
        page.route(base + "/**", proxy)
        html = urllib.request.urlopen(upstream + "/", timeout=30).read().decode("utf-8")
        html = re.sub(r'<link[^>]+href=["\']https?://[^>]+>', '', html)
        html = html.replace("<head>", f'<head><base href="{base}/">', 1)
        page.set_content(html, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(900)
        def open_hash(value):
            page.evaluate("value => { location.hash=value; window.dispatchEvent(new HashChangeEvent('hashchange')); }", value)
            page.wait_for_timeout(450)
        # R1 LIFTED CREATE REFERENCE OUT OF THE ASSISTED-TOOLS DISCLOSURE. It is a
        # top-level <section class="reference-create-section asset-creation-card"> now,
        # and its manual controls are a <div class="reference-create-manual"> shown and
        # hidden by the shipped `hidden` attribute through toggleReferenceManualPath() --
        # not a <details>, so it has no `.open`. The suite measures the SECTION, which is
        # the element whose top must not move, and reads openness off the panel the
        # product actually toggles.
        def manual_open():
            return page.evaluate(
                """() => { const p = document.querySelector('.reference-create-manual');
                    return !!p && !p.hasAttribute('hidden'); }""")

        def open_reference_builder():
            outer = page.locator("details.reference-assisted-tools")
            inner = page.locator("section.reference-create-section")
            outer.evaluate("e=>e.open=true")
            if not manual_open():
                page.locator(".reference-manual-toggle").first.click()
            page.wait_for_timeout(80)
            return outer, inner

        def assert_reference_stable(label, before_top):
            outer = page.locator("details.reference-assisted-tools")
            inner = page.locator("section.reference-create-section")
            assert outer.evaluate("e=>e.open") is True, f"{label}: optional assisted tools collapsed"
            assert manual_open(), f"{label}: the manual reference controls collapsed"
            after_top = inner.evaluate("e=>e.getBoundingClientRect().top")
            assert abs(after_top - before_top) <= 18, f"{label}: reference builder shifted {after_top-before_top:.1f}px"

        # MEASURE FROM WHERE THE CLICK ACTUALLY HAPPENS.
        #
        # Playwright scrolls a control into view before clicking it, and that scroll is
        # legitimate — a person has to reach the button too. What this suite is testing is
        # that the RE-RENDER does not move the workspace, so the baseline has to be taken
        # after the page has settled where the click will occur, not before.
        #
        # It mattered from O3 onwards: with the Assistant rail occupied the centre column
        # is ~340px narrower, so the reference builder is taller and its Build Prompt
        # button sits further below the card's top. Playwright then scrolled 442px to
        # reach it, app.js captured and faithfully restored that scroll position, and the
        # suite scored the pre-click viewport against the post-click one and called a
        # correct render a 442px jump.
        # The button is CENTRED rather than merely "in view": the dock is fixed to the
        # bottom of the viewport, so a control resting in the last 128px is technically
        # visible and still gets scrolled again by the click's own actionability check.
        # Centring leaves enough margin that the click needs no scroll of its own, which
        # is what makes the before/after comparison a comparison of one thing.
        def stable_click(target, label):
            target.evaluate("e => e.scrollIntoView({block: 'center'})")
            page.wait_for_timeout(150)
            before = page.locator("section.reference-create-section").evaluate("e=>e.getBoundingClientRect().top")
            target.click()
            return before

        open_hash("#/prop/PROP-PARCEL")
        outer, inner = open_reference_builder()
        inner.evaluate("e=>e.scrollIntoView({block:'start'})"); page.wait_for_timeout(80)
        top = stable_click(inner.get_by_role("button", name=re.compile("Build Prompt", re.I)), "Build prompt")
        page.wait_for_timeout(450)
        assert_reference_stable("Build prompt", top)
        top = stable_click(page.locator("section.reference-create-section").get_by_role("button", name="Improve"), "Improve")
        page.wait_for_timeout(450)
        assert_reference_stable("Improve", top)
        top = stable_click(page.locator("section.reference-create-section").get_by_role("button", name="GENERATE"), "Generate")
        page.wait_for_selector("text=START GENERATION")
        page.get_by_role("button", name="START GENERATION").click(); page.wait_for_timeout(500)
        outer = page.locator("details.reference-assisted-tools"); inner = page.locator("section.reference-create-section")
        assert outer.evaluate("e=>e.open") is True, "Generate: optional assisted tools collapsed"
        assert manual_open(), "Generate: the manual reference controls collapsed"
        box = inner.bounding_box()
        viewport = page.viewport_size
        assert box and box["y"] + box["height"] > 0 and box["y"] < viewport["height"], "Generate: reference builder left the visible viewport"
        page.evaluate("closeModal()")
        if SCREENSHOT_DIR:
            page.screenshot(path=str(pathlib.Path(SCREENSHOT_DIR) / "reference-builder-after-generate.png"), full_page=True)
        # Continuity-state prompt actions use a second nested disclosure stack.
        page.evaluate("""() => {
          boundedWriteState('selected:entity-coverage-view','props:PROP-PARCEL','states');
          boundedWriteState('selected:continuity-state','props:PROP-PARCEL','state-open');
          selectBoundedTask('entity-task','props:PROP-PARCEL','coverage');
        }""")
        page.wait_for_timeout(350)
        continuity = page.locator("details.continuity-states")
        state_builder = page.locator("details.entity-state-generation")
        continuity.evaluate("e=>e.open=true"); state_builder.evaluate("e=>e.open=true"); page.wait_for_timeout(70)
        state_builder.evaluate("e=>e.scrollIntoView({block:'start'})"); page.wait_for_timeout(70)
        state_top = state_builder.evaluate("e=>e.getBoundingClientRect().top")
        state_builder.get_by_role("button", name=re.compile("Build state prompt", re.I)).click(); page.wait_for_timeout(450)
        continuity = page.locator("details.continuity-states"); state_builder = page.locator("details.entity-state-generation")
        assert continuity.evaluate("e=>e.open") is True, "Build state prompt: continuity editor collapsed"
        assert state_builder.evaluate("e=>e.open") is True, "Build state prompt: state generation editor collapsed"
        assert abs(state_builder.evaluate("e=>e.getBoundingClientRect().top") - state_top) <= 18, "Build state prompt shifted the focused editor"
        state_top = state_builder.evaluate("e=>e.getBoundingClientRect().top")
        state_builder.get_by_role("button", name="Improve", exact=True).click(); page.wait_for_timeout(450)
        continuity = page.locator("details.continuity-states"); state_builder = page.locator("details.entity-state-generation")
        assert continuity.evaluate("e=>e.open") is True and state_builder.evaluate("e=>e.open") is True, "Improve state prompt collapsed the state workflow"
        assert abs(state_builder.evaluate("e=>e.getBoundingClientRect().top") - state_top) <= 18, "Improve state prompt shifted the focused editor"
        if SCREENSHOT_DIR:
            page.screenshot(path=str(pathlib.Path(SCREENSHOT_DIR) / "continuity-state-after-improve.png"), full_page=True)
        # Generic same-route rerender audit across the major task workspaces.
        routes = [
            ("#/prop/PROP-PARCEL", None),
            ("#/character/CHAR-COURIER", "coverage"),
            ("#/shot/SAMPLE-01", "look"),
            ("#/shot/SAMPLE-01", "frames"),
            ("#/shot/SAMPLE-01", "motion"),
            ("#/shot/SAMPLE-01", "deliver"),
            ("#/reports", None),
            ("#/settings", None),
        ]
        for route_value, task in routes:
            open_hash(route_value)
            if task:
                page.evaluate("([shot,task]) => { selectBoundedTask('shot-task',shot,task); }", ["SAMPLE-01", task]); page.wait_for_timeout(250)
            result = page.evaluate("""() => {
              const entries=routeDetailsEntries(document.querySelector('#main'));
              entries.forEach(({element})=>element.open=true);
              const visible=entries.find(({element})=>{const r=element.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}) || entries[0];
              if (visible) visible.element.scrollIntoView({block:'start'});
              return {keys:entries.map(x=>x.key), anchor:visible?.key||'', top:visible?.element.getBoundingClientRect().top||0};
            }""")
            page.wait_for_timeout(70)
            page.evaluate("route()")
            page.wait_for_timeout(350)
            after = page.evaluate("""(before) => {
              const entries=routeDetailsEntries(document.querySelector('#main'));
              const map=new Map(entries.map(x=>[x.key,x.element]));
              const common=before.keys.filter(k=>map.has(k));
              return {closed:common.filter(k=>!map.get(k).open), top:before.anchor&&map.get(before.anchor)?map.get(before.anchor).getBoundingClientRect().top:null};
            }""", result)
            assert not after["closed"], f"{route_value} {task or ''}: disclosures closed after same-route rerender: {after['closed']}"
            if after["top"] is not None:
                assert abs(after["top"] - result["top"]) <= 20, f"{route_value} {task or ''}: viewport anchor shifted {after['top']-result['top']:.1f}px"
        if SCREENSHOT_DIR:
            open_hash("#/shot/SAMPLE-01")
            page.evaluate("selectBoundedTask('shot-task','SAMPLE-01','frames')")
            page.wait_for_timeout(300)
            page.screenshot(path=str(pathlib.Path(SCREENSHOT_DIR) / "shot-frames-stable-workspace.png"), full_page=True)
        # A slower route is not allowed to overwrite a newer navigation request.
        page.evaluate("""() => {
          window.__uiStateOriginalShotRoute = ROUTES.shot;
          ROUTES.shot = async () => {
            await new Promise(resolve => setTimeout(resolve, 220));
            return '<section id="stale-route-result">STALE SHOT ROUTE</section>';
          };
          location.hash = '#/shot/SAMPLE-01'; route();
          setTimeout(() => { location.hash = '#/reports'; route(); }, 20);
        }""")
        # The stubbed shot route resolves at 220ms. A fixed 500ms sleep had to cover
        # that plus rendering Reports, and on a loaded machine - running this suite
        # beside the rest of the browser gate - it did not, so the suite failed on
        # timing rather than on behaviour. Waiting for the newer route to arrive and
        # THEN outliving the older one asserts strictly more: Reports must win, and
        # must still be winning after the stale route has had its chance to land.
        page.wait_for_selector(".reports-layout", timeout=10000)
        page.wait_for_timeout(400)
        assert page.locator("#stale-route-result").count() == 0, "an older async route overwrote newer navigation"
        assert page.locator(".reports-layout").count() == 1, "newer Reports navigation was not retained"
        page.evaluate("() => { ROUTES.shot = window.__uiStateOriginalShotRoute; delete window.__uiStateOriginalShotRoute; }")
        overflow = page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
        assert overflow <= 2, f"UI state audit ended with {overflow}px horizontal overflow"
        browser.close()
    print("UI state stability browser check passed: Build, Improve, Generate, and same-route rerenders preserve disclosures and viewport context.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
