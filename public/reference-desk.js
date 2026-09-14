/* A+ References. UI selection is ephemeral; only Add as candidate enrolls. */
(function() {
  "use strict";
  const R=CineBraidReferenceMedia, states=new Map(), types={characters:"Character",locations:"Location",props:"Prop",vehicles:"Vehicle"};
  let active=null, picker=null, origin=null, returning=null, lastRoute=location.hash, nextFocus="", lastProject="";
  const e=esc,a=attr, routeFor=(list,id)=>"#/"+ENTITY_ROUTE[list]+"/"+encodeURIComponent(id);
  const button=(id,label,cls="")=>'<button type="button" class="rd-button '+cls+'" data-rd-action="'+id+'">'+label+'</button>';
  const collection = (entity)=>entityStateListRead(entity,true);
  const modalOpen=()=>!!document.querySelector("#modal:not(.hidden)");
  function local(list,id) {
    const key=ACTIVE_PROJECT_SLUG+":"+list+":"+id;
    if(!states.has(key)) states.set(key,{stateId:"",selected:"",inspect:false});
    return states.get(key);
  }
  function model(list,id) {
    const entity=P[list]?.find(r=>r.id===id); if(!entity)return null;
    const state=local(list,id), allStates=collection(entity);
    if(!allStates.some(s=>s.id===state.stateId))state.stateId=(allStates.find(s=>s.isDefault)||allStates[0])?.id || "state-default";
    const currentState=allStates.find(s=>s.id===state.stateId), all=R.listing(SCAN,list,id,true);
    const media=all.filter(m=>!m.stateId || m.stateId===state.stateId);
    const truth=entityStateTruth(list,entity).of(currentState), approved=media.find(m=>m.name===truth.file);
    if(!state.selected)state.selected=approved?.name || media[0]?.name || "";
    const selected=media.find(m=>m.name===state.selected);
    const row=entityCandidateRow(entity,state.selected,false);
    const linked=(P.mediaAssets||[]).filter(m=>(m.links||[]).some(l=>l.targetType===ENTITY_ROUTE[list] && l.targetId===id));
    const linkedAvailable=linked.filter(m=>(SCAN.media||[]).some(r=>r.name===m.file && r.assetId));
    return {list,id,entity,state,currentState,allStates,media,selected,row,truth,approved,linkedAvailable,coverage:R.coverage(entity,media,state.stateId)};
  }
  function words(m,item) {
    if(!item?.available)return "Image unavailable";
    if(m.truth.standing==="canon" && m.truth.file===item.name)return "Human-approved reference";
    const row=entityCandidateRow(m.entity,item.name,false);
    return row?.decision==="rejected" ? "Rejected candidate" : "Candidate · not approved";
  }
  function inspect(m) {
    const desc=typeof entityVisualDescription==='function'?entityVisualDescription(m.entity,m.list):m.entity.description||m.entity.block||"";
    return '<h3>Reference intention</h3><p>'+e(desc || 'No reference description recorded.')+'</p><details><summary>Provenance &amp; identity</summary><dl><dt>Reference</dt><dd>'+e(m.id)+'</dd><dt>Asset identity</dt><dd>'+e(m.selected?.assetId||'No asset selected')+'</dd><dt>Candidate binding</dt><dd>'+e(m.row?.referenceBinding?.id||'Existing folder reference')+'</dd><dt>Original file</dt><dd>'+e(m.selected?.sourceName||m.row?.original||'—')+'</dd><dt>Availability</dt><dd>'+e(m.selected?.reason||'Available')+'</dd></dl></details>'+button('details','Notes &amp; history')+'<p><a class="rd-tool-link" href="'+routeFor(m.list,m.id)+'/tools">Continuity &amp; creation tools</a></p>';
  }
  function context(m) {
    const shot=origin?.project===ACTIVE_PROJECT_SLUG?shotById(origin.shotId):null,scene=shot?sceneById(shot.scene):null;
    return '<nav class="rd-crumb" aria-label="Production context"><a href="#/production">Production</a><span>/</span><a href="#/library/'+m.list+'">References</a><span>/ '+e(types[m.list])+'</span></nav>'+(shot?'<div class="rd-origin"><span>'+e([scene?.title||scene?.id,shot.id,shot.title,origin.frameLabel].filter(Boolean).join(' · '))+'</span>'+button('return','Return to shot')+'</div>':'');
  }
  function view(list,id) {
    if(location.hash.endsWith('/tools'))return null;
    const m=model(list,id);if(!m)return null;
    active={list,id};document.body.classList.add('reference-desk-active');
    const show=m.state.inspect && matchMedia('(min-width:1360px)').matches;
    const selected=m.selected;
    const canvas=selected?.available?'<img id="rd-image" src="'+a(selected.url)+'" alt="'+a(m.entity.name+' — '+(m.currentState?.name||'Default'))+'"><p class="rd-image-error" hidden role="alert">This exact image is unavailable. It cannot be approved or used.</p>':selected?'<div class="rd-empty"><span class="rd-empty-mark">◇</span><h2>Image unavailable</h2><p>The recorded candidate is preserved. CineBraid will not substitute another image.</p>'+button('refresh','Check availability')+'</div>':'<div class="rd-empty"><span class="rd-empty-mark">◇</span><h2>No image assigned yet</h2><p>'+e(m.linkedAvailable.length===1?'An image is available in Production media but has not been added as a reference candidate.':m.linkedAvailable.length?m.linkedAvailable.length+' linked images are available in Production media. Choose which view each represents.':'Choose an existing production image, or upload a new one to establish this reference.')+'</p><div>'+button('choose','Choose from production media','rd-primary')+button('upload','Upload new')+'</div></div>';
    const slots=R.requiredSlots(m.entity).map(slot=>{
      const key=R.selectedKey(m.entity,slot,m.state.stateId),img=m.media.find(r=>r.name===key),filled=img?.available;
      return '<button class="rd-slot" data-rd-slot="'+a(slot.id)+'" aria-label="'+a(slot.label||slot.id)+' — '+(filled?'View filled':'No image assigned yet')+'">'+(filled?'<img src="'+a(img.url)+'" alt="">':'<span class="rd-slot-empty">＋</span>')+'<span><b>'+e(slot.label||slot.id)+'</b><small>'+e(filled?'View filled · review separately':key?'Image unavailable':'No image assigned yet')+'</small></span></button>';
    }).join('');
    return '<section class="reference-desk" data-reference-desk>'+context(m)+'<header class="rd-heading"><div><p class="rd-eyebrow">'+e(types[list])+' reference</p><h1 id="rd-title" tabindex="-1">'+e(m.entity.name||id)+'</h1></div><div class="rd-heading-actions">'+(m.media.length?button('choose','Choose from production media','rd-primary')+button('upload','Upload new'):'')+'</div></header><div class="rd-toolbar"><label>Continuity state <select id="rd-state">'+m.allStates.map(s=>'<option value="'+a(s.id)+'" '+(s.id===m.state.stateId?'selected':'')+'>'+e(s.name||s.id)+'</option>').join('')+'</select></label>'+button('inspect','Reference details')+'</div><div class="rd-body '+(show?'rd-inspection-open':'')+'"><div class="rd-working"><figure class="rd-canvas">'+canvas+'</figure>'+(m.media.length?'<div class="rd-candidates" aria-label="Reference candidates">'+m.media.map((item,i)=>'<button data-rd-candidate="'+a(item.name)+'" aria-pressed="'+(item.name===m.state.selected)+'" aria-label="Review candidate '+(i+1)+' — '+a(words(m,item))+'">'+(item.available?'<img src="'+a(item.url)+'" alt="">':'<span>Unavailable</span>')+'<small>Image '+(i+1)+'</small></button>').join('')+'</div>':'')+'<section class="rd-coverage"><header><h2>Required views</h2><span>'+m.coverage.filled+' of '+m.coverage.required+' required views filled</span></header><div class="rd-slots">'+slots+'</div><p>Filling a view records coverage. Human approval remains a separate decision.</p></section></div>'+(show?'<aside class="rd-inspection"><header><h2>Reference details</h2>'+button('inspect','Close')+'</header>'+inspect(m)+'</aside>':'')+'</div><footer class="rd-decision"><div><strong id="rd-status" role="status" tabindex="-1">'+e(selected?words(m,selected):'Choose an image for this reference')+'</strong><small>'+e(selected?.available?'Approval sets the visual authority for '+(m.currentState?.name||'this continuity state')+'.':'Adding a candidate will not approve it or mark the design complete.')+'</small></div>'+(selected?.available && !(m.truth.standing==='canon'&&m.truth.file===selected.name)?button('approve','Approve reference…','rd-primary'):'')+'</footer></section>';
  }
  function library(tab='all') {
    if(tab==='audio')return null;
    document.body.classList.add('reference-desk-active');active=null;
    const kinds=Object.keys(types), selected=kinds.includes(tab)?tab:tab==='canon'||tab==='approved'?'canon':'all';
    const entries=kinds.flatMap(list=>(P[list]||[]).map(entity=>({list,entity}))).filter(x=>selected==='all'||selected==='canon'||x.list===selected);
    return '<section class="rd-library" data-reference-library><nav class="rd-crumb"><a href="#/production">Production</a><span>/ References</span></nav><header class="rd-heading"><div><p class="rd-eyebrow">Production continuity</p><h1>References</h1><p>Choose the images your production can rely on.</p></div>'+button('new','Add reference','rd-primary')+'</header><div class="rd-library-tools"><nav aria-label="Reference types">'+[['all','All'],['characters','Characters'],['locations','Locations'],['props','Props'],['vehicles','Vehicles'],['canon','Approved'],['audio','Audio']].map(([id,label])=>'<a class="'+(id===selected?'selected':'')+'" href="#/library/'+id+'">'+label+'</a>').join('')+'</nav><label class="rd-search">Find a reference<input id="rd-search" type="search" placeholder="Search names or reference IDs"></label></div><div class="rd-library-grid">'+entries.map(({list,entity})=>{
      const media=R.listing(SCAN,list,entity.id),ss=collection(entity),truth=entityStateTruth(list,entity),approved=ss.map(s=>truth.of(s)).find(t=>t.standing==='canon'),preview=media.find(m=>m.name===approved?.file)||media[0];
      if(selected==='canon' && !approved)return '';
      const coverage=R.coverage(entity,media,(ss.find(s=>s.isDefault)||ss[0])?.id||'state-default');
      return '<a class="rd-library-card" data-rd-search="'+a((entity.name+' '+entity.id).toLowerCase())+'" href="'+routeFor(list,entity.id)+'"><div class="rd-library-image">'+(preview?'<img src="'+a(preview.url)+'" alt="">':'<span>'+ (approved?'Approved image unavailable':'No image assigned yet')+'</span>')+'</div><div><small>'+e(types[list])+'</small><h2>'+e(entity.name||entity.id)+'</h2><p>'+e(approved?(media.some(m=>m.name===approved.file)?'Human-approved reference':'Approved image unavailable'):media.length?media.length+' candidate'+(media.length===1?'':'s')+' · review needed':'Choose or upload an image')+'</p><span>'+coverage.filled+' of '+coverage.required+' required views filled</span></div></a>';
    }).join('')+'</div><p id="rd-search-empty" hidden>No references match this search.</p></section>';
  }
  function repaint(focus){nextFocus=focus||'';route();}
  async function openPicker(slotId='',upload=false) {
    const m=model(active.list,active.id);if(!m)return;
    picker={list:m.list,id:m.id,slug:ACTIVE_PROJECT_SLUG,epoch:PROJECT_OPEN_EPOCH,revision:PROJECT_REVISION,stateId:m.state.stateId,slotId,images:[],selected:'',busy:false,upload,file:null,error:''};
    openModal('<div class="rd-picker"><h3>'+(upload?'Upload a reference image':'Choose from production media')+'</h3><button class="cancel" autofocus onclick="closeModal()">Cancel</button><p role="status">Loading available images…</p></div>');
    document.querySelector('#modal .modal-box')?.classList.add('rd-picker-box');
    const own=picker;
    if(upload){renderPicker();return;}
    try {
      const response=await fetch('/api/references/media?project='+encodeURIComponent(own.slug),{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error||'Could not load production media.');
      if(picker!==own||!modalOpen())return;
      const linked=r=>(r.links||[]).some(l=>l.targetType===ENTITY_ROUTE[own.list]&&l.targetId===own.id);
      own.images=data.images.sort((a,b)=>Number(linked(b))-Number(linked(a)));renderPicker();
    }catch(error){if(picker===own){own.error=error.message;renderPicker();}}
  }
  function renderPicker(focus='rd-picker-cancel') {
    if(!picker||!modalOpen())return;
    const p=picker,entity=P[p.list]?.find(e=>e.id===p.id),selected=p.images.find(r=>r.assetId===p.selected),state=collection(entity).find(s=>s.id===p.stateId),slot=(entity.coverageSlots||[]).find(s=>s.id===p.slotId);
    const preview=p.file?p.fileUrl:selected?.available?selected.url:'';
    const valid=!!preview&&!!state&&!!slot&&p.single===true&&!p.busy;
    const images=p.upload?'<label class="rd-file">Choose an image file<input id="rd-upload-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp"></label><p>Your file stays outside the project until you add it as a candidate.</p>':p.images.length?'<div class="rd-picker-grid" aria-label="Production images">'+p.images.map((r,i)=>'<button data-rd-asset="'+a(r.assetId)+'" aria-pressed="'+(p.selected===r.assetId)+'" '+(!r.available?'disabled':'')+' aria-label="'+a(r.title)+'"><span class="rd-picker-thumb">'+(r.available?'<img loading="lazy" src="'+a(r.url)+'" alt="">':'<span>Unavailable</span>')+'</span><b>'+e(r.title)+'</b><small>'+e((r.links||[]).some(l=>l.targetType===ENTITY_ROUTE[p.list]&&l.targetId===p.id)?'Linked to this reference':r.available?'Production image':r.reason)+'</small></button>').join('')+'</div>':'<div class="rd-empty"><h4>No compatible production images available</h4><p>Upload a new image to continue. No files have been imported or changed.</p></div>';
    const html='<div class="rd-picker"><header><div><h3>'+(p.upload?'Upload a reference image':'Choose from production media')+'</h3><p>'+e(entity.name)+' · '+e(types[p.list])+'</p></div><button id="rd-picker-cancel" class="cancel" autofocus onclick="closeModal()" '+(p.busy?'disabled':'')+'>Cancel</button></header><div class="rd-picker-layout"><section class="rd-picker-library">'+images+'</section><section class="rd-assignment" aria-label="Assignment preview"><figure>'+ (preview?'<img id="rd-picker-preview" src="'+a(preview)+'" alt="Selected image for assignment">':'<span>Select an image to inspect it</span>')+'</figure><label>Continuity state<select id="rd-assign-state">'+collection(entity).map(s=>'<option value="'+a(s.id)+'" '+(s.id===p.stateId?'selected':'')+'>'+e(s.name||s.id)+'</option>').join('')+'</select></label><label>Required view<select id="rd-assign-slot"><option value="">Choose the view this image represents</option>'+(entity.coverageSlots||[]).map(s=>'<option value="'+a(s.id)+'" '+(s.id===p.slotId?'selected':'')+'>'+e(s.label||s.id)+'</option>').join('')+'</select></label><label class="rd-check"><input id="rd-single" type="checkbox" '+(p.single?'checked':'')+'> This is one reference view, not a multi-view sheet</label><div class="rd-assignment-summary" aria-live="polite"><b>'+(slot?e(slot.label||slot.id):'Choose a required view')+'</b><p>'+e(state?.name||'Choose a continuity state')+'</p><small>'+(slot&&R.selectedKey(entity,slot,p.stateId)?'This replaces the selected image for this view. The previous candidate and any human approval are retained.':'This adds a candidate and fills the selected view.')+' Approval remains a separate human decision.</small></div></section></div><footer><p id="rd-picker-error" role="alert">'+e(p.error||'')+'</p><button class="rd-button rd-primary" id="rd-add-candidate" '+(!valid?'disabled':'')+'>'+(p.busy?'Adding candidate…':'Add as candidate')+'</button></footer></div>';
    updateOpenModal(html);document.getElementById(focus)?.focus({preventScroll:true});
    const img=document.getElementById('rd-picker-preview');if(img){img.onerror=()=>{p.error='The selected image could not be loaded. Choose an available image.';p.selected='';renderPicker();};}
  }
  function syncPicker() {
    if (!picker || !modalOpen()) return;
    const p=picker, entity=P[p.list]?.find(e=>e.id===p.id), selected=p.images.find(r=>r.assetId===p.selected);
    const state=collection(entity).find(s=>s.id===p.stateId),slot=(entity.coverageSlots||[]).find(s=>s.id===p.slotId);
    const url=p.file?p.fileUrl:selected?.available?selected.url:'';
    const figure=document.querySelector('.rd-assignment figure');
    let img=document.getElementById('rd-picker-preview');
    if(url && (!img || img.getAttribute('src')!==url)){
      figure.innerHTML='<img id="rd-picker-preview" src="'+a(url)+'" alt="Selected image for assignment">';img=document.getElementById('rd-picker-preview');
    }
    document.querySelectorAll('[data-rd-asset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.rdAsset===p.selected)));
    const summary=document.querySelector('.rd-assignment-summary');
    if(summary)summary.innerHTML='<b>'+e(slot?.label||'Choose a required view')+'</b><p>'+e(state?.name||'Choose a continuity state')+'</p><small>'+(slot&&R.selectedKey(entity,slot,p.stateId)?'This replaces the selected image for this view. The previous candidate and any human approval are retained.':'This adds a candidate and fills the selected view.')+' Approval remains a separate human decision.</small>';
    document.getElementById('rd-picker-error').textContent=p.error||'';
    const btn=document.getElementById('rd-add-candidate');
    const update=()=>{if(btn)btn.disabled=!(url&&state&&slot&&p.single&&img?.complete&&img.naturalWidth>0&&!p.busy);};
    if(img){img.onload=update;img.onerror=()=>{p.error='This exact image could not be loaded. It cannot be added.';document.getElementById('rd-picker-error').textContent=p.error;update();};}update();
    if(btn)btn.textContent=p.busy?'Adding candidate…':'Add as candidate';
    document.getElementById('rd-picker-cancel').disabled=p.busy;
  }
  async function commitPicker() {
    const p=picker;if(!p||p.busy||!p.single)return;
    if(p.slug!==ACTIVE_PROJECT_SLUG||p.epoch!==PROJECT_OPEN_EPOCH){p.error='The open project changed. Cancel and reopen the selection.';renderPicker();return;}
    if(!projectSaveSettled().settled||p.revision!==PROJECT_REVISION){p.error='The project changed while this selection was open. Cancel and reopen it before adding.';renderPicker();return;}
    p.busy=true;syncPicker();
    try {
      let selected=p.images.find(r=>r.assetId===p.selected);
      if(p.upload&&p.file&&!p.uploaded){
        const name='MEDIA-'+crypto.randomUUID()+'.'+p.file.name.split('.').pop();
        const response=await fetch('/api/media/upload?type=media&name='+encodeURIComponent(name)+'&projectSlug='+encodeURIComponent(p.slug),{method:'POST',headers:{'Content-Type':p.file.type},body:p.file}),data=await response.json();
        if(!response.ok)throw Error(data.error||'Upload failed.');
        p.uploaded=data.name;
        const identity=await fetch('/api/media/prepare-identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectSlug:p.slug,dir:'media',name:data.name})}).then(r=>r.json());
        if(identity.status!=='ready')throw Error('The image was uploaded, but its identity is not ready. It remains in Production media without approval.');
        const inventory=await fetch('/api/references/media?project='+encodeURIComponent(p.slug)).then(r=>r.json());
        selected=inventory.images.find(r=>r.assetId===identity.assetId);p.images=inventory.images;p.selected=identity.assetId;
      }
      if(!selected?.available)throw Error('The exact selected image is unavailable.');
      const response=await fetch('/api/references/enroll',{method:'POST',headers:{'Content-Type':'application/json','If-Match':p.revision},body:JSON.stringify({projectSlug:p.slug,list:p.list,entityId:p.id,stateId:p.stateId,slotId:p.slotId,assetId:selected.assetId,expectedIdentity:selected.identity})}),data=await response.json();
      if(!response.ok)throw Error(data.error||'The candidate could not be added.');
      local(p.list,p.id).selected=data.bindingId;local(p.list,p.id).stateId=p.stateId;
      closeModal();picker=null;
      await load({intent:'refresh'});nextFocus='rd-status';route();toast('Candidate added. The view is filled; approval is unchanged.');
    }catch(error){p.error=error.message;p.busy=false;syncPicker();document.getElementById('rd-picker-cancel')?.focus();}
  }
  function approval(m) {
    if(!m.selected?.available)return;
    approveEntityFile(m.list,m.id,m.selected.name,m.state.stateId);
    if(!window._entityApproval||!modalOpen())return;
    updateOpenModal('<div class="rd-confirm"><h3>Approve this reference?</h3><p>'+e(m.entity.name)+' · '+e(m.currentState?.name||'Default')+'</p><figure id="entity-approval-preview"><img src="'+a(m.selected.url)+'" alt="Selected reference candidate"></figure><p>This image becomes the human-approved visual authority for this continuity state. It replaces any current approved image for that state.</p><p>Other states and candidates remain unchanged. Filling a required view alone does not create approval.</p><div id="entity-approval-readiness" role="status">Preparing this image for approval…</div><footer><button class="cancel" autofocus onclick="closeModal()">Cancel</button><button class="rd-button rd-primary" id="entity-approve-confirm" disabled onclick="confirmEntityApproval(false)">Approve reference</button></footer><input id="entity-approve-file" type="hidden" value="'+a(m.selected.name)+'"><input id="entity-approve-target" type="hidden" value="'+a(m.state.stateId)+'"></div>');
    document.querySelector('#modal .modal-box').classList.add('rd-confirm-box');
    document.querySelector('#modal .cancel').focus({preventScroll:true});syncEntityApprovalModal();
  }
  function action(id) {
    if(id==='new')return openGlobalAdd();
    if(!active)return;
    const m=model(active.list,active.id);if(!m)return;
    if(id==='choose'||id==='upload')return openPicker('',id==='upload');
    if(id==='approve')return approval(m);
    if(id==='refresh')return load({intent:'refresh'}).then(()=>repaint('rd-status'));
    if(id==='return'&&origin){returning=origin;origin=null;location.hash=returning.route;return;}
    if(id==='details'){openModal('<h3>Notes &amp; history</h3>'+entityDetailsHistoryMarkup(m.list,m.entity,()=>'<p>'+e(m.entity.notes||'No additional notes.')+'</p>')+'<button class="cancel" onclick="closeModal()">Close</button>');return;}
    if(id==='inspect'){
      if(!matchMedia('(min-width:1360px)').matches){openModal('<h3>Reference details</h3>'+inspect(m)+'<button class="cancel" autofocus onclick="closeModal()">Close</button>');return;}
      m.state.inspect=!m.state.inspect;repaint();
    }
  }
  window.addEventListener('hashchange',event=>{
    const from=new URL(event.oldURL).hash,to=new URL(event.newURL).hash,match=from.match(new RegExp('^#/shot/([^/]+)'));
    if(match && new RegExp('^#/(character|location|prop|vehicle)/').test(to)){
      if(origin?.project===ACTIVE_PROJECT_SLUG && origin.route===from) return;
      const control=document.activeElement,shot=shotById(decodeURIComponent(match[1]));
      if(shot)origin={project:ACTIVE_PROJECT_SLUG,route:from,shotId:shot.id,frameLabel:document.querySelector('.sd-frame')?.textContent||'',scrollTop:document.getElementById('main').scrollTop,focusId:control?.id||'',onclick:control?.getAttribute('onclick')||''};
    }
  },true);
  document.addEventListener('click',event=>{
    // Capture before existing inline actions can route synchronously. A subsequent global route clears it.
    const fromShot=location.hash.match(new RegExp('^#/shot/([^/]+)'));
    if(fromShot){const shot=shotById(decodeURIComponent(fromShot[1])),control=event.target.closest('button,a[href]');
      if(shot&&control)origin={project:ACTIVE_PROJECT_SLUG,route:location.hash,shotId:shot.id,frameLabel:document.querySelector('.sd-frame')?.textContent||'',scrollTop:document.getElementById('main').scrollTop,focusId:control.id||'',onclick:control.getAttribute('onclick')||''};
    }
    const link=event.target.closest('a[href^="#/"]');
    if(link&&new RegExp("^#/(character|location|prop|vehicle)/").test(link.getAttribute('href'))){
      const match=location.hash.match(new RegExp("^#/shot/([^/]+)"));
      const shot=match?shotById(decodeURIComponent(match[1])):null;
      origin=shot?{project:ACTIVE_PROJECT_SLUG,route:location.hash,shotId:shot.id,frameLabel:document.querySelector('.sd-frame')?.textContent||'',scrollTop:document.getElementById('main').scrollTop,focusId:link.id||''}:null;
    }
    const t=event.target.closest('[data-rd-action],[data-rd-candidate],[data-rd-slot],[data-rd-asset],#rd-add-candidate');if(!t)return;
    if(t.id==='rd-add-candidate')return commitPicker();
    if(t.hasAttribute('data-rd-asset')&&picker){picker.selected=t.dataset.rdAsset;picker.error='';syncPicker();document.getElementById('rd-assign-slot')?.focus();return;}
    if(t.hasAttribute('data-rd-candidate')&&active){local(active.list,active.id).selected=t.dataset.rdCandidate;repaint('rd-status');return;}
    if(t.hasAttribute('data-rd-slot')&&active)return openPicker(t.dataset.rdSlot);
    action(t.dataset.rdAction);
  },true);
  document.addEventListener('change',event=>{
    const t=event.target;
    if(t.id==='rd-state'&&active){local(active.list,active.id).stateId=t.value;local(active.list,active.id).selected='';repaint('rd-state');}
    if(!picker)return;
    if(t.id==='rd-assign-state')picker.stateId=t.value;
    if(t.id==='rd-assign-slot')picker.slotId=t.value;
    if(t.id==='rd-single')picker.single=t.checked;
    if(t.id==='rd-upload-file'){if(picker.fileUrl)URL.revokeObjectURL(picker.fileUrl);picker.file=t.files[0]||null;picker.fileUrl=picker.file?URL.createObjectURL(picker.file):'';}
    if(['rd-assign-state','rd-assign-slot','rd-single','rd-upload-file'].includes(t.id))syncPicker();
  });
  document.addEventListener('input',event=>{
    if(event.target.id!=='rd-search')return;const query=event.target.value.toLowerCase();let count=0;
    document.querySelectorAll('[data-rd-search]').forEach(el=>{el.hidden=!el.dataset.rdSearch.includes(query);if(!el.hidden)count++;});document.getElementById('rd-search-empty').hidden=count>0;
  });
  window.addEventListener('cinebraid:route-rendered',()=>{
    const exists=!!document.querySelector('[data-reference-desk],[data-reference-library],[data-reference-tools]');document.body.classList.toggle('reference-desk-active',exists);
    if(lastProject!==ACTIVE_PROJECT_SLUG){origin=null;lastProject=ACTIVE_PROJECT_SLUG;}
    if(!exists){active=null;if(!location.hash.startsWith('#/shot/'))origin=null;}
    if(location.hash!==lastRoute&&!new RegExp("^#/(character|location|prop|vehicle)/").test(location.hash))origin=null;
    lastRoute=location.hash;
    if(returning && location.hash===returning.route){const saved=returning;returning=null;requestAnimationFrame(()=>{document.getElementById('main').scrollTop=saved.scrollTop;const el=document.getElementById(saved.focusId)||[...document.querySelectorAll('[onclick]')].find(e=>e.getAttribute('onclick')===saved.onclick);el?.focus({preventScroll:true});});}
    if(nextFocus&&!modalOpen()){document.getElementById(nextFocus)?.focus({preventScroll:true});nextFocus='';}
    const img=document.getElementById('rd-image');if(img){const check=()=>{const good=img.complete&&img.naturalWidth>0;const btn=document.querySelector('[data-rd-action="approve"]');if(btn)btn.disabled=!good;const err=document.querySelector('.rd-image-error');if(err)err.hidden=!(img.complete&&!good);};img.onload=check;img.onerror=check;check();}
  });
  matchMedia('(min-width:1360px)').addEventListener('change',()=>{if(active&&!modalOpen())repaint();});
  window.CineBraidReferenceDesk={view,library};
})();
