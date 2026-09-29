"""Selected-state upload: real picker, intake, binding, reload and keyboard checks.

Uses only disposable config/projects. No provider requests are allowed.
Set CINEBRAID_UPLOAD_BASELINE=1 to capture the unchanged discovery path.
"""
import base64, json, os, pathlib, socket, subprocess, tempfile, time
from browser_runtime import disposable_workspace, require_browser, launch_chromium

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASELINE = os.environ.get("CINEBRAID_UPLOAD_BASELINE") == "1"
OUTPUT = pathlib.Path(os.environ.get("CINEBRAID_UPLOAD_EVIDENCE", tempfile.mkdtemp(prefix="cinebraid-upload-evidence-")))
OUTPUT.mkdir(parents=True, exist_ok=True)
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
ENTITY, STATE, SLUG = "LOC-BATTLEFIELD", "state-sky-cracked", "upload-fixture"
workspace = disposable_workspace("continuity-upload", sample=False, active_project=SLUG, profile=True)
project_dir = pathlib.Path(workspace.projects_root) / SLUG
for folder in ("plates", "anchors", "props", "vehicles", "audio", "media", "docs", "shots"):
    (project_dir / folder).mkdir(parents=True, exist_ok=True)
(project_dir / "plates" / "LOC-BATTLEFIELD-DEFAULT.png").write_bytes(PNG)
receipt = {"id":"authority-000001", "sequence":1, "actor":"human", "act":"explicit-approval",
    "command":"approve-entity-state", "kind":"entity-state", "list":"locations", "entityId":ENTITY,
    "stateId":"state-default", "value":"LOC-BATTLEFIELD-DEFAULT.png", "assetId":"",
    "targetKey":f"entity-state:locations:{ENTITY}#state-default", "status":"current",
    "at":"2026-09-28T00:00:00.000Z", "provenance":{"manualAction":"fixture", "gesture":"click"}}
entity = {"id":ENTITY, "name":"Torn-up battlefield", "prefix":ENTITY, "status":"APPROVED",
    "block":"A torn-up battlefield.", "approvedFile":"LOC-BATTLEFIELD-DEFAULT.png", "candidateFiles":[],
    "coverageSlots":[], "continuityStates":[
        {"id":"state-default", "name":"Default", "isDefault":True, "approvedFile":"LOC-BATTLEFIELD-DEFAULT.png"},
        {"id":STATE, "name":"Sky cracked", "referenceRequirement":"required",
         "notes":"The sky cracks and a pillar of golden light shoots up as the ground shakes; the layout is otherwise unchanged."},
        {"id":"state-other", "name":"After rain", "notes":"Rain darkens the ground."}]}
document = {"meta":{"title":"Disposable upload investigation", "schemaVersion":"6.7"},
    "locations":[entity], "characters":[], "props":[], "vehicles":[], "audio":[], "shots":[
        {"id":"SH-01", "scene":"SC-01", "title":"Sky cracks", "codes":[ENTITY], "characters":[], "keyframes":[{"id":"fr-sky","label":"A","description":"The sky cracks.","winner":""}],
         "creationBrief":{"locationId":ENTITY}, "continuityStateSelections":{ENTITY:STATE}}],
    "scenes":[{"id":"SC-01","title":"Battlefield"}], "mediaAssets":[], "jobs":[], "agentRuns":[], "decisions":[], "sessions":[],
    "productionAuthority":{"version":1,"receipts":[receipt]}}
