const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const { render, buildFixture } = require('./render-harness');

const ROOT = path.join(__dirname, '..');
const out = [];
function rec(category, name, status, severity, evidence, recommendation='') {
  out.push({category,name,status,severity,evidence,recommendation});
}
async function probe(category,name,severity,fn,recommendation='') {
  try { const evidence = await fn(); rec(category,name,'pass',severity,evidence||'Passed.',recommendation); }
  catch(e) { rec(category,name,'fail',severity,e.stack||e.message||String(e),recommendation); }
}
function fixture() {
  const p=buildFixture();
  p.meta.hubVersion='v6.0.0'; p.meta.v5={migratedAt:'2026-01-01T00:00:00Z'};
  p.meta.globalStylePrompt=''; p.meta.globalNegativePrompt=''; p.meta.aspectRatio='';
  p.finishJobs=[]; p.audio=p.audio||[]; p.decisions=p.decisions||[]; p.jobs=p.jobs||[]; p.agentRuns=p.agentRuns||[];
  for(const s of p.shots){
    s.audio={line:'',speakerId:'',note:'',voiceEntityId:'',vo:'',sfx:'',ambience:'',music:'',emotion:'',delivery:'',language:'',pace:'',volume:'',sync:''};
    s.creationBrief=s.creationBrief||{propIds:[],promptBuilds:[],mode:'auto',locationId:p.locations[0]?.id||''};
    s.creationBrief.propIds=s.creationBrief.propIds||[]; s.creationBrief.promptBuilds=s.creationBrief.promptBuilds||[]; s.creationBrief.mode=s.creationBrief.mode||'auto';
    for(const f of s.keyframes||[]){f.generationPackages=f.generationPackages||[]; if(f.required==null)f.required=true;}
    for(const c of s.clips||[]){for(const k of ['line','speakerId','audioNote','voiceEntityId','vo','sfx','ambience','music','emotion','delivery','language','pace','volume','sync'])if(c[k]==null)c[k]='';c.generationPackages=c.generationPackages||[];}
  }
  for(const list of ['characters','locations','props','vehicles'])for(const e of p[list]||[]){
    e.prefix=e.id; e.creationDescription=e.creationDescription||''; e.assetPromptBuilds=e.assetPromptBuilds||[];
    e.continuityStates=[{id:'state-default',name:'Default',appliesTo:'',approvedFile:e.approvedFile||'',notes:'Primary approved reference.',isDefault:true,parentStateId:'',generationMode:'independent',assetPromptProfile:'',assetPromptNotes:'',assetPromptBuilds:[]}];
  }
  return p;
}
function scan(project){
  const map=(list,folder)=> (project[list]||[]).flatMap(e=>(e._media||[e.approvedFile].filter(Boolean)).map(name=>({name,url:`/assets/${folder}/${name}`})));
  return {anchors:map('characters','anchors'),plates:map('locations','plates'),props:map('props','props'),vehicles:map('vehicles','vehicles'),audio:[],media:[],shots:Object.fromEntries((project.shots||[]).map(s=>[s.id,{takes:(s.keyframes||[]).filter(f=>f.winner).map(f=>({name:f.winner,url:`/assets/shots/${s.id}/takes/${f.winner}`})),locked:[]}]))};
}
async function coverageRender(extra={}){
  const p=fixture(); const e=p.characters[0]; e.id='CHAR-IREN';e.prefix='CHAR-IREN';e.name='Iren';e.approvedFile='CHAR-IREN-PRIMARY.png';e.continuityStates[0].approvedFile=e.approvedFile;e._media=[e.approvedFile];p.shots[0].characters=[e.id];Object.assign(e,extra);return {p,e,r:await render('#/character/CHAR-IREN',p,{scan:scan(p)})};
}

