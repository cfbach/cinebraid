'use strict';
// Opt-in DOM/transport model for unit-level confirmation contracts. Browser suites
// separately prove decoding, pointer/keyboard input and actual filesystem saves.
const assert=require('assert/strict'),crypto=require('crypto'),vm=require('vm');
const {createAuthorityWriteSeam,WRITE_CLASSES}=require('../../src/authority/authority-write-seam');
const clone=x=>JSON.parse(JSON.stringify(x));
function memoryStore(project){
 let stored=clone(project),writes=0;
 const revision=()=> '"'+crypto.createHash('sha256').update(JSON.stringify(stored)).digest('hex')+'"';
 const seam=createAuthorityWriteSeam({resolveFile:()=> 'fixture/project.json',exists:()=>true,readProject:()=>clone(stored),revisionFor:revision,validateProject:()=>({ok:true,errors:[]}),writeProject:(_,next)=>{stored=clone(next);writes++;}});
 const headers=()=>({'x-cinebraid-project-slug':'fixture','x-cinebraid-project-revision':revision(),etag:revision()});
 return {stored:()=>clone(stored),writes:()=>writes,fetch:async(url,options={},respond)=>{
  if(url==='/api/project'||(/^\/api\/projects\/fixture\/project$/.test(url)&&!options.method))return respond(clone(stored),200,headers());
  if(/^\/api\/projects\/fixture\/(project|canon-transition)$/.test(url)&&['PUT','POST'].includes(options.method)){
   const body=JSON.parse(options.body),transition=url.endsWith('/canon-transition');
   const result=seam.persistProjectSuccessor({slug:'fixture',successor:transition?body.successor:body,writeClass:transition?WRITE_CLASSES.CANON_TRANSITION:WRITE_CLASSES.NORMAL_SAVE,expectedRevision:options.headers['If-Match']||options.headers['if-match'],transitionMetadata:transition?body.transition:undefined});
   if(!result.ok) console.error('SYNTHETIC SEAM REFUSAL',JSON.stringify(result.refusal));
   return result.ok?respond({ok:true,project:clone(stored),revision:revision(),slug:'fixture'},200,headers()):respond(result.refusal.body||result.refusal,result.refusal.status||422,headers());
  }
  if(url==='/api/generation/fal/jobs')return respond({jobs:[],projectSlug:'fixture'});
  return null;
 }};
}
function confirmationDOM(page){
 const doc=page.context.document,query=doc.querySelector.bind(doc);let loaded=false,listeners={};
 const markup=()=>doc.getElementById('modal').innerHTML;
 const source=()=> ((markup().match(/<(?:img|video)[^>]* src="([^"]+)"/)||[])[1]||'').replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[key]);
 const media={get tagName(){return /<video/.test(markup())?'VIDEO':'IMG';},get complete(){return loaded;},get naturalWidth(){return loaded?640:0;},get readyState(){return loaded?1:0;},getAttribute:n=>n==='src'?source():null,addEventListener:(n,f)=>{listeners[n]=f;}};
 const modal={querySelector:s=>s==='img,video'?media:null};
 doc.querySelector=s=>s==='.rx-confirm img,.rx-confirm video'?media:s==='#modal:not(.hidden) .rx-confirm'?!doc.getElementById('modal').classList.contains('hidden')&&markup().includes('rx-confirm')?modal:null:query(s);
 return {reset(){loaded=false;listeners={};},load(){loaded=true;(listeners.load||listeners.loadedmetadata)?.();}};
}
async function confirmDecision(page,dom,args,store,openDecision=null){
 const before=store.writes();
 dom.reset();await (openDecision?openDecision():page.context.CineBraidResultDecisions.open(...args));
 assert.equal(store.writes(),before,'opening confirmation must not persist any successor before the explicit decision');
 const button=page.context.document.getElementById('rx-confirm');
 assert(page.context.document.getElementById('modal').innerHTML.includes('rx-confirm'),'exact result confirmation opened');
 assert(button.disabled,'undecoded media cannot confirm: '+JSON.stringify(args)+' '+page.context.document.getElementById('modal').innerHTML);dom.load();assert.equal(button.disabled,false,'saved context and loaded exact media enable confirmation');
 await page.gesture.act(()=>page.context.CineBraidResultDecisions.confirm());
 assert(store.writes()>before,'confirmation must persist a successor, not return early');
 const [id,name,kind,frameId]=args,target={kind:kind==='frame'?'shot-frame':kind==='motion'?'shot-motion':'shot-delivery',shotId:id,...(kind==='frame'?{frameId}:{})};
 const receipt=require('../../public/shared-authority-kernel').currentHumanAuthority(store.stored(),target);
 assert(receipt&&receipt.value===name&&receipt.assetId,'stored authority must match the exact target, value and media identity');
 const local=vm.runInContext('currentHumanAuthority(P,'+JSON.stringify(target)+')',page.context);assert.equal(local.id,receipt.id,'client and acknowledged receipt identities agree');
 assert.equal(vm.runInContext('!!approvalSubmissionPending()',page.context),false,'acknowledged save completes the submission: '+vm.runInContext('JSON.stringify(approvalSubmissionPending())',page.context));
}
module.exports={memoryStore,confirmationDOM,confirmDecision};
