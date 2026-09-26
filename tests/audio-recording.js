"use strict";
const assert = require('assert');
const Coverage = require('../public/shared-coverage');
const Kernel = require('../public/shared-authority-kernel');
const {installTestManualActionSource} = require('./authority-test-gesture');
const manual = installTestManualActionSource(Kernel);
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const entity = (id, rows = []) => ({id, name:id, candidateFiles:rows, continuityStates:[{id:'state-default',name:'Default',isDefault:true}]});
const project = (row = {stored:'recording.wav',mediaKind:'audio'}) => ({audio:[entity('A',[row]),entity('B')],props:[],shots:[]});
const request = {list:'audio',entityId:'A',stateId:'state-default',value:'recording.wav',assetId:'asset-11111111111111111111111111111111',at:'2026-09-25T12:00:00.000Z'};
const approve = (p, extra = {}) => manual.gesture(()=>Kernel.approveEntityStateCanon(p,{...request,...extra}));
let p = project();approve(p);
check(Kernel.currentHumanAuthority(p,{kind:'entity-state',...request})?.assetId === request.assetId,'audio approval keeps the exact asset identity');
for (const row of [
 {stored:'recording.wav'},
 {stored:'recording.wav',coverageJobType:'single-reference'},
 {stored:'recording.wav',mediaKind:'audio',coverageJobType:'sheet'},
 {stored:'recording.wav',mediaKind:'image'},
 {stored:'other.wav',original:'recording.wav',mediaKind:'audio'},
]) {
 p=project(row);const before=JSON.stringify(p);
 assert.throws(()=>approve(p));check(JSON.stringify(p)===before,'refused declaration never changes authority');
}
p=project();const before=JSON.stringify(p);assert.throws(()=>approve(p,{entityId:'B'}));check(JSON.stringify(p)===before,'another audio item cannot approve this candidate');
p=project();p.audio[1].candidateFiles.push({...p.audio[0].candidateFiles[0]});assert.throws(()=>approve(p));check(!p.productionAuthority,'contested audio ownership refuses');
p=project();assert.throws(()=>Kernel.approveEntityStateCanon(p,request));check(!p.productionAuthority,'scripted call without a trusted gesture refuses');
check(!Coverage.audioArtifactMayHoldPrimaryAuthority(entity('A',[{stored:'image.png',mediaKind:'audio'}]),'image.png'),'image cannot masquerade as a recording');
check(Coverage.referenceArtifactStructure({mediaKind:'audio',coverageJobType:'single-reference'})==='undeclared','audio cannot become visual authority even with conflicting image metadata');
p={props:[entity('A',[{stored:'recording.wav',mediaKind:'audio',coverageJobType:'single-reference'}])]};assert.throws(()=>approve(p,{list:'props'}));check(!p.productionAuthority,'visual authority boundary refuses an audio declaration');
console.log(`Audio recording policy: ${checks} checks passed; provider calls: 0.`);
