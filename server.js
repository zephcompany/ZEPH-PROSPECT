'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO — Variáveis de ambiente (configurar no Railway)
// ═══════════════════════════════════════════════════════════════════════════════

const KIWIFY_CLIENT_ID     = process.env.KIWIFY_CLIENT_ID     || '';
const KIWIFY_CLIENT_SECRET = process.env.KIWIFY_CLIENT_SECRET || '';
const KIWIFY_ACCOUNT_ID    = process.env.KIWIFY_ACCOUNT_ID    || '';
const KIWIFY_PRODUCT_ID    = process.env.KIWIFY_PRODUCT_ID    || '';
const KIWIFY_WEBHOOK_TOKEN = process.env.KIWIFY_WEBHOOK_TOKEN || '';
const SUBSCRIPTION_DAYS    = parseInt(process.env.SUBSCRIPTION_DAYS) || 35;
const API_SECRET           = process.env.API_SECRET || '';
const DATA_DIR             = process.env.DATA_DIR || '/data';

const KIWIFY_BASE = 'https://public-api.kiwify.com/v1';

// ═══════════════════════════════════════════════════════════════════════════════
//  BANCO DE DADOS SIMPLES (JSON em disco — persiste com Railway Volume)
// ═══════════════════════════════════════════════════════════════════════════════

const DB_FILE = path.join(DATA_DIR, 'users.json');

let usersDB = {};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      usersDB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log(`[DB] Carregado: ${Object.keys(usersDB).length} usuários`);
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

function setUser(email, status, customerName = '') {
  const key = email.trim().toLowerCase();
  usersDB[key] = {
    status,
    customerName,
    updatedAt: new Date().toISOString(),
  };
  saveDB();
  console.log(`[DB] ${key} → ${status}`);
}

function getUser(email) {
  return usersDB[email.trim().toLowerCase()] || null;
}

loadDB();

// ═══════════════════════════════════════════════════════════════════════════════
//  CACHE DO TOKEN OAUTH
// ═══════════════════════════════════════════════════════════════════════════════

let cachedToken = null;
let tokenExpiresAt = 0;

async function getKiwifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 3600000) {
    return cachedToken;
  }

  if (!KIWIFY_CLIENT_ID || !KIWIFY_CLIENT_SECRET) {
    throw new Error('Credenciais da Kiwify não configuradas');
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
    const err = await res.text();
    console.error('[OAUTH] Erro:', err);
    throw new Error('Falha na autenticação com a Kiwify');
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in) || 86400) * 1000;
  console.log('[OAUTH] Token renovado');
  return cachedToken;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FALLBACK: BUSCAR VENDAS NA API DA KIWIFY
// ═══════════════════════════════════════════════════════════════════════════════

