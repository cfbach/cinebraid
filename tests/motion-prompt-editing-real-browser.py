"""Motion editing through the shipped UI and real compiler/save routes.
Only job dispatch is intercepted; server outbound HTTP is denied.
No injected globals, fabricated origin, save stubs or provider calls.
"""
import os, json, pathlib, socket, subprocess, time
from urllib.parse import urlparse
ROOT = pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium, disposable_workspace
LABEL='Current motion editing journey'
sync_playwright=require_browser(LABEL)
OUT=pathlib.Path(os.environ['CINEBRAID_JOURNEY_OUT']) if os.environ.get('CINEBRAID_JOURNEY_OUT') else None
if OUT: OUT.mkdir(parents=True,exist_ok=True)
w=disposable_workspace('motion-edit-current',sample=False,active_project='motion-edit')
dir=w.projects_root/'motion-edit'; dir.mkdir()
p={'meta':{'title':'Native motion editing · disposable','schemaVersion':'6.7','aspectRatio':'16:9','workflowEmphasis':'manual','promptDefaults':{'videoProfile':'minimax-h3/i2v'}},'scenes':[{'id':'SC-1','title':'Bridge'}],'shots':[{'id':'EDIT-01','scene':'SC-1','title':'A held glance','desc':'Subtle movement. Camera remains locked.','deliveryRoute':'i2v','characters':[],'keyframes':[{'id':'frame-a','label':'A','title':'Opening frame','winner':'','description':'A quiet platform.','required':True,'generationPackages':[]}],'clips':[],'candidateFiles':[],'creationBrief':{'deliveryIntent':'motion','motionProfileId':'minimax-h3/i2v','motionDuration':5,'frameWorkflows':{}}}], 'characters':[],'locations':[],'props':[],'vehicles':[],'audio':[],'mediaAssets':[],'jobs':[],'decisions':[],'agentRuns':[],'promptBuildsById':{},'promptSnapshotsById':{}}
(dir/'project.json').write_text(json.dumps(p),encoding='utf8')
c=json.loads(w.config_path.read_text());c['generation']={'fal':{'enabled':True,'apiKey':'synthetic-never-sent'}};w.config_path.write_text(json.dumps(c))
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
log=((OUT or w.home)/'server.log').open('w');server=subprocess.Popen(['node','-r','./tests/helpers/ev2-6-no-network.js','server.js'],cwd=ROOT,env=w.env(port),stdout=log,stderr=log)
page=None;errors=[];jobs=[];blocked=[]
def snap(name):
    if not OUT: return
    page.screenshot(path=str(OUT/(name+'.png')))
    (OUT/(name+'.txt')).write_text(page.locator('body').inner_text(),encoding='utf8')
