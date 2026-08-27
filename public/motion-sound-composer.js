/* CineBraid v6.3.0 — Motion & Sound Composer.
   Canonical per-unit performance, dialogue, voice, camera and sound brief.
   Provider execution remains manual. */
(() => {
  const SUPPORTED_FAMILIES = new Set(["minimax-h3", "seedance-2", "kling-3", "ltx-2.3", "happy-horse-1.1"]);
  const originalGuidedVideoProfiles = window.guidedVideoProfiles;
  if (typeof originalGuidedVideoProfiles === "function") {
    window.guidedVideoProfiles = function guidedVideoProfiles630() {
      return originalGuidedVideoProfiles().filter((profile) => SUPPORTED_FAMILIES.has(profile.family));
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }
  function activeUnit(s) {
    const c = ensureShotCreation(s);
    return (s.clips || []).find((item) => item.id === c.activeMotionUnitId) || (s.clips || [])[0] || ensureGuidedMotionUnit(s, guidedCurrentShotStill(s)?.name || "", null);
  }
  function blankSfx() {
    return { timing: "", event: "", source: "", intensity: "restrained", distance: "near", diegetic: true };
  }
  function voiceAuthority(speakerId) {
    const speaker = (P.characters || []).find((item) => item.id === speakerId);
    return {
      speakerName: speaker?.name || speakerId || "",
      voiceDesign: String(speaker?.audio?.voiceDesignPrompt || "").trim(),
    };
  }
  function ensureMotionSoundBrief(s, unit = activeUnit(s)) {
    if (!unit) return null;
    s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
    const existing = unit.motionBrief && typeof unit.motionBrief === "object" ? unit.motionBrief : {};
    const dialogue = existing.dialogue && typeof existing.dialogue === "object" ? existing.dialogue : {};
    const sound = existing.sound && typeof existing.sound === "object" ? existing.sound : {};
    const performance = existing.performance && typeof existing.performance === "object" ? existing.performance : {};
    const camera = existing.camera && typeof existing.camera === "object" ? existing.camera : {};
    const output = existing.output && typeof existing.output === "object" ? existing.output : {};
    const line = dialogue.line != null ? dialogue.line : (unit.line || s.audio.line || "");
    const speakerId = dialogue.speakerId != null ? dialogue.speakerId : (unit.speakerId || s.audio.speakerId || "");
    const authority = voiceAuthority(speakerId);
    let sfxEvents = Array.isArray(sound.sfxEvents) ? sound.sfxEvents.filter((item) => item && typeof item === "object") : [];
    if (!sfxEvents.length && String(unit.sfx || s.audio.sfx || "").trim()) {
      sfxEvents = [{ ...blankSfx(), event: String(unit.sfx || s.audio.sfx).trim() }];
    }
    unit.motionBrief = {
      schemaVersion: 1,
      performance: {
        action: String(performance.action != null ? performance.action : (unit.motionPrompt || unit.note || "")),
        emotion: String(performance.emotion || unit.emotion || s.audio.emotion || ""),
        delivery: String(performance.delivery || unit.delivery || s.audio.delivery || ""),
        facial: String(performance.facial || ""),
        gaze: String(performance.gaze || ""),
        bodyLanguage: String(performance.bodyLanguage || ""),
        objectInteraction: String(performance.objectInteraction || ""),
        secondaryMotion: String(performance.secondaryMotion || ""),
        endingState: String(performance.endingState || ""),
        staticConstraints: String(performance.staticConstraints || ""),
        prohibitedMotion: String(performance.prohibitedMotion || ""),
      },
      camera: {
        movement: String(camera.movement || ""),
        timing: String(camera.timing || ""),
        framing: String(camera.framing || ""),
        lensBehavior: String(camera.lensBehavior || ""),
      },
      dialogue: {
        line: String(line || ""),
        speakerId: String(speakerId || ""),
        speakerName: String(dialogue.speakerName || authority.speakerName || ""),
        language: String(dialogue.language || s.audio.language || "English"),
        emotion: String(dialogue.emotion || performance.emotion || s.audio.emotion || ""),
        delivery: String(dialogue.delivery || performance.delivery || s.audio.delivery || ""),
        pace: String(dialogue.pace || s.audio.pace || "natural"),
        volume: String(dialogue.volume || s.audio.volume || "normal"),
        startTime: String(dialogue.startTime || ""),
        endTime: String(dialogue.endTime || ""),
        locked: dialogue.locked !== false,
        /* THREE VALUES, DERIVED IN ONE PLACE. `lipSyncRequired` read
           `lipSyncRequired === true || !!line`, which made a line existing enough to
           require lip sync — so every voice-over, off-screen line, phone call, radio
           transmission and back-to-camera delivery was classified as needing the mouth
           to match the words, and the value was written into the project.

           An explicitly recorded level is PRESERVED here and never manufactured. Writing
           the derived answer back into the field the derivation reads as authoritative
           would pin it: once a level had been stored, unticking the requirement below
           would set the boolean and change nothing, because the stored level outranks
           it. Deriving on read keeps the control the thing that decides. */
        lipSync: String(dialogue.lipSync || ""),
        lipSyncRequired: lipSyncRequiredFrom({ ...dialogue, line }),
        voiceDesign: String(dialogue.voiceDesign || authority.voiceDesign || ""),
      },
      sound: {
        sfxEvents: sfxEvents.map((item) => ({ ...blankSfx(), ...item })),
        ambience: String(sound.ambience != null ? sound.ambience : (unit.ambience || s.audio.ambience || "")),
        music: String(sound.music != null ? sound.music : (unit.music || s.audio.music || "")),
        silence: String(sound.silence || ""),
        priorities: String(sound.priorities || ""),
      },
      output: {
        resolution: String(output.resolution || "model-default"),
        nativeAudio: output.nativeAudio !== false,
      },
      additionalDirection: String(existing.additionalDirection || ""),
    };
    return unit.motionBrief;
  }

  function sfxText(events) {
    return (events || []).filter((item) => String(item.event || "").trim()).map((item) => {
      const timing = String(item.timing || "").trim();
      const attributes = [item.intensity, item.distance, item.source, item.diegetic === false ? "non-diegetic" : "diegetic"].filter(Boolean).join(", ");
      return `${timing ? `${timing}: ` : ""}${String(item.event).trim()}${attributes ? ` (${attributes})` : ""}`;
    }).join("; ");
  }

  function syncLegacyFields(s, unit, brief) {
    if (!unit || !brief) return;
    const d = brief.dialogue || {}, sound = brief.sound || {}, performance = brief.performance || {};
    unit.line = d.line || "";
    unit.speakerId = d.speakerId || "";
    unit.emotion = d.emotion || performance.emotion || "";
    unit.delivery = d.delivery || performance.delivery || "";
    unit.sfx = sfxText(sound.sfxEvents);
    unit.ambience = sound.ambience || "";
    unit.music = sound.music || "";
    unit.audioNote = [d.language ? `Language: ${d.language}` : "", d.pace ? `Pace: ${d.pace}` : "", d.volume ? `Volume: ${d.volume}` : ""].filter(Boolean).join(" · ");
    if (!(s.clips || []).find((item) => item !== unit && item.line)) {
      s.audio = { ...(s.audio || {}), line: d.line || "", speakerId: d.speakerId || "", emotion: d.emotion || "", delivery: d.delivery || "", language: d.language || "", pace: d.pace || "", volume: d.volume || "", sfx: unit.sfx, ambience: sound.ambience || "", music: sound.music || "" };
    }
  }

  function motionSoundBriefPayload(s, unit = activeUnit(s), c = ensureShotCreation(s)) {
    const brief = ensureMotionSoundBrief(s, unit);
    if (!brief) return null;
    const authority = voiceAuthority(brief.dialogue.speakerId);
    brief.dialogue.speakerName = authority.speakerName;
    if (!brief.dialogue.voiceDesign) brief.dialogue.voiceDesign = authority.voiceDesign;
    const profileId = unit?.motionProfileId || c.motionProfileId || preferredGuidedVideoProfile("");
    const profile = guidedVideoProfiles().find((item) => item.id === profileId);
    const payload = clone(brief);
    payload.model = { profileId, family: profile?.family || "", name: profile?.name || profileId };
    payload.durationSeconds = Number(unit?.dur || c.motionDuration || 5);
    if (profile?.family === "seedance-2" && payload.output.resolution === "model-default") payload.output.resolution = "720p";
    syncLegacyFields(s, unit, brief);
    return payload;
  }
  window.motionSoundBriefPayload = motionSoundBriefPayload;

  function motionSoundBriefSummary(s, unit = activeUnit(s)) {
    const brief = ensureMotionSoundBrief(s, unit);
    if (!brief) return "";
    const p = brief.performance, cam = brief.camera, d = brief.dialogue, sound = brief.sound;
    const lines = [];
    if (p.action) lines.push(`Primary action: ${p.action}`);
    if (p.emotion || p.facial || p.bodyLanguage || p.gaze) lines.push(`Performance: ${[p.emotion, p.facial, p.bodyLanguage, p.gaze ? `gaze ${p.gaze}` : ""].filter(Boolean).join("; ")}.`);
    if (p.objectInteraction) lines.push(`Object interaction: ${p.objectInteraction}`);
    if (p.secondaryMotion) lines.push(`Secondary motion: ${p.secondaryMotion}`);
    if (p.endingState) lines.push(`Ending state: ${p.endingState}`);
    if (cam.movement || cam.timing || cam.framing || cam.lensBehavior) lines.push(`Camera: ${[cam.movement, cam.timing, cam.framing, cam.lensBehavior].filter(Boolean).join("; ")}.`);
    if (p.staticConstraints) lines.push(`Keep static: ${p.staticConstraints}`);
    if (p.prohibitedMotion) lines.push(`Do not introduce: ${p.prohibitedMotion}`);
    if (d.line) lines.push(`Locked dialogue — ${d.speakerName || d.speakerId || "speaker"}: “${d.line}”`);
    if (d.line) lines.push(`Dialogue performance: ${[d.language, d.emotion, d.delivery, d.pace ? `${d.pace} pace` : "", d.volume ? `${d.volume} volume` : "", d.startTime || d.endTime ? `${d.startTime || "start"}–${d.endTime || "end"}` : ""].filter(Boolean).join("; ")}.`);
    const effects = sfxText(sound.sfxEvents);
    if (effects) lines.push(`SFX: ${effects}`);
    if (sound.ambience) lines.push(`Ambience: ${sound.ambience}`);
    if (sound.music) lines.push(`Music: ${sound.music}`);
    if (sound.silence) lines.push(`Silence requirement: ${sound.silence}`);
    if (sound.priorities) lines.push(`Audio priority: ${sound.priorities}`);
    if (brief.additionalDirection) lines.push(`Additional direction: ${brief.additionalDirection}`);
    return lines.join("\n");
  }
  window.motionSoundBriefSummary = motionSoundBriefSummary;

  function parseTimingSeconds(value) {
    const text = String(value || "");
    const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*s\b/gi)].map((match) => Number(match[1]));
    if (!matches.length && /^\s*\d+(?:\.\d+)?\s*$/.test(text)) matches.push(Number(text));
    return matches.filter(Number.isFinite);
  }
  function motionSoundWarnings(s, unit = activeUnit(s), profile = null) {
    const brief = ensureMotionSoundBrief(s, unit), warnings = [];
    if (!brief) return warnings;
    const d = brief.dialogue, duration = Number(unit?.dur || 5), wordCount = String(d.line || "").trim().split(/\s+/).filter(Boolean).length;
    const estimatedSpeech = wordCount / 2.4;
    const supportsAudio = !!profile?.supports?.audio;
    if (d.line && !d.speakerId) warnings.push("Dialogue is present but no speaking character is assigned.");
    if (d.line && estimatedSpeech > Math.max(1, duration - .35)) warnings.push(`The ${wordCount}-word line may be too long for a ${duration}-second clip at a natural pace.`);
    if (d.line && !d.voiceDesign) warnings.push("The speaking character has no persistent Voice Design prompt in the Project Bible.");
    if (d.line && d.lipSyncRequired && !(s.characters || []).includes(d.speakerId)) warnings.push("Lip-sync is required, but the selected speaker is not assigned to this shot.");
    if (d.line && !supportsAudio) warnings.push(`${profile?.name || "The selected model"} does not support native audio in this profile; plan dialogue or lip-sync in post.`);
    if (d.line && brief.output.nativeAudio === false) warnings.push("Dialogue exists while native audio is disabled for this motion package.");
    for (const event of brief.sound.sfxEvents || []) {
      const times = parseTimingSeconds(event.timing);
      if (times.some((time) => time > duration)) warnings.push(`SFX timing “${event.timing}” exceeds the ${duration}-second motion-unit duration.`);
    }
    if (profile?.mode === "flf" && !brief.performance.action && !brief.performance.endingState) warnings.push("First/last-frame mode has no physical transition explaining how the shot reaches the final frame.");
    if (brief.camera.movement && /strong|fast|whip|crash/i.test(brief.camera.movement) && /run|fight|jump|rapid|fast/i.test(brief.performance.action || "")) warnings.push("Complex camera movement and complex subject movement are both requested; consider simplifying one of them.");
    return warnings;
  }
  window.motionSoundWarnings = motionSoundWarnings;

  function option(value, selected, label = value) {
    return `<option value="${attr(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`;
  }
  function speakerOptions(s, selected) {
    return `<option value="">Select character</option>${(s.characters || []).map((id) => {
      const char = (P.characters || []).find((item) => item.id === id);
      return option(id, selected, char?.name || id);
    }).join("")}`;
  }
  function sfxRows(s, unit, brief) {
    const rows = brief.sound.sfxEvents || [];
    return rows.map((event, index) => `<article class="motion-sfx-row"><label><span>Timing</span><input value="${attr(event.timing || "")}" placeholder="e.g. 1.8s" onchange="setMotionSoundSfx('${s.id}','${unit.id}',${index},'timing',this.value)"></label><label class="wide"><span>Sound event</span><input value="${attr(event.event || "")}" placeholder="e.g. dry power-drop thunk" onchange="setMotionSoundSfx('${s.id}','${unit.id}',${index},'event',this.value)"></label><label><span>Intensity</span><select onchange="setMotionSoundSfx('${s.id}','${unit.id}',${index},'intensity',this.value)">${["restrained","soft","natural","strong"].map((value) => option(value,event.intensity,value)).join("")}</select></label><label><span>Distance</span><select onchange="setMotionSoundSfx('${s.id}','${unit.id}',${index},'distance',this.value)">${["close","near","mid-distance","distant"].map((value) => option(value,event.distance,value)).join("")}</select></label><button class="chip danger" onclick="removeMotionSoundSfx('${s.id}','${unit.id}',${index})">REMOVE</button></article>`).join("") || `<div class="guided-empty-inline"><b>No timed SFX events.</b><span>Add only sounds the model should generate or synchronize.</span></div>`;
  }
  function motionSoundEditorForm(s, expanded = false) {
    const unit = activeUnit(s), brief = ensureMotionSoundBrief(s, unit), c = ensureShotCreation(s);
    if (!unit || !brief) return "";
    const profileId = unit.motionProfileId || c.motionProfileId || preferredGuidedVideoProfile("");
    const profile = guidedVideoProfiles().find((item) => item.id === profileId);
    const warnings = motionSoundWarnings(s, unit, profile);
    const voice = voiceAuthority(brief.dialogue.speakerId);
    const modelResolution = profile?.family === "seedance-2" ? "720p" : "Model default";
    return `<details class="motion-sound-composer" data-motion-unit="${attr(unit.id)}" ${expanded ? "open" : ""}><summary class="motion-sound-composer-summary"><div><span>MOTION & SOUND BRIEF · UNIT ${esc(unit.label || "A")}</span><b>Performance, camera, dialogue, and sound</b><small>This canonical brief compiles differently for each video model.</small></div><i>${esc(profile?.name || profileId)}</i></summary><div class="motion-sound-composer-body">
      <details open><summary>Performance & physical action <span>what moves</span></summary><div class="motion-sound-grid">
        <label class="wide"><span>Primary visible action</span><textarea placeholder="Describe the physical action in chronological order." onchange="setMotionSoundField('${s.id}','${unit.id}','performance','action',this.value)">${esc(brief.performance.action)}</textarea></label>
        <label><span>Emotion</span><input value="${attr(brief.performance.emotion)}" placeholder="e.g. frightened but controlled" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','emotion',this.value)"></label>
        <label><span>Facial performance</span><input value="${attr(brief.performance.facial)}" placeholder="e.g. jaw tightens, eyes track the cable" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','facial',this.value)"></label>
        <label><span>Body language</span><input value="${attr(brief.performance.bodyLanguage)}" placeholder="e.g. rigid shoulders, careful hands" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','bodyLanguage',this.value)"></label>
        <label><span>Gaze</span><input value="${attr(brief.performance.gaze)}" placeholder="e.g. from the seedling to the relay" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','gaze',this.value)"></label>
        <label class="wide"><span>Object interaction</span><input value="${attr(brief.performance.objectInteraction)}" placeholder="e.g. right hand seats the coupler while the left stabilizes the cable" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','objectInteraction',this.value)"></label>
        <label class="wide"><span>Secondary motion / environment beat</span><input value="${attr(brief.performance.secondaryMotion)}" placeholder="e.g. a status light goes dark after she stops" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','secondaryMotion',this.value)"></label>
        <label class="wide"><span>Required ending state</span><input value="${attr(brief.performance.endingState)}" placeholder="e.g. finish with her hand resting on the locked connector" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','endingState',this.value)"></label>
        <label class="wide"><span>Keep static</span><input value="${attr(brief.performance.staticConstraints)}" placeholder="e.g. room geometry, console position, character identity" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','staticConstraints',this.value)"></label>
        <label class="wide"><span>Prohibited movement / morphing</span><input value="${attr(brief.performance.prohibitedMotion)}" placeholder="e.g. no new gestures, no object morphing, no camera drift" onchange="setMotionSoundField('${s.id}','${unit.id}','performance','prohibitedMotion',this.value)"></label>
      </div></details>
      <details><summary>Camera & timing <span>how it is filmed</span></summary><div class="motion-sound-grid">
        <label class="wide"><span>Camera movement</span><input value="${attr(brief.camera.movement)}" placeholder="e.g. locked, slow push-in, gentle arc…" onchange="setMotionSoundField('${s.id}','${unit.id}','camera','movement',this.value)"></label>
        <label><span>Move timing</span><input value="${attr(brief.camera.timing)}" placeholder="e.g. begins at 1.0s, settles by 4.0s" onchange="setMotionSoundField('${s.id}','${unit.id}','camera','timing',this.value)"></label>
        <label><span>Framing behavior</span><input value="${attr(brief.camera.framing)}" placeholder="e.g. preserve medium close framing" onchange="setMotionSoundField('${s.id}','${unit.id}','camera','framing',this.value)"></label>
        <label class="wide"><span>Lens / focus behavior</span><input value="${attr(brief.camera.lensBehavior)}" placeholder="e.g. shallow focus shifts from hands to face" onchange="setMotionSoundField('${s.id}','${unit.id}','camera','lensBehavior',this.value)"></label>
      </div></details>
      <details class="motion-dialogue-editor" ${brief.dialogue.line ? "open" : ""}><summary>Dialogue & persistent voice <span>${brief.dialogue.line ? "locked line" : "optional"}</span></summary><div class="motion-sound-grid">
        <label class="wide"><span>Exact spoken line</span><textarea placeholder="Literal words only." onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','line',this.value)">${esc(brief.dialogue.line)}</textarea></label>
        <label><span>Speaker</span><select onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','speakerId',this.value)">${speakerOptions(s,brief.dialogue.speakerId)}</select></label>
        <label><span>Language</span><input value="${attr(brief.dialogue.language)}" onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','language',this.value)"></label>
        <label><span>Line emotion</span><input value="${attr(brief.dialogue.emotion)}" placeholder="e.g. urgent but controlled" onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','emotion',this.value)"></label>
        <label><span>Delivery</span><input value="${attr(brief.dialogue.delivery)}" placeholder="e.g. quiet, breathless, slight pause" onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','delivery',this.value)"></label>
        <label><span>Pace</span><select onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','pace',this.value)">${["slow","measured","natural","brisk","rapid"].map((value)=>option(value,brief.dialogue.pace,value)).join("")}</select></label>
        <label><span>Volume</span><select onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','volume',this.value)">${["whisper","quiet","normal","raised","shout"].map((value)=>option(value,brief.dialogue.volume,value)).join("")}</select></label>
        <label><span>Start time</span><input value="${attr(brief.dialogue.startTime)}" placeholder="e.g. 0.8s" onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','startTime',this.value)"></label>
        <label><span>End time</span><input value="${attr(brief.dialogue.endTime)}" placeholder="e.g. 3.8s" onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','endTime',this.value)"></label>
        <label class="checkline"><input type="checkbox" ${brief.dialogue.locked ? "checked" : ""} onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','locked',this.checked)"> Lock exact dialogue during AI improvement</label>
        <label class="checkline"><input type="checkbox" ${brief.dialogue.lipSyncRequired ? "checked" : ""} onchange="setMotionSoundField('${s.id}','${unit.id}','dialogue','lipSyncRequired',this.checked)"> Lip-sync required</label>
      </div><div class="voice-authority-card ${voice.voiceDesign ? "ready" : "missing"}"><span>PERSISTENT VOICE AUTHORITY</span><b>${esc(voice.speakerName || "No speaker selected")}</b><p>${esc(voice.voiceDesign || "Add a Voice Design prompt to this character in the Project Bible. CineBraid will keep it consistent across every line.")}</p></div></details>
      <details><summary>SFX, ambience & music <span>${(brief.sound.sfxEvents || []).length} timed event${(brief.sound.sfxEvents || []).length === 1 ? "" : "s"}</span></summary><div class="motion-sfx-list">${sfxRows(s,unit,brief)}</div><button class="ghost-btn" onclick="addMotionSoundSfx('${s.id}','${unit.id}')">＋ ADD SFX EVENT</button><div class="motion-sound-grid sound-tail">
        <label class="wide"><span>Ambience / room tone</span><textarea onchange="setMotionSoundField('${s.id}','${unit.id}','sound','ambience',this.value)">${esc(brief.sound.ambience)}</textarea></label>
        <label class="wide"><span>Music cue</span><textarea onchange="setMotionSoundField('${s.id}','${unit.id}','sound','music',this.value)">${esc(brief.sound.music)}</textarea></label>
        <label class="wide"><span>Required silence</span><input value="${attr(brief.sound.silence)}" placeholder="e.g. after the power drop, leave 0.5s of near-silence" onchange="setMotionSoundField('${s.id}','${unit.id}','sound','silence',this.value)"></label>
        <label class="wide"><span>Audio priorities</span><input value="${attr(brief.sound.priorities)}" placeholder="e.g. dialogue first, restrained machinery, no cinematic boom" onchange="setMotionSoundField('${s.id}','${unit.id}','sound','priorities',this.value)"></label>
      </div></details>
      <details><summary>Model package settings <span>${esc(modelResolution)}</span></summary><div class="motion-sound-grid"><label><span>Output target</span><select onchange="setMotionSoundField('${s.id}','${unit.id}','output','resolution',this.value)">${option("model-default",brief.output.resolution,"Model default")}${option("720p",brief.output.resolution,"720p")}</select></label><label class="checkline"><input type="checkbox" ${brief.output.nativeAudio ? "checked" : ""} onchange="setMotionSoundField('${s.id}','${unit.id}','output','nativeAudio',this.checked)"> Include native audio instructions</label><label class="wide"><span>Additional model direction</span><textarea onchange="setMotionSoundRootField('${s.id}','${unit.id}','additionalDirection',this.value)">${esc(brief.additionalDirection)}</textarea></label></div></details>
      ${warnings.length ? `<div class="motion-sound-warnings"><b>${warnings.length} production warning${warnings.length === 1 ? "" : "s"}</b>${warnings.map((warning)=>`<span>${esc(warning)}</span>`).join("")}</div>` : `<div class="prompt-check ok">Motion and sound brief passes the current preflight checks.</div>`}
    </div></details>`;
  }

  function motionSoundEditor(s) {
    const unit = activeUnit(s), brief = ensureMotionSoundBrief(s, unit), c = ensureShotCreation(s);
    if (!unit || !brief) return "";
    const profileId = unit.motionProfileId || c.motionProfileId || preferredGuidedVideoProfile("");
    const profile = guidedVideoProfiles().find((item) => item.id === profileId);
    const warnings = motionSoundWarnings(s, unit, profile);
    const line = String(brief.dialogue?.line || "").trim();
    const sfxCount = (brief.sound?.sfxEvents || []).filter((item) => String(item.event || "").trim()).length;
    return `<details class="motion-sound-launcher"><summary><div><span>MOTION & SOUND BRIEF · UNIT ${esc(unit.label || "A")}</span><b>${line ? `${esc(brief.dialogue.speakerName || brief.dialogue.speakerId || "Dialogue")} · locked dialogue` : "Performance, camera, dialogue, and sound"}</b><small>${esc(profile?.name || profileId)} · ${sfxCount} timed SFX event${sfxCount === 1 ? "" : "s"}${warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : " · preflight ready"}</small></div><i>Edit brief</i></summary><div class="motion-sound-launcher-body"><p>Edit performance, camera, dialogue, <b>Persistent voice authority</b>, and <b>SFX, ambience & music</b> in a dedicated workspace, then build or AI-improve the model-specific prompt below.</p><button class="ghost-btn" onclick="openMotionSoundComposer('${s.id}','${unit.id}')">Open Motion & Sound Composer</button></div></details>`;
  }
  window.openMotionSoundComposer = (shotId, unitId = "") => {
    const s = shotById(shotId);
    if (!s) return;
    if (unitId) ensureShotCreation(s).activeMotionUnitId = unitId;
    const unit = activeUnit(s);
    if (!unit) return toast("Create a motion unit first");
    openModal(`<div class="motion-sound-modal"><div class="motion-sound-modal-head"><div><span>MODEL-READY VIDEO DIRECTION</span><h3>Motion & Sound Composer</h3><p>Edits remain structured in the production record and compile separately for each video model.</p></div><button class="cancel" onclick="closeModal();route()">CLOSE</button></div>${motionSoundEditorForm(s, true)}</div>`);
  };

  window.setMotionSoundField = (shotId, unitId, group, key, value) => {
    const s = shotById(shotId), unit = (s?.clips || []).find((item) => item.id === unitId);
    if (!s || !unit) return;
    const brief = ensureMotionSoundBrief(s,unit);
    brief[group] = brief[group] && typeof brief[group] === "object" ? brief[group] : {};
    brief[group][key] = value;
    if (group === "dialogue" && key === "speakerId") {
      const authority = voiceAuthority(value);
      brief.dialogue.speakerName = authority.speakerName;
      brief.dialogue.voiceDesign = authority.voiceDesign;
    }
    syncLegacyFields(s,unit,brief);
    keepGuidedPanelOpen(s,"motion");
    dirty(); route();
  };
  window.setMotionSoundRootField = (shotId, unitId, key, value) => {
    const s = shotById(shotId), unit = (s?.clips || []).find((item) => item.id === unitId);
    if (!s || !unit) return;
    ensureMotionSoundBrief(s,unit)[key] = value;
    keepGuidedPanelOpen(s,"motion"); dirty();
  };
  window.setMotionSoundSfx = (shotId, unitId, index, key, value) => {
    const s = shotById(shotId), unit = (s?.clips || []).find((item) => item.id === unitId);
    if (!s || !unit) return;
    const brief = ensureMotionSoundBrief(s,unit);
    brief.sound.sfxEvents[index] = { ...blankSfx(), ...(brief.sound.sfxEvents[index] || {}), [key]: value };
    syncLegacyFields(s,unit,brief); keepGuidedPanelOpen(s,"motion"); dirty();
  };
  window.addMotionSoundSfx = (shotId, unitId) => {
    const s = shotById(shotId), unit = (s?.clips || []).find((item) => item.id === unitId);
    if (!s || !unit) return;
    ensureMotionSoundBrief(s,unit).sound.sfxEvents.push(blankSfx());
    keepGuidedPanelOpen(s,"motion"); dirty(); route();
  };
  window.removeMotionSoundSfx = (shotId, unitId, index) => {
    const s = shotById(shotId), unit = (s?.clips || []).find((item) => item.id === unitId);
    if (!s || !unit) return;
    const brief = ensureMotionSoundBrief(s,unit);
    brief.sound.sfxEvents.splice(index,1); syncLegacyFields(s,unit,brief);
    keepGuidedPanelOpen(s,"motion"); dirty(); route();
  };

  const oldStructuredMotionSummary = window.structuredMotionSummary;
  if (typeof oldStructuredMotionSummary === "function") {
    window.structuredMotionSummary = function structuredMotionSummary630(s) {
      return [oldStructuredMotionSummary(s), motionSoundBriefSummary(s)].filter(Boolean).join("\n");
    };
  }
  const oldMotionAudioSummary = window.motionAudioSummary;
  if (typeof oldMotionAudioSummary === "function") {
    window.motionAudioSummary = function motionAudioSummary630(s,c) {
      const unit = activeUnit(s), brief = ensureMotionSoundBrief(s,unit), d = brief?.dialogue || {}, sound = brief?.sound || {};
      const canonical = [
        d.line ? `${d.speakerName || d.speakerId || "Speaker"} says exactly: “${d.line}”` : "",
        d.voiceDesign ? `Persistent voice: ${d.voiceDesign}` : "",
        d.line ? `Delivery: ${[d.language,d.emotion,d.delivery,d.pace,d.volume].filter(Boolean).join(", ")}` : "",
        sfxText(sound.sfxEvents) ? `Timed SFX: ${sfxText(sound.sfxEvents)}` : "",
        sound.ambience ? `Ambience: ${sound.ambience}` : "",
        sound.music ? `Music: ${sound.music}` : "",
        sound.silence ? `Silence: ${sound.silence}` : "",
      ].filter(Boolean).join("\n");
      return [oldMotionAudioSummary(s,c), canonical].filter(Boolean).join("\n");
    };
  }

  const oldGuidedMotionPromptResult = window.guidedMotionPromptResult;
  if (typeof oldGuidedMotionPromptResult === "function") {
    window.guidedMotionPromptResult = function guidedMotionPromptResult630(s, build) {
      let html = oldGuidedMotionPromptResult(s, build);
      const locks = Array.isArray(build?.lockedFields) ? build.lockedFields : [];
      const brief = build?.motionBrief || null;
      const output = brief?.output?.resolution && brief.output.resolution !== "model-default" ? brief.output.resolution : "model default";
      const metadata = `<details class="motion-build-metadata"><summary>Motion & sound package record <span>${locks.length} locked field${locks.length === 1 ? "" : "s"}</span></summary><div><p><b>Output target</b>${esc(output)}</p><p><b>Native audio</b>${brief?.output?.nativeAudio === false ? "Disabled" : "Included when supported"}</p>${locks.length ? `<p class="wide"><b>Protected during AI improvement</b>${locks.map(esc).join(" · ")}</p>` : ""}${build?.improvementNotes?.length ? `<p class="wide"><b>AI change notes</b>${build.improvementNotes.map(esc).join(" · ")}</p>` : ""}</div></details>`;
      return html.replace("</article>", `${metadata}</article>`);
    };
  }

  const oldGuidedMotionPanel = window.guidedMotionPanel;
  if (typeof oldGuidedMotionPanel === "function") {
    window.guidedMotionPanel = function guidedMotionPanel630(s,current,takes,open=false) {
      const html = oldGuidedMotionPanel(s,current,takes,open);
      if (!html.includes('<div class="guided-motion-main">')) return html;
      return html.replace('<div class="guided-motion-main">', `<div class="guided-motion-main">${motionSoundEditor(s)}`)
        .replace('Additional motion direction', 'Legacy / supplemental motion direction')
        .replace('Only add details not covered by the controls above.', 'Optional legacy free-text direction. The structured Motion & Sound Brief above is the canonical source.');
    };
  }

  // Normalize imported and existing motion units once the project is available.
  window.normalizeMotionSoundProject = () => {
    for (const shot of P?.shots || []) {
      normalizeShotV5(shot);
      for (const unit of shot.clips || []) ensureMotionSoundBrief(shot,unit);
    }
  };
})();
