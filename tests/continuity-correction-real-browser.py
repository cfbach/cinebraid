import os, pathlib, shutil, socket, subprocess, time, re, urllib.request, urllib.error, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL='Continuity correction real-browser audit'
sync_playwright=require_browser(LABEL)
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
        browser=launch_chromium(pw,label=LABEL)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        page.evaluate("""() => {
          const data = new Map();
          const storage = {getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size;}};
          Object.defineProperty(window, 'localStorage', {value:storage, configurable:true});
          Object.defineProperty(window, 'sessionStorage', {value:storage, configurable:true});
        }""")
        upstream=f'http://127.0.0.1:{port}'; base='http://cinebraid-continuity.test'
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
        dataimg='data:image/svg+xml,'+urllib.parse.quote('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#182634"/><circle cx="100" cy="90" r="45" fill="#b96f39"/></svg>')
        page.evaluate("""(img) => {
          const frameReview={pass:false,score:28,reviewedAt:'2026-08-03T18:00:00Z',summary:'Camera and background lighting drift.',nextAction:'Repair Frame B from Frame A.',files:['A.png','B.png'],categories:{camera:{score:30,note:'Framing shifts.'},environment:{score:25,note:'Tunnel geometry changes.'},lighting:{score:10,note:'Unexpected practical light appears.'},character:{score:72,note:'Scale drifts slightly.'},props:{score:55,note:'Console changes.'},intendedProgression:{score:70,note:'Activation is clear.'}},blockingIssues:['Background light appears only in Frame B.']};
          P={meta:{title:'Continuity correction audit',format:'Short film',version:'6.6.4-studio.repair.13',promptDefaults:{imageProfile:'gpt-image-2/edit'},world:{},styleBlocks:[],aspectRatio:'16:9'},scenes:[{id:'SC-1',title:'Scene'}],shots:[{id:'PAIR-01',scene:'SC-1',title:'Pair',desc:'Core activates.',workflowStatus:'IN PROGRESS',status:'BUILT',characters:[],locations:[],props:[],vehicles:[],clips:[],candidateFiles:[{stored:'A.png',frameId:'fa',approvedTarget:'frame:fa'},{stored:'B.png',frameId:'fb',approvedTarget:'frame:fb'}],keyframes:[{id:'fa',label:'A',title:'Before',description:'Core dark.',winner:'A.png',required:true,generationPackages:[]},{id:'fb',label:'B',title:'After',description:'Only the core activates.',winner:'B.png',required:true,generationPackages:[]}],creationBrief:{frameSequenceReview:frameReview,frameWorkflows:{fa:{promptBuilds:[]},fb:{promptBuilds:[]}},composition:{aspectRatio:'16:9',camera:{},elements:[]},motionPlan:{camera:{},subjects:{},props:{},environment:{},timing:{},audio:{}}}}],characters:[],locations:[],props:[],vehicles:[],audio:[],mediaAssets:[],jobs:[],decisions:[],agentRuns:[],promptBuildsById:{},promptSnapshotsById:{}};
          SCAN={anchors:[],plates:[],props:[],vehicles:[],media:[],shots:{'PAIR-01':{takes:[{name:'A.png',url:img},{name:'B.png',url:img}],locked:[]}}};
          ACTIVE_PROJECT_SLUG='continuity-audit';
          localStorage.setItem('cinebraid-focused:continuity-audit:shot-task:PAIR-01','frames');
          location.hash='#/shot/PAIR-01';
          return route();
        }""", dataimg)
        page.wait_for_timeout(250)
        assert page.get_by_text('FIX CONTINUITY').is_visible()
        page.get_by_text('FIX CONTINUITY').click(); page.wait_for_selector('.frame-sequence-correction-modal')
        assert page.locator('#sequence-correction-anchor').input_value()=='fa'
        assert page.locator('#sequence-correction-target').input_value()=='fb'
        assert page.locator('#sequence-correction-delta').is_editable()
        assert page.get_by_text('Camera, crop, lens and framing').is_visible()
        assert page.get_by_text('YOU CHOOSE').first.is_visible()
        assert page.get_by_text('YOU EDIT').first.is_visible()
        assert page.get_by_text('CINEBRAID AUTOMATES').is_visible()
        metrics=page.evaluate("""() => { const box=document.querySelector('.modal-box'); const modal=document.querySelector('.frame-sequence-correction-modal'); return {boxWidth:box.getBoundingClientRect().width, viewport:innerWidth, overflow:modal.scrollWidth-modal.clientWidth, height:box.getBoundingClientRect().height, viewportHeight:innerHeight}; }""")
        assert metrics['boxWidth'] <= metrics['viewport']
        assert metrics['overflow'] <= 2
        assert metrics['height'] <= metrics['viewportHeight']
        page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(100)
        mobile_metrics=page.evaluate("""() => { const box=document.querySelector('.modal-box'); const modal=document.querySelector('.frame-sequence-correction-modal'); return {boxWidth:box.getBoundingClientRect().width, viewport:innerWidth, overflow:modal.scrollWidth-modal.clientWidth, height:box.getBoundingClientRect().height, viewportHeight:innerHeight}; }""")
        assert mobile_metrics['boxWidth'] <= mobile_metrics['viewport']
        assert mobile_metrics['overflow'] <= 2
        assert mobile_metrics['height'] <= mobile_metrics['viewportHeight']
        page.set_viewport_size({'width':1440,'height':1000}); page.wait_for_timeout(100)
        page.locator('#sequence-correction-delta').fill('Only the core activates and the hand releases; all other details remain unchanged.')
        page.get_by_text('BUILD EDITABLE CORRECTION PROMPT').click(); page.wait_for_timeout(200)
        assert page.locator('.candidate-correction-modal').is_visible()
        prompt=page.locator('#candidate-correction-prompt').input_value()
        assert '#image1 is the editable approved target frame' in prompt
        assert '#image2 is the structural continuity authority' in prompt
        page.evaluate("closeModal()")
        page.evaluate("""(img) => {
          const entity={id:'PROP-1',name:'Growth console',approvedFile:'offline.png',candidateFiles:[],continuityStates:[{id:'state-default',name:'Offline',isDefault:true,approvedFile:'offline.png',notes:'Console unlit.'},{id:'active',name:'Active',isDefault:false,parentStateId:'state-default',approvedFile:'active.png',notes:'Only core seams illuminate.',parentValidation:{status:'complete',targetFile:'active.png',parentFile:'offline.png',stateDelta:'Only core seams illuminate.',reviewedAt:'2026-08-03T18:10:00Z',review:{score:55,pass:false,summary:'Console geometry drifted.',recommendation:'correct',requiredHardChecks:['sameUnderlyingEntity','onlyRequestedDelta'],hardChecks:{sameUnderlyingEntity:{pass:false,note:'Panel construction changed.'},onlyRequestedDelta:{pass:false,note:'Extra light strip appeared.'}},categories:{design:{severity:'major',note:'Geometry changed.'},state:{severity:'blocking',note:'Unspecified activation light.'},requirements:{severity:'major',note:'Delta exceeded.'},usefulness:{severity:'minor',note:'Readable.'},cleanliness:{severity:'pass',note:'Clean.'}}}}}]};
          P.props=[entity];
          boundedWriteState('selected:continuity-state','props:PROP-1','active');
          const media=[{name:'offline.png',url:img},{name:'active.png',url:img}];
          document.getElementById('main').innerHTML=continuityStatesPanel('props',entity,media);
        }""", dataimg)
        page.wait_for_timeout(120)
        assert page.get_by_text('PARENT CONTINUITY FAILED').is_visible()
        assert page.get_by_text('CORRECT FROM PARENT').is_visible()
        assert page.get_by_text('ACCEPT DIFFERENCE AS INTENTIONAL').is_visible()
        page.get_by_text('ACCEPT DIFFERENCE AS INTENTIONAL').click(); page.wait_for_selector('.accept-state-difference-modal')
        assert page.locator('#accepted-state-difference').is_editable()
        page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        browser.close()
    print('Continuity correction real-browser audit passed viewport-safe guided correction, explicit human/automated steps, anchor/target selection, immutable correction package creation, parent-state failure actions, intentional-delta dialog, and mobile containment.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
