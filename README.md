# cloudflare-workers-lab

A minimal TypeScript Cloudflare Worker built with [Hono](https://hono.dev), scaffolded as a
lab/reference project for Workers + Hono API patterns.

## What it is

- A Hono app deployed as a Cloudflare Worker.
- Routes:
  - `GET /` — JSON hello-world payload with a timestamp and the request path. Not rate limited.
  - `GET /api/hello/:name` — greets `:name`, validating it's 1-100 printable characters
    (400 otherwise).
  - `GET /api/headers` — echoes back `user-agent`, `cf-ray`, and `cf-ipcountry` request headers.
  - Any other route — JSON 404 fallback.
- Every `/api/*` route is gated by a Durable-Object-backed rate limiter: 5 requests per 60s
  window, keyed by the `cf-connecting-ip` request header (one Durable Object instance per
  client). Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
  `X-RateLimit-Reset` (unix seconds) headers; exceeding the quota returns
  `429 { "error": "Too Many Requests" }`. See `src/durable-objects/rate-limiter.ts`.
- Tests run against the real Workers runtime via `@cloudflare/vitest-pool-workers`.

## Prerequisites

- Node.js 22+
- npm 10+
- A Cloudflare account (only needed for `wrangler login` / `deploy`, not for local dev/test)

## Quickstart

```bash
npm install
npm run dev       # starts wrangler dev, local Workers runtime on http://localhost:8787
npm run deploy     # deploys to your Cloudflare account (requires auth, see "Deploying" below)
```

Other useful scripts:

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run cf-typegen # regenerate worker-configuration.d.ts from wrangler.jsonc
```

## Project layout

```
.
├── src/
│   ├── index.ts               # Hono app + default fetch handler
│   └── durable-objects/
│       └── rate-limiter.ts    # RateLimiter Durable Object (fixed-window quota + alarm cleanup)
├── test/
│   └── index.spec.ts         # vitest tests (run in the real Workers runtime)
├── wrangler.jsonc             # Worker config: name, entrypoint, compatibility date, observability,
│                              # durable_objects binding + migration
├── tsconfig.json               # strict TS config, ES2022 target
├── vitest.config.ts            # defineWorkersConfig, points at wrangler.jsonc
├── worker-configuration.d.ts    # generated — Cloudflare.Env types (do not hand-edit)
└── .github/workflows/ci.yml     # npm ci, cf-typegen, typecheck, test on push/PR to main
```

## Bindings & generated types

This project has one binding: `RATE_LIMITER`, a Durable Object namespace bound to the
`RateLimiter` class (see `wrangler.jsonc`'s `durable_objects` and `migrations` blocks — the
`new_sqlite_classes` migration uses the SQLite storage backend, which works on the Workers
Free plan). When you add or change bindings in `wrangler.jsonc`, regenerate the types with:

```bash
npm run cf-typegen
```

This runs `wrangler types` and rewrites `worker-configuration.d.ts`, which defines the
`Cloudflare.Env` type used as the Hono `Bindings` type in `src/index.ts`. Never hand-edit
`worker-configuration.d.ts` — always regenerate it after changing `wrangler.jsonc`.

## Deploying

Deployment is **not** automated in CI — it's a manual step for a human with Cloudflare
credentials:

```bash
npx wrangler login   # one-time OAuth login to your Cloudflare account
npm run deploy        # wrangler deploy
```

CI only runs install/typegen/typecheck/test — it never deploys and has no Cloudflare
credentials.

## Testing the rate limiter

The automated tests (`npm test`) already cover the rate limiter's behavior end-to-end against
the real Workers runtime (quota exhaustion, per-IP isolation, `/` staying exempt) — see the
`/api/* rate limiting (Durable Object)` block in `test/index.spec.ts`.

To see it live by hand, first inspect a single response to confirm the headers are there:

```bash
curl -s -D - -o /dev/null http://localhost:8787/api/hello/World
```

You should see `x-ratelimit-limit: 5`, `x-ratelimit-remaining: 4`, and `x-ratelimit-reset`
(a unix timestamp) alongside the `200`.

Then fire more requests than the limit (5 per 60s) and watch the status code and remaining
count on each one:

```bash
# against local wrangler dev (npm run dev, http://localhost:8787)
BASE=http://localhost:8787
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "request $i -> %{http_code}\n" "$BASE/api/hello/World"
done

# against your deployed Worker
BASE=https://cloudflare-workers-lab.<your-subdomain>.workers.dev
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "request $i -> %{http_code}\n" "$BASE/api/hello/World"
done
```

If you want the full headers on each attempt instead of just the status code:

```bash
for i in $(seq 1 6); do
  echo "--- request $i ---"
  curl -s -D - -o /dev/null "$BASE/api/hello/World" | grep -i ratelimit
done
```

Requests 1-5 return `200` with `x-ratelimit-remaining` counting down from 4 to 0; request 6
returns `429 {"error":"Too Many Requests"}`. Each client IP (`cf-connecting-ip`) gets its own
quota, so hitting the endpoint from a different IP (or waiting out the 60s window) resets it.
`GET /` has no rate-limit headers at all — it's excluded from the `/api/*` middleware.

### Load test with k6

[`load-test/rate-limiter.js`](load-test/rate-limiter.js) runs two scenarios: a single-client
burst that exceeds the quota (asserts 5×200 then 429s), and a simulated multi-client scenario
that spoofs `cf-connecting-ip` per VU to verify per-client isolation. Requires the
[k6](https://k6.io) binary (`brew install k6` or see [k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/)).

```bash
# against local wrangler dev (npm run dev, http://localhost:8787)
k6 run load-test/rate-limiter.js

# against your deployed Worker
k6 run -e BASE_URL=https://cloudflare-workers-lab.<your-subdomain>.workers.dev load-test/rate-limiter.js
```

Note: the multi-client scenario's spoofed `cf-connecting-ip` header only has effect against
local `wrangler dev` — a real Cloudflare deployment overwrites that header at the edge with the
actual client IP, so every VU running from the same machine will share one quota bucket there.
