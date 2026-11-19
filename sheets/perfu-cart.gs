/**
 * Perfu Cart · mail diario a cada usuario con los precios de sus listas en Farmaonline, Farmacity,
 * Simplicity, Pigmento y GPS Farma (lee usuarios y listas de Supabase, el mismo proyecto que Super Cart).
 *
 * Instalación (una sola vez), en una planilla nueva "Perfu Cart · Mail diario":
 * 1. Extensiones > Apps Script: borrá todo, pegá este código y guardá.
 * 2. Volvé a la planilla y recargala. Menú Perfu Cart > Conectar Supabase: la misma URL y clave secreta sb_secret_ que en Super Cart.
 * 3. Menú Perfu Cart > Configurar (crea el envío diario) y después "Mandar los mails ahora" para probar.
 *
 * Usuarios y autorizados: tablas perfiles y permitidos (compartidas con Super Cart).
 * Preferencias, listas y seguimiento de Perfu Cart: perfu_perfiles, perfu_listas, perfu_items y perfu_seguimiento.
 * Esta planilla solo guarda la configuración y el registro de mails enviados (hoja Avisos).
 */

const ZONA = 'America/Argentina/Buenos_Aires';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Perfu Cart')
    .addItem('Mandar los mails ahora', 'revisarListas')
    .addItem('Conectar Supabase', 'conectarSupabase')
    .addItem('Configurar', 'configurar')
    .addToUi();
}

function hoja_(ss, nombre, enc) {
  let h = ss.getSheetByName(nombre);
  if (!h) h = ss.insertSheet(nombre);
  if (h.getLastRow() === 0) { h.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold'); h.setFrozenRows(1); }
  return h;
}

function config_(opcion) {
  const h = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!h) return '';
  const f = h.getDataRange().getValues().find(r => String(r[0]).trim().toLowerCase() === opcion.toLowerCase());
  return f ? String(f[1]).trim() : '';
}

function aviso_(t) { try { SpreadsheetApp.getUi().alert(t); } catch (e) { console.log(t); } }

const APP_ = () => (config_('Link de la app') || 'https://perfu-cart.vercel.app').replace(/\/+$/, '');
const API_ = () => (config_('API de tiendas') || APP_()).replace(/\/+$/, '');

function configurar() {
  const ss = SpreadsheetApp.getActive();
  const cfg = hoja_(ss, 'Config', ['Opción', 'Valor', 'Ayuda']);
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 3, 3).setValues([
      ['Link de la app', 'https://perfu-cart.vercel.app', 'Dirección de la app (para los links de los mails)'],
      ['API de tiendas', '', 'Vacío = la misma dirección de la app'],
      ['Hora', 9, 'Hora del día (0 a 23) para mandar los mails'],
    ]);
  }
  hoja_(ss, 'Avisos', ['Fecha', 'Email', 'Productos', 'Detalle']);
  const sobra = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (sobra && sobra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sobra);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'revisarListas').forEach(t => ScriptApp.deleteTrigger(t));
  const hora = Math.min(23, Math.max(0, parseInt(config_('Hora'), 10) || 9));
  ScriptApp.newTrigger('revisarListas').timeBased().everyDays(1).atHour(hora).inTimezone(ZONA).create();
  const conectado = !!PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');
  aviso_('Listo. Todos los días entre las ' + hora + ' y las ' + (hora + 1) + ' h se mandan los mails de Perfu Cart.\n'
    + (conectado ? 'Supabase: conectado.' : 'Falta: menú Perfu Cart > Conectar Supabase.') + '\n'
    + 'Podés mandar hasta ' + MailApp.getRemainingDailyQuota() + ' mails hoy con esta cuenta.');
}

// ---------------- Tiendas ----------------
const SUPERS_ORDEN = ['farmaonline', 'farmacity', 'simplicity', 'pigmento', 'gpsfarma'];
const NOMBRE_SUPER = { farmaonline: 'Farmaonline', farmacity: 'Farmacity', simplicity: 'Simplicity', pigmento: 'Pigmento', gpsfarma: 'GPS Farma' };
const NOMBRE_CORTO = { farmaonline: 'Farmaon.', farmacity: 'Farmacity', simplicity: 'Simplic.', pigmento: 'Pigmento', gpsfarma: 'GPS' };

