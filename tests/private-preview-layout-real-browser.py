import os, pathlib, shutil, socket, subprocess, time, re, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium
LABEL='Private-preview layout audit'
sync_playwright=require_browser(LABEL)

def free_port():
    s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); return p

def wait(port):
    for _ in range(180):
        try:
            with socket.create_connection(('127.0.0.1',port),.2): return
        except OSError: time.sleep(.1)
    raise RuntimeError('server timeout')

def assert_page_fit(page, label):
    overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
    assert overflow <= 2, f'{label}: horizontal overflow {overflow}px'
    offenders=page.evaluate('''() => [...document.querySelectorAll('#main *')].filter(el => {
      const s=getComputedStyle(el), r=el.getBoundingClientRect();
      if (s.display==='none'||s.visibility==='hidden'||r.width<1||r.height<1) return false;
      if (r.right <= innerWidth + 2 && r.left >= -2) return false;
      let p=el.parentElement;
      while(p){ const ps=getComputedStyle(p); if(/auto|scroll/.test(ps.overflowX)) return false; p=p.parentElement; }
      return true;
    }).slice(0,10).map(el=>({tag:el.tagName,cls:el.className,text:(el.textContent||'').trim().slice(0,60),rect:el.getBoundingClientRect().toJSON()}))''')
    assert not offenders, f'{label}: elements outside viewport: {offenders}'

