# Browser Access & Deployment

Cortex ships a browser workbench — the same SPA the [desktop app](desktop-app.md) wraps —
reachable from any browser without installing anything. This page covers **both** the
deployment runbook (building the SPA and enabling the Web UI endpoint on your server) and
the browser access path (reaching it through Cloudflare Access edge login).

There are two independent ways to reach the workbench, and they authenticate differently:

| Path | Who | Authentication | Holds `clientToken`? |
|---|---|---|---|
| **Browser** | Anyone with a browser | Cloudflare Access edge login (email / IdP), verified as a JWT by the server | **No** — the browser never sees the token |
| **Desktop (Tauri)** | The installed desktop app | Bearer `x-cortex-token` (the `clientToken`) stored in the OS keychain | Yes |

This page is the browser + deployment reference. For installing the native desktop app, see
[Desktop App](desktop-app.md).

## The optional Web UI package

The Web UI transport lives in an **optional, in-process add-on package**,
`@cortex-agent/ui-server`. The core agent-server (Slack / TUI only) does **not** carry
`@trpc/server` or any UI code: the package — and its dependencies — enter the runtime only
when you opt in with `CORTEX_UI_HTTP`. When the flag is unset, the package is never imported,
so a Slack- or TUI-only deployment pays zero UI weight.

When enabled, `@cortex-agent/ui-server`:

- serves the built SPA (`web/dist`) **same-origin** with the tRPC API — one port, one origin,
  so the browser loads `index.html` + assets and calls `/trpc` with no cross-origin plumbing;
- exposes the tRPC API at `/trpc` (HTTP batch for queries/mutations, SSE for subscriptions),
  connected in-process directly to the server's domain services (no proxy, no sidecar);