// Tiendas que eligió cada usuario en "Mi cuenta" (si no eligió nada: las cinco)
function supersDe_(u) {
  const s = Array.isArray(u.supers) ? u.supers.filter(x => NOMBRE_SUPER[x]) : SUPERS_ORDEN;
  return s.length ? SUPERS_ORDEN.filter(x => s.includes(x)) : SUPERS_ORDEN;
}

// { farmacity: { mapa: Map(ean -> {reg, of, promo, link}), falla }, ... } solo para los productos de quienes eligieron esa tienda.
// Un producto sin stock online o que la tienda no tiene no aparece: nunca se usa el precio de otra tienda.
function preciosTiendas_(perfiles, porUsuario) {
  const out = {};
  SUPERS_ORDEN.forEach(t => {
    const eans = new Set();
    perfiles.forEach(u => { if (supersDe_(u).includes(t)) (porUsuario.get(u.id) || []).forEach(i => eans.add(i.ean)); });
    const lista = [...eans], mapa = new Map();
    if (lista.length) {
      const res = pedirJson_(lista.map(e => API_() + '/api/vtex?tienda=' + t + '&ean=' + e));
      lista.forEach((e, k) => {
        const p = res[k] && (res[k].productos || []).find(x => x.exacto && !x.sin_stock);
        if (p) mapa.set(e, { reg: p.precio_lista && p.precio_lista > p.precio ? p.precio_lista : p.precio, of: p.precio_promo || (p.precio_lista && p.precio_lista > p.precio ? p.precio : null),
          promo: [p.promo, p.promo_condicion].filter(Boolean).join(' · ') || (p.precio_lista && p.precio_lista > p.precio ? Math.round((1 - p.precio / p.precio_lista) * 100) + '% off' : ''),
          link: p.link || '', imagen: p.imagen || '', nombre: p.nombre || '' });
      });
    }
    out[t] = { mapa, falla: lista.length >= 5 && mapa.size === 0 };   // ningún producto encontrado: la tienda no respondió
  });
  return out;
}

