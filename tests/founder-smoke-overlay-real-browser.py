#!/usr/bin/env python3
"""P0-6 — the active overlay is the one on top, in a real Chromium.

FOUNDER SMOKE REPRODUCTION
--------------------------
With the activity drawer open, DISMISS PREVIOUS ALERTS opened its confirmation
UNDERNEATH the drawer and its blurred backdrop. The confirmation was the thing
waiting for an answer and it was the thing the creator could not read.

The numbers had drifted: the dialog was z-index 80, the drawer's backdrop 185, the
drawer 190, and the docked activity strip 1200 over all of them. This suite asserts
the ladder styles.css now declares, and asserts it the only way that is worth
anything — by asking the browser what is actually on top at a point, and by driving
the keyboard.

WHAT IS CHECKED
  1. paint order: dialog > drawer > backdrop > page, from computed z-index
  2. hit testing: elementFromPoint at the dialog's centre is inside the dialog
  3. the dialog is not visually degraded by the drawer's backdrop filter
  4. Escape closes the DIALOG only; the drawer that asked the question stays open
  5. a second Escape then closes the drawer
  6. the docked activity strip no longer paints over a dialog

NO PAID REQUEST IS POSSIBLE. Every generation and assistant route is intercepted
and answered locally; the only network is the loopback CineBraid server.
"""
import copy, json, os, pathlib, re, socket, subprocess, sys, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "Founder smoke overlay stacking check"
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


project = copy.deepcopy(json.loads((ROOT / "projects" / "cinebraid-sample" / "project.json").read_text()))
project["meta"]["workflowEmphasis"] = "manual"
SLUG = "overlay-audit"

scan = {"anchors": [], "plates": [], "props": [], "vehicles": [], "audio": [], "media": [], "shots": {}}

# Two runs the drawer classifies as PREVIOUS FAILURES / NEEDS ATTENTION, so the
# DISMISS PREVIOUS ALERTS control is offered and its confirmation can be opened.
runs = [
    {
        "id": "overlay-run-1", "revision": 1, "type": "shot-chain", "targetId": "SAMPLE-01",
        "label": "Sample shot automation", "status": "failed", "stage": "Needs attention",
        "summary": "Generation failed.", "createdAt": "2026-08-17T09:00:00Z",
        "updatedAt": "2026-08-17T09:05:00Z", "config": {"maxImages": 9}, "usage": {},
        "steps": {"frame:a:generate": {"key": "frame:a:generate", "kind": "generation", "status": "failed",
                                       "label": "Generate Frame A", "error": "Provider refused the request."}},
        "logs": [],
    },
    {
        "id": "overlay-run-2", "revision": 1, "type": "shot-chain", "targetId": "SAMPLE-02",
        "label": "Second shot automation", "status": "cancelled", "stage": "Cancelled",
        "summary": "Stopped by the director.", "createdAt": "2026-08-17T09:10:00Z",
        "updatedAt": "2026-08-17T09:11:00Z", "config": {"maxImages": 9}, "usage": {},
        "steps": {}, "logs": [],
    },
]

