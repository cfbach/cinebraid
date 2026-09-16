/* Settings → Accounts and Settings → Generation, for Civitai.
 *
 * Two panels, and the split between them is the product rule rather than a layout choice:
 *
 *   ACCOUNTS      who this CineBraid is at Civitai, and whether it may spend there.
 *                 Connecting is identity only and the panel says so; permission to spend
 *                 Buzz is a SECOND authorization asked for on the connected row.
 *   GENERATION    which account pays and which model runs. Beside fal, because Generation
 *                 retains the existing provider defaults. Local runtime setup remains
 *                 separate; a loopback address does not prove every workflow node is offline.
 *
 * NOTHING HERE HANDLES A CREDENTIAL. The browser starts an authorization and reads a
 * boolean; it never receives a token, a refresh token, an authorization code or a scope
 * value. The bitmask Civitai grants in is parsed on the server, in the one file that knows
 * Civitai's encoding, and what arrives here is CineBraid's own yes-or-no.
 */

/* Answered by the server, held for the current screen, and never guessed. An unloaded list
   draws nothing rather than drawing "not authorized" — a claim CineBraid has not checked is
   not a claim to put on a row. */
const CIVITAI_SETTINGS = { grants: [], loaded: false, loading: false, error: false };

window.civitaiGrantFor = (connectionId) => {
  if (!CIVITAI_SETTINGS.loaded) return null;
  return (CIVITAI_SETTINGS.grants || []).find((row) => row.connectionId === String(connectionId || "")) || null;
};

/* ---------------------------------------------------------------------------
   A BACKGROUND READ PAINTS ITS OWN CONTAINERS. IT NEVER RE-RENDERS THE SCREEN.
 *
 * This function used to end in `route()`. Settings schedules it whenever the Accounts or
 * Generation panel is drawn, so that one line was a loop: render → fetch → route() →
 * render → fetch → … It ran at about 26 iterations a second, and because every iteration
 * REPLACES the settings subtree, the panel became unusable — an input was detached from
 * the document before a keystroke could land, focus fell back to <body>, and a click on a
 * tab was released over a node that no longer existed.
 *
 * The fix is the discipline comfy-settings.js's refreshComfyWorkflowList() already keeps
 * and this file failed to copy: a panel that loads something asynchronously OWNS A
 * CONTAINER and writes into it. It does not ask the router to redraw the world, so it
 * cannot be part of a cycle, and it cannot destroy a control somebody is typing into —
 * the only nodes it touches are the ones it is responsible for.
 *
 * `loading` is not a cache. It only stops two overlapping fetches; every render still gets
 * a fresh answer, which is what keeps a disconnected account from lingering in the picker
 * after `disconnectAccount()` redraws. */
window.refreshCivitaiGrants = async () => {
  if (CIVITAI_SETTINGS.loading) return;
  CIVITAI_SETTINGS.loading = true;
  try {
    const response = await fetch("/api/generation/civitai/grants");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.grants)) throw new Error("Grant read failed");
    CIVITAI_SETTINGS.grants = data.grants;
    CIVITAI_SETTINGS.loaded = true;
    CIVITAI_SETTINGS.error = false;
  } catch {
    /* Keep the last list so a failed read cannot erase an unsaved account choice.
       loaded=false prevents those older grants from claiming current permission. */
    CIVITAI_SETTINGS.loaded = false;
    CIVITAI_SETTINGS.error = true;
  } finally {
    CIVITAI_SETTINGS.loading = false;
  }
  paintCivitaiGrants();
};

/* The three places a grant is visible, filled in place.
 *
 * Every target is addressed by the connection it belongs to, so a row that is no longer on
 * screen is simply not found and nothing is written for it. Nothing outside these nodes is
 * touched — which is the whole point, and is what makes this safe to call at any time. */
