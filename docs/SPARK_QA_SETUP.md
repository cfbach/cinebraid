# Isolated CineBraid QA install on the DGX Spark

This sets up a **second, throwaway CineBraid** on the Spark that runs beside the
CineBraid already there. It does not upgrade, replace, migrate or touch the
existing install, its projects, or its configuration. If you ever want it gone,
you stop one process and delete one directory.

Everything below uses environment variables that CineBraid actually reads. They
were taken from the code, not invented:

| Variable | Read at | Effect | Default |
|---|---|---|---|
| `PORT` | `server.js` | listening port | `4477` |
| `CINEBRAID_HOST` | `server.js` | bind address | `127.0.0.1` |
| `CINEBRAID_LAN` | `server.js` | opt in to binding all interfaces | unset |
| `CINEBRAID_PROJECTS_ROOT` | `server.js` | **default** projects directory | `<install>/projects` |
| `CINEBRAID_CONFIG_PATH` | `config.js` | config file path | `<install>/data/config.json` |
| `FAL_KEY` | `fal-generation.js` | FAL credential | unset |
| `CINEBRAID_AI_TEXT_TIMEOUT_MS` | `llm.js` | local text model timeout | built-in |
| `CINEBRAID_AI_VISION_TIMEOUT_MS` | `llm.js` | local vision model timeout | built-in |
| `CINEBRAID_AI_EMBED_TIMEOUT_MS` | `llm.js` | local embedding timeout | built-in |

> **`CINEBRAID_PROJECTS_ROOT` sets a default, not an override.** A
> `workspace.projectRoot` saved in the config file wins over it. That is exactly
> why the QA install must also get its own `CINEBRAID_CONFIG_PATH`: with a fresh
> config file, `workspace.projectRoot` is empty and the environment variable
> holds. Sharing the production config would let the QA app be pointed back at
> production projects from inside Settings.

The Ollama endpoint is a **config field**, not an environment variable —
`ollamaUrl`, default `http://127.0.0.1:11434`, set in Settings. There is no
`OLLAMA_HOST` support to rely on.

---

## 1. Node

CineBraid requires Node.js 18 or newer. It is validated on **Node 24 (Active
LTS)**, which is what Windows CI runs, so install that.

```bash
node --version
```

If it is older than 24, install Node 24 from NodeSource or `nvm` **for your user
only**. Do not change a Node that the existing CineBraid depends on.

## 2. A QA candidate, built from a merged commit

The accepted internal flow is:

```
MERGED MAIN
    -> Spark fetches the exact merged SHA from GitHub
    -> package on the Spark
    -> record the artifact SHA256
    -> install as a NEW immutable QA candidate
    -> packaged acceptance
    -> ACCEPTED
    -> release eligible
```

Every step exists for a reason. Building **on the Spark from a named commit**
means the candidate provably corresponds to something on `main` rather than to
whatever happened to be in a working tree. Recording the **artifact SHA256**
means an acceptance verdict is attached to specific bytes. Installing a **new**
candidate directory rather than overwriting the previous one means a failed
candidate can be compared against, and rolled back to, without rebuilding.

```bash
mkdir -p "$HOME/cinebraid-qa/src" "$HOME/cinebraid-qa/artifacts"
cd "$HOME/cinebraid-qa/src"

# First time only.
git clone https://github.com/cfbach/cinebraid-app.git .

MERGED_SHA=<the merge commit on main>
git fetch origin main
git checkout --detach "$MERGED_SHA"
git rev-parse HEAD          # must print $MERGED_SHA
git status --porcelain      # must print nothing
```

Build the runtime archive from that exact tree and record what came out:

```bash
npm ci
npm run release:build

ARTIFACT=$(ls -t dist/*-runtime.tar.gz | head -n1)
sha256sum "$ARTIFACT" | tee "$HOME/cinebraid-qa/artifacts/$(basename "$ARTIFACT").sha256"
cp "$ARTIFACT" "$HOME/cinebraid-qa/artifacts/"
```

