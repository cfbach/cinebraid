"""B-roll / style-only generation, walked in a real Chromium at 1440px and 390px.

The route a filmmaker takes: open the shot, choose B-roll / style-only, edit the prompt,
choose Image or Video, generate, confirm the paid dialog, and find the result. Every
request goes to a LOCAL synthetic provider started by this file, which records what it
was sent; the server, its compilers, the paid-request gates, the job ledger and the
candidate ingest are all the shipped ones. Nothing is paid and nothing leaves this
machine. A disposable copy of the sample project is used; the shipped one is untouched.

What is asserted, at each width:
  1  the mode is chosen with the keyboard on a native radio group
  2  the B-roll desk shows one panel and no reference-led step: no stage strip, no intent
     control, no reference attachment, and nothing overflows the viewport
  3  the Generate control is a real touch target and is not covered by the fixed
     Activity bar
  4  the image and video dialogs name B-roll, list no other models and draw no empty
     panel; Simple is one summary line, the settings and one price line, with the
     detail in Advanced; a notice about the previous request is cleared when a paid
     confirmation opens; and both submit
  5  the provider receives text-to-image and text-to-video requests with no image input,
     carrying the project style and the written prompt
  6  switching back to reference-led restores the full desk from the same record
"""
import json, os, pathlib, shutil, socket, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL = "B-roll generation real-browser audit"
sync_playwright = require_browser(LABEL)

PROMPT = "Rain sheets across the empty platform canopy at dusk; puddles ripple under the sodium lamps."
STYLE = "Clean graphic storyboard placeholders for a manual production-organizing sample."
PNG = (ROOT / "tests" / "fixtures" / "ev2-6" / "frame-0.png").read_bytes()
MP4 = (ROOT / "tests" / "fixtures" / "ev2-6" / "motion-0.mp4").read_bytes()

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
        kind = "vid" if "minimax" in self.path else "img"
        request_id = f"{kind}-{len(provider_calls) + 1}"
        provider_calls.append({"endpoint": self.path, "body": body, "authorized": str(self.headers.get("Authorization", "")).startswith("Key ")})
        self.send_json({"request_id": request_id, "status_url": f"{origin}/status/{request_id}",
                        "response_url": f"{origin}/result/{request_id}", "cancel_url": f"{origin}/cancel/{request_id}"})
    def do_GET(self):
        parts = self.path.strip("/").split("/", 1)
        if parts[0] == "status": return self.send_json({"status": "COMPLETED"})
        if parts[0] == "result":
            key = parts[1]
            if key.startswith("vid-"): return self.send_json({"video": {"url": f"{origin}/video/{key}.mp4", "content_type": "video/mp4"}})
            return self.send_json({"images": [{"url": f"{origin}/image/{key}.png", "width": 1536, "height": 864, "content_type": "image/png"}]})
        data, mime = (PNG, "image/png") if parts[0] == "image" else (MP4, "video/mp4") if parts[0] == "video" else (None, None)
        if data is None: return self.send_error(404)
        self.send_response(200); self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_PUT(self): self.send_json({"ok": True})

provider = ThreadingHTTPServer(("127.0.0.1", 0), SyntheticProvider)
origin = f"http://127.0.0.1:{provider.server_port}"
threading.Thread(target=provider.serve_forever, daemon=True).start()

def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]

def start(sandbox):
    projects = sandbox / "projects"
    shutil.copytree(ROOT / "projects" / "cinebraid-sample", projects / "cinebraid-sample")
    config = sandbox / "config.json"
    config.write_text(json.dumps({
        "activeProject": "cinebraid-sample",
        "assistant": {"provider": "none", "visionProvider": "none"},
        "generation": {"fal": {
            "enabled": True, "apiKey": "broll-browser-qa-placeholder-not-a-credential", "baseUrl": origin,
            "textModel": "openai/gpt-image-2", "editModel": "openai/gpt-image-2/edit",
            "h3TextModel": "minimax/h3/text-to-video", "h3ImageModel": "minimax/h3/image-to-video",
            "h3ReferenceModel": "minimax/h3/reference-to-video", "h3Resolution": "768P",
            "frameOutputs": 1, "frameQuality": "low", "frameResolution": "1k", "maxConcurrent": 4}},
    }), encoding="utf-8")
    port = free_port()
    server = subprocess.Popen(["node", "server.js"], cwd=ROOT,
                              env={**os.environ, "PORT": str(port), "CINEBRAID_CONFIG_PATH": str(config),
                                   "CINEBRAID_PROJECTS_ROOT": str(projects)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), .25): break
        except OSError: time.sleep(.1)
    else:
        server.kill(); raise RuntimeError("CineBraid server did not start")
    return server, f"http://127.0.0.1:{port}"