port = free_port(); env = dict(os.environ, PORT=str(port))
server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    wait_server(port)
    upstream = f"http://127.0.0.1:{port}"; base = "http://cinebraid.test"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_default_timeout(8000)
        # The page is served through set_content, so the document keeps the about:blank
        # origin and real localStorage throws SecurityError there. app.js reads it during
        # top-level execution, so without this shim the script aborts, every `const` after
        # the throw stays in its temporal dead zone, and the failure surfaces much later as
        # "esc is not defined" from an unrelated renderer.
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
          Object.defineProperty(window,'sessionStorage',{value:storage,configurable:true});
        }""")

        def proxy(route):
            request = route.request
            suffix = request.url[len(base):] if request.url.startswith(base) else "/"
            if suffix == "/api/project" and request.method == "GET":
                route.fulfill(status=200, headers={"content-type": "application/json", "x-cinebraid-project-slug": SLUG},
                              body=json.dumps(project)); return
            if suffix == "/api/project" and request.method in {"PUT", "POST"}:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True})); return
            if suffix == "/api/scan":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(scan)); return
            if suffix.startswith("/api/automation/runs"):
                # The owning project is stated, exactly as automation-runs.js now states it.
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps({"runs": runs, "projectSlug": SLUG})); return
            if suffix.startswith("/api/generation/fal/jobs"):
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"jobs": []})); return
            if suffix.startswith("/api/llm/") or suffix.startswith("/api/prompt/"):
                route.fulfill(status=200, content_type="application/json", body=json.dumps({})); return
            target = upstream + (suffix or "/")
            headers = {k: v for k, v in request.headers.items()
                       if k.lower() not in {"host", "connection", "content-length", "accept-encoding"}}
            data = request.post_data_buffer if request.method not in {"GET", "HEAD"} else None
            req = urllib.request.Request(target, data=data, headers=headers, method=request.method)
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    response_headers = {k: v for k, v in response.headers.items()
                                        if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                    route.fulfill(status=response.status, headers=response_headers, body=response.read())
            except urllib.error.HTTPError as error:
                response_headers = {k: v for k, v in error.headers.items()
                                    if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}}
                route.fulfill(status=error.code, headers=response_headers, body=error.read())

        page.route(base + "/**", proxy)
        html = urllib.request.urlopen(upstream + "/", timeout=30).read().decode("utf-8")
        html = re.sub(r'<link[^>]+href=["\']https?://[^>]+>', '', html)
        html = html.replace("<head>", f'<head><base href="{base}/">', 1)
        page.set_content(html, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#automation-activity-toggle", timeout=15000)
        page.wait_for_timeout(700)

        # ---- open the drawer -------------------------------------------------
        page.evaluate("() => openGlobalAutomationActivity()")
        page.wait_for_selector(".automation-activity-drawer.open", timeout=8000)
        dismiss = page.locator("button:has-text('DISMISS PREVIOUS ALERTS')")
        assert dismiss.count() == 1, "the drawer must offer DISMISS PREVIOUS ALERTS for runs needing attention"

        # ---- the confirmation this flow opens --------------------------------
        dismiss.click()
        page.wait_for_selector("#modal:not(.hidden) .modal-box", timeout=8000)

        layers = page.evaluate("""() => {
          const z = (node) => {
            if (!node) return null;
            const value = getComputedStyle(node).zIndex;
            return value === 'auto' ? null : Number(value);
          };
          const drawer = document.getElementById('automation-activity-drawer');
          const backdrop = document.getElementById('automation-activity-backdrop');
          const modal = document.getElementById('modal');
          const strip = document.getElementById('automation-global-live-strip');
          const box = modal.querySelector('.modal-box').getBoundingClientRect();
          const point = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            dialog: z(modal),
            drawer: z(drawer),
            backdrop: z(backdrop),
            strip: z(strip),
            rail: z(document.getElementById('rail')),
            topOfDialogPoint: !!(point && modal.contains(point)),
            dialogFilter: getComputedStyle(modal.querySelector('.modal-box')).filter,
            drawerOpen: drawer.classList.contains('open'),
          };
        }""")

        assert layers["dialog"] is not None, "the dialog must declare its own stacking level"
        assert layers["dialog"] > layers["drawer"], (
            f"confirmation ({layers['dialog']}) must paint above the activity drawer ({layers['drawer']})")
        assert layers["drawer"] > layers["backdrop"], (
            f"the drawer ({layers['drawer']}) must paint above its own backdrop ({layers['backdrop']})")
        assert layers["backdrop"] > layers["rail"], (
            f"the backdrop ({layers['backdrop']}) must paint above the page ({layers['rail']})")
        if layers["strip"] is not None:
            assert layers["strip"] < layers["dialog"], (
                f"the docked activity strip ({layers['strip']}) must not paint over a dialog ({layers['dialog']})")
        assert layers["topOfDialogPoint"], "the topmost element at the confirmation's centre must be the confirmation"
        assert layers["dialogFilter"] in ("none", ""), (
            f"the active confirmation must not be blurred by a lower layer (filter: {layers['dialogFilter']})")
        assert layers["drawerOpen"], "the drawer must remain open behind its own confirmation"

        # ---- Escape closes the top of the stack, not everything in it ---------
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        after_first = page.evaluate("""() => ({
          modalHidden: document.getElementById('modal').classList.contains('hidden'),
          drawerOpen: document.getElementById('automation-activity-drawer').classList.contains('open'),
        })""")
        assert after_first["modalHidden"], "Escape must close the confirmation on top"
        assert after_first["drawerOpen"], "Escape must not also close the drawer that opened the confirmation"

        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        after_second = page.evaluate(
            "() => document.getElementById('automation-activity-drawer').classList.contains('open')")
        assert after_second is False, "a second Escape must close the drawer"

        overflow = page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
        assert overflow <= 2, f"the overlay audit ended with {overflow}px horizontal overflow"
        browser.close()
    print("Founder smoke overlay stacking check passed: confirmation > drawer > backdrop > page by paint order and by "
          "hit test, the confirmation is unblurred, and Escape closes one layer at a time. Provider calls made: 0.")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
