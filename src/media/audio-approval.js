"use strict";
const fs = require("fs");
const crypto = require("crypto");
const Assets = require("./media-asset-service");
const {localFileAffordance} = require("./local-file-affordance");
const {hashMediaFile} = require("./media-hash");
const Authority = require("../../public/shared-authority-kernel");
const Coverage = require("../../public/shared-coverage");
const Owners = require("../../public/shared-entity-ownership");
// Match the existing manual-upload ceiling. Only a deliberately selected recording
// is read at approval. Read-side projections also verify only receipt-bound audio,
// with this same aggregate byte budget; they never approve or rewrite history.
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;
async function prepare({projectsRoot, slug, name}) {
  const storagePath = "audio/" + name;
  const unavailable = {status:"unavailable",reason:"audio-verification-unavailable",assetId:""};
  // Resolve physical containment and local availability before any byte read.
  if (localFileAffordance({projectsRoot,slug,key:"path:"+storagePath}).state !== "available") return unavailable;
  try {
    await Assets.verifyNow({projectsRoot,slug,paths:[storagePath],limit:1,maxBytes:MAX_AUDIO_BYTES});
    const ready = await Assets.prepareAssetIdentity({projectsRoot,slug,path:storagePath});
    return ready.status === "ready" && ready.contentHash ? ready : unavailable;
  } catch { return unavailable; }
}
function validateSuccessor({current, successor, projectsRoot, slug}) {
  const previous = new Map((current.productionAuthority?.receipts || []).map(row => [row.id, row]));
  const added = (successor.productionAuthority?.receipts || []).filter(row =>
    row.kind === "entity-state" && row.list === "audio" && row.status === "current"
    && JSON.stringify(previous.get(row.id)) !== JSON.stringify(row));
  if (!added.length) return;
  const registry = Assets.readAssets(projectsRoot, slug);
  const index = Owners.buildEntityOwnerIndex(successor, "audio");
  for (const receipt of added) {
    const entity = (successor.audio || []).find(row => row.id === receipt.entityId);
    const asset = !registry.readOnly && registry.assets.find(row => row.assetId === receipt.assetId);
    const fail = () => { throw Error("The selected recording changed or is unavailable. No audio approval was saved. Reload, listen to the recording again, and review it before approving."); };
    if (!Authority.currentHumanAuthority(successor, receipt)
      || !Coverage.audioArtifactMayHoldPrimaryAuthority(entity, receipt.value)
      || !Owners.entityOwnsMedia(index, receipt.entityId, receipt.value)
      || !asset || asset.mediaType !== "audio" || asset.storage?.missing
      || asset.storage?.path !== "audio/" + receipt.value || !/^sha256:[a-f0-9]{64}$/.test(asset.contentHash || "")) fail();
    const located = localFileAffordance({projectsRoot,slug,key:"asset:"+receipt.assetId});
    if (located.state !== "available") fail();
    const stat = fs.statSync(located.path);
    if (!stat.isFile() || stat.size > MAX_AUDIO_BYTES || stat.size !== asset.storage.bytes
      || Math.abs(stat.mtimeMs-asset.storage.mtimeMs)>1) fail();
    const digest = "sha256:" + hashMediaFile(located.path, {subject:"Audio approval confirmation"});
    const after = fs.statSync(located.path);
    if (digest !== asset.contentHash || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) fail();
  }
}
// A recorded decision and the continued availability of its original bytes are
// separate facts. Stat metadata (including preserved mtime) cannot prove the latter.
// This resolver is read-only: no ledger repair, receipt rewrite or replacement intake.
function resolver({projectsRoot, slug, project}) {
  let registry = {readOnly:true,assets:[]};
  try { registry = Assets.readAssets(projectsRoot,slug); } catch {}
  const index = Owners.buildEntityOwnerIndex(project,"audio");
  const receipts = (project.audio || []).flatMap(entity =>
    Authority.entityProductionTruth(project,"audio",entity.id).canon.map(row => ({...row,entityId:entity.id})));
  let budget = MAX_AUDIO_BYTES;
  const memo = new Map(); // This one projection only; never a stat-keyed cross-request cache.
  function resolve(receipt, keepBytes = false) {
    const unavailable = reason => ({available:false,url:"",assetId:receipt?.assetId || "",reason});
    const asset = !registry.readOnly && registry.assets.find(a => a.assetId === receipt?.assetId);
    if (!receipt || !Owners.entityOwnsMedia(index,receipt.entityId,receipt.value)
      || !asset || asset.mediaType !== "audio" || asset.storage?.missing
      || asset.storage?.path !== "audio/"+receipt.value || !/^sha256:[a-f0-9]{64}$/.test(asset.contentHash || "")) return unavailable("original-identity-unavailable");
    if (!keepBytes && memo.has(asset.assetId)) return memo.get(asset.assetId);
    let answer;
    try {
      const located = localFileAffordance({projectsRoot,slug,key:"asset:"+asset.assetId});
      if (located.state !== "available") return unavailable("original-media-unavailable");
      const stat = fs.statSync(located.path);
      if (!stat.isFile() || stat.size > budget) return unavailable("audio-verification-limit");
      if (stat.size !== asset.storage.bytes || Math.abs(stat.mtimeMs-asset.storage.mtimeMs)>1) return unavailable("original-recording-changed");
      budget -= stat.size;
      // The exact buffer that is verified is also the buffer a player receives.
      const bytes = fs.readFileSync(located.path);
      const digest = "sha256:"+crypto.createHash("sha256").update(bytes).digest("hex");
      const after = fs.statSync(located.path);
      if (bytes.length !== stat.size || digest !== asset.contentHash || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) return unavailable("original-recording-changed");
      answer = {available:true,assetId:asset.assetId,sourceName:receipt.value,
        url:"/assets/audio/"+encodeURIComponent(receipt.value)+"?audioAsset="+encodeURIComponent(asset.assetId)+"&project="+encodeURIComponent(slug)};
      if (keepBytes) return {...answer,bytes};
    } catch { answer = unavailable("original-media-unavailable"); }
    memo.set(asset.assetId,answer);
    return answer;
  }
  function decorate(rows) {
    const all = new Map(rows.map(row => [row.name,row]));
    for (const receipt of receipts) if (!all.has(receipt.value)) all.set(receipt.value,{name:receipt.value,url:""});
    return [...all.values()].map(row => {
      const recorded = receipts.filter(r => r.value === row.name);
      if (!recorded.length) return row;
      const approvals = recorded.map(r => ({...r,...resolve(r)}));
      const available = approvals.every(a => a.available && a.assetId === approvals[0].assetId);
      return {...row,available,assetId:approvals[0].assetId,url:available ? approvals[0].url : "",approvedAudio:approvals};
    });
  }
  return {receipts,resolve,decorate};
}
module.exports = {prepare, validateSuccessor, resolver, MAX_AUDIO_BYTES};
