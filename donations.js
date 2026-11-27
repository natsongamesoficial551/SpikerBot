const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');

const MIN_CENTS = 252;
const MAX_CENTS = 100_000;
const LINK_LIFETIME = 15 * 60_000;
const RECEIPT_LIFETIME = 24 * 60 * 60_000;
const DONATE_BUTTON = 'spiker:donate-pix';
const PANEL_TITLE = '💸 ┃ APOIE O SPIKERHAK — DOAÇÕES VIA PIX';
const PIX_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ASSETS = new Map([
  ['/doar', ['checkout.html', 'text/html; charset=utf-8']],
  ['/doar/', ['checkout.html', 'text/html; charset=utf-8']],
  ['/doar/checkout.css', ['checkout.css', 'text/css; charset=utf-8']],
  ['/doar/checkout.js', ['checkout.js', 'application/javascript; charset=utf-8']]
].map(([route, [name, type]]) => [route, [type, fs.readFileSync(path.join(__dirname, 'donations', name))]]));

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function sendJson(res, status, data) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

class CheckoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new CheckoutError(415, 'Formato de requisição inválido.');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) throw new CheckoutError(413, 'Requisição muito grande.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CheckoutError(400, 'Requisição inválida.');
  return body;
}

function configuredKey() {
  if (process.env.PROMISSE_API_KEY?.trim()) return process.env.PROMISSE_API_KEY.trim();
  try {
    return fs.readFileSync('/etc/secrets/PROMISSE_API_KEY', 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function createDonationsService({ guildId, channelId, baseUrl, apiKey = configuredKey(), request = fetch }) {
  const publicUrl = new URL(baseUrl || 'https://unconfigured.invalid');
  const enabled = Boolean(apiKey && baseUrl && publicUrl.protocol === 'https:');
  const receiptKey = createHmac('sha256', apiKey).update('spikerhak-pix-receipts').digest();
  const sessions = new Map();
  const byUser = new Map();
  const statusChecks = new Map();
  let rate = { from: 0, creations: 0, checks: 0 };

  function cleanExpired(now) {
    for (const [token, session] of sessions) {
      if (session.expiresAt > now || session.creating) continue;
      sessions.delete(token);
      if (byUser.get(session.user) === token) byUser.delete(session.user);
    }
    for (const [id, check] of statusChecks) {
      if (check.until <= now) statusChecks.delete(id);
    }
  }

  function takeRateLimit(operation, max, now) {
    if (now - rate.from >= 60_000) rate = { from: now, creations: 0, checks: 0 };
    if (rate[operation] >= max) throw new CheckoutError(429, 'Muitas solicitações. Tente novamente em instantes.');
    rate[operation]++;
  }

  async function gateway(route, amount) {
    const response = await request('https://api.promisse.com.br' + route, {
      method: amount === undefined ? 'GET' : 'POST',
      headers: { Authorization: apiKey, Accept: 'application/json', ...(amount === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: amount === undefined ? undefined : JSON.stringify({ amount }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.warn('[Doações] Promisse respondeu HTTP %d', response.status);
      throw new CheckoutError(response.status === 429 ? 429 : 502, 'A Promisse não conseguiu concluir a solicitação agora.');
    }
    return response.json();
  }

  function signReceipt(id, amount, now) {
    const payload = Buffer.from(JSON.stringify([id, amount, now + RECEIPT_LIFETIME])).toString('base64url');
    const signature = createHmac('sha256', receiptKey).update(payload).digest('base64url');
    return payload + '.' + signature;
  }

  function readReceipt(receipt, now) {
    if (typeof receipt !== 'string' || !/^[a-zA-Z0-9_-]{1,220}\.[a-zA-Z0-9_-]{43}$/.test(receipt)) {
      throw new CheckoutError(400, 'Comprovante inválido.');
    }
    const [payload, signature] = receipt.split('.');
    const expected = createHmac('sha256', receiptKey).update(payload).digest('base64url');
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new CheckoutError(403, 'Comprovante inválido.');
    const [id, amount, expires] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (expires <= now) throw new CheckoutError(410, 'O prazo de consulta deste Pix terminou.');
    return { id, amount };
  }

  async function createPix({ token, amount }, now) {
    if (!Number.isSafeInteger(amount) || amount < MIN_CENTS || amount > MAX_CENTS) {
      throw new CheckoutError(400, 'Informe um valor entre R$ 2,52 e R$ 1.000,00.');
    }
    const session = typeof token === 'string' && sessions.get(token);
    if (!session || session.expiresAt <= now) throw new CheckoutError(410, 'Link vencido. Abra a página pelo canal de doações.');
    if (session.pix) {
      if (session.pix.amount === amount) return session.pix;
      throw new CheckoutError(409, 'Já existe um Pix neste link. Use o QR Code original.');
    }
    if (session.creating || session.attempted) {
      throw new CheckoutError(409, 'Este link já foi usado para gerar um Pix. Aguarde ou volte ao Discord para abrir outro link.');
    }
    takeRateLimit('creations', 20, now);
    session.creating = true;
    try {
      const quote = await gateway(`/fees?type=deposit&amount=${amount}`);
      if (quote.amount !== amount || !Number.isSafeInteger(quote.net) || quote.net <= 0) {
        throw new CheckoutError(502, 'A taxa deste Pix não pôde ser confirmada.');
      }
      // A timed-out POST can still create a Pix. Never replay it on the same link.
      session.attempted = true;
      const pix = await gateway('/transactions', amount);
      if (pix.amount !== amount || typeof pix.id !== 'string' || !PIX_ID.test(pix.id) ||
          typeof pix.qrCodeBase64 !== 'string' || pix.qrCodeBase64.length > 400_000 ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(pix.qrCodeBase64) ||
          typeof pix.copyPaste !== 'string' || !/^[\x20-\x7e]{10,1200}$/.test(pix.copyPaste)) {
        throw new CheckoutError(502, 'A Promisse não retornou um QR Code válido.');
      }
      session.pix = {
        amount, qr: pix.qrCodeBase64, copyPaste: pix.copyPaste,
        expiresAt: Number.isFinite(Date.parse(pix.expiresAt)) ? new Date(pix.expiresAt).toISOString() : null,
        receipt: signReceipt(pix.id, amount, now)
      };
      return session.pix;
    } finally {
      session.creating = false;
    }
  }

  async function checkPix({ receipt }, now) {
    const { id, amount } = readReceipt(receipt, now);
    const cached = statusChecks.get(id);
    if (cached?.until > now) return cached.result;
    takeRateLimit('checks', 60, now);
    const result = (async () => {
      const transaction = await gateway('/transactions/' + encodeURIComponent(id));
      if (transaction.id !== id || transaction.amount !== amount || transaction.type !== 'DEPOSIT') {
        throw new CheckoutError(502, 'Não foi possível confirmar os dados deste Pix.');
      }
      const value = String(transaction.status).toLowerCase();
      const status = value === 'paid' ? 'paid' : ['expired','failed','cancelled','canceled'].includes(value) ? 'expired' : 'pending';
      return { status };
    })();
    statusChecks.set(id, { until: now + 5000, result });
    return result;
  }

  async function handleHttp(req, res) {
    const pathname = new URL(req.url, publicUrl).pathname;
    const asset = ASSETS.get(pathname);
    if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { ...securityHeaders, 'Content-Type': asset[0] });
      res.end(req.method === 'HEAD' ? undefined : asset[1]);
      return true;
    }
    if (!pathname.startsWith('/api/doacoes/')) return false;
    try {
      if (!['/api/doacoes/pix','/api/doacoes/status'].includes(pathname)) throw new CheckoutError(404, 'Página não encontrada.');
      if (!enabled) throw new CheckoutError(503, 'Doações por Pix estão indisponíveis.');
      if (req.headers.origin !== publicUrl.origin) throw new CheckoutError(403, 'Origem da página inválida.');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', publicUrl.origin);
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method'] === 'POST') {
        res.writeHead(204, {
          ...securityHeaders,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '300'
        });
        res.end();
        return true;
      }
      if (req.method !== 'POST') throw new CheckoutError(405, 'Método não permitido.');
      const now = Date.now();
      cleanExpired(now);
      const body = await readJson(req);
      const data = pathname.endsWith('/pix') ? await createPix(body, now) : await checkPix(body, now);
      sendJson(res, 200, data);
    } catch (error) {
      if (!(error instanceof CheckoutError)) console.error('[Doações] Falha no checkout:', error.name);
      sendJson(res, error instanceof CheckoutError ? error.status : 502, {
        error: error instanceof CheckoutError ? error.message : 'Não foi possível comunicar com a Promisse agora.'
      });
    }
    return true;
  }

  async function handleInteraction(interaction) {
    if (!interaction.isButton() || interaction.customId !== DONATE_BUTTON) return false;
    if (interaction.guildId !== guildId || interaction.channelId !== channelId || !enabled) {
      await interaction.reply({ content: 'A página de doações está indisponível nesta conversa.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const now = Date.now();
    cleanExpired(now);
    let token = byUser.get(interaction.user.id);
    if (!token) {
      if (sessions.size >= 500) {
        await interaction.reply({ content: 'O checkout está ocupado. Tente novamente em alguns minutos.', flags: MessageFlags.Ephemeral });
        return true;
      }
      token = randomBytes(32).toString('base64url');
      sessions.set(token, { user: interaction.user.id, expiresAt: now + LINK_LIFETIME });
      byUser.set(interaction.user.id, token);
    }
    const checkout = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Abrir página de doação')
      .setURL(new URL('/doar/#' + token, publicUrl).href);
    await interaction.reply({
      content: 'Abra seu link privado para escolher o valor e gerar o Pix.',
      flags: MessageFlags.Ephemeral, components: [new ActionRowBuilder().addComponents(checkout)]
    });
    return true;
  }

  async function publishPanel(channel, botId, announcement) {
    if (!enabled || channel.id !== channelId) return;
    const messages = await channel.messages.fetch({ limit: 50 });
    const previous = messages.find(message => message.author.id === botId &&
      message.embeds.some(embed => embed.title === PANEL_TITLE));
    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle(PANEL_TITLE).setDescription(
      'Apoie a comunidade SpikerHak com uma doação voluntária via Pix.\n\n' +
      '**Doação mínima: R$ 2,52.** Clique no botão para abrir um link privado no navegador, escolher o valor e gerar o QR Code pela PromissePay.'
    );
    const button = new ButtonBuilder().setCustomId(DONATE_BUTTON).setLabel('Doar via Pix').setStyle(ButtonStyle.Success);
    const panel = { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)], allowedMentions: { parse: [] } };
    if (!previous) await channel.send(panel);
    else if (previous.embeds[0]?.description !== embed.data.description ||
        !previous.components.some(row => row.components?.some(component => component.customId === DONATE_BUTTON))) {
      await previous.edit(panel);
    }
    if (announcement?.startsWith('@everyone ') && announcement.length <= 2000 &&
        !messages.some(message => message.author.id === botId && message.content === announcement)) {
      const nonce = createHash('sha256').update(announcement).digest('hex').slice(0, 24);
      await channel.send({
        content: announcement,
        allowedMentions: { parse: ['everyone'] },
        nonce,
        enforceNonce: true
      });
    }
  }

  return { handleHttp, handleInteraction, publishPanel };
}

module.exports = { createDonationsService };
