/* EV2-3 discovery is a pure read model. It never creates identity or authority. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CineBraidMediaDiscovery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const arr=v=>Array.isArray(v)?v:[], val=v=>v?.state==='known'?String(v.value??''):'', unique=xs=>[...new Set(xs.filter(Boolean))];
  const decisions={approved:'Approved',selected:'Selected for a view',candidate:'Candidate',rejected:'Rejected',historic:'Historic selection'};
  /* EV2-7 presentation word only. A coverage or expression slot edge maps to no authority target, so the projection always reads it as `historic`.
     When EVERY target of a use is such a slot, what is recorded is a current view selection, and it is labelled so. Disposition, receipts and authority are unchanged. */
  const SLOT_EDGE_KINDS=['coverage','expression'];
  function slotSelection(use){const d=use?.disposition,targets=arr(d?.targets);return d?.role==='historic'&&targets.length>0&&targets.every(t=>SLOT_EDGE_KINDS.includes(String(t?.kind||'')))?unique(targets.map(t=>String(t.label||t.id||''))):null;}
  const sources={generated:'Generated',uploaded:'Uploaded',imported:'Imported'};
  const types={image:'Image',video:'Video',audio:'Audio',document:'Document & other'};
  /* EV2-7 production categories. Derived per recorded use at read time from kind, owning list, link role/target and the ledger's directory-proven role. Never from filenames, titles or folder-name strings, never persisted, and never an input to decision. */
  const CATEGORIES=[['all','All'],['shot-renders','Shot renders'],['characters','Characters'],['locations','Locations'],['props','Props'],['vehicles','Vehicles'],['blocking-previs','Blocking & previs'],['audio','Audio'],['other','Other']];
  const ORDER=CATEGORIES.slice(1).map(c=>c[0]), ENTITY_CATEGORIES=['characters','locations','props','vehicles'];
  const ENTITY_CATEGORY={characters:'characters',locations:'locations',props:'props',vehicles:'vehicles',audio:'audio'};
  const LINK_TARGET_CATEGORY={character:'characters',location:'locations',prop:'props',vehicle:'vehicles'};
  const BLOCKING_ROLES=['blocking-frame','storyboard','animatic-frame'], AUDIO_ROLES=['audio-reference','sound-reference'];
  const LEDGER_AUDIO_ROLES=['dialogue','voice','sfx','foley','ambience','music','room-tone','temp-reference','native-generated-audio'], LEDGER_ENTITY_ROLES=['entity-reference','coverage-sheet','coverage-crop','expression-reference','continuity-state-reference'], LEDGER_ENTITY_DIRS={anchors:'characters',plates:'locations',props:'props',vehicles:'vehicles'};
  function linkCategory(link){const role=val(link.role),type=val(link.targetType);if(role==='do-not-use')return '';if(BLOCKING_ROLES.includes(role))return 'blocking-previs';if(AUDIO_ROLES.includes(role)||type==='audio')return 'audio';return LINK_TARGET_CATEGORY[type]||'';}
  function useCategories(use){const k=use.kind;if(k==='shot-still'||k==='shot-motion')return ['shot-renders'];if(k==='shot-blocking')return ['blocking-previs'];if(k==='entity-reference'){const c=ENTITY_CATEGORY[val(use.context?.entityList)];return c?[c]:[];}return unique(arr(use.context?.links).map(linkCategory));}
  /* Category only: a ledger role never reaches decision, lifecycle or an approved appearance. */
  function ledgerRoleCategory(item){const role=String(item?.ledgerRole||'');if(role==='blocking-guide')return 'blocking-previs';if(/^(frame|motion)-/.test(role))return 'shot-renders';if(LEDGER_AUDIO_ROLES.includes(role))return 'audio';if(LEDGER_ENTITY_ROLES.includes(role))return LEDGER_ENTITY_DIRS[String(item?.scope?.entityList||'')]||'';return '';}
  const sortCats=xs=>unique(xs).sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b));
  function categoryLabel(token){return (CATEGORIES.find(c=>c[0]===token&&token!=='all')||[,'Other'])[1];}
  function typeLabel(type){return types[type]||types.document;}
  const wrapLink=l=>({targetType:{state:'known',value:l.targetType},targetId:{state:'known',value:l.targetId},role:{state:'known',value:l.role}});
  /* A human headline from the recorded owner. Identity routing never reads it. */
  function ownerTitle(use,project={}){
    const c=use?.context||{},list=val(c.entityList);
    if(use?.kind==='entity-reference'){const entity=arr(project?.[list]).find(e=>e.id===val(c.entityId)),state=arr(entity?.continuityStates).find(s=>s.id===val(c.stateId));return [val(c.entityName)||entity?.name||val(c.entityId),state?(state.name||state.id):''].filter(Boolean).join(' · ');}
    if(/^shot-/.test(use?.kind||'')&&val(c.shotId))return [val(c.shotId),use.kind==='shot-motion'?'Motion':use.kind==='shot-blocking'?'Blocking':val(c.frameLabel)?'Frame '+val(c.frameLabel):''].filter(Boolean).join(' · ');
    return '';
  }
  function untitled(type){return 'Untitled '+({image:'image',video:'video',audio:'audio'}[type]||'media');}
  /* A title is recorded only when a person gave one. The upload path writes the uploaded file's stem as the library title, so a title equal
     (case-insensitive, extension-stripped) to any recorded filename is a filename, never a headline. */
  const nameForms=n=>{const b=String(n||'').split(/[\\/]/).pop().trim().toLocaleLowerCase();return b?[b,b.replace(/\.[^.]+$/,'')]:[];};
  function recordedTitle(title,names){const t=String(title||'').trim(),k=t.toLocaleLowerCase();if(!t)return '';const forms=arr(names).flatMap(nameForms);return forms.includes(k)||forms.includes(k.replace(/\.[^.]+$/,''))?'':t;}
  /* A headline from the first recorded library link: its target and role, e.g. "SH010 · Planning reference". */
  function linkTitle(links,project={}){for(const l of arr(links)){const type=String(l?.targetType||''),id=String(l?.targetId||'');if(!id)continue;const list={character:'characters',location:'locations',prop:'props',vehicle:'vehicles'}[type],target=list&&arr(project?.[list]).find(e=>String(e.id)===id),role=String(l.role||'').replace(/-/g,' ').trim();return [target?.name||id,role?role[0].toLocaleUpperCase()+role.slice(1):''].filter(Boolean).join(' · ');}return '';}
  const plainLink=l=>({targetType:val(l.targetType),targetId:val(l.targetId),role:val(l.role)});
  /* EV2-7 — a coverage target's own category. The picker opens on the list the target belongs to; the filmmaker can still choose All or any other category. */
  function targetCategory(target){return ENTITY_CATEGORY[String(target?.list||'')]||'all';}
  /* One label per context, with a repeated owner name removed: ["Kai","Kai · Default"] reads "Kai · Default", never "Kai · Kai · Default". Presentation only. */
  function contextLine(labels,limit=0){const out=[];for(const raw of arr(labels)){const l=String(raw==null?'':raw).trim();if(l&&!out.includes(l))out.push(l);}const kept=out.filter(l=>!out.some(o=>o!==l&&o.startsWith(l+' · ')));return (limit>0?kept.slice(0,limit):kept).join(' · ');}
  function defaults(selector=false,target=null){const contextual=!!(selector&&target&&target.list&&target.id);return {query:'',category:contextual?targetCategory(target):'all',decision:selector?'all':'current',type:'all',related:'all',availability:'all',source:'all',sort:'recent',group:contextual?'target':'none',view:'grid',page:0,selected:'',showUnavailable:!selector,showRejected:false};}
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
    /* Belongs to = the recorded owner. Used in = explicit links only; a scene reached through a shot is marked inherited, not proven use. */
    const owner=ownerTitle(use,project),belongsTo=!owner?[]:use.kind==='entity-reference'?[{type:entityList,id:val(c.entityId),label:owner}]:[{type:'shot',id:val(c.shotId),label:owner}];
    const usedMap=new Map(),labelOf=k=>related.find(r=>r.key===k)?.label;
    for(const link of arr(c.links)){const type=val(link.targetType),id=val(link.targetId),norm=({character:'characters',location:'locations',prop:'props',vehicle:'vehicles'})[type]||type;if(!id)continue;const key=norm+':'+id,linkedShot=norm==='shot'&&arr(project.shots).find(s=>String(s.id)===id);if(!usedMap.has(key))usedMap.set(key,{key,type:norm,id,label:linkedShot?[id,linkedShot.title].filter(Boolean).join(' · '):labelOf(key)||id,role:val(link.role)});}
    for(const id of unique(sceneIds)){const key='scene:'+id;if(!usedMap.has(key))usedMap.set(key,{key,type:'scene',id,label:labelOf(key)||id,role:'',inherited:true});}
    const selectedFor=slotSelection(use);
    /* EV2-7 — the recorded view this use fills, read from the entity's own coverage slot. Display only: it names the use, it never grants authority. */
    const slot=entity&&arr(entity.coverageSlots).find(s=>String(s.id)===val(c.coverageSlotId)),view=slot?String(slot.label||slot.id):'';
    const line=contextLine(related.filter(r=>r.type!=='scene').map(r=>r.label));
    return {raw:use,related,categories:useCategories(use),belongsTo,usedIn:[...usedMap.values()],sceneIds:unique(sceneIds),view,label:[line,view].filter(Boolean).join(' · ')||'Project media',decision:selectedFor?'selected':use.disposition?.role||'candidate',selectedFor:selectedFor||[],decidable:arr(use.actions).some(a=>['approve','reject','restore'].includes(a)),candidateName:use.file?.name||'',context:c};
  }
  function compose(project={},records=[],inventory=[]){
    project=project||{};
    const byAsset=new Map(arr(inventory).map(i=>[i.assetId,i]));const result=[];
    for(const raw of records){
      const assetId=val(raw.identity?.ledger), item=byAsset.get(assetId);if(item)byAsset.delete(assetId);
      const uses=arr(raw.relationships).length?raw.relationships:[raw];const relationships=uses.map(u=>relationship(u,project));
      const relatedMap=new Map();relationships.forEach(u=>u.related.forEach(r=>relatedMap.set(r.key,r)));
      for(const link of arr(item?.links)){const u=relationship({context:{links:[wrapLink(link)]}},project);u.related.forEach(r=>relatedMap.set(r.key,r));}
      const owned=relationships.filter(u=>u.raw.scope!=='project'),ownCats=sortCats(owned.flatMap(u=>u.categories));
      /* A link target never turns a shot render into an entity item; recorded planning/audio roles still count. */
      const linkCats=sortCats([...relationships.filter(u=>u.raw.scope==='project').flatMap(u=>u.categories),...arr(item?.links).map(l=>linkCategory(wrapLink(l)))]).filter(cat=>!(ownCats.includes('shot-renders')&&ENTITY_CATEGORIES.includes(cat)));
      const categories=sortCats([...ownCats,...linkCats]);
      const names=[item?.sourceName,item?.storagePath,item?.libraryOriginalName,val(raw.file?.originalName),raw.file?.name,...uses.flatMap(u=>[u.file?.name,val(u.file?.originalName)])],firstOwned=uses.find(u=>u.scope!=='project')||uses[0];
      const title=recordedTitle(val(raw.file?.title),names)||recordedTitle(item?.title,names)||ownerTitle(firstOwned,project)||linkTitle([...uses.filter(u=>u.scope==='project').flatMap(u=>arr(u.context?.links).map(plainLink)),...arr(item?.links)],project);
      const preview=uses.find(u=>u.availability?.state==='available'&&u.file.url)||raw;
      const source=item?.source&&sources[item.source]?item.source:uses.map(u=>val(u.source)).find(s=>sources[s])||'unknown';
      const availability=item?.missing===true?'missing':typeof item?.available==='boolean'?(item.available?'available':/missing|not-found|absent/.test(item.reason||'')?'missing':'unavailable'):preview.availability?.state||(preview.file.url?'available':'unknown');
      const meaningful=relationships.filter(u=>u.raw.scope!=='project'&&u.raw.kind!=='shot-blocking');const roles=unique((meaningful.length?meaningful:relationships).map(u=>u.decision));
      const type=preview.file.mediaType||'document';
      result.push({key:raw.key,assetId,raw,relationships,related:[...relatedMap.values()],sceneIds:unique([...relatedMap.values()].filter(r=>r.type==='scene').map(r=>r.id)),
        categories:categories.length?categories:['other'],category:ownCats[0]||linkCats[0]||'other',
        sceneOrder:Math.min(...[...relatedMap.values()].filter(r=>r.type==='scene').map(r=>arr(project.scenes).findIndex(s=>s.id===r.id)).filter(n=>n>=0),Infinity),title:title||untitled(type),fileName:item?.sourceName||val(raw.file.originalName)||raw.file.name,originalName:val(raw.file.originalName)||item?.libraryOriginalName||'',
        type,url:availability==='available'?(item?.url||preview.file.url):'',availability,reason:item?.reason||preview.availability?.reason||'',
        source,addedAt:val(raw.file.addedAt)||item?.addedAt||'',roles,decision:roles.length===1?roles[0]:'mixed',selectedFor:unique((meaningful.length?meaningful:relationships).flatMap(u=>u.selectedFor)),needsDecision:availability==='available'&&meaningful.some(u=>u.decidable&&['candidate','historic','selected'].includes(u.decision)),inventory:item||null});
    }
    for(const item of byAsset.values()){
      if(!/^asset-[a-f0-9]{32}$/.test(item.assetId||''))continue;
      /* Same rule as composed rows: a link target never turns a ledger-proven shot render into an entity item. */
      const related=relationship({context:{links:arr(item.links).map(wrapLink)}},project),roleCat=ledgerRoleCategory(item),categories=sortCats([roleCat,...related.categories.filter(cat=>!(roleCat==='shot-renders'&&ENTITY_CATEGORIES.includes(cat)))]);
      result.push({key:'asset:'+item.assetId,assetId:item.assetId,raw:null,relationships:[],related:related.related,sceneIds:related.sceneIds,categories:categories.length?categories:['other'],category:roleCat||categories[0]||'other',title:recordedTitle(item.title,[item.sourceName,item.storagePath,item.libraryOriginalName])||linkTitle(item.links,project)||untitled(item.mediaType),fileName:item.sourceName||'',originalName:item.libraryOriginalName||'',selectedFor:[],type:item.mediaType||'document',url:item.available?item.url:'',availability:item.available?'available':/missing|not-found|absent/.test(item.reason||'')?'missing':'unavailable',reason:item.reason||'',source:sources[item.source]?item.source:'unknown',addedAt:item.addedAt||'',roles:['candidate'],decision:'candidate',needsDecision:false,inventory:item});
    }
    return result;
  }
  /* EV2-7 — READABLE USE-SPECIFIC TRUTH, in place of "Different decisions by use". Every word comes from a recorded disposition on a recorded use; nothing is
     derived from a filename, and nothing here can create, move or imply a decision. The card carries a capped sentence; the Inspector carries the whole list. */
  const DECISION_RANK={approved:0,selected:1,rejected:2,historic:3,candidate:4};
  const ELSEWHERE={approved:'approved elsewhere',selected:'selected for a view elsewhere',rejected:'rejected elsewhere',historic:'a historic selection elsewhere',candidate:'candidate elsewhere'};
  function singleWord(decision,selectedFor){return decision==='selected'&&arr(selectedFor).length?'Selected for '+selectedFor.join(' · '):decisions[decision]||'Not recorded';}
  function meaningfulUses(row){const rels=arr(row.relationships),meaningful=rels.filter(u=>u.raw?.scope!=='project'&&u.raw?.kind!=='shot-blocking');return meaningful.length?meaningful:rels;}
  /* One row per recorded use, in decision precedence then recorded order. The Inspector prints this whole list; the card prints the summary below it. */
  function decisionUses(row){return meaningfulUses(row).map((u,i)=>({label:u.label||'',view:u.view||'',decision:u.decision,words:singleWord(u.decision,u.selectedFor),order:i})).sort((a,b)=>((DECISION_RANK[a.decision]??9)-(DECISION_RANK[b.decision]??9))||a.order-b.order);}
  function joinNames(names){return names.length<3?names.join(' and '):names.slice(0,2).join(', ')+' and '+(names.length-2)+' more';}
  function decisionSummary(row,limit=84){
    const uses=decisionUses(row);
    if(row.decision!=='mixed')return {text:singleWord(row.decision,row.selectedFor),lead:row.decision,uses};
    if(uses.length<2){/* Roles disagree but the uses did not travel with the row: say which words are recorded, still without inventing a target for them. */
      const roles=unique(arr(row.roles)).sort((a,b)=>(DECISION_RANK[a]??9)-(DECISION_RANK[b]??9)),first=roles[0]||'candidate';
      return {text:[singleWord(first),joinNames(roles.slice(1).map(r=>ELSEWHERE[r]||'recorded differently elsewhere'))].filter(Boolean).join('; '),lead:first,uses};}
    const lead=uses[0],named=uses.filter(u=>u.decision===lead.decision),rest=unique(uses.filter(u=>u.decision!==lead.decision).map(u=>ELSEWHERE[u.decision]||'recorded differently elsewhere'));
    const tail=rest.length?'; '+joinNames(rest):'';
    const build=names=>lead.words+(names?' for '+names:'')+tail;
    const labels=named.map(u=>u.label).filter(Boolean);
    let text=build(joinNames(labels));
    if(text.length>limit&&labels.length>1)text=build(labels.length+' recorded uses');
    if(text.length>limit&&labels.length===1)text=build(labels[0].slice(0,Math.max(8,labels[0].length-(text.length-limit)-1)).trim()+'…');
    return {text,lead:lead.decision,uses};
  }
  function decisionLabel(row){return decisionSummary(row).text;}
  /* The status word carries at most a small dot. Its tone is the leading recorded decision — never an AI recommendation and never a filename. */
  function decisionTone(row){const lead=decisionSummary(row).lead;if(lead==='approved')return 'approved';if(lead==='rejected')return 'rejected';return row.needsDecision?'attention':'neutral';}
  /* EV2-7 — SINGLE VIEW vs SHEET, from the recorded artifact structure (referenceArtifactStructure through the projection's workflow fact, or the ledger's
     directory-proven role). A filename never answers this, and an undeclared structure says nothing rather than guessing. */
  const STRUCTURE_WORDS={sheet:'Sheet · crop in Build coverage',single:'Single view'};
  function artifactStructure(row){
    for(const use of arr(row?.relationships)){const workflow=val(use.context?.workflow);if(workflow==='reference-sheet')return 'sheet';if(workflow==='coverage-view')return 'single';}
    const role=String(row?.inventory?.ledgerRole||'');return role==='coverage-sheet'?'sheet':role==='coverage-crop'?'single':'';
  }
  function structureLabel(row){return STRUCTURE_WORDS[artifactStructure(row)]||'';}
  /* EV2-7 — CONTEXTUAL ORDER FOR A COVERAGE TARGET. 0 the exact target (this entity, this state, this requested view), 1 the same identity elsewhere
     (other states, other views, or media linked to it), 2 everything else in the chosen category. Ordering only: no row is hidden by rank. */
  function targetRank(row,target){
    const list=String(target?.list||''),id=String(target?.id||'');if(!list||!id)return 2;
    const uses=arr(row?.relationships).filter(u=>val(u.context?.entityList)===list&&val(u.context?.entityId)===id);
    const state=String(target.stateId||''),slot=String(target.slotId||''),fallback=String(target.defaultStateId||'');
    /* A row that records no continuity state of its own belongs to the default state, which is the same fallback the Desk and the candidate readers use.
       It is therefore exact for the default state and merely identity-related for any other one — the distinction the Desk words as an earlier selection. */
    const stateOk=s=>!state||(s?s===state:fallback===state);
    /* The view is recorded either on the row (its target slot) or by the slot edge that selected this media for that view. */
    const viewOk=u=>!slot||val(u.context?.coverageSlotId)===slot||arr(u.raw?.disposition?.targets).some(t=>SLOT_EDGE_KINDS.includes(String(t?.kind||''))&&String(t?.id||'')===slot);
    if(uses.some(u=>stateOk(val(u.context?.stateId))&&viewOk(u)))return 0;
    if(uses.length)return 1;
    return arr(row?.related).some(r=>r.key===list+':'+id)?1:2;
  }
  function targetGroupLabel(rank,target,category='all'){
    const name=String(target?.entityName||target?.id||'this reference');
    if(rank===0)return 'For '+[name,String(target?.stateName||''),String(target?.slotLabel||'')].filter(Boolean).join(' · ');
    if(rank===1)return 'Other '+name+' media';
    return 'Other '+(category&&category!=='all'?categoryLabel(category).toLocaleLowerCase():'production media');
  }
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
    if(state.category&&state.category!=='all'&&!arr(row.categories).includes(state.category))return false;
    const d=state.decision||'current';if(d==='current'&&row.roles.every(r=>r==='rejected'))return false;if(d==='needs'&&!row.needsDecision)return false;
    if(!['current','all','needs'].includes(d)&&!row.roles.includes(d))return false;
    if(state.type&&state.type!=='all'&&row.type!==state.type)return false;
    if(state.related&&state.related!=='all'&&(state.related==='unlinked'?row.related.length:!row.related.some(r=>r.key===state.related)))return false;
    if(state.availability&&state.availability!=='all'&&row.availability!==state.availability)return false;
    if(state.source&&state.source!=='all'&&row.source!==state.source)return false;
    const text=[row.title,row.fileName,row.originalName||'',row.assetId,...row.related.map(r=>r.label+' '+r.id)].join(' ').toLocaleLowerCase();
    return String(state.query||'').trim().toLocaleLowerCase().split(/\s+/).every(word=>text.includes(word));
  }
  /* One pass over the same predicate as query(): counts[c] === query({...state,category:c}).total. */
  function categoryCounts(records,state={},options={}){const base={...state,category:'all'},counts=Object.fromEntries(CATEGORIES.map(([k])=>[k,0]));for(const r of arr(records)){if(!matches(r,base,options))continue;counts.all++;for(const c of unique(arr(r.categories)))if(c in counts)counts[c]++;}return counts;}
  function groupLabel(row,group,options={}){if(group==='category')return categoryLabel(row.category);if(group==='type')return {image:'Images',video:'Video',audio:'Audio',document:'Documents & other'}[row.type]||'Documents & other';if(group==='decision')return decisionLabel(row);if(group==='target')return targetGroupLabel(targetRank(row,options.target),options.target,options.state?.category||'all');if(group==='scene')return row.sceneIds.length>1?'Shared across scenes':row.sceneIds.length?row.related.find(r=>r.type==='scene')?.label||row.sceneIds[0]:'No recorded scene';return '';}
  function query(records,state={},options={}){
    const all=records.filter(r=>matches(r,state,options));const sort=state.sort||'recent',group=state.group||'none';
    all.sort((a,b)=>{const g=group==='none'?0:group==='category'?ORDER.indexOf(a.category)-ORDER.indexOf(b.category):group==='target'?targetRank(a,options.target)-targetRank(b,options.target):groupLabel(a,group,options).localeCompare(groupLabel(b,group,options));if(g)return g;
      if(sort==='name')return a.title.localeCompare(b.title,undefined,{numeric:true})||a.key.localeCompare(b.key);
      if(sort==='production'){const scene=(a.sceneOrder??Infinity)-(b.sceneOrder??Infinity);if(scene)return scene;}
      return (a.addedAt&&b.addedAt?b.addedAt.localeCompare(a.addedAt):a.addedAt?-1:b.addedAt?1:0)||a.title.localeCompare(b.title,undefined,{numeric:true})||a.key.localeCompare(b.key);
    });
    const page=Math.min(Math.max(0,Number(state.page)||0),Math.max(0,Math.ceil(all.length/48)-1));return {all,rows:all.slice(page*48,(page+1)*48),total:all.length,page,pages:Math.ceil(all.length/48)};
  }
  return {defaults,compose,query,matches,groupLabel,decisionLabel,decisionSummary,decisionUses,decisionTone,rejectedFor,eligibility,sources,val,CATEGORIES,categoryLabel,categoryCounts,linkCategory,ledgerRoleCategory,ownerTitle,recordedTitle,linkTitle,slotSelection,typeLabel,targetCategory,targetRank,targetGroupLabel,contextLine,artifactStructure,structureLabel};
});