function paintCivitaiGrants() {
  const readNote = document.getElementById("civitai-grants-note");
  if (readNote) {
    readNote.innerHTML = CIVITAI_SETTINGS.error
      ? '<span>Could not read connected accounts. Your selection is preserved; generation permission is not verified.</span> <button class="ghost-btn" onclick="refreshCivitaiGrants()">Retry account check</button>'
      : "";
  }
  for (const host of document.querySelectorAll("[data-civitai-grant-note]")) {
    const grant = window.civitaiGrantFor(host.dataset.civitaiGrantNote);
    host.textContent = !grant
      ? (CIVITAI_SETTINGS.error ? "Could not read this account's generation permission. Retry the account check." : "")
      : grant.tokenSource === "api_key"
        ? "Connected with an API key, which carries whatever your Civitai account allows. CineBraid cannot check it in advance — Civitai decides at the moment of generating."
        : grant.generationAuthorized
          ? "CineBraid may generate on this account. Each generation is still priced and confirmed before anything is spent."
          : "Connected for identity only — CineBraid cannot generate on this account yet.";
  }
  for (const host of document.querySelectorAll("[data-civitai-grant-action]")) {
    const id = host.dataset.civitaiGrantAction;
    const grant = window.civitaiGrantFor(id);
    /* An API key carries the account holder's own permissions and has no scope CineBraid
       can widen, so there is nothing to offer. An already-authorized connection has
       nothing to grant either. */
    host.innerHTML = grant && grant.tokenSource !== "api_key" && !grant.generationAuthorized
      ? `<button class="add-btn" onclick="allowCivitaiGeneration('${attr(id)}')">Allow generation</button>`
      : "";
  }
  const picker = document.getElementById("cfg-civitai-connection");
  if (picker) {
    /* THE PERSON'S OWN UNSAVED CHOICE OUTRANKS THE SAVED ONE, AND "NONE" IS A CHOICE.
     *
     * This read `picker.value || picker.dataset.configured`, which cannot tell an
     * intentional clear from an untouched control: both give an empty string, so `||`
     * fell through to the configured account and a background grant refresh silently put
     * back the connection somebody had just removed. That is the same defect as the
     * render loop — a background read overwriting live input — one control smaller, and
     * "" is precisely the value it destroyed.
     *
     * So the two states are distinguished by a MARK the control carries only after a
     * person has actually changed it, not by whether its value is truthy. The mark lives
     * on the element, so a full views re-render — which builds a fresh control from the
     * configured value — correctly starts unmarked again.
     *
     * NOTHING IS SAVED HERE. A cleared picker stays cleared on screen; whether that
     * becomes durable is still the Save button's business and this touches no
     * persistence. */
    const chosenByPerson = picker.dataset.userChoice === "1";
    const chosen = chosenByPerson ? picker.value : (picker.dataset.configured || "");
    const markup = window.civitaiConnectionOptions(chosen);
    if (picker.innerHTML !== markup) picker.innerHTML = markup;
    /* Re-applied after the options are rewritten, because replacing innerHTML resets the
       selection to whichever option carries `selected`. An explicit "" is applied too —
       it is a value the person chose, not an absence to be filled in. */
    if (chosen === "" || [...picker.options].some((option) => option.value === chosen)) picker.value = chosen;
  }
}

/* The mark that makes an intentional clear survive a background refresh. Attached from the
   rendered control's own `onchange`, so it is present on the element a person touched and
   absent on a freshly rendered one. */
window.civitaiConnectionChosen = (select) => {
  if (select) select.dataset.userChoice = "1";
};
window.paintCivitaiGrants = paintCivitaiGrants;

/* The account picker on the Generation panel, built from the grants list rather than from
   the accounts projection — so it is drawn by the same source that decides whether an
   account may generate, and the two cannot disagree. */
window.civitaiConnectionOptions = (selected = "") => {
  const rows = CIVITAI_SETTINGS.grants || [];
  const chosen = String(selected || "");
  const prompt = CIVITAI_SETTINGS.error ? "Could not read accounts — retry the account check"
    : !rows.length ? (CIVITAI_SETTINGS.loaded ? "No Civitai account is connected" : "Loading connected accounts…")
      : "Choose a connected Civitai account";
  /* Preserve a selection even if the first read fails or a refreshed list no longer
     contains it. Naming it unavailable is different from silently clearing it. */
  const missing = chosen && !rows.some((row) => String(row.connectionId) === chosen)
    ? `<option value="${attr(chosen)}" selected>Selected account · ${CIVITAI_SETTINGS.loaded ? "no longer connected" : "availability not checked"}</option>` : "";
  return [`<option value="">${prompt}</option>`, missing]
    .concat(rows.map((row) => {
      const label = `${row.displayName ? `@${row.displayName}` : "Civitai account"}${CIVITAI_SETTINGS.error ? " · last read; recheck needed" : row.generationAuthorized ? "" : " · not allowed to generate yet"}`;
      return `<option value="${attr(row.connectionId)}" ${row.connectionId === String(selected || "") ? "selected" : ""}>${esc(label)}</option>`;
    }))
    .join("");
};

/* ---------------------------------------------------------------------------
   THE SPEND AUTHORIZATION.

   RE-AUTHORIZATION IS NEVER SILENT AND NEVER A SIDE EFFECT OF GENERATING. It is its own
   button, on the account it applies to, behind a dialog that says in plain words what is
   being granted and what is not. A person who pressed Generate and was quietly sent to a
   consent screen asking for permission to spend their Buzz would have been asked for
   something they did not come here to give.

   The dialog also states the limit that still holds afterwards, because it is the part
   that matters: granting this does not spend anything and does not let CineBraid spend
   anything on its own. Every generation is still priced and confirmed one at a time. */
