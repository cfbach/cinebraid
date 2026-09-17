#!/usr/bin/env python3
"""Bounded EV2-3 selector inventory failure/retry proof. No full workflow gate."""
import ast,json,os,pathlib,socket,struct,subprocess,sys,tempfile,time,urllib.request,zlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from browser_runtime import disposable_workspace,require_browser,launch_chromium,canon_receipts
# Reuse only pure synthetic fixture builders; never import the broad suite's runner.
source=(ROOT/'tests/ev2-3-media-real-browser.py').read_text(encoding='utf-8-sig')
functions=[node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name in ('free_port','png','iso','build_fixture')]
exec(compile(ast.Module(body=functions,type_ignores=[]),'<synthetic fixture builders>','exec'))
OUT=pathlib.Path(os.environ.get('EV2_ACCEPTANCE_DIR') or tempfile.mkdtemp(prefix='cinebraid-selector-retry-'))
OUT.mkdir(parents=True,exist_ok=True)
workspace=disposable_workspace('ev2-3-selector-retry',sample=False,active_project='o5-media-qa')
slug=build_fixture(workspace.projects_root)
project_file=workspace.projects_root/slug/'project.json'
project=json.loads(project_file.read_text(encoding='utf-8'))
project['characters'][0]['continuityStates'].append({'id':'state-night','name':'Night shift','isDefault':False})
project['characters'][0]['candidateFiles'][1]['targetStateId']='state-night'
project['shots'][1]['keyframes'][0]['id']='kf-c'
project['shots'][1]['candidateFiles'][0]['frameId']='kf-c'
project_file.write_text(json.dumps(project),encoding='utf-8')
port=free_port();base=f'http://127.0.0.1:{port}'
log=open(OUT/'runtime.log','w',encoding='utf-8')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=workspace.env(port),stdout=log,stderr=log)
checks=[];errors=[];blocked=[];mode='failure'
def check(name,value):
    checks.append({'check':name,'passed':bool(value)})
    assert value,name
snapshot="""() => {const c=CineBraidMediaBrowser.instances.get('reference-picker'),p=c.target;return {list:p.list,id:p.id,slug:p.slug,epoch:p.epoch,stateId:p.stateId,slotId:p.slotId,selected:p.selected,single:!!p.single,discovery:{...p.discovery},identity:p.images.find(r=>r.assetId===p.selected)?.identity||null};}"""
def failure(page):
    page.locator('#rd-picker-retry').wait_for()
    check('Failure heading is distinct from an empty production',page.locator('[data-md-load-failure] h3').inner_text()=='Production media couldn’t load')
    check('Main failure explains preservation and local Retry',page.locator('[data-md-load-failure] p').inner_text()=='Your reference target and unfinished selection are unchanged. Retry to load the local inventory.')
    check('Failure never renders empty-production copy','No production media yet' not in page.locator('.rd-picker-library').inner_text())
    check('Failure does not claim a zero-asset inventory','0 unique assets' not in page.locator('.rd-picker-library').inner_text())
    check('Technical failure detail remains available',page.locator('#rd-picker-error').inner_text()=='Synthetic inventory failure')
    check('Unvalidated inventory cannot enroll a candidate',page.locator('#rd-add-candidate').is_disabled())
