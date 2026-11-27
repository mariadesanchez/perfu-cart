// Tienda Nutricia Bagó (tiendanutriciabago.com.ar) usa Shopify y tiene un catálogo chico (~100 productos):
// se baja el catálogo entero (products.json) y se busca acá, por nombre o por código de barras.
// El código de barras está en la ficha de cada producto (/products/<handle>.json); si no, en el nombre de la foto.
// Los combos ("2x1", "dos unidades", "24 unidades") no llevan código: su precio es por varias unidades.
// Devuelve los productos con el mismo formato que la API de las tiendas VTEX.

const HOST = 'https://tiendanutriciabago.com.ar';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const VIGENCIA = 30 * 60e3;   // el catálogo se reusa 30 minutos (precios y stock)
const VIGENCIA_EAN = 12 * 3600e3;   // los códigos de barras casi no cambian
let cache = null, eans = { t: 0, map: {} };

async function pedir(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esCombo = t => /combo|\d\s*x\s*\d|dos unidades|\(\s*\d+\s*unidades|pack/i.test(t);

async function catalogo() {
  if (cache && Date.now() - cache.t < VIGENCIA) return cache.ps;
  let ps = [];
  for (let page = 1; page <= 4; page++) {
    const j = await pedir(HOST + '/products.json?limit=250&page=' + page);
    ps = ps.concat(j.products || []);
    if (!j.products || j.products.length < 250) break;
  }
  // Códigos de barras: de la ficha de cada producto (en paralelo, de a 15), una vez cada 12 horas
  if (Date.now() - eans.t > VIGENCIA_EAN) {
    const map = {}, cola = ps.filter(p => !esCombo(p.title)).map(p => p.handle);
    await Promise.all(Array.from({ length: 15 }, async () => {
      while (cola.length) {
        const h = cola.shift();
        try { const d = await pedir(HOST + '/products/' + h + '.json', 6000); (d.product.variants || []).forEach(v => { if (/^\d{8,14}$/.test(v.barcode || '')) map[v.id] = v.barcode; }); } catch (_) { /* queda la foto */ }
      }
    }));
    if (Object.keys(map).length) eans = { t: Date.now(), map };
  }
  cache = { t: Date.now(), ps };
  return ps;
}

function mapear(ps, ean) {
  const out = [];
  ps.forEach(p => (p.variants || []).forEach(v => {
    const precio = Number(v.price) || 0;
    if (!(precio > 0)) return;
    const regular = Number(v.compare_at_price) || 0;
    const foto = ((p.images || [])[0] || {}).src || '';
    const deFoto = (/\/(\d{8,14})[._-][^/]*$/.exec(foto.split('?')[0]) || [])[1] || '';
    const eanP = esCombo(p.title) ? '' : (eans.map[v.id] || deFoto);
    const nombre = p.title + ((p.variants || []).length > 1 && v.title && !/default/i.test(v.title) ? ' ' + v.title : '');
    out.push({
      nombre, marca: p.vendor || '', ean: eanP,
      precio, precio_lista: regular > precio + 0.5 ? regular : null, precio_promo: null,
      promo: regular > precio + 0.5 ? Math.round((1 - precio / regular) * 100) + '% off' : '',
      promo_condicion: '', nota: '',
      imagen: foto, exacto: !!(ean && eanP === ean), sin_stock: v.available === false,
      rubro: p.product_type || '', link: HOST + '/products/' + p.handle, sku: String(v.sku || v.id || ''),
    });
  }));
  return out;
}

async function buscar({ ean, q, limite }) {
  const ps = await catalogo();
  if (ean) {
    const exactos = mapear(ps, ean).filter(p => p.exacto);
    if (exactos.length || !q) return exactos;
  }
  const toks = norm(q).split(/[^a-z0-9]+/).filter(t => t.length > 1);
  if (!toks.length) return [];
  const conTodas = ps.filter(p => { const txt = norm([p.title, p.vendor, p.product_type, (p.tags || []).join(' ')].join(' ')); return toks.every(t => txt.includes(t)); });
  return mapear(conTodas, ean).slice(0, limite || 48);
}

module.exports = { buscar };