def check(condition, message):
    if not condition: raise AssertionError(message)
    print(f"  ok  {message}")

def layout_facts(page):
    return page.evaluate("""() => {
      const button = document.querySelector('.broll-generate');
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stageBar: document.querySelectorAll('.cb-stage-bar').length,
        intent: document.querySelectorAll('.shot-intent-control').length,
        workStack: document.querySelectorAll('.guided-work-stack').length,
        referenceControls: [...document.querySelectorAll('[data-broll-panel] input[type=file], [data-broll-panel] [data-reference-picker]')].length,
        buttonHeight: Math.round(rect.height),
        buttonInside: rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
        buttonReachable: !!hit && (hit === button || button.contains(hit)),
        panelWidth: Math.round(document.querySelector('[data-broll-panel]').getBoundingClientRect().width),
      };
    }""")

def simple_dialog(page, dialog, kind, summary):
    """The B-roll Simple confirmation: one summary line, the settings, one cost line, and no
    diagnostic card, compiler line, facts row, prompt editor or accounting paragraph."""
    lead = dialog.locator(".h3-generation-head p")
    check(lead.is_visible() and lead.inner_text().strip() == "Uses the project look and this shot’s prompt. No reference required.", f"{kind} dialog says it needs no reference, at this width too")
    check(dialog.locator("[data-gen-view-summary]").inner_text().strip().startswith(summary), f"{kind} Simple view states the request in one line")
    check(dialog.locator("[data-gen-view-cost-line]").is_visible(), f"{kind} Simple view states price and time in one line")
    check(dialog.locator(".gen-view-controls select").count() >= 1 and dialog.locator(".gen-view-controls select").first.is_visible(), f"{kind} Simple view shows the settings that can change")
    for selector in (".gen-view-always", ".modal-sub", ".candidate-evidence-facts", ".h3-prompt-editor", "p.hint", ".gen-view-limits"):
        check(dialog.locator(selector).count() == 0 or not dialog.locator(selector).first.is_visible(), f"{kind} Simple view hides {selector}")
    controls = dialog.locator(".gen-view-controls").bounding_box()
    cost = dialog.locator("[data-gen-view-cost-line]").bounding_box()
    check(controls["y"] < cost["y"], f"{kind} settings come before the cost line")

