'use strict';
const assert=require('node:assert/strict');
const D=require('../public/shared-media-discovery');
const PM=require('../public/shared-production-media');
const {fixture,LEDGER}=require('./production-media');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const f=fixture(),built=PM.productionMediaRecords(f),records=D.compose(f.project,built.records);
check('Current uses recency and keeps explicit Approved optional',()=>{const result=D.query(records,D.defaults());assert.notEqual(result.rows[0].decision,'approved');assert(result.rows.every(r=>!r.roles.every(x=>x==='rejected')));assert(D.query(records,{...D.defaults(),decision:'approved'}).rows.every(r=>r.roles.includes('approved')));});
check('All recorded identity relationships survive deduplication',()=>{const row=built.records[0];assert(row.relationships?.length);assert(Object.isFrozen(row.relationships));const clone=structuredClone(f);const media=clone.scan.media[0];media.assetId=clone.scan.anchors[0].assetId;const result=PM.productionMediaRecords(clone);const merged=result.records.find(r=>r.key==='asset:'+media.assetId);assert(merged.relationships.length>=2);assert(merged.relationships.some(r=>r.scope==='entity'));assert(merged.relationships.some(r=>r.scope==='project'));});
const raw=built.records.find(r=>r.scope==='entity');
const make=(role,entity='KAI',scope='entity')=>({...structuredClone(raw),scope,kind:scope==='project'?'project-media':'entity-reference',context:{...raw.context,entityId:{state:'known',value:entity}},disposition:{...raw.disposition,role},actions:role==='approved'?['open-owner']:['open-owner','reject']});
check('Neutral library appearance does not dilute approval or rejection',()=>{for(const decision of ['approved','rejected']){const row={...make(decision),relationships:[make(decision),make('candidate','', 'project')]};const d=D.compose(f.project,[row])[0];assert.equal(d.decision,decision);assert.equal(D.matches(d,D.defaults()),decision!=='rejected');}});
check('Mixed uses retain independent target decisions',()=>{const row={...raw,relationships:[make('approved','A'),make('rejected','B')]};const d=D.compose(f.project,[row])[0];assert.equal(d.decision,'mixed');assert.equal(D.rejectedFor(d,{list:'characters',id:'A'}),false);assert.equal(D.rejectedFor(d,{list:'characters',id:'B'}),true);assert.equal(D.rejectedFor(d,{list:'characters',id:'C'}),false);assert(D.eligibility(d,{list:'characters',id:'B'}).includes('Restore'));});
check('Metadata-only inventory cannot erase observed availability',()=>{const d=D.compose(f.project,[raw],[{assetId:raw.identity.ledger.value,mediaType:'image'}])[0];assert.equal(d.availability,'available');assert(d.url);const missing=D.compose(f.project,[raw],[{assetId:raw.identity.ledger.value,missing:true}])[0];assert.equal(missing.availability,'missing');assert.equal(missing.url,'');});
check('Canonical related-to facets unify library links and references',()=>{const row={...raw,relationships:[raw,{...make('candidate','','project'),context:{links:[{targetType:{state:'known',value:'character'},targetId:{state:'known',value:'KAI'}}]}}]};const d=D.compose(f.project,[row])[0];assert.equal(d.related.filter(x=>x.key==='characters:KAI').length,1);assert(D.matches(d,{...D.defaults(),related:'characters:KAI'}));});
check('Shared scenes counted once without fake duplicates',()=>{const row={...records[0],sceneIds:['SC01','SC02'],related:[{type:'scene',id:'SC01',label:'One'},{type:'scene',id:'SC02',label:'Two'}]};const result=D.query([row],{...D.defaults(),decision:'all',group:'scene'});assert.equal(result.total,1);assert.equal(D.groupLabel(row,'scene'),'Shared across scenes');});
check('Selector hides unavailable and rejected but deliberate reveal stays ineligible',()=>{const row={...records[0],availability:'missing'};assert(!D.matches(row,D.defaults(true),{selector:true}));assert(D.matches(row,{...D.defaults(true),showUnavailable:true},{selector:true}));assert(D.eligibility(row,{}).includes('missing'));});
check('Search AND terms include explicit relations; missing dates sort last',()=>{const a={...records[0],key:'a',title:'Harbor plate',addedAt:'2026-09-01',related:[{label:'SC02 Night',id:'SC02'}]},b={...a,key:'b',addedAt:''};assert.equal(D.query([b,a],{...D.defaults(),decision:'all',query:'harbor SC02'}).rows[0].key,'a');assert.equal(D.query([a],{...D.defaults(),query:'another'}).total,0);});
check('Stable ties and bounded 10k paging',()=>{const rows=Array.from({length:10000},(_,i)=>({...records[0],key:'asset:'+String(i).padStart(5,'0'),title:'Duplicate-looking',addedAt:''}));const before=JSON.stringify(rows[0]);const a=D.query(rows,{...D.defaults(),decision:'all',page:130}),b=D.query([...rows].reverse(),{...D.defaults(),decision:'all',page:130});assert.equal(a.total,10000);assert.equal(a.rows.length,48);assert.deepEqual(a.rows.map(r=>r.key),b.rows.map(r=>r.key));assert.equal(JSON.stringify(rows[0]),before);assert.equal(D.query(rows,{...D.defaults(),page:999}).page,208);});
check('Unknown type never becomes compatible image or automation claim',()=>{const d=D.compose({},[],[{assetId:LEDGER('f'),available:true,url:'/assets/media/unknown'}])[0];assert.equal(d.type,'document');assert(D.eligibility(d,{}).includes('image'));assert.equal(D.decisionLabel({...d,decision:'historic'}),'Historic selection');});
check('Unavailable original retains record and forbids mutations',()=>{const input=structuredClone(f);input.scan.references={characters:{KAI:input.scan.anchors.map(r=>({...r,available:false,reason:'missing',url:''}))}};const out=PM.productionMediaRecords(input);const row=out.records.find(r=>r.scope==='entity'&&r.availability.state==='missing');assert(row);assert.deepEqual([...row.actions],['open-owner']);});
/* EV2-7 Checkpoint 4 — derived production categories. Category is read from recorded kind, owning list, link role/target and the ledger's
   directory-proven role; never from a filename, and never an input to decision. */
