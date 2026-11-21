// Cruce entre Super Cart y Perfu Cart: precio de varios productos (por código de barras) en todas las tiendas de esta app.
// Lo usa la otra app para avisar "esto te sale más barato en el súper / en la farmacia".
// POST (texto JSON): {"items":[{"ean":"779...","nombre":"Shampoo ..."}], "sucursal":"200"}  -> { ok, precios: { ean: [ {k, tienda, precio, precio_promo, promo, promo_condicion, link, nombre, imagen} ] } }
// Búsqueda por nombre (para encontrar la versión individual de un pack): {"buscar":[{"q":"jabon dove original 90 g"}]} -> { candidatos: { q: [ {k, tienda, ean, nombre} ] } }
// Reusa /api/vtex (y /api/coto) de esta misma app, que ya tienen su caché.
const APP = 'Perfu Cart';
const TIENDAS = [{ k: 'farmaonline', nombre: 'Farmaonline' }, { k: 'farmacity', nombre: 'Farmacity' }, { k: 'simplicity', nombre: 'Simplicity' },
  { k: 'pigmento', nombre: 'Pigmento' }, { k: 'gpsfarma', nombre: 'GPS Farma', porNombre: true }];
const ORIGENES = ['https://compras-super-cart.vercel.app', 'https://super-sale-coto.vercel.app', 'https://perfu-cart.vercel.app'];
const MAX_ITEMS = 80, A_LA_VEZ = 24;

async function pedir(url) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
  try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; } catch (_) { return null; } finally { clearTimeout(t); }
}

module.exports = async function handler(req, res) {
  const origen = req.headers.origin || '';
  if (ORIGENES.includes(origen) || /^http:\/\/localhost(:\d+)?$/.test(origen)) { res.setHeader('Access-Control-Allow-Origin', origen); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.statusCode = 204; return res.end(); }
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    if (!body || typeof body !== 'object') {
      const chunks = []; for await (const c of req) chunks.push(c); body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }
    const vistos = new Set();
    const items = (Array.isArray(body.items) ? body.items : []).map(i => ({ ean: String(i.ean || '').replace(/\D/g, ''), nombre: String(i.nombre || '').slice(0, 60) }))
      .filter(i => /^\d{8,14}$/.test(i.ean) && !vistos.has(i.ean) && vistos.add(i.ean)).slice(0, MAX_ITEMS);
    const suc = String(body.sucursal || '200').replace(/\D/g, '') || '200';
    const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
    const tareas = [];
    items.forEach(i => TIENDAS.forEach(t => tareas.push({ i, t })));
    const consultas = (Array.isArray(body.buscar) ? body.buscar : []).map(b => String((b && b.q) || '').trim().slice(0, 80)).filter(Boolean).slice(0, 6);
    consultas.forEach(q => TIENDAS.forEach(t => tareas.push({ q, t })));
    const candidatos = {};
    const precios = {};
    let n = 0;
    async function trabajador() {
      while (n < tareas.length) {
        const { i, t, q } = tareas[n++];
        if (q) {
          const d = await pedir(t.k === 'coto' ? base + '/api/coto?q=' + encodeURIComponent(q) + '&sucursal=' + suc + '&limite=8' : base + '/api/vtex?tienda=' + t.k + '&q=' + encodeURIComponent(q) + '&limite=8');
          ((d && d.productos) || []).filter(x => x.ean && !x.sin_stock && x.precio > 0).forEach(x => (candidatos[q] = candidatos[q] || []).push({ k: t.k, tienda: t.nombre, ean: String(x.ean), nombre: x.nombre || '' }));
          continue;
        }
        const url = t.k === 'coto' ? base + '/api/coto?ean=' + i.ean + '&sucursal=' + suc
          : base + '/api/vtex?tienda=' + t.k + '&ean=' + i.ean + (t.porNombre && i.nombre ? '&q=' + encodeURIComponent(i.nombre) : '');
        const d = await pedir(url);
        const p = d && (d.productos || []).find(x => x.exacto && !x.sin_stock && x.precio > 0);
        if (p) (precios[i.ean] = precios[i.ean] || []).push({ k: t.k, tienda: t.nombre, precio: p.precio, precio_lista: p.precio_lista || null, precio_promo: p.precio_promo || null,
          promo: p.promo || '', promo_condicion: p.promo_condicion || '', link: p.link || '', nombre: p.nombre || '', imagen: p.imagen || '', sku: p.sku || '', seller: p.seller || '', ean: i.ean });
      }
    }
    await Promise.all(Array.from({ length: A_LA_VEZ }, trabajador));
    res.end(JSON.stringify({ ok: true, app: APP, precios, candidatos }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'No se pudo comparar' }));
  }
};