- gates every `/trpc` request behind a **dual-path auth** check (see
  [Authentication](#authentication)).

It runs in the same process as the server, binds to `127.0.0.1`, and is meant to be exposed
to the internet only through a tunnel.

## Deployment runbook (source → running server)

These steps take you from a fresh checkout to a Cortex server serving the browser workbench.

### 1. Prerequisites

- Node.js ≥ 20 and [pnpm](https://pnpm.io) (this repo is a pnpm workspace).
- A running Cortex server (see [Quickstart](quickstart.md)).

### 2. Build the SPA

The web SPA is built to `web/dist`. From the repo root:

```bash
pnpm install            # install workspace dependencies
pnpm -r run build       # build every workspace package, including web → web/dist
```

To build only the SPA and its dependencies:

```bash
pnpm --filter @cortex-agent/ui-contract run build
pnpm --filter web run build      # produces web/dist
```

`web/dist` is a plain static bundle (`index.html` + hashed assets). It is intentionally **not**
part of the published npm package — you build it at deploy time from source.

### 3. Where `web/dist` is served from

`@cortex-agent/ui-server` resolves the SPA directory in this order:

1. an explicit directory you pass to it;
2. the `CORTEX_UI_SPA_DIR` environment variable;
3. the monorepo's `web/dist`, resolved relative to the installed package.

If you deploy from a repo checkout, option 3 works with no configuration — build `web/dist`
in place and it is served automatically. If you deploy the built SPA to a different location,
point `CORTEX_UI_SPA_DIR` at it. If the directory is absent (SPA not built), non-`/trpc`
paths return a 404 placeholder while `/trpc` still works.

### 4. Enable the Web UI endpoint

Add to `~/.cortex/config/.env` on the server:

```bash
CORTEX_UI_HTTP=1          # opt-in: start the tRPC HTTP + SSE endpoint (required)
CORTEX_UI_PORT=3004       # optional; defaults to 3004
```

`CORTEX_UI_HTTP` accepts `1`, `true`, `on`, or `yes`. With it unset, the endpoint — and the
whole `@cortex-agent/ui-server` package — never loads.

### 5. Restart the daemon to apply

The daemon reads the SPA and env at startup, so a new build or env change takes effect on
restart:

```bash
cortex daemon   # or: systemctl --user restart cortex (if you registered a service)
```

!!! warning "Restarting is disruptive"
    Restarting the daemon interrupts any in-flight agents, threads, and scheduled work.
    Treat it as a deliberate, controlled action — schedule it when the system is idle, and
    if your Cortex instance runs under an approval policy, route the restart through that
    approval step rather than restarting ad hoc.

At this point the server is reachable at `http://127.0.0.1:3004` **on the server host only**.
Exposing it to a browser is the next section.

## Authentication

The `/trpc` auth gate accepts a request if **either** credential is valid, and returns `401`
before tRPC runs otherwise:

1. **`x-cortex-token` header** equal to the server's `clientToken` — the desktop / machine
   path. Checked first, with a constant-time comparison. Unchanged from before.
2. **A valid `Cf-Access-Jwt-Assertion` header** — the browser path. Cloudflare's edge injects
   this JWT after it authenticates the user; the server verifies it. **The browser never holds
   the `clientToken`.**

The server verifies the Access JWT against your Cloudflare Access team-domain JWKS, checking
the signature (RS256 / ES256 only), the audience (AUD) tag, the issuer, and expiry. If Access
is **not** configured on the server, the JWT path is disabled and the gate securely degrades to
token-only — an unconfigured Access path never admits a request.

## Browser access via Cloudflare Access

The browser path puts a **Cloudflare Access edge login in front of a dedicated UI hostname**,
so users log in with email / IdP at the edge and the server only ever sees an already-verified
request.

```
browser
  │  https (Cloudflare Access: email / IdP login at the edge)
  ▼
Cloudflare Tunnel   (cortex-ui.example.com  →  server localhost:3004)
  │  edge injects  Cf-Access-Jwt-Assertion  on every request
  ▼
@cortex-agent/ui-server  (verifies the JWT; the browser never holds clientToken)
  ├─ serves web/dist  (same-origin SPA)
  └─ serves /trpc     (same-origin real data, in-process)
```

### 1. Create a dedicated UI hostname and tunnel route

Point a Cloudflare Tunnel route from a **new** public hostname (for example
`cortex-ui.example.com`) to the server's loopback endpoint (`http://127.0.0.1:3004`, or your
`CORTEX_UI_PORT`).

!!! danger "Use a separate hostname from the cortex-client endpoint"
    The hostname your remote `cortex-client` instances connect to must **not** be placed behind
    Cloudflare Access — Access would block the WebSocket clients. Always give the browser UI its
    **own** hostname and apply Access only to that one.

### 2. Add a Cloudflare Access application (account-side ops)

In the Cloudflare Zero Trust dashboard, create a **self-hosted Access application** for the UI
hostname with a policy that allows your login email (or IdP group). This is an account-level
operation performed in the Cloudflare dashboard, not in Cortex config. Note the application's
**AUD tag** — you need it below.

### 3. Configure the server to verify Access JWTs

Add to `~/.cortex/config/.env` on the server:

```bash
CORTEX_ACCESS_TEAM_DOMAIN=your-team      # bare team name, or your-team.cloudflareaccess.com
CORTEX_ACCESS_AUD=<your-access-app-AUD>  # the Access application's AUD tag
# CORTEX_ACCESS_CERTS_URL=...            # optional: override the derived JWKS URL
```

From `CORTEX_ACCESS_TEAM_DOMAIN` the server derives the issuer
(`https://your-team.cloudflareaccess.com`) and the JWKS URL
(`https://your-team.cloudflareaccess.com/cdn-cgi/access/certs`). If **either**
`CORTEX_ACCESS_TEAM_DOMAIN` or `CORTEX_ACCESS_AUD` is unset, the browser path stays disabled
(token-only). Restart the daemon after changing these values.

### 4. Open the workbench

Navigate to `https://cortex-ui.example.com`. Cloudflare Access challenges you for email / IdP
login; after you authenticate, the edge forwards every request with a verified
`Cf-Access-Jwt-Assertion`, the server serves the same-origin SPA, and the workbench loads real
tRPC data — no token, no local install.

## Browser path vs desktop bearer-token path

Both paths reach the same `/trpc` API and the same workbench, but they differ in **where** and
**how** they authenticate:

| | Browser | Desktop (Tauri) |
|---|---|---|
| Hostname | Dedicated UI hostname **behind** Cloudflare Access | A hostname **not** behind Access |
| Login | Cloudflare Access edge login (email / IdP) | Enter `serverUrl` + `clientToken` once |
| Credential on requests | `Cf-Access-Jwt-Assertion` (issued by the edge) | `x-cortex-token` header |
| Where auth is checked | JWT verified by the server | Token verified by the server |
| `clientToken` exposure | **Never touches the browser** | Stored in the OS keychain |
| SPA origin | Same-origin (SPA + `/trpc` on one host) | Direct connection to `/trpc` (CORS-enabled) |

Because the desktop app sends `x-cortex-token`, it must connect through a hostname that is
**not** behind Cloudflare Access (Access would block the bearer request at the edge). The
browser path is the opposite: Access does the login, and the browser gets in **without** ever
holding the token. Choose the desktop app when you want a native window and are comfortable
storing the token locally; choose the browser path when you want zero install and IdP-managed
access.

## Troubleshooting

**Browser gets a Cloudflare login loop or `403` at the edge**

The Access application policy does not allow your identity. Check the policy on the UI
hostname's Access application in the Cloudflare Zero Trust dashboard.

**Browser logs in at the edge but the workbench shows `401` / no data**

The edge authenticated you but the server rejected the JWT. Confirm on the server that
`CORTEX_ACCESS_TEAM_DOMAIN` matches your team and `CORTEX_ACCESS_AUD` matches the Access
application's AUD tag exactly, and that the daemon was restarted after setting them. With those
unset, the browser path is disabled and every browser request is `401`.

**The page loads but `/trpc` calls `404`**

`web/dist` was not found, so only the API is served. Build the SPA (`pnpm --filter web run
build`) or point `CORTEX_UI_SPA_DIR` at your built bundle, then restart.

**Nothing is reachable at the UI hostname**

1. Confirm `CORTEX_UI_HTTP=1` is set and the daemon was restarted after adding it.
2. On the server, confirm the endpoint is up: `curl http://127.0.0.1:3004/trpc` should return a
   tRPC error (not connection-refused).
3. Confirm the Cloudflare Tunnel is running and its route points at the correct port.