project_file = project_dir / "project.json"
project_file.write_text(json.dumps(document), encoding="utf-8")
sock = socket.socket(); sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]; sock.close()
env = workspace.env(port, CINEBRAID_BROWSER_REQUIRED="1")
server = subprocess.Popen(["node","server.js"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
results=[]; errors=[]; forbidden=[]
try:
    deadline=time.time()+30
    while time.time()<deadline:
        try:
            with socket.create_connection(("127.0.0.1",port),.2): break
        except OSError: time.sleep(.1)
    else: raise RuntimeError("Disposable server failed to start")
    base=f"http://127.0.0.1:{port}"
    with require_browser("continuity upload discovery")() as pw:
        browser=launch_chromium(pw,label="continuity upload discovery")
        context=browser.new_context()
        def guard(route):
            url=route.request.url
            if BASELINE and any(url.split("?")[0].endswith("/"+name) for name in ("entities.js","reference-desk.css")):
                name=url.split("?")[0].rsplit("/",1)[1]
                body=subprocess.check_output(["git","show","HEAD:public/"+name],cwd=ROOT)
                return route.fulfill(status=200,content_type="text/css" if name.endswith("css") else "application/javascript",body=body)
            if url.startswith(base) and not ("/api/generation/" in url and route.request.method=="POST"):
                route.continue_()
            elif url.startswith("https://fonts."):
                route.fulfill(status=200,content_type="text/css",body="")
            else:
                forbidden.append(url);route.abort()
        context.route("**/*",guard)
        page=context.new_page();page.on("pageerror",lambda error:errors.append(str(error)))
        def open_state(state=STATE):
            page.goto(base+f"/#/location/{ENTITY}/tools")
            try: page.wait_for_selector("[data-reference-tools]", timeout=12000)
            except Exception:
                print(page.locator("body").inner_text()[:6000], errors, flush=True)
                page.screenshot(path=str(OUTPUT/"failure.png"))
                raise
            page.wait_for_function("() => document.body.dataset.renderReady === '1' && P.locations?.length === 1")
            task=page.locator('.bounded-entity-taskbar button').filter(has_text='Production needs')
            task.press('Enter') if page.viewport_size['width']==390 else task.click()
            page.wait_for_selector('[data-bounded-task="coverage"]')
            selector=page.locator('.continuity-state-rail button').filter(has_text={'state-default':'Default', STATE:'Sky cracked', 'state-other':'After rain'}[state])
            selector.press('Enter') if page.viewport_size['width']==390 else selector.click()
            page.wait_for_timeout(500)  # Wait for shipped route/focus/scroll restoration.
            card=page.locator(f'[data-continuity-state-id="{state}"]')
            try: card.wait_for(timeout=8000)
            except Exception:
                print(page.locator("body").inner_text()[:7000], errors, flush=True)
                page.screenshot(path=str(OUTPUT/"failure-state.png"))
                raise
            card.scroll_into_view_if_needed()
            return card
        for width in (1440,390):
            page.set_viewport_size({"width":width,"height":900 if width==1440 else 844})
            card=open_state()
            upload=card.get_by_role("button",name="Upload image",exact=True)
            upload.wait_for()
            if not BASELINE:
                assert card.locator('.cs-head').get_by_role('button',name='Upload image',exact=True).count()==1
                assert upload.get_attribute('aria-describedby')
                assert "Sky cracked" in card.locator('.cs-upload').inner_text()
                assert "not approved" in card.locator('.cs-upload').inner_text()
                source=card.locator('.state-derivation-missing>header')
                assert source.locator('p').count()==3, 'Status, relationship and explanation need explicit paragraph breaks'
                status=source.locator('span').bounding_box()
                relation=source.locator('b').bounding_box()
                explanation=source.locator('small').bounding_box()
                assert status['y']+status['height']+4 <= relation['y'], 'Source status must be separate from the relationship'
                assert relation['y']+relation['height']+4 <= explanation['y'], 'Source relationship must be separate from the explanation'
            # Real Tab traversal from the state name, through all intervening controls.
            card.locator('.cs-name').focus();tabs=[]
            for _ in range(40):
                page.keyboard.press('Tab')
                tabs.append(page.evaluate("() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName"))
                if upload.evaluate('(el)=>el===document.activeElement'): break
            else: raise AssertionError('Upload is not keyboard reachable')
            upload.scroll_into_view_if_needed()
            page.screenshot(path=str(OUTPUT/f'{"before" if BASELINE else "after"}-{width}.png'))
            card.screenshot(path=str(OUTPUT/f'{"before" if BASELINE else "after"}-{width}-state.png'))
            assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
            geometry=upload.bounding_box()
            assert geometry['x']>=0 and geometry['x']+geometry['width']<=width
            if not BASELINE: assert geometry['height']>=44
            with page.expect_file_chooser(timeout=8000) as chooser: upload.press('Enter')
            chooser.value.set_files({"name":f"sky-{width}.png","mimeType":"image/png","buffer":PNG})
            page.wait_for_selector('#in-structure')
            assert 'TARGET · Sky cracked' in page.locator('#modal').inner_text()
            page.screenshot(path=str(OUTPUT/f'{"before" if BASELINE else "after"}-{width}-intake.png'))
            # Keyboard completes the declared file type and import.
            page.locator('#in-structure').focus();page.keyboard.press('Home');page.keyboard.press('ArrowDown');page.keyboard.press('Tab')
            page.wait_for_function("() => !document.getElementById('in-submit').disabled")
            page.locator('#in-submit').press('Enter')
            page.wait_for_function("() => document.getElementById('modal').classList.contains('hidden')",timeout=30000)
            page.wait_for_function("name => P.locations[0].candidateFiles.some(row => row.original === name)", arg=f"sky-{width}.png", timeout=30000)
            page.wait_for_function("() => SAVE_REVISION === SAVED_REVISION && !PROJECT_CONFLICT",timeout=30000)
            page.wait_for_function("() => !window._pendingEntityStateUpload")
            stored=json.loads(project_file.read_text(encoding='utf-8-sig'))
            loc=stored['locations'][0];row=next(r for r in loc['candidateFiles'] if r['original']==f'sky-{width}.png')
            assert row['targetStateId']==STATE and row['targetStateName']=='Sky cracked'
            assert (project_dir/'plates'/row['stored']).exists()
            assert len(stored['productionAuthority']['receipts'])==1
            assert not next(s for s in loc['continuityStates'] if s['id']==STATE).get('approvedFile')
            page.reload()  # Re-read the saved project and scan; no in-memory proof.
            card=open_state()
            assert card.locator('.continuity-candidate-grid').get_by_text(row['stored'],exact=False).count() or row['stored'] in card.inner_html()
            for other in ('state-default','state-other'):
                other_card=open_state(other)
                assert row['stored'] not in other_card.locator('.continuity-candidate-tray').inner_html()
            results.append({'width':width,'tabsFromStateName':tabs,'button':geometry,'target':STATE,'original':row['original'],
                'candidatePersistsAfterReload':True,'defaultAndOtherStateUnaffected':True,'noApprovalReceiptAdded':True,
                'sourceNoticeSeparated':not BASELINE})
        assert not errors,errors
        assert not forbidden,forbidden
        browser.close()
    (OUTPUT/f'{"before" if BASELINE else "after"}-checks.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(results,indent=2))
finally:
    server.terminate();server.wait(timeout=10);workspace.cleanup()
