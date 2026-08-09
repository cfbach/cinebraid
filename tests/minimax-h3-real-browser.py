import os, pathlib, shutil, socket, subprocess, time, re, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL='MiniMax H3 real-browser audit'
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
        upstream=f'http://127.0.0.1:{port}'; base='http://cinebraid-h3-audit.test'
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
          const frames=['A','B','C','D'].map((label,i)=>({id:'frame-'+label.toLowerCase(),label,title:'Frame '+label,winner:'FRAME_'+label+'.png',description:'Beat '+label,required:true,generationPackages:[]}));
          P={meta:{title:'H3 audit',format:'Short film',version:'6.6.4-studio.repair.13',promptDefaults:{imageProfile:'gpt-image-2/t2i',videoProfile:'minimax-h3/multi-frame'},world:{},styleBlocks:[],aspectRatio:'16:9'},scenes:[{id:'SC-1',title:'H3 scene',tier:'A',whatHappens:'Four beats.'}],shots:[{id:'H3-01',scene:'SC-1',title:'Four-frame shot',desc:'Move through four approved beats.',positioning:'Locked composition.',workflowStatus:'IN PROGRESS',status:'BUILT',reviewStatus:'PENDING',characters:[],codes:[],risks:[],notes:'',keyframes:frames,clips:[],promptBuilds:[],promptOptions:[],creationBrief:{motionProfileId:'minimax-h3/multi-frame',motionDuration:10,h3Keyframes:{},h3KeyframeOrder:[],h3SequenceNote:'Smooth continuous movement.',frameSequenceReview:{pass:true,score:93,files:['FRAME_A.png','FRAME_B.png','FRAME_C.png','FRAME_D.png'],reviewedAt:'2026-08-03T10:00:00Z',summary:'Stable sequence.',nextAction:'Proceed.',categories:{camera:{score:94,note:'Stable'},environment:{score:93,note:'Stable'},lighting:{score:92,note:'Stable'},character:{score:94,note:'Stable'},props:{score:91,note:'Stable'},intendedProgression:{score:95,note:'Clear'}},blockingIssues:[]},motionPlan:{camera:{},subjects:{},props:{},audio:{}},composition:{aspectRatio:'16:9',camera:{},elements:[]}}}],characters:[],locations:[],props:[],vehicles:[],audio:[],mediaAssets:[],jobs:[],decisions:[],agentRuns:[]};
          SCAN={anchors:[],plates:[],props:[],vehicles:[],media:[],shots:{'H3-01':{takes:frames.map(f=>({name:f.winner,url:'/assets/shots/H3-01/takes/'+f.winner})),locked:[]}}};
          ACTIVE_PROJECT_SLUG='h3-audit'; localStorage.setItem('cinebraid-focused:h3-audit:shot-task:H3-01','motion'); location.hash='#/shot/H3-01'; await route();
        }""")
        page.wait_for_selector('.h3-keyframe-panel',state='attached',timeout=15000)
        checked=page.locator('.h3-keyframe-panel input[type=checkbox]:checked').count()
        assert checked==2, f'new four-frame sequence should default to first/last only, got {checked}'
        labels=page.locator('.h3-keyframe-image span').all_inner_texts()
        assert labels==['IMAGE 1','NOT SENT','NOT SENT','IMAGE 2'], labels
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        assert page.locator('.motion-workflow-map').count()==1
        assert page.locator('.motion-workflow-section').count()>=3
        assert page.locator('.guided-motion-frame-preview').count()==4
        original_hash=page.evaluate('location.hash')
        page.locator('.motion-workflow-map button').nth(2).click(); page.wait_for_timeout(250)
        assert page.evaluate('location.hash')==original_hash, 'Create motion navigation must not replace the SPA route hash'
        assert page.locator('.motion-assisted-tools').evaluate('e=>e.open') is True, 'Create motion must open assisted motion tools'
        page.evaluate("selectBoundedTask('shot-task','H3-01','frames')"); page.wait_for_timeout(350)
        page.wait_for_selector('.frames-to-motion-cta')
        preview=page.locator('.guided-frame-approved-preview').first.bounding_box()
        assert preview and preview['width']<=302 and preview['height']<=225, preview
        page.locator('.frames-to-motion-cta button').click(); page.wait_for_timeout(450)
        assert page.evaluate('location.hash')=='#/shot/H3-01', 'Frame-to-motion handoff must stay in the current shot'
        assert page.locator('.bounded-shot-taskbar button.selected').get_by_text('Motion & sound').count()==1
        assert page.locator('.motion-assisted-tools').evaluate('e=>e.open') is True
        page.locator('.guided-motion-frame-preview').first.click()
        page.wait_for_selector('.media-theatre-modal',state='attached')
        theatre=page.locator('.media-theatre-modal').bounding_box(); assert theatre and theatre['x']>=0 and theatre['x']+theatre['width']<=1442
        page.locator('.media-theatre-modal .cancel').click(); page.wait_for_timeout(100)
        h3_test_html = '<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3</span><h3>Generate test</h3><p>Viewport test.</p></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll"><section class="h3-submit-sequence"><b>Actual order</b><ol>' + ''.join(f'<li><b>Image {i}</b><span>Long reference description {i}</span></li>' for i in range(1,19)) + '</ol></section><section class="h3-generation-settings"><div class="h3-settings-grid"><label><span>Duration</span><select><option>5 seconds</option></select></label><label><span>Resolution</span><select><option>2K</option></select></label><label><span>Aspect ratio</span><select><option>16:9</option></select></label></div></section><details class="h3-prompt-preview" open><summary>Prompt</summary><pre>' + ('Long provider prompt '*220) + '</pre></details></div><footer class="modal-actions h3-generation-actions"><button>Cancel</button><button>Start</button></footer></div>'
        page.evaluate('(html) => openModal(html)', h3_test_html)
        page.wait_for_selector('.h3-generation-modal')
        box=page.locator('.h3-generation-modal').bounding_box(); assert box and box['y']>=0 and box['y']+box['height']<=1002
        assert page.evaluate('document.querySelector(".h3-generation-scroll").scrollHeight > document.querySelector(".h3-generation-scroll").clientHeight')
        page.evaluate('closeModal()')
        page.locator('.h3-keyframe-panel input[type=checkbox]').nth(1).check(); page.wait_for_timeout(200)
        assert page.locator('.h3-keyframe-panel input[type=checkbox]:checked').count()==3
        labels=page.locator('.h3-keyframe-image span').all_inner_texts(); assert labels==['IMAGE 1','IMAGE 2','NOT SENT','IMAGE 3'], labels
        page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(250)
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        assert page.locator('.motion-workflow-map button').count()==3
        mobile_h3_html = '<div class="h3-generation-modal"><header class="h3-generation-head"><div><span>MINIMAX H3</span><h3>Mobile generate test</h3></div><button class="cancel" onclick="closeModal()">Close</button></header><div class="h3-generation-scroll">' + ('<p>Scrollable provider detail</p>'*60) + '</div><footer class="modal-actions h3-generation-actions"><button>Cancel</button><button>Start</button></footer></div>'
        page.evaluate('(html) => openModal(html)', mobile_h3_html)
        page.wait_for_selector('.h3-generation-modal')
        box=page.locator('.h3-generation-modal').bounding_box(); assert box and box['x']>=0 and box['x']+box['width']<=392 and box['y']>=0 and box['y']+box['height']<=846
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=2
        page.evaluate('closeModal()')
        browser.close()
    print('MiniMax H3 repair.11 real-browser audit passed first/last defaults, explicit intermediate opt-in, exact continuous numbering, media-theatre previews, H3 modal containment, state persistence, and desktop/mobile overflow checks.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