try:
    for _ in range(120):
        try:urllib.request.urlopen(base+'/api/project',timeout=1);break
        except Exception:time.sleep(.25)
    with require_browser('EV2-3 selector failure/retry')() as pw:
        browser=launch_chromium(pw,headless=True)
        context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
        def guard(route):
            url=route.request.url
            if url.startswith(('data:','blob:')):return route.continue_()
            if not url.startswith(base+'/'):
                if 'fonts.google' in url:return route.fulfill(status=200,body='')
                blocked.append(url);return route.abort()
            if '/api/references/media?' in url:
                if mode=='failure':return route.fulfill(status=503,content_type='application/json',body='{"error":"Synthetic inventory failure"}')
                if mode=='empty':return route.fulfill(status=200,content_type='application/json',body='{"images":[]}')
            if route.request.method not in ('GET','HEAD') and url.split('?')[0] not in (base+'/api/project',base+'/api/projects/'+slug+'/project',base+'/api/local-file/resolve'):
                blocked.append(url);return route.abort()
            route.continue_()
        context.route('**/*',guard)
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/#/character/KAI')
        page.locator('[data-rd-slot="front"]').wait_for()
        page.wait_for_function('projectSaveSettled().settled')
        authority=page.evaluate('JSON.stringify(P.productionAuthority)')
        # EV2-7: the picker's state and view are locked to Build coverage's target, so the Desk is switched to Night first.
        page.locator('#rd-state').select_option('state-night')
        page.wait_for_function('document.getElementById("rd-state")?.value==="state-night"')
        page.locator('[data-rd-slot="front"]').click()
        page.locator('[data-bc-method="media"]').click()
        failure(page)
        page.locator('[data-md-field="query"]').fill('KAI_FAL_CANDIDATE_2')
        check('Picker opened from a Night Desk targets Night',page.locator('#rd-assign-state').input_value()=='state-night' and page.locator('#rd-assign-state').is_disabled())
        page.locator('#rd-single').check()
        before=page.evaluate(snapshot)
        page.evaluate('window.__retryPicker=CineBraidMediaBrowser.instances.get("reference-picker").target')
        for width,height in ((1440,900),(390,844)):
            page.set_viewport_size({'width':width,'height':height})
            page.screenshot(path=str(OUT/f'selector-error-{width}.png'))
        page.set_viewport_size({'width':1440,'height':900})
        page.locator('#rd-picker-retry').click()
        page.wait_for_timeout(100)
        failure(page)
        check('Repeated failure preserves target, query, assignment and session data',page.evaluate(snapshot)==before)
        check('Retry retains the same picker object',page.evaluate('window.__retryPicker===CineBraidMediaBrowser.instances.get("reference-picker").target'))
        mode='success'
        page.locator('#rd-picker-retry').click()
        page.locator('#modal .md-card').first.wait_for()
        check('Successful retry removes failure message and Retry action',page.locator('[data-md-load-failure],#rd-picker-retry').count()==0)
        check('Successful retry preserves unfinished initial assignment',page.evaluate(snapshot)==before)
        page.locator('#modal .md-open').first.click()
        page.locator('#rd-single').check()
        page.wait_for_function('!document.getElementById("rd-add-candidate").disabled')
        selected=page.evaluate(snapshot)
        page.locator('#modal [data-md-inspect]').first.click()
        page.locator('[data-mi-action="open-owner"]').first.click()
        page.locator('[data-media-return]').wait_for()
        mode='failure'
        page.locator('[data-media-return]').click()
        failure(page)
        check('Failed owner-return refresh preserves selected asset and its identity',page.evaluate(snapshot)==selected)
        mode='success'
        page.locator('#rd-picker-retry').click()
        page.locator('#modal .md-card').first.wait_for()
        check('Retry preserves selected asset, query, target and single-view assignment',page.evaluate(snapshot)==selected)
        check('Selected asset remains visibly selected',page.locator('#modal .md-card.is-selected').get_attribute('data-md-key')==selected['discovery']['selected'])
        page.screenshot(path=str(OUT/'selector-retry-preserved.png'))
        # Verify the same suspended selection still has a working owner-return context.
        page.locator('#modal [data-md-inspect]').first.click()
        page.locator('[data-mi-action="open-owner"]').first.click()
        page.locator('[data-media-return]').click()
        page.locator('#modal .md-card').first.wait_for()
        check('Owner-return context remains usable after Retry',page.evaluate(snapshot)==selected)
        # EV2-7: at 390px the Inspector opened from the picker reuses the picker's box and must still be the full-screen sheet.
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#modal [data-md-inspect]').first.click()
        page.locator('[data-media-inspector]').wait_for()
        sheet=page.locator('#modal .modal-box').bounding_box()
        page.screenshot(path=str(OUT/'selector-inspector-390.png'))
        check('390: picker Inspector opens as a full-screen sheet',sheet is not None and abs(sheet['x'])<1 and abs(sheet['y'])<1 and sheet['width']>=389 and sheet['height']>=843)
        page.locator('[data-media-inspector] .cancel').click()
        page.locator('#modal .md-card').first.wait_for()
        page.set_viewport_size({'width':1440,'height':900})
        check('Picker selection survives the phone Inspector',page.evaluate(snapshot)==selected)
        page.locator('#rd-picker-cancel').click()
        # EV2-7: Cancel returns to Build coverage's method step; the media method opens a fresh picker.
        page.locator('[data-build-coverage][data-bc-step="method"]').wait_for()
        mode='empty'
        page.locator('[data-bc-method="media"]').click()
        page.locator('[data-md="reference-picker"]').wait_for()
        check('Successful empty inventory still uses genuine empty-production message','No production media yet' in page.locator('.rd-picker-library').inner_text() and page.locator('[data-md-load-failure]').count()==0)
        check('Read-only failure/retry leaves authority unchanged',page.evaluate('JSON.stringify(P.productionAuthority)')==authority)
        check('No uncaught browser errors',not errors)
        check('No prohibited requests attempted',not blocked)
        browser.close()
finally:
    server.terminate();server.wait(timeout=15);log.close();workspace.cleanup()
    (OUT/'selector-failure-results.json').write_text(json.dumps({'checks':checks,'errors':errors,'blocked':blocked},indent=2),encoding='utf-8')
print(f'Selector failure/retry: {len(checks)} focused checks passed')