// ---------------- Revisión diaria ----------------
function revisarListas() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('Avisos')) configurar();
  const hoy = Utilities.formatDate(new Date(), ZONA, 'dd/MM/yyyy');
  const hoyIso = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');

  // Usuarios autorizados con el mail de Perfu Cart activado (el mail está en la tabla perfiles, compartida con Super Cart)
  const autorizados = new Set(sbTodo_('permitidos?select=email').map(p => String(p.email).toLowerCase()));
  const mails = new Map(sbTodo_('perfiles?select=id,email').map(p => [p.id, String(p.email || '').toLowerCase()]));
  const perfiles = sbTodo_('perfu_perfiles?select=*&avisos=eq.true&order=creado')
    .map(p => Object.assign({ email: mails.get(p.id) }, p))
    .filter(p => p.email && autorizados.has(p.email));
  if (!perfiles.length) return aviso_('No hay usuarios de Perfu Cart con el mail diario activado.');
  const ids = new Set(perfiles.map(p => p.id));

  // Productos de todas las listas de cada usuario (un producto que está en dos listas va una sola vez, con las cantidades sumadas)
  const porClave = new Map(), porUsuario = new Map();
  sbTodo_('perfu_items?select=user_id,ean,nombre,imagen,link,cantidad&order=user_id,ean,lista_id').forEach(i => {
    if (!ids.has(i.user_id)) return;
    const k = i.user_id + '|' + i.ean, y = porClave.get(k);
    if (y) { y.cant = Math.min(999, y.cant + (Number(i.cantidad) || 1)); return; }
    const item = { ean: i.ean, producto: i.nombre || i.ean, imagen: i.imagen, link: i.link, cant: Number(i.cantidad) || 1, user_id: i.user_id };
    porClave.set(k, item);
    if (!porUsuario.has(i.user_id)) porUsuario.set(i.user_id, []);
    porUsuario.get(i.user_id).push(item);
  });

  const precios = preciosTiendas_(perfiles, porUsuario);
  const estado = new Map();
  sbTodo_('perfu_seguimiento?select=*').forEach(s => estado.set(s.user_id + '|' + s.ean, s));

  let enviados = 0, sinCupo = 0, sinNovedad = 0;
  const cambios = [], hAv = ss.getSheetByName('Avisos');
  perfiles.forEach(u => {
    const lista = porUsuario.get(u.id) || [];
    if (!lista.length) return;
    const supers = supersDe_(u);
    const comp = comparar_(lista, supers, precios);
    // Seguimiento: ¿está en oferta en alguna de sus tiendas? ¿es nueva o bajó?
    const nuevas = [];
    comp.filas.forEach(f => {
      const enOf = supers.filter(s => f.precios[s] && f.precios[s].of);
      const mejor = f.min, tienda = (f.mejores || [])[0] || '';
      const prev = estado.get(u.id + '|' + f.i.ean) || {};
      const enOferta = enOf.length > 0;
      if (enOferta && (!prev.en_oferta || (prev.precio_avisado && mejor < Number(prev.precio_avisado) * 0.99))) nuevas.push(f.i.ean);
      cambios.push({ user_id: u.id, ean: f.i.ean, en_oferta: enOferta, mejor_precio: mejor == null ? null : Math.round(mejor / (f.i.cant || 1) * 100) / 100,
        mejor_tienda: tienda, en_oferta_desde: enOferta ? (prev.en_oferta ? (prev.en_oferta_desde || hoyIso) : hoyIso) : null,
        precio_avisado: enOferta ? (mejor == null ? null : mejor) : null });
    });
    const soloOfertas = u.modo === 'ofertas';
    const filas = soloOfertas ? comp.filas.filter(f => nuevas.includes(f.i.ean)) : comp.filas;
    if (!filas.length) { sinNovedad++; return; }
    if (MailApp.getRemainingDailyQuota() < 1) { sinCupo++; return; }
    const envio = soloOfertas ? comparar_(filas.map(f => f.i), supers, precios) : comp;
    MailApp.sendEmail({ to: u.email, name: 'Perfu Cart', subject: soloOfertas ? asuntoOfertas_(envio, hoy) : asuntoComparacion_(envio, hoy), htmlBody: mailComparacion_(envio, u.baja_token, hoy) });
    enviados++;
    hAv.appendRow([new Date(), u.email, envio.filas.length, (soloOfertas ? 'Ofertas nuevas: ' : 'Resumen · ') + (envio.ganador ? 'más barato en ' + NOMBRE_SUPER[envio.ganador.s] : '')]);
    try { sb_('patch', 'perfu_perfiles?id=eq.' + u.id, { ultimo_aviso: new Date().toISOString(), avisos_enviados: (Number(u.avisos_enviados) || 0) + 1 }, { Prefer: 'return=minimal' }); } catch (e) { console.error(e); }
  });
  for (let i = 0; i < cambios.length; i += 500) sb_('post', 'perfu_seguimiento?on_conflict=user_id,ean', cambios.slice(i, i + 500), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  aviso_('Listas revisadas. Usuarios con mail activo: ' + perfiles.length + '\nMails enviados: ' + enviados
    + (sinNovedad ? '\nSin novedades (eligieron "solo ofertas"): ' + sinNovedad : '')
    + (sinCupo ? '\nSin enviar por límite diario de Gmail: ' + sinCupo : '')
    + SUPERS_ORDEN.filter(t => precios[t].falla).map(t => '\nOjo: ' + NOMBRE_SUPER[t] + ' no respondió hoy.').join(''));
}

function asuntoOfertas_(comp, hoy) {
  return comp.filas.length === 1 ? 'En oferta: ' + String(comp.filas[0].i.producto).slice(0, 60) + ' · Perfu Cart'
    : comp.filas.length + ' productos de tus listas entraron en oferta (' + hoy.slice(0, 5) + ') · Perfu Cart';
}

