const render = 'https://spikerbot.onrender.com';
const routes = new Set(['/api/doacoes/pix', '/api/doacoes/status']);
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function error(status, message) {
  return Response.json({ error: message }, { status, headers: securityHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return Response.redirect(new URL('/doar/', url), 302);
    if (url.pathname === '/doar') return Response.redirect(new URL('/doar/', url), 308);
    if (!url.pathname.startsWith('/api/')) {
      if (!['/doar/', '/doar/checkout.css', '/doar/checkout.js'].includes(url.pathname)) {
        return error(404, 'Página não encontrada.');
      }
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (!routes.has(url.pathname)) return error(404, 'Página não encontrada.');
    if (request.method !== 'POST') return error(405, 'Método não permitido.');
    if (request.headers.get('Origin') !== url.origin) return error(403, 'Origem da página inválida.');
    try {
      return await fetch(new URL(url.pathname, render), {
        method: 'POST',
        headers: {
          Origin: url.origin,
          'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream'
        },
        body: request.body,
        redirect: 'error'
      });
    } catch {
      return error(502, 'O servidor de doações está temporariamente indisponível.');
    }
  }
};
