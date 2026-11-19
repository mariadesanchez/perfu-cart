// GPS Farma (gpsfarma.com) usa Magento 2: se consulta su GraphQL público.
// Devuelve los productos con el mismo formato que la API de las tiendas VTEX.

const HOST = 'https://gpsfarma.com';
const OFERTAS_UID = 'ODA0Mg==';   // categoría "OFERTAS"

const CAMPOS = `sku name url_key stock_status small_image { url }
  categories { name level url_path }
  price_range { minimum_price { regular_price { value } final_price { value } discount { percent_off } } }
  custom_attributesV2 { items { code ... on AttributeValue { value } } }`;

async function gql(query, variables) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(HOST + '/graphql', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    if (j.errors && !j.data) throw new Error(j.errors[0].message);
    return j.data;
  } finally { clearTimeout(t); }
}

function lindo(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Rubro: la categoría que cuelga de "CATEGORÍAS" (url categorias/<rubro>)
function rubroGps(p) {
  const c = (p.categories || []).find(x => /^categorias\/[^/]+$/.test(x.url_path || ''));
  return c ? lindo(c.name) : '';
}

function mapear(items, ean, leerPromos) {
  return (items || []).map(p => {
    const attr = {};
    ((p.custom_attributesV2 || {}).items || []).forEach(a => { if (a.value != null) attr[a.code] = String(a.value).trim(); });
    const mp = (p.price_range || {}).minimum_price || {};
    const regular = (mp.regular_price || {}).value || 0, final = (mp.final_price || {}).value || regular;
    if (!(final > 0)) return null;
    const etiqueta = attr.gps_catalog_promo || '';
    // Promos por cantidad (2x1, 2do al 50%) que no están en el precio
    const { mejor } = leerPromos(final, etiqueta ? [{ Name: etiqueta }] : []);
    const eanP = (attr.ean || '').replace(/\D/g, '') || ((/\/(\d{8,14})[-_]/.exec((p.small_image || {}).url || '') || [])[1] || '');
    return {
      nombre: p.name || '',
      marca: attr.marca || '',
      ean: eanP,
      precio: final,
      precio_lista: regular > final + 0.5 ? regular : null,
      precio_promo: mejor && p.stock_status !== 'OUT_OF_STOCK' ? Math.round(mejor.precio * 100) / 100 : null,
      promo: mejor ? mejor.texto : (regular > final + 0.5 ? (etiqueta || Math.round((1 - final / regular) * 100) + '% off') : ''),
      promo_condicion: '',
      nota: '',
      imagen: ((p.small_image || {}).url || '').split('?')[0],
      exacto: !!(ean && eanP === ean),
      sin_stock: p.stock_status === 'OUT_OF_STOCK',
      rubro: rubroGps(p),
      link: p.url_key ? HOST + '/' + p.url_key + '.html' : '',
      sku: p.sku || '',
    };
  }).filter(Boolean);
}

async function buscar({ ean, q, limite }, leerPromos) {
  let items = [];
  if (ean) {
    try {
      const d = await gql(`query($e:String){ products(filter:{ ean: { eq: $e } }, pageSize: 5) { items { ${CAMPOS} } } }`, { e: ean });
      items = d.products.items;
    } catch (_) { /* el filtro por ean puede no estar habilitado: se busca por texto */ }
    if (!items.length) items = (await gql(`query($s:String){ products(search: $s, pageSize: 5) { items { ${CAMPOS} } } }`, { s: ean })).products.items;
    const exactos = mapear(items, ean, leerPromos).filter(p => p.exacto);
    if (exactos.length || !q) return exactos;
  }
  items = (await gql(`query($s:String,$n:Int){ products(search: $s, pageSize: $n) { items { ${CAMPOS} } } }`, { s: q, n: limite || 24 })).products.items;
  return mapear(items, ean, leerPromos);
}

// Todas las ofertas (categoría OFERTAS), de a 100
async function ofertas(leerPromos) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const d = await gql(`query($p:Int){ products(filter:{ category_uid: { eq: "${OFERTAS_UID}" } }, pageSize: 100, currentPage: $p) { total_count page_info { total_pages } items { ${CAMPOS} } } }`, { p: page });
    out.push(...mapear(d.products.items, '', leerPromos));
    if (page >= (d.products.page_info || {}).total_pages) break;
  }
  return out;
}

module.exports = { buscar, ofertas, HOST };
