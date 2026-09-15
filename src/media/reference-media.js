"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const Assets = require("./media-asset-service");
const {localFileAffordance} = require("./local-file-affordance");
const Shared = require("../../public/shared-reference-media");
const Owners = require("../../public/shared-entity-ownership");
const Slots = require("../../public/shared-entity-slots");
const Authority = require("../../public/shared-authority-kernel");
const IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const unavailable = (key, assetId, reason) => ({name:key, assetId:assetId || "", available:false, reason, url:""});
function resolver({projectsRoot, slug, project}) {
  const physical = Assets.resolvePhysicalProjectDir(projectsRoot,slug);
  let registry = {assets:[],readOnly:true};
  try { if (physical.ok) registry = Assets.readAssets(projectsRoot,slug); } catch { /* Preserve unavailable bindings; never guess from filenames. */ }
  const assets = registry.readOnly ? [] : registry.assets || [];
  const byId = new Map(assets.map(a => [a.assetId,a]));
  function asset(assetId, expected) {
    if (!/^asset-[a-f0-9]{32}$/.test(assetId || "")) return unavailable("",assetId,"invalid-asset-identity");
    const row = byId.get(assetId);
    if (!row) return unavailable("",assetId,"identity-not-in-project");
    const rel = String(row.storage?.path || "");
    if (!rel || /[\\:]/.test(rel) || rel.startsWith("/") || rel.split("/").some(x => !x || x === "." || x === "..")) return unavailable("",assetId,"outside-project");
    if (row.mediaType !== "image" || !IMAGE.test(rel)) return unavailable("",assetId,"incompatible-media");
    const located = localFileAffordance({projectsRoot,slug,key:"asset:"+assetId});
    if (located.state !== "available") return unavailable("",assetId,located.reason || located.state);
    const stat = fs.statSync(located.path);
    if ((Number.isFinite(row.storage.bytes) && row.storage.bytes !== stat.size) || (Number.isFinite(row.storage.mtimeMs) && Math.abs(row.storage.mtimeMs-stat.mtimeMs)>1)) return unavailable("",assetId,"identity-observation-stale");
    const identity = {bytes:stat.size,mtimeMs:stat.mtimeMs,contentHash:String(row.contentHash || "")};
    if (expected && (expected.bytes !== identity.bytes || Math.abs(expected.mtimeMs-identity.mtimeMs)>1 || (expected.contentHash && expected.contentHash !== identity.contentHash))) return unavailable("",assetId,"binding-identity-stale");
    return {available:true,assetId,name:path.basename(rel),sourceName:path.basename(rel),storagePath:rel,path:located.path,identity,
      url:"/api/references/image?project="+encodeURIComponent(slug)+"&assetId="+encodeURIComponent(assetId)};
  }
  function resolve(list, entity, key, expectedAssetId = "") {
    if (!Shared.dirs[list] || !entity || !key) return unavailable(key,expectedAssetId,"unknown-reference");
    const matches = (entity.candidateFiles || []).filter(r => Shared.keyOf(r) === key);
    if (matches.length > 1) return unavailable(key,expectedAssetId,"ambiguous-candidate");
    const candidate = matches[0], binding = candidate?.referenceBinding;
    if (binding) {
      const issue = Shared.bindingIssue(entity,list,candidate);
      if (issue) return unavailable(key,binding.assetId,issue);
      if (expectedAssetId && expectedAssetId !== binding.assetId) return unavailable(key,binding.assetId,"approval-identity-mismatch");
      const resolved = asset(binding.assetId,binding.identity);
      return {...resolved,name:key,bindingId:binding.id,stateId:binding.stateId,slotId:binding.slotId,
        url:resolved.available ? "/api/references/image?project="+encodeURIComponent(slug)+"&list="+encodeURIComponent(list)+"&id="+encodeURIComponent(entity.id)+"&key="+encodeURIComponent(key) : ""};
    }
    // A missing binding must never turn into a filename lookup.
    if (key.startsWith("ref-") || path.basename(key) !== key || /[\\/:]/.test(key)) return unavailable(key,expectedAssetId,"binding-missing");
    if (!Owners.entityOwnsMedia(Owners.buildEntityOwnerIndex(project,list),entity.id,key)) return unavailable(key,expectedAssetId,"ownership-unresolved");
    const rel = Shared.dirs[list]+"/"+key;
    const id = expectedAssetId || assets.find(a => a.storage?.path === rel && a.storage?.missing !== true)?.assetId;
    if (id) return {...asset(id),name:key};
    // Read-only legacy compatibility: never rewrite pointers or mint an identity on a read.
    const old = localFileAffordance({projectsRoot,slug,key:"path:"+rel});
    return old.state === "available" && IMAGE.test(rel)
      ? {name:key,sourceName:key,assetId:"",available:true,path:old.path,storagePath:rel,url:"/assets/"+rel.split("/").map(encodeURIComponent).join("/"),legacy:true}
      : unavailable(key,"",old.reason || old.state);
  }
  function listing(list, entity) {
    const names = Owners.entityClaimedFileNames(entity);
    return names.map(key => {
      const states = entity.continuityStates || [];
      const edge = states.find(s => s.approvedFile === key) || (entity.approvedFile === key ? entity : null);
      return resolve(list,entity,key,String(edge?.approvedAssetId || ""));
    });
  }
  function projection() {
    return Object.fromEntries(Object.keys(Shared.dirs).map(list => [list,Object.fromEntries((project[list] || []).map(e => [e.id,listing(list,e).map(({path:disk,...row}) => row)]))]));
  }
  function productionImages() {
    return assets.filter(a => a.mediaType === "image").map(a => {
      const found = asset(a.assetId), rel = a.storage?.path;
      const library = (project.mediaAssets || []).find(m => (m.storagePath || (m.file ? "media/"+m.file : "")) === rel);
      const {path:disk,...row} = found;
      return {...row,mediaType:a.mediaType,source:a.source,storagePath:rel,sourceName:found.sourceName || path.basename(rel || ""),title:library?.title || found.sourceName || path.basename(rel || ""),addedAt:library?.createdAt || "",links:library?.links || []};
    });
  }
  // Read-only inventory: retain ledger identity and verify the recorded local original. No hydration or writes.
  function inventory() {
    return assets.filter(a => !String(a.storage?.path || "").includes("/locked/")).map(a => {
      const rel=a.storage?.path || "", library=(project.mediaAssets || []).find(m => (m.storagePath || (m.file ? "media/"+m.file : "")) === rel);
      const located=a.storage?.missing===true?{state:'missing'}:localFileAffordance({projectsRoot,slug,key:'path:'+rel});
      if(located.state==='available'){const stat=fs.statSync(located.path);if((Number.isFinite(a.storage.bytes)&&a.storage.bytes!==stat.size)||(Number.isFinite(a.storage.mtimeMs)&&Math.abs(a.storage.mtimeMs-stat.mtimeMs)>1)){located.state='unavailable';located.reason='identity-observation-stale';}}
      return {assetId:a.assetId,storagePath:rel,source:a.source,mediaType:a.mediaType,scope:a.scope,
        missing:located.state==='missing'||a.storage?.missing===true,available:located.state==='available',reason:located.reason||located.state,
        url:located.state==='available'?'/assets/'+rel.split('/').map(encodeURIComponent).join('/'):'',
        sourceName:path.basename(rel),title:library?.title||path.basename(rel),addedAt:library?.createdAt||'',links:library?.links||[]};
    });
  }
  return {asset,resolve,listing,projection,productionImages,inventory};
}
function enroll({project,list,entityId,stateId,slotId,assetId,expectedIdentity,projectsRoot,slug,bindingId,at}) {
  const next = structuredClone(project), entity = (next[list] || []).find(e => e.id === entityId);
  if (!Shared.dirs[list] || !entity) throw Error("This reference is unavailable.");
  const slot = (entity.coverageSlots || []).find(s => s.id === slotId);
  if (!slot) throw Error("Choose an existing required view.");
  const r = resolver({project:next,projectsRoot,slug}).asset(assetId,expectedIdentity);
  if (!r.available) throw Error("This exact image is unavailable ("+r.reason+"). Nothing was enrolled.");
  const id = bindingId || "ref-"+crypto.randomUUID();
  const row = {stored:id,original:r.sourceName,addedAt:at,decision:"unreviewed",coverageJobType:"single-reference",targetStateId:stateId,targetCoverageSlotId:slotId,
    referenceBinding:{version:1,id,assetId,entityList:list,entityId,stateId,slotId,identity:r.identity}};
  const issue = Shared.bindingIssue(entity,list,row);
  if (issue) throw Error("The selected assignment is unavailable ("+issue+").");
  entity.candidateFiles = [...(entity.candidateFiles || []),row];
  const assigned = Slots.assignSlotReference(slot,{fileName:id,at,by:"human",via:"production-media-enrollment",owner:{project:next,list,entityId},stateId,assetId});
  if (!assigned.assigned) throw Error(assigned.message || assigned.reason);

  return {project:next,candidate:row};
}
function validateSuccessor({current,successor,projectsRoot,slug,canon}) {
  const r = resolver({project:successor,projectsRoot,slug});
  for (const list of Object.keys(Shared.dirs)) for (const entity of successor[list] || []) {
    const prior = (current[list] || []).find(e => e.id === entity.id);
    for (const row of entity.candidateFiles || []) {
      if (!row.referenceBinding) continue;
      const key = Shared.keyOf(row), old = (prior?.candidateFiles || []).find(c => Shared.keyOf(c) === key);
      if (old?.referenceBinding && JSON.stringify(old.referenceBinding) !== JSON.stringify(row.referenceBinding)) throw Error("A reference binding is immutable. Add a separate candidate for a different asset or assignment.");
      if (!old) {
        const found = r.resolve(list,entity,key);
        if (!found.available) throw Error("Reference candidate cannot resolve: "+found.reason);
      }
    }
    if (canon) {
      for (const state of [...(entity.continuityStates || []),{...entity,id:"state-default"}]) {
        const receipt = Authority.currentHumanAuthority(successor,{kind:"entity-state",list,entityId:entity.id,stateId:state.id});
        const previous = Authority.currentHumanAuthority(current,{kind:"entity-state",list,entityId:entity.id,stateId:state.id});
        if (receipt && receipt.id !== previous?.id && String(receipt.value || "").startsWith("ref-")) {
          const found = r.resolve(list,entity,receipt.value,receipt.assetId);
          if (!found.available || found.stateId !== state.id) throw Error("The approved reference is unavailable: "+(found.reason || "binding-state-mismatch"));
        }
      }
    }
  }
}
function resolveUrl({projectsRoot,slug,project,url}) {
  if (!String(url || "").startsWith("/api/references/image?")) return null;
  const query = new URL(url,"http://local").searchParams;
  if (query.get("project") !== slug) return unavailable("","","wrong-project");
  const physical = Assets.resolvePhysicalProjectDir(projectsRoot,slug);
  if (!physical.ok) return unavailable("","","outside-project");
  const p = project || JSON.parse(fs.readFileSync(path.join(physical.realDir,"project.json"),"utf8"));
  const r = resolver({projectsRoot,slug,project:p}), list=query.get("list"), id=query.get("id"), key=query.get("key");
  if (list || id || key) return r.resolve(list,(p[list] || []).find(e=>e.id===id),key);
  return r.asset(query.get("assetId"));
}
module.exports = {resolver,enroll,validateSuccessor,resolveUrl};
