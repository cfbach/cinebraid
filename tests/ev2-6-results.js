'use strict';
const assert=require('assert'),vm=require('vm'),fs=require('fs'),path=require('path');
let checks=0;const check=(name,value)=>{assert(value,name);checks++;};
const known=value=>({state:'known',value});
const entity={id:'ref',name:'Actor',continuityStates:[{id:'day',name:'Day'},{id:'night',name:'Night'}],coverageSlots:[{id:'front'},{id:'side'}],candidateFiles:[{stored:'binding-a',targetStateId:'day',targetCoverageSlotId:'front'},{stored:'binding-b',targetStateId:'night',targetCoverageSlotId:'side'}]};
const shot={id:'shot',title:'Station',keyframes:[{id:'a',label:'A'},{id:'b',label:'B'}],candidateFiles:[{stored:'one.png',frameId:'a'}]};
function use(name,stateId,slot){return {key:'asset:shared',kind:'entity-reference',context:{entityList:known('characters'),entityId:known('ref'),stateId:known(stateId),coverageSlotId:known(slot)},file:{name,url:'/synthetic/'+name,mediaType:'image'},identity:{ledger:known('asset-shared')},disposition:{role:'candidate',authority:{receiptBacked:true}},actions:['approve']};}
const a=use('binding-a','day','front'),b=use('binding-b','night','side');
let records=[{...b,relationships:[b,a]}],missing=[],items=[];const P={shots:[shot],characters:[entity]};
/* A PRESS MUST REACH THE SHIPPED LISTENER. This harness records what results-desk.js registers on the
   document and on the window, renders through the same repaint the page uses, and delivers a click the
   way a browser does — `closest()` answers for the control under the pointer. Nothing here calls a
   Results function by name, so a card that stopped being pressable would fail rather than pass. */
const listeners=new Map(),focused=[],main={scrollTop:0};let rendered='';
const listen=(type,fn)=>listeners.set(type,[...(listeners.get(type)||[]),fn]);
const fire=(type,event)=>(listeners.get(type)||[]).forEach(fn=>fn(event));
const keys=()=>[...rendered.matchAll(/data-rx-key="([^"]+)"/g)].map(m=>m[1]);
const root={querySelectorAll:sel=>sel==='[data-rx-key]'?keys().map(key=>({dataset:{rxKey:key},focus(){focused.push('card:'+key);}})):[]};
const dom={body:{classList:{add(){},toggle(){}}},activeElement:null,addEventListener:listen,
 getElementById:id=>id==='main'?main:{id,focus(){focused.push(id);}},
 querySelector:sel=>sel==='[data-results-desk]'&&rendered.includes('data-results-desk')?root:null};
