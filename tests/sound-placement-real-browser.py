#!/usr/bin/env python3
"""Disposable shot sound placement journey with exact approved audio bytes."""
import hashlib, json, os, pathlib, shutil, socket, struct, subprocess, tempfile, time, urllib.request, wave
from browser_runtime import require_browser, launch_chromium, disposable_workspace

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ.get("CINEBRAID_SOUND_SCREENSHOTS") or tempfile.mkdtemp(prefix="cinebraid-sound-captures-"))
OUT.mkdir(parents=True, exist_ok=True)
SLUG = "sound-placement-journey"
workspace = disposable_workspace("sound-placement", sample=False, active_project=SLUG)
project_dir = workspace.projects_root / SLUG
shutil.copytree(ROOT / "projects/cinebraid-sample", project_dir)
project_file = project_dir / "project.json"
project = json.loads(project_file.read_text(encoding="utf-8"))
project["audio"] = [{"id":"AUDIO-DOOR","name":"Door ambience","prefix":"AUDIO-DOOR",
                     "candidateFiles":[],"continuityStates":[{"id":"state-default","name":"Default","isDefault":True}]}]
project_file.write_text(json.dumps(project), encoding="utf-8")
recording = workspace.home / "door.wav"
with wave.open(str(recording), "wb") as stream:
    stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(16000)
    stream.writeframes(b"".join(struct.pack("<h", 500 if i % 100 < 50 else -500) for i in range(16000)))
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
base = "http://127.0.0.1:" + str(port)
log = open(OUT / "server.log", "w", encoding="utf-8")
server = subprocess.Popen(["node","server.js"], cwd=ROOT, env=workspace.env(port),
                          stdout=log, stderr=log, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
checks, errors, blocked = [], [], []
def check(name, truth):
    checks.append({"check":name,"passed":bool(truth)})
    if not truth: raise AssertionError(name)
def disk(): return json.loads(project_file.read_text(encoding="utf-8"))
def capture(page, name):
    page.locator("#toast").wait_for(state="hidden")
    page.evaluate("window.scrollTo(0,0)")
    for width, height, label in [(1440,1000,"desktop"),(390,844,"mobile")]:
        page.set_viewport_size({"width":width,"height":height})
        page.screenshot(path=str(OUT / (name+"-"+label+".png")), full_page=True)
        check(name+" "+label+" no horizontal overflow",
              page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    page.set_viewport_size({"width":1440,"height":1000})
try:
    for _ in range(80):
        try: urllib.request.urlopen(base+"/api/project", timeout=1); break
        except Exception: time.sleep(.2)
    with require_browser("Shot sound placement")() as pw:
        browser = launch_chromium(pw, label="Shot sound placement")
        context = browser.new_context(viewport={"width":1440,"height":1000}, reduced_motion="reduce")
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        def guard(route):
            if route.request.method == "POST" and any(part in route.request.url for part in
               ["/api/generation/","/api/agents/","/api/automation/"]):
                blocked.append(route.request.url); route.abort()
            else: route.continue_()
        context.route("**/api/**", guard)
        page.goto(base+"/#/sound/AUDIO-DOOR", wait_until="networkidle")
        page.locator("#entity-file").set_input_files(str(recording))
        page.locator("#in-submit").click()
        page.wait_for_selector(".audio-candidate")
        page.get_by_role("button", name="Review recording…", exact=True).click()
        page.wait_for_function('()=>!document.getElementById("entity-approve-confirm").disabled')
        page.locator("#entity-approve-confirm").click()
        page.wait_for_function("()=>!approvalSubmissionPending() && projectSaveSettled().settled")
        receipt = next(row for row in disk()["productionAuthority"]["receipts"] if row.get("list") == "audio" and row.get("status") == "current")
        check("recording approved with receipt and asset identity", bool(receipt.get("assetId")))
        shot_id = disk()["shots"][0]["id"]
        page.goto(base+"/#/shot/"+shot_id, wait_until="networkidle")
        page.locator(".sound-placement").wait_for()
        check("approval did not place recording", not disk()["shots"][0].get("soundPlacements"))
        page.locator(".sound-placement summary").click()
        page.locator("[data-sound-source]").wait_for()
        capture(page,"01-before-placement")
        page.locator("[data-sound-source]").select_option(index=1)
        page.locator("[data-sound-role]").select_option("ambience")
        page.locator("[data-sound-timing]").select_option("at-cue")
        page.locator("[data-sound-cue]").fill("Door closes at 00:03; hold under the exit.")
        page.get_by_role("button", name="Place recording").click()
        page.wait_for_function("()=>projectSaveSettled().settled")
        placed = disk()["shots"][0]["soundPlacements"]
        check("shot saves exact receipt and intent", len(placed)==1 and placed[0]["receiptId"]==receipt["id"]
              and placed[0]["assetId"]==receipt["assetId"] and placed[0]["role"]=="ambience"
              and placed[0]["timing"]=="at-cue" and "00:03" in placed[0]["cue"])
        check("placement did not create approval", len([r for r in disk()["productionAuthority"]["receipts"] if r.get("list")=="audio"])==1)
        check("placement visible with player", page.locator("[data-sound-placement] audio").count()==1)
        page.reload(wait_until="networkidle")
        check("reload retains placement and intent", page.locator("[data-sound-placement]").count()==1
              and "00:03" in page.locator("[data-sound-placement]").inner_text())
        capture(page,"02-after-placement")
        response = context.request.get(base+"/api/bible")
        doc = response.json()
        target = next(t for shot in doc["shots"] if shot["id"]==shot_id for t in shot["targets"] if t.get("kind")=="shot-sound-placement")
        check("Approved record carries source identity, role, timing", target["assetId"]==receipt["assetId"]
              and target["receiptId"]==receipt["id"] and target["placement"]["audioEntityId"]=="AUDIO-DOOR"
              and target["placement"]["role"]=="ambience" and "00:03" in target["placement"]["cue"]
              and target["media"]["available"])
        export = context.request.get(base+"/api/bible/export?preset=approved").text()
        check("Approved export carries role and timing", "Sound role: ambience" in export and "00:03" in export)
        page.goto(base+"/bible.html", wait_until="networkidle")
        check("Approved viewer shows placement", page.get_by_text("Placed approved recording", exact=True).count()==1
              and page.get_by_text("Role · ambience", exact=False).count()==1)
        source = project_dir / "audio" / receipt["value"]
        original = source.read_bytes(); stat = source.stat()
        changed = bytearray(original); changed[100] ^= 1
        source.write_bytes(changed); os.utime(source, ns=(stat.st_atime_ns,stat.st_mtime_ns))
        page.goto(base+"/#/shot/"+shot_id, wait_until="networkidle")
        page.locator("#rescan").click()
        page.get_by_text("Local folders synced", exact=True).wait_for()
        page.reload(wait_until="networkidle")
        check("replaced original keeps intent but withholds playback",
              page.locator("[data-sound-placement]").count()==1
              and page.locator("[data-sound-placement] audio").count()==0
              and "unavailable" in page.locator("[data-sound-placement]").inner_text().lower())
        capture(page,"03-original-replaced")
        after = context.request.get(base+"/api/bible").json()
        target_after = next(t for shot in after["shots"] if shot["id"]==shot_id for t in shot["targets"] if t.get("kind")=="shot-sound-placement")
        check("Approved record preserves identity and marks unavailable",
              target_after["assetId"]==receipt["assetId"] and not target_after["media"]["available"])
        source.unlink()
        page.locator("#rescan").click()
        page.get_by_text("Local folders synced", exact=True).wait_for()
        page.reload(wait_until="networkidle")
        check("missing original keeps placement but withholds playback",
              page.locator("[data-sound-placement]").count()==1
              and page.locator("[data-sound-placement] audio").count()==0)
        page.locator("[data-sound-remove]").click()
        page.wait_for_function("()=>projectSaveSettled().settled")
        check("removing placement leaves recording approved",
              not disk()["shots"][0].get("soundPlacements")
              and len([r for r in disk()["productionAuthority"]["receipts"] if r.get("list")=="audio"])==1)
        forged = disk()
        forged["shots"][0]["soundPlacements"].append({
            "id":"forged","audioEntityId":"AUDIO-DOOR","receiptId":"not-approved",
            "assetId":receipt["assetId"],"sourceName":receipt["value"],
            "role":"music","timing":"throughout","cue":"forged intent"})
        project_file.write_text(json.dumps(forged), encoding="utf-8")
        check("unapproved placement cannot enter Approved record",
              len([t for shot in context.request.get(base+"/api/bible").json()["shots"]
                   for t in shot["targets"] if t.get("kind")=="shot-sound-placement"])==0)
        check("browser has no page errors or provider submissions", not errors and not blocked)
        browser.close()
    print(json.dumps({"captures":str(OUT),"checks":checks,"errors":errors,"blocked":blocked},indent=2))
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    log.close()