Keep that `.sha256` file. It is what a later acceptance verdict refers to, and
it is how you prove months from now which bytes were accepted.

Use the **runtime tarball**, not the Windows ZIP. It carries no `node_modules`,
so nothing x64-specific reaches the Spark's arm64 Linux — dependencies are built
and installed in the candidate directory, in step 4.

### Install it as a new immutable candidate

One directory per candidate, named for the commit. Never extract a new build
over an old one: a stale file left behind by an overwrite is exactly the kind of
thing packaged acceptance is supposed to rule out.

```bash
CANDIDATE="$HOME/cinebraid-qa/candidate-${MERGED_SHA:0:7}"
mkdir -p "$CANDIDATE"
cd "$CANDIDATE"

sha256sum -c "$HOME/cinebraid-qa/artifacts/$(basename "$ARTIFACT").sha256"
tar -xzf "$HOME/cinebraid-qa/artifacts/$(basename "$ARTIFACT")"
cd cinebraid-*
```

Treat the candidate directory as read-only from here on. Projects and config
live outside it (steps 3 and 5), so a candidate can be replaced without
disturbing either.

> **Copying a prebuilt artifact from a workstation is no longer the supported
> flow.** It cannot answer "which commit is this?" and it puts an x64 machine in
> the chain for an arm64 install. If you have to do it for a one-off, record the
> SHA256 and the commit by hand and say so in the acceptance note — but the
> fetch-and-build-on-Spark path above is what an acceptance verdict assumes.

## 3. Separate projects root and config path

```bash
mkdir -p "$HOME/cinebraid-qa/projects" "$HOME/cinebraid-qa/config"
```

Nothing in production is referenced by either path.

## 4. Install dependencies on the Spark itself

```bash
npm ci
```

Run this **on the Spark**. Never copy a `node_modules` from a Windows or x64
machine onto it. `npm ci` installs strictly from `package-lock.json` and fails if
the lockfile and `package.json` disagree.

## 5. Start the QA server

Start it directly rather than through `./start.sh`. The launcher hardcodes
`http://localhost:4477` for the browser it tries to open and runs `npm install`
rather than `npm ci`, neither of which is what an isolated QA install wants.

```bash
# The candidate directory from step 2 — one per merged commit.
cd "$CANDIDATE"/cinebraid-*

PORT=4488 \
CINEBRAID_HOST=127.0.0.1 \
CINEBRAID_PROJECTS_ROOT="$HOME/cinebraid-qa/projects" \
CINEBRAID_CONFIG_PATH="$HOME/cinebraid-qa/config/config.json" \
nohup node server.js > "$HOME/cinebraid-qa/qa-server.log" 2>&1 &

echo $! > "$HOME/cinebraid-qa/qa-server.pid"
```

Port **4488**, not 4477. Production keeps 4477.

`CINEBRAID_HOST=127.0.0.1` is the default and is stated here on purpose: the QA
server must stay loopback-only. Do **not** set `CINEBRAID_LAN` and do not pass
`--lan`.

## 6. Confirm it is up

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4488/
```

Expect `200`. Confirm the two installs are genuinely separate:

```bash
ss -ltnp | grep -E '4477|4488'
```

You should see two distinct listeners owned by two distinct PIDs.

## 7. Reach it from your desktop — SSH port forwarding

Do not expose the QA port. Forward it over the SSH session you already trust:

```bash
ssh -N -L 4488:127.0.0.1:4488 <your-spark-ssh-target>
```

Then open `http://127.0.0.1:4488` **on your desktop**. The traffic goes through
SSH; the Spark never listens on anything but loopback.

This is the safest supported access method. The alternative CineBraid offers —
`CINEBRAID_LAN` / `npm run start:lan` — binds all interfaces and is out of scope
for this test.

### Keeping it private

- Leave `CINEBRAID_HOST` at `127.0.0.1`.
- Never set `CINEBRAID_LAN`, never pass `--lan`.
- Do not open port 4488 in any firewall.
- Tear the SSH forward down when you finish testing.