const control=(attribute,value)=>({closest:sel=>sel==='[data-rx-job]'?null:{dataset:attribute==='data-rx'?{rx:value}:{rxKey:value},hasAttribute:name=>name===attribute}});
const c={window:null,globalThis:null,document:dom,history:{state:null,replaceState(state,title,url){c.location.hash=String(url);}},location:{hash:''},esc:String,attr:String,ACTIVE_PROJECT_SLUG:'synthetic',PROJECT_OPEN_EPOCH:1,P,SCAN:{},ENTITY_ROUTE:{characters:'character'},CineBraidResults:{openRelated(){return 'preserved';}},CineBraidMediaInspector:{projection:()=>({records,unresolvedReferences:missing})},CineBraidReferenceMedia:{listing:()=>[{name:'binding-a',available:true},{name:'binding-b',available:false}]},currentHumanAuthority:(p,t)=>t.stateId==='night'?{value:'binding-b',assetId:'asset-shared'}:null,entityStateListRead:e=>e.continuityStates,entityCandidateRow:(e,n)=>e.candidateFiles.find(r=>r.stored===n),entityCandidateTargetStateId:(e,n)=>e.candidateFiles.find(r=>r.stored===n)?.targetStateId||'state-default',shotById:id=>P.shots.find(s=>s.id===id),shotCandidateRowFor:(s,n)=>s.candidateFiles.find(r=>r.stored===n),returnedReviewProjectionForBrowser:()=>({items}),addEventListener:listen};c.window=c;c.globalThis=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/results-desk.js'),'utf8'),c);
/* The page's own render path: Results repaints by calling route(), and mounts on the rendered event. */
c.route=()=>{rendered=c.CineBraidResults.view();fire('cinebraid:route-rendered',{});};
const before=JSON.stringify(P),scope={list:'characters',id:'ref',stateId:'day',slotId:'front'};
let m=c.CineBraidResults.model(scope);check('Relationship context wins over representative',m.rows.length===1&&m.rows[0].name==='binding-a');check('Other-state approval does not leak',!m.rows[0].approved);check('Existing Production Media API preserved',c.CineBraidResults.openRelated()==='preserved');check('Unknown view fails closed',!c.CineBraidResults.model({...scope,slotId:'deleted'}).valid);check('Unknown state fails closed',!c.CineBraidResults.model({...scope,stateId:'deleted'}).valid);check('Exact view excludes other views',!c.CineBraidResults.model({...scope,slotId:'side'}).rows.length);check('Night keeps unavailable exact identity',c.CineBraidResults.model({...scope,stateId:'night',slotId:'side'}).rows[0].available===false);check('Read model never changes project',JSON.stringify(P)===before);
const result=(key,frame,kind='shot-frame')=>({key,shotId:'shot',owner:{kind,frameId:frame},candidate:{name:key+'.png',mediaType:'image',url:'/synthetic/'+key,receiptBacked:false},actions:['approve','reject'],mediaAvailable:true,humanDecision:'undecided'});
items=[result('one','a'),result('two','b'),{...result('foreign','a'),shotId:'another'},result('motion','','shot-motion')];records=[];
m=c.CineBraidResults.model({shotId:'shot',kind:'frame',frameId:'a'});check('Exact frame excludes sibling, foreign shot and motion',m.rows.length===1&&m.rows[0].key==='one');check('Unknown frame fails closed',!c.CineBraidResults.model({shotId:'shot',kind:'frame',frameId:'deleted'}).valid);items[0].mediaAvailable=false;items[0].candidate.url='';items[0].unreviewable='media-not-available';m=c.CineBraidResults.model({shotId:'shot',kind:'frame',frameId:'a'});check('Missing stays present and cannot approve',m.rows.length===1&&!m.rows[0].available&&!m.rows[0].canApprove);check('Read does not normalize candidate bookkeeping',JSON.stringify(P)===before);
records=[{...b,relationships:[{...a,disposition:{role:'approved'}},b]}];entity.candidateFiles[0].decision='rejected';entity.candidateFiles[1].decision='rejected';
check('Coverage disposition cannot hide exact candidate rejection',c.CineBraidResults.model(scope).rows[0].rejected);
check('Current primary authority outranks stale rejection',!c.CineBraidResults.model({...scope,stateId:'night',slotId:'side'}).rows[0].rejected);
// Load failure is presentation only: every loadable card carries a hidden neutral placeholder, the stage keeps its load-error panel hidden and Approve starts disabled until the exact media loads.
c.document.body={classList:{add(){},toggle(){}}};const gone=result('gone','a');items=[result('shown','a'),{...gone,mediaAvailable:false,unreviewable:'media-not-available',candidate:{...gone.candidate,url:''}},{...result('clip','a'),candidate:{...result('clip','a').candidate,mediaType:'video'}}];records=[];
const html=c.CineBraidResults.view({scope:{shotId:'shot',kind:'frame',frameId:'a'},key:''}),grid=html.slice(html.indexOf('class="rx-grid"'),html.indexOf('<aside class="rx-selected"'));
check('Each loadable card has one hidden placeholder',(grid.match(/<(img|video) /g)||[]).length===2&&(grid.match(/<span class="rx-thumb-unavailable" hidden>Media unavailable<\/span>/g)||[]).length===2);
check('Recorded-missing card shows its placeholder',(grid.match(/<span class="rx-thumb-unavailable">Media unavailable<\/span>/g)||[]).length===1);
check('Placeholders keep exact card identity and decision label',grid.includes('aria-label="Result 1, Result. Selected. Press again to open in Screening"')&&grid.includes('aria-label="Result 2, Unavailable"')&&(grid.match(/data-rx-key=/g)||[]).length===3);
check('Only the selected card names the press that opens Screening',(grid.match(/Press again to open in Screening/g)||[]).length===1&&(grid.match(/<span class="rx-card-open"/g)||[]).length===1);
check('Stage load error starts hidden with Retry loading',html.includes('<div class="rx-load-error" hidden role="status">Result cannot be loaded. Selection retained. <button type="button" data-rx="reload-media"'));
check('Approve waits for the exact media to load',/id="rx-approve" class="rx-primary" disabled/.test(html));
/* ===================================================================================================
   EV2-7 — A VISIBLY SELECTED RESULT IS NOT A DEAD ONE.

   Pressing an unselected card selects it, updates the URL key and keeps focus on the card. Pressing the
   card that is ALREADY selected opens Screening for exactly that key — and so does the large preview in
   the selected panel. Enter and Space are the card button's own keys, so the page's keydown owner must
   leave them alone; arrow navigation still only moves the selection. Leaving Screening comes back to the
   same card with the contact sheet where it was. None of it writes, and none of it decides.
   =================================================================================================== */
