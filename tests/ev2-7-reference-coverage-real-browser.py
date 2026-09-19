#!/usr/bin/env python3
"""EV2-7 Build coverage acceptance (advisory). Synthetic disposable projects only.

What a person does on the Reference Desk, end to end, against the real server:
  * a view opens Build coverage with the exact entity/state/view target;
  * the coverage status carries a derived next action that names the exact next missing view and opens it;
  * a view with no results says so instead of offering an empty Review page, and approval is stated in words;
  * a nondefault enrollment keeps the Default state's legacy selection on disk;
  * a selected declared sheet offers to crop views from it (a secondary action) and no approval;
  * guided crop -> exact assignment binds the crop's own asset, with one crop file;
  * an enrollment the server saved but whose response is lost (a 500) is re-read on retry and reused: one request, one binding, one crop;
  * an edit still waiting to save when the picker opens is saved, and the picker still adds;
  * nothing is approved: new rows are unreviewed and no authority receipt is written;
  * Generate is unavailable, with its reason, for a state that has no approval.
Paid and provider routes are aborted by the route guard; the port is always free and never 4477.
"""
import json, os, pathlib, re, socket, struct, subprocess, sys, time, zlib, urllib.request, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_runtime import require_browser, launch_chromium, disposable_workspace, canon_receipts

def free_port():
    while True:
        sock=socket.socket();sock.bind(("127.0.0.1",0));port=sock.getsockname()[1];sock.close()
        if port!=4477:return port

def png(width,height,rgb,panels=1):
    def chunk(kind,data):
        body=kind+data
        return struct.pack(">I",len(data))+body+struct.pack(">I",zlib.crc32(body)&0xFFFFFFFF)
    raw=b""
    for y in range(height):
        row=bytearray()
        for x in range(width):
            panel=int(x*panels/width)
            shade=.5+.5*(panel+1)/panels
            color=tuple(int(c*shade) for c in rgb)
            if panels>1 and abs(x-(panel+.5)*width/panels)<width/(panels*6) and height*.2<y<height*.85:color=(20,24,28)
            row.extend(color)
        raw+=b"\x00"+bytes(row)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")

def iso(day):
    return f"2026-09-{day:02d}T12:00:00.000Z"

SLUG="ev2-7-coverage-qa"
def build_fixture(projects_root):
    root=projects_root/SLUG
    for sub in ("anchors","plates","props","vehicles","audio","media","docs"):
        (root/sub).mkdir(parents=True,exist_ok=True)
    (root/"anchors/KAI_DEFAULT_V001.png").write_bytes(png(320,200,(58,96,74)))
    (root/"anchors/KAI_FRONT_LEGACY.png").write_bytes(png(320,200,(70,78,96)))
    (root/"anchors/KAI_TURNAROUND.png").write_bytes(png(960,240,(96,90,80),panels=3))
    (root/"media/weathered-front.png").write_bytes(png(320,200,(104,70,52)))
    project={
        "meta":{"id":SLUG,"title":"EV2-7 coverage QA","version":"6.9.0-alpha.1","code":"E7CQ","styleBlocks":[],"iterBudget":{"A":12,"B":3},
                "world":{"setting":"","include":"","reject":""},"refSyntax":"@imageN","models":[],"aiPolicy":"project-default","workflowEmphasis":"manual"},
        "scenes":[{"id":"SC01","title":"Hull","tier":"A","whatHappens":"","howItFeels":""}],
        "shots":[],"locations":[],"props":[],"vehicles":[],"audio":[],
        "mediaAssets":[{"id":"media-weathered-front","file":"weathered-front.png","kind":"image","title":"Weathered front study","createdAt":iso(2),"links":[]}],
        "characters":[{
            "id":"KAI","name":"Kai","prefix":"KAI","block":"Kai identity block","status":"IN PROGRESS","workflowStatus":"IN PROGRESS",
            "approvedFile":"KAI_DEFAULT_V001.png","approvedAt":iso(1),
            "continuityStates":[{"id":"state-default","name":"Default","isDefault":True,"approvedFile":"KAI_DEFAULT_V001.png","approvedAt":iso(1)},
                                {"id":"state-weathered","name":"Weathered","isDefault":False,"approvedFile":""}],
            # The Default Front is an earlier selection nobody scoped to a state.
            "coverageSlots":[{"id":"front","label":"Front","requirement":"required","selectedFile":"KAI_FRONT_LEGACY.png","status":"selected"},
                             {"id":"side","label":"Side","requirement":"required","selectedFile":""}],
            "candidateFiles":[
                {"stored":"KAI_DEFAULT_V001.png","addedAt":iso(1),"decision":"approved-reference","coverageJobType":"single-reference"},
                {"stored":"KAI_FRONT_LEGACY.png","addedAt":iso(1),"decision":"unreviewed","coverageJobType":"single-reference"},
                {"stored":"KAI_TURNAROUND.png","addedAt":iso(2),"decision":"unreviewed","coverageJobType":"sheet","coverageSheetType":"angles","sheetExtractionOverrideConfirmed":True},
            ]}],
    }
    project["productionAuthority"]=canon_receipts([
        {"kind":"entity-state","list":"characters","entityId":"KAI","stateId":"state-default","value":"KAI_DEFAULT_V001.png"},
    ],via="ev2-7-coverage-fixture")
    (root/"project.json").write_text(json.dumps(project,indent=2)+"\n",encoding="utf-8")
    return root

