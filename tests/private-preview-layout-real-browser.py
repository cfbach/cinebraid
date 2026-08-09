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
    print('Private-preview real-browser layout audit passed production, boards, scenes, all five shot tasks, references, entity pages, reports, settings, Project Bible, dark/light themes, and large/Deck/tablet/phone viewport containment.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
