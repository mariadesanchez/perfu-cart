// Interfaz (MCP Apps) que Claude / ChatGPT muestran dentro del chat con los resultados de Belleza & Perfu:
// tarjetas como las de la app y el mail (foto, precio en verde, tachado con % off, tienda y botón a la tienda).
// Se comunica con el chat por postMessage (JSON-RPC): ui/initialize → ui/notifications/tool-result.
module.exports = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--bg:#fff;--card:#fff;--ink:#1d1b26;--muted:#6b6878;--line:#ece8f1;--soft:#f7f4fa;--ok:#15803d;--okbg:#dcfce7;--sec:#B43FC0;--sec2:#E2367F;color-scheme:light}
  [data-theme=dark]{--bg:transparent;--card:#24212c;--ink:#f3f1f7;--muted:#a7a3b3;--line:#363241;--soft:#2c2935;--ok:#4ade80;--okbg:#14351f;color-scheme:dark}
  *{box-sizing:border-box}
  html,body{margin:0;background:transparent}
  body{font:15px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding:2px}
  .hd{display:flex;align-items:center;gap:8px;margin:2px 2px 10px;font-weight:700;font-size:14px}
  .hd .dot{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#E79BEA,var(--sec));display:grid;place-items:center;color:#fff;font-size:13px}
  .hd .tx{min-width:0}.hd small{display:block;font-weight:500;color:var(--muted);font-size:12.5px}
  .cards{display:grid;gap:10px}
  .c{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;align-items:center}
  .ph{flex:none;width:96px;height:96px;border-radius:12px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;overflow:hidden}
  .ph img{max-width:92%;max-height:92%;object-fit:contain}
  .ph span{font-size:34px}
  .bd{min-width:0;flex:1}
  .nm{font-weight:650;font-size:14.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .mk{color:var(--muted);font-size:12.5px;margin-top:1px;text-transform:uppercase;letter-spacing:.02em}
  .pr{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
  .ok{background:var(--okbg);color:var(--ok);font-weight:800;border-radius:999px;padding:3px 10px;font-size:16px}
  .px{font-weight:800;font-size:16px}
  .st{text-decoration:line-through;color:var(--muted);font-size:13px}
  .off{background:#fde2ee;color:#be185d;font-weight:700;border-radius:6px;padding:1px 6px;font-size:12px}
  .wh{margin-top:4px;font-size:13px;color:var(--muted)} .wh b{color:var(--ink)}
  .promo{font-size:12px;color:var(--sec);margin-top:3px}
  .go{appearance:none;border:0;cursor:pointer;margin-top:8px;background:linear-gradient(180deg,#F25C9B,var(--sec2));color:#fff;font:inherit;font-weight:700;font-size:13px;border-radius:999px;padding:7px 14px;box-shadow:0 2px 0 #b3165d}
  .go:active{transform:translateY(1px);box-shadow:none}
  .others{margin-top:8px;border-top:1px dashed var(--line);padding-top:8px;font-size:13px;color:var(--muted);display:grid;gap:4px}
  .others a,.others button.lk{all:unset;cursor:pointer;color:var(--ink);text-decoration:underline;text-decoration-color:var(--line)}
  .row{display:flex;justify-content:space-between;gap:10px}
  .row b{color:var(--ink)}
  .tot{background:var(--soft);border-radius:16px;padding:14px;text-align:center;margin-bottom:10px}
  .tot .t1{font-weight:700} .tot .ok{display:inline-block;margin-top:6px;font-size:22px;padding:4px 16px}
  .tot .t2{color:var(--muted);font-size:13px;margin-top:6px}
  .grp{font-weight:750;margin:12px 2px 6px;display:flex;justify-content:space-between}
  .grp span{color:var(--muted);font-weight:600}
  .tag{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 8px;background:var(--soft);color:var(--muted);margin-top:4px}
  .empty{padding:18px;text-align:center;color:var(--muted);background:var(--soft);border-radius:16px}
  .more{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:600;border-radius:999px;padding:8px 14px;cursor:pointer;width:100%;margin-top:10px}
  .q{font-size:12.5px;color:var(--muted);margin-left:4px}
</style></head>
<body><div id="app"><div class="empty">Buscando precios…</div></div>
<script>
(function(){
  var app = document.getElementById('app'), nid = 1, pend = {};
  function send(m){ try { window.parent.postMessage(m, '*'); } catch(e){} }
  function req(method, params){ var id = nid++; send({ jsonrpc:'2.0', id:id, method:method, params:params||{} }); return new Promise(function(r){ pend[id]=r; setTimeout(function(){ if(pend[id]){ delete pend[id]; r(null); } }, 4000); }); }
  function note(method, params){ send({ jsonrpc:'2.0', method:method, params:params||{} }); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $p(n){ return '$ ' + Math.round(n).toLocaleString('es-AR'); }
  function tema(ctx){ if(!ctx) return; if(ctx.theme) document.documentElement.setAttribute('data-theme', ctx.theme); }
  function abrir(url){ req('ui/open-link', { url:url }).then(function(r){ if(r===null){ try{ window.open(url,'_blank','noopener'); }catch(e){} } }); }
  document.addEventListener('click', function(e){ var b = e.target.closest('[data-url]'); if(b){ e.preventDefault(); abrir(b.getAttribute('data-url')); } });
  function avisarTam(){ note('ui/notifications/size-changed', { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }); }
  try { new ResizeObserver(avisarTam).observe(document.body); } catch(e){}

  function foto(p){ return '<div class="ph">' + (p.imagen ? '<img src="'+esc(p.imagen)+'" alt="" onerror="this.parentNode.innerHTML=\'<span>🧴</span>\'">' : '<span>🧴</span>') + '</div>'; }
  function precio(p, verde){
    var h = verde ? '<span class="ok">✓ '+$p(p.precio)+'</span>' : '<span class="px">'+$p(p.precio)+'</span>';
    var antes = p.precio_lista || p.precio_sin_promo;
    if (antes && antes > p.precio) h += '<span class="st">'+$p(antes)+'</span><span class="off">-'+Math.round((1-p.precio/antes)*100)+'%</span>';
    return '<div class="pr">'+h+'</div>';
  }
  function tarjeta(p, opt){
    opt = opt || {};
    return '<div class="c">'+foto(p)+'<div class="bd"><div class="nm">'+esc(p.nombre)+'</div>'
      + (p.marca ? '<div class="mk">'+esc(p.marca)+'</div>' : '')
      + precio(p, opt.verde)
      + (opt.cant ? '<div class="wh">'+opt.cant+' × '+$p(p.precio)+' = <b>'+$p(p.precio*opt.cant)+'</b></div>' : '')
      + (opt.lugar !== false ? '<div class="wh">'+(opt.verde ? 'Más barato en ' : 'En ')+'<b>'+esc(p.tienda)+'</b></div>' : '')
      + (p.promo ? '<div class="promo">🏷️ '+esc(p.promo)+'</div>' : '')
      + (opt.extra || '')
      + (p.link ? '<button class="go" data-url="'+esc(p.link)+'">Ver en '+esc(p.tienda)+' →</button>' : '')
      + '</div></div>';
  }
  function cab(t, sub){ return '<div class="hd"><span class="dot">✦</span><div class="tx">'+esc(t)+(sub?'<small>'+esc(sub)+'</small>':'')+'</div></div>'; }

  function comparar(d){
    if (!d.encontrado) return cab('Belleza & Perfu') + '<div class="empty">No lo encontré con stock en ninguna tienda.</div>';
    var b = d.mas_barato, otros = d.precios.slice(1);
    var ex = '';
    if (otros.length || (d.no_encontrado_en||[]).length) {
      ex = '<div class="others">' + otros.map(function(o){ return '<div class="row"><button class="lk" data-url="'+esc(o.link)+'">'+esc(o.tienda)+'</button><b>'+$p(o.precio)+'</b></div>'; }).join('')
        + ((d.no_encontrado_en||[]).length ? '<div>'+esc(d.no_encontrado_en.join(' · '))+': no encontrado</div>' : '') + '</div>';
    }
    var caro = d.precios[d.precios.length-1];
    var sub = caro && caro.precio > b.precio ? 'ahorrás '+$p(caro.precio-b.precio)+' vs. '+caro.tienda : d.precios.length+' tiendas';
    return cab('Comparación de precios', sub) + '<div class="cards">' + tarjeta(b, { verde:true, extra: ex }) + '</div>';
  }
  function buscar(d){
    var todos = [];
    (d.resultados||[]).forEach(function(r){ (r.productos||[]).forEach(function(p){ if(!p.sin_stock) todos.push(p); }); });
    todos.sort(function(a,b){ return a.precio-b.precio; });
    var tiendas = (d.resultados||[]).filter(function(r){ return r.encontrados; }).length;
    if (!todos.length) return cab('Belleza & Perfu') + '<div class="empty">Sin resultados para “'+esc(d.consulta)+'”.</div>';
    var n = 6, h = cab('“'+d.consulta+'”', todos.length+' productos en '+tiendas+' tiendas · del más barato al más caro');
    function pintar(k){ return '<div class="cards">'+todos.slice(0,k).map(function(p,i){ return tarjeta(p, { verde: i===0 }); }).join('')+'</div>' + (todos.length>k ? '<button class="more" id="mas">Ver '+Math.min(6,todos.length-k)+' más</button>' : ''); }
    setTimeout(function enlazar(){ var m = document.getElementById('mas'); if(m) m.onclick = function(){ n += 6; document.getElementById('lista').innerHTML = pintar(n); enlazar(); }; }, 0);
    return h + '<div id="lista">' + pintar(n) + '</div>';
  }
  function carrito(d){
    var h = cab('Tu compra más conveniente');
    h += '<div class="tot"><div class="t1">¡Aprovechá todas las ofertas!</div><span class="ok">'+$p(d.total)+'</span>'
      + '<div class="t2">'+(d.por_tienda||[]).length+' '+((d.por_tienda||[]).length===1?'tienda':'tiendas')+(d.ahorro>0?' · ahorrás '+$p(d.ahorro):'')+'</div></div>';
    var det = d.detalle||[];
    (d.por_tienda||[]).forEach(function(g){
      h += '<div class="grp">'+esc(g.tienda)+'<span>'+$p(g.subtotal)+'</span></div><div class="cards">';
      det.filter(function(x){ return x.encontrado && x.comprar_en===g.tienda; }).forEach(function(x){
        h += tarjeta({ nombre:x.nombre, precio:x.precio, tienda:x.comprar_en, link:x.link, imagen:x.imagen, marca:x.marca, precio_lista:x.precio_lista }, { verde:true, cant: x.cantidad>1 ? x.cantidad : 0, lugar:false });
      });
      h += '</div>';
    });
    if ((d.no_encontrados||[]).length) h += '<div class="others">Producto no encontrado en ninguna tienda: '+esc(d.no_encontrados.join(', '))+'</div>';
    return h;
  }
  function pintar(res){
    var d = res && (res.structuredContent || (function(){ try { var t = res.content[0].text; return JSON.parse(t.slice(t.indexOf('\n\n{')+2)); } catch(e){ return null; } })());
    if (!d) { app.innerHTML = '<div class="empty">No llegaron resultados.</div>'; return; }
    app.innerHTML = d.tipo === 'comparacion' ? comparar(d) : d.tipo === 'carrito' ? carrito(d) : buscar(d);
    avisarTam();
  }
  window.addEventListener('message', function(ev){
    var m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && pend[m.id]) { var r = pend[m.id]; delete pend[m.id]; r(m.result || null); return; }
    if (m.method === 'ui/notifications/tool-result') pintar(m.params);
    else if (m.method === 'ui/notifications/host-context-changed') tema(m.params);
    else if (m.method === 'ui/resource-teardown' && m.id != null) send({ jsonrpc:'2.0', id:m.id, result:{} });
    else if (m.method === 'ping' && m.id != null) send({ jsonrpc:'2.0', id:m.id, result:{} });
  });
  req('ui/initialize', { protocolVersion:'2026-01-26', appInfo:{ name:'Belleza & Perfu', version:'1.0.0' }, appCapabilities:{ availableDisplayModes:['inline'] } })
    .then(function(r){ if (r && r.hostContext) tema(r.hostContext); note('ui/notifications/initialized'); });
})();
</script></body></html>`;
