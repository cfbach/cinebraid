/* CineBraid — LOCAL FILE AFFORDANCES V1, the browser half.
 *
 * Two quiet actions on a piece of production media — `Show in Explorer` and
 * `Copy file path` — plus one project-level `Open project folder`. Nothing here
 * decides anything: it renders the truth public/shared-local-file.js derives and
 * the server settles, and it asks the server to act by IDENTITY.
 *
 * ---------------------------------------------------------------------------
 * ONE SLOT, RENDERED BY ONE FUNCTION, HYDRATED IN ONE PLACE.
 *
 * A surface that wants the affordance emits `localFileSlotMarkup(media)` and then
 * calls `hydrateLocalFileSlots(container)`. It never fetches, never learns a path
 * and never decides which buttons are valid. That is what keeps this from becoming
 * seven Explorer buttons that each drifted: adding a surface is emitting a slot.
 *
 * WHY THE SLOT IS ASYNCHRONOUS. Whether a file is on disk RIGHT NOW is a fact only
 * the filesystem holds, and the browser holds a scan that may be minutes old. The
 * slot therefore paints what it knows immediately — `Not stored locally yet` is
 * final and needs no round trip — and asks the server only when the media is
 * genuinely addressable. A surface never renders "stored on this computer" before
 * something has looked.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT.
 *
 * NO PATH IS EVER SENT UP. The body carries `key` and an optional project slug.
 * The absolute path travels one way only — down, in the answer — and the copy
 * action copies exactly the string the server resolved, so `Copy file path` and
 * `Show in Explorer` cannot disagree about which file they mean.
 *
 * NO REPAIR. A file that has gone from its recorded location is reported and left
 * alone. Relocation, re-linking and re-indexing are not in this slice, and a
 * button that quietly re-pointed a durable record at a similarly named file would
 * be the worst possible thing to put here.
 *
 * NO INVENTED DOWNLOAD. When media is not stored locally the slot says so and
 * stops. CineBraid collects provider results through its own generation pipeline;
 * offering a second, made-up "fetch this" here would be a new materialisation
 * system wearing a file action's clothes.
 */