const {ISO}=require('./production-media');
const wrap=(type,id,role)=>({targetType:{state:'known',value:type},targetId:{state:'known',value:id},role:{state:'known',value:role}});
const planning=built.records.find(r=>r.kind==='project-media');
const projectRow=(key,links)=>({...structuredClone(planning),key,relationships:[],context:{...structuredClone(planning.context),links:links.map(l=>wrap(...l))}});
check('EV2-7 categories come from recorded kinds, owning lists and link roles',()=>{
  const byFile=name=>records.find(r=>r.fileName===name);
  for(const name of ['KAI_DEFAULT_V001.png','KAI_ALT_V002.png','KAI_BAD_V003.png'])assert.deepEqual(byFile(name).categories,['characters']);
  assert.equal(byFile('TOOL_DEFAULT_V001.png').category,'props');
  for(const name of ['SH010_FRAME_A_V001.png','SH010_MOTION_H3_1.mp4','SH020_FRAME_A_FAL_1.png'])assert.deepEqual(byFile(name).categories,['shot-renders']);
  assert.deepEqual(byFile('SH010_BLOCKING_FAL_1.png').categories,['blocking-previs']);
  assert.deepEqual(byFile('animatic-opening.png').categories,['blocking-previs'],'an animatic-frame library link is blocking & previs');
  const [blocking,sound,planned,styled,vetoed,prop]=D.compose(f.project,[projectRow('path:media/a.png',[['shot','SH010','blocking-frame']]),projectRow('path:media/b.wav',[['scene','SC01','sound-reference']]),projectRow('path:media/c.png',[['scene','SC01','planning-reference']]),projectRow('path:media/d.png',[['shot','SH010','style-reference']]),projectRow('path:media/e.png',[['character','KAI','do-not-use']]),projectRow('path:media/f.png',[['prop','TOOL','planning-reference']])]);
  assert.deepEqual(blocking.categories,['blocking-previs']);assert.deepEqual(sound.categories,['audio']);
  assert.deepEqual(planned.categories,['other'],'a planning reference on a scene is Other');assert.deepEqual(styled.categories,['other'],'a style reference on a shot is Other, not Blocking');
  assert.deepEqual(vetoed.categories,['other'],'do-not-use contributes no category');assert.deepEqual(prop.categories,['props'],'an entity reference-pack link is that entity\'s category');
  assert.equal(D.categoryLabel('blocking-previs'),'Blocking & previs');assert.deepEqual(D.CATEGORIES.map(c=>c[0]),['all','shot-renders','characters','locations','props','vehicles','blocking-previs','audio','other']);
});
check('EV2-7 a filename containing APPROVED supplies neither category, decision nor headline',()=>{
  const input=structuredClone(f);input.scan.anchors.push({name:'KAI_APPROVED_FINAL_V9.png',url:'/assets/anchors/KAI_APPROVED_FINAL_V9.png'});
  input.project.characters[0].candidateFiles.push({stored:'KAI_APPROVED_FINAL_V9.png',addedAt:ISO(9),decision:'unreviewed',targetStateId:'state-default'});
  input.scan.media.push({name:'CHARACTER_APPROVED.png',url:'/assets/media/CHARACTER_APPROVED.png'});
  const out=D.compose(input.project,PM.productionMediaRecords(input).records),row=out.find(r=>r.fileName==='KAI_APPROVED_FINAL_V9.png');
  assert(row,'the APPROVED-named candidate is present');assert.equal(row.decision,'candidate');assert.equal(D.decisionLabel(row),'Candidate');assert.deepEqual(row.roles,['candidate']);
  assert.equal(row.category,'characters');assert.equal(row.title,'Kai · Default');assert(!/approved/i.test(row.title),'the stored filename never becomes the headline');
  assert(D.query(out,{...D.defaults(),decision:'all',query:'APPROVED'}).rows.some(r=>r.key===row.key),'the filename stays searchable');
  assert(!D.query(out,{...D.defaults(),decision:'approved'}).rows.some(r=>r.key===row.key),'and it is not found under Approved');
  const loose=out.find(r=>r.fileName==='CHARACTER_APPROVED.png');assert.deepEqual(loose.categories,['other']);assert.equal(loose.decision,'candidate');assert.equal(loose.title,'Untitled image');
});
check('EV2-7 mixed roles keep independent categories and decisions; neutral uses add no Other',()=>{
  const row={...raw,relationships:[make('approved'),{...make('candidate','','project'),context:{links:[wrap('shot','SH010','blocking-frame')]}},{...make('candidate','','project'),context:{links:[]}}]};
  const d=D.compose(f.project,[row])[0];assert.deepEqual(d.categories,['characters','blocking-previs']);assert.equal(d.category,'characters');assert.equal(d.decision,'approved');
  assert(D.matches(d,{...D.defaults(),category:'blocking-previs'}));assert(D.matches(d,{...D.defaults(),category:'characters'}));assert(!D.matches(d,{...D.defaults(),category:'other'}));
  assert.equal(d.relationships[0].belongsTo[0].label,'Kai');assert.equal(d.relationships[1].belongsTo.length,0);assert.equal(d.relationships[1].usedIn[0].role,'blocking-frame');assert(d.relationships[1].usedIn.some(u=>u.type==='scene'&&u.inherited),'a scene reached through a shot is marked inherited');
  const take=built.records.find(r=>r.kind==='shot-still'&&r.identity.ledger.state==='known');
  const linked=D.compose(f.project,[take],[{assetId:take.identity.ledger.value,mediaType:'image',links:[{targetType:'character',targetId:'KAI',role:'character-reference'}]}])[0];
  assert.deepEqual(linked.categories,['shot-renders'],'an entity link never turns a shot render into a Characters item');assert(linked.related.some(r=>r.key==='characters:KAI'),'the character stays a Related-to facet');
});
check('EV2-7 category counts, filters and paging share one query and write nothing',()=>{
  const cats=['shot-renders','characters','locations','props','vehicles','blocking-previs','audio','other'],decisionsFor=[['approved'],['candidate'],['rejected'],['historic'],['approved','rejected']],typesFor=['image','video','audio','document'];
  const rows=Array.from({length:120},(_,i)=>{const categories=i%5===0?[cats[i%8],cats[(i+3)%8]].sort((a,b)=>cats.indexOf(a)-cats.indexOf(b)):[cats[i%8]],roles=decisionsFor[i%5];return {...records[0],key:'asset:'+String(i).padStart(4,'0'),title:'Row '+i,categories,category:categories[0],roles,decision:roles.length===1?roles[0]:'mixed',needsDecision:i%3===0,type:typesFor[i%4],related:i%2?[{key:'characters:KAI',type:'characters',id:'KAI',label:'Kai'}]:[],addedAt:'2026-09-'+String(i%28+1).padStart(2,'0')};});
  const before=JSON.stringify(rows);
  for(const state of [D.defaults(),{...D.defaults(),decision:'all'},{...D.defaults(),decision:'needs',type:'image'},{...D.defaults(),decision:'approved',related:'characters:KAI'},{...D.defaults(),decision:'rejected',type:'audio',query:'row'}]){
    const counts=D.categoryCounts(rows,{...state,category:'shot-renders'});assert.equal(counts.all,D.query(rows,{...state,category:'all'}).total);
    for(const c of cats){const q=D.query(rows,{...state,category:c,page:99});assert.equal(counts[c],q.total,`${c} chip count equals its query total`);assert.equal(q.page,Math.max(0,q.pages-1),'paging clamps per category');assert(q.rows.every(r=>r.categories.includes(c)));}
  }
  assert.equal(D.query(rows,{...D.defaults(),decision:'all',group:'category'}).all[0].category,'shot-renders','category grouping follows production order, not the alphabet');
  assert.equal(JSON.stringify(rows),before,'counting and querying mutate nothing');
});
check('EV2-7 inventory-only rows categorise from links and the ledger role, never gaining a decision',()=>{
  const inv=(seed,extra)=>({assetId:LEDGER(seed),mediaType:'image',available:true,url:'/assets/x',sourceName:'KAI_APPROVED.png',title:'KAI_APPROVED.png',...extra});
  const [linked,bare,tone,frame,sheet]=D.compose({},[],[inv('1',{links:[{targetType:'shot',targetId:'SH010',role:'storyboard'}]}),inv('2',{}),inv('3',{mediaType:'audio',ledgerRole:'room-tone'}),inv('4',{ledgerRole:'frame-approved',lifecycle:'approved'}),inv('5',{ledgerRole:'coverage-sheet',scope:{entityList:'anchors'}})]);
  assert.deepEqual(linked.categories,['blocking-previs']);assert.deepEqual(bare.categories,['other']);assert.deepEqual(tone.categories,['audio']);assert.deepEqual(frame.categories,['shot-renders']);assert.deepEqual(sheet.categories,['characters']);
  for(const row of [linked,bare,tone,frame,sheet]){assert.equal(row.decision,'candidate');assert.deepEqual(row.roles,['candidate']);assert(!D.matches(row,{...D.defaults(),decision:'approved'}),'a ledger -approved role is never an approval');assert.equal(row.title.includes('APPROVED'),false,'a filename-shaped title is not the headline');}
  assert.equal(tone.title,'Untitled audio');assert.equal(bare.fileName,'KAI_APPROVED.png');
});
check('EV2-7 MD-2 the sheet shortcut reads referenceArtifactStructure and never changes category',()=>{
  const input=structuredClone(f),kai=input.project.characters[0];Object.assign(kai.candidateFiles[1],{coverageJobType:'slot',coverageSheetType:'expressions'});Object.assign(kai.candidateFiles[2],{coverageJobType:'sheet'});
  const before=JSON.stringify(input),out=PM.productionMediaRecords(input).records,expression=out.find(r=>r.file.name==='KAI_ALT_V002.png'),sheet=out.find(r=>r.file.name==='KAI_BAD_V003.png');
  assert.notEqual(expression.context.workflow.value,'reference-sheet','a single expression view is not a sheet');assert.equal(sheet.context.workflow.value,'reference-sheet');
  const composed=D.compose(input.project,out);for(const r of [expression,sheet])assert.equal(composed.find(x=>x.key===r.key).category,'characters');
  assert.equal(JSON.stringify(input),before,'classification rewrites no candidate row');
});
/* EV2-7 review fixes. The upload path (public/media.js uploadProjectMedia) stores MEDIA-<target>-<ts>-<n>.<ext>, records originalName = file.name
   and title = the file.name stem. That title is a filename, not a headline. */
