// Perfu Cart · busca productos en perfumerías y farmacias online (por código de barras o por nombre):
// Farmaonline, Farmacity, Simplicity y Pigmento (plataforma VTEX) y GPS Farma (Magento, ver lib/gps.js).
// Usa el buscador público de cada tienda. No son APIs oficiales. Todas devuelven el mismo formato.
// Uso: /api/vtex?tienda=farmacity&ean=7794640173103   o   /api/vtex?tienda=gpsfarma&q=hinds

const TIENDAS = {
  farmaonline: { nombre: 'Farmaonline', host: 'https://www.farmaonline.com' },
  farmacity:   { nombre: 'Farmacity',   host: 'https://www.farmacity.com' },
  simplicity:  { nombre: 'Simplicity',  host: 'https://www.simplicity.com.ar' },
  pigmento:    { nombre: 'Pigmento',    host: 'https://www.perfumeriaspigmento.com.ar' },
  gpsfarma:    { nombre: 'GPS Farma',   host: 'https://gpsfarma.com', magento: true },
};
const gps = require('../lib/gps.js');

async function buscar(host, params) {
  const url = host + '/api/catalog_system/pub/products/search?' + params;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok && r.status !== 206) throw new Error('La tienda respondió ' + r.status);
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } finally {
    clearTimeout(t);
  }
}

const first = v => (Array.isArray(v) ? v[0] : v);

// Interpreta las promociones de VTEX (y las etiquetas de promo de GPS Farma) y calcula el precio por unidad con la promo.
function leerPromos(precio, teasers) {
  let mejor = null;
  const notas = [];
  for (const t of teasers || []) {
    const name = String(t.Name || '');
    const params = [...((t.Conditions && t.Conditions.Parameters) || []), ...((t.Effects && t.Effects.Parameters) || [])];
    const esTarjeta = /tarjeta|banco|bins|cr[eé]dito|d[eé]bito|prepaga/i.test(name) || params.some(p => /RestrictionsBins|PaymentMethod/i.test(p.Name));
    if (esTarjeta) {
      const pct = params.find(p => p.Name === 'PercentualDiscount');
      notas.push(pct ? `${pct.Value}% con ${name.replace(/\s*\d+\s*%.*/, '').trim() || 'tarjeta'}` : name);
      continue;
    }
    let cand = null;
    let m;
    if ((m = /(\d+)\s*x\s*(\d+)/i.exec(name)) && +m[1] > +m[2]) {
      const a = +m[1], b = +m[2];
      cand = { precio: precio * b / a, texto: `${a}x${b} · Llevando ${a}` };
    } else if ((m = /(\d)\s*(?:do|da|°|º)?\s*al\s*(\d+)\s*%/i.exec(name))) {
      const n = +m[1] || 2, x = +m[2];
      cand = { precio: ((n - 1) * precio + precio * (1 - x / 100)) / n, texto: `${n}° al ${x}% · Llevando ${n}` };
    } else {
      const pct = params.find(p => p.Name === 'PercentualDiscount');
      const minQ = (t.Conditions && t.Conditions.MinimumQuantity) || 0;
      if (pct && +pct.Value > 0) {
        cand = { precio: precio * (1 - pct.Value / 100), texto: `${pct.Value}% off` + (minQ > 1 ? ` · Llevando ${minQ}` : '') };
      }
    }
    if (cand && (!mejor || cand.precio < mejor.precio)) {
      const max = /max(?:imo)?\s*(\d+)\s*u/i.exec(name);
      cand.condicion = max ? `Máximo ${max[1]} unidades` : '';
      mejor = cand;
    }
  }
  return { mejor, notas };
}


