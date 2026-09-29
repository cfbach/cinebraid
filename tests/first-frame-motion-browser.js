'use strict';
/* Real UI journey in a disposable project. All server outbound traffic is denied.
   --evidence-project copies a supplied project read-only; never put its assets in the repo. */
const fs=require('fs'),path=require('path'),net=require('net'),assert=require('assert'),{spawn}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.FIRST_SHOT_OUT||path.join(require('os').tmpdir(),'cinebraid-first-frame-captures');fs.mkdirSync(OUT,{recursive:true});
const {disposableRoot}=require('./helpers/disposable-root');
const {rawFixture,withCanon}=require('./render-harness');
const pw=require('./helpers/playwright-module').requirePlaywright('first-frame-motion-browser');
const startWidth=Number(process.env.FIRST_SHOT_START_WIDTH)||1440;
const mode=process.env.FIRST_SHOT_MODE||'new', source=process.argv.includes('--evidence-project')?process.argv[process.argv.indexOf('--evidence-project')+1]:'';
const w=disposableRoot('first-frame-motion',{config:{activeProject:'first-shot',generation:{fal:{enabled:true,apiKey:'synthetic-never-sent'}}}});
let p,dir;
if(source){dir=path.join(w.projectsRoot,'first-shot');fs.cpSync(source,dir,{recursive:true});p=JSON.parse(fs.readFileSync(path.join(dir,'project.json')));}
else{
p=rawFixture();p.meta.title='First frame journey · synthetic';p.meta.workflowEmphasis='manual';p.meta.aspectRatio='16:9';p.meta.promptDefaults.videoProfile='minimax-h3/i2v';p.shots=p.shots.slice(0,1);
const s=p.shots[0];s.deliveryRoute='r2v';s.keyframes=s.keyframes.slice(0,1);s.keyframes[0].winner='';s.clips=s.clips.slice(0,1);s.clips[0].kind='r2v';s.clips[0].fromFrame='';s.clips[0].motionProfileId='minimax-h3/multi-frame';s.candidateFiles=[];s.creationBrief={deliveryIntent:'motion',disabledInputKeys:['characters:KAI:state-default','locations:LOC-HULL:state-default','props:PR-TOOL:state-default']};
for(const list of ['characters','locations','props'])for(const e of p[list])e.continuityStates=[{id:'state-default',name:'Default',isDefault:true,approvedFile:e.approvedFile,notes:'Primary approved reference.'}];
p=withCanon(p,[{kind:'entity-state',list:'characters',entityId:'KAI',stateId:'state-default',value:'KAI-ANCHOR.png'},{kind:'entity-state',list:'locations',entityId:'LOC-HULL',stateId:'state-default',value:'LOC-HULL-PLATE.png'},{kind:'entity-state',list:'props',entityId:'PR-TOOL',stateId:'state-default',value:'PR-TOOL-PLATE.png'}]);
dir=w.writeProject('first-shot',p);for(const [folder,name] of [['anchors','KAI-ANCHOR.png'],['plates','LOC-HULL-PLATE.png'],['props','PR-TOOL-PLATE.png']]){fs.mkdirSync(path.join(dir,folder),{recursive:true});fs.copyFileSync(path.join(ROOT,'projects/cinebraid-sample/anchors/CHAR-COURIER-FRONT.png'),path.join(dir,folder,name));}}
const shotId=p.shots[0].id,frameId=p.shots[0].keyframes[0].id, exclusions=JSON.stringify(p.shots[0].creationBrief.disabledInputKeys);
let server,browser,page,journeyOutcome="not-complete";
const errors=[],requests=[],checks=[],providerAttempts=[];
function check(name,value){assert(value,name);checks.push(name);}
async function capture(name,selector){if(selector){for(let attempt=0;;attempt++){try{await page.locator(selector).first().scrollIntoViewIfNeeded();break;}catch(error){if(attempt===2||!error.message.includes('not attached'))throw error;await page.waitForTimeout(200);}}}
await page.locator('#toast').waitFor({state:'hidden',timeout:4000}).catch(()=>{});
await page.waitForTimeout(140);
await page.screenshot({path:path.join(OUT,mode+'-'+name+'.png')});
fs.writeFileSync(path.join(OUT,mode+'-'+name+'.txt'),await page.locator('body').innerText());}
async function views(name,selector){for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});
await capture(name+'-'+width,selector);}}
async function stage(id){await page.setViewportSize({width:1440,height:900});
await page.locator('[data-stage-id="'+id+'"]').click();
await page.waitForTimeout(200);}
(async()=>{try{
const port=await new Promise(r=>{const n=net.createServer();n.listen(0,'127.0.0.1',()=>{const v=n.address().port;n.close(()=>r(v));});});
const base='http://127.0.0.1:'+port;
const log=fs.openSync(path.join(OUT,mode+'-server.log'),'w');server=spawn(process.execPath,['-r','./tests/helpers/ev2-5-no-network.js','server.js'],{cwd:ROOT,env:w.serverEnv(port),stdio:['ignore',log,log]});
for(let i=0;i<100;i++){try{if((await fetch(base+'/api/project')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
browser=await pw.chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:startWidth,height:startWidth===390?844:900},reducedMotion:'reduce'});
await context.route('**/*',async route=>{const req=route.request();if(!req.url().startsWith(base+'/'))return route.abort();
const uri=new URL(req.url()).pathname;if(req.method()!=='GET'){let body;try{body=req.postDataJSON();}catch{}requests.push({uri,body});}
if(uri==='/api/generation/fal/jobs'&&req.method()==='POST')return route.fulfill({status:503,json:{error:'Mock dispatch received. No provider was called.'}});
if(/\/api\/(assistant|ai)\//.test(uri)){providerAttempts.push(uri);return route.abort();}return route.continue();});
page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/');
await page.waitForTimeout(600);
if(startWidth===390){await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();check('Fresh 390 px session opens the visible navigation menu',await page.getByRole('button',{name:/^▦\s*Shots$/}).isVisible());}
await page.getByRole('button',{name:/^▦\s*Shots$/}).click();
await page.locator('a[href="#/shot/'+shotId+'"]').first().waitFor();await page.waitForTimeout(400);
await views('shot-list','a[href="#/shot/'+shotId+'"]');
await page.locator('a[href="#/shot/'+shotId+'"]').first().click();
await page.locator('.shot-intent-control').waitFor();
check('Reached Shot Desk through visible Shots navigation',page.url().endsWith('#/shot/'+shotId));
await views('desk','.shot-intent-control');
await views('video-next-action','.guided-next-action');
await views('roadmap',mode==='old'?'.guided-next-action':'.shot-journey');
if(mode!=='old'){
check('Saved R2V is shown without reinterpreting it as frame-to-video',(await page.locator('.shot-journey').innerText()).includes('Selected: Reference to Video'));
check('Shot references and shot frame are visibly distinct',(await page.locator('[data-journey-step="references"]').innerText()).includes('0 included')&&(await page.locator('[data-journey-step="frame"]').innerText()).includes('A missing'));
check('Roadmap current step agrees with the canonical motion next action',await page.locator('.shot-journey').getAttribute('data-journey-current')==='motion');
check('All five production milestones appear',await page.locator('.shot-journey li').count()===5);
check('Reference thumbnails expose each saved exclusion',await page.locator('.shot-journey-reference.is-excluded').count()===3);
check('Video heading uses filmmaker language',await page.locator('.guided-next-action h2').innerText()==='Create the shot video');
check('Missing media replaces preparation with an actionable input choice',await page.locator('.guided-next-action .shot-primary-action').innerText()==='Choose video inputs');
check('Empty R2V inputs are explicit before preparation',(await page.locator('.guided-next-action').innerText()).includes('Next video build: 0 images · 0 videos.')&&(await page.locator('.guided-next-action').innerText()).includes('excluded and will not be sent'));
check('Next action does not claim the empty R2V request is ready',(await page.locator('.guided-next-action').innerText()).includes('video inputs needed'));
const jobsBeforePreparation=requests.filter(r=>r.uri==='/api/generation/fal/jobs').length;
await page.locator('.guided-next-action .shot-primary-action').click();
await page.locator('.guided-input-tray').waitFor({state:'visible'});
check('Blocked primary action opens the actual input exclusions and Include controls',await page.locator('.guided-input-tray').isVisible()&&await page.locator('.guided-input-tray button.guided-input-toggle').count()===3&&await page.locator('.h3-generation-modal').count()===0);
check('Opening exclusions changes neither saved route nor exclusions',await page.evaluate(id=>{const shot=P.shots.find(s=>s.id===id);return shot.deliveryRoute==='r2v'&&JSON.stringify(shot.creationBrief.disabledInputKeys);},shotId)===exclusions);
check('Preparation does not dispatch',requests.filter(r=>r.uri==='/api/generation/fal/jobs').length===jobsBeforePreparation);
check('390 px roadmap has no horizontal overflow',await page.locator('.shot-journey').evaluate(el=>el.scrollWidth<=el.clientWidth));
}
if(process.argv.includes('--entry-only')){journeyOutcome='entry-only';return;}
if(process.argv.includes('--reference-inputs')){
  await views('r2v-blocked','.guided-next-action');
  await views('r2v-exclusions','.guided-input-tray');
  const choice=await page.evaluate(id=>{
    const shot=P.shots.find(s=>s.id===id),refs=shotCreationReferences(shot).filter(r=>r.url);
    return refs.find(r=>r.entityId===shot.characters[0])||refs[0];
  },shotId);
  check('The test explicitly chooses an originally excluded reference',JSON.parse(exclusions).includes(choice.key));
  await page.locator('.guided-input-tray').getByRole('button',{name:'Include '+choice.label+' in shot generation',exact:true}).click();
  await page.waitForTimeout(350);
  const expectedExclusions=JSON.parse(exclusions).filter(key=>key!==choice.key);
  check('Only the explicit Include changes the saved exclusions',await page.evaluate(id=>JSON.stringify(P.shots.find(s=>s.id===id).creationBrief.disabledInputKeys),shotId)===JSON.stringify(expectedExclusions));
  check('The saved Reference to Video route and model are preserved',await page.evaluate(id=>{const shot=P.shots.find(s=>s.id===id);return shot.deliveryRoute==='r2v'&&shot.clips[0].motionProfileId==='minimax-h3/multi-frame';},shotId));
  check('One included reference restores preparation',await page.locator('.guided-next-action .shot-primary-action').innerText()==='Prepare video request →');
  check('Resolved summary names only the included visual input',(await page.locator('.guided-next-action').innerText()).includes('Next video build: 1 image · 0 videos.')&&(await page.locator('.guided-next-action').innerText()).includes('Using: '+choice.label));
  await views('r2v-resolved','.guided-next-action');
  await views('r2v-resolved-roadmap','.shot-journey');
  await page.locator('.guided-next-action .shot-primary-action').click();
  await page.locator('.guided-motion-card').waitFor({state:'visible'});
  check('Resolved preparation opens Motion without dispatch',await page.locator('.guided-motion-card').isVisible()&&!requests.some(r=>r.uri==='/api/generation/fal/jobs'));
  await page.locator('.shot-generation-next').getByRole('button',{name:'Prepare reference video',exact:true}).click();
  await page.locator('.guided-motion-controls button').filter({hasText:/^Build prompt$/}).click();
  await page.locator('.h3-generate-btn').waitFor();
  await page.waitForFunction(({id,key})=>{const shot=P.shots.find(s=>s.id===id),build=latestPromptBuild(P,shot.creationBrief.motionPromptBuilds);return build?.references?.length===1&&build.references[0].key===key;},{id:shotId,key:choice.key});
  const packet=await page.evaluate(id=>{const shot=P.shots.find(s=>s.id===id),build=latestPromptBuild(P,shot.creationBrief.motionPromptBuilds);return {build,reasons:packageStaleReasons(shot,build)};},shotId);
  fs.writeFileSync(path.join(OUT,mode+'-r2v-packet.json'),JSON.stringify(packet,null,2));
  check('The real R2V compiler produces a fresh package',packet.reasons.length===0);
  check('The built request binds only the explicitly included reference',packet.build.references.length===1&&packet.build.references[0].key===choice.key&&packet.build.references[0].url===choice.url);
  const drift=await page.evaluate(({id,key})=>{
    const shot=P.shots.find(s=>s.id===id),build=latestPromptBuild(P,shot.creationBrief.motionPromptBuilds);
    const disabled=[...shot.creationBrief.disabledInputKeys],characters=[...shot.characters];
    shot.creationBrief.disabledInputKeys.push(key);
    const excluded=packageStaleReasons(shot,build);
    shot.creationBrief.disabledInputKeys=disabled;
    shot.characters=characters.filter(entityId=>entityId!==build.references[0].entityId);
    const removed=packageStaleReasons(shot,build);
    shot.characters=characters;
    return {excluded,removed,restored:packageStaleReasons(shot,build)};
  },{id:shotId,key:choice.key});
  check('Excluding the consumed reference still makes its build stale',drift.excluded.some(reason=>reason.includes('no longer be supplied')));
  check('Removing the consumed character still makes its build stale',drift.removed.some(reason=>reason.includes('no longer be supplied')));
  check('Restoring the explicit selection restores freshness',drift.restored.length===0);
  await views('r2v-prepared','.h3-generate-btn');
  check('Review is available once inputs are valid',!await page.locator('.h3-generate-btn').isDisabled());
  check('The built prompt offers request review, not dispatch',(await page.locator('.h3-generate-btn').textContent()).trim()==='Review video request');
  await page.locator('.h3-generate-btn').click();
  await page.locator('#fal-h3-submit:not([disabled])').waitFor();
  await views('r2v-review','.h3-generation-head');
  await views('r2v-cost','#fal-h3-generation-view');
  check('Review sends no generation job',!requests.some(r=>r.uri==='/api/generation/fal/jobs'));
  check('The review binds only the chosen reference',await page.evaluate(key=>window._falH3MotionRequest.references.length===1&&window._falH3MotionRequest.references[0].refId===key,choice.key));
  check('Only the final dispatch control says Generate video',(await page.locator('#fal-h3-submit').textContent()).trim()==='Generate video');
  await page.locator('#fal-h3-submit').click();await page.waitForTimeout(400);
  const jobs=requests.filter(r=>r.uri==='/api/generation/fal/jobs');
  check('Only final Generate video dispatches the intended mocked R2V request',jobs.length===1&&jobs[0].body.profileMode==='r2v'&&jobs[0].body.profileId==='minimax-h3/multi-frame'&&jobs[0].body.sourceBuildId===packet.build.id);
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'project.json'))),body=jobs[0].body;
  const {compileH3ExecutionPlan}=require('../src/generation/h3-execution');
  const {serializeH3PlanForFal}=require('../src/generation/fal/fal-h3-backend');
  const compiled=compileH3ExecutionPlan({project:saved,shotId,buildId:body.sourceBuildId,mode:body.profileMode,durationSeconds:body.durationSeconds,resolution:body.resolution,aspectRatio:body.aspectRatio,submittedPrompt:body.prompt});
  const serialized=serializeH3PlanForFal(compiled.plan,compiled.capability,{resolveReference:row=>'https://mock.invalid/'+encodeURIComponent(row.refId),config:{},...(compiled.promptEdited?{promptOverride:compiled.submittedPrompt}:{})});
  check('The final provider payload contains exactly the chosen image and no excluded images',serialized.input.reference_image_urls.length===1&&serialized.bindings.length===1&&serialized.bindings[0].refId===choice.key&&!serialized.input.reference_video_urls&&!serialized.input.reference_audio_urls&&!expectedExclusions.some(key=>serialized.bindings.some(row=>row.refId===key)));
  const zero=structuredClone(compiled.plan);zero.inputs.references=[];
  let zeroCode='';try{serializeH3PlanForFal(zero,compiled.capability,{resolveReference:()=>{throw Error('Zero-input check must not resolve media');},config:{}});}catch(error){zeroCode=error.code;}
  check('The shipped serializer refuses zero-media Reference to Video',zeroCode==='H3_REFERENCE_MISSING');
  fs.writeFileSync(path.join(OUT,mode+'-r2v-dispatch-proof.json'),JSON.stringify({explicitlyIncluded:{key:choice.key,label:choice.label},remainingExclusions:expectedExclusions,zeroInputRefusal:zeroCode,sourceBuildId:body.sourceBuildId,finalRequest:{profileId:body.profileId,profileMode:body.profileMode},serialized,normalizedPacketFixture:false},null,2));
  check('No shot frame is invented for reference-video generation',await page.evaluate(id=>P.shots.find(s=>s.id===id).keyframes.every(f=>!f.winner),shotId));
  check('No assistant/provider calls',providerAttempts.length===0);check('No browser runtime errors',errors.length===0);
  journeyOutcome='mocked-reference-video-dispatch';return;
}

await stage('motion');
await views('motion','.guided-motion-card');
await stage('inputs');
await views('inputs','.guided-input-tray');
await stage('frames');
await views('frames','.shot-frames-workspace');
await stage('motion');if(mode==='old'){await stage('frames');if(await page.locator('.guided-frame-workflow').getAttribute('open')===null)await page.locator('.guided-frame-workflow > summary').click();if(await page.locator('.guided-frame-card').first().getAttribute('open')===null)await page.locator('.guided-frame-card > summary').first().click();}else {await page.setViewportSize({width:390,height:844});const next=page.locator('.shot-journey').getByRole('button',{name:'Make or import Frame A',exact:true});await next.scrollIntoViewIfNeeded();
const box=await next.boundingBox();
check('390 px next action fits the viewport and has a 44 px target',box&&box.x>=0&&box.x+box.width<=390&&box.height>=44);
await next.focus();
await next.press('Enter');}await page.locator('.shot-frames-workspace').waitFor();
check(mode==='old'?'Manually unfolded the old Frames workspace':'Frame handoff opens Frames',await page.locator('.shot-frames-workspace').count()===1);
check('Handoff keeps exclusions',await page.evaluate(id=>JSON.stringify(P.shots.find(s=>s.id===id).creationBrief.disabledInputKeys),shotId)===exclusions);
await views('frame-handoff',mode==='old'?'.guided-primary-brief':'.shot-generation-frame-entry');
if(mode==='old')await page.locator('.frame-generation > summary').click();else {await page.getByRole('button',{name:'Prepare Frame A generation',exact:true}).click();await page.locator('.guided-frame-compile select').waitFor();check('Still preparation reveals the real image target',await page.locator('.guided-frame-compile select').isVisible());check('Still preparation does not dispatch',!requests.some(r=>r.uri==='/api/generation/fal/jobs'));}
await views('frame-next',mode==='old'?'.frame-generation':'.shot-generation-frame-guide');
if(mode==='old')await page.locator('.frame-prompt-tools > summary').click();
// Build is a local deterministic compiler. Do not invoke Improve or any assistant.
await page.locator('.guided-frame-compile button').filter({hasText:/^Build prompt$/}).click();
await page.locator('.frame-execution').waitFor();
check('Frame prompt compiled without dispatch',!requests.some(r=>r.uri==='/api/generation/fal/jobs'));
await views('frame-prepared','.frame-execution');
// Import a synthetic sample still through the actual frame-owned upload route.
await page.setViewportSize({width:1440,height:900});
await page.locator('.frame-execution .fal-generate-btn').click();
await page.locator('#fal-frame-submit').waitFor();
await views('image-review','.h3-generation-head');
await views('image-cost','#fal-frame-generation-view');
check('Image review sends no job',!requests.some(r=>r.uri==='/api/generation/fal/jobs'));
check('Image review declares paid cost uncertainty',(await page.locator('.h3-generation-modal').innerText()).includes('Provider price unavailable'));
await page.locator('#fal-frame-submit:not([disabled])').waitFor();
await page.locator('#fal-frame-submit').click();
await page.waitForTimeout(500);
check('Only final image action dispatches one intercepted job',requests.filter(r=>r.uri==='/api/generation/fal/jobs').length===1);if(await page.getByRole('button',{name:'Cancel',exact:true}).count())await page.getByRole('button',{name:'Cancel',exact:true}).click();
const chooserPromise=page.waitForEvent('filechooser');
if(mode==='old')await page.locator('[data-frame-dropzone="'+frameId+'"]').click();else await page.getByRole('button',{name:'Import Frame A',exact:true}).click();
const chooser=await chooserPromise;check('Import action targets the exact Frame A input',await chooser.element().getAttribute('id')==='frame-file-'+frameId);
await chooser.setFiles(path.join(ROOT,'projects/cinebraid-sample/shots/SAMPLE-03/takes/SAMPLE-03-OPEN.png'));
await page.waitForTimeout(600);
await views('roadmap-candidate',mode==='old'?'.guided-next-action':'.shot-journey');
if(mode!=='old')check('An imported candidate moves current work to review without approval',await page.locator('.shot-journey').getAttribute('data-journey-current')==='review'&&(await page.locator('[data-journey-step="frame"]').innerText()).includes('A to review'));
await page.getByRole('button',{name:'Review Frame A result',exact:true}).click();
await page.locator('[data-results-desk]').waitFor();
await views('frame-review','.rx-selected');
check('Import is a candidate, not an approval',await page.locator('#rx-decision').getAttribute('data-rx-state')==='open');
await page.locator('.rx-card').first().click();
await page.locator('button[data-rx="approve"]').click();
await page.locator('#rx-confirm:not([disabled])').waitFor();
await views('frame-approval','.rx-confirm');
await page.locator('#rx-confirm').click();
await page.locator('#rx-decision[data-rx-state="approved"]').waitFor();
check('Explicit Results approval selects Frame A',!!(await page.evaluate(({shotId,frameId})=>P.shots.find(s=>s.id===shotId).keyframes.find(f=>f.id===frameId).winner,{shotId,frameId})));
await views('frame-approved','.rx-decision');
await page.locator('[data-media-return]').first().click();
await page.locator('.shot-intent-control').waitFor();
await views('roadmap-approved',mode==='old'?'.guided-next-action':'.shot-journey');
if(mode!=='old'){
check('Next-build counts follow the real approved-frame packager while reference exclusions remain',(await page.locator('.guided-next-action').innerText()).includes('Next video build: 1 image · 0 videos.')&&(await page.locator('.guided-next-action').innerText()).includes('Using: Sequential keyframe 1 · Frame A.')&&(await page.locator('.guided-next-action').innerText()).includes('3 ready reference images are excluded'));
check('Approved opening frame is a thumbnail rather than a reference image',await page.locator('[data-journey-step="frame"] img').count()===1&&(await page.locator('[data-journey-step="frame"]').innerText()).includes('A approved'));
await page.locator('.shot-journey').getByRole('button',{name:'Use Frame A for video',exact:true}).click();
check('Route choice opens the existing selector without changing intent',await page.locator('.shot-intent-control').getAttribute('data-shot-intent')==='r2v');
}else {await stage('motion');await page.locator('.shot-intent-control > summary').click();}
await page.locator('#shot-intent-'+shotId).selectOption('i2v');
await page.locator('.shot-intent-control[data-shot-intent="i2v"]').waitFor();
await page.waitForTimeout(400);
await views('workflow','.shot-intent-control');
await stage('motion');if(mode==='old'){await page.locator('.motion-assisted-tools > summary').click();}else await page.getByRole('button',{name:'Choose a compatible video model',exact:true}).click();
await page.locator('.guided-video-target-control select').selectOption('minimax-h3/i2v');
await page.waitForTimeout(400);
await views('video-model','.guided-video-target-control');
await page.locator('.guided-motion-controls button').filter({hasText:/^Build prompt$/}).click();
await page.locator('.h3-generate-btn').waitFor();
await views('video-prepared','.h3-generate-btn');
check('Motion build does not add a job',requests.filter(r=>r.uri==='/api/generation/fal/jobs').length===1);
const diagnostic=await page.evaluate(id=>{const shot=P.shots.find(s=>s.id===id),build=latestPromptBuild(P,shot.creationBrief.motionPromptBuilds);return {build,available:promptReferenceOptions(shot),reasons:packageStaleReasons(shot,build)};},shotId);
fs.writeFileSync(path.join(OUT,mode+'-motion-freshness.json'),JSON.stringify(diagnostic,null,2));
if(diagnostic.reasons.length){journeyOutcome='blocked-before-video-review';
check('Existing freshness gate refuses unmatched approved-frame identity',diagnostic.reasons.some(r=>r.includes('Approved Frame A')));
check('Refusal disables video dispatch',await page.locator('.h3-generate-btn').isDisabled());
if(mode!=='old')check('The package action truthfully names request review',await page.locator('.h3-generate-btn').innerText()==='Review video request');
console.log('REAL JOURNEY BLOCKED BEFORE VIDEO REVIEW',diagnostic.reasons);}
else {journeyOutcome='mocked-video-dispatch';
await page.locator('.h3-generate-btn').click();
await page.locator('#fal-h3-submit:not([disabled])').waitFor();
await views('video-review','.h3-generation-head');
check('Video review precedes its dispatch',requests.filter(r=>r.uri==='/api/generation/fal/jobs').length===1);
await page.locator('#fal-h3-submit').click();
await page.waitForTimeout(500);
check('Only final video action dispatches its mocked job',requests.filter(r=>r.uri==='/api/generation/fal/jobs').length===2);}
// Separate dialog/dispatch contract, not the normal novice journey. The current
// compiler's shot-start key is absent from its freshness catalogue. Supply a valid
// take-key packet fixture for the same approved asset; keep the real refusal above.
if(process.argv.includes('--review-contract')) {
  const fixture = await page.evaluate(id=>{
    const shot=P.shots.find(s=>s.id===id),build=latestPromptBuild(P,shot.creationBrief.motionPromptBuilds);
    const available=promptReferenceOptions(shot);
    for(const ref of build.references){const current=available.find(r=>r.url===ref.url);if(!current)throw Error('No exact fixture asset');ref.key=current.key;}
    build.dependencySnapshot=packageInputSnapshot(shot,build,build.references,currentDirectionForPackage(shot,build));
    P.promptBuildsById[build.id].references=build.references;
    P.promptBuildsById[build.id].dependencySnapshot=build.dependencySnapshot;
    dirty();route();return {references:build.references,reasons:packageStaleReasons(shot,build)};
  },shotId);
  check('Contract fixture uses an available key for the exact approved asset',fixture.reasons.length===0);
  fs.writeFileSync(path.join(OUT,mode+'-dialog-contract-fixture.json'),JSON.stringify(fixture,null,2));
  await page.locator('.h3-generate-btn:not([disabled])').click();
await page.locator('#fal-h3-submit:not([disabled])').waitFor();
  await views('contract-video-review','.h3-generation-head');
await views('contract-video-cost','#fal-h3-generation-view');
  check('Contract video review precedes its dispatch',requests.filter(r=>r.uri==='/api/generation/fal/jobs').length===1);
if(mode!=='old')check('Only the final paid action is labelled Generate video',await page.locator('#fal-h3-submit').innerText()==='Generate video');
  await page.locator('#fal-h3-submit').click();
await page.waitForTimeout(500);
  const jobs=requests.filter(r=>r.uri==='/api/generation/fal/jobs');
  check('Contract final action dispatches only the intended mocked I2V job',jobs.length===2&&jobs[1].body.purpose==='motion-h3'&&jobs[1].body.profileId==='minimax-h3/i2v');
}
check('Saved exclusions remain unchanged',await page.evaluate(id=>JSON.stringify(P.shots.find(s=>s.id===id).creationBrief.disabledInputKeys),shotId)===exclusions);
check('No assistant/provider calls',providerAttempts.length===0);
check('No browser runtime errors',errors.length===0);

}catch(e){console.error(e.message);if(page)await capture('failure').catch(()=>{});process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,mode+(process.argv.includes('--entry-only')?'-entry-validation.json':'-validation.json')),JSON.stringify({passed:!process.exitCode,journeyOutcome,dialogContract:process.argv.includes("--review-contract"),checks,errors,requests,providerAttempts,sourceCopied:!!source},null,2));
console.log(JSON.stringify({checks,errors,requests:requests.map(r=>r.uri),providerAttempts,OUT}));if(browser)await browser.close();if(server){server.kill();
await new Promise(r=>server.once('exit',r));}w.cleanup();}})();
