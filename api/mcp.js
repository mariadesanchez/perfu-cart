// Belleza & Perfu · servidor MCP (Model Context Protocol) para agentes de IA: Claude, ChatGPT, Claude Code, etc.
// Dirección: https://perfu-cart.vercel.app/api/mcp  (transporte "Streamable HTTP", sin sesión, respuestas JSON)
// Solo lectura: busca y compara precios en las tiendas de Belleza & Perfu. No compra ni toca listas de usuarios.
// La compra la hace la persona en la tienda, con el link que devuelve cada producto.

const vtex = require('./vtex.js');
const WIDGET = require('../lib/mcp-widget.js');
const UI_URI = 'ui://belleza-perfu/resultados.html';
const UI_MIME = 'text/html;profile=mcp-app';
const UI_META = { ui: { prefersBorder: false, csp: { resourceDomains: ['https://*.vteximg.com.br', 'https://*.vtexassets.com', 'https://tienda.andromaco.com', 'https://gpsfarma.com', 'https://cdn.shopify.com', 'https://tiendanutriciabago.com.ar'] } } };
const TOOL_META = { ui: { resourceUri: UI_URI }, 'openai/outputTemplate': UI_URI };

const SERVIDOR = { name: 'belleza-perfu', title: 'Belleza & Perfu', version: '1.0.0' };
const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05'];
const TIENDAS = {
  farmacity: { nombre: 'Farmacity', host: 'https://www.farmacity.com' },
  farmaonline: { nombre: 'Farmaonline', host: 'https://www.farmaonline.com' },
  simplicity: { nombre: 'Simplicity', host: 'https://www.simplicity.com.ar' },
  pigmento: { nombre: 'Pigmento', host: 'https://www.perfumeriaspigmento.com.ar' },
  juleriaque: { nombre: 'Juleriaque', host: 'https://www.juleriaque.com.ar' },
  rouge: { nombre: 'Rouge', host: 'https://www.perfumeriasrouge.com' },
  gpsfarma: { nombre: 'GPS Farma', host: 'https://gpsfarma.com' },
  andromaco: { nombre: 'Andrómaco', host: 'https://tienda.andromaco.com' },
  bago: { nombre: 'Nutricia Bagó', host: 'https://tiendanutriciabago.com.ar' },
};
const CLAVES = Object.keys(TIENDAS);

const INSTRUCCIONES = 'Belleza & Perfu compara precios de perfumería, maquillaje, dermocosmética, protección solar, cuidado personal y suplementos '
  + 'en tiendas online de Argentina (' + CLAVES.map(k => TIENDAS[k].nombre).join(', ') + '). Precios en pesos argentinos (ARS), del momento de la consulta. '
  + 'Para comparar el mismo producto entre tiendas usá el código de barras (EAN) cuando lo tengas: es exacto. Por nombre, cada tienda devuelve lo que más se parece y puede no ser idéntico. '
  + 'No se puede comprar desde acá: mostrale a la persona el link de la tienda más conveniente para que compre ella. No des indicaciones médicas.';