window.allowCivitaiGeneration = (connectionId) => {
  const id = String(connectionId || "");
  if (!/^conn-[0-9a-f]{32}$/.test(id)) return toast("That account connection is not available");
  const grant = window.civitaiGrantFor(id);
  const who = grant?.displayName ? `@${grant.displayName}` : "this Civitai account";
  openModal(`<h3>Allow CineBraid to generate on Civitai</h3>
    <p class="modal-confirm-message">Civitai will ask you to grant CineBraid permission to use AI services on ${esc(who)}. That is the permission that lets a generation spend your Buzz.</p>
    <div class="candidate-evidence-facts">
      <article><span>Granting this</span><b>Spends nothing</b></article>
      <article><span>Every generation</span><b>Priced, then confirmed by you</b></article>
      <article><span>Buzz balance</span><b>Not read by CineBraid</b></article>
    </div>
    <p class="hint">CineBraid asks for permission to generate and to read back its own generations. It does not ask to read your Buzz balance, because no Civitai endpoint reports one to an application. You can withdraw this at any time from Connected Apps on civitai.com, and you can set a spending limit for CineBraid there.</p>
    <div class="modal-actions">
      <button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="approve-btn" onclick="startCivitaiGenerationGrant('${attr(id)}')">CONTINUE TO CIVITAI</button>
    </div>`);
};

window.startCivitaiGenerationGrant = async (connectionId) => {
  const id = String(connectionId || "");
  if (!/^conn-[0-9a-f]{32}$/.test(id)) return toast("That account connection is not available");
  try {
    const response = await fetch("/api/accounts/civitai/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* `grant` is a WORD, not a scope value. The adapter owns the vocabulary, so no
         caller — including this one — can ask a person to grant something the product did
         not choose to request. `connectionId` says this widens the account already
         connected rather than adding a second row for the same person. */
      body: JSON.stringify({ grant: "generation", connectionId: id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.authorizationUrl) throw new Error(data.error || "Could not start the authorization");
    /* A full-page navigation rather than a popup: the consent page belongs to Civitai, and
       a blocked popup is indistinguishable from a broken button. */
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    toast(error.message || "Could not start the authorization");
  }
};

/* ---------------------------------------------------------------------------
   MAY THIS ACCOUNT ACTUALLY GENERATE WITH THIS MODEL?

   `canGenerate` is answered by Civitai for the CALLING USER, so it is a fact about this
   account and this resource together and cannot be cached across either. The button reads
   what is currently in the field rather than what was last saved, so a person can check a
   model before committing it. The paying account must already be saved, because the
   existing resource route resolves that account from server configuration. */
window.checkCivitaiResource = async () => {
  const note = $("#civitai-resource-note");
  const saved = CONFIG.generation?.civitai || {};
  const account = $("#cfg-civitai-connection");
  if (account && String(account.value || "").trim() !== String(saved.connectionId || "").trim()) {
    if (note) { note.dataset.tone = "attention"; note.textContent = "Save generation settings before checking with a different account. This check uses the saved paying account; your selection is still here."; }
    account.focus();
    return;
  }
  const resourceField = $("#cfg-civitai-resource");
  const air = String(resourceField?.value ?? saved.resourceAir ?? "").trim();
  if (!air) {
    if (note) { note.dataset.tone = "attention"; note.textContent = "Enter a model AIR to check. No model was checked."; }
    resourceField?.focus();
    return;
  }
  const draftModel = air !== String(saved.resourceAir || "").trim();
  const checkContext = `${draftModel ? "Unsaved model" : "Model"} checked with the saved paying account. No generation submitted.`;
  if (note) { note.dataset.tone = "attention"; note.textContent = `Asking Civitai about ${draftModel ? "this unsaved model" : "this model"} with the saved paying account… No generation is submitted.`; }
  try {
    const response = await fetch("/api/generation/civitai/resource", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceAir: air }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "CineBraid could not check that model.");
    const resource = data.resource || {};
    if (!note) return;
    if (!resource.canGenerate) {
      note.dataset.tone = "attention";
      /* Two different refusals, and the difference is actionable: a gated resource is one
         this account could be given access to, and one that simply cannot be generated
         with is not. */
      note.textContent = (resource.checkPermission
        ? "Civitai says this model is gated for this account — early access or a private model."
        : "Civitai says this account cannot generate with this model.") + ` ${checkContext}`;
      return;
    }
    note.dataset.tone = "ready";
    note.textContent = `Available — ${[resource.modelName, resource.versionName].filter(Boolean).join(" · ") || air}. ${checkContext}`;
  } catch {
    if (note) { note.dataset.tone = "attention"; note.textContent = "Could not check this model with the saved paying account. Check the model AIR and account connection, then retry. Your edits are preserved; no generation submitted."; }
  }
};