def saved(): page.wait_for_function("projectSaveSettled().settled")
def disk(): return json.loads((dir/'project.json').read_text(encoding='utf8'))
try:
    for _ in range(150):
        try:
            with socket.create_connection(('127.0.0.1',port),.2):break
        except OSError:time.sleep(.1)
    else: raise RuntimeError('Disposable motion server failed to start')
    with sync_playwright() as pw:
        browser=launch_chromium(pw,label=LABEL)
        page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce',service_workers='block')
        page.set_default_timeout(12000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        def route(r):
            u=urlparse(r.request.url)
            if f'{u.scheme}://{u.netloc}'!=base:return r.abort()
            if u.path=='/api/generation/fal/jobs' and r.request.method=='POST':
                jobs.append(r.request.post_data_json)
                return r.fulfill(status=503,json={'error':'Intercepted test dispatch. No provider called.'})
            if u.path.startswith(('/api/assistant/','/api/ai/','/api/llm/')):
                blocked.append(u.path);return r.abort()
            return r.continue_()
        page.route('**/*',route)
        page.goto(base)
        page.get_by_role('button',name='▦ Shots',exact=True).click()
        page.locator('a[href="#/shot/EDIT-01"]').first.click()
        page.locator('[data-stage-id="frames"]').click()
        snap('00-frames')
        with page.expect_file_chooser() as choice:
            page.get_by_role('button',name='Import Frame A',exact=True).click()
        assert choice.value.element.get_attribute('id')=='frame-file-frame-a'
        choice.value.set_files(str(ROOT/'projects/cinebraid-sample/shots/SAMPLE-03/takes/SAMPLE-03-OPEN.png'))
        page.get_by_role('button',name='Review Frame A result',exact=True).click()
        page.locator('.rx-card').first.click()
        assert page.locator('#rx-decision').get_attribute('data-rx-state')=='open'
        page.locator('button[data-rx="approve"]').click()
        page.locator('#rx-confirm:not([disabled])').click()
        page.locator('#rx-decision[data-rx-state="approved"]').wait_for()
        saved(); authority=disk()['productionAuthority']; winner=disk()['shots'][0]['keyframes'][0]['winner']
        page.locator('[data-media-return]').first.click()
        page.locator('[data-stage-id="motion"]').click()
        snap('00-motion')
        page.get_by_role('button',name='Prepare video generation',exact=True).click()
        page.locator('.guided-motion-controls button').filter(has_text='Build prompt').click()
        page.locator('.motion-prompt-edit-btn').wait_for();saved()
        original=page.evaluate("latestPromptBuild(P,P.shots[0].creationBrief.motionPromptBuilds)")
        assert original['prompt']
        snap('01-built-prompt')
        page.locator('.motion-prompt-edit-btn').click()
        page.locator('#guided-motion-prompt-editor').fill('MANUALLY EDITED PROMPT\nCamera remains locked. Subject breathes once.')
        page.locator('#guided-motion-prompt-edit-reason').fill('Clarified the single action.')
        page.locator('#guided-motion-prompt-editor-save').click();saved()
        page.locator('.h3-generate-btn').click()
        page.locator('#fal-h3-prompt-editor').wait_for()
        page.locator('#fal-h3-prompt-editor').scroll_into_view_if_needed()
        snap('02-native-review-1440')
        actual=page.locator('#fal-h3-prompt-editor').input_value()
        manual='MANUALLY EDITED PROMPT\nCamera remains locked. Subject breathes once.'
        assert actual==manual, 'The native review must load the saved manual revision'
        rows=page.evaluate("resolvePromptBuildList(P,P.shots[0].creationBrief.motionPromptBuilds)")
        assert len(rows)==2 and rows[0]==original
        revision=rows[-1]
        assert revision['manualEdited'] and revision['parentBuildId']==original['id']
        assert revision['prompt']==manual
        request=page.evaluate('window._falH3MotionRequest')
        compiled=request['compiledPrompt']
        assert request['buildId']==revision['id']
        assert compiled!=manual, 'Keep the compiler record separate from authored text'
        assert request['endpoints']['firstFrame']['refId']==f'shot-start:frame-a:{winner}'
        assert request['endpoints']['firstFrame']['source']['path']==f'/assets/shots/EDIT-01/takes/{winner}'
        assert len(request['references'])==1 and request['references'][0]['role']=='first-frame'
        assert jobs==[], 'Building, editing and reviewing never dispatch'
        editor=page.locator('#fal-h3-prompt-editor')
        assert editor.is_editable()
        limit=request['maxPromptCharacters']; assert limit>0
        editor.fill('X'*(limit+1))
        assert page.locator('#fal-h3-submit').is_disabled()
        assert page.locator('#fal-h3-prompt-count').inner_text()==f'{limit+1:,}/{limit:,}'
        editor.fill('')
        assert page.locator('#fal-h3-submit').is_disabled()
        page.get_by_role('button',name='Reset compiled prompt',exact=True).click()
        assert editor.input_value()==compiled
        assert page.locator('#fal-h3-submit').is_enabled()
        page.locator('.h3-generation-actions').get_by_role('button',name='Cancel',exact=True).click()
        assert jobs==[] and len(disk()['shots'][0]['creationBrief']['motionPromptBuilds'])==2
        page.reload()
        page.locator('[data-stage-id="motion"]').click()
        page.locator('.h3-generate-btn').click()
        assert page.locator('#fal-h3-prompt-editor').input_value()==manual, 'Cancel/reset must not overwrite the saved revision'
        with page.expect_response(lambda r: r.url.endswith('/api/generation/fal/h3/plan') and r.request.method=='POST'):
            page.locator('#fal-h3-duration').select_option('6')
        page.wait_for_function("window._falH3MotionRequest.durationSeconds === 6")
        assert page.locator('#fal-h3-prompt-editor').input_value()==manual
        assert page.evaluate('window._falH3MotionRequest.endpoints')==request['endpoints']
        # Even an unchanged saved manual revision is dispatched as authored text;
        # it must not create a duplicate revision merely because it differs from the compiler.
        with page.expect_request(lambda r: r.url.endswith('/api/generation/fal/jobs')):
            page.locator('#fal-h3-submit:not([disabled])').click()
        saved()
        assert len(jobs)==1 and jobs[0]['durationSeconds']==6 and jobs[0]['prompt']==manual and jobs[0]['sourceBuildId']==revision['id']
        assert len(disk()['shots'][0]['creationBrief']['motionPromptBuilds'])==2
        page.locator('.h3-generate-btn').click()
        editor=page.locator('#fal-h3-prompt-editor')
        final='PREFLIGHT EDITED PROMPT\nCamera remains locked. Subject breathes once, then lowers her gaze.'
        editor.fill(final)
        page.locator('#fal-h3-prompt-edit-reason').fill('Final generation-only wording adjustment.')
        page.locator('#fal-h3-edit-coverage').wait_for(state='visible')
        page.set_viewport_size({'width':390,'height':844})
        editor.scroll_into_view_if_needed()
        snap('03-native-edit-390')
        box=page.locator('.h3-generation-modal').bounding_box()
        assert box and box['x']>=0 and box['x']+box['width']<=392
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        with page.expect_request(lambda r: r.url.endswith('/api/generation/fal/jobs')):
            page.locator('#fal-h3-submit:not([disabled])').click()
        saved()
        rows=page.evaluate("resolvePromptBuildList(P,P.shots[0].creationBrief.motionPromptBuilds)")
        assert len(jobs)==2 and jobs[-1]['prompt']==final
        # Reload may add legacy scope/immutableAt metadata; every original field stays intact.
        assert len(rows)==3
        assert all(rows[0].get(k)==v for k,v in original.items())
        assert all(rows[1].get(k)==v for k,v in revision.items())
        assert rows[-1]['parentBuildId']==revision['id'] and rows[-1]['prompt']==final
        # The source build remains the server's structured-plan authority. A linked
        # revision records changed text; it must not replace the plan/asset binding.
        assert jobs[-1]['sourceBuildId']==revision['id']
        assert jobs[-1]['shotId']=='EDIT-01' and jobs[-1]['profileMode']=='i2v'
        final_id=rows[-1]['id']
        assert disk()['promptBuildsById'][final_id]['prompt']==final
        assert disk()['productionAuthority']==authority
        assert disk()['shots'][0]['keyframes'][0]['winner']==winner
        page.set_viewport_size({'width':1440,'height':1000})
        page.reload()
        page.locator('[data-stage-id="motion"]').click()
        page.locator('.h3-generate-btn').click()
        editor=page.locator('#fal-h3-prompt-editor')
        assert editor.input_value()==final, 'Final revision survives reopen'
        assert page.evaluate('window._falH3MotionRequest.endpoints')==request['endpoints']
        editor.scroll_into_view_if_needed();snap('04-reopened-1440')
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        assert not errors and not blocked, (errors,blocked)
        print('PASS: native motion editing, immutable history, live limits, reset/cancel, two intercepted dispatches, exact frame identity, approval preservation, save/reopen and 390 px containment')
        browser.close()
finally:
    server.terminate();server.wait(timeout=10);log.close();w.cleanup()
    if OUT: (OUT/'receipt.json').write_text(json.dumps({'errors':errors,'blocked':blocked,'jobs':jobs,'cleaned':not w.home.exists()},indent=2))