const pTiendas = {
  type: 'array', items: { type: 'string', enum: CLAVES },
  description: 'Tiendas donde buscar (opcional). Si no se indica, busca en todas: ' + CLAVES.join(', ') + '.',
};
const HERRAMIENTAS = [
  {
    name: 'buscar_producto',
    title: 'Buscar producto',
    description: 'Busca productos por nombre (ej. "protector solar facial", "Ombré Leather") o por código de barras en las tiendas de Belleza & Perfu. '
      + 'Devuelve, por tienda, los productos encontrados con precio, precio de lista, promoción, stock, código de barras y link para comprar.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Nombre, marca o tipo de producto, o un código de barras (EAN).' },
        tiendas: pTiendas,
        max_por_tienda: { type: 'integer', minimum: 1, maximum: 10, description: 'Máximo de resultados por tienda (por defecto 5).' },
      },
      required: ['consulta'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: TOOL_META,
  },
  {
    name: 'comparar_precios',
    title: 'Comparar precios',
    description: 'Compara el precio de UN producto en todas las tiendas y las ordena de más barata a más cara. '
      + 'Con código de barras (EAN) la comparación es exacta; con nombre toma el resultado más parecido de cada tienda.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo_barras: { type: 'string', description: 'Código de barras (EAN-13, EAN-8 o UPC). Preferido.' },
        nombre: { type: 'string', description: 'Nombre del producto, si no hay código de barras.' },
        tiendas: pTiendas,
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: TOOL_META,
  },
  {
    name: 'mejor_carrito',
    title: 'Mejor carrito',
    description: 'Recibe una lista de productos (con código de barras o nombre, y cantidad) y arma la compra más barata: '
      + 'en qué tienda conviene cada producto, el subtotal por tienda, el total y cuánto se ahorra frente a comprar todo en la tienda más cara de cada producto.',
    inputSchema: {
      type: 'object',
      properties: {
        productos: {
          type: 'array', minItems: 1, maxItems: 15,
          items: {
            type: 'object',
            properties: {
              codigo_barras: { type: 'string' },
              nombre: { type: 'string' },
              cantidad: { type: 'integer', minimum: 1, maximum: 50 },
            },
          },
        },
        tiendas: pTiendas,
      },
      required: ['productos'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: TOOL_META,
  },
];

// ---------- consulta a las tiendas (usa el mismo buscador que la app, sin pasar por la red) ----------
function consultar(tienda, { ean, q, limite }) {
  return new Promise(resolve => {
    const req = { method: 'GET', query: { tienda, ean: ean || '', q: q || '', limite: String(limite || 10) } };
    const res = { statusCode: 200, setHeader() {}, end(body) { try { resolve(JSON.parse(body)); } catch (e) { resolve({ ok: false }); } } };
    const t = setTimeout(() => resolve({ ok: false, error: 'tardó demasiado' }), 15000);
    Promise.resolve(vtex(req, res)).catch(() => resolve({ ok: false })).finally(() => clearTimeout(t));
  });
}

const soloDigitos = s => String(s || '').replace(/\D/g, '');
const esEan = s => /^\d{8,14}$/.test(soloDigitos(s)) && soloDigitos(s).length === String(s).trim().replace(/\s/g, '').length;
const elegirTiendas = t => { const v = (Array.isArray(t) ? t : []).map(x => String(x).toLowerCase()).filter(x => TIENDAS[x]); return v.length ? v : CLAVES; };
const precioFinal = p => (p.precio_promo && p.precio_promo < p.precio ? p.precio_promo : p.precio);
const pesos = n => '$ ' + Math.round(n).toLocaleString('es-AR');

function linkDe(k, p) {
  if (p.link && /^https?:/.test(p.link)) return p.link;
  const h = TIENDAS[k].host, q = encodeURIComponent(p.nombre || p.ean || '');
  if (k === 'andromaco' || k === 'bago') return h + '/search?q=' + q;
  if (k === 'gpsfarma') return h + '/catalogsearch/result/?q=' + q;
  return h + '/' + q + '?_q=' + q + '&map=ft';
}

function limpio(k, p) {
  const o = { tienda: TIENDAS[k].nombre, nombre: p.nombre, marca: p.marca || undefined, codigo_barras: p.ean || undefined, precio: precioFinal(p) };
  if (p.precio_lista && p.precio_lista > o.precio) o.precio_lista = p.precio_lista;
  if (p.precio_promo && p.precio_promo < p.precio) { o.precio_sin_promo = p.precio; o.promo = [p.promo, p.promo_condicion].filter(Boolean).join(' · '); }
  if (p.sin_stock) o.sin_stock = true;
  o.link = linkDe(k, p);
  if (p.imagen) o.imagen = p.imagen;
  return o;
}

// El mejor resultado de una tienda para un producto: exacto por código; si no, el primero con stock.
async function mejorEn(k, { ean, nombre }) {
  const r = await consultar(k, { ean, q: nombre, limite: 8 });
  const ps = (r && r.ok && r.productos) || [];
  let p = ean ? ps.find(x => x.exacto || soloDigitos(x.ean) === ean) : null;
  if (!p && ean && !nombre) return null;            // con código y sin nombre: solo vale el exacto
  if (!p) p = ps.find(x => !x.sin_stock);
  return p && !p.sin_stock ? { k, p, exacto: !!(ean && soloDigitos(p.ean) === ean) } : null;
}

async function comparar({ codigo_barras, nombre, tiendas }) {
  const ean = soloDigitos(codigo_barras);
  const n = String(nombre || '').trim().slice(0, 80);
  if (!ean && !n) throw new Error('Indicá codigo_barras o nombre.');
  const ts = elegirTiendas(tiendas);
  const hits = (await Promise.all(ts.map(k => mejorEn(k, { ean, nombre: n })))).filter(Boolean);
  hits.sort((a, b) => precioFinal(a.p) - precioFinal(b.p));
  return { ean, nombre: n, ts, hits };
}

// ---------- herramientas ----------
async function buscarProducto({ consulta, tiendas, max_por_tienda }) {
  const c = String(consulta || '').trim().slice(0, 80);
  if (!c) throw new Error('Falta "consulta".');
  const ean = esEan(c) ? soloDigitos(c) : '';
  const max = Math.min(Math.max(parseInt(max_por_tienda, 10) || 5, 1), 10);
  const ts = elegirTiendas(tiendas);
  const rs = await Promise.all(ts.map(async k => {
    const r = await consultar(k, { ean, q: ean ? '' : c, limite: max });
    const ps = ((r && r.ok && r.productos) || []).filter(p => !ean || p.exacto || soloDigitos(p.ean) === ean).slice(0, max);
    return { tienda: TIENDAS[k].nombre, encontrados: ps.length, productos: ps.map(p => limpio(k, p)), error: r && r.ok === false ? 'no respondió' : undefined };
  }));
  const total = rs.reduce((s, r) => s + r.encontrados, 0);
  const resumen = `Búsqueda "${c}"${ean ? ' (código de barras)' : ''}: ${total} resultados en ${rs.filter(r => r.encontrados).length} de ${ts.length} tiendas.`;
  return { texto: resumen, datos: { tipo: 'busqueda', consulta: c, por_codigo: !!ean, resultados: rs } };
}

async function compararPrecios(args) {
  const { ean, nombre, ts, hits } = await comparar(args);
  const que = ean ? 'código ' + ean : '"' + nombre + '"';
  if (!hits.length) return { texto: `No encontré ${que} con stock en ninguna de las ${ts.length} tiendas.`, datos: { tipo: 'comparacion', encontrado: false, tiendas_consultadas: ts.map(k => TIENDAS[k].nombre) } };
  const lista = hits.map(h => ({ ...limpio(h.k, h.p), coincidencia: h.exacto ? 'exacta (código de barras)' : 'por nombre (verificar que sea el mismo producto)' }));
  const barata = lista[0], cara = lista[lista.length - 1];
  const noEsta = ts.filter(k => !hits.some(h => h.k === k)).map(k => TIENDAS[k].nombre);
  let texto = `${barata.nombre}: más barato en ${barata.tienda} a ${pesos(barata.precio)}.`;
  if (lista.length > 1 && cara.precio > barata.precio) texto += ` En ${cara.tienda} cuesta ${pesos(cara.precio)} (ahorrás ${pesos(cara.precio - barata.precio)}, ${Math.round((1 - barata.precio / cara.precio) * 100)}%).`;
  texto += '\n' + lista.map((x, i) => `${i + 1}. ${x.tienda}: ${pesos(x.precio)}${x.promo ? ' (' + x.promo + ')' : ''} · ${x.link}`).join('\n');
  if (noEsta.length) texto += `\nSin stock o no encontrado en: ${noEsta.join(', ')}.`;
  return { texto, datos: { tipo: 'comparacion', encontrado: true, mas_barato: barata, precios: lista, no_encontrado_en: noEsta } };
}

async function mejorCarrito({ productos, tiendas }) {
  const items = (Array.isArray(productos) ? productos : []).slice(0, 15);
  if (!items.length) throw new Error('La lista de productos está vacía.');
  const res = await Promise.all(items.map(async it => {
    const cant = Math.min(Math.max(parseInt(it.cantidad, 10) || 1, 1), 50);
    try {
      const { ean, nombre, hits } = await comparar({ codigo_barras: it.codigo_barras, nombre: it.nombre, tiendas });
      return { pedido: ean || nombre, cantidad: cant, hits };
    } catch (e) { return { pedido: it.nombre || it.codigo_barras || '?', cantidad: cant, hits: [] }; }
  }));
  const porTienda = {}, faltan = [];
  let total = 0, totalCaro = 0;
  const detalle = res.map(r => {
    if (!r.hits.length) { faltan.push(r.pedido); return { pedido: r.pedido, cantidad: r.cantidad, encontrado: false }; }
    const b = r.hits[0], c = r.hits[r.hits.length - 1];
    const x = limpio(b.k, b.p), sub = x.precio * r.cantidad;
    total += sub; totalCaro += precioFinal(c.p) * r.cantidad;
    (porTienda[x.tienda] = porTienda[x.tienda] || { tienda: x.tienda, subtotal: 0, productos: [] });
    porTienda[x.tienda].subtotal += sub;
    porTienda[x.tienda].productos.push({ nombre: x.nombre, cantidad: r.cantidad, precio: x.precio, subtotal: sub, link: x.link });
    return { pedido: r.pedido, cantidad: r.cantidad, encontrado: true, comprar_en: x.tienda, precio: x.precio, subtotal: sub, nombre: x.nombre, marca: x.marca, imagen: x.imagen, precio_lista: x.precio_lista, link: x.link, coincidencia: b.exacto ? 'exacta' : 'por nombre' };
  });
  const grupos = Object.values(porTienda).sort((a, b) => b.subtotal - a.subtotal);
  let texto = `Mejor compra: ${pesos(total)} en ${grupos.length} ${grupos.length === 1 ? 'tienda' : 'tiendas'}`
    + (totalCaro > total ? ` (ahorrás ${pesos(totalCaro - total)} frente a la opción más cara de cada producto).` : '.');
  texto += '\n' + grupos.map(g => `• ${g.tienda} (${pesos(g.subtotal)}): ` + g.productos.map(p => `${p.cantidad} × ${p.nombre} a ${pesos(p.precio)}`).join('; ')).join('\n');
  if (faltan.length) texto += `\nNo encontrados con stock: ${faltan.join(', ')}.`;
  return { texto, datos: { tipo: 'carrito', total, ahorro: Math.max(0, totalCaro - total), por_tienda: grupos, detalle, no_encontrados: faltan } };
}

const EJECUTAR = { buscar_producto: buscarProducto, comparar_precios: compararPrecios, mejor_carrito: mejorCarrito };

// ---------- JSON-RPC ----------
async function atender(m) {
  const { id, method, params } = m || {};
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
  if (!m || m.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Pedido inválido');
  if (id === undefined || id === null) return null;   // notificaciones (ej. notifications/initialized): sin respuesta
  switch (method) {
    case 'initialize': {
      const pedida = params && params.protocolVersion;
      return ok({ protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0], capabilities: { tools: { listChanged: false }, resources: {}, extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME] } } }, serverInfo: SERVIDOR, instructions: INSTRUCCIONES });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: HERRAMIENTAS });
    case 'resources/list': return ok({ resources: [{ uri: UI_URI, name: 'resultados', title: 'Tarjetas de Belleza & Perfu', mimeType: UI_MIME, _meta: UI_META }] });
    case 'resources/templates/list': return ok({ resourceTemplates: [] });
    case 'resources/read':
      if (!params || params.uri !== UI_URI) return err(-32002, 'Recurso no encontrado');
      return ok({ contents: [{ uri: UI_URI, mimeType: UI_MIME, text: WIDGET, _meta: UI_META }] });
    case 'tools/call': {
      const fn = EJECUTAR[params && params.name];
      if (!fn) return err(-32602, 'Herramienta desconocida: ' + (params && params.name));
      try {
        const r = await fn((params && params.arguments) || {});
        return ok({ content: [{ type: 'text', text: r.texto + '\n\n' + JSON.stringify(r.datos) }], structuredContent: r.datos, isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    default: return err(-32601, 'Método no soportado: ' + method);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') {
    // Sin canal de eventos (servidor sin sesión). Una visita desde el navegador ve qué es.
    res.statusCode = 405; res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ servidor: SERVIDOR.title + ' (MCP)', uso: 'Conectá esta dirección como servidor MCP (Streamable HTTP) en Claude, ChatGPT u otro agente.', herramientas: HERRAMIENTAS.map(h => h.name) }));
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (body == null) { res.statusCode = 400; return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } })); }
  const lote = Array.isArray(body);
  const resp = (await Promise.all((lote ? body : [body]).map(atender))).filter(Boolean);
  if (!resp.length) { res.statusCode = 202; return res.end(); }
  res.statusCode = 200;
  return res.end(JSON.stringify(lote ? resp : resp[0]));
};