// ---------------- Supabase ----------------
function conectarSupabase() {
  const ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  const u = ui.prompt('Conectar Supabase (1 de 2)', 'URL del proyecto (Project Settings > API > Project URL), por ejemplo https://abcd1234.supabase.co', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  // Acepta la dirección con o sin /rest/v1/ al final
  const url = (u.getResponseText().trim().match(/^https:\/\/[a-z0-9-]+\.supabase\.co/i) || [''])[0].toLowerCase();
  if (!url) return ui.alert('Esa no es la dirección del proyecto. Tiene que empezar así: https://abcd1234.supabase.co (la ves en Supabase > Integrations > Data API > API URL).');
  const k = ui.prompt('Conectar Supabase (2 de 2)', 'Clave secreta: la que empieza con sb_secret_ (Project Settings > API Keys > Secret keys). No la compartas.', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  const key = k.getResponseText().trim();
  if (/^sb_publishable_/.test(key)) return ui.alert('Esa es la clave pública (sb_publishable_). Acá va la secreta, la que empieza con sb_secret_.');
  props.setProperties({ SUPABASE_URL: url, SUPABASE_KEY: key });
  try {
    const n = sb_('get', 'perfiles?select=id', null, { Prefer: 'count=exact', Range: '0-0' }, true);
    ui.alert('¡Conectado! Hay ' + n + (n === 1 ? ' usuario' : ' usuarios') + ' (usuarios compartidos con Super Cart).');
  } catch (e) {
    props.deleteProperty('SUPABASE_KEY');
    ui.alert('No se pudo conectar: ' + e.message + '\nRevisá la URL y la clave service_role y probá de nuevo.');
  }
}

// Llamada a la API de Supabase con la clave service_role (guardada en el script, no en la planilla)
function sb_(metodo, ruta, cuerpo, extra, contar) {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('SUPABASE_URL'), key = p.getProperty('SUPABASE_KEY');
  if (!url || !key) throw new Error('Supabase no está conectado (menú Perfu Cart > Conectar Supabase)');
  const opciones = { method: metodo, muteHttpExceptions: true, contentType: 'application/json',
    // Claves nuevas (sb_secret_...): solo en el header apikey. Claves viejas (JWT service_role): también como Bearer.
    headers: Object.assign(/^eyJ/.test(key) ? { apikey: key, Authorization: 'Bearer ' + key } : { apikey: key }, extra || {}) };
  if (cuerpo != null) opciones.payload = JSON.stringify(cuerpo);
  const r = UrlFetchApp.fetch(url + '/rest/v1/' + ruta, opciones);
  const code = r.getResponseCode();
  if (code >= 300) throw new Error('Supabase respondió ' + code + ': ' + r.getContentText().slice(0, 200));
  if (contar) { const cr = r.getHeaders()['Content-Range'] || r.getHeaders()['content-range'] || ''; return Number(cr.split('/')[1]) || 0; }
  const txt = r.getContentText();
  return txt ? JSON.parse(txt) : null;
}

// Trae todas las filas, de a 1000 (el máximo por consulta de Supabase)
function sbTodo_(ruta) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const filas = sb_('get', ruta, null, { Range: desde + '-' + (desde + 999), 'Range-Unit': 'items' });
    out.push.apply(out, filas);
    if (filas.length < 1000) return out;
  }
}

// ---------------- Pedidos a la API ----------------

function pedirJson_(urls) {
  const out = [];
  for (let i = 0; i < urls.length; i += 15) {
    const lote = urls.slice(i, i + 15);
    let res;
    try { res = UrlFetchApp.fetchAll(lote.map(u => ({ url: u, muteHttpExceptions: true }))); } catch (e) { res = lote.map(() => null); }
    res.forEach(r => {
      let d = null;
      if (r && r.getResponseCode() === 200) { try { d = JSON.parse(r.getContentText()); } catch (e) { d = null; } }
      out.push(d && d.ok ? d : null);
    });
  }
  return out;
}

// Cuánto sale cada producto hoy según la cantidad. Las promos "Llevando N" solo valen de a N unidades: el resto va a precio normal.
function cuenta_(i) {
  const cant = i.cant || 1;
  const reg = i.regular || null, of = i.enOferta ? i.oferta : null;
  if (!reg && !of) return { cant, total: null, sin: null, lleva: 0, enPromo: 0 };
  const lleva = Number((/llevando\s*(\d+)/i.exec(i.promo || '') || [])[1]) || 0;
  const enPromo = of ? (lleva > 1 ? Math.floor(cant / lleva) * lleva : cant) : 0;
  const total = enPromo * of + (cant - enPromo) * (reg || of);
  return { cant, total, sin: cant * (reg || of), lleva, enPromo };
}

