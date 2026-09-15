import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

// Exercises the /api/* Durable Object rate limiter (5 requests / 60s per client).
//
// Run against local wrangler dev:
//   k6 run load-test/rate-limiter.js
//
// Run against a deployed Worker:
//   k6 run -e BASE_URL=https://cloudflare-workers-lab.<your-subdomain>.workers.dev load-test/rate-limiter.js
//
// Note: the limiter keys on the `cf-connecting-ip` header. Against a real deployment,
// Cloudflare's edge overwrites that header with the actual client IP, so every VU in this
// script (all running from the same machine) shares one quota bucket — that's expected and
// is what the `single_client_burst` scenario below is testing. The `simulated_multi_client`
// scenario spoofs `cf-connecting-ip` per VU to exercise per-IP isolation; that spoofing only
// works against local `wrangler dev`, since Cloudflare strips/overwrites the header in prod.

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const PATH = '/api/hello/k6';

const RATE_LIMIT = 5;

const allowedResponses = new Counter('rate_limiter_allowed');
const limitedResponses = new Counter('rate_limiter_limited');

export const options = {
  scenarios: {
    // One client fires more requests than the quota allows in a single burst:
    // expect the first RATE_LIMIT to return 200 and the rest to return 429.
    single_client_burst: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: RATE_LIMIT + 3,
      maxDuration: '30s',
    },
    // Several distinct (spoofed) client IPs hit the same endpoint concurrently:
    // each should get its own independent quota. Local wrangler dev only — see note above.
    simulated_multi_client: {
      executor: 'per-vu-iterations',
      vus: 4,
      iterations: RATE_LIMIT + 2,
      maxDuration: '30s',
      startTime: '5s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
  },
};

export default function () {
  const isMultiClient = exec.scenario.name === 'simulated_multi_client';
  const headers = isMultiClient
    ? { 'cf-connecting-ip': `203.0.113.${10 + __VU}` }
    : {};

  const res = http.get(`${BASE_URL}${PATH}`, { headers });
  const remaining = res.headers['X-Ratelimit-Remaining'];

  if (res.status === 429) {
    limitedResponses.add(1);
    check(res, {
      '429 body reports Too Many Requests': (r) =>
        r.json('error') === 'Too Many Requests',
    });
  } else {
    allowedResponses.add(1);
    check(res, {
      '200 OK': (r) => r.status === 200,
      'x-ratelimit-limit header present': (r) =>
        r.headers['X-Ratelimit-Limit'] === String(RATE_LIMIT),
      'x-ratelimit-remaining header present': () => remaining !== undefined,
    });
  }

  sleep(0.1);
}