check('EV2-7 an upload-shaped library title (the original file stem) is never the headline',()=>{
  const input=structuredClone(f);
  input.project.mediaAssets.push({id:'media-upload-1',file:'MEDIA-SH010-abc-1.png',originalName:'SH010_APPROVED_FINAL.png',title:'SH010_APPROVED_FINAL',kind:'image',createdAt:ISO(9),links:[{id:'lu1',targetType:'shot',targetId:'SH010',role:'planning-reference'}]});
  input.scan.media.push({name:'MEDIA-SH010-abc-1.png',url:'/assets/media/MEDIA-SH010-abc-1.png'});
  const out=D.compose(input.project,PM.productionMediaRecords(input).records),row=out.find(r=>r.originalName==='SH010_APPROVED_FINAL.png');
  assert(row,'the uploaded library asset is present');assert.equal(row.title,'SH010 · Planning reference','the title falls back to the recorded link');assert(!/approved/i.test(row.title));
  assert.equal(row.decision,'candidate');assert.equal(D.decisionLabel(row),'Candidate');assert(/APPROVED/.test(row.fileName+' '+row.originalName),'the filename is kept for the caption');
  assert(D.query(out,{...D.defaults(),decision:'all',query:'SH010_APPROVED_FINAL'}).rows.some(r=>r.key===row.key),'the original filename stays searchable');
  const [inv,titled,unlinked]=D.compose(f.project,[],[
    {assetId:LEDGER('7'),mediaType:'image',available:true,url:'/assets/x',storagePath:'media/MEDIA-KAI-xyz-1.png',sourceName:'MEDIA-KAI-xyz-1.png',libraryOriginalName:'KAI_APPROVED_TURNAROUND.PNG',title:'kai_approved_turnaround',links:[{targetType:'character',targetId:'KAI',role:'character-reference'}]},
    {assetId:LEDGER('8'),mediaType:'image',available:true,url:'/assets/y',storagePath:'media/MEDIA-KAI-xyz-2.png',sourceName:'MEDIA-KAI-xyz-2.png',libraryOriginalName:'IMG_0042.png',title:'Harbor study at dusk',links:[]},
    {assetId:LEDGER('9'),mediaType:'video',available:true,url:'/assets/z',storagePath:'media/MEDIA-X-1.mp4',sourceName:'MEDIA-X-1.mp4',title:'MEDIA-X-1.mp4',links:[]}]);
  assert.equal(inv.title,'Kai · Character reference','an inventory-only upload stem (compared case-insensitively, extension stripped) is not a title');assert.equal(inv.decision,'candidate');
  assert(D.query([inv],{...D.defaults(),decision:'all',query:'KAI_APPROVED_TURNAROUND'}).total===1,'and its original name stays searchable');
  assert.equal(titled.title,'Harbor study at dusk','a title a person recorded is kept');assert.equal(unlinked.title,'Untitled video');
  assert.equal(D.recordedTitle('Kai v1.2',['KAI_V1.png']),'Kai v1.2');assert.equal(D.recordedTitle('shot.final',['SHOT.FINAL.PNG']),'');
});
check('EV2-7 owner titles never end in a dangling Frame word',()=>{
  const bare=records.find(r=>r.fileName==='SH020_FRAME_A_FAL_1.png');assert.equal(bare.title,'SH020');
  assert.equal(records.find(r=>r.fileName==='SH010_FRAME_A_V001.png').title,'SH010 · Frame A');assert(records.every(r=>!/Frame$/.test(r.title)));
});
check('EV2-7 an inventory-only ledger shot render never becomes an entity item through a link',()=>{
  const [frame]=D.compose(f.project,[],[{assetId:LEDGER('6'),mediaType:'image',available:true,url:'/assets/f',sourceName:'SH010_F.png',title:'SH010_F.png',ledgerRole:'frame-candidate',links:[{targetType:'character',targetId:'KAI',role:'character-reference'}]}]);
  assert.deepEqual(frame.categories,['shot-renders']);assert.equal(frame.category,'shot-renders');assert(frame.related.some(r=>r.key==='characters:KAI'),'the character stays a Related-to facet');
  assert.equal(D.categoryCounts([frame],{...D.defaults(),decision:'all'}).characters,0,'and it is not counted under Characters');
});
/* A coverage or expression slot edge maps to no authority target, so the projection always reads a slot-only claim as historic. Discovery words it as
   the current view selection it is; the projection's disposition, authority and receipts are untouched. */