// Arma la comparación de un usuario: precio de cada producto en cada tienda, totales y el más barato
function comparar_(items, supers, vtex) {
  const filas = items.map(i => {
    const precios = {};
    supers.forEach(s => {
      let x = null;
      if (vtex[s] && vtex[s].mapa.has(i.ean)) x = vtex[s].mapa.get(i.ean);
      if (x) {
        const c = cuenta_({ cant: i.cant, regular: x.reg, enOferta: !!x.of, oferta: x.of, promo: x.promo });
        x = Object.assign({}, x, { total: c.total, unidad: c.total / c.cant, c });
      }
      precios[s] = x;
    });
    const hay = supers.filter(s => precios[s]);
    const min = hay.length ? Math.min.apply(null, hay.map(s => precios[s].total)) : null;
    return { i, precios, min, mejores: hay.filter(s => precios[s].total <= min + 0.005) };
  }).sort((a, b) => String(a.i.producto).localeCompare(String(b.i.producto), 'es'));
  const tot = supers.map(s => {
    const con = filas.filter(f => f.precios[s]);
    return { s, total: con.reduce((a, f) => a + f.precios[s].total, 0), tiene: con.length, faltan: filas.length - con.length, falla: vtex[s] && vtex[s].falla };
  });
  // El más barato: entre los que respondieron, el que tiene más productos de tu lista y, a igualdad, el total más bajo
  const validos = tot.filter(x => !x.falla && x.tiene);
  const minFaltan = validos.length ? Math.min.apply(null, validos.map(x => x.faltan)) : 0;
  const ganador = validos.filter(x => x.faltan === minFaltan).sort((a, b) => a.total - b.total)[0] || null;
  const mezclado = filas.filter(f => f.min != null).reduce((a, f) => a + f.min, 0);
  const sinNinguno = filas.filter(f => f.min == null).length;
  return { supers, filas, tot: tot.sort((a, b) => (a.falla - b.falla) || (a.faltan - b.faltan) || (a.total - b.total)), ganador, mezclado, sinNinguno, unidades: items.reduce((a, i) => a + (i.cant || 1), 0) };
}

function asuntoComparacion_(comp, hoy) {
  const g = comp.ganador;
  return 'Tus listas hoy (' + hoy.slice(0, 5) + '): ' + (g ? 'más barato en ' + NOMBRE_SUPER[g.s] + ' ' + pesos_(g.total) : 'comparación de precios') + ' · Perfu Cart';
}