def assert_production_work_region(page, label):
    """Surface Polish V1 - Production's current-work region.

    Composition and reachability only. Nothing here pins a pixel value, a
    colour or a font size: the point of the polish pass is which things are
    where and whether they are still usable, and a test that froze the sizes
    would block the next composition pass for no correctness reason.

    Four regressions this is here to catch, each one a thing the pass could
    plausibly break and none of them visible to assert_page_fit:
      - the two queues stop composing, or the actionable control disappears
      - the enlarged returned preview starts cropping the candidate it is
        asking the filmmaker to judge
      - the passive metric strip drifts back above the work region
      - the rows and summaries that gave up their borders lose their focus ring
    """
    state=page.evaluate('''() => {
      const work=document.querySelector('.production-work');
      if(!work) return {error:'no .production-work region on Production'};
      const next=work.querySelector(':scope > .production-next');
      const inbox=work.querySelector(':scope > .production-inbox');
      const control=next && next.querySelector('a[href]');
      const well=work.querySelector('.production-inbox-item > div');
      const img=work.querySelector('.production-inbox-item img, .production-inbox-item video');
      const dock=document.querySelector('#cb-shell-dock');
      const summary=document.querySelector('.production-summary');
      const box=n=>n?n.getBoundingClientRect():null;
      return {
        hasNext:!!next, hasInbox:!!inbox,
        controlText:control?(control.textContent||'').trim():null,
        controlBottom:control?Math.round(box(control).bottom):null,
        hasRow:!!well,
        objectFit:img?getComputedStyle(img).objectFit:null,
        wellW:well?Math.round(box(well).width):null,
        wellH:well?Math.round(box(well).height):null,
        naturalW:img&&img.naturalWidth?img.naturalWidth:null,
        naturalH:img&&img.naturalHeight?img.naturalHeight:null,
        previewBottom:well?Math.round(box(well).bottom):null,
        floor:dock?Math.round(box(dock).top):window.innerHeight,
        summaryAfterWork:(summary&&work)?!!(work.compareDocumentPosition(summary)&Node.DOCUMENT_POSITION_FOLLOWING):null,
      };
    }''')
    assert not state.get('error'), f'{label}: {state.get("error")}'
    assert state['hasNext'] and state['hasInbox'], \
        f'{label}: the next action and the returned-result inbox must compose into one work region, got {state}'
    assert state['controlText'], f'{label}: the work region lost its actionable control'
    assert state['summaryAfterWork'], \
        f'{label}: the passive metric strip must render after the current-work region, not before it'
    # The candidate a filmmaker is being asked to judge is never cropped to fit.
    assert state['hasRow'], \
        f'{label}: the sample fixture no longer offers a returned result, so the media assertions below prove nothing'
    assert state['objectFit']=='contain', \
        f'{label}: returned preview must stay contained, got object-fit {state["objectFit"]!r}'
    if state['naturalW'] and state['naturalH']:
        source=state['naturalW']/state['naturalH']; well=state['wellW']/state['wellH']
        assert abs(source-well) < .06, \
            f'{label}: returned well {state["wellW"]}x{state["wellH"]} does not match the source ratio {state["naturalW"]}x{state["naturalH"]}'
    # The 1280x800 target: decision, evidence and a complete control above the terminal.
    assert state['previewBottom'] <= state['floor'], \
        f'{label}: the returned thumbnail ends at {state["previewBottom"]}, below the terminal at {state["floor"]}'
    assert state['controlBottom'] <= state['floor'], \
        f'{label}: the actionable control ends at {state["controlBottom"]}, below the terminal at {state["floor"]}'
    # Focus after the borders came off. Tab first so the browser is in keyboard
    # modality and :focus-visible genuinely applies.
    page.keyboard.press('Tab')
    rings=page.evaluate('''() => {
      const out={};
      for(const sel of ['.production-work .production-inbox-item','.production-active-list > a','.production-readiness > summary']){
        const n=document.querySelector(sel);
        if(!n){ out[sel]='missing'; continue; }
        n.focus();
        const s=getComputedStyle(n);
        out[sel]=(s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>=1)?'ring':`none(${s.outlineStyle}/${s.outlineWidth})`;
      }
      return out;
    }''')
    assert all(v=='ring' for v in rings.values()), \
        f'{label}: a borderless row or summary lost its keyboard focus ring: {rings}'

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
        upstream=f'http://127.0.0.1:{port}'; base='http://cinebraid-preview-audit.test'
        def proxy(route):
            req=route.request; suffix=req.url[len(base):] if req.url.startswith(base) else '/'; target=upstream+(suffix or '/')
            headers={k:v for k,v in req.headers.items() if k.lower() not in {'host','connection','content-length','accept-encoding'}}
            data=req.post_data_buffer if req.method not in {'GET','HEAD'} else None
            q=urllib.request.Request(target,data=data,headers=headers,method=req.method)
            try:
                with urllib.request.urlopen(q,timeout=30) as r: route.fulfill(status=r.status,headers={k:v for k,v in r.headers.items() if k.lower() not in {'content-encoding','transfer-encoding','connection'}},body=r.read())
            except urllib.error.HTTPError as e: route.fulfill(status=e.code,body=e.read())
        page.route(base+'/**',proxy)
        main_html=urllib.request.urlopen(upstream+'/').read().decode(); main_html=re.sub(r'<link[^>]+href=["\']https?://[^>]+>','',main_html); main_html=main_html.replace('<head>',f'<head><base href="{base}/">',1)
        page.set_content(main_html,wait_until='domcontentloaded',timeout=30000)
        page.wait_for_selector('#main'); page.wait_for_function("document.body.dataset.renderReady === '1'",timeout=30000)
        routes=[
          ('production','#/production'),('shot board','#/shots/board'),('scene list','#/shots/scenes'),('scene','#/scene/SC-SAMPLE'),
          ('references','#/library'),('character','#/character/CHAR-COURIER'),('location','#/location/LOC-PLATFORM'),('prop','#/prop/PROP-PARCEL'),
          ('reports','#/reports'),('settings','#/settings')
        ]
        compact_routes=[('production','#/production'),('references','#/library'),('character','#/character/CHAR-COURIER'),('settings','#/settings')]
        tasks=['inputs','look','frames','motion','deliver']
        scenarios=[
          ('night','large',1440,1000,routes,tasks),
          ('light','large',1440,1000,routes,tasks),
          ('night','deck',1280,800,routes,tasks),
          ('night','tablet',768,1024,compact_routes,tasks),
          ('night','phone',390,844,compact_routes,tasks),
          ('light','phone',390,844,compact_routes,tasks),
        ]
        for theme,vp,w,h,route_set,task_set in scenarios:
            page.evaluate("theme => { localStorage.setItem('ahub-surf',theme); applyTheme(); }",theme)
            page.set_viewport_size({'width':w,'height':h})
            for name,route in route_set:
                page.evaluate("route => { location.hash=route; route && window.route(); }",route)
                page.wait_for_timeout(65)
                assert_page_fit(page,f'{theme}/{vp}/{name}')
                # The polish pass's own target viewport, once, on the surface it changed.
                if name=='production' and vp=='deck':
                    assert_production_work_region(page,f'{theme}/{vp}/production')
            for task in task_set:
                page.evaluate("task => { localStorage.setItem('cinebraid-focused:cinebraid-sample:shot-task:SAMPLE-01',task); location.hash='#/shot/SAMPLE-01'; window.route(); }",task)
                page.wait_for_timeout(80)
                assert_page_fit(page,f'{theme}/{vp}/shot-{task}')
        page.set_viewport_size({'width':1280,'height':800})
        bible_html=urllib.request.urlopen(upstream+'/bible.html').read().decode(); bible_html=bible_html.replace('<head>',f'<head><base href="{base}/">',1)
        page.set_content(bible_html,wait_until='domcontentloaded',timeout=30000); page.wait_for_timeout(350)
        overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
        assert overflow<=2,f'project-bible overflow {overflow}px'
        browser.close()
    print('Private-preview real-browser layout audit passed production, boards, scenes, all five shot tasks, references, entity pages, reports, settings, Project Bible, dark/light themes, and large/Deck/tablet/phone viewport containment, plus the composed Production current-work region at 1280x800.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
