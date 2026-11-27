// Tienda Andrómaco (tienda.andromaco.com) usa Salesforce Commerce Cloud: se lee la grilla de su buscador (HTML).
// El código de cada producto (data-pid) es el código de barras: compara exacto con las demás tiendas.
// Devuelve los productos con el mismo formato que la API de las tiendas VTEX.

const HOST = 'https://tienda.andromaco.com';
const SITIO = 'Sites-ANDRO-Site';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function pedir(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

const ENT = { amp: '&', quot: '"', '#39': "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', nbsp: ' ' };
const des = s => String(s || '').replace(/&([a-zA-Z#0-9]+);/g, (m, e) => ENT[e] != null ? ENT[e] : m).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const lindo = s => { s = String(s || '').replace(/[-_]+/g, ' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };

function parsear(html, ean) {
  return html.split('<div class="product" data-pid="').slice(1).map(t => {
    const pid = t.slice(0, t.indexOf('"'));
    t = t.split('<div class="bundle-items')[0];   // los productos de un kit traen su propia ficha adentro: no se mezclan
    const marca = des((/data-custom-brand="([^"]*)"/.exec(t) || [])[1] || '');
    const nombre = des((/<img class="tile-image main"[^>]*?alt="([^"]+)"/.exec(t) || /alt="([^"]+)"/.exec(t) || [])[1] || '');
    const href = (/<a href="([^"]+\.html)"/.exec(t) || [])[1] || '';
    const img = ((/<img class="tile-image main"[^>]*?src="([^"]+)"/.exec(t) || [])[1] || '').replace(/&amp;/g, '&');
    const venta = /class="sales\s*"[\s\S]*?content="([\d.]+)"/.exec(t);
    const lista = /class="strike-through[^"]*"[\s\S]*?content="([\d.]+)"/.exec(t);
    const precio = venta ? Number(venta[1]) : 0;
    if (!nombre || !(precio > 0)) return null;
    const regular = lista ? Number(lista[1]) : 0;
    const etiqueta = des((/class="formatted-price[^"]*"[^>]*>([\s\S]*?)<\//.exec(t) || [])[1] || '');
    const eanP = /^\d{8,14}$/.test(pid) ? pid : '';
    const cat = (/^\/([^/]+)\//.exec(href) || [])[1] || '';
    return {
      nombre, marca: marca ? lindo(marca.toLowerCase()) : '', ean: eanP,
      precio: Math.round(precio * 100) / 100,
      precio_lista: regular > precio + 0.5 ? regular : null,
      precio_promo: null,
      promo: regular > precio + 0.5 ? (etiqueta.replace(/\s*OFF$/i, ' off') || Math.round((1 - precio / regular) * 100) + '% off') : '',
      promo_condicion: '', nota: '',
      imagen: img ? (img.startsWith('http') ? img : HOST + img) : '',
      exacto: !!(ean && eanP === ean),
      sin_stock: /class="[^"]*(?:not-available|out-of-stock|sin-stock)/i.test(t),
      rubro: lindo(cat),
      link: href ? HOST + href : '',
      sku: pid,
    };
  }).filter(Boolean);
}

async function buscar({ ean, q, limite }) {
  const sz = Math.min(limite || 24, 36);
  const url = s => HOST + '/on/demandware.store/' + SITIO + '/default/Search-UpdateGrid?q=' + encodeURIComponent(s) + '&start=0&sz=' + sz;
  if (ean) {
    const exactos = parsear(await pedir(url(ean)), ean).filter(p => p.exacto);
    if (exactos.length || !q) return exactos;
  }
  return q ? parsear(await pedir(url(q)), ean) : [];
}

module.exports = { buscar, parsear };
