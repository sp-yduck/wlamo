/**
 * wlamo Cloudflare Worker.
 *
 * Inference runs entirely in the browser (wllama / WebAssembly). The Worker only:
 *  - serves the static UI from the ASSETS binding,
 *  - adds cross-origin isolation headers (COOP/COEP) so SharedArrayBuffer and
 *    therefore multi-threaded wasm are available,
 *  - sets long-lived caching for hashed build assets and the wasm binary.
 */
interface Env {
  ASSETS: Fetcher;
}

const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  // Hugging Face rejects model downloads whose Referer is *.workers.dev (404),
  // so never send a Referer.
  'Referrer-Policy': 'no-referrer',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, app: 'wlamo' }, { headers: ISOLATION_HEADERS });
    }

    const assetRes = await env.ASSETS.fetch(request);
    const res = new Response(assetRes.body, assetRes);
    for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.headers.set(k, v);

    if (url.pathname.startsWith('/assets/') && assetRes.ok) {
      res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    if (url.pathname.endsWith('.wasm')) {
      res.headers.set('Content-Type', 'application/wasm');
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
