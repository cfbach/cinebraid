/* CineBraid async route boundary — a failed request must never end the server.
 *
 * Express 4 calls a route handler and IGNORES WHAT IT RETURNS. A synchronous throw is
 * caught by the router and answered; an `async` handler that throws does not throw — it
 * returns a rejected promise, nobody holds it, and Node's default for an unhandled
 * rejection is to terminate the process. Every async route was therefore one
 * unexpected read away from taking the whole local server down with it, answering the
 * browser with a reset connection and every later request with "refused".
 *
 * That is how a first-run Settings save ended the server: the save itself succeeded,
 * the readiness refresh that follows it asked GET /api/agents/status, and that route
 * read a project that does not exist yet.
 *
 * The boundary is installed once, where the app is created, so it covers every async
 * handler registered afterwards — server.js's own and those the generation, automation
 * and account modules register on the same app. It is NOT an exception filter:
 *
 *   - Only a REJECTED PROMISE returned by a handler is caught. Synchronous throws keep
 *     Express's own handling, and a handler that answers its own failures (almost all
 *     of them) never reaches this code.
 *   - The failure is not hidden. It is logged here in full and answered as a 500; the
 *     request fails exactly as it should, and only the process survives it.
 *   - The client is told that the request failed and nothing else. An error's message
 *     can carry an absolute path (ENOENT names the file) or a provider's reply, and its
 *     stack names the install folder, so neither is ever sent.
 *
 * Error-handling middleware (four parameters) is passed through untouched, because
 * Express decides what a function is by its arity and a wrapper would change it. */

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all"];

const ROUTE_FAILURE = Object.freeze({
  error: "CineBraid could not complete this request. The server is still running; try again, and reload if it keeps failing.",
  code: "ROUTE_FAILED",
});

function answerRouteFailure(req, res, error) {
  console.error(`API_ROUTE_FAILED ${req.method} ${req.path}: ${error?.stack || error?.message || error}`);
  /* A handler that had already started its answer cannot be given a second one. */
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.status(500).json(ROUTE_FAILURE);
}

function guardHandler(handler) {
  if (Array.isArray(handler)) return handler.map(guardHandler);
  if (typeof handler !== "function" || handler.length >= 4) return handler;
  return function asyncRouteBoundary(req, res, next) {
    const result = handler.call(this, req, res, next);
    if (result && typeof result.then === "function")
      result.then(undefined, (error) => answerRouteFailure(req, res, error));
    return result;
  };
}

function installAsyncRouteBoundary(app) {
  for (const method of ROUTE_METHODS) {
    const register = app[method];
    app[method] = function registerGuarded(route, ...handlers) {
      /* app.get(name) with nothing else is Express's settings getter, not a route. */
      if (!handlers.length) return register.call(this, route);
      return register.call(this, route, ...handlers.map(guardHandler));
    };
  }
  return app;
}

module.exports = { installAsyncRouteBoundary, ROUTE_FAILURE };
