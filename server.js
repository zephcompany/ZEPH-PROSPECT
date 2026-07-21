'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

const KIWIFY_CLIENT_ID     = process.env.KIWIFY_CLIENT_ID     || '';
const KIWIFY_CLIENT_SECRET = process.env.KIWIFY_CLIENT_SECRET || '';
const KIWIFY_ACCOUNT_ID    = process.env.KIWIFY_ACCOUNT_ID    || '';
const KIWIFY_PRODUCT_ID    = process.env.KIWIFY_PRODUCT_ID    || '';
const KIWIFY_WEBHOOK_TOKEN = process.env.KIWIFY_WEBHOOK_TOKEN || '';
const ACCESS_DAYS          = parseInt(process.env.ACCESS_DAYS) || 30;
const API_SECRET           = process.env.API_SECRET || '';
const DATA_DIR             = process.env.DATA_DIR || '/data';

const KIWIFY_BASE = 'https://public-api.kiwify.com/v1';

// ═══════════════════════════════════════════════════════════════════════════════
//  BANCO DE DADOS (JSON em disco)
// ═══════════════════════════════════════════════════════════════════════════════

const DB_FILE = path.join(DATA_DIR, 'users.json');
let usersDB = {};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      usersDB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log(`[DB] Carregado: ${Object.keys(usersDB).length} usuarios`);
    }
  } catch (err) {
    console.error('[DB] Erro ao carregar:', err.message);
    usersDB = {};
  }
}

function saveDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2));
  } catch (err) {
    console.error('[DB] Erro ao salvar:', err.message);
  }
}

function makeExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + ACCESS_DAYS);
  return d.toISOString();
}

function setUser(email, status, customerName, resetExpiry) {
  const key = email.trim().toLowerCase();
  const existing = usersDB[key] || {};

  usersDB[key] = {
    status,
    customerName: customerName || existing.customerName || '',
    updatedAt: new Date().toISOString(),
    expiresAt: resetExpiry ? makeExpiresAt() : (existing.expiresAt || null),
  };
  saveDB();
  console.log(`[DB] ${key} -> ${status}` + (resetExpiry ? ` (expira em ${ACCESS_DAYS} dias)` : ''));
}

function getUser(email) {
  return usersDB[email.trim().toLowerCase()] || null;
}

function isUserActive(user) {
  if (!user || user.status !== 'active') return false;
  if (!user.expiresAt) return false;
  return new Date() < new Date(user.expiresAt);
}

loadDB();