OUT=pathlib.Path(os.environ.get('EV2_ACCEPTANCE_DIR') or tempfile.mkdtemp(prefix='cinebraid-ev2-7-coverage-captures-'))
OUT.mkdir(parents=True,exist_ok=True)
workspace=disposable_workspace('ev2-7-coverage',sample=False,active_project=SLUG)
project_root=build_fixture(workspace.projects_root)
port=free_port();base=f'http://127.0.0.1:{port}'
log=open(OUT/'runtime.log','w',encoding='utf-8')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=workspace.env(port),stdout=log,stderr=log)
checks=[];errors=[];blocked=[];enroll_failures={'remaining':0};enroll_posts=[]
def check(name,value):
    checks.append({'check':name,'passed':bool(value)})
    if not value:raise AssertionError(name)
def disk():
    return json.loads((project_root/'project.json').read_text(encoding='utf-8'))
def kai():
    return disk()['characters'][0]
def slot(entity,slot_id):
    return next(s for s in entity['coverageSlots'] if s['id']==slot_id)
try:
    for _ in range(120):
        try:urllib.request.urlopen(base+'/api/project',timeout=1);break
        except Exception:time.sleep(.25)
    sync=require_browser('EV2-7 reference coverage acceptance')
    with sync() as pw:
        browser=launch_chromium(pw,headless=True)
        context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
        def guard(route):
            url=route.request.url
            if url.startswith(('data:','blob:')):return route.continue_()
            if not url.startswith(base+'/'):
                if 'fonts.google' in url:return route.fulfill(status=200,body='')
                blocked.append(url);return route.abort()
            if route.request.method not in ('GET','HEAD') and any(x in url for x in ('/api/generation/','/agent/','/approve')):
                blocked.append(url);return route.abort()
            if '/api/references/enroll' in url and route.request.method=='POST':
                enroll_posts.append(url)
                if enroll_failures['remaining']>0:
                    # The enrollment reaches the server and is saved; only its response is lost. The retry must find it, not add a second.
                    enroll_failures['remaining']-=1
                    route.fetch()
                    return route.fulfill(status=500,content_type='application/json',body='{"error":"Synthetic enrollment failure"}')
            route.continue_()
        context.route('**/*',guard)
        page=context.new_page();page.on('pageerror',lambda ex:errors.append(str(ex)))
        page.goto(base+'/#/character/KAI')
        page.locator('[data-reference-desk]').wait_for(timeout=30000)
        # The fixture is an older-schema record, so opening it writes its migration once. Wait for that write to land.
        page.wait_for_function('PENDING_SAVE_TRIGGERS.size===0&&projectSaveSettled().settled',timeout=15000)
        authority_before=json.dumps(disk().get('productionAuthority'),sort_keys=True)

        # 1. A nondefault view: exact target, honest status, Generate unavailable with its reason.
        page.locator('#rd-state').select_option('state-weathered')
        page.locator('[data-reference-desk] .rd-coverage').wait_for()
        # Project normalisation may seed template views beside the fixture's own, so the required total is not asserted.
        desk_summary=page.locator('.rd-coverage header span').inner_text().strip()
        # The word is the plan's effective requirement (planned unless readiness keeps it required); tests/reference-first-canon.js pins it.
        check('Weathered counts no unscoped legacy selection as filled',re.fullmatch(r'0 of \d+ (required|planned) views filled · 1 earlier selection, no state recorded on the image',desk_summary) is not None)
        check('The Desk Front button names the earlier selection',page.locator('[data-rd-slot="front"] small').inner_text().strip()=='Earlier selection · no state recorded on the image')
        check('No surface says "state not recorded" beside the selected state','state not recorded' not in page.locator('[data-reference-desk]').inner_text())
        # EV2-7 dogfood correction: a derived next action stands beside the status and names the exact view it opens.
        nxt=page.locator('[data-reference-desk] .rd-coverage-next [data-rd-build-slot]')
        check('The coverage status offers the next missing required view',nxt.count()==1 and nxt.get_attribute('data-rd-build-slot')=='front' and nxt.inner_text().strip()=='Start coverage — Front')
        remaining=page.locator('[data-reference-desk] .rd-coverage-remaining').inner_text().strip()
        check('And says in one line what is left',re.fullmatch(r'(One (required|planned) view remains\.|[A-Z][a-z]+ (required|planned) views remain\.)',remaining) is not None)
        check('Approval is stated in words beside the state, not as a banner',page.locator('#rd-approval-status').inner_text().strip()=='Not approved · Weathered')
        check('Empty views do not offer a Review page with nothing on it',page.locator('[data-rd-results-slot="side"]').count()==0
              and page.locator('[data-rd-results-empty="side"]').inner_text().strip()=='No Side results yet')
        nxt.click()
        page.locator('[data-build-coverage]').wait_for()
        check('The derived next action opens Build coverage on that exact view',page.locator('#bc-target').inner_text()=='Target: Kai · Weathered · Front')
        page.locator('[data-build-coverage] [data-bc-action="close"]').first.click()
        page.wait_for_selector('#modal.hidden',state='attached',timeout=15000)
        page.locator('[data-rd-slot="front"]').click()
        page.locator('[data-build-coverage]').wait_for()
        check('Build coverage names the exact target',page.locator('#bc-target').inner_text()=='Target: Kai · Weathered · Front')
        check('The views table discloses the unscoped selection',page.locator('.bc-views [data-bc-status="earlier"]').count()==1)
        check('The views table and the Desk use the same wording and count',page.locator('.bc-views [data-bc-status="earlier"]').inner_text().strip()=='Earlier selection · no state recorded on the image' and page.locator('#bc-views-summary').inner_text().strip()==desk_summary)
        check('Approval is stated as separate','approval is a separate decision' in page.locator('.bc-approval').inner_text())
        check('Generate is unavailable without a Weathered approval',page.locator('[data-bc-method="generate"]').is_disabled() and 'Approve a Weathered reference first' in page.locator('#bc-why-generate').inner_text())
        for width,height in ((390,844),(1280,720),(1920,1080),(1440,900)):
            page.set_viewport_size({'width':width,'height':height})
            page.screenshot(path=str(OUT/f'build-coverage-{width}.png'))
            check(f'{width}: Build coverage has no horizontal overflow',page.locator('#modal .modal-box').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'))

        # 2. Choose from Production Media for Weathered Front; the Default legacy selection survives on disk.
        # An ordinary edit is still waiting to save when the picker opens. It is this window's own work: it is saved, and the picker still adds.
        page.evaluate('()=>{P.scenes[0].howItFeels="Cold hull light";dirty();}')
        check('An edit is pending as the picker opens',not page.evaluate('projectSaveSettled().settled'))
        page.locator('[data-bc-method="media"]').click()
        page.locator('[data-md="reference-picker"]').wait_for()
        # EV2-7: the picker is contextual. It opens on this target's own category with a header naming the exact target, and it groups what it offers by
        # relevance to that target. Nothing is recorded for Weathered Front yet, so the exact-target group is honestly absent.
        groups=[g.inner_text().strip() for g in page.locator('#modal .md-group').all()]
        check('The picker opens on the target category with its groups in plain words',
              page.locator('#modal [data-md-category="characters"]').get_attribute('aria-pressed')=='true' and bool(groups) and groups[0].startswith('Other Kai media'))
        check('The picker header names the exact target and says an assignment approves nothing',
              'Kai · Weathered · Front' in page.locator('#modal [data-rd-picker-target]').inner_text() and 'approves nothing' in page.locator('#modal [data-rd-picker-target]').inner_text())
        page.locator('#modal [data-md-field="query"]').fill('weathered-front')
        # The planning image is Other, not Characters: the contextual category says so and offers the one click that widens the search.
        check('A contextual category that matches nothing says so and offers all categories',
              'All categories hold 1 matching asset' in page.locator('#modal .md-empty').inner_text() and page.locator('#modal .md-empty [data-md-category="all"]').count()==1)
        page.locator('#modal .md-empty [data-md-category="all"]').click()
        page.locator('#modal .md-open').first.click()
        page.locator('#rd-single').check()
        page.wait_for_function('!document.getElementById("rd-add-candidate").disabled')
        page.locator('#rd-add-candidate').click()
        page.locator('[data-build-coverage][data-bc-step="done"]').wait_for(timeout=20000)
        check('Done says Weathered Front is filled and approval is unchanged','Front is filled for Weathered. Approval is unchanged.' in page.locator('[data-build-coverage]').inner_text())
        check('A filled view now offers its results',page.locator('[data-rd-results-slot="front"]').get_attribute('data-rd-results-state')=='available')
        front=slot(kai(),'front')
        check('Disk: the Default legacy selection is unchanged',front.get('selectedFile')=='KAI_FRONT_LEGACY.png')
        check('Disk: Weathered Front has its own binding',str((front.get('referenceBindings') or {}).get('state-weathered','')).startswith('ref-'))
        check('Disk: the edit pending when the picker opened was saved',disk()['scenes'][0].get('howItFeels')=='Cold hull light')
        check('Disk: one enrollment request, one Weathered Front row',len(enroll_posts)==1 and len([r for r in kai()['candidateFiles'] if (r.get('referenceBinding') or {}).get('slotId')=='front'])==1)
        weathered=next(s for s in kai()['continuityStates'] if s['id']=='state-weathered')
        check('Disk: Weathered is still unapproved and the new row is unreviewed',not weathered.get('approvedFile') and all(r.get('decision')=='unreviewed' for r in kai()['candidateFiles'] if r.get('referenceBinding')))
        check('Disk: no authority written',json.dumps(disk().get('productionAuthority'),sort_keys=True)==authority_before)
        page.locator('[data-build-coverage] [data-bc-action="close"]').first.click()
        page.wait_for_selector('#modal.hidden',state='attached',timeout=15000)

        # 3. A declared sheet is a source for views, never an approvable image.
        page.locator('#rd-state').select_option('state-default')
        page.locator('[data-rd-candidate="KAI_TURNAROUND.png"]').click()
        # Cropping a sheet is an option inside Build coverage, offered as a secondary action beside the coverage entry.
        check('The sheet footer offers to crop views from it',page.locator('[data-rd-action="sheet"]').inner_text()=='Crop views from this sheet')
        check('And is secondary, not a second warm primary','rd-primary' not in (page.locator('[data-rd-action="sheet"]').get_attribute('class') or ''))
        check('The sheet footer offers no approval',page.locator('[data-rd-action="approve"]').count()==0)
        check('The canvas says what a sheet is','Reference sheet · a source for views' in page.locator('.rd-sheet-caption').inner_text())
        decision=page.locator('[data-reference-desk] .rd-decision').inner_text()
        check('A sheet with no recorded state says so about the sheet','no state recorded on the sheet' in decision and 'The sheet records no continuity state of its own; that does not change Default.' in decision)
        check('The Default state reads as approved, in words',page.locator('#rd-approval-status').inner_text().strip()=='Approved · Default'
              and page.locator('#rd-approval-status .rd-dot-approved').count()==1)
        page.screenshot(path=str(OUT/'sheet-selected.png'))

        # 4. Guided crop -> exact assignment, with one injected enrollment failure checked and retried once.
        crops_before={p.name for p in (project_root/'anchors').glob('KAI-COVERAGE-*')}
        page.locator('[data-rd-action="sheet"]').click()
        page.locator('[data-bc-crop]').wait_for()
        page.locator('#coverage-crop-source').evaluate('(img)=>img.complete||new Promise(r=>img.onload=r)')
        page.locator('#coverage-crop-slot').select_option('side')
        check('The crop names its exact target',page.locator('#bc-crop-target').inner_text()=='Crop for Default · Side')
        # Nothing detects panels, so the grid steppers are named for what they offer.
        crop_text=page.locator('[data-bc-crop]').inner_text()
        check('The crop steppers offer suggested crops, not detected panels','Previous suggested crop' in crop_text and 'Next suggested crop' in crop_text and 'Previous panel' not in crop_text)
        check('And the acknowledgment still says CineBraid does not detect panels','CineBraid does not detect panels' in crop_text)
        check('Saving is disabled until the view is acknowledged',page.locator('#coverage-crop-guided-assign').is_disabled())
        page.locator('#coverage-crop-ack').check()
        enroll_failures['remaining']=1
        page.locator('#coverage-crop-guided-assign').click()
        page.locator('[data-build-coverage][data-bc-step="assign"] [data-bc-action="assign-retry"]').wait_for(timeout=20000)
        check('An enrollment 500 is an unknown outcome','could not confirm whether the assignment was saved' in page.locator('[data-build-coverage]').inner_text())
        page.locator('[data-bc-action="assign-retry"]').click()
        page.locator('[data-build-coverage][data-bc-step="done"]').wait_for(timeout=20000)
        entity=kai();side=slot(entity,'side')
        crops=[r for r in entity['candidateFiles'] if r.get('coverageJobType')=='extracted-crop']
        bindings=[r for r in entity['candidateFiles'] if (r.get('referenceBinding') or {}).get('slotId')=='side']
        new_files={p.name for p in (project_root/'anchors').glob('KAI-COVERAGE-*')}-crops_before
        check('Disk: exactly one crop file was written',len(new_files)==1)
        check('Disk: exactly one crop row with sheet provenance',len(crops)==1 and crops[0]['coverageCrop']['sourceSheet']=='KAI_TURNAROUND.png')
        check('Disk: exactly one Side binding, over the crop asset',len(bindings)==1 and bindings[0]['referenceBinding']['assetId']==crops[0].get('assetId'))
        check('Disk: Default Side is bound to it',(side.get('referenceBindings') or {}).get('state-default')==bindings[0]['stored'])
        check('The retry re-read the project and reused the saved binding: no second enrollment request',len(enroll_posts)==2)
        check('Disk: the crop and its binding are unreviewed, and the Default approval is unchanged',crops[0].get('decision')=='unreviewed' and bindings[0].get('decision')=='unreviewed' and entity.get('approvedFile')=='KAI_DEFAULT_V001.png' and next(s for s in entity['continuityStates'] if s['id']=='state-default').get('approvedFile')=='KAI_DEFAULT_V001.png')
        check('Disk: still no authority written',json.dumps(disk().get('productionAuthority'),sort_keys=True)==authority_before)
        page.screenshot(path=str(OUT/'crop-assigned.png'))
        page.locator('[data-build-coverage] [data-bc-action="close"]').first.click()
        check('No uncaught browser errors',not errors)
        check('No blocked external or paid operation attempted',not blocked)
        browser.close()
finally:
    server.terminate();server.wait(timeout=15);log.close();workspace.cleanup()
    (OUT/'browser-results.json').write_text(json.dumps({'checks':checks,'errors':errors,'blocked':blocked},indent=2),encoding='utf-8')
print(f'EV2-7 reference coverage browser: {len(checks)} checks passed')
