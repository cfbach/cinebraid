/* Navigate the real shared shell in one Chromium session. Every server and project
 * belongs to disposableRoot; port 4692 and installed projects are never accessed. */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const assert = require('assert');
const {spawn, spawnSync} = require('child_process');
const {disposableRoot} = require('./helpers/disposable-root');
const {requirePlaywright} = require('./helpers/playwright-module');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.CINEBRAID_VISUAL_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'cinebraid-visual-shell-captures-')));
const BASELINE = process.env.CINEBRAID_VISUAL_BASELINE === '1';
// Read-only negative control: serve the base commit's CSS without changing the worktree.
const BASE_CSS = process.env.CINEBRAID_VISUAL_BASE_CSS === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const checks = [], errors = [], readings = [];
function check(name, ok, detail) { checks.push({name, ok:!!ok, detail}); console.log(`${ok?'PASS':'FAIL'} ${name}`); }

// Active navigation changes before async route content arrives. Require the matching
// heading AND the router's settled flag, so styles never come from the previous view.
const ROUTE_CONTENT = {
  production: ['.production-home-head .view-title', 'Production'],
  shots: ['.board-head .view-title', 'Shots'],
  library: ['.rd-library .rd-heading h1', 'References'],
  results: ['.production-contact-sheet .md-heading h1', 'Production media'],
  bible: ['.wb-dossier .wb-heading h1', 'Working Bible'],
  reports: ['.reports-head .view-title', 'Reports'],
  settings: ['.settings-view-head .view-title', 'Studio'],
};
async function waitForRouteContent(page, view) {
  const [selector, heading] = ROUTE_CONTENT[view];
  await page.waitForFunction(({view, selector, heading}) => {
    const content = document.querySelector('#main ' + selector);
    const box = content?.getBoundingClientRect();
    return location.hash.split('/')[1] === view
      && document.body.dataset.renderReady === '1'
      && !document.body.dataset.routeError
      && document.querySelector(`#nav [data-view="${view}"]`)?.classList.contains('active')
      && content?.textContent.trim() === heading && box.width > 0 && box.height > 0;
  }, {view, selector, heading});
  // The drawer can still be closing after the new DOM is ready. Wait for actual
  // finite animations and fonts, not an elapsed-time guess, before reading geometry.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function waitForTheme(page, theme) {
  await page.waitForFunction(expected => document.querySelector('#app')?.dataset.surf === expected, theme);
  assert.strictEqual(await page.locator('#app').getAttribute('data-surf'), theme, 'The requested surface must be applied before measuring styles');
}
(async () => {
  fs.mkdirSync(OUT, {recursive:true});
  const workspace = disposableRoot('visual-shell', {withSample:true, config:{appearance:{surface:'night',accent:'green'}}});
  let server, browser;
  try {
    const port = await new Promise(r => {const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port; s.close(()=>r(p));});});
    assert(![4477,4692].includes(port));
    const base = `http://127.0.0.1:${port}`;
    const log = fs.openSync(path.join(OUT,'server.log'),'w');
    server = spawn(process.execPath,['-r','./tests/helpers/ev2-6-no-network.js','server.js'],{cwd:ROOT,env:workspace.serverEnv(port),stdio:['ignore',log,log]});
    fs.closeSync(log);
    for(let i=0;i<150;i++){try{if((await fetch(base+'/api/app-identity')).ok)break;}catch{} if(server.exitCode!==null)throw Error('Server exited');await sleep(100);}
    browser = await requirePlaywright('visual shell').chromium.launch({headless:true,...(process.env.CINEBRAID_BROWSER_EXECUTABLE?{executablePath:process.env.CINEBRAID_BROWSER_EXECUTABLE}:{})});
    console.log('[browser-runtime] visual-shell-coherence: launched Chromium ' + browser.version() + ' (Node Playwright)');
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*', r => {
      const url = new URL(r.request().url());
      if (url.origin !== base) return r.abort();
      if (BASE_CSS && /^\/[a-z-]+\.css$/.test(url.pathname)) {
        const css = spawnSync('git', ['show', 'HEAD:public' + url.pathname], {cwd:ROOT, encoding:'utf8'});
        assert.strictEqual(css.status, 0, css.stderr);
        return r.fulfill({contentType:'text/css', body:css.stdout});
      }
      return r.continue();
    });
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/#/production');
    await page.waitForFunction(()=>typeof P!=='undefined'&&P?.shots?.length);
    await waitForRouteContent(page, 'production');
    await waitForTheme(page, 'night');
    const identity = await page.evaluate(()=>({id:P.meta?.id,title:P.meta?.title,shot:P.shots[0].id,entity:P.characters[0]?.id}));
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:1000});
      let baseline;
      for(const route of ['production','shots','library','results','bible','reports','settings','production']){
        if(width===390) await page.locator('#mobile-nav').click();
        await page.locator(`#nav [data-view="${route}"]`).click();
        await waitForRouteContent(page, route);
        await waitForTheme(page, 'night');
        const read = await page.evaluate(()=>{
          const selectors=['#rail','#topbar','#rail .project-title','#nav .nav-btn.active','#global-add','#automation-activity-toggle','#save-state','#main'];
          const styles={};
          for(const s of selectors){const e=document.querySelector(s),c=getComputedStyle(e),r=e.getBoundingClientRect(); styles[s]={x:r.x,y:r.y,w:r.width,h:r.height,bg:c.backgroundColor,color:c.color,font:c.fontFamily,size:c.fontSize,line:c.lineHeight,padding:c.padding,radius:c.borderRadius,display:c.display};}
          const h=document.querySelector('#main h1, #main .view-title');
          const hc=h&&getComputedStyle(h),hr=h?.getBoundingClientRect();
          return {hash:location.hash,body:document.body.className,styles,heading:h?{text:h.textContent,x:hr.x,y:hr.y,font:hc.fontFamily,size:hc.fontSize,line:hc.lineHeight}:null,overflow:document.documentElement.scrollWidth>innerWidth,project:P.meta?.title,theme:document.querySelector('#app').dataset.surf,status:['--green','--blue','--amber','--red'].map(t=>getComputedStyle(document.querySelector('#app')).getPropertyValue(t).trim()),railOpen:document.body.classList.contains('rail-open')};
        });
        readings.push({width,route,...read});
        if(!baseline) baseline=read;
        await page.screenshot({path:path.join(OUT,`${width}-${route}.png`)});
        check(`${width} ${route}: correct route`,read.hash.startsWith('#/'+route),read.hash);
        check(`${width} ${route}: same project`,read.project===identity.title);
        check(`${width} ${route}: no horizontal page overflow`,!read.overflow);
        check(`${width} ${route}: drawer closes on navigation`,!read.railOpen);
        if(!BASELINE){
          for(const s of ['#rail','#topbar','#rail .project-title','#nav .nav-btn.active','#global-add','#automation-activity-toggle','#save-state']) {
            const a={...baseline.styles[s]}, b={...read.styles[s]};
            // Labels may change their intrinsic width with state; all chrome treatment must stay stable.
            if(['#automation-activity-toggle','#save-state','#global-add'].includes(s)){delete a.w;delete b.w;delete a.x;delete b.x;}
            if(s==='#nav .nav-btn.active'){delete a.y;delete b.y;}
            check(`${width} ${route}: coherent ${s}`,JSON.stringify(a)===JSON.stringify(b),{a,b});
          }
          check(`${width} ${route}: same page backdrop`,read.styles['#main'].bg===baseline.styles['#main'].bg);
          check(`${width} ${route}: shared heading font and size`,read.heading.font===baseline.heading.font&&read.heading.size===baseline.heading.size&&read.heading.line===baseline.heading.line);
          check(`${width} ${route}: aligned page gutter`,read.heading.x===baseline.heading.x);
          check(`${width} ${route}: status hues unchanged`,JSON.stringify(read.status)===JSON.stringify(baseline.status));
        }
      }
    }
    // Preferences are browser-local test inputs. A route must not replace the chosen surface.
    if (!BASELINE) {
      await page.setViewportSize({width:1440,height:1000});
      for (const theme of ['night','cool','warm','light']) {
        await page.evaluate(t => {localStorage.setItem('ahub-surf',t); applyTheme();}, theme);
        await waitForTheme(page, theme);
        let expected;
        for (const route of ['production','shots','library','results','bible','reports','settings']) {
          await page.locator(`#nav [data-view="${route}"]`).click();
          await waitForRouteContent(page, route);
          await waitForTheme(page, theme);
          const appliedTheme = await page.locator('#app').getAttribute('data-surf');
          check(`${theme} ${route}: requested surface is applied`, appliedTheme === theme, appliedTheme);
          const seen = await page.evaluate(() => {
            const c=getComputedStyle(document.querySelector('#app'));
            return ['--bg-2','--panel','--ink','--muted','--acc','--green','--blue','--amber','--red'].map(t=>c.getPropertyValue(t).trim());
          });
          expected ||= seen;
          check(`${theme} ${route}: saved palette survives navigation`,JSON.stringify(seen)===JSON.stringify(expected),seen);
          if (route === 'library') {
            const colors = await page.evaluate(() => {
              const card = document.querySelector('.rd-library-card');
              const text = getComputedStyle(card.querySelector('p')).color;
              const background = getComputedStyle(card).backgroundColor;
              return {text, background};
            });
            const luminance = c => c.match(/[\d.]+/g).slice(0,3).map(n => {
              const v=Number(n)/255; return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
            }).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
            const a=luminance(colors.text), b=luminance(colors.background);
            const contrast=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
            check(`${theme}: reference status contrast >=4.5:1`,contrast>=4.5,{...colors,contrast});
          }
          if(theme==='light' && ['production','library'].includes(route)) await page.screenshot({path:path.join(OUT,`light-${route}.png`)});
        }
      }
      await page.goBack();
      await waitForRouteContent(page, 'reports');
      await waitForTheme(page, 'light');
      check('Browser Back restores Reports',await page.locator('#nav [data-view="reports"]').evaluate(e=>e.classList.contains('active')));
      await page.goForward();
      await waitForRouteContent(page, 'settings');
      await waitForTheme(page, 'light');
      check('Browser Forward restores Settings',await page.locator('#nav [data-view="settings"]').evaluate(e=>e.classList.contains('active')));
    }
    check('No browser errors',errors.length===0,errors);
    fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({base,workspace:workspace.root || workspace.home || workspace.projectsRoot,identity,browser:browser.version(),baseline:BASELINE,checks,errors,readings},null,2));
    assert(checks.every(c=>c.ok),`${checks.filter(c=>!c.ok).length} checks failed; see ${OUT}`);
  } finally {if(browser)await browser.close();if(server && server.exitCode===null){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}workspace.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
