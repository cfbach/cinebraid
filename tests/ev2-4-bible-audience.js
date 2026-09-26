'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const {disposableRoot}=require('./helpers/disposable-root');
const F=require('./bible-canon-export');
const Record=require('../src/server/approved-record');
async function run(){
 const w=disposableRoot('ev2-4-audience',{config:{activeProject:'record-test',editorPass:'synthetic-editor',viewerPass:'synthetic-viewer'}});
 const dir=w.writeProject('record-test',{});let P=F.writeRouteFixture(dir);
 const secret='PRIVATE_WORKING_SENTINEL';
 P.meta.world={setting:secret,include:secret,reject:secret};P.meta.globalStylePrompt=secret;
 for(const list of ['characters','audio'])for(const x of P[list]){x.notes=secret;x.creationDescription=secret;x.block=secret;x.driftNotes=secret;x.prompts=[{id:'draft',text:secret}];}
 P.characters.push({id:'UNAPPROVED',name:secret,notes:secret});
 P.shots[0].status='BUILT';P.shots[0].workflowStatus='IN PROGRESS';P.shots[0].notes=secret;
 P.shots[0].keyframes.push({id:'not-approved',label:secret,description:secret});
 // A percent-bearing approved filename must not authorize a decoded sibling.
 P.shots[0].keyframes.push({id:'encoded',label:'C',winner:'A%20.png'});
 P.shots[0].candidateFiles.push({stored:'A%20.png'});
 fs.writeFileSync(path.join(dir,'shots/S-01/takes/A%20.png'),'approved-percent');fs.writeFileSync(path.join(dir,'shots/S-01/takes/A .png'),secret);
 F.approve(P,{kind:'shot-frame',shotId:'S-01',frameId:'encoded'},'A%20.png');
 // Durable enrolled reference in a supported BMP format, plus a locked-path shot identity.
 const Assets=require('../src/media/media-assets'),Store=require('../src/media/media-asset-store'),Reference=require('../src/media/reference-media');
 const ledgerRows=[];
 const asset=(rel,type='image')=>{fs.mkdirSync(path.dirname(path.join(dir,rel)),{recursive:true});fs.writeFileSync(path.join(dir,rel),'synthetic-approved-original');const st=fs.statSync(path.join(dir,rel));const row={assetId:Assets.mintAssetId(),contentHash:null,hashState:'unhashed',scope:{},mediaType:type,role:'import',source:'imported',lifecycle:'candidate',storage:{path:rel,bytes:st.size,mtimeMs:st.mtimeMs},legacy:{},indexedAt:'2026-09-15T00:00:00Z'};ledgerRows.push(row);return row;};
 const enrolled=asset('media/approved.bmp'),locked=asset('shots/S-01/locked/LOCK.png');
 const audioReceipt=P.productionAuthority.receipts.find(r=>r.list==='audio'&&r.status==='current');
 const recording=asset('audio/'+audioReceipt.value,'audio');
 recording.contentHash='sha256:'+require('crypto').createHash('sha256').update(fs.readFileSync(path.join(dir,recording.storage.path))).digest('hex');recording.hashState='hashed';
 audioReceipt.assetId=recording.assetId;
 const audioEntity=P.audio.find(e=>e.id===audioReceipt.entityId);audioEntity.approvedAssetId=recording.assetId;audioEntity.continuityStates.find(s=>s.id===audioReceipt.stateId).approvedAssetId=recording.assetId;

 Store.writeLedgerSync(dir,{schemaVersion:Assets.MEDIA_ASSETS_SCHEMA_VERSION,assets:ledgerRows});
 P.props=[{id:'TOOL',name:'Approved tool',notes:secret,coverageSlots:[{id:'front',label:'Front',requirement:'required'}],continuityStates:[{id:'state-default',name:'Default',isDefault:true}],candidateFiles:[]}];
 const ref=Reference.resolver({projectsRoot:w.projectsRoot,slug:'record-test',project:P});
 const binding='ref-11111111-1111-4111-8111-111111111111';
 P=Reference.enroll({project:P,list:'props',entityId:'TOOL',stateId:'state-default',slotId:'front',assetId:enrolled.assetId,expectedIdentity:ref.asset(enrolled.assetId).identity,projectsRoot:w.projectsRoot,slug:'record-test',bindingId:binding,at:'2026-09-15T00:00:00Z'}).project;
 P.props[0].approvedFile=binding;P.props[0].approvedAssetId=enrolled.assetId;Object.assign(P.props[0].continuityStates[0],{approvedFile:binding,approvedAssetId:enrolled.assetId});
 F.approve(P,{kind:'entity-state',list:'props',entityId:'TOOL',stateId:'state-default'},binding,{assetId:enrolled.assetId});
 P.shots[0].keyframes.push({id:'locked',label:'D',winner:'LOCK.png',approvalIdentity:{winner:locked.assetId}});P.shots[0].candidateFiles.push({stored:'LOCK.png',assetId:locked.assetId});
 F.approve(P,{kind:'shot-frame',shotId:'S-01',frameId:'locked'},'LOCK.png',{assetId:locked.assetId});
 const ledgerFile=path.join(dir,'media-assets.json'),ledgerBefore=fs.readFileSync(ledgerFile,'utf8');
 // Legacy malformed IDs may be accepted by the kernel's scalar reader, but
 // may never carry arbitrary nested working objects into viewer output.
 P.shots[0].keyframes.push({id:{privateNotes:secret},label:'Malformed legacy ID',winner:'R1.png'});
 F.approve(P,{kind:'shot-frame',shotId:'S-01',frameId:'[object Object]'},'R1.png');
 P.shots[0].clips.push({id:[{privateNotes:secret}],label:'Malformed motion ID',videoWinner:'M1.mp4'});
 F.approve(P,{kind:'shot-motion',shotId:'S-01',unitKey:'[object Object]'},'M1.mp4');
 const dataFile=path.join(dir,'project.json');fs.writeFileSync(dataFile,JSON.stringify(P));const before=fs.readFileSync(dataFile,'utf8');
 const port=await F.freePort();const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:w.serverEnv(port),stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
 try{
  let up=false;for(let i=0;i<120&&!up;i++){try{up=(await fetch(base+'/api/me')).ok;}catch{}if(!up)await new Promise(r=>setTimeout(r,100));}assert(up,output);
  const login=async pass=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pass})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  const viewer=await login('synthetic-viewer'),editor=await login('synthetic-editor');
  const get=(u,cookie=viewer,options={})=>fetch(base+u,{...options,headers:{cookie,...options.headers}});
  const response=await get('/api/bible?role=editor&includeDrafts=true&preset=supporting');const doc=await response.json();const payload=JSON.stringify(doc);
  check(!payload.includes(secret),'viewer JSON excludes all working sentinels');check(doc.shots.every(x=>x.targets.every(t=>typeof t.id==='string')),'malformed target IDs cannot serialize nested working data');check(!payload.includes('appendix')&&!payload.includes('package')&&!payload.includes('prompts'),'no nested supporting containers');
  check(doc.entities.every(x=>x.id!=='UNAPPROVED'),'unapproved entity withheld');check(doc.shots[0].targets.some(t=>t.value==='R1.png'),'approved frame in unfinished shot survives');
  check(doc.shots[0].targets.some(t=>t.value==='M1.mp4')&&doc.shots[0].targets.some(t=>t.value==='D1.mp4'),'motion and deliverable survive');
  check(doc.entities.some(x=>x.list==='audio'&&x.targets.some(t=>t.media.available)),'approved audio remains available');
  const md=await (await get('/api/bible/export?preset=approved')).text();check(!md.includes(secret),'viewer download excludes saved intent');check(md===Record.markdown(doc),'JSON and export use the same projection');
  for(const preset of ['supporting','canon-appendix'])for(const suffix of ['','&role=editor&local=true&editor=true'])check((await get('/api/bible/export?preset='+preset+suffix,viewer,{headers:{'x-role':'editor','x-cinebraid-role':'editor'}})).status===403,'viewer cannot select supporting '+preset+suffix);
  check((await get('/api/project')).status===403,'editor project endpoint stays unavailable');
  const working=await get('/api/bible/export?preset=supporting',editor);check(working.status===200,'editor deliberately exports working material');check((await working.text()).includes(secret),'supporting material preserved for editor');check(working.headers.get('content-disposition').includes('working-material.json'),'working export has no Approved or Canon title');
  // EV2-7 Working draft: readable saved creative intent, gated by the server's editor role only; forged flags and headers cannot select it.
  for(const suffix of ['','&role=editor&editor=true&local=true'])check((await get('/api/bible/export?preset=working-draft'+suffix,viewer,{headers:{'x-role':'editor','x-cinebraid-role':'editor'}})).status===403,'viewer cannot select working draft'+suffix);
  const draftResponse=await get('/api/bible/export?preset=working-draft',editor);const draftMd=await draftResponse.text();const draftDisposition=draftResponse.headers.get('content-disposition')||'';
  check(draftResponse.status===200,'editor deliberately exports the working draft');check((draftResponse.headers.get('content-type')||'').startsWith('text/markdown'),'working draft is Markdown');
  check(draftDisposition.includes('working-draft.md')&&!/approved|canon/i.test(draftDisposition),'working draft file has no Approved or Canon title');
  check(draftMd.includes('WORKING DRAFT · SAVED SNAPSHOT · NOT APPROVED'),'working draft is labelled as an unapproved saved snapshot');
  check(draftMd.includes('PRIVATE\\_WORKING\\_SENTINEL'),'working draft carries saved creative text (Markdown-escaped)');
  check((await get('/api/bible/export?preset=working-readable',editor)).status===400,'an unknown working preset is refused');
  check(/^"[0-9a-f]{64}"$/.test(draftResponse.headers.get('x-cinebraid-project-revision')||''),'working draft names the saved revision it read');
  // EV2-7 project binding: every export response names the active project, and a download bound to another project is refused read-only.
  check(draftResponse.headers.get('x-cinebraid-project')==='record-test'&&draftMd.includes('- Snapshot: saved project file · project record-test · revision sha256:'),'working draft names the project it was read from, in its header and its Sources & history');
  const refusedViewer=await get('/api/bible/export?preset=supporting&project=record-test',viewer);check(refusedViewer.status===403&&refusedViewer.headers.get('x-cinebraid-project')==='record-test','a refused export still names the active project');
  for(const preset of ['approved','canon','working-draft','supporting','canon-appendix']){const bound=await get('/api/bible/export?preset='+preset+'&project=record-test',editor);check(bound.status===200&&bound.headers.get('x-cinebraid-project')==='record-test','a download bound to the open project succeeds · '+preset);
   const moved=await get('/api/bible/export?preset='+preset+'&project=another-project',editor);const body=await moved.json();check(moved.status===409&&body.error==='The open project changed. Reload and export again.'&&!JSON.stringify(body).includes(secret)&&moved.headers.get('x-cinebraid-project')==='record-test','a download bound to a different project is refused · '+preset);}
  check((await get('/api/bible/export?preset=approved&project=another-project',viewer)).status===409,'the viewer approved download is refused on a project mismatch too');
  for(const preset of ['working-draft','supporting'])check((await get('/api/bible/export?preset='+preset+'&project=another-project',viewer)).status===403,'the editor gate answers before the project check · '+preset);
  check((await get('/api/bible/export?preset=approved&project=',editor)).status===409,'an empty project parameter is not a wildcard');
  check((await get('/api/bible/export?preset=approved',viewer)).status===200,'the unparameterised viewer Approved link is unchanged');
  check(!JSON.stringify(await (await get('/api/bible',editor)).json()).includes(secret),'editor on viewer route receives same safe audience');
  const targets=[...doc.entities,...doc.shots].flatMap(x=>x.targets);check(targets.length>0&&targets.every(t=>t.receiptId&&!draftMd.includes(t.receiptId)),'working draft carries no approval receipt ids');for(const t of targets.filter(t=>t.media.available)){check((await get(t.media.url)).status===200,'exact approved URL available '+t.value);}
  check(targets.some(t=>t.value===binding&&t.media.available&&t.media.url.includes('media/approved.bmp')),'durable enrolled BMP preview stays available');
  check(targets.some(t=>t.value==='LOCK.png'&&t.assetId===locked.assetId&&t.media.available),'identity-backed locked-path preview remains available');
  check(fs.readFileSync(ledgerFile,'utf8')===ledgerBefore,'viewer reads do not repair or mutate media ledger');
  const percent=targets.find(t=>t.value==='A%20.png');check(percent.media.url.includes('A%2520.png'),'URL encodes literal percent');check(await (await get(percent.media.url)).text()==='approved-percent','exact percent-bearing approved bytes served');
  check((await get('/assets/shots/S-01/takes/A%20.png')).status===404,'decoded unapproved sibling denied');
  check((await get('/assets/shots/S-01/takes/R2.png')).status===404,'guessed draft path denied');check((await get('/assets/shots/S-01/takes/R2.png',viewer,{method:'HEAD'})).status===404,'HEAD cannot bypass media boundary');check((await get('/assets/shots/S-01/takes/R2.png',viewer,{headers:{range:'bytes=0-1'}})).status===404,'Range cannot bypass');
  check((await get('/assets/shots/S-01/takes/R2.png',editor)).status===200,'editors retain supporting media');
  check(fs.readFileSync(dataFile,'utf8')===before,'all reads leave project bytes unchanged');
  fs.writeFileSync(path.join(dir,'shots/S-01/locked/LOCK.png'),'replacement with different physical observation');
  const stale=await (await get('/api/bible')).json();check(stale.shots[0].targets.some(t=>t.value==='LOCK.png'&&!t.media.available),'same-name replacement cannot stand in for receipt identity');check((await get('/assets/shots/S-01/locked/LOCK.png')).status===404,'viewer cannot retrieve stale identity bytes');
  const recordingPath=path.join(dir,recording.storage.path),recordingStat=fs.statSync(recordingPath),replacement=Buffer.from(fs.readFileSync(recordingPath));replacement[0]^=1;
  fs.writeFileSync(recordingPath,replacement);fs.utimesSync(recordingPath,recordingStat.atime,recordingStat.mtime);
  const changedAudio=await (await get('/api/bible')).json();
  check(changedAudio.entities.find(x=>x.list==='audio').targets.every(t=>!t.media.available),'viewer retains audio receipt but withholds same-stat replacement');
  const oldAudioUrl=doc.entities.find(x=>x.list==='audio').targets[0].media.url;
  for(const options of [{},{method:'HEAD'},{headers:{range:'bytes=0-1'}}])check((await get(oldAudioUrl,viewer,options)).status===404,'viewer audio replacement denied for GET, HEAD and Range');
  check((await get(oldAudioUrl,editor)).status===404,'editor approved audio URL also refuses replacement');
  fs.unlinkSync(path.join(dir,'shots/S-01/takes/R1.png'));const missing=await (await get('/api/bible')).json();check(missing.shots[0].targets.some(t=>t.value==='R1.png'&&!t.media.available),'missing approved media retains receipt with unavailable status');
  const revoked=structuredClone(P);revoked.shots[0].keyframes.find(f=>f.id==='encoded').winner='';fs.writeFileSync(dataFile,JSON.stringify(revoked));check((await get(percent.media.url)).status===404,'revoked current target immediately loses viewer access');
  // Open viewer mode still cannot select supporting export.
  const config=JSON.parse(fs.readFileSync(w.configPath));config.viewerPass='';fs.writeFileSync(w.configPath,JSON.stringify(config));check((await get('/api/bible/export?preset=supporting','')).status===403,'open Bible does not become editor');check((await get('/api/bible/export?preset=working-draft','')).status===403,'open Bible cannot select the working draft');
  config.editorPass='';fs.writeFileSync(w.configPath,JSON.stringify(config));check((await get('/api/bible/export?preset=supporting','')).status===200,'existing local trust mode deliberately retains editor export');check((await get('/api/bible/export?preset=working-draft','')).status===200,'local trust mode retains the editor working draft');
  console.log(JSON.stringify({suite:'EV2-4 audience',checks,passed:true}));
 }finally{child.kill();await new Promise(r=>child.once('exit',r));w.cleanup();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
