#!/usr/bin/env python3
"""Manual-only Chromium persona audit. Self-skips without Playwright/Chromium."""
import copy, json, os, pathlib, shutil, socket, subprocess, time, urllib.request, urllib.error, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = pathlib.Path(os.environ["CINEBRAID_MANUAL_SCREENSHOT_DIR"]) if os.environ.get("CINEBRAID_MANUAL_SCREENSHOT_DIR") else None
if SCREENSHOT_DIR:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
from browser_runtime import require_browser, launch_chromium
LABEL = "Manual-first real browser audit"
sync_playwright = require_browser(LABEL)

def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port

def wait_server(port, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3): return
        except OSError: time.sleep(.15)
    raise RuntimeError("CineBraid server did not start")

port = free_port()
env = dict(os.environ, PORT=str(port))
server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
try:
    wait_server(port)
    base_project = json.loads((ROOT / "projects" / "cinebraid-sample" / "project.json").read_text())
    project = copy.deepcopy(base_project)
    project.setdefault("meta", {})["workflowEmphasis"] = "manual"
    character = copy.deepcopy((project.get("characters") or [{}])[0])
    character.update({
        "id": "CHAR-MANUAL", "prefix": "CHAR-MANUAL", "anchorPrefix": "CHAR-MANUAL", "name": "Manual reference artist",
        "approvedFile": "CHAR-MANUAL-PRIMARY.png",
        "continuityStates": [{"id":"state-default","name":"Default","isDefault":True,"approvedFile":"CHAR-MANUAL-PRIMARY.png","notes":"Human-approved primary authority."}],
        "coverageSlots": [
            {"id":"front","label":"Front","required":True,"requirement":"required","approvedFile":""},
            {"id":"front-three-quarter","label":"3/4 front","required":False,"requirement":"planned","approvedFile":""},
            {"id":"profile","label":"Profile","required":False,"requirement":"planned","approvedFile":""},
            {"id":"rear","label":"Rear","required":False,"requirement":"not-required","approvedFile":""},
            {"id":"detail-face","label":"Face / detail","required":False,"requirement":"not-required","approvedFile":""},
            {"id":"expression","label":"Expression / optional detail","required":False,"requirement":"not-required","approvedFile":""},
        ],
        "candidateFiles": [{"stored":"CHAR-MANUAL-FRONT.png","original":"CHAR-MANUAL-FRONT.png","decision":"unreviewed","targetCoverageSlotId":"front","targetCoverageSlotName":"Front","coverageGroup":"angles"}],
    })
    project["characters"] = [character]
    shot = (project.get("shots") or [{}])[0]
    shot["characters"] = ["CHAR-MANUAL"]
    for frame in shot.get("keyframes") or []: frame["winner"] = ""
    shot_id = shot.get("id")
    tiny = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23424a52'/%3E%3C/svg%3E"
    scan = {
        "anchors": [{"name":"CHAR-MANUAL-PRIMARY.png","url":tiny},{"name":"CHAR-MANUAL-FRONT.png","url":tiny},{"name":"CHAR-MANUAL-PROFILE.png","url":tiny}],
        "plates": [], "props": [], "vehicles": [], "audio": [], "media": [],
        "shots": {shot_id: {"takes":[{"name":"MANUAL-FRAME-A.png","url":tiny},{"name":"MANUAL-FINISHED-VIDEO.mp4","url":tiny}],"locked":[]}},
    }
    disabled = {"ready":False,"label":"Disabled","provider":"none","model":"","message":"Disabled for manual-only audit.","action":""}
    agents = {"enabled":False,"manualMode":True,"active":0,"queued":0,"maxConcurrent":1,"capabilities":{k:disabled for k in ["text","verifier","vision","embedding","technical"]},"agents":[],"runs":[],"index":{"ready":False,"stale":True}}

    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_default_timeout(7000)
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window, 'localStorage', {value:storage, configurable:true});
          Object.defineProperty(window, 'sessionStorage', {value:storage, configurable:true});
        }""")
        upstream = f"http://127.0.0.1:{port}"
        base = "http://cinebraid.test"
        def proxy_local(route):
            req0 = route.request
            suffix = req0.url[len(base):] if req0.url.startswith(base) else "/"
            if suffix == "/api/project":
                if req0.method == "GET":
                    route.fulfill(status=200, headers={"content-type":"application/json","x-cinebraid-project-slug":"manual-audit"}, body=json.dumps(project)); return
                if req0.method in {"PUT","POST"}:
                    try:
                        data = json.loads(req0.post_data or "{}")
                        if isinstance(data, dict):
                            project.clear(); project.update(data)
                    except Exception: pass
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok":True})); return
            if suffix == "/api/scan":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(scan)); return
            if suffix == "/api/agents/status":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(agents)); return
            if suffix == "/api/system/health":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"assistant":{"provider":"none","configured":False,"label":"Disabled"},"ollama":{"ok":False,"models":[],"plannerReady":False,"visionReady":False,"embeddingReady":False},"ffmpeg":{"ok":True}})); return
            if suffix == "/api/generation/fal/status":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"enabled":False,"configured":False,"defaults":{}})); return
            target = upstream + (suffix or "/")
            headers = {k: v for k, v in req0.headers.items() if k.lower() not in {"host", "connection", "content-length", "accept-encoding"}}
            data = req0.post_data_buffer if req0.method not in {"GET", "HEAD"} else None
            request = urllib.request.Request(target, data=data, headers=headers, method=req0.method)
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    body = response.read()
                    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                    route.fulfill(status=response.status, headers=response_headers, body=body)
            except urllib.error.HTTPError as error:
                route.fulfill(status=error.code, body=error.read())
        page.route(base + "/**", proxy_local)
        with urllib.request.urlopen(upstream + "/", timeout=30) as response:
            index_html = response.read().decode("utf-8")
        index_html = re.sub(r'<link[^>]+href=["\']https?://[^>]+>', '', index_html)
        index_html = index_html.replace("<head>", f'<head><base href="{base}/">', 1)
        page.set_content(index_html, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(700)
        def open_hash(value):
            page.evaluate("value => { location.hash=value; window.dispatchEvent(new HashChangeEvent('hashchange')); }", value)
            page.wait_for_timeout(300)
            page.wait_for_selector("#main")
        open_hash("#/character/CHAR-MANUAL")
        page.wait_for_timeout(250)
        assert page.get_by_text("Build the reference pack").count() == 1
        assert page.get_by_text("Human approval is enough", exact=False).count() >= 1
        assisted = page.locator("details.reference-assisted-tools")
        assert assisted.count() == 1 and not assisted.first.evaluate("node => node.open"), "assisted tools must start collapsed"
        page.locator(".focused-task-button", has_text="Choose & approve").click()
        page.wait_for_timeout(150)
        assert page.get_by_role("button", name="ASSIGN TO FRONT").count() == 1
        assert page.get_by_text("OPTIONAL AI CHECK", exact=True).count() == 0
        assert page.get_by_text("Optional batch AI check", exact=True).count() == 0
        page.get_by_role("button", name="ASSIGN TO FRONT").click()
        page.wait_for_timeout(100)
        page.get_by_role("button", name="ASSIGN VIEW").click()
        page.wait_for_timeout(250)
        page.locator(".focused-task-button", has_text="Coverage & states").click()
        page.wait_for_timeout(150)
        assert page.get_by_text("Front", exact=True).count() >= 1
        front_button = page.locator(".bounded-slot-rail button").filter(has=page.locator("span", has_text="Front")).first
        # A human-assigned coverage view is a SUPPORTING REFERENCE, not canon.
        # This used to assert the word "Approved" here, which is exactly the
        # claim the Dogfood #2 simplification pass removed: a selected view is
        # useful context and never production truth.
        assert "tone-complete" in (front_button.get_attribute("class") or ""), "human-assigned view must read as filled in"
        front_text = front_button.text_content() or ""
        assert "Selected" in front_text, "a chosen coverage view reads as Selected"
        assert "Approved" not in front_text, "a supporting view must never be badged Approved"
        assert page.get_by_text("Planned", exact=True).count() >= 1
        assert page.get_by_text("Not required", exact=True).count() >= 1
        coverage_section = page.locator("details.entity-coverage-section")
        if coverage_section.count():
            coverage_section.first.evaluate("node => node.open = true")
            page.wait_for_timeout(80)
        page.locator(".manual-coverage-actions button", has_text="Map imported references").click()
        page.wait_for_selector("#import-reference-file")
        page.locator("#import-reference-file").select_option("CHAR-MANUAL-PROFILE.png")
        page.locator("#import-reference-target").select_option("coverage:profile")
        assert page.get_by_text("MAP FOR OPTIONAL AI CHECK", exact=True).count() == 0, "disabled vision must not occupy the mapper"
        page.get_by_text("MAP & ASSIGN", exact=True).click()
        page.wait_for_timeout(100)
        page.get_by_role("button", name="ASSIGN VIEW").click()
        page.wait_for_timeout(250)
        # The slot stores its file under selectedFile now. Same value, a key that
        # cannot be misread as an approval.
        assert page.evaluate("() => P.characters.find(x=>x.id==='CHAR-MANUAL').coverageSlots.find(x=>x.id==='profile').selectedFile") == "CHAR-MANUAL-PROFILE.png"
        assert page.evaluate("() => P.characters.find(x=>x.id==='CHAR-MANUAL').coverageSlots.find(x=>x.id==='profile').approvedFile") is None, "no slot may carry an approvedFile after assignment"
        if SCREENSHOT_DIR:
            page.screenshot(path=str(SCREENSHOT_DIR / "manual-reference-coverage.png"), full_page=True)

        # The "Approved" tab is the Canon tab now, and it is receipt-backed. This
        # entity has a selected coverage view and NO canon receipt, so the point of
        # the assertion is that it does NOT appear here — the Dogfood #2 acceptance
        # audit rendered exactly this entity under Approved, with an APPROVED badge
        # and copy saying these media define production truth.
        open_hash("#/library/canon")
        assert page.locator(".view-head .view-title").inner_text().strip() == "References"
        assert page.get_by_text("Supporting views, historic pointers, candidates and automation are hidden", exact=False).count() == 1
        assert page.locator(".library-card.canon").count() == 0, "a supporting selection must not put an entity in the Canon tab"
        assert page.get_by_text("APPROVED", exact=True).count() == 0, "the library must never badge a supporting selection APPROVED"
        open_hash("#/library/all")
        assert page.locator(".library-status.canon").count() == 0, "no canon badge without a receipt"
        assert page.locator(".library-status.reference").count() >= 1, "a selected supporting view reads as REFERENCES"

        open_hash(f"#/shot/{shot_id}")
        page.locator(".focused-task-button").filter(has=page.get_by_text("Frames", exact=True)).click()
        page.wait_for_timeout(150)
        assert page.get_by_text("Import, choose, and approve images").count() == 1
        drop = page.locator(".guided-frame-dropzone").first
        prompt = page.locator("details.frame-assisted-tools").first
        assert drop.count() and prompt.count()
        assert drop.evaluate("a => !!(a.compareDocumentPosition(document.querySelector('details.frame-assisted-tools')) & Node.DOCUMENT_POSITION_FOLLOWING)"), "manual candidate intake must precede prompt tools"
        assert not prompt.evaluate("node => node.open"), "frame prompt tools must stay collapsed"
        automation = page.locator("details.shot-stage-automation")
        assert automation.count() and not automation.first.evaluate("node => node.open"), "automation must remain optional and collapsed"
        approve_frame = page.locator("button.guided-approve-selected")
        assert approve_frame.count() == 1, "existing frame candidate must be directly approvable"
        approve_frame.click()
        page.wait_for_timeout(100)
        page.get_by_role("button", name="APPROVE SHOT IMAGE").click()
        page.wait_for_timeout(250)
        motion_task = page.locator(".focused-task-button").filter(has=page.get_by_text("Motion & sound", exact=True))
        motion_task.click()
        page.wait_for_timeout(180)
        motion_panel = page.locator("details.guided-motion-card")
        if motion_panel.count():
            motion_panel.first.evaluate("node => node.open = true")
            page.wait_for_timeout(80)
        assert page.get_by_text("Imported video", exact=True).count() >= 1
        page.get_by_role("button", name="APPROVE VIDEO").click()
        page.wait_for_timeout(250)
        deliver_task = page.locator(".focused-task-button").filter(has=page.get_by_text("Deliver", exact=True))
        deliver_task.click()
        page.wait_for_timeout(180)
        finish_panel = page.locator("details.guided-finish-card")
        if finish_panel.count():
            finish_panel.first.evaluate("node => node.open = true")
            page.wait_for_timeout(80)
        page.get_by_role("button", name="Finalize", exact=True).click()
        page.wait_for_timeout(250)
        assert page.evaluate("id => P.shots.find(x=>x.id===id).finalVideoFile", shot_id) == "MANUAL-FINISHED-VIDEO.mp4"
        if SCREENSHOT_DIR:
            page.screenshot(path=str(SCREENSHOT_DIR / "manual-shot-delivered.png"), full_page=True)

        open_hash("#/settings")
        project_tab = page.get_by_role("button", name="Project Project metadata and export defaults")
        if project_tab.count() == 0:
            project_tab = page.locator('.settings-tabs button').filter(has=page.get_by_text("Project", exact=True))
        project_tab.first.click()
        page.wait_for_timeout(120)
        select = page.locator('select[onchange*="setProjectWorkflowEmphasis"]')
        assert select.count() == 1 and select.input_value() == "manual"
        assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 2
        browser.close()
    print("Manual-first real Chromium audit passed provider-free reference organization, direct human slot assignment, imported-reference mapping, requirement states, clean approved-library browsing, manual still approval, existing-video approval, final delivery, collapsed automation, and zero horizontal overflow.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
