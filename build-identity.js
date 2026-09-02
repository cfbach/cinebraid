/* CineBraid build identity — WHICH BUILD of the release you are running.

   release-identity.js answers WHICH VERSION. It reads package.json, which is
   hand-written, and it is the only authority for that question. This file
   answers a different one that package.json cannot: two packages built from
   6.7.0-dev.1 a week apart are the same VERSION and different BUILDS, and when
   a tester reports "the project menu is wrong in 6.7.0-dev.1" the version alone
   does not say which bytes they were looking at.

   THE ANSWER IS ONLY EVER SUPPLIED, NEVER DISCOVERED, and the reasons are
   specific rather than stylistic:

     * NO RUNTIME GIT. CineBraid ships as an unpacked archive built with
       `git archive`, so an installed copy has no .git directory, and the
       machine it runs on need not have Git at all. A runtime that shelled out
       to `git rev-parse` would spawn a subprocess on every start, fail on every
       packaged install, and answer a question about the DEVELOPER'S checkout
       rather than about the running application. Nothing here spawns a process
       or reads .git; tests/shell-identity.js holds that line.

     * NO HARDCODED SHA. A commit hash written into a tracked file is wrong the
       moment it is committed — it names its own parent — and it stays wrong for
       every build made from it afterwards. A stale hash is worse than no hash,
       because it is believed.

   So there are exactly three sources, in this order, and no fourth:

     1. CINEBRAID_BUILD_ID in the environment. How a launcher, a container or a
        packaging step tells an installed copy which build it is.
     2. build-info.json beside this file. Written by the packaging step
        (scripts/build-release.js emits one next to the archives it builds) and
        dropped into an installed application root. It is not committed —
        .gitignore keeps it out — precisely so that it can never go stale in the
        repository.
     3. Neither: a development build, said plainly and boringly. This is the
        normal answer while working in a checkout, and it is TRUE, which is the
        only property that matters. It never invents an id, and it never claims
        a commit.

   The returned record is deliberately dull. `label` is what a filmmaker may see
   in About; `detail` is the sentence for diagnostics; `source` is how it was
   learnt. A caller that wants to know whether anything was supplied at all asks
   `supplied` rather than testing a string for emptiness. */

const fs = require("fs");
const path = require("path");

const BUILD_INFO_FILE = "build-info.json";

/* A supplied id is displayed short when — and only when — it actually looks like
   a Git object name. Truncating anything else would turn "2026-09-02-nightly"
   into "2026-09", which is a different and false identifier. */
function shortenBuildId(id) {
  const raw = String(id || "").trim();
  return /^[0-9a-f]{40}$/i.test(raw) || /^[0-9a-f]{64}$/i.test(raw) ? raw.slice(0, 7) : raw;
}

/* The file is optional and a malformed one is not a crash: a build that cannot
   read its own build note is still a runnable application, and the honest thing
   to say about it is the same thing said about a checkout — this is a
   development build. It is never guessed at, and never half-read. */
function readBuildInfo(root) {
  try {
    const file = path.join(root, BUILD_INFO_FILE);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function developmentIdentity() {
  return {
    supplied: false,
    source: "development",
    id: "",
    shortId: "",
    builtAt: "",
    label: "Development build",
    detail: "Development build — running from a source checkout, with no build identity supplied.",
  };
}

function suppliedIdentity(source, id, builtAt) {
  const shortId = shortenBuildId(id);
  const when = String(builtAt || "").trim();
  return {
    supplied: true,
    source,
    id: String(id).trim(),
    shortId,
    builtAt: when,
    label: `Build ${shortId}`,
    detail: `Build ${String(id).trim()}${when ? ` — packaged ${when}` : ""}.`,
  };
}

/* `env` and `root` are arguments rather than reads of the ambient process so a
   test can state a world instead of mutating the one it runs in. */
function buildIdentity({ env = process.env, root = __dirname } = {}) {
  const fromEnv = String(env.CINEBRAID_BUILD_ID || "").trim();
  if (fromEnv) return suppliedIdentity("environment", fromEnv, env.CINEBRAID_BUILD_DATE);

  const info = readBuildInfo(root);
  const fromFile = String(info?.commit || info?.buildId || "").trim();
  if (fromFile) return suppliedIdentity("build-info", fromFile, info?.builtAt);

  return developmentIdentity();
}

module.exports = { buildIdentity, shortenBuildId, BUILD_INFO_FILE };
