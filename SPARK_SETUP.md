# CineBraid on DGX Spark

CineBraid requires Node.js 18 or newer, and is validated on Node 24 (Active LTS).

> Setting up a **second CineBraid beside an existing Spark install**? Use
> `docs/SPARK_QA_SETUP.md` instead. It covers the separate port, projects root and
> config path that keep a QA copy from touching production. This page describes
> the ordinary single install.

## Local start

```bash
cd /path/to/cinebraid
npm ci
npm start
```

Open `http://127.0.0.1:4477` on the Spark. The default listener is loopback-only.

## Deliberate desktop/LAN access

To use CineBraid from another computer:

1. Set an Editor passcode in CineBraid Settings.
2. Stop the server.
3. Start:

```bash
npm run start:lan
```

4. Find the Spark address with `hostname -I`.
5. Open `http://SPARK-IP:4477` from the trusted desktop.

LAN mode binds all interfaces and prints an exposure warning. Keep port 4477 limited to a trusted local network and do not expose it directly to the public internet.

## Manual-first use

The included Blue Parcel sample and all core production organization work without Ollama or FAL. Upload references and media made elsewhere, approve them, assign continuity, attach them to shots and finalize delivery.

## Optional local assistants

Ollama can provide text assistance and structured vision review when configured. These are optional services under Settings and do not control human approval authority.

## Optional FAL

Enable FAL only when in-app still generation is needed. Enter the key in Settings or provide `FAL_KEY` before startup. Paid requests require explicit confirmation, and the browser never receives the raw key.

Durable still automation stores resumable state in the project’s `automation-runs.json`. MiniMax H3 video generation is available as an optional explicit paid FAL action from Motion & sound; other video targets remain manual prompt packages unless separately connected.

## Validate

```bash
npm run check:quick
```

Use `npm run check` for the complete maintainer suite.
