/* EV2-3 discovery is a pure read model. It never creates identity or authority. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CineBraidMediaDiscovery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const arr=v=>Array.isArray(v)?v:[], val=v=>v?.state==='known'?String(v.value??''):'', unique=xs=>[...new Set(xs.filter(Boolean))];
  const decisions={approved:'Approved',candidate:'Candidate',rejected:'Rejected',historic:'Historic selection'};
  const sources={generated:'Generated',uploaded:'Uploaded',imported:'Imported'};
  function defaults(selector=false){return {query:'',decision:selector?'all':'current',type:'all',related:'all',availability:'all',source:'all',sort:'recent',group:'none',view:'grid',page:0,selected:'',showUnavailable:!selector,showRejected:false};}
  function relationship(use,project){
    const c=use.context||{}, related=[], sceneIds=[];
    const add=(type,id,label)=>{type=({character:'characters',location:'locations',prop:'props',vehicle:'vehicles',audio:'audio'})[type]||type;if(id)related.push({key:type+':'+id,type,id,label:label||id});};
    const shot=arr(project.shots).find(s=>s.id===val(c.shotId));
    if(shot){add('shot',shot.id,[shot.id,shot.title].filter(Boolean).join(' · '));if(shot.scene)sceneIds.push(shot.scene);}
    const entityList=val(c.entityList),entity=arr(project[entityList]).find(e=>e.id===val(c.entityId));
    if(entity){add(entityList,entity.id,entity.name||entity.id);const state=arr(entity.continuityStates).find(s=>s.id===val(c.stateId));if(state)add('state',entityList+':'+entity.id+':'+state.id,(entity.name||entity.id)+' · '+(state.name||state.id));}
    for(const link of arr(c.links)){
      const type=val(link.targetType),id=val(link.targetId),list={character:'characters',location:'locations',prop:'props',vehicle:'vehicles',shot:'shots',scene:'scenes',audio:'audio'}[type];
      const target=arr(project[list]).find(e=>String(e.id)===id);add(type,id,target?.name||target?.title||id);
      if(type==='scene')sceneIds.push(id);if(type==='shot'&&target?.scene)sceneIds.push(target.scene);
    }
    for(const id of unique(sceneIds)){const scene=arr(project.scenes).find(s=>s.id===id);add('scene',id,[id,scene?.title].filter(Boolean).join(' · '));}
    return {raw:use,related,sceneIds:unique(sceneIds),label:related.filter(r=>r.type!=='scene').map(r=>r.label).join(' · ')||'Project media',decision:use.disposition?.role||'candidate',decidable:arr(use.actions).some(a=>['approve','reject','restore'].includes(a)),candidateName:use.file?.name||'',context:c};
  }
  function compose(project={},records=[],inventory=[]){
    project=project||{};
    const byAsset=new Map(arr(inventory).map(i=>[i.assetId,i]));const result=[];
    for(const raw of records){
      const assetId=val(raw.identity?.ledger), item=byAsset.get(assetId);if(item)byAsset.delete(assetId);
      const uses=arr(raw.relationships).length?raw.relationships:[raw];const relationships=uses.map(u=>relationship(u,project));
      const relatedMap=new Map();relationships.forEach(u=>u.related.forEach(r=>relatedMap.set(r.key,r)));
      for(const link of arr(item?.links)){const u=relationship({context:{links:[{targetType:{state:'known',value:link.targetType},targetId:{state:'known',value:link.targetId}}]}},project);u.related.forEach(r=>relatedMap.set(r.key,r));}
      const preview=uses.find(u=>u.availability?.state==='available'&&u.file.url)||raw;
      const source=item?.source&&sources[item.source]?item.source:uses.map(u=>val(u.source)).find(s=>sources[s])||'unknown';
      const availability=item?.missing===true?'missing':typeof item?.available==='boolean'?(item.available?'available':/missing|not-found|absent/.test(item.reason||'')?'missing':'unavailable'):preview.availability?.state||(preview.file.url?'available':'unknown');
      const meaningful=relationships.filter(u=>u.raw.scope!=='project'&&u.raw.kind!=='shot-blocking');const roles=unique((meaningful.length?meaningful:relationships).map(u=>u.decision));
      result.push({key:raw.key,assetId,raw,relationships,related:[...relatedMap.values()],sceneIds:unique([...relatedMap.values()].filter(r=>r.type==='scene').map(r=>r.id)),
        sceneOrder:Math.min(...[...relatedMap.values()].filter(r=>r.type==='scene').map(r=>arr(project.scenes).findIndex(s=>s.id===r.id)).filter(n=>n>=0),Infinity),title:val(raw.file.title)||item?.title||raw.file.displayName||val(raw.file.originalName)||raw.file.name,fileName:item?.sourceName||val(raw.file.originalName)||raw.file.name,
        type:preview.file.mediaType||'document',url:availability==='available'?(item?.url||preview.file.url):'',availability,reason:item?.reason||preview.availability?.reason||'',
        source,addedAt:val(raw.file.addedAt)||item?.addedAt||'',roles,decision:roles.length===1?roles[0]:'mixed',needsDecision:availability==='available'&&meaningful.some(u=>u.decidable&&['candidate','historic'].includes(u.decision)),inventory:item||null});
    }
    for(const item of byAsset.values()){
      if(!/^asset-[a-f0-9]{32}$/.test(item.assetId||''))continue;
      const related=relationship({context:{links:arr(item.links).map(l=>({targetType:{state:'known',value:l.targetType},targetId:{state:'known',value:l.targetId}}))}},project);
      result.push({key:'asset:'+item.assetId,assetId:item.assetId,raw:null,relationships:[],related:related.related,sceneIds:related.sceneIds,title:item.title||item.sourceName||'Untitled media',fileName:item.sourceName||'',type:item.mediaType||'document',url:item.available?item.url:'',availability:item.available?'available':/missing|not-found|absent/.test(item.reason||'')?'missing':'unavailable',reason:item.reason||'',source:sources[item.source]?item.source:'unknown',addedAt:item.addedAt||'',roles:['candidate'],decision:'candidate',needsDecision:false,inventory:item});
    }
    return result;
  }
  function decisionLabel(row){return row.decision==='mixed'?'Different decisions by use':decisions[row.decision]||'Not recorded';}
  function rejectedFor(row,target){
    const relevant=row.relationships.filter(u=>val(u.context.entityList)===target?.list&&val(u.context.entityId)===target?.id&&(!val(u.context.stateId)||val(u.context.stateId)===target?.stateId));
    if(relevant.length)return relevant.some(u=>u.decision==='rejected');
    const meaningful=row.relationships.filter(u=>u.raw.scope!=='project'&&u.raw.kind!=='shot-blocking');return meaningful.length>0&&meaningful.every(u=>u.decision==='rejected');
  }
  function eligibility(row,target){if(!row)return 'This asset is no longer in this project.';if(!row.assetId)return 'Durable identity is not ready.';if(row.type!=='image')return 'This reference requires an image.';if(row.availability!=='available')return 'The exact original is '+row.availability+'.';if(rejectedFor(row,target))return 'Restore this rejected candidate in its owning workflow before reuse.';return '';}
  function matches(row,state,options={}){
    if(options.selector&&row.type!=='image')return false;
    if(options.selector&&!state.showUnavailable&&row.availability!=='available')return false;
    if(options.selector&&!state.showRejected&&rejectedFor(row,options.target))return false;
    const d=state.decision||'current';if(d==='current'&&row.roles.every(r=>r==='rejected'))return false;if(d==='needs'&&!row.needsDecision)return false;
    if(!['current','all','needs'].includes(d)&&!row.roles.includes(d))return false;
    if(state.type&&state.type!=='all'&&row.type!==state.type)return false;
    if(state.related&&state.related!=='all'&&(state.related==='unlinked'?row.related.length:!row.related.some(r=>r.key===state.related)))return false;
    if(state.availability&&state.availability!=='all'&&row.availability!==state.availability)return false;
    if(state.source&&state.source!=='all'&&row.source!==state.source)return false;
    const text=[row.title,row.fileName,row.assetId,...row.related.map(r=>r.label+' '+r.id)].join(' ').toLocaleLowerCase();
    return String(state.query||'').trim().toLocaleLowerCase().split(/\s+/).every(word=>text.includes(word));
  }
  function groupLabel(row,group){if(group==='type')return {image:'Images',video:'Video',audio:'Audio',document:'Documents & other'}[row.type]||'Documents & other';if(group==='decision')return decisionLabel(row);if(group==='scene')return row.sceneIds.length>1?'Shared across scenes':row.sceneIds.length?row.related.find(r=>r.type==='scene')?.label||row.sceneIds[0]:'No recorded scene';return '';}
  function query(records,state={},options={}){
    const all=records.filter(r=>matches(r,state,options));const sort=state.sort||'recent',group=state.group||'none';
    all.sort((a,b)=>{const g=group==='none'?0:groupLabel(a,group).localeCompare(groupLabel(b,group));if(g)return g;
      if(sort==='name')return a.title.localeCompare(b.title,undefined,{numeric:true})||a.key.localeCompare(b.key);
      if(sort==='production'){const scene=(a.sceneOrder??Infinity)-(b.sceneOrder??Infinity);if(scene)return scene;}
      return (a.addedAt&&b.addedAt?b.addedAt.localeCompare(a.addedAt):a.addedAt?-1:b.addedAt?1:0)||a.title.localeCompare(b.title,undefined,{numeric:true})||a.key.localeCompare(b.key);
    });
    const page=Math.min(Math.max(0,Number(state.page)||0),Math.max(0,Math.ceil(all.length/48)-1));return {all,rows:all.slice(page*48,(page+1)*48),total:all.length,page,pages:Math.ceil(all.length/48)};
  }
  return {defaults,compose,query,matches,groupLabel,decisionLabel,rejectedFor,eligibility,sources,val};
});
