/* EV2-5 mobile header regression: geometry against the accepted parent, all panels.
   Disposable server/settings/projects; provider traffic blocked; fresh browser profile. */
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), assert = require('assert'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { disposableRoot } = require('./helpers/disposable-root');
const playwright = require('./helpers/playwright-module').requirePlaywright('ev2-5-settings-mobile');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.EV2_ACCEPTANCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-ev2-5-mobile-'));
fs.mkdirSync(OUT, { recursive: true });
/* THE ACCEPTED PARENT'S STYLESHEET TRAVELS WITH THE SUITE. It was read with `git show`, and the browser job
   checks out one commit (actions/checkout, fetch-depth 1), so fa8a09e was never there to read - git then says
   the path "exists on disk, but not in" the commit it cannot open. The copy is proved, not trusted: its git
   blob id must be the one fa8a09e records for public/settings-studio.css, and wherever that commit is present,
   git must agree. */
const PARENT = { commit: 'fa8a09e2057a8b896ce6dadf65595c1e2b7671f1', path: 'public/settings-studio.css', blob: '1a6bb40cf6a61081f558e3a2145cd973e3ba395e' };
const parentCss = fs.readFileSync(path.join(__dirname, 'fixtures', 'ev2-5', 'settings-studio.fa8a09e.css'), 'utf8').split('\r\n').join('\n');
assert.strictEqual(crypto.createHash('sha1').update(`blob ${Buffer.byteLength(parentCss)}\0`).update(parentCss).digest('hex'), PARENT.blob,
  `tests/fixtures/ev2-5/settings-studio.fa8a09e.css must be ${PARENT.path} exactly as ${PARENT.commit.slice(0, 7)} records it`);
const recorded = spawnSync('git', ['rev-parse', '--verify', '-q', `${PARENT.commit}:${PARENT.path}`], { cwd: ROOT, encoding: 'utf8' });
if (recorded.status === 0) assert.strictEqual(recorded.stdout.trim(), PARENT.blob, `git records a different ${PARENT.path} at ${PARENT.commit.slice(0, 7)} than the fixture`);
const currentCss = fs.readFileSync(path.join(ROOT, 'public/settings-studio.css'), 'utf8');
const panels = ['overview','connections','appearance','files','access','naming','project','assistant','generation','integrations','accounts','fal','assistant-ollama','assistant-openai','assistant-anthropic','assistant-custom','recovery','project-recovery','setup'];
const widths = [390,759,760,761,899,900,901,1280,1440];
const reported = ['generation','files','access','integrations','project','project-recovery'];
const w = disposableRoot('ev2-5-mobile', { withSample: true, config: { activeProject: 'cinebraid-sample' } });
const fixture = path.join(w.projectsRoot, 'cinebraid-sample/project.json');
const project = JSON.parse(fs.readFileSync(fixture)); project.meta.title = 'Signal House · Mobile proof'; fs.writeFileSync(fixture, JSON.stringify(project));
let server, browser; const measurements = [], checks = [], errors = [], requests = [];
const check = (name, value) => { checks.push({ name, passed: !!value }); assert(value, name); };
function geometry() {
  const panel = document.querySelector('.settings-selected-tab');
  const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height }; };
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const controls = [...panel.querySelectorAll('input,select,textarea,button,a,summary')].filter(visible);
  const headers = [...panel.querySelectorAll('.settings-block>.settings-title-row>div:not(.settings-inline-actions)')].map(el => {
    const box = rect(el), children = [...el.children].filter(visible);
    return { box, basis:getComputedStyle(el).flexBasis, trailing:box.y+box.h-Math.max(...children.map(x=>{const r=rect(x);return r.y+r.h;})), direction:getComputedStyle(el.parentElement).flexDirection };
  });
  return { headers, overflow:document.documentElement.scrollWidth>innerWidth+1,
    order:controls.map(el=>[el.tagName,el.id,el.getAttribute('aria-label')||'',el.textContent.trim().slice(0,90)]),
    controls:controls.map(el=>({box:rect(el),height:getComputedStyle(el).minHeight})),
    markup:panel.innerHTML,
    mobileSelector:!!document.querySelector('.studio-compact-nav') && visible(document.querySelector('.studio-compact-nav')),
    // EV2-7 one index: absolute layout facts, measured in the corrected document only.
    panels:document.querySelectorAll('.settings-selected-tab').length, navs:document.querySelectorAll('nav.studio-nav').length,
    indexOutsidePanel:!panel.querySelector('.studio-nav,.studio-compact-nav'),
    navLinksVisible:!!document.querySelector('.studio-nav-links') && visible(document.querySelector('.studio-nav-links')),
    currentLink:document.querySelector('.studio-nav-links a[aria-current=page]') && visible(document.querySelector('.studio-nav-links a[aria-current=page]')) ? rect(document.querySelector('.studio-nav-links a[aria-current=page]')) : null,
    nav:rect(document.querySelector('nav.studio-nav')), panelBox:rect(panel),
    select:document.querySelector('.studio-compact-nav select') && visible(document.querySelector('.studio-compact-nav select')) ? { box:rect(document.querySelector('.studio-compact-nav select')), value:document.querySelector('.studio-compact-nav select').value } : null,
    headTrailing:(() => { const head=document.querySelector('.view-head'); if(!head) return 0; const box=rect(head), children=[...head.children].filter(visible); return children.length ? box.y+box.h-Math.max(...children.map(x=>{const r=rect(x);return r.y+r.h;})) : 0; })(),
  };
}
(async () => { try {
  const port = await new Promise(resolve => { const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
  assert.notStrictEqual(port,4477); const base=`http://127.0.0.1:${port}`;
  const log=fs.openSync(path.join(OUT,'responsive-fixture.log'),'w');
  server=spawn(process.execPath,['-r','./tests/helpers/ev2-5-no-network.js','server.js'],{cwd:ROOT,env:w.serverEnv(port),stdio:['ignore',log,log]});
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/project')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await playwright.chromium.launch({headless:true,...(process.env.CINEBRAID_BROWSER_EXECUTABLE?{executablePath:process.env.CINEBRAID_BROWSER_EXECUTABLE}:{})});
 console.log('[browser-runtime] ev2-5-settings-mobile: launched Chromium '+browser.version()+' (Node Playwright)');
  const context=await browser.newContext({reducedMotion:'reduce'});
  let baseline = true;
  await context.route('**/*',r=>{
    if(!r.request().url().startsWith(base+'/'))return r.fulfill({body:''});
    if(new URL(r.request().url()).pathname==='/settings-studio.css')return r.fulfill({contentType:'text/css',body:baseline?parentCss:currentCss});
    if(r.request().method()!=='GET')requests.push(new URL(r.request().url()).pathname);
    return r.continue();
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  for(const width of widths){
    await page.setViewportSize({width,height:width===390?844:width===1280?720:900});
    for(const panel of panels){
      const pair=[];
      for(const before of [true,false]){
        baseline=before; await page.goto(base+'/?proof='+(before?'parent':'corrected')+'#/settings/'+panel);
        await page.locator(`[data-settings-tab="${panel}"]`).waitFor();
        await page.waitForTimeout(80);
        // Wait for local read-only containers so geometry and DOM are comparable.
        await page.waitForFunction(()=>!document.querySelector('#comfy-workflow-list[data-state="loading"]') && (typeof CIVITAI_SETTINGS==='undefined'||!CIVITAI_SETTINGS.loading));
        const g=await page.evaluate(geometry);pair.push(g);
        if((width===390 && (!before||reported.includes(panel))) || (!before && [760,900,1280,1440].includes(width) && reported.includes(panel)))
          await page.screenshot({path:path.join(OUT,`${before?'before':'after'}-${panel}-${width}.png`)});
      }
      const [old,now]=pair;
      measurements.push({panel,width,before:old.headers,after:now.headers});
      check(`${panel}/${width}: no overflow`,!now.overflow);
      check(`${panel}/${width}: DOM/control order unchanged`,JSON.stringify(old.order)===JSON.stringify(now.order));
      check(`${panel}/${width}: touch-target heights retained`,old.controls.every((x,i)=>now.controls[i].box.h>=x.box.h-.5));
      check(`${panel}/${width}: natural header height`,now.headers.every(h=>h.direction!=='column'||h.trailing<=2));
      // EV2-7 replaced the parent desktop geometry on purpose: one index column beside one capped panel.
      check(`${panel}/${width}: one panel and one index, index outside the panel`,now.panels===1&&now.navs===1&&now.indexOutsidePanel);
      check(`${panel}/${width}: view head has no reserved trailing space`,now.headTrailing<=2);
      if(width>760){
        check(`${panel}/${width}: desktop index visible with a 44px current entry`,now.navLinksVisible&&!!now.currentLink&&now.currentLink.h>=44-.5);
        check(`${panel}/${width}: panel sits beside the index`,now.panelBox.x>=now.nav.x+now.nav.w-.5);
        check(`${panel}/${width}: panel keeps a readable measure`,now.panelBox.w<=1040+.5&&(width!==1280||now.panelBox.w>=600));
      } else {
        check(`${panel}/${width}: compact select is a 44px target showing this panel`,!!now.select&&now.select.box.h>=44-.5&&now.select.value===panel);
      }
      check(`${panel}/${width}: compact section selector preserved`,now.mobileSelector===(width<=760));
      if(width===390&&reported.includes(panel))check(`${panel}: regression reproduced in parent`,old.headers.some(h=>h.trailing>100));
      // Non-mutating pointer and keyboard reachability, including long panels below fold.
      const interactive=page.locator('.settings-selected-tab input:not([disabled]):visible,.settings-selected-tab select:not([disabled]):visible,.settings-selected-tab textarea:not([disabled]):visible');
      if(await interactive.count()){
        const target=interactive.first();await target.scrollIntoViewIfNeeded();await target.click();check(`${panel}/${width}: pointer reaches first field`,await target.evaluate(el=>el===document.activeElement));
        await page.keyboard.press('Tab');check(`${panel}/${width}: keyboard reaches next control`,await page.evaluate(()=>document.activeElement!==document.body));
      } else {
        const target=page.locator('.settings-selected-tab button:not([disabled]):visible,.settings-selected-tab a:visible,.settings-selected-tab summary:visible').first();
        if(await target.count()){await target.focus();check(`${panel}/${width}: keyboard reaches action`,await target.evaluate(el=>el===document.activeElement));}
      }
    }
  }
  check('No page errors',errors.length===0);check('Inspection submitted no writes or generation',requests.length===0);
  fs.writeFileSync(path.join(OUT,'responsive-validation.json'),JSON.stringify({passed:true,checks,measurements,browser:browser.version(),panels,widths,errors,requests,isolation:{disposable:true,port,serverOutbound:'blocked'}},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,panels:panels.length,widths,captures:OUT}));
} catch(error){fs.writeFileSync(path.join(OUT,'responsive-validation.json'),JSON.stringify({passed:false,error:error.message,checks,measurements,errors,requests},null,2));console.error(error);process.exitCode=1;
} finally {if(browser)await browser.close();if(server){server.kill();await new Promise(r=>server.once('exit',r));}w.cleanup();}})();