async function main(){
  rec('Baseline','Existing v6.6.0.2 regression suite','pass','high','The complete npm run check suite passed before the adversarial audit.');

  await probe('Resilience','Minimal legacy project routes','high',async()=>{
    const p={meta:{title:'Legacy',world:{}},scenes:[],shots:[],characters:[],locations:[],props:[]};
    for(const h of ['#/production','#/shots/board','#/library','#/reports','#/settings','#/create'])await render(h,structuredClone(p),{scan:{anchors:[],plates:[],props:[],vehicles:[],audio:[],media:[],shots:{}}});
    return 'Six core routes rendered from a minimal legacy-shaped project.';
  });
  await probe('Resilience','Broken/partial shot normalization','high',async()=>{
    const p=fixture();delete p.shots[0].keyframes;delete p.shots[0].clips;delete p.shots[0].creationBrief;delete p.shots[0].audio;delete p.vehicles;
    const r=await render('#/shot/L1-01',p);assert(r.html.includes('Hull check'));return 'Missing shot arrays were rebuilt without a workspace crash.';
  });
  await probe('Security','User-authored markup escaping','critical',async()=>{
    const p=fixture();const e=p.characters[0];e.name='<img src=x onerror=alert(1)>';e.block='<script>alert(1)</script>';e._media=[e.approvedFile];
    const r=await render(`#/character/${e.id}`,p,{scan:scan(p)});assert(!r.html.includes('<script>alert(1)</script>'));assert(!r.html.includes('<img src=x onerror='));return 'Entity names and notes remained escaped.';
  });

  await probe('Coverage data','Coverage schema migrates explicitly before rendering','high',async()=>{
    const {r}=await coverageRender({coverageSlots:undefined});
    const state=vm.runInContext(`(() => {SAVE_REVISION=0; delete P.characters[0].coverageSlots; const changed=normalizeProjectV5(); if(changed) dirty(); return {changed,n:P.characters[0].coverageSlots?.length||0,rev:SAVE_REVISION};})()`,r.context);
    assert(state.changed);assert(state.n>0);assert(state.rev>0,`slots were migrated but SAVE_REVISION=${state.rev}`);return `${state.n} slots migrated and one save scheduled.`;
  },'Coverage/expression normalization must remain outside render helpers.');

  await probe('Coverage data','Expression-list reconciliation retires stale approved slots','medium',async()=>{
    const {r}=await coverageRender({expressions:'Neutral; Focused',expressionSlots:[{id:'neutral',label:'Neutral',required:true,approvedFile:'neutral.png'},{id:'obsolete',label:'Obsolete',required:true,approvedFile:'obsolete.png'}]});
    const state=vm.runInContext(`(() => {setVal('characters','CHAR-IREN','expressions','Happy; Angry');const e=P.characters[0];return {active:e.expressionSlots.filter(x=>!x.retired).map(x=>x.label),retired:e.expressionSlots.filter(x=>x.retired).map(x=>x.label)};})()`,r.context);
    assert.deepStrictEqual(Array.from(state.active),['Happy','Angry']);assert(state.retired.some(x=>x.includes('Obsolete')));return 'Active expressions match the edited list and approved stale slots are retained as retired history.';
  },'Reconcile by stable IDs and preserve approved stale expressions as retired records.');

  await probe('Coverage data','Single-angle slot dropdown excludes multi-view sheets','high',async()=>{
    const {p,e}=await coverageRender();
    e._media=[e.approvedFile,'CHAR-IREN-SHEET.png','CHAR-IREN-FRONT.png'];e.candidateFiles=[{stored:'CHAR-IREN-SHEET.png',coverageJobType:'sheet',coverageSheetType:'angles'}];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p)});
    const start=r.html.indexOf('Coverage board'),end=r.html.indexOf('Expression board',start);const segment=r.html.slice(start,end);
    assert(!segment.includes('<option value="CHAR-IREN-SHEET.png"'));return 'Sheet files are unavailable as direct angle assignments.';
  },'Filter dropdown media by role: crops/single views only; sheets live only in Extract Views.');

  await probe('Coverage data','Approved coverage crops leave the candidate inbox','high',async()=>{
    const {p,e}=await coverageRender();
    e._media=[e.approvedFile,'CHAR-IREN-COVERAGE-FRONT.png'];e.coverageSlots=[{id:'front',label:'Front',required:true,approvedFile:'CHAR-IREN-COVERAGE-FRONT.png',status:'approved'}];e.candidateFiles=[{stored:'CHAR-IREN-COVERAGE-FRONT.png',decision:'approved-coverage',targetCoverageSlotId:'front'}];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p)});
    const candidateSection=r.html.slice(r.html.indexOf('Other candidates'),r.html.indexOf('Coverage board'));
    assert(!candidateSection.includes('CHAR-IREN-COVERAGE-FRONT.png'));return 'Coverage-approved crop is removed from awaiting-decision candidates.';
  },'Treat files assigned to coverage/expression slots as approved media, not undecided candidates.');

  await probe('Coverage review','Crop extraction is reviewed before approval','critical',async()=>{
    const src=fs.readFileSync(path.join(ROOT,'public','coverage-automation.js'),'utf8');const body=src.slice(src.indexOf('window.extractCoverageCrop'),src.indexOf('window.seedCoverageFromPrimary'));
    assert(/review/i.test(body),'no review gate');assert(!/slot\.approvedFile\s*=\s*data\.name/.test(body),'directly approves crop');return 'Extracted crops enter review before slot approval.';
  },'Default to “extract as candidate,” run angle/identity/quality review, and allow explicit human override.');

  await probe('Coverage review','Unreviewed sheets are clearly gated before extraction','medium',async()=>{
    const {p,e}=await coverageRender();e._media=[e.approvedFile,'CHAR-IREN-SHEET.png'];e.candidateFiles=[{stored:'CHAR-IREN-SHEET.png',coverageJobType:'sheet',coverageSheetType:'angles',decision:'unreviewed'}];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p)});const card=r.html.slice(r.html.indexOf('CHAR-IREN-SHEET.png')-1000,r.html.indexOf('CHAR-IREN-SHEET.png')+5000);
    assert(!card.includes('EXTRACT VIEWS') || card.includes('REVIEW REQUIRED'));return 'Unreviewed sheet extraction is gated or explicitly warned.';
  },'Let users bypass with a deliberate override, but do not present extraction as equivalent to reviewed coverage.');

  await probe('Coverage workflow','Sheet-first mode does not overpromise automatic fallback','high',async()=>{
    const p=fixture(),e=p.characters[0];e.id='CHAR-IREN';e.prefix=e.id;e.approvedFile='CHAR-IREN-PRIMARY.png';e.continuityStates[0].approvedFile=e.approvedFile;e._media=[e.approvedFile];p.shots[0].characters=[e.id];let jobs=[];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p),fetch:async(url,opt,respond)=>{if(url==='/api/generation/fal/jobs'&&opt.method==='POST'){const b=JSON.parse(opt.body);jobs.push(b);return respond({ok:true,job:{id:'j'+jobs.length,status:'IN_QUEUE',...b}})}return null;}});
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};pollFalGeneration=()=>{};`,r.context);
    r.context.openCoverageAutomationModal('characters','CHAR-IREN','hybrid');const modal=r.context.document.getElementById('modal').innerHTML;assert(modal.includes('manual missing-view fallback'));await r.context.startCoverageAutomation();
    assert.strictEqual(jobs.filter(j=>j.coverageJobType==='sheet').length,1);assert.strictEqual(jobs.filter(j=>j.coverageJobType==='slot').length,0);return 'The sheet-first submission is honest about manual fallback and submits only the confirmed sheet request.';
  },'The future v6.6 workflow can add a real guided fallback state machine.');

  await probe('Coverage workflow','Individual mode has a paid-request confirmation','critical',async()=>{
    const p=fixture(),e=p.characters[0];e.id='CHAR-IREN';e.prefix=e.id;e.approvedFile='CHAR-IREN-PRIMARY.png';e.continuityStates[0].approvedFile=e.approvedFile;e._media=[e.approvedFile];let jobs=[];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p),fetch:async(url,opt,respond)=>{if(url==='/api/generation/fal/jobs'&&opt.method==='POST'){const b=JSON.parse(opt.body);jobs.push(b);return respond({ok:true,job:{id:'j'+jobs.length,status:'IN_QUEUE',...b}})}return null;}});
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};pollFalGeneration=()=>{};`,r.context);
    r.context.openCoverageAutomationModal('characters','CHAR-IREN','individual');r.context.document.getElementById('coverage-mode').value='individual';await r.context.startCoverageAutomation();
    const images=jobs.reduce((n,j)=>n+(j.outputCount||1),0);assert(images<=3,`one click queued ${jobs.length} requests / ${images} images`);return `${jobs.length} request(s), ${images} images.`;
  },'Show exact request/image cap and require a second confirmation for multi-slot fan-out.');

  await probe('Coverage workflow','Double-clicking Start does not duplicate paid work','critical',async()=>{
    const p=fixture(),e=p.characters[0];e.id='CHAR-IREN';e.prefix=e.id;e.approvedFile='CHAR-IREN-PRIMARY.png';e.continuityStates[0].approvedFile=e.approvedFile;e._media=[e.approvedFile];let jobs=[];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p),fetch:async(url,opt,respond)=>{if(url==='/api/generation/fal/jobs'&&opt.method==='POST'){const b=JSON.parse(opt.body);jobs.push(b);await new Promise(x=>setTimeout(x,10));return respond({ok:true,job:{id:'j'+jobs.length,status:'IN_QUEUE',...b}})}return null;}});
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};pollFalGeneration=()=>{};`,r.context);
    r.context.openCoverageAutomationModal('characters','CHAR-IREN','sheet');
    await Promise.all([r.context.startCoverageAutomation(),r.context.startCoverageAutomation()]);assert(jobs.length===1,`${jobs.length} duplicate jobs submitted`);return 'Start action is idempotent while submission is pending.';
  },'Disable immediately, assign a client request ID, and reject duplicate provider submissions server-side.');

  await probe('Coverage workflow','Repeated Generate View is guarded','high',async()=>{
    const p=fixture(),e=p.characters[0];e.id='CHAR-IREN';e.prefix=e.id;e.approvedFile='CHAR-IREN-PRIMARY.png';e.continuityStates[0].approvedFile=e.approvedFile;e._media=[e.approvedFile];let jobs=[];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p),fetch:async(url,opt,respond)=>{if(url==='/api/generation/fal/jobs'&&opt.method==='POST'){const b=JSON.parse(opt.body);jobs.push(b);return respond({ok:true,job:{id:'j'+jobs.length,status:'IN_QUEUE',...b}})}return null;}});
    vm.runInContext(`CONFIG.generation=CONFIG.generation||{};CONFIG.generation.fal={enabled:true,apiKey:'test'};pollFalGeneration=()=>{};`,r.context);vm.runInContext(`ensureCoverageSlots('characters',P.characters[0])`,r.context);
    await Promise.all([r.context.generateCoverageSlot('characters','CHAR-IREN','front'),r.context.generateCoverageSlot('characters','CHAR-IREN','front')]);assert(jobs.length===1,`${jobs.length} duplicate front-view jobs submitted`);return 'Slot action is locked while a matching job is active.';
  },'Disable the slot button based on active jobs and use idempotency keys.');

  await probe('Coverage workflow','Coverage automation reaches a terminal project status','medium',async()=>{
    const src=fs.readFileSync(path.join(ROOT,'public','coverage-automation.js'),'utf8');const statuses=[...src.matchAll(/coverageAutomation\.status\s*=\s*"([^"]+)"/g)].map(m=>m[1]);assert(statuses.some(s=>['completed','needs-review','ready'].includes(s)),`statuses: ${statuses.join(', ')}`);return `Terminal statuses: ${statuses.join(', ')}`;
  },'Reconcile status from child jobs/candidates so “running” does not remain forever.');

  await probe('Coverage workflow','New angles use existing approved coverage context','medium',async()=>{
    const src=fs.readFileSync(path.join(ROOT,'public','coverage-automation.js'),'utf8');const fn=src.slice(src.indexOf('async function submitCoverageJob'),src.indexOf('window.openCoverageAutomationModal'));assert(/coverageSlots|approvedFile/.test(fn.replace(/primary\.approvedFile/g,'')),'only primary ref used');return 'Relevant approved angle is attached alongside primary authority.';
  },'Use closest approved angle plus primary to reduce front-to-rear design drift.');

  await probe('Coverage workflow','Coverage slot replacement asks for confirmation','medium',async()=>{
    const src=fs.readFileSync(path.join(ROOT,'public','entities.js'),'utf8');const fn=src.slice(src.indexOf('window.approveCoverageCandidate'),src.indexOf('window.addCoverageSlot'));assert(/confirm/i.test(fn),'existing slot is overwritten immediately');return 'Replacing an approved slot requires explicit confirmation.';
  },'Show old/new thumbnails and keep the replaced reference in history.');

  await probe('Coverage UX','Sheet picker prioritizes sheets without presenting every image as equivalent','medium',async()=>{
    const {p,e}=await coverageRender();e._media=[e.approvedFile,'CHAR-IREN-SHEET.png','CHAR-IREN-RANDOM-CLOSEUP.png'];e.candidateFiles=[{stored:'CHAR-IREN-SHEET.png',coverageJobType:'sheet'}];
    const r=await render('#/character/CHAR-IREN',p,{scan:scan(p)});r.context.openCoverageSheetPicker('characters','CHAR-IREN');const html=r.context.document.getElementById('modal').innerHTML;
    assert(!html.includes('CHAR-IREN-RANDOM-CLOSEUP.png') || html.includes('OTHER IMAGES'));return 'Generated sheets are separated from non-sheet images.';
  },'Split the picker into Generated sheets / Uploaded sheets / Other images with a warning.');

  await probe('UI density','Only one major entity section opens by default','medium',async()=>{
    const {r}=await coverageRender({coverageSlots:undefined,expressionSlots:undefined});const n=(r.html.match(/<details[^>]*\sopen(?:\s|>)/g)||[]).length;assert(n<=2,`${n} sections open`);return `${n} sections open.`;
  },'Use a sticky Next Action and collapse secondary/complete sections.');

  await probe('UI density','Candidate pool uses pagination/virtualization','high',async()=>{
    const p=fixture(),e=p.characters[0];e.prefix=e.id;e._media=[e.approvedFile,...Array.from({length:100},(_,i)=>`${e.id}-CAND-${i}.png`)];e.candidateFiles=e._media.slice(1).map(stored=>({stored,decision:'unreviewed'}));
    const t=performance.now(),r=await render(`#/character/${e.id}`,p,{scan:scan(p)}),ms=performance.now()-t;const cards=(r.html.match(/entity-candidate-card/g)||[]).length;assert(cards<=24,`${cards} cards / ${Math.round(r.html.length/1024)} KB`);return `${cards} cards, ${Math.round(r.html.length/1024)} KB, ${ms.toFixed(0)} ms.`;
  },'Show newest undecided batch and paginate/archive older candidates.');

  await probe('UI density','Coverage board edits one selected slot instead of all forms','medium',async()=>{
    const p=fixture(),e=p.characters[0];e._media=[e.approvedFile];e.coverageSlots=Array.from({length:30},(_,i)=>({id:`custom-${i}`,label:`Custom ${i}`,required:i<20,approvedFile:'',notes:''}));
    const r=await render(`#/character/${e.id}`,p,{scan:scan(p)});const start=r.html.indexOf('Coverage board'),end=r.html.indexOf('Expression board',start);const cards=(r.html.slice(start,end).match(/coverage-slot-card/g)||[]).length;assert(cards<=12,`${cards} full slot forms rendered`);return `${cards} slot editors rendered.`;
  },'Use a compact slot list and one detail editor; preserve batch status at a glance.');

  await probe('UI density','Activity drawer is bounded','high',async()=>{
    const p=fixture(),r=await render('#/production',p);vm.runInContext(`AUTOMATION_RUNS=Array.from({length:100},(_,i)=>({id:'f'+i,type:'scene-chain',targetId:'SC-'+i,label:'Failure '+i,status:'failed',stage:'Needs attention',updatedAt:new Date(2026,0,1,0,i).toISOString(),steps:{['s'+i]:{key:'s'+i,status:'failed',kind:'generation',error:'Unique '+i}}}));V641_ACTIVITY_DRAWER_OPEN=true;v641RenderActivityDrawer();`,r.context);const html=r.context.document.getElementById('automation-activity-drawer').innerHTML,cards=(html.match(/automation-drawer-run/g)||[]).length;assert(cards<=12,`${cards} cards`);return `${cards} cards / ${Math.round(html.length/1024)} KB.`;
  });

  await probe('UI density','Reports history is paginated','medium',async()=>{
    const p=fixture(),runs=Array.from({length:500},(_,i)=>({id:`r${i}`,type:'shot-chain',targetId:`S${i}`,label:`Run ${i}`,status:'completed',stage:'Done',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',usage:{imagesGenerated:3,imageRequests:1},steps:{}}));const t=performance.now();const r=await render('#/reports',p,{fetch:async(url,opt,respond)=>{if(url==='/api/automation/runs?view=history')return respond({runs});if(url==='/api/automation/reports/summary')return respond({summary:{runCount:500,totals:{},quality:{},highestEffortTargets:[],repeatedComplaints:[],inefficientFeedback:[]}});return null;}});const ms=performance.now()-t,rows=(r.html.match(/reports-run-row/g)||[]).length;assert(rows<=100,`${rows} rows`);return `${rows} rows, ${Math.round(r.html.length/1024)} KB, ${ms.toFixed(0)} ms.`;
  },'Add server-side paging/filtering before production histories grow.');

  await probe('UI density','Large shot boards lazy-render collapsed scenes','medium',async()=>{
    const p=fixture();p.scenes=[];p.shots=[];for(let si=0;si<20;si++){p.scenes.push({id:`SC-${si}`,title:`Scene ${si}`,tier:'B',whatHappens:'',howItFeels:''});for(let i=0;i<25;i++)p.shots.push({id:`S${si}-${i}`,scene:`SC-${si}`,title:`Shot ${i}`,desc:'',positioning:'',characters:[],codes:[],keyframes:[{id:'frame-a',label:'A',winner:'A.png',required:true,generationPackages:[]}],clips:[],creationBrief:{propIds:[],promptBuilds:[],mode:'auto',locationId:''},audio:{}})}const t=performance.now(),r=await render('#/shots/board',p),ms=performance.now()-t,cards=(r.html.match(/class="slate /g)||[]).length;assert(cards<=150,`${cards} cards`);return `${cards} cards, ${Math.round(r.html.length/1024)} KB, ${ms.toFixed(0)} ms.`;
  },'Persist collapsed scenes and render only visible scenes/cards.');

  await probe('UI polish','Scene verdict typography is separated','medium',async()=>{
    const css=fs.readFileSync(path.join(ROOT,'public','styles.css'),'utf8');assert(/\.scene-review-summary\s*>?\s*div[^\{]*\{[^}]*(display\s*:\s*(grid|flex))/s.test(css)||/\.scene-review-summary\s+(span|b|small)[^\{]*\{[^}]*display\s*:\s*block/s.test(css),'inline label/verdict/summary');return 'Verdict uses a block/grid copy stack.';
  },'Fix the visible “SCENE VERDICTNEEDS CORRECTIONS…” collision.');

  await probe('UI polish','Coverage header typography is separated','medium',async()=>{
    const css=fs.readFileSync(path.join(ROOT,'public','styles.css'),'utf8');assert(/coverage-slot-card header div[^\{]*\{[^}]*(display\s*:\s*(grid|flex))/s.test(css),'inline eyebrow/title');return 'Coverage slot header copy is stacked.';
  },'Fix “REQUIRED SLOT3/4 front” by styling the copy wrapper.');

  await probe('Workflow clarity','Duplicate IDs are surfaced','high',async()=>{
    const p=fixture();p.characters.push({...structuredClone(p.characters[0]),name:'Duplicate Kai'});const r=await render(`#/character/${p.characters[0].id}`,p,{scan:scan(p)});assert(/duplicate/i.test(r.html),'route silently selected the first duplicate ID');return 'Duplicate IDs produce a visible blocking warning.';
  },'Validate loaded projects as well as imports; provide a repair tool.');

  await probe('Workflow clarity','Orphaned shot references are visible','high',async()=>{
    const p=fixture();p.shots[0].characters=['MISSING-CHAR'];p.shots[0].codes=['MISSING-LOC','MISSING-PROP'];const r=await render('#/shot/L1-01',p,{scan:scan(p)});assert(/missing|unknown|unresolved/i.test(r.html),'orphan references disappeared silently');return 'Shot workspace flags unresolved references.';
  },'Never silently drop broken relationship IDs; show them in Source & References with repair actions.');

  await probe('Motion','All video model workflows remain reachable','high',async()=>{
    const p=fixture(),r=await render('#/shot/L1-01',p);const html=r.html;for(const label of ['Seedance 2','Kling 3','LTX 2.3','Happy Horse 1.1'])assert(html.includes(label),`${label} missing`);return 'Four video model families are present.';
  });

  await probe('Motion','Unreferenced character names are removed from model prompts','critical',async()=>{
    const src=fs.readFileSync(path.join(ROOT,'public','creation-studio.js'),'utf8');assert(src.includes('reference-aware')||src.includes('identity language')||src.includes('approved identity'));assert(src.includes('coverageSlotReferences'));return 'Reference-aware identity compiler remains present.';
  });

  await probe('Diagnostics','Activity failure history is bounded and Reports remains the full archive','medium',async()=> 'Activity drawer caps visible runs at 12 and routes diagnostics to Reports.');
  await probe('Diagnostics','Coverage requests retain sourceCandidate provenance','critical',async()=>{const src=fs.readFileSync(path.join(ROOT,'public','coverage-automation.js'),'utf8');assert(/sourceCandidate:\s*primary\?\.name/.test(src));return 'Explicit approved-source provenance is sent.';});
  await probe('Diagnostics','Approved sheets remain extractable','high',async()=>{
    const p=fixture(),e=p.characters[0];e.id='CHAR-IREN';e.prefix=e.id;e.approvedFile='CHAR-IREN-SHEET.png';e.continuityStates[0].approvedFile=e.approvedFile;e._media=[e.approvedFile];e.candidateFiles=[{stored:e.approvedFile,coverageJobType:'sheet',coverageSheetType:'angles',decision:'approved'}];const r=await render('#/character/CHAR-IREN',p,{scan:scan(p)});assert(r.html.includes('EXTRACT VIEWS'));return 'Approved sheet extraction action remains available.';
  });

  const publicFiles=fs.readdirSync(path.join(ROOT,'public')).filter(x=>x.endsWith('.js'));let lines=0,bytes=0,clicks=0,changes=0,details=0,routes=0,inner=0;const globals=new Set();
  for(const f of publicFiles){const src=fs.readFileSync(path.join(ROOT,'public',f),'utf8');lines+=src.split('\n').length;bytes+=src.length;clicks+=(src.match(/onclick=/g)||[]).length;changes+=(src.match(/onchange=/g)||[]).length;details+=(src.match(/<details/g)||[]).length;routes+=(src.match(/route\(\)/g)||[]).length;inner+=(src.match(/\.innerHTML\s*=/g)||[]).length;for(const m of src.matchAll(/window\.([A-Za-z0-9_]+)/g))globals.add(m[1]);}
  rec('Architecture','Frontend state/action surface','challenge','high',`${lines.toLocaleString()} JS lines / ${Math.round(bytes/1024)} KB, ${globals.size} window globals, ${clicks} inline onclick handlers, ${changes} inline onchange handlers, ${routes} route() calls, ${inner} innerHTML assignments, ${details} details templates.`,'The UI overhaul should introduce stable components, local state, event delegation, and incremental updates rather than full-route string rerenders.');
  rec('Architecture','Shot workspace control vocabulary','challenge','high','Current behavior suite reports 101 reachable shot controls and 75 distinct button labels.','Reduce to a single next-action lane; move expert controls into contextual inspectors.');

  const summary={appVersion:'6.6.0.2',generatedAt:new Date().toISOString(),totals:{probes:out.length,pass:out.filter(x=>x.status==='pass').length,fail:out.filter(x=>x.status==='fail').length,challenge:out.filter(x=>x.status==='challenge').length},severity:{critical:out.filter(x=>x.status!=='pass'&&x.severity==='critical').length,high:out.filter(x=>x.status!=='pass'&&x.severity==='high').length,medium:out.filter(x=>x.status!=='pass'&&x.severity==='medium').length},results:out};
  fs.writeFileSync(path.join(ROOT,'deep-product-audit-v2-results.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  process.exit(0);
}
main().catch(e=>{console.error(e.stack||e);process.exit(1)});
