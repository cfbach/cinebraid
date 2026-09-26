/* Shot sound placement is a saved editorial intention, never an audio approval. */
(function () {
  "use strict";
  const roles = { dialogue: "Dialogue", ambience: "Ambience", music: "Music", effect: "Sound effect" };
  const timings = { "from-start": "From shot start", throughout: "Throughout shot", "at-cue": "At a cue" };
  const receiptKey = row => [row.entityId, row.receiptId, row.assetId, row.value].join("|");
  function available() {
    const current = new Set((P.audio || []).flatMap(entity =>
      (typeof entityProductionTruth === "function" ? entityProductionTruth(P, "audio", entity.id).canon : [])
        .map(receipt => [entity.id, receipt.receiptId || receipt.id, receipt.assetId, receipt.value].join("|"))));
    return (SCAN.audio || []).flatMap(file => (file.approvedAudio || [])
      .filter(row => file.available !== false && row.available && row.url && current.has(receiptKey(row)))
      .map(row => ({ ...row, name: (P.audio || []).find(entity => entity.id === row.entityId)?.name || row.entityId })));
  }
  function exact(placement) {
    return available().find(row => row.entityId === placement.audioEntityId
      && row.receiptId === placement.receiptId && row.assetId === placement.assetId
      && row.value === placement.sourceName);
  }
  function form(shotId, options) {
    return '<div class="sound-placement-form" data-sound-form="' + attr(shotId) + '">' +
      '<label>Approved recording<select data-sound-source><option value="">Choose recording…</option>' +
      options.map(row => '<option value="' + attr(receiptKey(row)) + '">' + esc(row.name) + ' · ' + esc(row.value) + '</option>').join("") +
      '</select></label><label>Sound role<select data-sound-role>' +
      Object.entries(roles).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join("") +
      '</select></label><label>Timing intent<select data-sound-timing>' +
      Object.entries(timings).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join("") +
      '</select></label><label>Timing note<input data-sound-cue maxlength="240" placeholder="e.g. door shuts at 00:03"></label>' +
      '<button type="button" class="approve-btn" data-sound-add="' + attr(shotId) + '"' + (options.length ? "" : " disabled") + '>Place recording</button>' +
      '<p class="sound-placement-message" role="status" data-sound-message></p></div>';
  }
  window.soundPlacementMarkup = function (shot) {
    const options = available();
    const placed = Array.isArray(shot.soundPlacements) ? shot.soundPlacements : [];
    return '<details class="sound-placement" data-sound-shot-id="' + attr(shot.id) + '"' + (placed.length ? ' open' : '') + '><summary>Sound placement <span>' + placed.length + ' placed</span></summary><div class="sound-placement-content"><header><div><h2>Approved recordings for this shot</h2>' +
      '<p>Choose an approved recording for this shot. Placement records the role and timing for external editing; it does not approve the recording or mix it into the shot.</p></div></header>' +
      (placed.length ? '<div class="sound-placement-list">' + placed.map(row => {
        const source = exact(row), ok = !!source;
        const entity = (P.audio || []).find(item => item.id === row.audioEntityId);
        return '<article data-sound-placement="' + attr(row.id) + '" class="' + (ok ? "" : "unavailable") + '">' +
          '<div class="sound-placement-row"><div><b>' + esc(entity?.name || row.audioEntityId || "Audio item") + '</b>' +
          '<p>' + esc(row.sourceName) + '</p></div><span>' + (ok ? "Original recording verified" : "Original recording unavailable · placement retained") + '</span></div>' +
          '<dl><div><dt>Role</dt><dd>' + esc(roles[row.role] || row.role) + '</dd></div><div><dt>Timing</dt><dd>' +
          esc(timings[row.timing] || row.timing) + (row.cue ? ' · ' + esc(row.cue) : "") + '</dd></div></dl>' +
          (ok ? '<audio controls preload="metadata" src="' + attr(source.url) + '" aria-label="Listen to placed recording ' + attr(row.sourceName) + '"></audio>' : '<p>Playback is withheld. Reimport and approve a new recording before placing its replacement.</p>') +
          '<div class="sound-placement-actions"><small>Receipt ' + esc(row.receiptId) + ' · Asset ' + esc(row.assetId) + '</small>' +
          '<button type="button" class="ghost-btn" data-sound-remove="' + attr(row.id) + '" data-sound-shot="' + attr(shot.id) + '">Remove placement</button></div></article>';
      }).join("") + '</div>' : '<p class="sound-placement-empty">No recording placed on this shot.</p>') +
      (options.length ? "" : '<p>Approve a recording in <a href="#/library/audio">Audio</a> before placing it here.</p>') +
      '<div data-sound-form-host></div></div></details>';
  };
  document.addEventListener("toggle", event => {
    const panel = event.target.closest?.("details.sound-placement");
    if (!panel?.open) return;
    const host = panel.querySelector("[data-sound-form-host]");
    if (host && !host.firstElementChild) host.innerHTML = form(panel.dataset.soundShotId, available());
  }, true);
  document.addEventListener("click", event => {
    if (typeof event.target?.closest !== "function") return;
    const add = event.target.closest("[data-sound-add]");
    if (add) {
      const shot = shotById(add.dataset.soundAdd), box = add.closest("[data-sound-form]");
      if (!shot || !box) return;
      const message = box.querySelector("[data-sound-message]");
      const selected = box.querySelector("[data-sound-source]").value;
      const row = selected ? available().find(item => receiptKey(item) === selected) : null;
      const role = box.querySelector("[data-sound-role]").value;
      const timing = box.querySelector("[data-sound-timing]").value;
      const cue = box.querySelector("[data-sound-cue]").value.trim();
      if (!row || !roles[role] || !timings[timing] || (timing === "at-cue" && !cue)) {
        message.textContent = "Choose an approved recording and give its role and timing. A cue needs a timing note.";
        return;
      }
      shot.soundPlacements = Array.isArray(shot.soundPlacements) ? shot.soundPlacements : [];
      shot.soundPlacements.push({ id: "sound-" + crypto.randomUUID(), audioEntityId: row.entityId,
        receiptId: row.receiptId, assetId: row.assetId, sourceName: row.value, role, timing, cue });
      dirty(); route();
      return;
    }
    const remove = event.target.closest("[data-sound-remove]");
    if (remove) {
      const shot = shotById(remove.dataset.soundShot);
      if (!shot || !Array.isArray(shot.soundPlacements)) return;
      shot.soundPlacements = shot.soundPlacements.filter(row => row.id !== remove.dataset.soundRemove);
      dirty(); route();
    }
  });
})();
