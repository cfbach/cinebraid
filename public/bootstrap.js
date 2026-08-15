/* K1A — THE TRUSTED MANUAL ACTION BOUNDARY, INSTALLED ONCE.
 *
 * This is the only place CineBraid learns what a human gesture is. A
 * capture-phase listener on `document` opens a short window whenever the user
 * agent reports `isTrusted` — which page script cannot forge — and every
 * approval handler mints its capability inside that window, synchronously, in
 * its own prologue.
 *
 * Automation runs in `await` continuations and timer callbacks, always outside
 * the window, so it cannot mint. That is the entire separation between "a
 * person approved this" and "code called a function", and for a local
 * single-user tool it is the proportionate amount of it: no login, no identity,
 * no cryptography, one primitive the browser already gives us for free.
 *
 * Without this line, every approval in the product refuses. That is the correct
 * failure direction and it is why it is the first thing that runs. */
if (typeof installBrowserManualActionSource === "function") installBrowserManualActionSource();

/* Start after every view and action module has loaded. */
load()
  .then(() => {
    document.body.dataset.renderReady = "1";
    if (window.__CINEBRAID_COMPOSER_607_DISABLED) {
      document.body.dataset.composerSafeMode = "1";
      if (typeof toast === "function") {
        toast(
          window.__CINEBRAID_COMPOSER_607_ERROR
            ? "Composer recovery mode enabled — Shots and navigation are available"
            : "Stable workspace mode enabled",
        );
      }
    }
  })
  .catch((error) => {
    const message = error?.message || String(error);
    document.body.dataset.renderError = message;
    /* A project that could not be read is not a rendering bug. Name the project, print the real
       file path, keep the project switcher usable, and never leave a "Saved" indicator up. */
    if (error?.projectFailure) {
      console.warn(
        `CineBraid could not open the project "${error.projectFailure.slug}":`,
        message,
      );
      document.body.dataset.projectLoadFailed = error.projectFailure.slug || "1";
      if (typeof markProjectLoadFailure === "function")
        markProjectLoadFailure(error.projectFailure);
      if (typeof renderProjectFailureScreen === "function") {
        renderProjectFailureScreen(error.projectFailure, message);
        return;
      }
    }
    console.error("CineBraid failed to render:", error);
    const main = document.getElementById("main");
    if (main) {
      const safe = String(message).replace(/[&<>"]/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[c]);
      main.innerHTML = `<section class="empty-state"><h2>CineBraid could not render</h2><p>${safe}</p>${typeof window.reloadCineBraidSafe === "function" ? '<button class="ghost-btn" onclick="reloadCineBraidSafe()">Reload stable workspace</button>' : ""}</section>`;
    }
  });
