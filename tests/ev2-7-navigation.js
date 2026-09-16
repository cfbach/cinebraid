/* Focused behavioral checks for the ephemeral route coordinator; no app/config IO. */
'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const events={},controls=new Map();let focused=null,scroll=[0,0],restored=null,renderCount=0;
const main={scrollTop:137,prepend(el){controls.set('return',el);},querySelector(){return null;},querySelectorAll(){return [...controls.values()].filter(x=>x!==controls.get('return'));}};
const opener={id:'open-results',getAttribute(){return null;},focus(){focused=this;}};controls.set(opener.id,opener);
const document={activeElement:opener,getElementById(id){return id==='main'?main:controls.get(id)},querySelector(s){return s==='[data-media-return]'?controls.get('return'):null},querySelectorAll(s){return s==='[data-media-return]'&&controls.has('return')?[controls.get('return')]:[]},createElement(){return {dataset:{},remove(){controls.delete('return')}}},addEventListener(n,f){(events['doc:'+n]??=[]).push(f)}};
const context={document,location:{hash:'#/shot/SH-A'},ACTIVE_PROJECT_SLUG:'synthetic',PROJECT_OPEN_EPOCH:1,URL,shotById:id=>({id,title:'The signal'}),requestAnimationFrame:f=>f(),captureRouteViewState:()=>({routeKey:context.location.hash,selector:'#open-results',windowY:263}),restoreRouteViewState:s=>{restored=s;scroll=[0,s.windowY]},closeModal(){},route(){renderCount++},console};
context.window=context;context.scrollX=0;context.scrollY=263;context.scrollTo=(x,y)=>scroll=[x,y];context.addEventListener=(n,f)=>(events[n]??=[]).push(f);vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../public/media-return.js'),'utf8'),context);
const api=context.CineBraidMediaReturn,emit=(n,x={})=>(events[n]||[]).forEach(f=>f(x)),render=()=>emit('cinebraid:route-rendered');
render();const shot=api.capture();api.go('#/shot/SH-A/results/frame/A/key',shot);render();assert.equal(controls.get('return').textContent,'Return to SH-A · The signal');
const results=api.capture({label:'Return to Results'});api.go('#/character/MARA',results);render();assert.equal(controls.get('return').textContent,'Return to Results');api.back();render();assert.equal(context.location.hash,results.hash);assert.equal(focused,opener);assert.equal(restored.routeKey,results.hash);assert.equal(scroll[1],263);assert.equal(controls.get('return').textContent,'Return to SH-A · The signal');api.back();render();assert.equal(context.location.hash,shot.hash);assert(!api.hasOrigin());
// Same-target result keys do not destroy the opener; other scopes cannot reuse it.
api.go('#/shot/SH-A/results/frame/A/one',api.capture());context.location.hash='#/shot/SH-A/results/frame/A/two';render();assert(api.hasOrigin());context.PROJECT_OPEN_EPOCH=2;render();assert(!api.hasOrigin());assert(!api.go('#/shot/SH-B',shot));
// Explicit global navigation clears even before its route changes.
api.go('#/character/MARA',api.capture());render();emit('doc:click',{target:{closest(){return {closest:()=>true,matches:()=>false}}}});assert(!api.hasOrigin());
// Unknown/unrelated navigation never manufactures a return; no production writer exists here.
context.location.hash='#/settings/project';emit('hashchange',{oldURL:'http://fixture/#/production',newURL:'http://fixture/#/settings/project'});render();assert(!controls.has('return'));
console.log('PASS ev2-7 navigation: nested exact return, complete snapshot restoration, key scope, project epoch and global navigation.');
