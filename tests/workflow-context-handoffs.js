/* Current intention follows the Bible and frame editor into Results. Request revision
 * opens the existing exact target workflow; these navigation actions never generate,
 * approve, or change project data. No server or provider is contacted. */
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {render,rawFixture}=require('./render-harness');
let checks=0;
const equal=(actual,expected,note)=>{assert.strictEqual(actual,expected,note);checks++;};
const ok=(value,note)=>{assert.ok(value,note);checks++;};
(async()=>{
 const project=rawFixture(),entity=project.characters.find(row=>row.id==='KAI'),shot=project.shots[0];
 entity.creationDescription='Current Bible description: red coat.';
 entity.notes='Old production note: blue coat.';
 entity.continuityStates=[{id:'state-default',name:'Default',isDefault:true,notes:'Primary approved reference.'},{id:'state-night',name:'Night',parentStateId:'state-default',notes:'Coat soaked by rain.'}];
 entity.coverageSlots=[{id:'side',label:'Side',requirement:'planned'}];
 shot.desc='Legacy shot brief.';
 shot.keyframes[0].description='Earlier frame description.';
 shot.creationBrief={...(shot.creationBrief||{}),frameWorkflows:{[shot.keyframes[0].id]:{action:'Current frame action: turn toward the door.'}}};
 const rendered=await render('#/production',project),run=source=>vm.runInContext(source,rendered.context);
 run(`globalThis.matchMedia=()=>({matches:true,addEventListener(){}}); globalThis.__prepared=[];globalThis.__moves=[];globalThis.__dialogs=[];globalThis.__desktop=true;
   matchMedia=()=>({matches:__desktop,addEventListener(){}});
   window.CineBraidMediaInspector={projection:()=>({records:[],unresolvedReferences:[]})};
   window.CineBraidResults={};
   window.CineBraidMediaReturn={capture:()=>({hash:location.hash,label:'Return to Kai'}),prepare:saved=>__prepared.push(saved),go:(hash,saved)=>{__moves.push({hash,saved});location.hash=hash;},matches:()=>false};
   route=()=>Promise.resolve();openModal=html=>__dialogs.push(html);closeModal=()=>{};
   const query=document.querySelector.bind(document);document.querySelector=selector=>selector==='#modal:not(.hidden)'?null:query(selector);
 `);
 const load=file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),rendered.context,{filename:file});
 load('shared-reference-media.js');load('reference-desk.js');
 const referenceClick=rendered.documentListeners.get('click').at(-1);
 load('results-desk.js');const resultsClick=rendered.documentListeners.get('click').at(-1);
 const scope={list:'characters',id:'KAI',stateId:'state-default',slotId:''};
 const model=target=>run(`CineBraidResults.model(${JSON.stringify(target)})`);
 const openResults=(target,key='')=>run(`location.hash=CineBraidResults.href(${JSON.stringify(target)},${JSON.stringify(key)});CineBraidResults.view({scope:${JSON.stringify(target)},key:${JSON.stringify(key)}})`);
 const resultAction=id=>resultsClick({target:{closest:selector=>selector==='[data-rx-job]'?null:{dataset:{rx:id},hasAttribute:()=>false}}});
 const referenceAction=id=>referenceClick({target:{id:'',closest:selector=>selector.startsWith('[data-rd-action]')?{dataset:{rdAction:id},disabled:false,hasAttribute:()=>false}:null}});
 const snapshot=run('JSON.stringify(P)');
 equal(model(scope).brief,entity.creationDescription,'Reference Results uses the current Bible description');
 equal(model(scope).stateBrief,'','Default-state bookkeeping is not a creative brief');
 equal(model({...scope,stateId:'state-night'}).brief,entity.creationDescription,'State Results keeps the base reference intention');
 equal(model({...scope,stateId:'state-night'}).stateBrief,'Coat soaked by rain.','State Results keeps its exact current state change');
 const frameScope={shotId:shot.id,kind:'frame',frameId:shot.keyframes[0].id};
 equal(model(frameScope).brief,'Current frame action: turn toward the door.','Frame Results follows the current frame editor action');
 equal(model({shotId:shot.id,kind:'motion',frameId:''}).brief,'Legacy shot brief.','Motion Results does not borrow a frame action');
 let html=openResults({...scope,stateId:'state-night'});
 const contextText=html.replace(/<[^>]*>/g,'');
 ok(contextText.includes('Current intention: Current Bible description: red coat.')&&contextText.includes('Current state change: Coat soaked by rain.'),'The review context explicitly identifies current intention and change');
 ok(!html.includes('Old production note: blue coat.')&&!html.includes('Primary approved reference.'),'Stale notes and default-state metadata do not replace review intention');
 openResults(scope);await resultAction('revise');
 equal(run('location.hash'),'#/character/KAI/tools','Primary revision opens the existing reference tools');
 equal(run("boundedFocusedTask('entity-task','characters:KAI',['reference','coverage','details'],'details')"),'reference','Primary revision selects the primary reference task');
 ok(run("workspaceSectionOpen('asset-prompt:characters:KAI:more')&&workspaceSectionOpen('asset-prompt:characters:KAI:manual')"),'Primary revision exposes the existing manual prompt editor');
 ok(run("workspaceSectionOpen('asset-prompt:characters:KAI:replace')"),'Primary revision also exposes replacement controls when a primary file already exists');
 equal(run('__prepared.length'),1,'Primary revision prepares one return with the shared coordinator');
 equal(run('__prepared[0].hash'),'#/character/KAI/results/state-default/-/-','That return names the exact primary Results scope');
 equal(run('__moves.length'),0,'The primary helper owns the single outgoing navigation');
 openResults({...scope,stateId:'state-night'});await resultAction('revise');
 equal(run("boundedFocusedTask('entity-task','characters:KAI',['reference','coverage','details'],'details')"),'coverage','State revision still selects Production needs');
 equal(run("boundedReadState('selected:continuity-state','characters:KAI','')"),'state-night','State revision preserves the exact continuity state');
 openResults({...scope,slotId:'side'});await resultAction('revise');
 equal(run("boundedReadState('selected:coverage-slot','characters:KAI','')"),'side','View revision preserves the exact coverage view');
 equal(run("boundedReadState('selected:continuity-state','characters:KAI','')"),'state-default','A primary-state view keeps its state while opening coverage');
 equal(run("boundedFocusedTask('entity-task','characters:KAI',['reference','coverage','details'],'details')"),'coverage','A primary-state coverage view does not get sent to the primary prompt editor');
 run("location.hash='#/character/KAI';CineBraidReferenceDesk.selectForResults({list:'characters',id:'KAI',stateId:'state-night'});CineBraidReferenceDesk.view('characters','KAI')");
 referenceAction('inspect');html=run("CineBraidReferenceDesk.view('characters','KAI')");
 ok(html.includes('data-rd-bible href="#/bible/characters/KAI"'),'Reference details offers the exact Bible element');
 const pressBible=dialog=>{const link={getAttribute:()=> '#/bible/characters/KAI',hasAttribute:key=>key==='data-rd-bible',closest:selector=>selector==='[data-reference-details-dialog], .rd-inspection'||dialog&&selector==='[data-reference-details-dialog]'?{}:null};referenceClick({target:{id:'',closest:selector=>selector==='a[href^="#/"]'?link:null},preventDefault(){throw new Error('Bible navigation unexpectedly refused');}});};
 pressBible(false);
 equal(run('__prepared.at(-1).hash'),'#/character/KAI','Bible navigation preserves the actual reference origin');
 equal(run('__prepared.at(-1).label'),'Return to Kai','Bible uses the shared reference return label');
 run('__desktop=false');referenceAction('inspect');pressBible(true);
 const before=run('__dialogs.length');run('__prepared.at(-1).resume()');
 equal(run('__dialogs.length'),before+1,'Returning from Bible reopens details when it came from the narrow-screen dialog');
 html=run("CineBraidReferenceDesk.view('characters','KAI')");
 ok(html.includes('value="state-night" selected'),'The Bible detour preserves the selected continuity state');
 run(`CineBraidMediaInspector.projection=()=>({records:[{key:'asset:original-reference',kind:'entity-reference',context:{entityList:{state:'known',value:'characters'},entityId:{state:'known',value:'KAI'}},file:{name:'KAI-ANCHOR.png',url:'/synthetic/original.png',mediaType:'image'},identity:{ledger:{state:'known',value:'original-reference'}},disposition:{role:'candidate'},actions:[],provenance:{submittedPrompt:{state:'known',value:'Frozen submitted prompt: green coat.'}}}],unresolvedReferences:[]})`);
 openResults(scope);await resultAction('request');
 const request=run('__dialogs.at(-1)');
 ok(request.includes('Original request')&&request.includes('Frozen submitted prompt: green coat.'),'Original request still shows immutable submitted text');
 ok(!request.includes(entity.creationDescription),'Current Bible intention is never presented as the original submitted request');
 equal(run('JSON.stringify(P)'),snapshot,'Review context and handoffs never mutate project or approval data');
 /* This independent fixture deliberately gives unrelated media the same asset id and
  * misleading names. Only the shared exact state/view assignment establishes a role. */
 run(`{
  const entity=P.characters.find(row=>row.id==='KAI');
  entity.coverageSlots=[
   {id:'front',label:'Front',selectedFile:'KAI-ANCHOR.png'},
   {id:'front-alternative',label:'Front',selectedFile:'front-alternative.png'},
   {id:'side',label:'Profile',referenceBindings:{'state-night':'ref-profile-exact'}},
   {id:'sheet-view',label:'Sheet view',selectedFile:'sheet.png'},
   {id:'missing-view',label:'Back',selectedFile:'unavailable.png'},
   {id:'night-legacy',label:'Night legacy view',selectedFile:'night-legacy.png'}
  ];
  entity.candidateFiles=[
   {stored:'KAI-ANCHOR.png',targetStateId:'state-default',coverageJobType:'single-reference'},
   {stored:'front-alternative.png',targetStateId:'state-default',coverageJobType:'single-reference'},
   {stored:'PROFILE-looking-unbound.png',targetStateId:'state-default',coverageJobType:'single-reference'},
   {stored:'sheet.png',targetStateId:'state-default',coverageJobType:'sheet'},
   {stored:'unavailable.png',targetStateId:'state-default',coverageJobType:'single-reference'},
   {stored:'ref-profile-exact',targetStateId:'state-night',targetCoverageSlotId:'side',coverageJobType:'single-reference',referenceBinding:{stateId:'state-night',slotId:'side'}},
   {stored:'profile-shared-asset.png',targetStateId:'state-night',coverageJobType:'single-reference'},
   {stored:'night-legacy.png',targetStateId:'state-night',coverageJobType:'single-reference'}
  ];
  const media=entity.candidateFiles.map(row=>({name:row.stored,url:'/synthetic/'+row.stored,available:row.stored!=='unavailable.png',assetId:'shared-asset',stateId:row.targetStateId}));
  SCAN.references={...(SCAN.references||{}),characters:{...(SCAN.references?.characters||{}),KAI:media}};
  CineBraidMediaInspector.projection=()=>({records:media.map(item=>({key:'asset:shared-'+item.name,kind:'entity-reference',context:{entityList:{state:'known',value:'characters'},entityId:{state:'known',value:'KAI'},coverageSlotId:{state:'known',value:item.name==='ref-profile-exact'?'side':''}},file:{name:item.name,url:item.url,mediaType:'image'},identity:{ledger:{state:'known',value:item.assetId}},disposition:{role:'candidate'},actions:[],provenance:{}})),unresolvedReferences:[]});
 }`);
 const roleSnapshot=run('JSON.stringify({project:P,scan:SCAN})');
 const roles=row=>JSON.stringify(row.roles||[]),defaultRows=model(scope).rows,nightScope={...scope,stateId:'state-night'},nightRows=model(nightScope).rows;
 equal(roles(defaultRows[0]),JSON.stringify([{id:'front',label:'Front'}]),'Results reads the exact default-state Front selection');
 equal(roles(defaultRows[1]),JSON.stringify([{id:'front-alternative',label:'Front'}]),'Two distinct recorded views may share a display label');
 equal(roles(defaultRows.find(row=>row.name==='PROFILE-looking-unbound.png')),'[]','A filename and shared asset id cannot imply a view');
 equal(roles(defaultRows.find(row=>row.name==='sheet.png')),'[]','A sheet does not gain a single-view label from its selection');
 equal(roles(defaultRows.find(row=>row.name==='unavailable.png')),'[]','An unavailable assignment does not claim a filled view');
 equal(roles(nightRows.find(row=>row.name==='ref-profile-exact')),JSON.stringify([{id:'side',label:'Profile'}]),'Results retains the exact state-specific Profile binding');
 equal(roles(nightRows.find(row=>row.name==='profile-shared-asset.png')),'[]','A second relationship with the same asset is not the selected view');
 equal(roles(nightRows.find(row=>row.name==='night-legacy.png')),'[]','A legacy view selection does not become a nondefault-state assignment');
 equal(model({...nightScope,slotId:'side'}).rows.map(row=>row.name).join(','),'ref-profile-exact','View-scoped Results keeps only the exact recorded view relationship');
 ok(!defaultRows.some(row=>row.name==='ref-profile-exact')&&!nightRows.some(row=>row.name==='KAI-ANCHOR.png'),'Roles and candidates remain isolated to their recorded state');
 html=openResults(scope,defaultRows[0].key);
 ok(html.includes('<b>Front · Result 1</b>')&&html.includes('<b>Front · Result 2</b>'),'Contact cards retain recorded view labels and distinguish duplicate labels by result index');
 ok(html.includes('<b>Result 3</b>')&&!html.includes('<b>Profile · Result 3</b>'),'An unbound candidate has a truthful generic result label');
 ok(/<figcaption>[^<]*Front · Result 1[^<]*<\/figcaption>/.test(html),'The selected preview carries its recorded Front role and stable result index');
 await resultAction('screen');html=run('CineBraidResults.view()');
 ok(/<figcaption>[^<]*Front · Result 1[^<]*<\/figcaption>/.test(html),'The Screening preview carries the same Front role');
 ok(/<option[^>]*>Front · Result 2 · Candidate<\/option>/.test(html),'Comparison choices distinguish the second Front result');
 ok(/<option[^>]*>Result 3 · Candidate<\/option>/.test(html),'Comparison choices preserve the generic label for an unbound result');
 const resultsChange=rendered.documentListeners.get('change').at(-1);
 resultsChange({target:{id:'rx-compare',value:defaultRows[1].key}});html=run('CineBraidResults.view()');
 const captions=[...html.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map(match=>match[1]);
 equal(captions.length,2,'A comparison renders two separate media captions');
 ok(captions[0].includes('Front · Result 1')&&captions[1].includes('Front · Result 2'),'Both comparison panes keep their own result identity when their role labels match');
 html=openResults(nightScope,nightRows[0].key);await resultAction('screen');html=run('CineBraidResults.view()');
 ok(/<figcaption>[^<]*Profile · Result 1[^<]*<\/figcaption>/.test(html),'The other state carries its exact Profile role into Screening');
 ok(!html.includes('Front · Result'),'Screening never borrows a default-state role for another state');
 equal(run('JSON.stringify({project:P,scan:SCAN})'),roleSnapshot,'Role labels, Screening and comparison never mutate project or scan records');
 console.log('Workflow context handoffs: '+checks+' checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