// Rubro legible: "ALMACEN" -> "Almacen", "almacén" -> "Almacén"
function lindo(s) {
  s = String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const GENERICO = /^(all|category|categor[ií]as?|todos?|cat[aá]logo|root|home|inicio|productos?|ofertas?|promociones?|integraciones)$/i;

// categories viene como ["/Almacén/Aceites/", "/Almacén/"]: el primer nivel es el rubro
function rubroVtex(p) {
  for (const c of (p.categories || [])) {
    const top = String(c).split('/').map(x => x.trim()).filter(x => x && !GENERICO.test(x))[0];
    if (top) return lindo(top);
  }
  return '';
}

function mapear(products, ean) {
  const out = [];
  for (const p of products || []) {
    const items = p.items || [];
    const item = (ean && items.find(i => i.ean === ean)) || items[0];
    if (!item) continue;
    const seller = (item.sellers || []).find(s => s.sellerDefault) || (item.sellers || [])[0];
    const co = seller && seller.commertialOffer;
    if (!co || !co.Price || co.Price <= 0) continue;
    // Sin stock online: el catálogo conserva el último precio, que puede tener años.
    // Se devuelve marcado como sin_stock para que la web no lo tome como precio actual.
    const sinStock = co.IsAvailable === false || !(co.AvailableQuantity > 0);
    const precio = co.Price;
    const { mejor, notas } = leerPromos(precio, co.PromotionTeasers);
    // Precio por kilo/litro: viene armado (Carrefour, Día) o se calcula con el gramaje (ChangoMás)
    const legend = String(first(p['Gramaje leyenda de conversión']) || first(p.UnidaddeMedida) || '');
    const medida = /k|gr/i.test(legend) ? 'Kilo' : /l|ml|cc/i.test(legend) ? 'Litro' : '';
    let ppu = parseFloat(String(first(p.pricePerUnit) || first(p.PrecioPorUnd) || '').replace(/[^\d.]/g, ''));
    if (!(ppu > 0)) {
      const cons = parseFloat(first(p['Gramaje de unidad de consumo'])), fac = parseFloat(first(p['Gramaje factor de conversión']));
      if (cons > 0 && fac > 0) ppu = Math.round(precio / (cons * fac) * 100) / 100;
    }
    out.push({
      nombre: p.productName || item.nameComplete || '',
      marca: p.brand || '',
      ean: item.ean || '',
      precio,
      precio_lista: co.ListPrice && co.ListPrice > precio && co.ListPrice < precio * 12 ? co.ListPrice : null,   // perfumería: descuentos de hasta ~90%; x100 = error de carga
      precio_promo: mejor && !sinStock ? Math.round(mejor.precio * 100) / 100 : null,
      promo: mejor ? mejor.texto : '',
      promo_condicion: mejor ? mejor.condicion : '',
      nota: notas.join('. '),
      por_peso: item.measurementUnit === 'kg',
      precio_por_medida: isFinite(ppu) && ppu > 0 && medida ? ppu : null,
      medida,
      imagen: (item.images && item.images[0] && item.images[0].imageUrl) || '',
      exacto: !!(ean && item.ean === ean),
      sin_stock: sinStock,
      rubro: rubroVtex(p),
      link: p.link || '',
      sku: String(item.itemId || ''),
      seller: String((seller && seller.sellerId) || '1'),
    });
  }
  return out;
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Método no permitido' }));
  }
  const query = req.query || {};
  const tienda = TIENDAS[String(query.tienda || '').toLowerCase()];
  if (!tienda) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: 'Tienda desconocida', tiendas: Object.keys(TIENDAS) }));
  }
  const q = String(query.q || '').trim().slice(0, 80);
  const ean = String(query.ean || '').replace(/\D/g, '').slice(0, 14);
  const limite = Math.min(Math.max(parseInt(query.limite, 10) || 48, 1), 50);
  if (!q && !ean) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: 'Falta qué buscar' }));
  }
  try {
    let productos = [];
    let buscadoPor = '';
    if (tienda.magento) {
      productos = await gps.buscar({ ean, q, limite }, leerPromos);
      buscadoPor = ean && productos.some(p => p.exacto) ? 'codigo' : 'nombre';
    }
    else if (ean) {
      productos = mapear(await buscar(tienda.host, 'fq=alternateIds_Ean:' + encodeURIComponent(ean)), ean);
      buscadoPor = 'codigo';
    }
    if (!tienda.magento && !productos.length && q) {
      productos = mapear(await buscar(tienda.host, `ft=${encodeURIComponent(q)}&_from=0&_to=${limite - 1}`), ean);
      buscadoPor = 'nombre';
    }
    productos.sort((a, b) => (Number(b.exacto) - Number(a.exacto)) || (Number(a.sin_stock) - Number(b.sin_stock)));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, super: tienda.nombre, buscado_por: buscadoPor, total: productos.length, productos }));
  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: 'No se pudo consultar a ' + tienda.nombre }));
  }
}

module.exports = handler;
module.exports._test = { leerPromos, mapear, TIENDAS, rubroVtex, lindo };