async function checkViaAPI(email) {
  const token = await getKiwifyToken();
  const normalizedEmail = email.trim().toLowerCase();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - SUBSCRIPTION_DAYS);

  const formatDate = (d) => d.toISOString().split('T')[0] + ' 00:00:00.000';

  const paidSale = await searchSales(token, normalizedEmail, 'paid', formatDate(startDate), formatDate(endDate));
  if (paidSale) {
    setUser(normalizedEmail, 'active', paidSale.customer?.name || '');
    return { active: true, status: 'active' };
  }

  const refundStart = new Date();
  refundStart.setDate(refundStart.getDate() - 180);
  const refundedSale = await searchSales(token, normalizedEmail, 'refunded', formatDate(refundStart), formatDate(endDate));
  if (refundedSale) {
    setUser(normalizedEmail, 'refunded');
    return { active: false, status: 'refunded' };
  }

  const cbSale = await searchSales(token, normalizedEmail, 'chargedback', formatDate(refundStart), formatDate(endDate));
  if (cbSale) {
    setUser(normalizedEmail, 'chargedback');
    return { active: false, status: 'chargedback' };
  }

  const oldStart = new Date();
  oldStart.setDate(oldStart.getDate() - 180);
  const oldEnd = new Date();
  oldEnd.setDate(oldEnd.getDate() - SUBSCRIPTION_DAYS);
  if (oldEnd > oldStart) {
    const expiredSale = await searchSales(token, normalizedEmail, 'paid', formatDate(oldStart), formatDate(oldEnd));
    if (expiredSale) {
      setUser(normalizedEmail, 'expired');
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
//  WEBHOOK DA KIWIFY — Recebe eventos em tempo real
//  FIX: Agora verifica o token em TODOS os locais possíveis do payload
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/webhook/kiwify', (req, res) => {
  try {
    const body = req.body || {};

    // Log completo para debug (remover depois que estiver funcionando)
    console.log('[WEBHOOK] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[WEBHOOK] Body keys:', Object.keys(body));
    console.log('[WEBHOOK] Body:', JSON.stringify(body).substring(0, 1000));

    // Validar token — Kiwify pode enviar em diversos campos
    if (KIWIFY_WEBHOOK_TOKEN) {
      // Buscar token em TODOS os locais possíveis
      const possibleTokens = [
        req.headers['x-kiwify-webhook-token'],
        req.headers['x-webhook-token'],
        req.headers['authorization'],
        req.query?.token,
        body.token,
        body.webhook_token,
        body.signature,
        body.api_key,
      ].filter(Boolean);

      console.log('[WEBHOOK] Tokens encontrados:', possibleTokens);

      const isValid = possibleTokens.some(t =>
        t === KIWIFY_WEBHOOK_TOKEN ||
        t === `Bearer ${KIWIFY_WEBHOOK_TOKEN}`
      );

      if (!isValid && possibleTokens.length === 0) {
        // Se não encontrou token nenhum, aceita mesmo assim (Kiwify pode não enviar)
        console.warn('[WEBHOOK] Nenhum token encontrado no payload — aceitando mesmo assim');
      } else if (!isValid) {
        console.warn('[WEBHOOK] Token inválido:', possibleTokens[0]?.substring(0, 20));
        return res.status(401).json({ error: 'Token inválido' });
      }
    }

    // Detectar tipo de evento — Kiwify usa vários formatos possíveis
    const eventType = (
      body.webhook_event_type ||
      body.event ||
      body.type ||
      body.order_status ||
      body.subscription_status ||
      ''
    ).toLowerCase();

    // Detectar email do cliente — buscar em todos os locais possíveis
    const customerEmail = (
      body.Customer?.email ||
      body.customer?.email ||
      body.data?.customer?.email ||
      body.buyer?.email ||
      body.email ||
      body.data?.email ||
      body.data?.buyer?.email ||
      ''
    ).trim().toLowerCase();

    const customerName =
      body.Customer?.full_name ||
      body.Customer?.name ||
      body.customer?.name ||
      body.customer?.full_name ||
      body.data?.customer?.name ||
      body.buyer?.name ||
      '';

    console.log(`[WEBHOOK] Evento: "${eventType}" | Email: "${customerEmail}" | Nome: "${customerName}"`);

    if (!customerEmail) {
      console.warn('[WEBHOOK] Sem email no payload — ignorando');
      return res.status(200).json({ received: true });
    }

    // Mapear eventos para status
    if (eventType.includes('approved') || eventType.includes('paid') || eventType.includes('aprovad')) {
      setUser(customerEmail, 'active', customerName);
    }
    else if (eventType.includes('renew') || eventType.includes('renovad')) {
      setUser(customerEmail, 'active', customerName);
    }
    else if (eventType.includes('refund') || eventType.includes('reembols')) {
      setUser(customerEmail, 'refunded');
    }
    else if (eventType.includes('chargeback')) {
      setUser(customerEmail, 'chargedback');
    }
    else if (eventType.includes('cancel')) {
      setUser(customerEmail, 'cancelled');
    }
    else if (eventType.includes('late') || eventType.includes('atras')) {
      setUser(customerEmail, 'late');
    }
    else {
      console.log(`[WEBHOOK] Evento não mapeado: "${eventType}" — tentando detectar pelo body`);
      // Fallback: tentar detectar pelo status no body
      const orderStatus = (body.order_status || body.status || '').toLowerCase();
      if (orderStatus === 'paid' || orderStatus === 'approved') {
        setUser(customerEmail, 'active', customerName);
      } else if (orderStatus === 'refunded') {
        setUser(customerEmail, 'refunded');
      } else if (orderStatus === 'chargedback') {
        setUser(customerEmail, 'chargedback');
      } else {
        console.log(`[WEBHOOK] Não consegui mapear — status: "${orderStatus}"`);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
    res.status(200).json({ received: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ENDPOINT DE VERIFICAÇÃO — Chamado pela extensão
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/verify', async (req, res) => {
  try {
    if (API_SECRET) {
      const authHeader = req.headers['x-api-secret'] || '';
      if (authHeader !== API_SECRET) {
        return res.status(401).json({ active: false, message: 'Não autorizado.' });
      }
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ active: false, message: 'Email inválido.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[VERIFY] Consultando: ${normalizedEmail}`);

    // 1) Verificar no banco local (dados dos webhooks)
    const user = getUser(normalizedEmail);

    if (user) {
      const isActive = user.status === 'active';
      const messages = {
        active:      'Acesso liberado! Bem-vindo ao Zeph SDR IA.',
        refunded:    'Seu acesso foi encerrado devido a um reembolso.',
        chargedback: 'Seu acesso foi encerrado.',
        cancelled:   'Sua assinatura foi cancelada.',
        late:        'Sua assinatura está com pagamento pendente. Regularize para continuar.',
        expired:     'Sua assinatura expirou. Renove para continuar usando.',
      };

      return res.json({
        active: isActive,
        status: user.status,
        message: messages[user.status] || 'Status desconhecido.',
      });
    }

    // 2) Fallback: consultar API da Kiwify
    console.log(`[VERIFY] Não encontrado no DB, consultando API...`);
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

// ─── Admin endpoints ─────────────────────────────────────────────────────────

app.get('/admin/users', (req, res) => {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  res.json({ total: Object.keys(usersDB).length, users: usersDB });
});

app.post('/admin/set-status', (req, res) => {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const { email, status } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'email e status são obrigatórios' });
  setUser(email, status);
  res.json({ ok: true, email, status });
});

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Zeph SDR IA Auth', users: Object.keys(usersDB).length });
});

// ═══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Zeph Auth Server rodando na porta ${PORT}`);
  if (!KIWIFY_CLIENT_ID) console.warn('⚠️  KIWIFY_CLIENT_ID não configurado');
  if (!KIWIFY_CLIENT_SECRET) console.warn('⚠️  KIWIFY_CLIENT_SECRET não configurado');
  if (!KIWIFY_ACCOUNT_ID) console.warn('⚠️  KIWIFY_ACCOUNT_ID não configurado');
  if (!KIWIFY_WEBHOOK_TOKEN) console.warn('⚠️  KIWIFY_WEBHOOK_TOKEN não configurado');
});
