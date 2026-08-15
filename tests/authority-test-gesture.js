/* THE TEST COMPOSITION'S GESTURE SOURCE — and it is not in the product.
 *
 * Batch 1C shipped `installHarnessManualActionSource` inside
 * public/shared-authority-kernel.js, exported onto `window` and onto
 * `window.CineBraidAuthorityKernel`. The 1C acceptance audit called it from
 * ordinary browser code, opened a gesture window with no event of any kind, and
 * minted a receipt reading `actor: "human"`. A test-only door in a shipped
 * module is a door, so it was deleted rather than renamed or hidden.
 *
 * WHAT REPLACED IT. The kernel now has exactly one way to open the gesture
 * window: `installBrowserManualActionSource(target)` registers capture-phase
 * listeners and each one refuses anything whose `event.isTrusted !== true`.
 * That is the real product path, and this file drives THAT path rather than
 * going around it.
 *
 * WHY THAT IS SAFE IN A REAL BROWSER AND USABLE HERE. `isTrusted` is set by the
 * user agent; `dispatchEvent` from page script always produces `false`. In Node
 * there is no user agent and no DOM, so the test composition supplies its own
 * event target — an object THIS FILE owns. Page script cannot reach it, cannot
 * reach the listeners registered on it, and cannot install a competing source,
 * because the kernel installs once and refuses every later caller.
 *
 * So the boundary is compositional, not conventional: the ability to say "a
 * person did this" belongs to whoever owns the event target, and in the product
 * that is the user agent.
 *
 * `manualActionSourceInstalled()` still answers "browser-trusted-event", which
 * is accurate — the source in force IS the trusted-event listener. What differs
 * in a test is who delivers the event, and that is this file, by name, in
 * tests/. */

/* A minimal capture-phase event target. Listeners live in this closure, not on
   the object, so nothing that merely holds the target can enumerate or invoke
   them. */
function testEventTarget() {
  const listeners = new Map();
  const target = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
  };
  return {
    target,
    /* Deliver an event the way a user agent does. Nothing in page scope can
       call this; the test file holds it. */
    fire(type = "click") {
      for (const handler of listeners.get(type) || []) handler({ type, isTrusted: true });
    },
    installed: () => listeners.size > 0,
  };
}

/* Install the REAL browser source on a target this composition owns, and return
   the same small surface the suites already use.
 *
 * `schedule` is handed to the kernel so the gesture window closes exactly when
 * the test says so instead of on a real macrotask — a suite that ran on
 * setTimeout would be racing its own assertions. */
function installTestManualActionSource(kernel) {
  const api = kernel && typeof kernel.installBrowserManualActionSource === "function" ? kernel : null;
  if (!api) throw new Error("installTestManualActionSource needs the authority kernel");
  const events = testEventTarget();
  let close = null;
  const installed = api.installBrowserManualActionSource(events.target, (fn) => { close = fn; });
  if (!installed) {
    throw new Error(
      "The manual-action source is already installed in this process. The kernel installs once on purpose; "
      + "a suite that needs its own source must be the first to install one.",
    );
  }
  const open = () => { events.fire("click"); };
  return {
    /* Run `body` inside one delivered trusted event, then close the window
       whether it returned or threw. */
    gesture(body) {
      open();
      try { return body(); }
      finally { if (close) close(); }
    },
    open,
    close: () => { if (close) close(); },
  };
}

module.exports = { installTestManualActionSource, testEventTarget };
