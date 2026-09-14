"use strict";
const assert=require("assert/strict"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const {disposableRoot}=require("./helpers/disposable-root");
const Assets=require("../src/media/media-assets"),Store=require("../src/media/media-asset-store");
const Reference=require("../src/media/reference-media"),Shared=require("../public/shared-reference-media"),Disposition=require("../public/shared-media-disposition");
const Authority=require("../public/shared-authority-kernel"),{installTestManualActionSource}=require("./authority-test-gesture");
const gesture=installTestManualActionSource(Authority);
const w=disposableRoot("reference-enrollment",{register:false});let checks=0;
function check(label,body){body();checks++;console.log("PASS "+label);}
const entity=id=>({id,name:id,coverageSlots:[{id:"front",label:"Front",requirement:"required"},{id:"side",label:"Side",requirement:"required"}],continuityStates:[{id:"state-default",name:"Clean",isDefault:true},{id:"weathered",name:"Weathered"}],candidateFiles:[]});
let project={meta:{id:"film-a"},props:[entity("tool"),entity("other-tool")],locations:[],characters:[],vehicles:[],mediaAssets:[{id:"library-a",file:"source.png",links:[{targetType:"prop",targetId:"tool"}]}]};
const slug="film-a",dir=path.join(w.projectsRoot,slug);fs.mkdirSync(path.join(dir,"media"),{recursive:true});fs.mkdirSync(path.join(dir,"props"));
fs.writeFileSync(path.join(dir,"project.json"),JSON.stringify(project));
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=","base64");
function record(file,type="image") {fs.writeFileSync(path.join(dir,file),png);const st=fs.statSync(path.join(dir,file));return {assetId:Assets.mintAssetId(),contentHash:null,hashState:"unhashed",scope:{},mediaType:type,role:"import",source:"imported",lifecycle:"candidate",storage:{path:file,bytes:st.size,mtimeMs:st.mtimeMs},legacy:{},indexedAt:"2026-09-14T00:00:00Z"};}
const image=record("media/source.png"),side=record("media/side.png"),legacy=record("props/old.png"),video=record("media/movie.png","video");
const ledger={schemaVersion:Assets.MEDIA_ASSETS_SCHEMA_VERSION,assets:[image,side,legacy,video]};Store.writeLedgerSync(dir,ledger);
const opts=()=>({projectsRoot:w.projectsRoot,slug,project});
const resolve=()=>Reference.resolver(opts());
const sourceBefore=fs.readFileSync(path.join(dir,"media/source.png")),pathsBefore=fs.readdirSync(path.join(dir,"media"));
check("a Media Library link alone does not enroll or fill coverage",()=>{assert.equal(resolve().listing("props",project.props[0]).length,0);assert.equal(Shared.coverage(project.props[0],[],"state-default").filled,0);});
const baseline=JSON.stringify(project),fixed="ref-11111111-1111-4111-8111-111111111111",at="2026-09-14T01:00:00Z";
const request={...opts(),list:"props",entityId:"tool",stateId:"state-default",slotId:"front",assetId:image.assetId,expectedIdentity:resolve().asset(image.assetId).identity,bindingId:fixed,at};
const first=Reference.enroll(request);
check("planning enrollment leaves its input unchanged",()=>assert.equal(JSON.stringify(project),baseline));
check("same deterministic inputs produce identical successor",()=>assert.deepEqual(Reference.enroll(request),first));
project=first.project;
check("enrollment preserves source path, bytes and media file count",()=>{assert.deepEqual(fs.readdirSync(path.join(dir,"media")),pathsBefore);assert.deepEqual(fs.readFileSync(path.join(dir,"media/source.png")),sourceBefore);assert.equal(fs.existsSync(path.join(dir,"props/source.png")),false);assert.equal(project.props[0].candidateFiles[0].referenceBinding.assetId,image.assetId);});
check("enrollment creates coverage and no human authority",()=>{assert.equal(Shared.coverage(project.props[0],resolve().listing("props",project.props[0]),"state-default").filled,1);assert.equal(Authority.hasCurrentHumanAuthority(project,{kind:"entity-state",list:"props",entityId:"tool",stateId:"state-default"}),false);assert.equal(project.productionAuthority,undefined);});
check("second state remains unfilled",()=>assert.equal(Shared.coverage(project.props[0],resolve().listing("props",project.props[0]),"weathered").filled,0));
const second=Reference.enroll({...request,project,assetId:side.assetId,expectedIdentity:resolve().asset(side.assetId).identity,slotId:"side",bindingId:"ref-22222222-2222-4222-8222-222222222222"});project=second.project;
check("independent views resolve their exact selected assets",()=>{assert.equal(Shared.coverage(project.props[0],resolve().listing("props",project.props[0]),"state-default").filled,2);assert.equal(resolve().resolve("props",project.props[0],second.candidate.stored).assetId,side.assetId);});
const third=Reference.enroll({...request,project,entityId:"other-tool",bindingId:"ref-33333333-3333-4333-8333-333333333333"});project=third.project;
check("one physical image supports distinct explicit reference bindings",()=>{assert.equal(resolve().resolve("props",project.props[0],fixed).available,true);assert.equal(resolve().resolve("props",project.props[1],third.candidate.stored).available,true);});
check("another relationship of the same asset is never substituted",()=>assert.equal(Disposition.resolveApprovalMedia({file:"ref-missing",assetId:image.assetId},resolve().listing("props",project.props[1])),null));
check("unknown identities, traversal and incompatible media fail closed",()=>{for(const id of ["../media/source.png","asset-"+"f".repeat(32),video.assetId])assert.equal(resolve().asset(id).available,false);for(const key of ["../source.png","C:/source.png","ref-missing"])assert.equal(resolve().resolve("props",project.props[0],key).available,false);});
const foreign=path.join(w.projectsRoot,"film-b");fs.mkdirSync(foreign);fs.mkdirSync(path.join(foreign,"media"));fs.writeFileSync(path.join(foreign,"media/source.png"),png);fs.writeFileSync(path.join(foreign,"project.json"),JSON.stringify(project));Store.writeLedgerSync(foreign,{schemaVersion:Assets.MEDIA_ASSETS_SCHEMA_VERSION,assets:[]});
check("an identity from another project cannot resolve",()=>assert.equal(Reference.resolver({projectsRoot:w.projectsRoot,slug:"film-b",project}).asset(image.assetId).available,false));
check("a malformed binding retains its identity and cannot resolve",()=>{const bad=structuredClone(project);bad.props[0].candidateFiles[0].referenceBinding.entityId="another";const m=Reference.resolver({...opts(),project:bad}).resolve("props",bad.props[0],fixed);assert.equal(m.available,false);assert.equal(m.assetId,image.assetId);});
fs.writeFileSync(path.join(dir,"project.json"),JSON.stringify(project));
check("downstream URL resolution receives the enrolled source file",()=>{const item=resolve().resolve("props",project.props[0],fixed);assert.equal(Reference.resolveUrl({...opts(),url:item.url}).path,path.join(dir,"media/source.png"));assert.equal(Reference.resolveUrl({...opts(),slug:"film-b",url:item.url}).available,false);});
for (const [file,name,next] of [["../src/generation/fal/fal-generation.js","localAssetFile","mimeFor"],["../src/generation/comfyui/comfy-generation.js","resolveOwnedMedia",""]]) {
  const absolute=require.resolve(file), source=fs.readFileSync(absolute,"utf8"),start=source.indexOf("function "+name+"(");
  let end=next?source.indexOf("function "+next+"(",start):source.indexOf("const MIME_BY_EXT",start+10);
  const fn=require("vm").runInNewContext("("+source.slice(start,end).trim()+")",{require:require("module").createRequire(absolute),path,text:v=>String(v||"")});
  check(name+" downstream adapter loads exact binding and refuses cross-project",()=>{
    const url=resolve().resolve("props",project.props[0],fixed).url;
    assert.equal(fn({dir},url),path.join(dir,"media/source.png"));
    assert.throws(()=>fn({dir:foreign},url),/unavailable/);
  });
}
check("repeated discovery and inspection do not change project data",()=>{const before=JSON.stringify(project);for(let i=0;i<3;i++){resolve().projection();resolve().productionImages();}assert.equal(JSON.stringify(project),before);});
project.props[0].candidateFiles.push({stored:"old.png",coverageJobType:"single-reference"});
check("folder-backed candidates remain readable without migration",()=>assert.equal(resolve().resolve("props",project.props[0],"old.png").assetId,legacy.assetId));
check("existing writer accepts explicit human approval of the binding",()=>{gesture.gesture(()=>Authority.approveEntityStateCanon(project,{list:"props",entityId:"tool",stateId:"state-default",value:fixed,assetId:image.assetId,at,via:"test"}));assert.equal(Authority.hasCurrentHumanAuthority(project,{kind:"entity-state",list:"props",entityId:"tool",stateId:"state-default"}),true);assert.equal(resolve().resolve("props",project.props[0],fixed,image.assetId).available,true);});
const approved=structuredClone(project);
check("an approval for the wrong asset identity cannot resolve",()=>assert.equal(resolve().resolve("props",project.props[0],fixed,side.assetId).available,false));
fs.renameSync(path.join(dir,"media/source.png"),path.join(dir,"media/source-missing.png"));
check("missing bound image does not fill coverage or resolve downstream",()=>{const r=resolve();assert.equal(r.resolve("props",project.props[0],fixed).available,false);assert.equal(Shared.coverage(project.props[0],r.listing("props",project.props[0]),"state-default").filled,1);});
check("missing image cannot pass the server approval transition check",()=>{const current=structuredClone(approved);current.productionAuthority={version:1,receipts:[]};assert.throws(()=>Reference.validateSuccessor({current,successor:approved,projectsRoot:w.projectsRoot,slug,canon:true}),/unavailable/);});
fs.renameSync(path.join(dir,"media/source-missing.png"),path.join(dir,"media/source.png"));fs.appendFileSync(path.join(dir,"media/source.png"),"replacement");
check("changed bytes reject stale selection, not a same-name replacement",()=>{assert.equal(resolve().resolve("props",project.props[0],fixed).available,false);assert.throws(()=>Reference.enroll({...request,project}),/unavailable/);});
check("existing bound identity cannot be retargeted through normal save",()=>{const bad=structuredClone(project);bad.props[0].candidateFiles[0].referenceBinding.assetId=side.assetId;assert.throws(()=>Reference.validateSuccessor({current:project,successor:bad,projectsRoot:w.projectsRoot,slug}),/immutable/);});
check("a state/view map cannot substitute a binding from another assignment",()=>{
  const bad=structuredClone(project),slot=bad.props[0].coverageSlots[0];slot.referenceBindings.weathered=fixed;
  assert.equal(Shared.selectedKey(bad.props[0],slot,"weathered"),"");
});
check("a media junction into another project cannot resolve",()=>{
  const redirect=path.join(dir,"media/redirect");fs.symlinkSync(path.join(foreign,"media"),redirect,"junction");
  const redirected={...image,assetId:Assets.mintAssetId(),storage:{path:"media/redirect/source.png"}};
  Store.writeLedgerSync(dir,{...ledger,assets:[...ledger.assets,redirected]});
  assert.equal(resolve().asset(redirected.assetId).available,false);
});
check("unchanged unavailable bindings and receipts survive ordinary saves",()=>{Reference.validateSuccessor({current:project,successor:structuredClone(project),projectsRoot:w.projectsRoot,slug,canon:false});assert.deepEqual(project.productionAuthority,approved.productionAuthority);});
console.log(checks+" reference enrollment contract checks passed; disposable fixture: "+w.home);