// ─── MIGRAÇÃO: corrigir expiresAt com base nas datas reais de compra ────────
// Roda uma vez. Sobrescreve usuários antigos com os dados corretos do CSV.
(function migrateFromCSV() {
  const csvData = {
    "rafaleitesantos@hotmail.com": { s: "active", e: "2026-08-20T12:33:35.000Z" },
    "ds6877354@gmail.com": { s: "active", e: "2026-07-25T13:48:58.000Z" },
    "douglas1210sousa@gmail.com": { s: "expired", e: "2026-07-06T03:35:33.000Z" },
    "resendeclaraana@gmail.com": { s: "refunded", e: null },
    "elizabethmelo1507@gmail.com": { s: "refunded", e: null },
    "eduardolima999@gmail.com": { s: "expired", e: "2026-06-30T12:41:12.000Z" },
    "jonathanalvesdesigner@gmail.com": { s: "expired", e: "2026-06-28T21:38:10.000Z" },
    "williamwalking@hotmail.com": { s: "refunded", e: null },
    "dalexandrial@gmail.com": { s: "expired", e: "2026-06-26T12:14:42.000Z" },
    "contato.eltonmiranda@gmail.com": { s: "expired", e: "2026-06-25T21:14:38.000Z" },
    "victor50@outlook.pt": { s: "expired", e: "2026-06-24T14:52:25.000Z" },
    "winderfilho.designer@gmail.com": { s: "expired", e: "2026-06-24T10:43:58.000Z" },
    "lucasediitor.marte@gmail.com": { s: "refunded", e: null },
    "edelvan730@gmail.com": { s: "refunded", e: null },
    "cursoprodutor@gmail.com": { s: "expired", e: "2026-06-20T19:56:20.000Z" },
    "lrobcost@gmail.com": { s: "expired", e: "2026-06-20T16:46:15.000Z" },
    "gustavluiz2005@gmail.com": { s: "expired", e: "2026-06-20T16:01:29.000Z" },
    "adantasjunior2026@hotmail.com": { s: "expired", e: "2026-06-19T17:09:21.000Z" },
    "arthur.moreirawd@gmail.com": { s: "expired", e: "2026-06-19T14:01:51.000Z" },
    "noliv23@gmail.com": { s: "expired", e: "2026-06-18T16:25:20.000Z" },
    "safetyvolt12@gmail.com": { s: "expired", e: "2026-06-18T14:49:32.000Z" },
    "mattheus328@gmail.com": { s: "expired", e: "2026-06-17T23:54:47.000Z" },
    "brunoemonynha@gmail.com": { s: "expired", e: "2026-06-16T15:54:59.000Z" },
    "nadjabreno8@gmail.com": { s: "expired", e: "2026-06-14T09:06:27.000Z" },
    "edsonaraujoodesign76@gmail.com": { s: "expired", e: "2026-06-14T08:01:28.000Z" },
    "henriquethesola@gmail.com": { s: "expired", e: "2026-06-12T14:13:02.000Z" },
    "simaomendesgui@yahoo.com.br": { s: "expired", e: "2026-06-10T23:34:10.000Z" },
    "richardrico550@gmail.com": { s: "expired", e: "2026-06-10T12:23:12.000Z" },
    "joaopaixao1020@gmail.com": { s: "refunded", e: null },
    "designfromvinny@gmail.com": { s: "refunded", e: null },
    "edcleissonsantos22@hotmail.com": { s: "expired", e: "2026-06-10T07:19:18.000Z" },
    "diogodbs.55db@gmail.com": { s: "expired", e: "2026-06-09T19:44:09.000Z" },
    "vgalvesdias@gmail.com": { s: "expired", e: "2026-06-07T15:28:43.000Z" },
    "a33n33pn@gmail.com": { s: "expired", e: "2026-06-07T10:35:45.000Z" },
    "qrg.hanna@gmail.com": { s: "expired", e: "2026-06-06T15:59:20.000Z" },
    "bruunaavc@gmail.com": { s: "refunded", e: null },
    "kleberaa1012@gmail.com": { s: "expired", e: "2026-05-31T22:42:01.000Z" },
    "brann.duartedsgn@gmail.com": { s: "expired", e: "2026-05-31T14:37:11.000Z" },
    "felipedsgnui@gmail.com": { s: "expired", e: "2026-05-31T12:09:40.000Z" },
    "joaomtf.matta@gmail.com": { s: "expired", e: "2026-05-30T20:05:30.000Z" },
    "airupagencia@gmail.com": { s: "expired", e: "2026-05-28T22:55:09.000Z" },
    "karineluizewd@gmail.com": { s: "expired", e: "2026-05-27T14:20:22.000Z" },
    "contatokauanalvess@gmail.com": { s: "expired", e: "2026-05-26T14:02:17.000Z" },
    "thimalaquias@hotmail.com": { s: "expired", e: "2026-05-25T06:11:51.000Z" },
    "denisedcmello@gmail.com": { s: "expired", e: "2026-05-24T16:34:12.000Z" },
    "jorgetwent4@gmail.com": { s: "expired", e: "2026-05-24T16:06:00.000Z" },
    "sarahmachado42@gmail.com": { s: "refunded", e: null },
    "vcjoel10@gmail.com": { s: "expired", e: "2026-05-22T19:06:53.000Z" },
    "grsolucoesweb@gmail.com": { s: "refunded", e: null },
    "pedrozzuin@gmail.com": { s: "expired", e: "2026-05-22T11:52:03.000Z" },
    "charopazhyann@gmail.com": { s: "expired", e: "2026-05-21T19:09:37.000Z" },
    "kiwifygabigol@gmail.com": { s: "refunded", e: null },
    "brunoebrunomarketing@gmail.com": { s: "refunded", e: null },
    "carlosnatanielk@gmail.com": { s: "expired", e: "2026-05-20T21:05:40.000Z" },
    "lucasmotion0@gmail.com": { s: "expired", e: "2026-05-20T14:29:02.000Z" },
    "angela-leitte@hotmail.com": { s: "expired", e: "2026-05-19T20:41:07.000Z" },
    "ks4445218@gmail.com": { s: "expired", e: "2026-05-19T07:03:52.000Z" },
    "arq.allanp@gmail.com": { s: "refunded", e: null },
    "nunestrokes@gmail.com": { s: "expired", e: "2026-05-16T15:49:15.000Z" },
    "pedrosantiaggo7@hotmail.com": { s: "expired", e: "2026-05-14T20:03:40.000Z" },
    "danielbarcelosdesign@gmail.com": { s: "expired", e: "2026-05-14T16:44:57.000Z" },
    "viniciusghedim@gmail.com": { s: "refunded", e: null },
    "contato.eduardokeith@gmail.com": { s: "refunded", e: null },
    "victor2006gr@gmail.com": { s: "expired", e: "2026-05-13T23:07:08.000Z" },
    "marcao.docriativo@gmail.com": { s: "expired", e: "2026-05-13T22:12:58.000Z" },
    "projects@veen.studio": { s: "expired", e: "2026-05-13T10:40:35.000Z" },
    "zaltcompanydigital@gmail.com": { s: "expired", e: "2026-05-13T07:17:53.000Z" },
    "xpdroid100@gmail.com": { s: "expired", e: "2026-05-13T06:21:50.000Z" },
    "owilsondesigner@gmail.com": { s: "expired", e: "2026-05-12T23:08:58.000Z" },
    "well@ldmedia.com.br": { s: "expired", e: "2026-05-12T22:57:37.000Z" },
    "omatheusbarroso@gmail.com": { s: "expired", e: "2026-05-12T21:19:05.000Z" },
    "jessicathaisdacosta@gmail.com": { s: "refunded", e: null },
    "joserarison4321@gmail.com": { s: "expired", e: "2026-05-12T21:00:22.000Z" },
    "pedrobuenocvlo@gmail.com": { s: "expired", e: "2026-05-12T20:54:09.000Z" },
    "ynkdesigner@gmail.com": { s: "expired", e: "2026-05-12T20:50:57.000Z" },
    "guidinilimajoaopedro3@gmail.com": { s: "refunded", e: null },
    "caio.tsm@gmail.com": { s: "expired", e: "2026-05-12T18:21:08.000Z" },
    "criandu.inc@gmail.com": { s: "refunded", e: null },
    "augustoomsn@gmail.com": { s: "expired", e: "2026-05-12T16:12:32.000Z" },
    "pierrefontenelemkt@gmail.com": { s: "expired", e: "2026-05-12T15:03:58.000Z" },
    "grossetti@gmail.com": { s: "expired", e: "2026-05-12T14:54:06.000Z" },
    "cauadesgn@gmail.com": { s: "expired", e: "2026-05-12T14:04:19.000Z" },
    "contato@girardi.cc": { s: "expired", e: "2026-05-12T13:53:58.000Z" },
    "roberto.rmp@hotmail.com": { s: "expired", e: "2026-05-12T13:30:48.000Z" },
    "isacaureliano42@gmail.com": { s: "expired", e: "2026-05-12T13:13:23.000Z" },
    "equadros057@gmail.com": { s: "expired", e: "2026-05-12T12:51:11.000Z" },
    "luisfernandooficialbr@gmail.com": { s: "expired", e: "2026-05-12T12:46:11.000Z" },
    "anasalcarol@gmail.com": { s: "expired", e: "2026-05-12T12:38:46.000Z" },
    "matheusggffdickel1@gmail.com": { s: "refunded", e: null },
    "contadaadobleartes2020@gmail.com": { s: "refunded", e: null },
    "rafaelartes2020@gmail.com": { s: "refunded", e: null },
  };

  let migrated = 0;
  const now = new Date().toISOString();
  for (const [email, data] of Object.entries(csvData)) {
    const existing = usersDB[email];
    // Só migra se o usuário existe no DB e não tem expiresAt, OU se o status mudou
    if (existing && (!existing.expiresAt || existing.status !== data.s)) {
      existing.status = data.s;
      existing.expiresAt = data.e;
      existing.updatedAt = now;
      migrated++;
    }
    // Se não existe no DB mas está no CSV, adiciona
    if (!existing) {
      usersDB[email] = { status: data.s, customerName: '', updatedAt: now, expiresAt: data.e };
      migrated++;
    }
  }
  // Qualquer usuário ativo no DB que NÃO está no CSV e não tem expiresAt -> dar 30 dias
  for (const [email, user] of Object.entries(usersDB)) {
    if (user.status === 'active' && !user.expiresAt && !csvData[email]) {
      user.expiresAt = makeExpiresAt();
      user.updatedAt = now;
      migrated++;
    }
  }
  if (migrated > 0) {
    saveDB();
    console.log(`[MIGRACAO] ${migrated} usuarios atualizados com datas corretas`);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  OAUTH TOKEN CACHE
// ═══════════════════════════════════════════════════════════════════════════════

let cachedToken = null;
let tokenExpiresAt = 0;

async function getKiwifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 3600000) return cachedToken;

  if (!KIWIFY_CLIENT_ID || !KIWIFY_CLIENT_SECRET) {
    throw new Error('Credenciais da Kiwify nao configuradas');
  }

  const params = new URLSearchParams({
    client_id: KIWIFY_CLIENT_ID,
    client_secret: KIWIFY_CLIENT_SECRET,
  });

  const res = await fetch(`${KIWIFY_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    console.error('[OAUTH] Erro:', await res.text());
    throw new Error('Falha na autenticacao com a Kiwify');
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in) || 86400) * 1000;
  console.log('[OAUTH] Token renovado');
  return cachedToken;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FALLBACK: BUSCAR VENDAS NA API
// ═══════════════════════════════════════════════════════════════════════════════

async function checkViaAPI(email) {
  const token = await getKiwifyToken();
  const normalizedEmail = email.trim().toLowerCase();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - ACCESS_DAYS - 5);
  const formatDate = (d) => d.toISOString().split('T')[0] + ' 00:00:00.000';

  const paidSale = await searchSales(token, normalizedEmail, 'paid', formatDate(startDate), formatDate(endDate));
  if (paidSale) {
    setUser(normalizedEmail, 'active', paidSale.customer?.name || '', true);
    return { active: true, status: 'active' };
  }

  const refundStart = new Date();
  refundStart.setDate(refundStart.getDate() - 180);
  const refundedSale = await searchSales(token, normalizedEmail, 'refunded', formatDate(refundStart), formatDate(endDate));
  if (refundedSale) {
    setUser(normalizedEmail, 'refunded', '', false);
    return { active: false, status: 'refunded' };
  }

  const cbSale = await searchSales(token, normalizedEmail, 'chargedback', formatDate(refundStart), formatDate(endDate));
  if (cbSale) {
    setUser(normalizedEmail, 'chargedback', '', false);
    return { active: false, status: 'chargedback' };
  }

  const oldStart = new Date();
  oldStart.setDate(oldStart.getDate() - 180);
  const oldEnd = new Date();
  oldEnd.setDate(oldEnd.getDate() - ACCESS_DAYS - 5);
  if (oldEnd > oldStart) {
    const expiredSale = await searchSales(token, normalizedEmail, 'paid', formatDate(oldStart), formatDate(oldEnd));
    if (expiredSale) {
      setUser(normalizedEmail, 'expired', '', false);
      return { active: false, status: 'expired' };
    }
  }

  return { active: false, status: 'not_found' };
}

async function searchSales(token, email, status, startDate, endDate) {
  let pageNumber = 1;
  const pageSize = 100;

  while (pageNumber <= 20) {
    const params = new URLSearchParams({
      status, start_date: startDate, end_date: endDate,
      page_size: String(pageSize), page_number: String(pageNumber),
    });
    if (KIWIFY_PRODUCT_ID) params.set('product_id', KIWIFY_PRODUCT_ID);

    const res = await fetch(`${KIWIFY_BASE}/sales?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-kiwify-account-id': KIWIFY_ACCOUNT_ID,
      },
    });

    if (!res.ok) {
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
      console.error(`[API] Erro ${res.status}:`, await res.text());
      throw new Error('Erro ao consultar vendas');
    }

    const data = await res.json();
    const sales = data.data || [];

    for (const sale of sales) {
      if ((sale.customer?.email || '').trim().toLowerCase() === email) return sale;
    }

    if (sales.length < pageSize) break;
    pageNumber++;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WEBHOOK DA KIWIFY
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/webhook/kiwify', (req, res) => {
  try {
    const body = req.body || {};

    if (KIWIFY_WEBHOOK_TOKEN) {
      const possibleTokens = [
        req.headers['x-kiwify-webhook-token'],
        req.headers['x-webhook-token'],
        req.query?.token,
        body.token,
        body.webhook_token,
      ].filter(Boolean);

      const isValid = possibleTokens.some(t => t === KIWIFY_WEBHOOK_TOKEN);
      if (!isValid && possibleTokens.length > 0) {
        console.warn('[WEBHOOK] Token invalido');
        return res.status(401).json({ error: 'Token invalido' });
      }
    }

    const eventType = (
      body.webhook_event_type || body.event || body.type || ''
    ).toLowerCase();

    const customerEmail = (
      body.Customer?.email ||
      body.customer?.email ||
      body.data?.customer?.email ||
      body.buyer?.email ||
      body.email ||
      ''
    ).trim().toLowerCase();

    const customerName =
      body.Customer?.full_name ||
      body.Customer?.name ||
      body.customer?.name ||
      '';

    console.log(`[WEBHOOK] Evento: "${eventType}" | Email: "${customerEmail}"`);

    if (!customerEmail) {
      return res.status(200).json({ received: true });
    }

    // ─── COMPRA APROVADA -> ativo por 30 dias ───────────────────────────
    if (eventType.includes('approved') || eventType.includes('paid') || eventType.includes('aprovad')) {
      setUser(customerEmail, 'active', customerName, true);
    }
    // ─── ASSINATURA RENOVADA -> renova por mais 30 dias ─────────────────
    else if (eventType.includes('renew') || eventType.includes('renovad')) {
      setUser(customerEmail, 'active', customerName, true);
    }
    // ─── REEMBOLSO -> bloqueado imediatamente ───────────────────────────
    else if (eventType.includes('refund') || eventType.includes('reembols')) {
      setUser(customerEmail, 'refunded', '', false);
    }
    // ─── CHARGEBACK -> bloqueado imediatamente ──────────────────────────
    else if (eventType.includes('chargeback')) {
      setUser(customerEmail, 'chargedback', '', false);
    }
    // ─── CANCELAMENTO -> bloqueado imediatamente ────────────────────────
    else if (eventType.includes('cancel')) {
      setUser(customerEmail, 'cancelled', '', false);
    }
    // ─── ASSINATURA ATRASADA -> bloqueado imediatamente ─────────────────
    else if (eventType.includes('late') || eventType.includes('atras')) {
      setUser(customerEmail, 'late', '', false);
    }
    // ─── FALLBACK ───────────────────────────────────────────────────────
    else {
      const orderStatus = (body.order_status || body.status || '').toLowerCase();
      if (orderStatus === 'paid' || orderStatus === 'approved') {
        setUser(customerEmail, 'active', customerName, true);
      } else if (orderStatus === 'refunded') {
        setUser(customerEmail, 'refunded', '', false);
      } else if (orderStatus === 'chargedback') {
        setUser(customerEmail, 'chargedback', '', false);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
    res.status(200).json({ received: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ENDPOINT DE VERIFICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/verify', async (req, res) => {
  try {
    if (API_SECRET) {
      const authHeader = req.headers['x-api-secret'] || '';
      if (authHeader !== API_SECRET) {
        return res.status(401).json({ active: false, message: 'Nao autorizado.' });
      }
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ active: false, message: 'Email invalido.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[VERIFY] Consultando: ${normalizedEmail}`);

    const user = getUser(normalizedEmail);

    if (user) {
      if (user.status === 'active') {
        const active = isUserActive(user);
        if (active) {
          const daysLeft = Math.ceil((new Date(user.expiresAt) - new Date()) / 86400000);
          return res.json({
            active: true,
            status: 'active',
            message: `Acesso liberado! Bem-vindo ao Zeph SDR IA. (${daysLeft} dias restantes)`,
          });
        } else {
          // Expirou automaticamente apos 30 dias
          setUser(normalizedEmail, 'expired', '', false);
          return res.json({
            active: false,
            status: 'expired',
            message: 'Sua assinatura expirou. Renove para continuar usando.',
          });
        }
      }

      const messages = {
        refunded:    'Seu acesso foi encerrado devido a um reembolso.',
        chargedback: 'Seu acesso foi encerrado.',
        cancelled:   'Sua assinatura foi cancelada.',
        late:        'Sua assinatura esta com pagamento pendente. Regularize para continuar.',
        expired:     'Sua assinatura expirou. Renove para continuar usando.',
      };

      return res.json({
        active: false,
        status: user.status,
        message: messages[user.status] || 'Acesso nao autorizado.',
      });
    }

    console.log(`[VERIFY] Nao encontrado no DB, consultando API...`);
    const apiResult = await checkViaAPI(normalizedEmail);

    const messages = {
      active:      'Acesso liberado! Bem-vindo ao Zeph SDR IA.',
      refunded:    'Seu acesso foi encerrado devido a um reembolso.',
      chargedback: 'Seu acesso foi encerrado.',
      expired:     'Sua assinatura expirou. Renove para continuar usando.',
      not_found:   'Nenhuma compra encontrada com este email.',
    };

    res.json({
      active: apiResult.active,
      status: apiResult.status,
      message: messages[apiResult.status] || 'Status desconhecido.',
    });

  } catch (err) {
    console.error('[VERIFY] Erro:', err.message);
    res.status(500).json({ active: false, message: 'Erro interno. Tente novamente em instantes.' });
  }
});

// ─── Admin ───────────────────────────────────────────────────────────────────

app.get('/admin/users', (req, res) => {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }
  res.json({ total: Object.keys(usersDB).length, users: usersDB });
});

app.post('/admin/set-status', (req, res) => {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }
  const { email, status } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'email e status sao obrigatorios' });
  setUser(email, status, '', status === 'active');
  res.json({ ok: true, email, status });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Zeph SDR IA Auth', users: Object.keys(usersDB).length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Zeph Auth Server rodando na porta ${PORT}`);
  console.log(`Acesso expira em ${ACCESS_DAYS} dias apos compra/renovacao`);
});
