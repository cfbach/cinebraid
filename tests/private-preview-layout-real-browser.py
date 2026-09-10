import os, pathlib, shutil, socket, subprocess, time, re, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
from browser_runtime import require_browser, launch_chromium, disposable_workspace
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

def assert_surface_polish(page, label):
    """Surface Polish V1 - Units 7-10, at the viewport the pass targets.

    Composition and reachability only, one assertion per risk the pass could
    plausibly reintroduce. No pixel, colour or font value is pinned: the sizes
    are the point of the slice and freezing them would block the next one.

      Unit 7  a returned candidate cropped by a well that no longer matches it
      Unit 8  the decision footer taking the flexible row again and pushing the
              human decision away from the content it belongs to
      Unit 9  Inspect landing back on top of the standing counts
      Unit 10 the primary action falling below the terminal
    """
    def box(sel):
        return page.evaluate('''s => { const n=document.querySelector(s); if(!n) return null;
          const r=n.getBoundingClientRect();
          return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),
                  r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)}; }''', sel)

    floor=page.evaluate('''() => { const d=document.querySelector('#cb-shell-dock');
      return d ? Math.round(d.getBoundingClientRect().top) : innerHeight; }''')

    # ---- Unit 7 ---------------------------------------------------------------
    page.evaluate("() => { location.hash='#/shot/SAMPLE-03'; window.route && window.route(); }")
    page.wait_for_timeout(500)
    shot=page.evaluate('''() => {
      const well=document.querySelector('.returned-review-card .guided-lifecycle-preview');
      if(!well) return null;
      const img=well.querySelector('img,video');
      const wb=well.getBoundingClientRect(), ib=img?img.getBoundingClientRect():null;
      return {wellH:Math.round(wb.height), wellW:Math.round(wb.width),
              imgH:ib?Math.round(ib.height):null, imgW:ib?Math.round(ib.width):null,
              fit:img?getComputedStyle(img).objectFit:null,
              action:!!document.querySelector('.returned-review-card .shot-primary-action')}; }''')
    if shot:
        assert shot['fit']=='contain', f'{label}: the returned candidate must stay contained, got {shot["fit"]!r}'
        # The picture may not exceed the well it sits in: the well clips, so an
        # oversized picture is a silent crop of the exact frame being judged.
        if shot['imgH']:
            assert shot['imgH'] <= shot['wellH']+1 and shot['imgW'] <= shot['wellW']+1, \
                f'{label}: the returned candidate {shot["imgW"]}x{shot["imgH"]} overflows its {shot["wellW"]}x{shot["wellH"]} well'
        assert shot['action'], f'{label}: the returned-result card lost its primary action'

    # ---- Unit 8 ---------------------------------------------------------------
    opened=page.evaluate('''() => { const b=document.querySelector('.returned-review-card .shot-primary-action');
      if(!b) return false; b.click(); return true; }''')
    if opened:
        page.wait_for_timeout(900)
        if page.query_selector('.candidate-review-modal'):
            modal, actions = box('.candidate-review-modal'), box('.candidate-review-actions')
            layout, decisions = box('.candidate-review-layout'), box('.candidate-review-decisions')
            stage = box('.candidate-review-stage')
            assert actions and actions['h'] <= 110, \
                f'{label}: the decision footer is {actions["h"]}px tall - it is taking flexible space again'
            assert decisions and decisions['b'] <= modal['b']+1, \
                f'{label}: the human decision group is outside the review dialog'
            assert layout and actions['t'] >= layout['b']-2, \
                f'{label}: the decision footer overlaps the assessment it follows'
            if stage and layout:
                share = stage['w']/layout['w']
                assert share >= .45, f'{label}: media fell to {share:.0%} of the review width'
            for name in ('.candidate-review-decisions .approve-btn','.candidate-review-decisions .chip'):
                assert page.query_selector(name), f'{label}: {name} is missing from the decision group'
        page.evaluate("() => { const c=document.querySelector('.modal .cancel, .candidate-review-title-actions button'); if(c) c.click(); }")
        page.keyboard.press('Escape'); page.wait_for_timeout(500)

    # ---- Unit 9 ---------------------------------------------------------------
    page.evaluate("() => { location.hash='#/library'; window.route && window.route(); }")
    page.wait_for_timeout(500)
    shelf=page.evaluate('''() => {
      const card=document.querySelector('.library-card-shell'); if(!card) return null;
      const chip=card.querySelector('.library-enlarge'), body=card.querySelector('.library-body');
      if(!chip||!body) return {overlap:false, cards:document.querySelectorAll('.library-card').length};
      const c=chip.getBoundingClientRect(), b=body.getBoundingClientRect();
      return {overlap:!(c.right<=b.left||c.left>=b.right||c.bottom<=b.top||c.top>=b.bottom),
              cards:document.querySelectorAll('.library-card').length}; }''')
    if shelf:
        assert not shelf['overlap'], f'{label}: Inspect is sitting on top of the card caption and its counts again'

    # ---- Unit 10 --------------------------------------------------------------
    #
    # THE FLOOR IS READ HERE, ON THIS ROUTE. `floor` above was measured before Units 7-9
    # navigated, and #workspace gives the dock its space back through --cb-dock-reserve,
    # which public/workspace-shell.js re-measures per render. Comparing a control on this
    # route against the terminal's position on an earlier one scored a settled layout
    # against a stale one and reported a 2px overlap that neither layout had.
    #
    # The wait is the app's own completion signal - `body[data-render-ready="1"]`, set by
    # route() when it has finished painting - followed by the reserve actually being
    # written, so the reading is of a settled workspace rather than of a frame in flight.
    page.evaluate("() => { location.hash='#/character/CHAR-COURIER'; window.route && window.route(); }")
    page.wait_for_selector('body[data-render-ready="1"]', timeout=20000)
    page.wait_for_function(
        """() => { const dock=document.querySelector('#cb-shell-dock'); if(!dock) return true;
          const reserve=getComputedStyle(document.getElementById('workspace')).paddingBottom;
          return Math.abs(parseFloat(reserve||'0') - dock.getBoundingClientRect().height) <= 1; }""",
        timeout=20000)
    # REACHED THE WAY A FILMMAKER REACHES IT, then measured where it comes to rest.
    # The page is ~1800px tall, so this control is mid-document and lands wherever the
    # current scroll position puts it; measuring at scrollTop 0 scored an arbitrary
    # offset. What has to be true is that bringing it into view leaves it clear of the
    # Terminal, which is what html{scroll-padding-bottom:var(--cb-dock-reserve)} now
    # guarantees for every scroll the browser performs. Before that property the scroll
    # was a no-op — the control was already "in view" by every measure the browser had,
    # and 1.73px of it was behind the dock.
    page.evaluate("""() => { const a=document.querySelector('.reference-primary-actions button');
      if (a) a.scrollIntoView({block:'end'}); }""")
    page.wait_for_timeout(400)
    settled_floor=page.evaluate('''() => { const d=document.querySelector('#cb-shell-dock');
      return d ? d.getBoundingClientRect().top : innerHeight; }''')
    hero=box('.reference-primary-hero .reference-primary-preview')
    action=page.evaluate('''() => { const n=document.querySelector('.reference-primary-actions button');
      if(!n) return null; const b=n.getBoundingClientRect(); return {b:b.bottom, h:b.height}; }''')
    if hero and action:
        clearance = settled_floor - action['b']
        assert clearance >= 0, \
            (f'{label}: the primary reference action ends at {action["b"]:.2f}, '
             f'{abs(clearance):.2f}px behind the Activity Terminal at {settled_floor:.2f}')
        assert action['h'] > 0, f'{label}: the primary reference action must still have height'
        fit=page.evaluate("() => { const i=document.querySelector('.reference-primary-preview img'); return i?getComputedStyle(i).objectFit:'contain'; }")
        assert fit=='contain', f'{label}: the primary reference image must stay contained, got {fit!r}'

port=free_port()
# Its own writable projects root and config, outside the checkout, seeded from the
# tracked sample. This suite used to inherit whatever the application defaulted to;
# see disposable_workspace() in browser_runtime.py for why that is no longer allowed.
workspace=disposable_workspace('preview-layout')
server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=workspace.env(port),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
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
                    if theme=='night':
                        assert_surface_polish(page,f'{theme}/{vp}')
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
    print('Private-preview real-browser layout audit passed production, boards, scenes, all five shot tasks, references, entity pages, reports, settings, Project Bible, dark/light themes, and large/Deck/tablet/phone viewport containment, plus the composed Production current-work region and Units 7-10 at 1280x800.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    workspace.cleanup()
