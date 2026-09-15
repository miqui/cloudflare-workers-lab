# cloudflare-workers-lab

A minimal TypeScript Cloudflare Worker built with [Hono](https://hono.dev), scaffolded as a
lab/reference project for Workers + Hono API patterns.

## What it is

- A Hono app deployed as a Cloudflare Worker.
- Routes:
  - `GET /` — JSON hello-world payload with a timestamp and the request path.
  - `GET /api/hello/:name` — greets `:name`, validating it's 1-100 printable characters
    (400 otherwise).
  - `GET /api/headers` — echoes back `user-agent`, `cf-ray`, and `cf-ipcountry` request headers.
  - Any other route — JSON 404 fallback.
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
│   └── index.ts              # Hono app + default fetch handler
├── test/
│   └── index.spec.ts         # vitest tests (run in the real Workers runtime)
├── wrangler.jsonc             # Worker config: name, entrypoint, compatibility date, observability
├── tsconfig.json               # strict TS config, ES2022 target
├── vitest.config.ts            # defineWorkersConfig, points at wrangler.jsonc
├── worker-configuration.d.ts    # generated — Cloudflare.Env types (do not hand-edit)
└── .github/workflows/ci.yml     # npm ci, cf-typegen, typecheck, test on push/PR to main
```

## Bindings & generated types

This project has no bindings configured yet (no KV/D1/R2/etc). When you add bindings to
`wrangler.jsonc`, regenerate the types with:

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
