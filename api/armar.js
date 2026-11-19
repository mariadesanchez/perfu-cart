// Arma el carrito en una tienda VTEX desde el servidor y devuelve el enlace para abrirlo.
// POST /api/armar  { tienda: 'farmaonline', items: [{ sku: '123', qty: 2, seller: '1' }] }
// → { ok: true, url: 'https://tienda/checkout/?orderFormId=…#/cart', agregados: 2 }
const HOSTS = {
  farmaonline: 'https://www.farmaonline.com',
  farmacity: 'https://www.farmacity.com',
  simplicity: 'https://www.simplicity.com.ar',
  pigmento: 'https://www.perfumeriaspigmento.com.ar',
};

async function pedir(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts));
    const j = await r.json().catch(() => null);
    return { status: r.status, json: j };
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: 'Usá POST' })); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const host = HOSTS[String((body || {}).tienda || '')];
  const items = Array.isArray((body || {}).items) ? body.items.slice(0, 100) : [];
  if (!host) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'Tienda no soportada' })); }
  const orderItems = items
    .filter(i => /^\d+$/.test(String(i.sku || '')))
    .map(i => ({ id: String(i.sku), quantity: Math.max(1, Math.min(99, Math.ceil(Number(i.qty) || 1))), seller: /^[\w-]+$/.test(String(i.seller || '')) ? String(i.seller) : '1' }));
  if (!orderItems.length) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'Sin productos' })); }
  const H = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
  try {
    const nuevo = await pedir(host + '/api/checkout/pub/orderForm?forceNewCart=true', { method: 'POST', headers: H, body: '{}' });
    const id = nuevo.json && nuevo.json.orderFormId;
    if (!id) throw new Error('orderForm ' + nuevo.status);
    const add = await pedir(host + '/api/checkout/pub/orderForm/' + id + '/items', { method: 'POST', headers: H, body: JSON.stringify({ orderItems }) });
    const enCarro = (add.json && add.json.items) || [];
    if (!enCarro.length) throw new Error('items ' + add.status);
    return res.end(JSON.stringify({ ok: true, url: host + '/checkout/?orderFormId=' + id + '#/cart', agregados: enCarro.length, pedidos: orderItems.length }));
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: 'No se pudo armar el carrito' }));
  }
};
