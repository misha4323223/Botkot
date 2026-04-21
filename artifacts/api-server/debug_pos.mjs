import pg from 'pg';
import crypto from 'crypto';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }});
await c.connect();
const r = await c.query('SELECT token, account_id, is_sandbox FROM trader.settings LIMIT 1');
const row = r.rows[0];
await c.end();

const key = process.env.SETTINGS_ENCRYPTION_KEY;
const buf = Buffer.from(row.token, 'base64');
const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
d.setAuthTag(tag);
const token = Buffer.concat([d.update(enc), d.final()]).toString('utf8');

console.log('account:', row.account_id, 'sandbox:', row.is_sandbox);

const base = row.is_sandbox ? 'https://sandbox-invest-public-api.tinkoff.ru/rest' : 'https://invest-public-api.tinkoff.ru/rest';

async function call(path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const pos = await call('/tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions', { accountId: row.account_id });
console.log('--- GetPositions ---');
console.log(JSON.stringify(pos, null, 2));

const port = await call('/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio', { accountId: row.account_id, currency: 'RUB' });
console.log('--- GetPortfolio (cash-relevant fields) ---');
const p = port.body;
console.log(JSON.stringify({
  totalAmountShares: p.totalAmountShares,
  totalAmountCurrencies: p.totalAmountCurrencies,
  totalAmountPortfolio: p.totalAmountPortfolio,
  totalAmountBonds: p.totalAmountBonds,
  totalAmountFutures: p.totalAmountFutures,
  totalAmountOptions: p.totalAmountOptions,
  positionsTypes: (p.positions || []).map(x => ({ ticker: x.ticker, type: x.instrumentType, qty: x.quantity }))
}, null, 2));
