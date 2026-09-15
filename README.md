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

To see it live by hand, fire more requests than the limit (5 per 60s) at any `/api/*` route
and watch the `x-ratelimit-*` headers and the 429 on the 6th request:

```bash
# against local wrangler dev (npm run dev, http://localhost:8787)
for i in 1 2 3 4 5 6; do curl -s -i http://localhost:8787/api/hello/World | head -6; echo; done

# against your deployed Worker
for i in 1 2 3 4 5 6; do curl -s -i https://cloudflare-workers-lab.<your-subdomain>.workers.dev/api/hello/World | head -6; echo; done
```

Requests 1-5 return `200` with `x-ratelimit-remaining` counting down from 4 to 0; request 6
returns `429 {"error":"Too Many Requests"}`. Each client IP (`cf-connecting-ip`) gets its own
quota, so hitting the endpoint from a different IP (or waiting out the 60s window) resets it.
`GET /` has no rate-limit headers at all — it's excluded from the `/api/*` middleware.
