import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports.default;

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init);
}

describe('cloudflare-workers-lab worker', () => {
  it('GET / returns hello world json', async () => {
    const res = await worker.fetch(makeRequest('/'));
    expect(res.status).toBe(200);
    const body = await res.json<{ message: string; timestamp: string; path: string }>();
    expect(body.message).toBe('Hello World from Cloudflare Workers!');
    expect(body.path).toBe('/');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/hello/:name returns greeting', async () => {
    const res = await worker.fetch(makeRequest('/api/hello/Miguel'));
    expect(res.status).toBe(200);
    const body = await res.json<{ message: string; name: string }>();
    expect(body.message).toBe('Hello, Miguel!');
    expect(body.name).toBe('Miguel');
  });

  it('GET /api/hello/:name rejects names over 100 chars', async () => {
    const longName = 'a'.repeat(101);
    const res = await worker.fetch(makeRequest(`/api/hello/${longName}`));
    expect(res.status).toBe(400);
  });

  it('GET /api/hello/:name rejects non-printable characters', async () => {
    const res = await worker.fetch(
      makeRequest(`/api/hello/${encodeURIComponent('bad\x00name')}`),
    );
    expect(res.status).toBe(400);
  });

  it('GET /api/headers echoes request headers', async () => {
    const res = await worker.fetch(
      makeRequest('/api/headers', {
        headers: {
          'user-agent': 'vitest-agent',
          'cf-ray': 'test-ray-id',
          'cf-ipcountry': 'US',
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, string | null>>();
    expect(body['user-agent']).toBe('vitest-agent');
    expect(body['cf-ray']).toBe('test-ray-id');
    expect(body['cf-ipcountry']).toBe('US');
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await worker.fetch(makeRequest('/does/not/exist'));
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string; path: string }>();
    expect(body.error).toBe('Not Found');
    expect(body.path).toBe('/does/not/exist');
  });
});