items=[result('one','b'),result('two','b')];records=[];c.location.hash='#/shot/shot/results/frame/b/-';
const untouched=JSON.stringify(P),reviewed=JSON.stringify(items);c.route();
const press=key=>fire('click',{target:control('data-rx-key',key)}),act=id=>fire('click',{target:control('data-rx',id)});
const selectedKey=()=>(rendered.match(/data-rx-key="([^"]+)" aria-pressed="true"/)||[])[1]||'';
const screening=()=>/^<section class="results-desk rx-screening"/.test(rendered);
/* In Screening the exact result is the one on the stage: its own media, under the key the URL carries. */
const screenedKey=()=>(rendered.match(/<(?:img|video) id="rx-primary"[^>]*src="\/synthetic\/([^"]+)"/)||[])[1]||'';
check('Results opens on the first result, in the contact sheet',selectedKey()==='one'&&!screening()&&keys().length===2);
focused.length=0;press('two');
check('Pressing an unselected result only selects it',selectedKey()==='two'&&!screening()&&keys().length===2);
check('A selection updates the URL key and keeps focus on that card',c.location.hash==='#/shot/shot/results/frame/b/two'&&focused[focused.length-1]==='card:two');
const contact=rendered;
check('The selected preview is itself the control that opens Screening',/<figure class="rx-media rx-media-open"><img id="rx-primary" src="\/synthetic\/two"[^>]*><button type="button" class="rx-open" data-rx="screen-large" aria-label="Open in Screening · Result 2"><span aria-hidden="true">⤢ Open in Screening<\/span><\/button>/.test(contact)&&contact.includes('>View large / compare<'));
main.scrollTop=420;focused.length=0;press('two');
check('Pressing the already-selected result opens Screening for exactly that key',screening()&&screenedKey()==='two'&&c.CineBraidResults.parse().key==='two'&&c.location.hash==='#/shot/shot/results/frame/b/two');
check('Screening replaces the contact sheet rather than adding to it',rendered.includes('class="rx-stage')&&!rendered.includes('class="rx-grid"'));
const screenHtml=rendered;main.scrollTop=0;focused.length=0;act('screen');
check('Contact sheet returns to the same card with focus on it',!screening()&&selectedKey()==='two'&&focused[focused.length-1]==='card:two');
check('...and with the contact sheet scrolled where it was',main.scrollTop===420);
focused.length=0;act('screen-large');
check('The large preview control opens Screening for the selected result',screening()&&screenedKey()==='two'&&focused[focused.length-1]==='rx-screen');
focused.length=0;fire('keydown',{key:'Escape',preventDefault(){},target:{closest:()=>null}});
check('Escape leaves Screening for the same card',!screening()&&selectedKey()==='two'&&focused[focused.length-1]==='card:two');
let intercepted=0;const cardOne={dataset:{rxKey:'one'}},cardTwo={dataset:{rxKey:'two'}},grid2={children:[cardOne,cardTwo]};cardOne.parentElement=cardTwo.parentElement=grid2;
const keyOn=(card,key)=>fire('keydown',{key,preventDefault(){intercepted++;},target:{closest:sel=>sel==='#modal'?null:card}});
keyOn(cardTwo,'Enter');keyOn(cardTwo,' ');
check('Enter and Space stay the card button’s own keys',intercepted===0&&/<button class="rx-card [^>]*data-rx-key="two" aria-pressed="true"/.test(rendered)&&!screening());
press('two');
check('The press Enter and Space deliver opens Screening for that card',screening()&&screenedKey()==='two');
act('screen');keyOn(cardTwo,'ArrowLeft');
check('Arrow navigation still moves the selection and opens nothing',selectedKey()==='one'&&!screening()&&intercepted===1);
keyOn(cardOne,'End');
check('End still reaches the last card without opening Screening',selectedKey()==='two'&&!screening()&&intercepted===2);
const slotFirst=/^<section class="results-desk[^"]*" data-results-desk><header class="rx-heading"><span data-return-slot><\/span><div class="rx-heading-row"><div><p class="rx-eyebrow">/;
check('The return slot is the first element of the Results header, above the eyebrow and the heading',slotFirst.test(contact));
check('...and of the Screening header, in the same place',slotFirst.test(screenHtml));
check('No return sits among the header actions any more',!/rx-head-actions"><span data-return-slot>/.test(contact+screenHtml)&&(contact+screenHtml).split('data-return-slot').length===3);
check('The plain origin target is still offered when no return matches',/<button type="button" data-rx="origin" id="rx-origin" >Open shot<\/button>/.test(contact));
check('Status is a word, and the dot only agrees with it',/<span class="rx-status" data-rx-state="open">Result<\/span>/.test(contact)&&!/rx-status[^>]*>(<|\s*$)/.test(contact));
check('Selecting, opening and leaving Screening write nothing and decide nothing',JSON.stringify(P)===untouched&&JSON.stringify(items)===reviewed);
console.log('EV2-6 Results scope: '+checks+' checks passed');
