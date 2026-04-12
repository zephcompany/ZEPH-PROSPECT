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

let usersDB = {}; // { "email": { status, updatedAt, customerName } }

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

// Carregar DB ao iniciar
loadDB();

// ═══════════════════════════════════════════════════════════════════════════════
//  CACHE DO TOKEN OAUTH (para fallback via API)
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
//  Usado quando o email não está no DB local (ex: servidor acabou de subir)
// ═══════════════════════════════════════════════════════════════════════════════

async function checkViaAPI(email) {
  const token = await getKiwifyToken();
  const normalizedEmail = email.trim().toLowerCase();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - SUBSCRIPTION_DAYS);

  const formatDate = (d) => d.toISOString().split('T')[0] + ' 00:00:00.000';

  // 1) Buscar venda PAID recente
  const paidSale = await searchSales(token, normalizedEmail, 'paid', formatDate(startDate), formatDate(endDate));
  if (paidSale) {
    setUser(normalizedEmail, 'active', paidSale.customer?.name || '');
    return { active: true, status: 'active' };
  }

  // 2) Buscar reembolso
  const refundStart = new Date();
  refundStart.setDate(refundStart.getDate() - 180);
  const refundedSale = await searchSales(token, normalizedEmail, 'refunded', formatDate(refundStart), formatDate(endDate));
  if (refundedSale) {
    setUser(normalizedEmail, 'refunded');
    return { active: false, status: 'refunded' };
  }

  // 3) Buscar chargeback
  const cbSale = await searchSales(token, normalizedEmail, 'chargedback', formatDate(refundStart), formatDate(endDate));
  if (cbSale) {
    setUser(normalizedEmail, 'chargedback');
    return { active: false, status: 'chargedback' };
  }

  // 4) Buscar compra antiga (expirada)
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
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/webhook/kiwify', (req, res) => {
  try {
    // Validar token do webhook
    if (KIWIFY_WEBHOOK_TOKEN) {
      const signature = req.headers['x-kiwify-webhook-token']
                     || req.body?.webhook_token
                     || req.query?.token;

      // A Kiwify pode enviar o token de diferentes formas
      const bodyToken = req.body?.token;
      const isValid = signature === KIWIFY_WEBHOOK_TOKEN
                   || bodyToken === KIWIFY_WEBHOOK_TOKEN;

      if (!isValid) {
        console.warn('[WEBHOOK] Token inválido — ignorando');
        return res.status(401).json({ error: 'Token inválido' });
      }
    }

    const event = req.body;
    const eventType = (event.webhook_event_type || event.event || event.type || '').toLowerCase();
    const customerEmail = (
      event.Customer?.email ||
      event.customer?.email ||
      event.data?.customer?.email ||
      event.buyer?.email ||
      ''
    ).trim().toLowerCase();

    const customerName = event.Customer?.full_name
                      || event.customer?.name
                      || event.data?.customer?.name
                      || '';

    console.log(`[WEBHOOK] Evento: ${eventType} | Email: ${customerEmail}`);

    if (!customerEmail) {
      console.warn('[WEBHOOK] Sem email no payload');
      return res.status(200).json({ received: true });
    }

    // Mapear eventos para status
    // Eventos da Kiwify: order_approved, refund, chargeback,
    // subscription_cancellation, subscription_late, subscription_renewed
    if (eventType.includes('approved') || eventType.includes('paid')) {
      setUser(customerEmail, 'active', customerName);
    }
    else if (eventType.includes('renew')) {
      setUser(customerEmail, 'active', customerName);
    }
    else if (eventType.includes('refund')) {
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
      console.log(`[WEBHOOK] Evento não mapeado: ${eventType}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message);
    res.status(200).json({ received: true }); // Sempre retorna 200 para evitar retries
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

    // 1) Primeiro: verificar no banco local (dados dos webhooks)
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

    // 2) Fallback: consultar API da Kiwify diretamente
    console.log(`[VERIFY] Não encontrado no DB local, consultando API...`);
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

// ─── Admin: ver todos os usuários (protegido) ───────────────────────────────

app.get('/admin/users', (req, res) => {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  res.json({
    total: Object.keys(usersDB).length,
    users: usersDB,
  });
});

// ─── Admin: ativar/desativar manualmente ─────────────────────────────────────

app.post('/admin/set-status', (req, res) => {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const { email, status } = req.body;
  if (!email || !status) {
    return res.status(400).json({ error: 'email e status são obrigatórios' });
  }
  setUser(email, status);
  res.json({ ok: true, email, status });
});

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Zeph SDR IA Auth', users: Object.keys(usersDB).length });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Zeph Auth Server rodando na porta ${PORT}`);
  if (!KIWIFY_CLIENT_ID || !KIWIFY_CLIENT_SECRET || !KIWIFY_ACCOUNT_ID) {
    console.warn('⚠️  Configure KIWIFY_CLIENT_ID, KIWIFY_CLIENT_SECRET e KIWIFY_ACCOUNT_ID');
  }
  if (!KIWIFY_WEBHOOK_TOKEN) {
    console.warn('⚠️  Configure KIWIFY_WEBHOOK_TOKEN para validar webhooks');
  }
});
