/* Focused real-browser Settings acceptance. Real local owners; mocked provider replies.
 * No server outbound traffic, installation data or authenticated browser profile. */
const fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),assert=require('assert');
const {spawn}=require('child_process');
const {disposableRoot}=require('./helpers/disposable-root');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.EV2_ACCEPTANCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'cinebraid-ev2-5-captures-'));
fs.mkdirSync(OUT,{recursive:true});
const playwright=require('./helpers/playwright-module').requirePlaywright('ev2-5-settings-real-browser');
const w=disposableRoot('ev2-5-browser',{withSample:true,config:{activeProject:'cinebraid-sample'}});
const fixture=path.join(w.projectsRoot,'cinebraid-sample','project.json');
const p=JSON.parse(fs.readFileSync(fixture));p.meta.title='Signal House · Synthetic studio';fs.writeFileSync(fixture,JSON.stringify(p));
const config=JSON.parse(fs.readFileSync(w.configPath));config.workspace.fileStrategy='project/type';config.naming={exportTemplate:'retained-compatibility',collisionBehavior:'ask'};config.generation.comfy={enabled:false,baseUrl:'http://127.0.0.1:8188',workflowFolder:''};fs.writeFileSync(w.configPath,JSON.stringify(config));
let server,browser,page,base;const checks=[],errors=[],requests=[],blocked=[];let saveFails=false,grantsFail=false,assistantCalls=0,comfyCalls=0,accountFixture=false,accountRemoved=false,holdSave=false,heldSave=null,disconnectSettleMs=null;
const check=(name,ok)=>{checks.push({name,passed:!!ok});assert(ok,name);};
const screenshot=async(name)=>{await page.mouse.move(2,2);await page.locator('#toast').waitFor({state:'hidden',timeout:6000}).catch(()=>{});await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:false});};
async function go(section){await page.evaluate(section=>location.hash='#/settings/'+section,section);await page.locator(`[data-settings-tab="${section}"]`).waitFor();await page.waitForTimeout(160);}
(async()=>{try{
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});assert.notStrictEqual(port,4477);base=`http://127.0.0.1:${port}`;
 const log=fs.openSync(path.join(OUT,'fixture-server.log'),'w');server=spawn(process.execPath,['-r','./tests/helpers/ev2-5-no-network.js','server.js'],{cwd:ROOT,env:w.serverEnv(port),stdio:['ignore',log,log]});
 for(let i=0;i<120;i++){try{if((await fetch(base+'/api/project')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await playwright.chromium.launch({headless:true,...(process.env.CINEBRAID_BROWSER_EXECUTABLE?{executablePath:process.env.CINEBRAID_BROWSER_EXECUTABLE}:{})});
 console.log('[browser-runtime] ev2-5-settings-real-browser: launched Chromium '+browser.version()+' (Node Playwright)');
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const r=route.request(),url=r.url();if(!url.startsWith(base+'/')){if(url.includes('fonts.google'))return route.fulfill({body:''});blocked.push('non-fixture browser request');return route.abort();}const uri=new URL(url).pathname;
 if(r.method()!=='GET')requests.push({uri,method:r.method()});
 if(uri==='/api/accounts'&&accountFixture)return route.fulfill({json:{localMachine:true,providers:[{providerId:'civitai',label:'Civitai',supportsApiKey:true}],accounts:accountRemoved?[]:[{connectionId:'fixture-civitai',providerId:'civitai',providerLabel:'Civitai',identity:{displayName:'Synthetic filmmaker'},status:'expired'}]}});
 if(uri==='/api/accounts/fixture-civitai/verify')return route.fulfill({status:401,json:{error:'Saved authorization has expired. Reconnect this account.'}});
 if(uri==='/api/accounts/fixture-civitai'&&r.method()==='DELETE'){accountRemoved=true;return route.fulfill({json:{ok:true}});}
 if(uri==='/api/config'&&r.method()==='PUT'&&holdSave){heldSave=route;return;}
 if(uri==='/api/assistant/test'){assistantCalls++;return route.fulfill({json:{ok:true}});}
 if(uri==='/api/generation/comfy/test'){comfyCalls++;return route.fulfill({status:503,json:{error:'Fixture runtime offline'}});}
 if(uri==='/api/generation/civitai/grants'&&grantsFail)return route.fulfill({status:503,json:{error:'Fixture permissions unavailable'}});
 if(uri==='/api/config'&&r.method()==='PUT'&&saveFails)return route.fulfill({status:503,json:{error:'Synthetic save failure. Retry when the fixture server is available.'}});
 if(uri.includes('/generate')||uri.includes('/oauth/')||uri.endsWith('/api-key')||uri.endsWith('/verify')){blocked.push('unexpected provider operation');return route.abort();}
 return route.continue();});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/#/settings/overview');await page.locator('.studio-overview').waitFor();
 check('New landing is studio overview',await page.locator('.studio-overview h2').innerText()==='Your studio, your choices.');
 for(const [width,height] of [[1280,720],[1440,900],[1920,1080],[390,844]]){
  await page.setViewportSize({width,height});await go('overview');await screenshot('overview-'+width);
  check('Overview fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // EV2-7: the index returns focus only after a keyboard activation (Enter on a link, or the compact select).
  if(width===390){await page.getByRole('combobox',{name:'Settings section',exact:true}).selectOption('connections');}else{await page.locator('.studio-nav-links a[href="#/settings/connections"]').focus();await page.keyboard.press('Enter');}
  await page.locator('[data-settings-tab="connections"]').waitFor();check('Connections reachable '+width,await page.locator('.studio-connection').count()===7);
  await page.waitForTimeout(80);check('Index navigation returns focus to the index '+width,await page.evaluate(w=>document.activeElement===document.querySelector(w===390?'.studio-compact-nav select':'.studio-nav-links a[aria-current=page]'),width));await screenshot('connections-'+width);
  if(width===1280){
   // Index entries below the fold: returning focus to them must not scroll the newly opened panel away from its head.
   for(const [from,to] of [['connections','assistant-custom'],['assistant-custom','recovery']]){
    await go(from);const link=page.locator(`.studio-nav-links a[href="#/settings/${to}"]`);await link.focus();await page.keyboard.press('Enter');await page.locator(`[data-settings-tab="${to}"]`).waitFor();await page.waitForTimeout(160);
    const view=await page.evaluate(to=>{const heading=document.querySelector('.settings-selected-tab h2,.settings-selected-tab h3'),box=heading?.getBoundingClientRect(),title=document.querySelector('.settings-view-head .view-title')?.getBoundingClientRect();return{main:document.getElementById('main')?.scrollTop||0,window:scrollY,headingInView:!!box&&box.top>=0&&box.bottom<=innerHeight,titleInView:!!title&&title.top>=0,focused:document.activeElement===document.querySelector(`.studio-nav-links a[aria-current=page][href="#/settings/${to}"]`)};},to);
    check(`Keyboard index to ${to} keeps the panel at the top 1280`,view.main===0&&view.window===0);check(`Keyboard index to ${to} shows the panel heading 1280`,view.headingInView&&view.titleInView);check(`Keyboard index to ${to} returns focus to its entry 1280`,view.focused);
   }
   await go('connections');await page.locator('.studio-nav-links a[href="#/settings/files"]').click();await page.locator('[data-settings-tab="files"]').waitFor();await page.waitForTimeout(160);
   check('Pointer index navigation leaves focus with the pointer 1280',await page.evaluate(()=>!document.activeElement?.closest?.('.studio-nav')));
  }
  for(const section of ['generation','integrations','fal','assistant','assistant-custom','files','access','recovery','project','project-recovery','setup']){
   await go(section);check(section+' fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   // EV2-7: one index for every destination; it names the open section and never nests inside the panel.
   const index=await page.evaluate(()=>({studioNavs:document.querySelectorAll('nav.studio-nav').length,inside:!!document.querySelector('.settings-selected-tab .studio-nav,.settings-selected-tab .studio-compact-nav'),current:document.querySelector('.studio-nav-links a[aria-current=page]')?.getAttribute('href')||'',select:document.querySelector('.studio-compact-nav select')?.value||'',headings:[...document.querySelectorAll('.studio-nav-heading')].map(el=>el.textContent.trim())}));
   check(section+' single index '+width,index.studioNavs===1&&!index.inside&&!(await page.locator('nav[aria-label="Project settings"]').count()));
   check(section+' index names open section '+width,width===390?index.select===section:index.current==='#/settings/'+section);
   if(section==='project'||section==='project-recovery')check(section+' index keeps all groups '+width,JSON.stringify(index.headings)===JSON.stringify(['Studio','Connections','Storage','Project','Recovery & export']));check(section+' fields named '+width,await page.locator('.settings-selected-tab').evaluate(panel=>[...panel.querySelectorAll('input,select,textarea')].every(el=>el.type==='hidden'||el.getAttribute('aria-label')||el.labels?.length)));
   if(width===390||width===1440)await screenshot(section+'-'+width);
  }
  await go('integrations');await page.locator('#cfg-comfy-base-url').fill('http://127.0.0.1:9999');const before=comfyCalls;
  await page.getByRole('button',{name:'Check saved local runtime',exact:true}).click();check('Unsaved check sends nothing '+width,comfyCalls===before);check('Unsaved check focuses edited endpoint '+width,await page.locator('#cfg-comfy-base-url').evaluate(el=>el===document.activeElement));
  await page.locator('#cfg-comfy-base-url').fill('http://127.0.0.1:8188');await page.getByRole('button',{name:'Check saved local runtime',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForTimeout(80);check('Offline runtime has no fallback '+width,comfyCalls===before+1&&!(requests.some(x=>x.uri.includes('/generate'))));await screenshot('offline-'+width);
 }
 await page.setViewportSize({width:1440,height:900});await go('generation');await page.locator('#cfg-fal-text-model').fill('synthetic/long-model-name-kept-as-an-unsaved-operation-default');await page.locator('#cfg-fal-text-model').focus();
 await go('connections');await page.locator('.studio-nav-links a[href="#/settings/generation"]').click();await page.locator('[data-settings-tab="generation"]').waitFor();await page.waitForTimeout(160);check('Draft survives section navigation',await page.locator('#cfg-fal-text-model').inputValue()==='synthetic/long-model-name-kept-as-an-unsaved-operation-default');check('Draft focus restored',await page.locator('#cfg-fal-text-model').evaluate(el=>el===document.activeElement));
 saveFails=true;await page.getByRole('button',{name:'Save generation settings',exact:true}).click();await page.locator('#settings-panel-state[data-state="error"]').waitFor();await page.locator('#settings-panel-state').scrollIntoViewIfNeeded();check('Failed save retains draft',(await page.locator('#cfg-fal-text-model').inputValue()).startsWith('synthetic/'));await screenshot('save-failure-1440');
 saveFails=false;await page.getByRole('button',{name:'Save generation settings',exact:true}).click();await page.locator('#settings-panel-state[data-state="saved"]').waitFor();check('Retry writes existing config owner',JSON.parse(fs.readFileSync(w.configPath)).generation.fal.textModel.startsWith('synthetic/'));
 const saved=JSON.parse(fs.readFileSync(w.configPath));check('Inert stored values preserved',saved.workspace.fileStrategy==='project/type'&&saved.naming.exportTemplate==='retained-compatibility'&&saved.naming.collisionBehavior==='ask');
 await go('fal');check('Fal secret input is password',await page.locator('#cfg-fal-key').getAttribute('type')==='password');await page.locator('#cfg-fal-key').fill('disposable-fixture-only');await page.getByRole('button',{name:'Save Fal credential',exact:true}).click();await page.locator('#settings-panel-state[data-state="saved"]').waitFor();
 check('Saved key masked in DOM',!(await page.locator('#cfg-fal-key').inputValue()).includes('disposable-fixture'));check('Masked config API',(await (await fetch(base+'/api/config')).text()).indexOf('disposable-fixture-only')===-1);await screenshot('fal-saved-1440');
 // Environment-source UI fixture: keep the actual server source unchanged and intercept only its safe masked projection.
 await page.route('**/api/config',async r=>{if(r.request().method()!=='GET')return r.continue();const response=await r.fetch();const data=await response.json();data.generation.fal.keySource='environment';return r.fulfill({response,json:data});});
 await go('connections');await go('fal');check('Environment credential input disabled',await page.locator('#cfg-fal-key').isDisabled());check('Environment credential save disabled',await page.getByRole('button',{name:'Save Fal credential',exact:true}).isDisabled());await screenshot('fal-environment-1440');await page.unroute('**/api/config');
 grantsFail=true;await go('generation');await page.waitForTimeout(100);check('Permission failure explained',/retry|could not|unavailable/i.test(await page.locator('#civitai-grants-note').innerText()));await page.locator('#civitai-grants-note').scrollIntoViewIfNeeded();await screenshot('permissions-unavailable-1440');grantsFail=false;await page.locator('#civitai-grants-note button').click();await page.waitForTimeout(120);
 await go('assistant-ollama');await page.locator('#cfg-omodel').fill('synthetic-assistant');await page.getByRole('button',{name:'Save connection & models',exact:true}).click();await page.locator('#settings-panel-state[data-state="saved"]').waitFor();await go('assistant');await page.locator('.capability-configure').first().locator('summary').click();await page.locator('button[onclick="setAssistantProvider(\'ollama\')"]').first().click();await page.waitForTimeout(250);
 const test=page.getByRole('button',{name:/Send a test message to/});await test.focus();await test.press('Enter');await page.locator('[role="dialog"]').waitFor();check('Test requires deliberate confirmation',assistantCalls===0);await screenshot('assistant-confirmation-1440');await page.keyboard.press('Escape');await page.waitForTimeout(60);check('Cancel restores test focus',await test.evaluate(el=>el===document.activeElement));check('Cancel sends no assistant request',assistantCalls===0);
 await test.click();await page.getByRole('button',{name:'SEND TEST PROMPT',exact:true}).click();await page.waitForTimeout(120);check('Only confirmation sends one mocked test',assistantCalls===1);
 await go('naming');await page.locator('#cfg-filename-template').fill('{project}_{shot}_{slot}_{version}.{ext}');await page.getByRole('button',{name:'Save naming rules',exact:true}).click();await page.locator('#settings-panel-state[data-state="saved"]').waitFor();check('Naming retains workspace writer',requests.some(r=>r.uri==='/api/workspace/settings'&&r.method==='POST'));

 // A delayed configuration save must settle its originating panel only.
 await go('assistant-openai');await page.locator('#cfg-openai-key').fill('disposable-pending-fixture');holdSave=true;await page.getByRole('button',{name:'Save connection & models',exact:true}).click();await page.waitForTimeout(80);check('Save deliberately held',!!heldSave);
 await go('files');await page.locator('#cfg-output-root').fill('unsaved-output-draft');await page.locator('#cfg-output-root').focus();holdSave=false;await heldSave.continue();heldSave=null;await page.waitForTimeout(250);
 check('Detached save leaves active draft dirty',await page.locator('#settings-panel-state').getAttribute('data-state')==='dirty');check('Detached save preserves unrelated input',await page.locator('#cfg-output-root').inputValue()==='unsaved-output-draft');
 await go('assistant-openai');check('Detached successful key is masked on return',!(await page.locator('#cfg-openai-key').inputValue()).includes('disposable-pending'));check('Origin panel settled after navigation',await page.locator('#settings-panel-state').getAttribute('data-state')!=='dirty');
 await page.locator('#cfg-openai-model').fill('submitted-model');holdSave=true;await page.getByRole('button',{name:'Save connection & models',exact:true}).click();await page.waitForTimeout(80);await go('connections');await go('assistant-openai');await page.locator('#cfg-openai-model').fill('newer-unsaved-model');holdSave=false;await heldSave.continue();heldSave=null;await page.waitForTimeout(250);
 check('Return before completion preserves newer edit',await page.locator('#cfg-openai-model').inputValue()==='newer-unsaved-model'&&await page.locator('#settings-panel-state').getAttribute('data-state')==='dirty');
 await go('appearance');const originalAccent=await page.locator('#cfg-theme-accent').inputValue();await page.locator('#cfg-theme-accent').selectOption(originalAccent==='rust'?'blue':'rust');await page.getByRole('button',{name:'Discard preview',exact:true}).click();await page.waitForTimeout(180);check('Discard appearance does not restore discarded draft',await page.locator('#cfg-theme-accent').inputValue()===originalAccent&&await page.locator('#settings-panel-state').getAttribute('data-state')==='clean');
 accountFixture=true;await go('accounts');await page.getByRole('button',{name:'Recheck Civitai identity',exact:true}).click();await page.waitForTimeout(100);check('Expired authorization retains recovery message',/expired|Reconnect/i.test(await page.locator('#account-note').innerText()));await screenshot('civitai-expired-1440');
 const historyBefore=fs.readFileSync(fixture,'utf8');await page.getByRole('button',{name:'Disconnect',exact:true}).click();const writesBefore=requests.length;await page.getByRole('button',{name:'DISCONNECT',exact:true}).click();
 // The removal settles through an async re-render (DELETE, then a fresh config + accounts read); wait for that outcome, bounded, rather than a fixed delay that a loaded runner can outlast.
 const disconnectStarted=Date.now();const removed=await page.waitForFunction(()=>!document.querySelector('[data-account-status="expired"]')&&!!document.querySelector('[data-settings-tab="accounts"] [data-account-status="disconnected"]')&&document.body.dataset.renderReady==='1',null,{timeout:8000}).then(()=>true,()=>false);disconnectSettleMs=Date.now()-disconnectStarted;await page.waitForTimeout(120);
 check('Disconnect preserves local project history',historyBefore===fs.readFileSync(fixture,'utf8'));check('Disconnected fixture account removed from list',removed);
 check('Disconnect stays on the accounts section',await page.evaluate(()=>location.hash)==='#/settings/accounts'&&await page.locator('[data-settings-tab="accounts"]').count()===1);
 check('Disconnect writes only the account removal',JSON.stringify(requests.slice(writesBefore))===JSON.stringify([{uri:'/api/accounts/fixture-civitai',method:'DELETE'}]));
 await go('project');await page.locator('#cfg-project-emphasis').focus();await page.locator('#cfg-project-emphasis').selectOption('assisted');await page.waitForTimeout(300);check('Project emphasis keeps keyboard focus',await page.locator('#cfg-project-emphasis').evaluate(el=>el===document.activeElement));check('Project metadata uses existing autosave',await page.evaluate(()=>P.meta.workflowEmphasis)==='assisted');
 check('No browser errors',errors.length===0);check('No unexpected provider requests',blocked.length===0);check('No generation submitted',!requests.some(r=>/\/generate|\/submit/.test(r.uri)));
 fs.writeFileSync(path.join(OUT,'browser-validation.json'),JSON.stringify({passed:true,checks,disconnectSettleMs,browser:browser.version(),isolation:{disposable:true,port,serverOutbound:'blocked',providers:'mocked checks only',realCredentials:false,realProjects:false},requests,errors,blocked},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,captures:OUT}));
 }catch(error){if(page)await screenshot('failure-diagnostic').catch(()=>{});fs.writeFileSync(path.join(OUT,'browser-validation.json'),JSON.stringify({passed:false,checks,error:error.message,errors,blocked,requests},null,2));console.error(error);process.exitCode=1;
 }finally{if(browser)await browser.close();if(server){server.kill();await new Promise(r=>server.once('exit',r));}w.cleanup();}})();