def walk(browser, base, width, height):
    print(f"\n{width}px")
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/?broll={width}#/shot/SAMPLE-01")
    page.wait_for_selector(".shot-reference-mode")
    check(page.locator(".shot-intent-control").count() == 1, "reference-led desk keeps its intent control")

    # 1. choose B-roll with the keyboard
    page.focus(".shot-reference-mode input[value='reference-led']")
    page.keyboard.press("ArrowRight")
    page.wait_for_selector("[data-broll-panel]")
    check(page.locator(".shot-reference-mode input[value='style-only']").is_checked(), "arrow key selects B-roll")
    page.wait_for_function("() => document.activeElement && document.activeElement.value === 'style-only'")
    check(True, "and the keyboard stays on the choice after the desk re-renders")

    # 2 + 3. one panel, no reference step, nothing overflows, a reachable touch target
    facts = layout_facts(page)
    check(facts["overflow"] <= 0, f"no horizontal overflow ({facts['overflow']}px)")
    check(facts["stageBar"] == 0, "no reference-led stage strip")
    check(facts["intent"] == 0 and facts["workStack"] == 0, "no intent control and no stage workspace")
    check(facts["referenceControls"] == 0, "no reference upload or selection in the panel")
    check(facts["buttonHeight"] >= 44, f"Generate is a {facts['buttonHeight']}px touch target")
    check(facts["buttonInside"] and facts["buttonReachable"], "Generate sits inside the viewport and is not covered by the Activity bar")
    check(page.get_by_text("No reference required.").count() == 1, "the one-line explanation appears once")

    # 4. image
    editor = page.locator(".broll-prompt")
    editor.fill(PROMPT)
    page.locator(".broll-output-option", has_text="Image").click()
    page.locator(".broll-generate").click()
    page.wait_for_selector("#fal-frame-submit:not([disabled])", timeout=20000)
    dialog = page.locator(".h3-generation-modal")
    check(dialog.locator("h3").first.inner_text().strip() == "Create B-roll image", "image dialog names B-roll")
    check(dialog.locator(".gen-options").count() == 0, "image dialog lists no other models")
    simple_dialog(page, dialog, "image", "GPT Image 2 via fal · Text to image")
    before = len(provider_calls)
    page.locator("#fal-frame-submit").click()
    page.wait_for_function("() => /image.*returned/i.test(document.querySelector('[data-broll-job]')?.innerText || '')", timeout=30000)
    check(len(provider_calls) == before + 1, "one image request reached the provider")

    # 4. video, opened while a notice about the previous request is still on screen. The
    #    notice is pinned so this cannot pass merely because it timed out on its own.
    page.locator(".broll-output-option", has_text="Video").click()
    page.evaluate("() => { toast('2 FAL images returned'); clearTimeout(document.getElementById('toast')._h); }")
    check(page.locator("#toast").is_visible(), "a notice about the previous request is showing")
    page.locator(".broll-generate").click()
    page.wait_for_function("() => document.getElementById('fal-h3-submit') && !document.getElementById('fal-h3-submit').disabled", timeout=20000)
    check(not page.locator("#toast").is_visible(), "opening a paid confirmation clears the stale notice")
    dialog = page.locator(".h3-generation-modal")
    check(dialog.locator("h3").first.inner_text().strip() == "Create B-roll video", "video dialog names B-roll")
    check(dialog.locator(".gen-options").count() == 0, "video dialog lists no other models")
    check(not page.locator("#fal-h3-sequence").is_visible(), "video dialog draws no empty provider-input panel")
    simple_dialog(page, dialog, "video", "MiniMax H3 via fal · Text to video · 5s · 768P · 16:9")
    note = page.locator("#fal-h3-duration-notice")
    check(note.inner_text().strip() == "This shot is 4 seconds; this route supports 5–15 seconds. A 5-second result is selected.", "the duration mismatch is one truthful sentence")
    box, view = page.locator("#fal-h3-duration").bounding_box(), page.viewport_size
    check(box and box["y"] >= 0 and box["y"] + box["height"] <= view["height"], f"the duration setting is on screen when the dialog opens (y={box and round(box['y'])})")
    # Advanced keeps every detail, and the view comes back to Simple for the next dialog.
    dialog.locator(".gen-view-tab", has_text="Advanced").click()
    check(dialog.locator(".gen-view-always").is_visible() and dialog.locator(".h3-prompt-editor").is_visible(), "Advanced still shows the model, route and cost cards and the prompt")
    check("first/last frame" not in dialog.inner_text(), "and never describes a frame input")
    dialog.locator(".gen-view-tab", has_text="Simple").click()
    check(not dialog.locator(".h3-prompt-editor").is_visible(), "back in Simple, the detail is put away again")
    page.locator("#fal-h3-submit").click()
    page.wait_for_function("() => /video.*returned/i.test(document.querySelector('[data-broll-job]')?.innerText || '')", timeout=45000)
    check(len(provider_calls) == before + 2, "one video request reached the provider")
    facts = layout_facts(page)
    check(facts["overflow"] <= 0, "still no horizontal overflow with results returned")

    # 5. what the provider was sent
    image_call, video_call = provider_calls[before], provider_calls[before + 1]
    check(image_call["endpoint"] == "/openai/gpt-image-2", "image went to text-to-image, never /edit")
    check(video_call["endpoint"] == "/minimax/h3/text-to-video", "video went to text-to-video")
    check(image_call["authorized"] and video_call["authorized"], "both carried the configured key")
    for call, name in ((image_call, "image"), (video_call, "video")):
        body = call["body"]
        check(not any(key in body for key in ("image_url", "image_urls", "mask_url", "end_image_url", "reference_image_urls")), f"{name} request carries no image input")
        check(STYLE in body["prompt"] and PROMPT in body["prompt"], f"{name} request carries the project style and the written prompt")

    # 6. back to reference-led
    page.locator(".shot-reference-mode-option", has_text="Reference-led").click()
    page.wait_for_selector(".shot-intent-control")
    check(page.locator("[data-broll-panel]").count() == 0, "reference-led removes the B-roll panel")
    page.wait_for_selector(".cb-stage-bar", timeout=10000)
    check(True, "and the stage strip returns")
    check(not errors, f"no console errors: {errors}")
    page.close()

sandbox = pathlib.Path(tempfile.mkdtemp(prefix="cinebraid-broll-browser-"))
server = None
try:
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label=LABEL)
        for width, height in ((1440, 1000), (390, 844)):
            server, base = start(sandbox / f"w{width}")
            try:
                walk(browser, base, width, height)
            finally:
                server.kill(); server.wait(timeout=10); server = None
        browser.close()
    print(f"\n{LABEL} passed: the B-roll route works end to end at 1440px and 390px with a local provider only.")
finally:
    if server: server.kill()
    provider.shutdown()
    shutil.rmtree(sandbox, ignore_errors=True)
