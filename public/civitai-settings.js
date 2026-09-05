/* Settings → Accounts and Settings → Generation, for Civitai.
 *
 * Two panels, and the split between them is the product rule rather than a layout choice:
 *
 *   ACCOUNTS      who this CineBraid is at Civitai, and whether it may spend there.
 *                 Connecting is identity only and the panel says so; permission to spend
 *                 Buzz is a SECOND authorization asked for on the connected row.
 *   GENERATION    which account pays and which model runs. Beside fal, because Generation
 *                 is the panel that configures a hosted provider that bills — Integrations
 *                 states in words that nothing on it can spend money, and that stays true.
 *
 * NOTHING HERE HANDLES A CREDENTIAL. The browser starts an authorization and reads a
 * boolean; it never receives a token, a refresh token, an authorization code or a scope
 * value. The bitmask Civitai grants in is parsed on the server, in the one file that knows
 * Civitai's encoding, and what arrives here is CineBraid's own yes-or-no.
 */

/* Answered by the server, cached for a render, and never guessed. An unloaded list draws
   nothing rather than drawing "not authorized" — a claim CineBraid has not checked is not
   a claim to put on a row. */
const CIVITAI_SETTINGS = { grants: [], loaded: false };

window.civitaiGrantFor = (connectionId) => {
  if (!CIVITAI_SETTINGS.loaded) return null;
  return (CIVITAI_SETTINGS.grants || []).find((row) => row.connectionId === String(connectionId || "")) || null;
};

window.refreshCivitaiGrants = async () => {
  try {
    const response = await fetch("/api/generation/civitai/grants");
    const data = await response.json().catch(() => ({}));
    CIVITAI_SETTINGS.grants = response.ok && Array.isArray(data.grants) ? data.grants : [];
    CIVITAI_SETTINGS.loaded = response.ok;
  } catch {
    CIVITAI_SETTINGS.grants = [];
    CIVITAI_SETTINGS.loaded = false;
  }
  if (typeof route === "function") route();
};

/* The account picker on the Generation panel, built from the grants list rather than from
   the accounts projection — so it is drawn by the same source that decides whether an
   account may generate, and the two cannot disagree. */
window.civitaiConnectionOptions = (selected = "") => {
  const rows = CIVITAI_SETTINGS.grants || [];
  if (!rows.length)
    return `<option value="">${CIVITAI_SETTINGS.loaded ? "No Civitai account is connected" : "Loading connected accounts…"}</option>`;
  return [`<option value="">Choose a connected Civitai account</option>`]
    .concat(rows.map((row) => {
      const label = `${row.displayName ? `@${row.displayName}` : "Civitai account"}${row.generationAuthorized ? "" : " · not allowed to generate yet"}`;
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
   model before committing it — the same shape as ComfyUI's Test connection. */
window.checkCivitaiResource = async () => {
  const note = $("#civitai-resource-note");
  const air = String($("#cfg-civitai-resource")?.value || "").trim();
  if (note) { note.dataset.tone = "attention"; note.textContent = "Asking Civitai about this model…"; }
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
      note.textContent = resource.checkPermission
        ? "Civitai says this model is gated for this account — early access or a private model."
        : "Civitai says this account cannot generate with this model.";
      return;
    }
    note.dataset.tone = "ready";
    note.textContent = `Ready — ${[resource.modelName, resource.versionName].filter(Boolean).join(" · ") || air}`;
  } catch (error) {
    if (note) { note.dataset.tone = "attention"; note.textContent = error.message || "CineBraid could not check that model."; }
  }
};