function mailComparacion_(comp, token, hoy) {
  const app = APP_(), S = comp.supers;
  const filaTot = t => {
    const gana = comp.ganador && comp.ganador.s === t.s;
    return '<tr><td style="padding:9px 10px;border-bottom:1px solid #f3dce7;font-weight:800;font-size:15px">' + NOMBRE_SUPER[t.s]
      + (gana ? ' <span style="background:#14935A;color:#fff;border-radius:6px;padding:1px 6px;font-size:11px;vertical-align:2px">MÁS BARATO</span>' : '') + '</td>'
      + '<td style="padding:9px 10px;border-bottom:1px solid #f3dce7;text-align:right;white-space:nowrap">'
      + (t.falla ? '<span style="color:#A35F00;font-size:12px">No respondió hoy</span>' : !t.tiene ? '<span style="color:#999;font-size:12px">No tiene tus productos hoy</span>'
        : '<b style="font-size:17px;color:' + (gana ? '#14935A' : '#1B2140') + '">' + pesos_(t.total) + '</b><br><span style="font-size:12px;color:' + (t.faltan ? '#A35F00' : '#777') + '">'
          + (t.faltan ? 'Sin ' + t.faltan + (t.faltan === 1 ? ' producto' : ' productos') : 'Tiene todos') + '</span>')
      + '</td></tr>';
  };
  const corto = n => '$' + Math.round(n).toLocaleString('es-AR');   // en la tabla, sin centavos para que entren 5 tiendas en el celu
  const fs = S.length > 3 ? 12 : 13;
  const celda = (f, s) => {
    const x = f.precios[s];
    if (!x) return '<td style="padding:8px 4px;border-bottom:1px solid #f0f0f0;text-align:center;color:#bbb;font-size:12px">—</td>';
    const mejor = f.mejores.indexOf(s) >= 0 && S.length > 1;
    const precio = '<span style="font-weight:800;font-size:' + fs + 'px;color:' + (mejor ? '#14935A' : '#1B2140') + '">' + (mejor ? '✓' : '') + corto(x.unidad) + '</span>';
    return '<td style="padding:8px 3px;border-bottom:1px solid #f0f0f0;text-align:right;vertical-align:top;white-space:nowrap;' + (mejor ? 'background:#EAF7F0;' : '') + '">'
      + (x.link ? '<a href="' + esc_(x.link) + '" style="text-decoration:none">' + precio + '</a>' : precio)
      + (x.of ? '<br><span style="font-size:11px;color:#999;text-decoration:line-through">' + corto(x.reg) + '</span>' : '')
      + (x.promo ? '<br><span style="font-size:10px;color:#FF2E7E;white-space:normal">' + esc_(x.promo.split(' · ')[0].slice(0, 14)) + '</span>' : '')
      + (x.c.lleva > 1 && x.c.enPromo < x.c.cant ? '<br><span style="font-size:10px;color:#A35F00;white-space:normal">promo llevando ' + x.c.lleva + '</span>' : '')
      + '</td>';
  };
  const filas = comp.filas.map(f => '<tr><td style="padding:8px 6px 8px 0;border-bottom:1px solid #f0f0f0;font-size:12px;vertical-align:top">'
    + (f.i.cant > 1 ? '<b>' + f.i.cant + ' ×</b> ' : '') + nombre_(f.i) + '</td>' + S.map(s => celda(f, s)).join('') + '</tr>').join('');
  const cuerpo =
    '<div style="font-size:14px;color:#555;margin:0 0 8px">Tus ' + comp.filas.length + ' productos (' + comp.unidades + ' unidades) en cada tienda, con las ofertas de hoy:</div>'
    + '<table style="width:100%;border-collapse:collapse;background:#FFF0F6;border:2px solid #FF2E7E;border-radius:14px;margin:0 0 10px">' + comp.tot.map(filaTot).join('') + '</table>'
    + (S.length > 1 && comp.mezclado ? '<div style="font-size:13px;color:#333;margin:0 0 16px">Si comprás cada producto donde está más barato: <b style="color:#14935A">' + pesos_(comp.mezclado) + '</b>'
      + (comp.sinNinguno ? ' <span style="color:#A35F00">(' + comp.sinNinguno + (comp.sinNinguno === 1 ? ' producto no está' : ' productos no están') + ' en ninguno hoy)</span>' : '') + '</div>' : '')
    + '<div style="font-weight:800;font-size:15px;margin:6px 0 2px">Precio por unidad en cada tienda</div>'
    + '<div style="font-size:12px;color:#777;margin:0 0 6px">✓ en verde: el más barato. — : esa tienda no lo tiene o no tiene stock online. Tocá un precio para ver el producto.</div>'
    + '<table style="width:100%;border-collapse:collapse"><tr><th style="text-align:left;font-size:12px;padding:6px 6px 6px 0;border-bottom:2px solid #eee">Producto</th>'
    + S.map(s => '<th style="text-align:right;font-size:11px;padding:6px 3px;border-bottom:2px solid #eee">' + (S.length > 3 ? NOMBRE_CORTO[s] : NOMBRE_SUPER[s]) + '</th>').join('') + '</tr>' + filas + '</table>'
    + '<div style="margin-top:20px">' + boton_(app + '/#listas', 'Ver mis listas en Perfu Cart') + '</div>';
  return plantilla_('Tus listas · ' + hoy, cuerpo,
    'Precios online de cada tienda. Los totales suman solo los productos que cada tienda tiene hoy con stock online.<br>'
    + 'Elegí las tiendas y el tipo de mail en <a href="' + esc_(app + '/#cuenta') + '" style="color:#888">tu cuenta</a>. '
    + '<a href="' + esc_(app + '/?baja=' + token) + '" style="color:#888">Darte de baja</a>.');
}

const pesos_ = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Nombre del producto con link a su página (si se conoce)
const nombre_ = i => i.link ? '<a href="' + esc_(i.link) + '" style="color:#1b1b1f;text-decoration:none">' + esc_(i.producto) + '</a>' : esc_(i.producto);
const esc_ = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function boton_(href, texto) {
  return '<a href="' + esc_(href) + '" style="display:inline-block;background:#8B3DF0;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px">' + esc_(texto) + '</a>';
}

function plantilla_(titulo, cuerpo, pie) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1b1b1f">'
    + '<div style="background:#8B3DF0;border-radius:16px 16px 0 0;padding:18px 20px;color:#fff">'
    + '<div style="font-size:24px;font-weight:800;letter-spacing:.5px">Perfu <span style="background:#FFF01F;color:#1b1b1f;padding:0 8px;border-radius:8px">Cart</span></div>'
    + '<div style="font-size:15px;margin-top:4px">' + esc_(titulo) + '</div></div>'
    + '<div style="border:1px solid #eee;border-top:0;border-radius:0 0 16px 16px;padding:20px">' + cuerpo + '</div>'
    + '<div style="font-size:12px;color:#888;padding:12px 4px;line-height:1.5">' + (pie || 'Precios online de cada tienda.') + '</div></div>';
}

