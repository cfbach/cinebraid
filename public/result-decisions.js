/* EV2-6: presentation and submission of existing human-authority commands.
 * No new receipt, durable queue, or storage owner. The trusted click writes once;
 * the existing approval submission owner fences recovery and retries that payload. */
(function () {
  'use strict';
  let prepared = null;
  const exact = (id, name) => takesFor(id).find(x => x.name === name);
  function recordedFrameTarget(shot, name, frameId, assetId) {
    const frames = shot.keyframes || [];
    const row = shotCandidateRowFor(shot, name);
    if (row?.frameId) return row.frameId === frameId;
    if (frames.length === 1) return frames[0].id === frameId;
    const receipt = currentHumanAuthority(P, { kind: 'shot-frame', shotId: shot.id, frameId });
    return !!assetId && receipt?.value === name && receipt.assetId === assetId;
  }
  function durableTarget(id, name) {
    if (approvalSubmissionPending() || !projectSaveSettled().settled) return null;
    const media = exact(id, name), stored = durableProjectBaseline();
    const shot = stored?.shots?.find(s => s.id === id);
    if (!media?.assetId || !shot) return null;
    const targets = isVideo(name)
      ? (shot.clips || []).map(u => ({kind:'shot-motion',shotId:id,unitKey:u.id || unitKey(u)}))
      : (shot.keyframes || []).map(f => ({kind:'shot-frame',shotId:id,frameId:f.id}));
    targets.push({kind:'shot-delivery',shotId:id});
    return targets.find(target => {const receipt=currentHumanAuthority(stored,target);return receipt?.value===name && receipt.assetId===media.assetId;}) || null;
  }
  async function open(id, name, kind, frameId='', motionUnit='', finishJobId='') {
    if (approvalSubmissionPending()) return showPendingApprovalSurface();
    const shot=shotById(id), media=exact(id,name);
    if(!shot || !media?.url || !media.assetId) return toast('This exact result is unavailable or has no verified media identity. Refresh its media record before approving.');
    const slug=ACTIVE_PROJECT_SLUG,epoch=PROJECT_OPEN_EPOCH;
    const target=kind==='frame'?{kind:'shot-frame',shotId:id,frameId}:kind==='delivery'?{kind:'shot-delivery',shotId:id}:null;
    // Motion targets must exist durably before confirmation. Never invent one by
    // selecting the first clip when the shot contains several possible targets.
    if(kind==='motion') {
      const clips=shot.clips || [];
      // A shot with no motion unit has one possible target, its primary unit. Opening the
      // Motion stage no longer creates it, so it is created here, inside the approval the
      // filmmaker asked for; open() then waits for the save before the confirmation can be
      // pressed. prepareMotion() is the shipped setup for exactly this.
      if(!motionUnit&&!clips.length){prepared={id,name,kind,frameId,slug,epoch};return prepareMotion();}
      if(!motionUnit&&clips.length!==1) {
        prepared={id,name,kind,frameId,slug,epoch};
        openModal('<h3>Choose the motion approval target</h3><p>Approval applies to one declared motion unit. It does not approve its input frames or delivery.</p>'+(clips.length?'<label>Motion unit<select id="rx-motion-target">'+clips.map(u=>'<option value="'+attr(u.id||unitKey(u))+'">'+esc(u.title||u.label||u.id||unitKey(u))+'</option>').join('')+'</select></label>':'<p>This shot has no motion unit yet. Set up the existing primary motion target before reviewing approval.</p>')+'<div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button onclick="CineBraidResultDecisions.prepareMotion()">'+(clips.length?'Continue to review':'Set up primary motion target')+'</button></div>');
        document.querySelector('#modal .cancel')?.focus();return;
      }
      if(motionUnit&&!clips.some(u=>(u.id||unitKey(u))===motionUnit))return toast('That motion target no longer exists.');
    }
    const authorityTarget=target || {kind:'shot-motion',shotId:id,unitKey:motionUnit || shot.clips[0].id || unitKey(shot.clips[0])};
    if(kind==='frame' && !(shot.keyframes||[]).some(f=>f.id===frameId))return toast('This frame no longer exists. Nothing was approved.');
    if(kind==='frame' && !recordedFrameTarget(shot,name,frameId,media.assetId))return toast('This result has no recorded binding to that frame. Import it to an explicit frame before approval.');
    const savedFinish=finishJobId?durableProjectBaseline()?.finishJobs?.find(j=>j.id===finishJobId):null;
    const sourceFile=savedFinish&&exact(id,savedFinish.sourceFile),sourceReceipt=savedFinish&&currentHumanAuthority(durableProjectBaseline(),authorityTarget);
    const validFinish=savedFinish?.shotId===id&&savedFinish.resultFile===name&&sourceFile?.assetId&&sourceReceipt?.value===savedFinish.sourceFile&&sourceReceipt.assetId===sourceFile.assetId&&projectSaveSettled().settled;
    if(finishJobId&&!validFinish)return toast('Save this finishing result and verify its exact Approved source before promotion.');
    if(kind==='delivery'&&!validFinish&&!durableTarget(id,name))return toast('Approve this exact result and wait for its save before deciding final delivery.');
    const title=kind==='motion'?'Approve this motion result?':kind==='delivery'?'Mark this result as final delivery?':'Approve this image?';
    const targetLabel=kind==='frame'?id+' · Frame '+((shot.keyframes||[]).find(f=>f.id===frameId)?.label||frameId):kind==='motion'?id+' · Motion '+authorityTarget.unitKey:id+' · Shot delivery';
    const effects=kind==='delivery'?'This changes only this shot’s delivery authority and final-output bookkeeping. It does not approve an opening frame or motion unit.':kind==='motion'?'This changes only the Approved motion result for this motion unit. Opening frames, finishing and final delivery remain separate.':'This becomes the Approved image for this frame'+((shot.keyframes||[])[0]?.id===frameId?' and the current shot still':'')+'. '+((shot.keyframes||[]).find(f=>f.id===frameId)?.winner&&((shot.keyframes||[]).find(f=>f.id===frameId).winner!==name)?'Replacing the current image also reopens this shot’s motion approvals and final delivery because the frame input changed. ':'')+'Other frames and references are not approved.';
    prepared={id,name,kind,finishJobId,authorityTarget,assetId:media.assetId,url:media.url,slug,epoch,ready:false};
    const own=prepared;
    openModal(`<div class="rx-confirm"><h3>${esc(title)}</h3><p>${esc(targetLabel)}</p><figure>${isVideo(name)?`<video controls preload="metadata" src="${attr(media.url)}"></video>`:`<img src="${attr(media.url)}" alt="Exact result under consideration">`}</figure><p>${esc(effects)}</p><p id="rx-confirm-status" role="status">Checking that this decision context is saved…</p><div class="modal-actions"><button class="cancel" onclick="closeModal()">Cancel</button><button id="rx-confirm" class="approve-btn" disabled onclick="CineBraidResultDecisions.confirm()">${kind==='delivery'?'Confirm final delivery':'Approve result'}</button></div></div>`);
    document.querySelector('#modal .cancel')?.focus({preventScroll:true});
    await flushPendingProjectSave();
    if(prepared!==own||slug!==ACTIVE_PROJECT_SLUG||epoch!==PROJECT_OPEN_EPOCH||!document.getElementById('rx-confirm'))return;
    const settled=projectSaveSettled();own.ready=settled.settled;own.revision=PROJECT_REVISION;own.targetLabel=targetLabel;
    const visual=document.querySelector('.rx-confirm img,.rx-confirm video');
    const sync=()=>{const loaded=visual?.tagName==='VIDEO'?visual.readyState>=1:visual?.complete&&visual.naturalWidth>0;const btn=document.getElementById('rx-confirm');if(btn)btn.disabled=!(own.ready&&loaded);};
    visual?.addEventListener('load',sync);visual?.addEventListener('loadedmetadata',sync);visual?.addEventListener('error',()=>{own.ready=false;document.getElementById('rx-confirm-status').textContent='This result cannot be loaded. Cancel and retry its media; no authority has changed.';sync();});sync();
    document.getElementById('rx-confirm-status').textContent=settled.settled?'Approval takes effect only after storage confirms the save.':settled.reason+' Cancel, resolve saving, and reopen this same result.';
  }
  async function confirm() {
    const d=prepared,modal=document.querySelector("#modal:not(.hidden) .rx-confirm"),visual=modal?.querySelector("img,video");if(!d?.ready||!visual||visual.getAttribute("src")!==d.url||!(visual.tagName==="VIDEO"?visual.readyState>=1:visual.complete&&visual.naturalWidth>0)||approvalSubmissionPending())return;
    const file=exact(d.id,d.name);
    if(d.slug!==ACTIVE_PROJECT_SLUG||d.epoch!==PROJECT_OPEN_EPOCH||d.revision!==PROJECT_REVISION||file?.assetId!==d.assetId||!projectSaveSettled().settled)return toast('The result or project changed. Cancel and review this exact result again.');
    const s=shotById(d.id);
    if(d.kind==='frame' && !recordedFrameTarget(s,d.name,d.authorityTarget.frameId,d.assetId))return toast('The frame binding changed. Cancel and review this exact result again.');
    const previous=d.kind==='frame'?s.keyframes.find(f=>f.id===d.authorityTarget.frameId)?.winner:'',at=new Date().toISOString(),args={...d.authorityTarget,value:d.name,assetId:d.assetId,at,via:'results-human-confirmation'};
    const finishing=d.finishJobId?finishJobById(d.finishJobId):null;
    if(d.finishJobId&&(!finishing||finishing.resultFile!==d.name||finishing.shotId!==d.id))return toast("This finishing result changed. Review it again.");
    try {
      if(d.kind==='frame')approveFrameCanon(P,args);
      else if(d.kind==='motion')approveMotionCanon(P,args);
      else approveDeliveryCanon(P,args);
    }catch(error){return toast(error.message);}
    if(d.kind==='frame'){guidedClearApprovalTarget(s,'frame:'+d.authorityTarget.frameId,d.name);if(previous&&previous!==d.name)guidedFrameApprovalChanged(d.id,'frame:'+d.authorityTarget.frameId,previous,d.name,{deferReview:true,quiet:true});}
    if(d.kind==='motion')guidedClearApprovalTarget(s,'segment:'+d.authorityTarget.unitKey,d.name);
    const row=candidateRecord(s,d.name,true);
    if(d.kind==='delivery'){row.finalAt=at;s.workflowStatus='APPROVED';s.status='APPROVED';if(isVideo(d.name)){s.finalVideoFile=d.name;ensureShotCreation(s).finalVideoFile=d.name;}}
    else {row.approvedAt=at;row.approvedTarget=d.kind==='frame'?'frame:'+d.authorityTarget.frameId:'segment:'+d.authorityTarget.unitKey;row.decision='shortlist';}
    if(finishing){row.finishedFrom=finishing.sourceFile;finishing.promotedAt=at;finishing.status="promoted";finishing.updatedAt=at;}
    const receipt=currentHumanAuthority(P,d.authorityTarget);
    const submission=beginApprovalSubmission({authorityTarget:d.authorityTarget,receiptId:receipt?.id,shotId:d.id,fileName:d.name,assetId:d.assetId,url:d.url,entityName:d.targetLabel,stateName:d.kind==='delivery'?'Final delivery':'Approved result',resultDecision:true,decisionKind:d.kind});
    prepared=null;showPendingApprovalSurface();
    const outcome=await dispatchApprovalSubmission(submission);
    if(outcome.outcome==='committed')return completePendingApproval(submission,null);
    if(outcome.outcome==='unknown')return resolvePendingApprovalOutcome();
    showPendingApprovalSurface();
  }
  async function complete(meta){closeModal();await route();document.getElementById('rx-decision')?.focus({preventScroll:true});toast(meta.candidateDecision||meta.entityDecision?'Result decision saved.':meta.decisionKind==='finishing'?(meta.finishDelete?'Finishing task removed. Production authority is unchanged.':'Finishing request saved. Production authority is unchanged.'):meta.decisionKind==='delivery'?'Final delivery saved for this shot.':'Approved result saved. Finishing and delivery remain separate.');if(typeof v670ReconcileAfterApproval==='function')v670ReconcileAfterApproval();if(meta.promoteAfterSave)return promoteFinishJob(meta.finishJob.id);}
  async function prepareMotion(){const d=prepared;if(!d||d.slug!==ACTIVE_PROJECT_SLUG||d.epoch!==PROJECT_OPEN_EPOCH)return;const s=shotById(d.id);let key=document.getElementById('rx-motion-target')?.value;if(!key){const unit=ensureGuidedMotionUnit(s,guidedCurrentShotStill(s)?.name||'',guidedVideoProfiles().find(p=>p.id===s.creationBrief?.motionProfileId));key=unit.id||unitKey(unit);dirty();}return open(d.id,d.name,'motion','',key);}
  async function saveFinish(job,options={}){const file=exact(job.shotId,job.sourceFile);const submission=beginApprovalSubmission({resultDecision:true,decisionKind:'finishing',finishJob:options.deleted?null:structuredClone(job),finishDelete:options.deleted?job.id:null,promoteAfterSave:options.promoteAfterSave===true,shotId:job.shotId,fileName:job.sourceFile,assetId:file?.assetId,url:file?.url,entityName:job.shotId,stateName:'Finishing request'});showPendingApprovalSurface();const result=await dispatchApprovalSubmission(submission);if(result.outcome==='committed')return completePendingApproval(submission);if(result.outcome==='unknown')return resolvePendingApprovalOutcome();showPendingApprovalSurface();}
  async function decide(id,name,decision){if(approvalSubmissionPending())return showPendingApprovalSurface();const slug=ACTIVE_PROJECT_SLUG,epoch=PROJECT_OPEN_EPOCH;await flushPendingProjectSave();if(slug!==ACTIVE_PROJECT_SLUG||epoch!==PROJECT_OPEN_EPOCH||!projectSaveSettled().settled)return toast('Save the current project before changing this result decision.');const shot=shotById(id),item=returnedReviewProjectionForBrowser().items.find(r=>r.shotId===id&&r.candidate.name===name);if(!item||item.candidate.receiptBacked||!(decision==='rejected'?item.actions.includes('reject'):item.humanDecision==='rejected'))return toast('This result is no longer eligible for that decision.');const row=setCandidateDecision(id,name,decision,{deferSave:true}),file=exact(id,name);const submission=beginApprovalSubmission({resultDecision:true,candidateDecision:{shotId:id,name,decision:row.decision,reviewedAt:row.reviewedAt},fileName:name,url:file?.url,entityName:id,stateName:'Result decision'});showPendingApprovalSurface();const result=await dispatchApprovalSubmission(submission);if(result.outcome==='committed')return completePendingApproval(submission);if(result.outcome==='unknown')return resolvePendingApprovalOutcome();showPendingApprovalSurface();}
  async function restoreReference(scope,result){
    if(approvalSubmissionPending())return showPendingApprovalSurface();
    const slug=ACTIVE_PROJECT_SLUG,epoch=PROJECT_OPEN_EPOCH;await flushPendingProjectSave();
    if(slug!==ACTIVE_PROJECT_SLUG||epoch!==PROJECT_OPEN_EPOCH||!projectSaveSettled().settled)return toast('Resolve the current save before restoring this candidate.');
    const current=CineBraidResults.model(scope).rows.find(r=>r.key===result.key&&r.assetId===result.assetId);
    if(!current?.available||!current.rejected||current.approved)return toast('This exact candidate is no longer eligible for restoration. Refresh its record.');
    const row=setEntityCandidateDecision(scope.list,scope.id,current.name,'unreviewed',{deferSave:true});
    const submission=beginApprovalSubmission({resultDecision:true,entityDecision:{list:scope.list,id:scope.id,name:current.name,decision:row.decision,decidedAt:row.decidedAt},fileName:current.name,url:current.url,entityName:scope.id,stateName:scope.stateId});showPendingApprovalSurface();
    const resultSave=await dispatchApprovalSubmission(submission);if(resultSave.outcome==='committed')return completePendingApproval(submission);if(resultSave.outcome==='unknown')return resolvePendingApprovalOutcome();showPendingApprovalSurface();
  }
  window.CineBraidResultDecisions={open,confirm,complete,durableTarget,prepareMotion,saveFinish,decide,restoreReference};
})();