(function () {
  if (typeof window === "undefined") return;

  /* The app's own bindings, read through `typeof` rather than off `window`: they
     are lexical `let`s in public/app.js, which is the same reason
     public/media-inspector.js and public/focused-workspaces.js read them this way. */
  function activeSlug() {
    return typeof ACTIVE_PROJECT_SLUG === "undefined" ? "" : String(ACTIVE_PROJECT_SLUG || "");
  }
  function say(message) {
    if (typeof toast === "function") toast(message);
  }
  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ==========================================================================
     THE REQUEST. Identity in, truth out. */
  async function ask(route, body) {
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, projectSlug: activeSlug() }),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (response.status === 403 && data.code === "LOOPBACK_REQUIRED")
      return { state: "unsupported", message: data.error || "Files can only be opened on the computer running CineBraid." };
    if (!response.ok && !data.state)
      return { state: "unresolvable", message: data.error || "CineBraid could not answer about that file." };
    return data;
  }

  /* ==========================================================================
     THE SLOT.

     `media` is either a production-media record or a raw scan row — both are
     accepted by localFileKey(), so a thumbnail can emit a slot without building a
     projection first. */
  function localFileSlotMarkup(media, options = {}) {
    const address = typeof localFileAddress === "function"
      ? localFileAddress(media)
      : { state: "unresolvable", key: "" };
    const label = options.label === undefined ? "On this computer" : options.label;
    /* FINAL ANSWERS ARE PAINTED NOW. `not-local` and `unresolvable` are decided by
       the shared contract from the record itself, so asking a server about a file
       that does not exist would be a round trip whose only possible result is the
       sentence already on screen. */
    const initialState = address.state === "addressable" ? "pending" : address.state;
    return `<article class="local-file-slot" data-local-file-slot="1"`
      + ` data-local-file-key="${escapeText(address.key)}"`
      + ` data-local-file-state="${escapeText(initialState)}">`
      + (label ? `<span>${escapeText(label)}</span>` : "")
      + `<div class="local-file-body">${bodyMarkup({ state: initialState })}</div>`
      + `</article>`;
  }

  /* Every state renders through here, so a surface cannot invent a fifth way for
     an unknown to look. The words come from the shared contract rather than from
     this file, so a toast, the slot and a server refusal all say the same thing. */
  function bodyMarkup(answer) {
    const state = String(answer.state || "unresolvable");
    const words = typeof localFileWords === "function" ? localFileWords(state) : "";
    if (state === "pending")
      return `<b class="local-file-pending">Checking this computer…</b>`;
    if (state === "available")
      /* THE KEY IS NOT IN THE onclick, AND THAT IS NOT A STYLE CHOICE.
         `'` is a legal Windows filename character, so a `path:` key can contain
         one. An HTML parser decodes `&#39;` in an attribute value BEFORE the
         handler text is parsed as JavaScript, so `onclick="reveal('a&#39;b.png')"`
         reaches the JS engine as `reveal('a'b.png')` — broken for the filmmaker
         whose file has an apostrophe in it, and a place where attacker-shaped text
         could reach a script context. The key travels as DATA on the slot and the
         delegated listener below reads it back, where a decoded apostrophe is
         simply an apostrophe. */
      return `<b class="local-file-here">${escapeText(words)}</b>`
        + `<code class="local-file-path" title="${escapeText(answer.path)}">${escapeText(answer.path)}</code>`
        + `<span class="local-file-actions">`
        + `<button type="button" class="ghost-btn local-file-btn" data-local-file-action="reveal">Show in Explorer</button>`
        + `<button type="button" class="ghost-btn local-file-btn" data-local-file-action="copy">Copy file path</button>`
        + `</span>`;
    if (state === "missing")
      /* PERSISTENT AND ACTIONABLE, and it offers no button. Revealing a recorded
         location that holds nothing would open a folder and read as success; the
         recorded path is printed instead, because that is what the filmmaker needs
         to go and look for it themselves. */
      return `<b class="local-file-gone">${escapeText(words)}</b>`
        + (answer.recordedPath
          ? `<code class="local-file-path local-file-path-gone">${escapeText(answer.recordedPath)}</code>` : "")
        + `<small class="local-file-note">CineBraid has not changed its record of this media. Move the file back, or replace it from the surface that produced it.</small>`;
    if (state === "unsupported")
      return `<b class="local-file-gone">${escapeText(answer.message || "Not available here")}</b>`;
    if (state === "not-local")
      /* No download button, deliberately. CineBraid materialises provider results
         through its own generation pipeline; a second one here would be a new
         system, not a file action. */
      return `<b class="local-file-remote">${escapeText(words)}</b>`
        + `<small class="local-file-note">CineBraid knows about this media but has not stored a copy in this project.</small>`;
    return `<b class="local-file-gone">${escapeText(answer.message || words)}</b>`;
  }

  function paint(slot, answer) {
    slot.setAttribute("data-local-file-state", String(answer.state || "unresolvable"));
    const body = slot.querySelector(".local-file-body");
    if (body) body.innerHTML = bodyMarkup(answer);
  }

  /* Hydrates every pending slot under `root`. Slots that already carry a final
     answer are left alone — re-asking about media the contract already settled
     would produce the same sentence at the cost of a request. */
  async function hydrateLocalFileSlots(root) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const slots = [...scope.querySelectorAll('[data-local-file-slot][data-local-file-state="pending"]')];
    for (const slot of slots) {
      const key = slot.getAttribute("data-local-file-key") || "";
      if (!key) {
        paint(slot, { state: "unresolvable" });
        continue;
      }
      try {
        paint(slot, await ask("/api/local-file/resolve", { key }));
      } catch (error) {
        paint(slot, { state: "unresolvable", message: "CineBraid could not reach the local file service." });
      }
    }
    return slots.length;
  }

  /* ==========================================================================
     THE ACTIONS.

     Both RE-RESOLVE before acting. The slot may have been painted before the
     filmmaker went to lunch, and a file can leave between paint and click; acting
     on the painted answer is how a stale success gets reported. */
  async function reveal(key) {
    const answer = await ask("/api/local-file/reveal", { key: String(key || "") });
    if (answer.ok) return true;
    say(answer.message || answer.error || "CineBraid could not open that file's folder.");
    return false;
  }

  async function copyPath(key) {
    const answer = await ask("/api/local-file/resolve", { key: String(key || "") });
    if (answer.state !== "available" || !answer.path) {
      say(answer.message || "CineBraid has no local file to copy for that media.");
      return false;
    }
    const copied = await writeClipboard(answer.path);
    say(copied ? "File path copied" : "Could not copy — the path is shown beside the file.");
    return copied;
  }

  async function openProjectFolder() {
    const answer = await ask("/api/local-file/project-folder", {});
    if (answer.ok) return true;
    say(answer.message || answer.error || "CineBraid could not open this project's folder.");
    return false;
  }

  /* The clipboard, and the fallback that keeps this working where it is blocked.
     `navigator.clipboard` needs a secure context and a permission that a browser
     may refuse; a filmmaker who cannot copy the path still has it on screen, and
     is told so rather than being left with a button that silently did nothing. */
  async function writeClipboard(text) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through to the legacy path */
    }
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "readonly");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok === true;
    } catch {
      return false;
    }
  }

  /* ONE DELEGATED LISTENER, installed once, for every slot on every surface —
     including slots painted into a modal that is rebuilt wholesale after each
     decision. Per-button binding would have to be re-run after every repaint and
     would silently stop working the first time a surface forgot. */
  document.addEventListener("click", (event) => {
    const button = event.target && event.target.closest
      ? event.target.closest("[data-local-file-action]")
      : null;
    if (!button) return;
    const slot = button.closest("[data-local-file-slot]");
    const key = slot ? slot.getAttribute("data-local-file-key") || "" : "";
    if (!key) return;
    event.preventDefault();
    const action = button.getAttribute("data-local-file-action");
    if (action === "reveal") reveal(key);
    else if (action === "copy") copyPath(key);
  });

  window.CineBraidLocalFile = {
    bodyMarkup,
    copyPath,
    hydrateLocalFileSlots,
    localFileSlotMarkup,
    openProjectFolder,
    reveal,
  };
  /* The two entry points a surface writes in an onclick attribute. Registered on
     `window` so tests/current-behavior.js's orphan-function scan sees a real call
     site rather than a top-level function nothing names. */
  window.openCineBraidProjectFolder = openProjectFolder;
})();
