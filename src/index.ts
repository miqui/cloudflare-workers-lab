import { Hono } from 'hono';

type Bindings = Cloudflare.Env;

const app = new Hono<{ Bindings: Bindings }>();

function isValidName(name: string): boolean {
  if (name.length === 0 || name.length > 100) return false;
  // reject non-printable characters (allow standard printable ASCII + common unicode letters)
  // eslint-disable-next-line no-control-regex
  const hasNonPrintable = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(name);
  return !hasNonPrintable;
}

app.get('/', (c) => {
  return c.json({
    message: 'Hello World from Cloudflare Workers!',
    timestamp: new Date().toISOString(),
    path: c.req.path,
  });
});

app.get('/api/hello/:name', (c) => {
  const name = c.req.param('name');

  if (!isValidName(name)) {
    return c.json(
      { error: 'Invalid name: must be 1-100 printable characters' },
      400,
    );
  }

  return c.json({
    message: `Hello, ${name}!`,
    name,
  });
});

app.get('/api/headers', (c) => {
  return c.json({
    'user-agent': c.req.header('user-agent') ?? null,
    'cf-ray': c.req.header('cf-ray') ?? null,
    'cf-ipcountry': c.req.header('cf-ipcountry') ?? null,
  });
});

app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
