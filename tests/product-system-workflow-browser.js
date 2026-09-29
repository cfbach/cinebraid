/* Product-system workflow browser proof. A fresh copy of the shipped sample is edited
 * through the visible Bible and Frame forms. Page evaluation only reads state/geometry.
 * Provider credentials are absent, outbound server HTTP is blocked, and browser provider
 * writes are refused. No generation, approval, or fabricated production fixture is used. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),assert=require('assert');
const {spawn}=require('child_process');
const {disposableRoot}=require('./helpers/disposable-root');
const {requirePlaywright}=require('./helpers/playwright-module');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(process.env.CINEBRAID_WORKFLOW_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'cinebraid-workflow-evidence-')));
const checks=[],errors=[],blocked=[],screenshots=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(name,actual,expected=true)=>{const pass=actual===expected;checks.push({name,pass,actual,expected});assert.strictEqual(actual,expected,name);console.log('PASS '+name);};
let server,browser,page;
fs.mkdirSync(OUT,{recursive:true});
const workspace=disposableRoot('product-system-workflow',{withSample:true,config:{activeProject:'cinebraid-sample',appearance:{surface:'night',accent:'green'}}});
async function settled(){await page.waitForFunction(()=>document.body.dataset.renderReady==='1'&&!document.body.dataset.routeError);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});}
async function capture(name){await settled();await page.mouse.move(1,1);await page.screenshot({path:path.join(OUT,name+'.png')});screenshots.push(name+'.png');check(name+' has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
async function waitSaved(){await page.waitForFunction(()=>typeof projectSaveSettled==='function'&&projectSaveSettled().settled);}
// Exercise the actual native disclosure with keyboard input and read-only identity snapshots.
async function inspectCurrentContext(name,text,screenshot){
 const summary=page.locator('.rx-context summary');await summary.focus();
 const before=await page.evaluate(()=>({hash:location.hash,selected:document.querySelector('#rx-primary')?.getAttribute('src'),compare:document.querySelector('#rx-compare')?.value||'',project:JSON.stringify(P),scroll:document.querySelector('#main').scrollTop}));
 await summary.press('Enter');await page.locator('.rx-context-body').waitFor({state:'visible'});
 check(name+' exposes the complete current creative text',await page.locator('.rx-context-body').innerText().then(t=>t.includes('Current intention: '+text)));
 check(name+' current context is distinct from original request',await page.locator('.rx-context-note').innerText().then(t=>t.includes('Current creative text')&&t.includes('original submitted request')));
 await page.keyboard.press('Tab');check(name+' full text region is keyboard reachable',await page.locator('.rx-context-body').evaluate(el=>document.activeElement===el));
 const scrollable=await page.locator('.rx-context-body').evaluate(el=>el.scrollHeight>el.clientHeight);
 if(scrollable){await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('.rx-context-body').scrollTop>0);check(name+' long text can be scrolled from the keyboard',await page.locator('.rx-context-body').evaluate(el=>el.scrollTop>0));await page.keyboard.press('Home');}
 if(await page.locator('.rx-screening').count())check(name+' reading context retains usable media geometry',await page.locator('.rx-stage img,.rx-stage video').evaluateAll(elements=>elements.every(el=>el.getBoundingClientRect().height>=110)));
 await capture(screenshot);await page.keyboard.press('Escape');
 check(name+' Escape closes context and restores summary focus',await summary.evaluate(el=>!el.closest('details').open&&document.activeElement===el));
 const after=await page.evaluate(()=>({hash:location.hash,selected:document.querySelector('#rx-primary')?.getAttribute('src'),compare:document.querySelector('#rx-compare')?.value||'',project:JSON.stringify(P),scroll:document.querySelector('#main').scrollTop}));
 check(name+' disclosure preserves exact key, selection and comparison',JSON.stringify([after.hash,after.selected,after.compare]),JSON.stringify([before.hash,before.selected,before.compare]));
 check(name+' disclosure writes no project or approval data',after.project,before.project);
 check(name+' disclosure preserves review scroll',Math.abs(after.scroll-before.scroll)<=1);
}
async function visiblePreview(name){
 await page.waitForFunction(()=>[...document.querySelectorAll('.rx-thumb img,#rx-primary')].some(el=>el.complete&&el.naturalWidth>0));
 const geometry=await page.evaluate(()=>{const footer=document.querySelector('.rx-decision').getBoundingClientRect(),main=document.querySelector('#main').getBoundingClientRect();return [...document.querySelectorAll('.rx-thumb img,#rx-primary')].map(el=>{const r=el.getBoundingClientRect();return {width:Math.max(0,Math.min(r.right,innerWidth)-Math.max(0,r.left)),height:Math.max(0,Math.min(r.bottom,footer.top,main.bottom,innerHeight)-Math.max(r.top,main.top,0)),loaded:el.complete&&el.naturalWidth>0};});});
 check(name+' shows meaningful loaded media above sticky approval',geometry.some(r=>r.loaded&&r.width>=140&&r.height>=96));
}
(async()=>{try{
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 assert(![4477,4692].includes(port));const base='http://127.0.0.1:'+port;
 const log=fs.openSync(path.join(OUT,'server.log'),'w');
 server=spawn(process.execPath,['-r','./tests/helpers/ev2-6-no-network.js','server.js'],{cwd:ROOT,env:workspace.serverEnv(port),stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 let ready=false;for(let attempt=0;attempt<150&&!ready;attempt++){try{ready=(await fetch(base+'/api/project')).ok;}catch{}if(server.exitCode!==null)throw Error('Isolated server exited');if(!ready)await sleep(100);}assert(ready,'Isolated sample starts');
 browser=await requirePlaywright('product-system-workflow').chromium.launch({headless:true,...(process.env.CINEBRAID_BROWSER_EXECUTABLE?{executablePath:process.env.CINEBRAID_BROWSER_EXECUTABLE}:{})});
 console.log('[browser-runtime] Chromium '+browser.version());
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base){blocked.push(url.origin);return route.abort();}if(request.method()!=='GET'&&/^\/api\/(generation|accounts|assistant\/test)/.test(url.pathname)){blocked.push(url.pathname);return route.abort();}return route.continue();});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#/library/characters');await page.locator('.rd-library-card[href="#/character/CHAR-COURIER"]').waitFor();await settled();
  await page.locator('.rd-library-card[href="#/character/CHAR-COURIER"]').click();await page.locator('[data-reference-desk]').waitFor();await settled();
  check(width+' sample role says Front',await page.locator('[data-rd-candidate="CHAR-COURIER-FRONT.png"] .rd-candidate-role').textContent(),'Front');
  const state=await page.locator('#rd-state').inputValue();
  const selected=await page.locator('[data-rd-candidate][aria-pressed="true"]').getAttribute('data-rd-candidate');
  await page.locator('[data-rd-action="inspect"]').click();await page.locator('#rd-bible-intention').waitFor({state:'visible'});
  await capture(width+'-reference-intention');
  await page.locator('#rd-bible-intention').click();await page.locator('[data-wb="edit"][data-field="creationDescription"]').waitFor();
  check(width+' Bible opens the exact element',new URL(page.url()).hash,'#/bible/characters/CHAR-COURIER');
  const description='Copper clasp '+width+'. Adult courier in a slate-blue weatherproof coat with a distinctive copper clasp at the collar, dark trousers and a compact leather shoulder bag. The practical silhouette stays readable against the pale railway platform. Damp fabric catches a narrow rim of amber light; the clasp and the bag strap remain consistent between the front and profile views. Keep the expression attentive and unhurried, without decorative insignia.';
  await page.locator('[data-wb="edit"][data-field="creationDescription"]').click();await page.locator('#wb-text').fill(description);await page.locator('[data-wb="save"]').click();await page.locator('#wb-text').waitFor({state:'detached'});await waitSaved();
  check(width+' saved Bible text is visible',await page.locator('#wb-document').innerText().then(t=>t.includes(description)));
  await capture(width+'-bible-saved-intention');
  await page.locator('[data-media-return]').click();await page.locator('[data-reference-desk]').waitFor();await settled();
  check(width+' Bible return keeps the reference state',await page.locator('#rd-state').inputValue(),state);
  check(width+' Bible return keeps the exact candidate',await page.locator('[data-rd-candidate][aria-pressed="true"]').getAttribute('data-rd-candidate'),selected);
  if(width===390){await page.locator('[data-reference-details-dialog]').waitFor({state:'visible'});check(width+' Bible return reopens reference details',await page.locator('[data-reference-details-dialog]').innerText().then(t=>t.includes(description)));await page.locator('[data-reference-details-dialog] .cancel').click();}
  await page.locator('[data-rd-action="results"]').click();await page.locator('[data-results-desk]').waitFor();await settled();
  check(width+' Results owns its workspace without legacy entity panes',await page.locator('.focused-entity-shell,.focused-inspector').count(),0);
  check(width+' Results retains the complete current Bible intention',await page.locator('.rx-context-body').textContent().then(t=>t.includes('Current intention: '+description)));
  check(width+' long current context starts compact',await page.locator('.rx-context').evaluate(el=>!el.open));
  await visiblePreview(width+' initial Results');
  check(width+' Results cards carry Front and Profile identities',await page.locator('.rx-card-info b').allTextContents().then(labels=>labels.includes('Front \u00b7 Result 1')&&labels.includes('Profile \u00b7 Result 2')));
  const resultCards=page.locator('[data-rx-key]');if(await resultCards.count()>1&&await resultCards.nth(1).getAttribute('aria-pressed')!=='true')await resultCards.nth(1).click();
  const exactResult=new URL(page.url()).hash;
  await capture(width+'-results-current-intention');
  await inspectCurrentContext(width+' Results',description,width+'-results-intention-expanded');
  const selectedLabel=await page.locator('.rx-selected h2').textContent();
  check(width+' selected preview keeps the role and result index',await page.locator('.rx-selected figcaption').textContent().then(t=>t.includes(selectedLabel)));
  if(width===390){
   // Explicit presentation-only HTML fixture, separate from the sample/project page.
   // It tests a long caption with the shipped CSS; no project or browser-app data is changed.
   const layout=await context.newPage(),css=fs.readFileSync(path.join(ROOT,'public/results-desk.css'),'utf8');
   await layout.setContent('<style>'+css+'</style><section class="results-desk"><aside class="rx-selected"><div class="rx-selected-media"><figure class="rx-media rx-media-open"><img alt=""><button class="rx-open"><span>Open in Screening</span></button><figcaption>Long recorded front-facing view in the weatherproof travel coat, with the collar clasp clearly visible \u00b7 Result 24 \u00b7 Selected result</figcaption></figure></div></aside></section>');
   const geometry=await layout.evaluate(()=>{const caption=document.querySelector('figcaption').getBoundingClientRect(),overlay=document.querySelector('.rx-open').getBoundingClientRect();return {captionHeight:caption.height,overlap:overlay.bottom-caption.top};});
   check('390 isolated long-role layout fixture wraps its complete caption',geometry.captionHeight>32);
   check('390 isolated long-role layout fixture keeps preview control clear of caption',geometry.overlap<=1);
   await layout.close();
  }
  await page.locator('#rx-screen').click();await page.locator('.rx-screening').waitFor();await settled();
  check(width+' Screening names its selected reference view',await page.locator('.rx-stage figcaption').first().textContent().then(t=>t.includes(selectedLabel)));
  const comparison=await page.locator('#rx-compare option').nth(1).getAttribute('value');
  check(width+' Compare choice names the recorded Front view',await page.locator('#rx-compare option').nth(1).textContent().then(t=>t.startsWith('Front \u00b7 Result 1')));
  await page.locator('#rx-compare').selectOption(comparison);await settled();
  check(width+' comparison captions distinguish selected Profile from Front',await page.locator('.rx-stage figcaption').allTextContents().then(labels=>labels[0].includes('Profile \u00b7 Result 2')&&labels[0].includes('Selected result')&&labels[1].includes('Front \u00b7 Result 1')&&labels[1].includes('Comparison only')));
  await capture(width+'-reference-screening-comparison');
  await inspectCurrentContext(width+' Screening',description,width+'-screening-intention-expanded');
  check(width+' closing intention remains in Screening',await page.locator('.rx-screening').count(),1);
  await page.locator('#rx-screen').click();await page.locator('.rx-contact').waitFor();await settled();
  check(width+' Screening returns to the exact selected key',new URL(page.url()).hash,exactResult);
  await page.locator('#rx-revise').click();await page.locator('[data-create-target="characters:CHAR-COURIER"] .creation-description').waitFor({state:'visible'});await settled();
  await page.waitForFunction(()=>{const el=document.querySelector('[data-create-target="characters:CHAR-COURIER"] .creation-description'),r=el?.getBoundingClientRect();return r&&r.top>=64&&r.bottom<=innerHeight-54&&document.activeElement===el;});
  check(width+' primary revise lands on the visible editor',await page.locator('[data-create-target="characters:CHAR-COURIER"] .creation-description').evaluate(el=>document.activeElement===el));
  check(width+' primary revise opens the manual prompt description',await page.locator('[data-create-target="characters:CHAR-COURIER"] .creation-description').inputValue(),description);
  check(width+' primary revise selects Primary reference',await page.locator('.bounded-entity-taskbar .selected b').textContent(),'Primary reference');
  await capture(width+'-primary-prompt-handoff');
  await page.locator('[data-media-return]').click();await page.locator('[data-results-desk]').waitFor();await settled();
  check(width+' primary prompt returns to the exact Results key',new URL(page.url()).hash,exactResult);
  await page.keyboard.press('/');await page.locator('#global-search').fill('Copper clasp '+width);await page.locator('#modal [data-global-navigation]').waitFor();
  const searchLink=page.locator('#modal a[href="#/character/CHAR-COURIER"]');await searchLink.waitFor();
  check(width+' global search finds newly saved Bible description',await searchLink.innerText().then(t=>t.includes('The courier')&&t.includes('Copper clasp '+width)));
  await capture(width+'-search-saved-description');await searchLink.click();await page.locator('[data-reference-desk]').waitFor();await settled();
  check(width+' global search clears the earlier contextual return',await page.locator('[data-media-return]').count(),0);
  // A real frame edit proves the persisted creationBrief.frameWorkflows writer/reader seam.
  await page.goto(base+'/#/shot/SAMPLE-03');await page.locator('[data-cb-stage-bar]').waitFor();if(width===390)await page.locator('#cb-stage-chooser-toggle').click();await page.locator('[data-stage-id="frames"]').click();
  const frameField=page.locator('.guided-primary-brief').first();if(!await frameField.isVisible())await page.locator('.guided-frame-card>summary').first().click();await frameField.waitFor({state:'visible'});
  const action='Current frame direction '+width+': the courier raises the open parcel toward the platform light, keeping both hands and the copper clasp clearly visible.';
  await frameField.fill(action);await frameField.press('Tab');await waitSaved();
  await page.locator('.shot-primary-action[onclick*="openReturnedResultReview"]').first().click();await page.locator('[data-results-desk]').waitFor();await settled();
  check(width+' Frame Results follows the form-edited action',await page.locator('.rx-context-body').textContent().then(t=>t.includes('Current intention: '+action)));
  await capture(width+'-frame-results-intention');
  await page.locator('#rx-screen').click();await page.locator('.rx-screening').waitFor();await settled();
  await inspectCurrentContext(width+' Frame Screening',action,width+'-frame-screening-intention');
  await context.close();page=null;
 }
 check('No browser script errors',errors.length,0);check('No provider request attempted',blocked.length,0);
}catch(error){errors.push(error.stack||String(error));if(page)await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});process.exitCode=1;
}finally{
 if(browser)await browser.close();if(server){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),sleep(3000)]);}workspace.cleanup();
 const logPath=path.join(OUT,'server.log');if(fs.existsSync(logPath))fs.writeFileSync(logPath,fs.readFileSync(logPath,'utf8').split(workspace.home).join('<disposable-root>').split(ROOT).join('<checkout>'));
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({passed:!process.exitCode,checks,errors,blocked,screenshots,fixture:'Shipped CineBraid sample, copied into a fresh disposable root; all creative edits performed through visible UI.',viewportWidths:[1440,390],layoutFixture:'A separate static HTML page uses the shipped Results CSS to verify a long caption cannot overlap its media control. It never loads or mutates project data.',providerCalls:0},null,2));
 if(!process.exitCode&&fs.existsSync(path.join(OUT,'failure.png')))fs.unlinkSync(path.join(OUT,'failure.png'));
 console.log('Workflow browser evidence: '+OUT);if(errors.length)console.error(errors.join('\n'));
}})();
