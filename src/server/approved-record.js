/* EV2-4 audience projection. Read current authority; never create or repair it.
   This is an allowlist, including inside targets. Working prose and generation
   packages are intentionally outside the viewer's audience. */
'use strict';
const Authority = require('../../public/shared-production-authority');
const arr = v => Array.isArray(v) ? v : [];
const str = v => typeof v === 'string' ? v : '';
const lists = ['characters','locations','props','vehicles','audio'];
function approvedRecord(project, options = {}) {
  const target = (receipt, label, media) => {
    if (!receipt) return null;
    const url = media?.available !== false && /^\/assets\//.test(media?.url || '') ? media.url : '';
    return {label:str(label), receiptId:str(receipt.id || receipt.receiptId), at:str(receipt.at),
      value:str(receipt.value), assetId:str(receipt.assetId),
      media:{url, available:!!url, type:/\.(mp4|webm|mov)$/i.test(media?.sourceName || receipt.value)?'video':/\.(mp3|wav|ogg|m4a|flac)$/i.test(media?.sourceName || receipt.value)?'audio':'image'}};
  };
  const entities = [];
  for (const list of lists) for (const entity of arr(project[list])) {
    const states = arr(Authority.entityProductionTruth(project,list,entity.id).canon).map(row => {
      const name=arr(entity.continuityStates).find(s=>s.id===row.stateId)?.name || (row.stateId==='state-default'?'Default':row.stateId);
      return {id:str(row.stateId),...target(row,name,options.entityMedia?.(list,entity,row))};
    });
    if(states.length) entities.push({list,id:str(entity.id),name:str(entity.name)||str(entity.id),targets:states});
  }
  const shots = [];
  for (const shot of arr(project.shots)) {
    const targets = [];
    const add = (t,label,id) => {
      const receipt = Authority.currentHumanAuthority(project,t);
      if(receipt) targets.push({id:str(id),kind:str(t.kind),...target(receipt,label,options.shotMedia?.(shot,receipt))});
    };
    arr(shot.keyframes).forEach((f,i)=>add({kind:'shot-frame',shotId:shot.id,frameId:f.id||`frame-${i+1}`},'Frame '+(f.label||String.fromCharCode(65+i)),f.id||`frame-${i+1}`));
    arr(shot.clips).forEach((c,i)=>{if(c.id||c.suffix)add({kind:'shot-motion',shotId:shot.id,unitKey:c.id||c.suffix},'Motion '+(c.label||c.suffix||String.fromCharCode(65+i)),c.id||c.suffix);});
    add({kind:'shot-delivery',shotId:shot.id},'Deliverable','delivery');
    for (const placement of arr(shot.soundPlacements)) {
      const entity = arr(project.audio).find(row => row.id === placement?.audioEntityId);
      const receipt = entity && arr(Authority.entityProductionTruth(project,'audio',entity.id).canon)
        .find(row => (row.id || row.receiptId) === placement.receiptId
          && row.assetId === placement.assetId && row.value === placement.sourceName);
      if (!receipt || !['dialogue','ambience','music','effect'].includes(placement.role)
        || !['from-start','throughout','at-cue'].includes(placement.timing)
        || (placement.timing === 'at-cue' && !str(placement.cue).trim())) continue;
      targets.push({id:str(placement.id),kind:'shot-sound-placement',
        ...target(receipt,'Sound · '+placement.role,options.placedAudio?.(entity,receipt)),
        placement:{audioEntityId:str(entity.id),audioEntityName:str(entity.name)||str(entity.id),
          receiptId:str(placement.receiptId),assetId:str(placement.assetId),
          role:str(placement.role),timing:str(placement.timing),cue:str(placement.cue)}});
    }
    if(targets.length) shots.push({id:str(shot.id),name:str(shot.title)||str(shot.id),scene:str(arr(project.scenes).find(s=>s.id===shot.scene)?.title)||str(shot.scene),targets});
  }
  return {audience:'approved-record',title:str(project.meta?.title),format:str(project.meta?.format),entities,shots};
}
function markdown(doc) {
  const text = v=>str(v).replace(/[\r\n]+/g,' ').replace(/[\\`*_{}\[\]<>#]/g,'\\$&');
  const lines=['# '+text(doc.title || 'Untitled project'),'','Approved record','', 'Current receipt-backed targets. Labels identify material; they are not approvals of creative prose.',''];
  for(const row of [...doc.entities,...doc.shots]){
    lines.push('## '+text(row.name)+' · '+text(row.id),'');
    for(const t of row.targets){
      lines.push('- **'+(t.media.type==='audio'&&!t.media.available?'Approval history — original recording unavailable':t.placement?'Placed approved recording':'Approved')+'** · '+text(t.label)+' · '+text(t.value), '  Receipt: '+text(t.receiptId)+' · '+text(t.at),'  Media: '+(t.media.available?'Available locally':'Unavailable — approval remains recorded'));
      if(t.placement)lines.push('  Asset: '+text(t.assetId),'  Audio item: '+text(t.placement.audioEntityName)+' · '+text(t.placement.audioEntityId),'  Sound role: '+text(t.placement.role),'  Timing: '+text(t.placement.timing)+(t.placement.cue?' · '+text(t.placement.cue):''));
      lines.push('');
    }
  }
  if(!doc.entities.length&&!doc.shots.length)lines.push('No current approved material.');
  return lines.join('\n')+'\n';
}
/* Supporting material is deliberately a complete working-source copy, not an
   approval publication. JSON preserves long text, nested drafts and provenance
   without silently truncating the old appendix. It is served only to editors. */
function supportingExport(project){return JSON.stringify({audience:'editor-working-material',notice:'Working material export. Includes unapproved material; this is not an approval record.',project},null,2)+'\n';}
module.exports={approvedRecord,markdown,supportingExport};