check('EV2-7 a recorded slot-only selection reads Selected for its view; disposition stays historic',()=>{
  const input=structuredClone(f);input.project.characters[0].coverageSlots.push({id:'side',label:'Side',selectedFile:'KAI_ALT_V002.png',status:'selected'});
  const before=JSON.stringify(input),recs=PM.productionMediaRecords(input).records,alt=recs.find(r=>r.file.name==='KAI_ALT_V002.png');
  assert.equal(alt.disposition.role,'historic');assert.equal(alt.disposition.authority.receiptBacked,false);assert.equal(alt.humanDecision.state,'undecided');
  const out=D.compose(input.project,recs),row=out.find(r=>r.key===alt.key);
  assert.equal(row.decision,'selected');assert.equal(D.decisionLabel(row),'Selected for Side');assert(!/approved|historic/i.test(D.decisionLabel(row)));
  assert(D.matches(row,{...D.defaults(),decision:'selected'}));assert(!D.matches(row,{...D.defaults(),decision:'approved'}));assert(!D.matches(row,{...D.defaults(),decision:'historic'}));assert.equal(row.needsDecision,true,'a view selection still awaits an approval decision');
  const legacy=out.find(r=>r.fileName==='KAI_DEFAULT_V001.png');assert.equal(legacy.decision,'historic','a state edge without a receipt stays a historic selection, even beside a slot edge');
  assert.equal(D.slotSelection({disposition:{role:'approved',targets:[{kind:'coverage',label:'Front'}]}}),null,'a receipt-backed approval is never reworded');
  assert.equal(JSON.stringify(input),before,'wording writes nothing');
});
console.log(`${count} EV2-3 discovery checks passed`);

