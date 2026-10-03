"""Native repair authoring/review on disposable data. No provider dispatch."""
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import time
from browser_runtime import require_browser, launch_chromium, disposable_workspace

ROOT = pathlib.Path(__file__).resolve().parents[1]
sync_playwright = require_browser("Native candidate repair")
workspace = disposable_workspace("native-candidate-repair-browser", active_project="repair-fixture")
server = None
try:
    subprocess.run(["node", "tests/helpers/native-candidate-repair-fixture.js", str(workspace.projects_root)], cwd=ROOT, check=True)
    inputs = json.loads((workspace.projects_root / "repair-inputs.json").read_text())
    project_file = workspace.projects_root / "repair-fixture" / "project.json"
    initial = project_file.read_bytes()
    cfg = json.loads(workspace.config_path.read_text())
    cfg.setdefault("generation", {}).setdefault("fal", {}).update({"enabled": True, "frameResolution": "2k", "frameQuality": "high"})
    workspace.config_path.write_text(json.dumps(cfg))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=workspace.env(port, FAL_KEY="native-repair-disposable-readiness"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.time() + 25
    while time.time() < deadline:
        if server.poll() is not None:
            raise RuntimeError(server.communicate())
        try:
            with socket.create_connection(("127.0.0.1", port), .2): break
        except OSError: time.sleep(.1)
    else: raise RuntimeError("Disposable server did not become ready")
    base = f"http://127.0.0.1:{port}"
    with sync_playwright() as pw:
        browser = launch_chromium(pw, label="Native candidate repair")
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors, dispatched = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        def guard(route):
            url = route.request.url
            if not url.startswith(base): raise AssertionError("Nonlocal request forbidden: " + url)
            if url.endswith("/api/generation/fal/jobs") and route.request.method == "POST":
                dispatched.append(url); route.abort(); raise AssertionError("Dispatch forbidden")
            route.continue_()
        page.route("**/*", guard)
        page.goto(base + "/#/shot/SH-1")
        try:
            page.wait_for_function("typeof openCandidateReview === 'function' && typeof P !== 'undefined' && P?.shots?.some(s=>s.id==='SH-1')")
        except Exception:
            print("Startup diagnostics:", errors, page.locator("body").inner_text()[:1500], page.request.get(base + "/api/project").text()[:1500])
            raise
        # Settle the shipped Shot Desk's existing read-time defaults/save before
        # measuring repair. Repair must not be credited/blamed for initial hydration.
        page.evaluate("async () => { await flushPendingProjectSave(); }")
        page.wait_for_function("projectSaveSettled().settled")
        original = project_file.read_bytes()
        assert json.loads(original)["productionAuthority"] == json.loads(initial)["productionAuthority"]
        # Candidate Review is the shipped Results revise workspace. The same entry is
        # invoked here after loading the exact shot; no private repair shortcut.
        page.evaluate("openCandidateReview('SH-1','FR-A','BASE.png')")
        page.get_by_role("button", name="REPAIR CURRENT CANDIDATE", exact=True).click()
        page.locator("#candidate-repair").wait_for()
        page.get_by_role("button", name="Cancel", exact=True).first.click()
        assert project_file.read_bytes() == original, "Cancel must not save review/Canon/approval"
        page.evaluate("openCandidateReview('SH-1','FR-A','BASE.png')")
        page.get_by_role("button", name="REPAIR CURRENT CANDIDATE", exact=True).click()
        page.locator("#candidate-repair").wait_for()
        page.keyboard.press("Escape")
        assert project_file.read_bytes() == original, "Escape must not write production data"
        # Hold both successful and failed inventory responses until a newer modal
        # owns the UI. Release is explicit; no elapsed-time race is used.
        for fail in [False, True]:
            pending = []
            def hold_inventory(route): pending.append(route)
            page.route("**/api/generation/candidate-repair/inputs?*", hold_inventory)
            with page.expect_request("**/api/generation/candidate-repair/inputs?*"):
                page.evaluate("() => { window._repairInventoryAwait = openNativeCandidateRepair('SH-1','FR-A','BASE.png'); }")
            page.wait_for_function("document.querySelector('#modal')?.textContent.includes('Loading exact candidate')")
            assert pending
            page.evaluate("openModal('<h3>Newer owner workspace</h3>')")
            if fail: pending[0].fulfill(status=409, json={"error": "Controlled obsolete response"})
            else:
                result = page.request.get(pending[0].request.url).json()
                pending[0].fulfill(json=result)
            page.evaluate("async () => { await window._repairInventoryAwait; }")
            assert page.get_by_role("heading", name="Newer owner workspace").is_visible()
            assert project_file.read_bytes() == original
            page.unroute("**/api/generation/candidate-repair/inputs?*", hold_inventory)
            page.evaluate("closeModal()")
        page.evaluate("openCandidateReview('SH-1','FR-A','BASE.png')")
        page.get_by_role("button", name="REPAIR CURRENT CANDIDATE", exact=True).click()
        page.locator("#candidate-repair").wait_for()
        page.locator("#repair-change").fill(inputs["change"])
        page.locator("#repair-preserve").fill(inputs["preserve"])
        page.locator("#repair-avoid").fill(inputs["avoid"])
        for checkbox in page.locator("[id^=repair-choose-]").all(): checkbox.check()
        page.locator("#repair-guide").set_input_files(str(workspace.projects_root / "guide.png"))
        page.locator("#repair-guide-instruction").fill(inputs["guide"]["instruction"])
        page.locator("#repair-mask").set_input_files(str(workspace.projects_root / "mask.png"))
        page.locator("#repair-mask-convention").select_option("alpha-transparent-edit")
        page.wait_for_function("document.querySelector('#repair-order')?.textContent.includes('Image 5')")
        assert "Image 1 — BASE.png" in page.locator("#repair-order").inner_text()
        evidence = os.environ.get("CINEBRAID_REPAIR_EVIDENCE")
        if evidence: pathlib.Path(evidence).mkdir(parents=True, exist_ok=True)
        for width in [1440, 1024, 390]:
            page.set_viewport_size({"width": width, "height": 1000 if width > 390 else 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), f"page overflow at {width}"
            if evidence: page.screenshot(path=str(pathlib.Path(evidence) / f"repair-authoring-{width}.png"))
        page.set_viewport_size({"width": 1440, "height": 1000})
        pending_preview = []
        def hold_preview(route): pending_preview.append(route)
        page.route("**/api/generation/fal/image/plan", hold_preview)
        page.evaluate("() => { const shipped = buildNativeCandidateRepair; window.buildNativeCandidateRepair = () => { window._repairBuildAwait = shipped(); return window._repairBuildAwait; }; }")
        with page.expect_request("**/api/generation/fal/image/plan"):
            page.get_by_role("button", name="Build repair package", exact=True).click()
        page.get_by_role("heading", name="Repair package built").wait_for(timeout=20000)
        page.wait_for_function("document.querySelector('#modal')?.textContent.includes('Preparing exact native input review')")
        assert pending_preview
        request = pending_preview[0].request
        response = page.request.post(request.url, data=request.post_data_json).json()
        build_id = request.post_data_json["sourceBuildId"]
        page.evaluate("openModal('<h3>Newer owner workspace</h3>')")
        pending_preview[0].fulfill(json=response)
        page.evaluate("async () => { await window._repairBuildAwait; }")
        assert page.get_by_role("heading", name="Newer owner workspace").is_visible()
        page.unroute("**/api/generation/fal/image/plan", hold_preview)
        page.evaluate("id => openFalFrameGenerationModal('correction','SH-1','FR-A',id)", build_id)
        page.locator("#fal-frame-prompt-editor").wait_for(timeout=20000)
        page.wait_for_function("window._falFrameRequest?.planFingerprint && window._falFrameRequest?.purpose === 'correction'")
        review = page.evaluate("window._falFrameRequest")
        assert review["mode"] == "inpaint"
        assert review["references"][0]["assetId"] == inputs["baseAssetId"]
        assert len(review["dispatch"]["bindings"]) == 6
        assert all(r.get("authority") for r in review["references"])
        for width in [1440, 1024, 390]:
            page.set_viewport_size({"width": width, "height": 1000 if width > 390 else 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            if evidence: page.screenshot(path=str(pathlib.Path(evidence) / f"repair-review-{width}.png"))
        if evidence:
            (pathlib.Path(evidence) / "DISPOSABLE_NATIVE_REVIEW.json").write_text(json.dumps(review, indent=2))
        after = json.loads(project_file.read_text())
        before = json.loads(original)
        assert after["productionAuthority"] == before["productionAuthority"]
        assert after["shots"][0]["desc"] == before["shots"][0]["desc"]
        assert not after["shots"][0]["keyframes"][0].get("winner")
        assert not dispatched
        assert not errors, errors
        browser.close()
    print("Native candidate repair browser PASS: Cancel/Escape purity, explicit current selections, technical imports, normal Build/review, 1440/1024/390; no dispatch")
finally:
    if server:
        server.terminate()
        try: server.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            server.kill(); server.communicate(timeout=3)
    workspace.cleanup()