## 8. Load a test project — a copy, never the original

```bash
cp -r /path/to/a/demo-project "$HOME/cinebraid-qa/projects/qa-demo"
```

Copy. Never move, symlink, or bind-mount a real project into the QA projects
root, and never point `CINEBRAID_PROJECTS_ROOT` at the production projects
directory. The QA build writes to whatever root it is given.

The shipped `cinebraid-sample` inside the extracted directory is already
available and is safe to open — opening it does not write to it.

**Never point QA at the real production project root.** If you want to reproduce
something seen in a production project, copy that project into the QA root and
work on the copy.

## 9. Stop the exact process

```bash
kill "$(cat "$HOME/cinebraid-qa/qa-server.pid")"
```

That stops the PID recorded at startup and nothing else. Confirm production is
untouched and the QA port is free:

```bash
ss -ltnp | grep -E '4477|4488'
```

4477 should still be listening; 4488 should be gone. Never use `pkill node` — it
would take the production server with it.

## 10. Roll back

```bash
kill "$(cat "$HOME/cinebraid-qa/qa-server.pid")"
rm -rf "$HOME/cinebraid-qa"
```

That is the whole rollback. The QA install writes only inside
`$HOME/cinebraid-qa`, so removing it leaves no trace and cannot affect the
production install, its projects or its configuration.

## 11. Move to a later candidate

Stop the server, then repeat step 2 for the new merged SHA — fetch it, build on
the Spark, record the artifact SHA256, and extract into a **new** candidate
directory:

```bash
kill "$(cat "$HOME/cinebraid-qa/qa-server.pid")"
```

Then start the new candidate with the **same** `PORT`,
`CINEBRAID_PROJECTS_ROOT` and `CINEBRAID_CONFIG_PATH` as before. Because both
live outside the candidate directory, your QA projects and settings survive the
change, and the previous candidate stays on disk until the new one is accepted —
which is what makes rolling back a matter of starting the old directory again.

### Acceptance and what it entitles

A candidate is **accepted** when packaged acceptance passes against that exact
artifact SHA256, on this install, with the real resident models. Only an
accepted candidate is **release eligible**. Acceptance is a statement about
specific bytes: rebuild, and the verdict does not carry over.

## 12. Collect local-model logs without exposing project content

The server log captures startup, request and model-call failures:

```bash
tail -n 200 "$HOME/cinebraid-qa/qa-server.log"
```

Local model timeouts are the usual thing to tune, and they are environment
variables:

```bash
CINEBRAID_AI_TEXT_TIMEOUT_MS=120000 \
CINEBRAID_AI_VISION_TIMEOUT_MS=180000 \
CINEBRAID_AI_EMBED_TIMEOUT_MS=60000 \
...
```

Ollama's own logs are the right place for model-side failures, and they contain
no CineBraid project content:

```bash
journalctl -u ollama --since '1 hour ago' --no-pager
```

**Before sharing any log**, note that a CineBraid server log can contain project
names, shot titles and prompt text in error messages. Share the specific failing
lines rather than the whole file, and redact prompt bodies:

```bash
grep -iE 'error|timeout|ECONNREFUSED|failed' "$HOME/cinebraid-qa/qa-server.log" | tail -n 50
```

If a report needs more than that, copy the lines into a scratch file and remove
project text by hand before sending it.

---

## What this test does not cover

- **Local Qwen vision/review is not validated in this release.** Exercising it is
  the point of the test, not a guarantee it works.
- **Image-provider generation is not authorized for this Spark QA.** Leave
  `FAL_KEY` unset and do not enter a key in Settings.
- **Video generation must remain disabled.**
- MiniMax H3 refuses aspect ratios it cannot deliver. That refusal is correct
  behaviour.
- Google Fonts is the only non-loopback request the browser makes. If your
  network blocks it, CineBraid still works; only the webfont fails to load.
