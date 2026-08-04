import os, pathlib, shutil, socket, subprocess, time, re, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('Motion prompt editing real-browser audit skipped: Python Playwright is not installed.')
    raise SystemExit(0)
CHROMIUM=shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
if not CHROMIUM:
    print('Motion prompt editing real-browser audit skipped: Chromium is unavailable.')
    raise SystemExit(0)
def free_port():
    s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); return p
def wait(p):
    for _ in range(150):
        try:
            with socket.create_connection(('127.0.0.1',p),.2): return
        except OSError: time.sleep(.1)
    raise RuntimeError('server timeout')
port=free_port(); server=subprocess.Popen(['node','server.js'],cwd=ROOT,env={**os.environ,'PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    wait(port)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window, 'localStorage', {value:storage, configurable:true});
          Object.defineProperty(window, 'sessionStorage', {value:storage, configurable:true});
        }""")
        upstream=f'http://127.0.0.1:{port}'; base='http://cinebraid-motion-edit.test'
        def proxy(route):
            req=route.request; suffix=req.url[len(base):] if req.url.startswith(base) else '/'; target=upstream+(suffix or '/')
            headers={k:v for k,v in req.headers.items() if k.lower() not in {'host','connection','content-length','accept-encoding'}}
            data=req.post_data_buffer if req.method not in {'GET','HEAD'} else None
            q=urllib.request.Request(target,data=data,headers=headers,method=req.method)
            try:
                with urllib.request.urlopen(q,timeout=30) as r: route.fulfill(status=r.status,headers={k:v for k,v in r.headers.items() if k.lower() not in {'content-encoding','transfer-encoding','connection'}},body=r.read())
            except urllib.error.HTTPError as e: route.fulfill(status=e.code,body=e.read())
        page.route(base+'/**',proxy)
        html=urllib.request.urlopen(upstream+'/').read().decode(); html=re.sub(r'<link[^>]+href=["\']https?://[^>]+>','',html); html=html.replace('<head>',f'<head><base href="{base}/">',1)
        page.set_content(html,wait_until='domcontentloaded',timeout=30000); page.wait_for_selector('#main'); page.wait_for_function("document.body.dataset.renderReady === '1'",timeout=30000)
        page.evaluate("""async () => {
          P={meta:{title:'Prompt editing audit',format:'Short film',version:'6.6.4-studio.repair.13',promptDefaults:{videoProfile:'minimax-h3/i2v'},world:{},styleBlocks:[],aspectRatio:'16:9'},scenes:[{id:'SC-1',title:'Scene'}],shots:[{id:'EDIT-01',scene:'SC-1',title:'Editable motion',desc:'Subtle movement.',workflowStatus:'IN PROGRESS',status:'BUILT',characters:[],locations:[],props:[],vehicles:[],clips:[],keyframes:[{id:'frame-a',label:'A',winner:'FRAME_A.png',description:'Opening',required:true,generationPackages:[]}],creationBrief:{motionProfileId:'minimax-h3/i2v',motionDuration:5,motionPromptBuilds:[],motionPlan:{camera:{},subjects:{},props:{},environment:{},timing:{},audio:{}},composition:{aspectRatio:'16:9',camera:{},elements:[]}}}],characters:[],locations:[],props:[],vehicles:[],audio:[],mediaAssets:[],jobs:[],decisions:[],agentRuns:[],promptBuildsById:{},promptSnapshotsById:{}};
          SCAN={anchors:[],plates:[],props:[],vehicles:[],media:[],shots:{'EDIT-01':{takes:[{name:'FRAME_A.png',url:'/assets/shots/EDIT-01/takes/FRAME_A.png'}],locked:[]}}};
          ACTIVE_PROJECT_SLUG='prompt-edit-audit';
          CONFIG=CONFIG||{}; CONFIG.generation=CONFIG.generation||{}; CONFIG.generation.fal={...(CONFIG.generation.fal||{}),enabled:true,apiKey:'test-key'};
          const build={id:'motion-original',packageId:'EDIT-01-MOTION-R01',date:new Date().toISOString(),profileId:'minimax-h3/i2v',profileName:'MiniMax H3 — Image to Video',profileVersion:'test',prompt:'ORIGINAL COMPILED PROMPT\\nCamera remains locked.',references:[{key:'frame-a',label:'Approved Frame A',role:'first-frame',mediaType:'image',url:'/assets/shots/EDIT-01/takes/FRAME_A.png'}],durationSeconds:5,kind:'guided-motion',confirmations:[],warnings:[]};
          const id=registerPromptBuild(P,build); P.shots[0].creationBrief.motionPromptBuilds=[promptBuildRef(id,{kind:'guided-motion'})];
          location.hash='#/shot/EDIT-01'; await route();
        }""")
        page.wait_for_timeout(250)
        page.evaluate("openGuidedMotionPromptEditor('EDIT-01','motion-original')")
        page.wait_for_selector('#guided-motion-prompt-editor')
        assert page.locator('#guided-motion-prompt-editor').is_editable()
        page.locator('#guided-motion-prompt-editor').fill('MANUALLY EDITED PROMPT\nCamera remains locked. Subject breathes once.')
        page.locator('#guided-motion-prompt-edit-reason').fill('Clarified the single action.')
        assert page.locator('#guided-motion-prompt-editor-save').is_enabled()
        page.locator('#guided-motion-prompt-editor-save').click(); page.wait_for_timeout(250)
        state=page.evaluate("""() => { const c=ensureShotCreation(shotById('EDIT-01')); const rows=resolvePromptBuildList(P,c.motionPromptBuilds); return {count:rows.length,original:rows[0].prompt,latest:rows.at(-1)}; }""")
        assert state['count']==2, state
        assert state['original'].startswith('ORIGINAL COMPILED PROMPT'), state
        assert state['latest']['prompt'].startswith('MANUALLY EDITED PROMPT'), state
        assert state['latest']['manualEdited'] is True
        assert state['latest']['parentBuildId']=='motion-original'
        latest_id=state['latest']['id']
        page.evaluate(f"openFalH3MotionModal('EDIT-01','{latest_id}')")
        page.wait_for_selector('#fal-h3-prompt-editor')
        assert page.locator('#fal-h3-prompt-editor').is_editable()
        assert page.locator('#fal-h3-prompt-editor').input_value().startswith('MANUALLY EDITED PROMPT')
        page.locator('#fal-h3-prompt-editor').fill('X'*2001)
        page.wait_for_timeout(80)
        assert page.locator('#fal-h3-submit').is_disabled()
        assert '2,001/2,000' in page.locator('#fal-h3-prompt-count').inner_text()
        page.locator('.h3-prompt-editor-actions .ghost-btn').click(); page.wait_for_timeout(80)
        assert page.locator('#fal-h3-prompt-editor').input_value().startswith('MANUALLY EDITED PROMPT')
        assert page.locator('#fal-h3-submit').is_enabled()
        page.locator('#fal-h3-prompt-editor').fill('PREFLIGHT EDITED PROMPT\nCamera remains locked. Subject breathes once, then lowers her gaze.')
        page.locator('#fal-h3-prompt-edit-reason').fill('Final generation-only wording adjustment.')
        page.evaluate("""() => {
          window.__capturedMotionJob = null;
          const realFetch = window.fetch.bind(window);
          window.fetch = async (url, options={}) => {
            if (String(url) === '/api/generation/fal/jobs') {
              window.__capturedMotionJob = JSON.parse(options.body || '{}');
              return new Response(JSON.stringify({ok:true,job:{id:'mock-h3-job',shotId:'EDIT-01',purpose:'motion-h3',status:'IN_QUEUE',sourceBuildId:window.__capturedMotionJob.sourceBuildId}}),{status:200,headers:{'content-type':'application/json'}});
            }
            return realFetch(url, options);
          };
          window.pollFalGeneration = () => {};
          window.flushPendingProjectSave = async () => {};
        }""")
        page.locator('#fal-h3-submit').click(); page.wait_for_timeout(250)
        submitted=page.evaluate("""() => { const c=ensureShotCreation(shotById('EDIT-01')); const rows=resolvePromptBuildList(P,c.motionPromptBuilds); return {body:window.__capturedMotionJob,count:rows.length,latest:rows.at(-1),original:rows[0]}; }""")
        assert submitted['body']['prompt'].startswith('PREFLIGHT EDITED PROMPT'), submitted
        assert submitted['count']==3, submitted
        assert submitted['body']['sourceBuildId']==submitted['latest']['id'], submitted
        assert submitted['latest']['parentBuildId']==latest_id, submitted
        assert submitted['original']['prompt'].startswith('ORIGINAL COMPILED PROMPT'), submitted
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        page.evaluate(f"openFalH3MotionModal('EDIT-01','{latest_id}')"); page.wait_for_selector('#fal-h3-prompt-editor')
        page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(150)
        box=page.locator('.h3-generation-modal').bounding_box(); assert box and box['x']>=0 and box['x']+box['width']<=392
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        browser.close()
    print('Motion prompt editing real-browser audit passed immutable source preservation, manual revision creation, editable H3 preflight, live character validation, reset behavior, and desktop/mobile containment.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
