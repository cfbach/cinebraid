/* A+ References. UI selection is ephemeral; only Add as candidate enrolls. */
(function() {
  "use strict";
  const R=CineBraidReferenceMedia, states=new Map(), types={characters:"Character",locations:"Location",props:"Prop",vehicles:"Vehicle"};
  let active=null, picker=null, nextFocus="", destinationFocus="";
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
    // A candidate recorded for another continuity state is that state's; a row with no recorded state stays visible and says so.
    const rowState=m=>m.stateId || entityCandidateRow(entity,m.name,false)?.targetStateId || "";
    const media=all.filter(m=>!rowState(m) || rowState(m)===state.stateId).map(m=>({...m,recordedState:rowState(m),structure:referenceArtifactStructureOf(entity,m.name)}));
    const truth=entityStateTruth(list,entity).of(currentState), approved=media.find(m=>m.name===truth.file);
    if(!state.selected)state.selected=approved?.name || media[0]?.name || "";
    const selected=media.find(m=>m.name===state.selected);
    const row=entityCandidateRow(entity,state.selected,false);
    const linked=(P.mediaAssets||[]).filter(m=>(m.links||[]).some(l=>l.targetType===ENTITY_ROUTE[list] && l.targetId===id));
    const linkedAvailable=linked.filter(m=>(SCAN.media||[]).some(r=>r.name===m.file && r.assetId));
    // Presentation only: a guided crop and its binding are one image in one state, shown once (the binding is the assignment).
    const strip=media.filter(m=>!(m.assetId && !m.bindingId && media.some(o=>o!==m && o.bindingId && o.assetId===m.assetId && o.recordedState===m.recordedState)));
    // Views and counts read every state's rows: a view's selection recorded for another state is still that view's image (Build coverage reads the same).
    return {list,id,entity,state,currentState,allStates,media,all,strip,selected,row,truth,approved,linkedAvailable,coverage:R.coverage(entity,all,state.stateId)};
  }
  function words(m,item) {
    if(!item?.available)return "Image unavailable";
    if(m.truth.standing==="canon" && m.truth.file===item.name)return "Approved reference";
    if(item.structure==="sheet")return "Reference sheet · a source for views"+(item.recordedState?"":" · state not recorded");
    const row=entityCandidateRow(m.entity,item.name,false);
    return (row?.decision==="rejected" ? "Rejected candidate" : "Candidate · not approved")+(item.recordedState?"":" · state not recorded");
  }
  // "Crop from <sheet>": the crop row that shares this image's identity carries the sheet provenance.
  function cropSource(m,item) {
    const crop=(m.entity.candidateFiles||[]).find(r=>r.coverageCrop && ((item.assetId && r.assetId===item.assetId) || (r.stored||r.name)===item.name));
    return crop ? String(crop.coverageCrop.sourceSheet||'').split('/').pop() : '';
  }
  function inspect(m) {
    const desc=typeof entityVisualDescription==='function'?entityVisualDescription(m.entity,m.list):m.entity.description||m.entity.block||"";
    return '<h3>Reference intention</h3><p>'+e(desc || 'No reference description recorded.')+'</p><details><summary>Provenance &amp; identity</summary><dl><dt>Reference</dt><dd>'+e(m.id)+'</dd><dt>Asset identity</dt><dd>'+e(m.selected?.assetId||'No asset selected')+'</dd><dt>Candidate binding</dt><dd>'+e(m.row?.referenceBinding?.id||'Existing folder reference')+'</dd><dt>Original file</dt><dd>'+e(m.selected?.sourceName||m.row?.original||'—')+'</dd><dt>Availability</dt><dd>'+e(m.selected?.reason||'Available')+'</dd></dl></details>'+button('details','Notes &amp; history')+'<p><a class="rd-tool-link" href="'+routeFor(m.list,m.id)+'/tools">Continuity &amp; creation tools</a></p>';
  }
  function context(m) {
    return '<nav class="rd-crumb" aria-label="Production context"><a href="#/production">Production</a><span>/</span><a href="#/library/'+m.list+'">References</a><span>/ '+e(types[m.list])+'</span></nav><span data-return-slot></span>';
  }

  function view(list,id) {
    if(location.hash.endsWith('/tools'))return null;
    const m=model(list,id);if(!m)return null;
    active={list,id};document.body.classList.add('reference-desk-active');
    const show=m.state.inspect && matchMedia('(min-width:1360px)').matches;
    const selected=m.selected, sheet=selected?.structure==='sheet';
    // A composite sheet is a source: it names the views cropped from it for this state and never offers approval.
    const derived=sheet?derivedViews(m,selected):[];
    const canvas=selected?.available?'<img id="rd-image" src="'+a(selected.url)+'" alt="'+a(m.entity.name+' — '+(m.currentState?.name||'Default'))+'"><p class="rd-image-error" hidden role="alert">This exact image is unavailable. It cannot be approved or used.</p>'+(sheet?'<figcaption class="rd-sheet-caption">Reference sheet · a source for views. Views are filled only when you assign a crop.</figcaption>':''):selected?'<div class="rd-empty"><span class="rd-empty-mark">◇</span><h2>Image unavailable</h2><p>The recorded candidate is preserved. CineBraid will not substitute another image.</p>'+button('refresh','Check availability')+'</div>':'<div class="rd-empty"><span class="rd-empty-mark">◇</span><h2>No image assigned yet</h2><p>'+e(m.linkedAvailable.length===1?'An image is available in Production media but has not been added as a reference candidate.':m.linkedAvailable.length?m.linkedAvailable.length+' linked images are available in Production media. Choose which view each represents.':'Choose an existing production image, or upload a new one to establish this reference.')+'</p><div>'+button('build','Build coverage','rd-primary')+'</div></div>';
    const slots=R.requiredSlots(m.entity).map(slot=>{
      // Every view opens Build coverage aimed at it. A nondefault state counts only its own bindings; the wording is the shared viewStatus label.
      const v=R.viewStatus(m.entity,slot,m.state.stateId,m.all),img=v.item,present=v.present,note=v.label;
      return '<div class="rd-slot-pair"><button class="rd-slot'+(v.earlier?' rd-slot-earlier':'')+'" data-rd-slot="'+a(slot.id)+'" data-rd-slot-status="'+a(v.status)+'" aria-label="'+a((slot.label||slot.id)+' — '+note+'. Build coverage for this view')+'">'+(present?'<img src="'+a(img.url)+'" alt="">':'<span class="rd-slot-empty">＋</span>')+'<span><b>'+e(slot.label||slot.id)+'</b><small>'+e(note)+'</small></span></button><button class="rd-button" data-rd-results-slot="'+a(slot.id)+'">Review '+e(slot.label||slot.id)+' results</button></div>';
    }).join('');
    const strip=m.strip.map((item,i)=>{const from=item.structure==='sheet'?'':cropSource(m,item);return '<button data-rd-candidate="'+a(item.name)+'" aria-pressed="'+(item.name===m.state.selected)+'" aria-label="Review candidate '+(i+1)+' — '+a(words(m,item)+(from?' · Crop from '+from:''))+'">'+(item.available?'<img src="'+a(item.url)+'" alt="">':'<span>Unavailable</span>')+'<small>Image '+(i+1)+(item.structure==='sheet'?' · <b class="rd-sheet-tag">Sheet</b>':'')+'</small>'+(from?'<small class="rd-crop-from">Crop from '+e(from)+'</small>':'')+'</button>';}).join('');
    const derivedList=sheet?'<section class="rd-derived" aria-label="Views from this sheet"><h2>Views from this sheet · '+e(m.currentState?.name||'Default')+'</h2>'+(derived.length?'<ul>'+derived.map(d=>'<li><b>'+e(d.label)+'</b><span>'+e(d.assigned?'assigned to '+d.label:'crop saved, not assigned')+'</span></li>').join('')+'</ul>':'<p>No views have been cropped from this sheet for this state yet.</p>')+'</section>':'';
    const decision=selected?.available && m.row?.decision==='rejected'?button('restore','Restore candidate','rd-primary'):sheet&&selected?.available?button('sheet','Use this sheet to fill views','rd-primary'):selected?.available && !(m.truth.standing==='canon'&&m.truth.file===selected.name)?button('approve','Approve reference…','rd-primary'):'';
    return '<section class="reference-desk" data-reference-desk>'+context(m)+'<header class="rd-heading"><div><p class="rd-eyebrow">'+e(types[list])+' reference</p><h1 id="rd-title" tabindex="-1">'+e(m.entity.name||id)+'</h1></div><div class="rd-heading-actions">'+(m.media.length?button('build','Build coverage','rd-primary'):'')+'</div></header><div class="rd-toolbar"><label>Continuity state <select id="rd-state">'+m.allStates.map(s=>'<option value="'+a(s.id)+'" '+(s.id===m.state.stateId?'selected':'')+'>'+e(s.name||s.id)+'</option>').join('')+'</select></label>'+button('results','Review results')+button('inspect','Reference details')+'</div><div class="rd-body '+(show?'rd-inspection-open':'')+'"><div class="rd-working"><figure class="rd-canvas">'+canvas+'</figure>'+(m.media.length?'<div class="rd-candidates" aria-label="Reference candidates">'+strip+'</div>':'')+derivedList+'<section class="rd-coverage"><header><h2>Required views</h2><span>'+e(R.coverageSummary(m.coverage))+'</span></header><div class="rd-slots">'+slots+'</div><p>Filling a view records coverage. Approval remains a separate decision.</p></section></div>'+(show?'<aside class="rd-inspection"><header><h2>Reference details</h2>'+button('inspect','Close')+'</header>'+inspect(m)+'</aside>':'')+'</div><footer class="rd-decision"><div><strong id="rd-status" role="status" tabindex="-1">'+e(selected?words(m,selected):'Choose an image for this reference')+'</strong><small>'+e(sheet&&selected?.available?'A sheet is never this reference’s approved image. Crop and assign its views; approval stays a separate decision.':selected?.available?'Approval sets the visual authority for '+(m.currentState?.name||'this continuity state')+'.':'Adding a candidate will not approve it or mark the design complete.')+'</small></div>'+decision+'</footer></section>';
  }
  // Crops saved from this sheet for this state, and whether each is the view's current assignment.
  function derivedViews(m,sheetItem) {
    const def=R.defaultStateId(m.entity),stateId=m.state.stateId,rows=m.entity.candidateFiles||[];
    return rows.filter(r=>r.coverageCrop?.sourceSheet===sheetItem.name && (r.targetStateId||def)===stateId).map(r=>{
      const slot=(m.entity.coverageSlots||[]).find(s=>s.id===r.targetCoverageSlotId),key=slot?R.selectedKey(m.entity,slot,stateId):'';
      const bound=key&&rows.find(c=>(c.stored||c.name)===key);
      const assigned=!!key&&(key===(r.stored||r.name)||!!(bound?.referenceBinding&&r.assetId&&bound.referenceBinding.assetId===r.assetId));
      return {label:slot?.label||r.targetCoverageSlotName||r.targetCoverageSlotId||'View',assigned};
    });
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
      return '<a class="rd-library-card" data-rd-search="'+a((entity.name+' '+entity.id).toLowerCase())+'" href="'+routeFor(list,entity.id)+'"><div class="rd-library-image">'+(preview?'<img src="'+a(preview.url)+'" alt="">':'<span>'+ (approved?'Approved image unavailable':'No image assigned yet')+'</span>')+'</div><div><small>'+e(types[list])+'</small><h2>'+e(entity.name||entity.id)+'</h2><p>'+e(approved?(media.some(m=>m.name===approved.file)?'Approved reference':'Approved image unavailable'):media.length?media.length+' candidate'+(media.length===1?'':'s')+' · review needed':'Choose or upload an image')+'</p><span>'+coverage.filled+' of '+coverage.required+' required views filled</span></div></a>';
    }).join('')+'</div><p id="rd-search-empty" hidden>No references match this search.</p></section>';
  }
  function repaint(focus){nextFocus=focus||'';route();}
  const cancelAttr=p=>p.onCancel?'data-rd-picker-cancel':'onclick="closeModal()"';
  // A picker opened by Build coverage hands a dismissal back to it; the picker's own dialog closes without a deferred focus restore.
  function cancelPicker(){
    const p=picker;if(!p||!p.onCancel||p.busy)return false;
    picker=null;closeModal({restoreFocus:false});p.onCancel();return true;
  }
  const pickerShown=()=>!!document.querySelector('#modal:not(.hidden) .rd-picker');
  async function openPicker(slotId='',upload=false,options={}) {
    const m=model(active.list,active.id);if(!m)return;
    // onDone: Build coverage's continuation after a verified enrollment. sheetMode: choose a Production Media sheet to crop, never to fill a view whole.
    // onCancel: Build coverage's way back when the picker is dismissed (Cancel, Escape or backdrop) without adding anything.
    picker={discovery:CineBraidMediaDiscovery.defaults(true),list:m.list,id:m.id,slug:ACTIVE_PROJECT_SLUG,epoch:PROJECT_OPEN_EPOCH,revision:PROJECT_REVISION,stateId:m.state.stateId,slotId,images:[],selected:'',busy:false,upload,file:null,error:'',onDone:options.onDone||null,onCancel:typeof options.onCancel==='function'?options.onCancel:null,sheetMode:!upload&&options.sheetMode===true};
    openModal('<div class="rd-picker"><h3>'+(upload?'Upload a reference image':picker.sheetMode?'Choose a sheet from Production Media':'Choose from production media')+'</h3><button class="cancel" autofocus '+cancelAttr(picker)+'>Cancel</button><p role="status">Loading available images…</p></div>');
    document.querySelector('#modal .modal-box')?.classList.add('rd-picker-box');
    const own=picker;
    // A save already on its way (an edit, or an older project's one migration write on open) is this window's own work, not a change made while the selection was open: it lands first, and the selection guards the revision it produced.
    if(!projectSaveSettled().settled&&typeof flushPendingProjectSave==='function'){
      await flushPendingProjectSave().catch(()=>{});
      if(picker!==own||!modalOpen())return;
      if(own.slug===ACTIVE_PROJECT_SLUG&&own.epoch===PROJECT_OPEN_EPOCH)own.revision=PROJECT_REVISION;
    }
    if(upload){renderPicker();return;}
    try {
      const response=await fetch('/api/references/media?project='+encodeURIComponent(own.slug),{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error||'Could not load production media.');
      if(picker!==own||!modalOpen())return;
      const linked=r=>(r.links||[]).some(l=>l.targetType===ENTITY_ROUTE[own.list]&&l.targetId===own.id);
      own.images=data.images;renderPicker();
    }catch(error){if(picker===own){own.error=error.message;own.loadFailed=true;renderPicker();}}
  }
  function renderPicker(focus='rd-picker-cancel') {
    if(!picker||!modalOpen())return;
    const p=picker,entity=P[p.list]?.find(e=>e.id===p.id),selected=p.images.find(r=>r.assetId===p.selected),state=collection(entity).find(s=>s.id===p.stateId),slot=(entity.coverageSlots||[]).find(s=>s.id===p.slotId);
    const preview=p.file?p.fileUrl:selected?.available?selected.url:'';
    const issue=selected?CineBraidMediaDiscovery.eligibility(pickerRecords(p).find(r=>r.assetId===selected.assetId),p):'';
    const valid=!!preview&&!!state&&!!slot&&p.single===true&&!p.busy&&!issue&&!p.loadFailed;
    const images=p.upload?'<label class="rd-file">Choose an image file<input id="rd-upload-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp"></label><p>Your file stays outside the project until you add it as a candidate.</p>':CineBraidMediaBrowser.mount('reference-picker',{selector:true,target:p,state:p.discovery,loadFailed:()=>p.loadFailed===true,records:()=>pickerRecords(p),select:row=>{p.selected=row.assetId;p.error=CineBraidMediaDiscovery.eligibility(row,p);p.single=false;const single=document.getElementById('rd-single');if(single)single.checked=false;syncPicker();},inspect:row=>inspectPicker(row,p)});
    // A composite image is cropped, never declared a single view: this path never checks #rd-single.
    const canCrop=!p.upload&&!!selected?.available&&!p.busy&&!p.loadFailed;
    const sheetLink=p.upload?'':'<button type="button" id="rd-use-as-sheet" class="rd-button rd-sheet-link" '+(canCrop?'':'disabled')+'>'+(p.sheetMode?'Crop views from this sheet':'This image contains several views → crop it instead')+'</button>';
    const html='<div class="rd-picker'+(p.sheetMode?' rd-picker-sheet':'')+'"><header><div><h3>'+(p.upload?'Upload a reference image':p.sheetMode?'Choose a sheet from Production Media':'Choose from production media')+'</h3><p>'+e(entity.name)+' · '+e(types[p.list])+'</p></div><button id="rd-picker-cancel" class="cancel" autofocus '+cancelAttr(p)+' '+(p.busy?'disabled':'')+'>Cancel</button></header><div class="rd-picker-layout"><section class="rd-picker-library">'+images+'</section><section class="rd-assignment" aria-label="Assignment preview"><figure>'+ (preview?'<img id="rd-picker-preview" src="'+a(preview)+'" alt="Selected image for assignment">':'<span>Select an image to inspect it</span>')+'</figure><label>Continuity state<select id="rd-assign-state" '+(p.onDone?'disabled aria-describedby="rd-target-locked"':'')+'>'+collection(entity).map(s=>'<option value="'+a(s.id)+'" '+(s.id===p.stateId?'selected':'')+'>'+e(s.name||s.id)+'</option>').join('')+'</select></label><label>Required view<select id="rd-assign-slot" '+(p.onDone?'disabled aria-describedby="rd-target-locked"':'')+'><option value="">Choose the view this image represents</option>'+(entity.coverageSlots||[]).map(s=>'<option value="'+a(s.id)+'" '+(s.id===p.slotId?'selected':'')+'>'+e(s.label||s.id)+'</option>').join('')+'</select></label>'+(p.onDone?'<small id="rd-target-locked" class="rd-target-locked">Target set in Build coverage. Cancel to choose a different state or view.</small>':'')+(p.sheetMode?'<p class="rd-sheet-note">'+e(state?.name||'This state')+' · the sheet stays in Production Media unchanged. You will crop one view at a time and choose where each crop is assigned.</p>'+sheetLink:'<label class="rd-check"><input id="rd-single" type="checkbox" '+(p.single?'checked':'')+'> I identify this image as the selected single view. A multi-view sheet cannot fill one view unless that view is explicitly identified.</label><div class="rd-assignment-summary" aria-live="polite"><b>'+(slot?e(slot.label||slot.id):'Choose a required view')+'</b><p>'+e(state?.name||'Choose a continuity state')+'</p><small>'+(slot&&R.selectedKey(entity,slot,p.stateId)?'This replaces the selected image for this view. The previous candidate and any approval are retained.':'This adds a candidate and fills the selected view.')+' Approval remains a separate decision.</small></div>'+sheetLink)+'</section></div><footer>'+(p.refreshNeeded?'<button id="rd-picker-refresh" class="rd-button">Refresh selection</button>':'')+(p.loadFailed?'<button id="rd-picker-retry" class="rd-button">Retry loading media</button>':'')+'<p id="rd-picker-error" role="alert">'+e(p.error||'')+'</p>'+(p.sheetMode?'':'<button class="rd-button rd-primary" id="rd-add-candidate" '+(!valid?'disabled':'')+'>'+(p.busy?'Adding candidate…':p.unknown?'Check and retry':'Add as candidate')+'</button>')+'</footer></div>';
    updateOpenModal(html);document.getElementById(focus)?.focus({preventScroll:true});
    const img=document.getElementById('rd-picker-preview');if(img){img.onerror=()=>{p.error='The selected image could not be loaded. Choose an available image.';p.selected='';renderPicker();};}
  }
  async function refreshPickerInventory(p){
    const previous=p.images.find(r=>r.assetId===p.selected);
    try {
      for(let i=0;i<30&&!projectSaveSettled().settled;i++)await new Promise(resolve=>setTimeout(resolve,100));
      if(p!==picker||p.slug!==ACTIVE_PROJECT_SLUG||p.epoch!==PROJECT_OPEN_EPOCH)return;
      if(!projectSaveSettled().settled)throw Error('The owning workflow has unsaved changes. Finish saving, then refresh this selection.');
      const revision=PROJECT_REVISION;
      const response=await fetch('/api/references/media?project='+encodeURIComponent(p.slug),{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error||'Could not refresh production media.');
      if(p!==picker||p.slug!==ACTIVE_PROJECT_SLUG||p.epoch!==PROJECT_OPEN_EPOCH)return;
      if(revision!==PROJECT_REVISION)throw Error('The project changed during refresh. Refresh the selection again.');
      const current=data.images.find(r=>r.assetId===p.selected);
      p.images=data.images;p.revision=revision;p.error='';p.loadFailed=false;p.refreshNeeded=false;
      if(previous&&JSON.stringify(previous.identity)!==JSON.stringify(current?.identity)){p.selected='';p.discovery.selected='';p.single=false;p.error='The selected original changed. Inspect and select it again before adding.';}
    }catch(error){p.error=error.message;p.loadFailed=true;p.refreshNeeded=false;}
  }
  function pickerRecords(p){return CineBraidMediaDiscovery.compose(P,CineBraidMediaInspector.projection()?.records||[],p.images).filter(r=>p.images.some(i=>i.assetId===r.assetId));}
  function inspectPicker(row,p){
    const box=document.querySelector('#modal .modal-box'),top=box?.scrollTop||0,libraryTop=document.querySelector('.rd-picker-library')?.scrollTop||0,assignmentTop=document.querySelector('.rd-assignment')?.scrollTop||0;
    const resume=async()=>{if(p!==picker||p.slug!==ACTIVE_PROJECT_SLUG||p.epoch!==PROJECT_OPEN_EPOCH)return;const fromOwner=!modalOpen();if(fromOwner){openModal('<div class="rd-picker"><h3>Return to media selection</h3><p role="status">Checking this selection…</p></div>');document.querySelector('#modal .modal-box')?.classList.add('rd-picker-box');await refreshPickerInventory(p);}if(p!==picker||!modalOpen())return;renderPicker('');syncPicker();requestAnimationFrame(()=>{const box=document.querySelector('#modal .modal-box');if(box)box.scrollTop=top;const library=document.querySelector('.rd-picker-library'),assignment=document.querySelector('.rd-assignment');if(library)library.scrollTop=libraryTop;if(assignment)assignment.scrollTop=assignmentTop;[...document.querySelectorAll('[data-md-inspect]')].find(el=>el.dataset.mdInspect===row.key)?.focus({preventScroll:true});});};
    if(row.raw)CineBraidMediaInspector.inspect(row.key,{resume});else CineBraidMediaInspector.inspectInventory(row,{resume});
  }
  function selectContext({list,id,stateId,candidateName,assetId}){
    const entity=P[list]?.find(e=>e.id===id);if(!entity)return false;
    const item=R.listing(SCAN,list,id,true).find(r=>r.name===candidateName&&(!assetId||r.assetId===assetId)&&(!stateId||!r.stateId||r.stateId===stateId));if(!item)return false;
    const wanted=stateId||item.stateId||(collection(entity).find(s=>s.isDefault)||collection(entity)[0])?.id;
    if(!collection(entity).some(s=>s.id===wanted))return false;
    Object.assign(local(list,id),{stateId:wanted,selected:candidateName});return true;
  }
  function syncPicker() {
    if (!picker || !modalOpen()) return;
    const p=picker, entity=P[p.list]?.find(e=>e.id===p.id), selected=p.images.find(r=>r.assetId===p.selected);
    const state=collection(entity).find(s=>s.id===p.stateId),slot=(entity.coverageSlots||[]).find(s=>s.id===p.slotId);
    const url=p.file?p.fileUrl:selected?.available?selected.url:'';
    const figure=document.querySelector('.rd-assignment figure');
    let img=document.getElementById('rd-picker-preview');
    if(!url){figure.innerHTML='<span>Original unavailable. Select an available image to continue.</span>';img=null;}
    if(url && (!img || img.getAttribute('src')!==url)){
      figure.innerHTML='<img id="rd-picker-preview" src="'+a(url)+'" alt="Selected image for assignment">';img=document.getElementById('rd-picker-preview');
    }
    document.querySelectorAll('[data-rd-asset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.rdAsset===p.selected)));
    const summary=document.querySelector('.rd-assignment-summary');
    if(summary)summary.innerHTML='<b>'+e(slot?.label||'Choose a required view')+'</b><p>'+e(state?.name||'Choose a continuity state')+'</p><small>'+(slot&&R.selectedKey(entity,slot,p.stateId)?'This replaces the selected image for this view. The previous candidate and any approval are retained.':'This adds a candidate and fills the selected view.')+' Approval remains a separate decision.</small>';
    document.getElementById('rd-picker-error').textContent=p.error||'';
    const btn=document.getElementById('rd-add-candidate');
    const item=selected?pickerRecords(p).find(r=>r.assetId===selected.assetId):null;const issue=item?CineBraidMediaDiscovery.eligibility(item,p):'';
    if(issue)document.getElementById('rd-picker-error').textContent=issue;
    const update=()=>{if(btn)btn.disabled=!(url&&state&&slot&&p.single&&img?.complete&&img.naturalWidth>0&&!p.busy&&!issue&&!p.loadFailed);};
    if(img){img.onload=update;img.onerror=()=>{p.error='This exact image could not be loaded. It cannot be added.';document.getElementById('rd-picker-error').textContent=p.error;update();};}update();
    if(btn)btn.textContent=p.busy?'Adding candidate…':p.unknown?'Check and retry':'Add as candidate';
    const crop=document.getElementById('rd-use-as-sheet');if(crop)crop.disabled=!(!p.upload&&selected?.available&&!p.busy&&!p.loadFailed);
    document.getElementById('rd-picker-cancel').disabled=p.busy;
  }
  /* EV2-7 — THE ONE EXACT ENROLLMENT. Every view assignment (picker, upload, guided crop,
     returned result) goes through the unchanged /api/references/enroll contract and is not
     called done until the refreshed project shows the binding and the scan resolves it.
     A retry after an unknown outcome refreshes first; an existing exact binding is reused,
     never duplicated. Nothing here approves. */
  async function enrollExact({slug,epoch,list,id,stateId,slotId,assetId,revision}) {
    const fail=(message,code)=>Object.assign(Error(message),{code});
    if(slug!==ACTIVE_PROJECT_SLUG||epoch!==PROJECT_OPEN_EPOCH)throw fail('The open project changed.','scope');
    const settled=projectSaveSettled();if(!settled.settled)throw fail(settled.reason||'The project has unsaved changes. Finish saving, then retry.','unsettled');
    const entity=P[list]?.find(x=>x.id===id);if(!entity)throw fail('This reference no longer exists.','scope');
    const known=collection(entity);
    if(!known.some(s=>s.id===stateId)&&!(stateId==='state-default'&&!known.length))throw fail('This continuity state no longer exists.','scope');
    if(!(entity.coverageSlots||[]).some(s=>s.id===slotId))throw fail('This view no longer exists.','scope');
    const existing=R.findExactBinding(entity,{assetId,stateId,slotId});if(existing)return {bindingId:R.keyOf(existing),reused:true};
    let response,data;
    const inventory=await fetch('/api/references/media?project='+encodeURIComponent(slug),{cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
    const image=(inventory.images||[]).find(r=>r.assetId===assetId);
    if(!image?.available)throw fail('The exact image is unavailable ('+(image?.reason||'missing')+'). Nothing was assigned.','refused');
    try {
      response=await fetch('/api/references/enroll',{method:'POST',headers:{'Content-Type':'application/json','If-Match':revision||PROJECT_REVISION},body:JSON.stringify({projectSlug:slug,list,entityId:id,stateId,slotId,assetId,expectedIdentity:image.identity})});
      data=await response.json().catch(()=>null);
    }catch(error){throw fail('CineBraid could not confirm whether the assignment was saved.','unknown');}
    if(!response.ok||!data){
      if(!data||response.status>=500)throw fail('CineBraid could not confirm whether the assignment was saved.','unknown');
      // A refusal that asks for a reload (PROJECT_REVISION_CONFLICT) carries that action: the caller re-reads, it never re-posts the same If-Match.
      throw Object.assign(fail(data.error||'The assignment was not saved.',data.code||'refused'),{action:String(data.action||'')});
    }
    await load({intent:'refresh'});
    const fresh=P[list]?.find(x=>x.id===id),slot=(fresh?.coverageSlots||[]).find(s=>s.id===slotId);
    if(slot?.referenceBindings?.[stateId]!==data.bindingId||!R.listing(SCAN,list,id).some(r=>r.name===data.bindingId))throw fail('The assignment response was received but the saved project does not show it. Refresh and check.','unverified');
    return {bindingId:data.bindingId,revision:data.revision};
  }
  async function commitPicker() {
    const p=picker;if(!p||p.busy||p.loadFailed||!p.single)return;
    if(p.slug!==ACTIVE_PROJECT_SLUG||p.epoch!==PROJECT_OPEN_EPOCH){p.error='The open project changed. Cancel and reopen the selection.';renderPicker();return;}
    // After an unknown outcome the project is re-read first, so a binding that did land is found and reused.
    if(p.unknown){p.busy=true;syncPicker();try{const refreshed=await load({intent:'refresh'});if(refreshed&&refreshed.committed===false)throw Error('CineBraid could not re-read the project ('+(refreshed.reason||'refresh refused')+'). Nothing was sent; check again.');p.revision=PROJECT_REVISION;p.unknown=false;}catch(error){p.error=error.message;}p.busy=false;if(picker!==p||!modalOpen())return;if(p.unknown){syncPicker();return;}}
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
      const item=pickerRecords(p).find(r=>r.assetId===selected.assetId);const issue=item?CineBraidMediaDiscovery.eligibility(item,p):'Media identity is not ready.';if(issue)throw Error(issue);
      const data=await enrollExact({slug:p.slug,epoch:p.epoch,list:p.list,id:p.id,stateId:p.stateId,slotId:p.slotId,assetId:selected.assetId,revision:p.revision});
      local(p.list,p.id).selected=data.bindingId;local(p.list,p.id).stateId=p.stateId;
      closeModal(p.onDone?{restoreFocus:false}:undefined);picker=null;
      nextFocus='rd-status';route();toast('Candidate added. The view is filled; approval is unchanged.');
      if(typeof p.onDone==='function')p.onDone({...data,stateId:p.stateId,slotId:p.slotId,assetId:selected.assetId});
    }catch(error){
      if((error.code==='PROJECT_REVISION_CONFLICT'||error.action==='reload')&&picker===p){
        // Re-read the saved project and this selection, then let the filmmaker add again against the target as it now stands.
        try{const refreshed=await load({intent:'refresh'});if(refreshed&&refreshed.committed===false)throw Error('CineBraid could not re-read the project ('+(refreshed.reason||'refresh refused')+').');p.busy=false;await refreshPickerInventory(p);}catch(reload){p.loadFailed=true;p.error=reload.message;}
        p.busy=false;p.unknown=false;if(picker!==p||!modalOpen())return;
        if(!p.loadFailed&&!p.error)p.error='The project changed before this was saved, so nothing was added. The selection was re-read; check the view and add again.';
        renderPicker();syncPicker();return;
      }
      p.error=error.message;p.unknown=error.code==='unknown'||error.code==='unverified';p.busy=false;syncPicker();document.getElementById('rd-picker-cancel')?.focus();
    }
  }
  // "This image contains several views": close the picker and crop the exact chosen original instead.
  function useAsSheet(){
    const p=picker;if(!p||p.busy||p.upload)return;
    const selected=p.images.find(r=>r.assetId===p.selected);
    if(!selected?.available){p.error='Select an available image to crop.';syncPicker();return;}
    if(p.slug!==ACTIVE_PROJECT_SLUG||p.epoch!==PROJECT_OPEN_EPOCH){p.error='The open project changed. Cancel and reopen the selection.';syncPicker();return;}
    const scope={list:p.list,id:p.id,stateId:p.stateId,slotId:p.slotId};
    picker=null;closeModal({restoreFocus:false});
    window.CineBraidBuildCoverage?.open({...scope,method:'crop',source:{kind:'media',assetId:selected.assetId,url:selected.url,identity:selected.identity,name:selected.storagePath||selected.sourceName||selected.assetId}});
  }
  function approval(m) {
    if(!m.selected?.available||m.row?.decision==='rejected')return;
    approveEntityFile(m.list,m.id,m.selected.name,m.state.stateId);
    if(!window._entityApproval||!modalOpen())return;
    updateOpenModal('<div class="rd-confirm"><h3>Approve this reference?</h3><p>'+e(m.entity.name)+' · '+e(m.currentState?.name||'Default')+'</p><figure id="entity-approval-preview"><img src="'+a(m.selected.url)+'" alt="Selected reference candidate"></figure><p>This image becomes the approved visual authority for this continuity state. It replaces any current approved image for that state.</p><p>Other states and candidates remain unchanged. Filling a required view alone does not create approval.</p><div id="entity-approval-readiness" role="status">Preparing this image for approval…</div><footer><button class="cancel" autofocus onclick="closeModal()">Cancel</button><button class="rd-button rd-primary" id="entity-approve-confirm" disabled onclick="confirmEntityApproval(false)">Approve reference</button></footer><input id="entity-approve-file" type="hidden" value="'+a(m.selected.name)+'"><input id="entity-approve-target" type="hidden" value="'+a(m.state.stateId)+'"></div>');
    document.querySelector('#modal .modal-box').classList.add('rd-confirm-box');
    document.querySelector('#modal .cancel').focus({preventScroll:true});syncEntityApprovalModal();
  }
  function action(id) {
    if(id==='new')return openGlobalAdd();
    if(!active)return;
    const m=model(active.list,active.id);if(!m)return;
    if(id==='results')return CineBraidResults.open({list:m.list,id:m.id,stateId:m.state.stateId,slotId:''});
    if(id==='build')return window.CineBraidBuildCoverage?.open({list:m.list,id:m.id,stateId:m.state.stateId,slotId:''});
    if(id==='sheet'&&m.selected?.structure==='sheet'&&m.selected.available)return window.CineBraidBuildCoverage?.open({list:m.list,id:m.id,stateId:m.state.stateId,slotId:'',method:'sheet',source:{kind:'entity',name:m.selected.name}});
    if(id==='choose'||id==='upload')return openPicker('',id==='upload');
    if(id==='restore'&&m.selected?.available&&m.row?.decision==='rejected'){setEntityCandidateDecision(m.list,m.id,m.selected.name,'unreviewed');return;}
    if(id==='approve'&&m.selected?.structure!=='sheet')return approval(m);
    if(id==='refresh')return load({intent:'refresh'}).then(()=>repaint('rd-status'));
    if(id==='details'){openModal('<div data-reference-details-dialog><h3>Notes &amp; history</h3>'+entityDetailsHistoryMarkup(m.list,m.entity,()=>'<p>'+e(m.entity.notes||'No additional notes.')+'</p>')+'<button class="cancel" onclick="closeModal()">Close</button></div>');return;}
    if(id==='inspect'){
      if(!matchMedia('(min-width:1360px)').matches){
        const from=location.hash,project=ACTIVE_PROJECT_SLUG;
        openModal('<div data-reference-details-dialog><h3>Reference details</h3>'+inspect(m)+'<button class="cancel" autofocus onclick="closeModal()">Close</button></div>',{
          // A same-route responsive render can replace the original DOM node.
          resolveReturnFocus:()=>location.hash===from && ACTIVE_PROJECT_SLUG===project ? document.querySelector('.rd-toolbar [data-rd-action="inspect"]') : null,
        });return;
      }
      m.state.inspect=!m.state.inspect;repaint();
    }
  }
  window.addEventListener('hashchange',event=>{
    const from=new URL(event.oldURL).hash,to=new URL(event.newURL).hash;
    // All route-changing controls in reference details, including nested history,
    // hand focus to the destination. Ordinary dismissal keeps the opener rule.
    // The shot origin and its return belong to CineBraidMediaReturn.
    if(from!==to && document.querySelector('#modal:not(.hidden) [data-reference-details-dialog]')) {
      closeModal({restoreFocus:false});
      if(!modalOpen()) destinationFocus=to;
    }
  },true);
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#/"]');
    if(link && link.closest('[data-reference-details-dialog], .rd-inspection')) {
      const target=link.getAttribute('href');
      if(target!==location.hash) {
        if(link.closest('[data-reference-details-dialog]')) {
          closeModal({restoreFocus:false});
          if(modalOpen()){event.preventDefault();return;}
        }
        destinationFocus=target;
      }
    }
    // Build coverage's picker: Cancel and a backdrop click return to Build coverage (a busy picker ignores both).
    if(picker?.onCancel&&pickerShown()&&(event.target.id==='modal'||event.target.closest?.('[data-rd-picker-cancel]'))){
      if(event.target.id==='modal')event.stopPropagation();
      if(!event.target.closest?.('[data-rd-picker-cancel]')?.disabled)cancelPicker();
      return;
    }
    const t=event.target.closest('[data-rd-action],[data-rd-results-slot],[data-rd-candidate],[data-rd-slot],[data-rd-asset],#rd-add-candidate,#rd-picker-retry,#rd-picker-refresh,#rd-use-as-sheet');if(!t)return;
    if(t.id==='rd-use-as-sheet')return useAsSheet();
    if(['rd-picker-refresh','rd-picker-retry'].includes(t.id)&&picker){const p=picker;refreshPickerInventory(p).then(()=>{if(picker===p){renderPicker();syncPicker();}});return;}
    if(t.id==='rd-add-candidate')return commitPicker();
    if(t.hasAttribute('data-rd-asset')&&picker){picker.selected=t.dataset.rdAsset;picker.error='';syncPicker();document.getElementById('rd-assign-slot')?.focus();return;}
    if(t.hasAttribute('data-rd-candidate')&&active){local(active.list,active.id).selected=t.dataset.rdCandidate;repaint('rd-status');return;}
    if(t.hasAttribute('data-rd-results-slot')&&active){const m=model(active.list,active.id);return CineBraidResults.open({list:m.list,id:m.id,stateId:m.state.stateId,slotId:t.dataset.rdResultsSlot});}
    if(t.hasAttribute('data-rd-slot')&&active){const m=model(active.list,active.id);return m&&window.CineBraidBuildCoverage?.open({list:m.list,id:m.id,stateId:m.state.stateId,slotId:t.dataset.rdSlot});}
    action(t.dataset.rdAction);
  },true);
  document.addEventListener('change',event=>{
    const t=event.target;
    if(t.id==='rd-state'&&active){local(active.list,active.id).stateId=t.value;local(active.list,active.id).selected='';repaint('rd-state');}
    if(!picker)return;
    const single=document.getElementById('rd-single');
    if(t.id==='rd-assign-state'){picker.stateId=t.value;picker.single=false;if(single)single.checked=false;}
    if(t.id==='rd-assign-slot'){picker.slotId=t.value;picker.single=false;if(single)single.checked=false;}
    if(t.id==='rd-single')picker.single=t.checked;
    if(t.id==='rd-upload-file'){if(picker.fileUrl)URL.revokeObjectURL(picker.fileUrl);picker.file=t.files[0]||null;picker.fileUrl=picker.file?URL.createObjectURL(picker.file):'';}
    if(['rd-assign-state','rd-assign-slot','rd-single','rd-upload-file'].includes(t.id))syncPicker();
  });
  // Escape reaches this capture listener before the global one that would only close the dialog.
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!picker?.onCancel||!pickerShown())return;
    event.preventDefault();event.stopImmediatePropagation();cancelPicker();
  },true);
  document.addEventListener('input',event=>{
    if(event.target.id!=='rd-search')return;const query=event.target.value.toLowerCase();let count=0;
    document.querySelectorAll('[data-rd-search]').forEach(el=>{el.hidden=!el.dataset.rdSearch.includes(query);if(!el.hidden)count++;});document.getElementById('rd-search-empty').hidden=count>0;
  });
  window.addEventListener('cinebraid:route-rendered',()=>{
    const exists=!!document.querySelector('[data-reference-desk],[data-reference-library],[data-reference-tools]');document.body.classList.toggle('reference-desk-active',exists);
    if(!exists)active=null;
    if(destinationFocus===location.hash && !modalOpen()) {
      destinationFocus='';
      const target=document.querySelector('#main h1, #main .page-title-input, #main h2') || document.getElementById('main');
      if(target){if(!target.matches('input,button,a[href],[tabindex]'))target.tabIndex=-1;target.focus({preventScroll:true});}
    }
    if(nextFocus&&!modalOpen()){document.getElementById(nextFocus)?.focus({preventScroll:true});nextFocus='';}
    const img=document.getElementById('rd-image');if(img){const check=()=>{const good=img.complete&&img.naturalWidth>0;const btn=document.querySelector('[data-rd-action="approve"]');if(btn)btn.disabled=!good;const err=document.querySelector('.rd-image-error');if(err)err.hidden=!(img.complete&&!good);};img.onload=check;img.onerror=check;check();}
  });
  matchMedia('(min-width:1360px)').addEventListener('change',()=>{if(active&&!modalOpen())repaint();});
  window.CineBraidReferenceDesk={view,library,selectContext,enrollExact,
    // Build coverage's entry into the existing picker, aimed at an exact state and view.
    openPickerFor({list,id,stateId,slotId='',upload=false,onDone=null,onCancel=null,sheetMode=false}){const entity=P[list]?.find(x=>x.id===id);if(!entity||!(collection(entity).some(s=>s.id===stateId)||(stateId==='state-default'&&!collection(entity).length)))return false;active={list,id};local(list,id).stateId=stateId;return openPicker(slotId,upload,{onDone,onCancel,sheetMode});},
    focusSlot(slotId){nextFocus='';Promise.resolve(route()).then(()=>requestAnimationFrame(()=>[...document.querySelectorAll('[data-rd-slot]')].find(el=>el.dataset.rdSlot===slotId)?.focus({preventScroll:false})));},
    selectForResults(scope,row){const entity=P[scope.list]?.find(x=>x.id===scope.id);if(!entity||!collection(entity).some(s=>s.id===scope.stateId))return false;local(scope.list,scope.id).stateId=scope.stateId;if(row)selectContext({...scope,candidateName:row.name,assetId:row.assetId});return true;},
    importForResults(scope){if(!this.selectForResults(scope))return;active={list:scope.list,id:scope.id};return openPicker(scope.slotId||'',true);},
    approveForResults(scope){
      const entity=P[scope.list]?.find(x=>x.id===scope.id), row=entity&&entityCandidateRow(entity,scope.candidateName,false);
      if(!row || entityCandidateTargetStateId(entity,scope.candidateName)!==scope.stateId || (scope.slotId&&row.targetCoverageSlotId!==scope.slotId) || !artifactMayHoldPrimaryAuthority(referenceArtifactStructureOf(entity,scope.candidateName)))return toast('This exact candidate is not eligible for primary reference approval. Review its binding and structure in Reference Desk.');
      if(!selectContext(scope))return toast('This exact reference identity changed. Refresh the record.');
      return approval(model(scope.list,scope.id));
    }
  };
})();
