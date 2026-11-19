# Perfu Cart

Ofertas y comparación de precios de perfumerías y farmacias online: Farmaonline, Farmacity, Simplicity, Pigmento y GPS Farma.
Hermana de Super Cart: comparte usuarios, ingreso y lista de autorizados (mismo proyecto de Supabase), con tablas propias `perfu_*`.

- `index.html`: la app (ofertas por tienda y rubro, comparador por código de barras, listas en la cuenta, mail diario).
- `api/vtex.js`: búsqueda por código de barras o nombre en las cinco tiendas (VTEX + GPS Farma por Magento, `lib/gps.js`).
- `api/vtex-ofertas.js`: ofertas por rubro, con mayor descuento primero.
- `supabase/perfu-cart.sql`: tablas y seguridad de Perfu Cart.
- `sheets/perfu-cart.gs`: script de la planilla del mail diario.
