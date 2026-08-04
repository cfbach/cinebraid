/* CineBraid v6.4.2 — scene music, ambience, and sound-bed prompt builder. */
function v642SceneAudio(sc) {
  sc.audio = sc.audio || {};
  sc.audio.promptBuilds = Array.isArray(sc.audio.promptBuilds) ? sc.audio.promptBuilds : [];
  return sc.audio;
}
function v642LatestSceneAudioBuild(sc) {
  return v642SceneAudio(sc).promptBuilds.at(-1) || null;
}
window.sceneAudioPromptBuilderMarkup = (sc) => {
  const audio = v642SceneAudio(sc), latest = v642LatestSceneAudioBuild(sc);
  const source = audio.sourceDirection || "";
  return `<section class="scene-audio-builder"><header><div><span>AI AUDIO PROMPT BUILDER</span><b>Turn imported or written direction into model-ready music and ambience prompts</b><small>CineBraid preserves your scene intent, then drafts separate Eleven Music, Suno, ambience/SFX, and mix-direction outputs.</small></div><button class="approve-btn" onclick="buildSceneAudioPrompts('${attr(sc.id)}')"${typeof aiDisabledAttrs === "function" ? aiDisabledAttrs("text") : ""}>BUILD / IMPROVE WITH AI</button></header><label class="scene-audio-source"><span>Source audio direction — imported or written by the user</span><textarea onchange="setValNested('scenes','${attr(sc.id)}','audio','sourceDirection',this.value)" placeholder="Describe the emotional arc, instrumentation, pace, motifs, diegetic sounds, music-vs-silence balance, and anything that must not appear.">${esc(source)}</textarea><small>Existing music, ambience, Suno, and audio-note fields are also supplied to the assistant. They are never discarded silently.</small></label><div class="scene-audio-copy-row"><button class="copy-btn" onclick="copyText(((sceneById('${attr(sc.id)}')||{}).audio||{}).music||'')">COPY ELEVEN MUSIC</button><button class="copy-btn" onclick="copyText(((sceneById('${attr(sc.id)}')||{}).audio||{}).sunoAltPrompt||'')">COPY SUNO</button><button class="copy-btn" onclick="copyText(((sceneById('${attr(sc.id)}')||{}).audio||{}).ambience||'')">COPY AMBIENCE / SFX</button></div>${latest ? `<details class="scene-audio-build-report"><summary>Latest AI build <span>${esc(new Date(latest.createdAt).toLocaleString())}</span></summary><p>${esc(latest.summary || "Model-ready audio prompts created.")}</p>${latest.changes?.length ? `<div><b>What changed</b><ul>${latest.changes.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>` : ""}${latest.warnings?.length ? `<div class="warn"><b>Warnings</b><ul>${latest.warnings.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>` : ""}</details>` : ""}</section>`;
};
window.buildSceneAudioPrompts = async (sceneId) => {
  const sc = sceneById(sceneId);
  if (!sc) return;
  const audio = v642SceneAudio(sc);
  const activityId = typeof v641StartManualActivity === "function" ? v641StartManualActivity("LOCAL AI · AUDIO PROMPT BUILDER", `Build music and ambience prompts — ${sc.title || sc.id}`, "Collecting scene intent, shot-level dialogue/SFX, existing prompts, and mix notes before sending them to the configured local AI.", { route: `#/scene/${sceneId}` }) : "";
  try {
    if (activityId && typeof v641UpdateManualActivity === "function") v641UpdateManualActivity(activityId, { detail: "The scene audio brief was sent to the local AI. Waiting for separate Eleven Music, Suno, ambience/SFX, and mix-direction outputs." });
    const response = await fetch("/api/llm/build-scene-audio-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId, sourceDirection: audio.sourceDirection || "", existing: { music: audio.music || "", ambience: audio.ambience || "", sunoAltPrompt: audio.sunoAltPrompt || "", notes: audio.notes || "" } }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not build scene audio prompts");
    const result = data.result || {};
    const snapshot = { music: audio.music || "", ambience: audio.ambience || "", sunoAltPrompt: audio.sunoAltPrompt || "", notes: audio.notes || "", sourceDirection: audio.sourceDirection || "" };
    audio.music = String(result.elevenLabsPrompt || audio.music || "");
    audio.sunoAltPrompt = String(result.sunoPrompt || audio.sunoAltPrompt || "");
    audio.ambience = String(result.ambiencePrompt || audio.ambience || "");
    audio.notes = String(result.audioNotes || audio.notes || "");
    audio.musicTool = audio.musicTool || "ElevenLabs Music";
    audio.promptBuilds.push({ id: `scene-audio-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), source: snapshot, output: { music: audio.music, ambience: audio.ambience, sunoAltPrompt: audio.sunoAltPrompt, notes: audio.notes }, summary: String(result.summary || "Model-ready scene audio prompts created."), changes: Array.isArray(result.changes) ? result.changes.map(String) : [], warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [] });
    if (audio.promptBuilds.length > 20) audio.promptBuilds.splice(0, audio.promptBuilds.length - 20);
    dirty();
    await flushPendingProjectSave();
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "completed", "Eleven Music, Suno, ambience/SFX, and mix-direction prompts were received, validated, and written to the scene audio fields.");
    toast("Scene audio prompts built");
    route();
  } catch (error) {
    if (activityId && typeof v641FinishManualActivity === "function") v641FinishManualActivity(activityId, "failed", error?.message || "Audio prompt building failed.");
    toast(error?.message || "Audio prompt building failed");
  }
};
