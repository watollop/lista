# Lista

To-do list personal como PWA: una sola caja de captura con sintaxis en una línea, lista y filtros. Local-first (IndexedDB), funciona offline y sincroniza Mac ↔ iPhone con Supabase (opcional). Estética editorial en blanco y negro; tema claro, oscuro o el del sistema (Ajustes → Apariencia).

- **Bundle**: ~71 KB gzip en total (JS 68 KB + CSS 2,6 KB + HTML 0,7 KB).
- **Stack**: Vite + TypeScript + Preact · Dexie (IndexedDB) · chrono-node (es) · Service worker propio · Supabase vía `fetch` (sin SDK).

## Uso

Escribe en la caja y pulsa Intro:

```
Revisar informe @ana #aura mañana !1 cada lunes
```

| Sintaxis | Qué hace |
|---|---|
| `#tema` | Tema. Se crea si no existe; autocompleta al escribir (Tab/Intro para aceptar). |
| `@persona` | Persona. Igual que los temas. `#Aura` y `#aura` son el mismo tema. |
| `hoy`, `mañana`, `pasado mañana` (o solo `pasado`), `el viernes`, `el lunes que viene`, `15 nov`, `15 de noviembre`, `en 3 días`, `dentro de 2 semanas`, `la próxima semana`, `fin de mes`, `el finde`, `el 3` | Fecha (sin hora). "por la mañana" **no** es una fecha. |
| `vence:2026-11-15`, `vence:15/11` | Fecha exacta (gana a la natural). |
| `!1` `!2` `!3` | Prioridad (1 = máxima). |
| `cada día`, `cada lunes`, `cada 2 semanas`, `cada mes`, `cada año`, `todos los lunes`, `a diario` | Recurrente: al completarla se crea la siguiente. |
| *(pegar varias líneas)* | Crea una tarea por línea. |

- Tocar una tarea la edita con la misma sintaxis (Intro guarda, Esc cancela). Las fechas se muestran como `vence:` para que "mañana" no se recalcule.
- Tocar un chip `#tema`, `@persona` o `!1` en una tarea filtra por él.
- **Filtros**: una sola fila con cuatro selectores, **Fecha · Tema · Persona · Prioridad**. Cada uno abre solo sus opciones y muestra lo elegido (`HOY`, `#AURA`, `2 TEMAS`). Dentro de Fecha, **Hechas** muestra las completadas. **Buscar** (cabecera) añade texto libre. Se combinan: OR dentro de cada selector, AND entre selectores. Con un filtro activo aparecen **Limpiar** y **Guardar filtro**; los guardados quedan en un quinto selector y se aplican con un toque (o con `1`–`9`).
- Deshacer al completar o borrar desde el aviso inferior.

### Atajos de teclado (Mac)

| Tecla | Acción |
|---|---|
| `⌘K`, `/`, `n` | Ir a la caja de captura |
| `j` `k` / `↓` `↑` | Moverse por la lista |
| `x` / espacio | Completar |
| `e` / Intro | Editar |
| `⌫` | Borrar |
| `h` `s` `v` | Hoy · Semana · Vencidas |
| `1`–`9` | Filtro guardado n |
| `f` | Buscar |
| `Esc` | Quitar selección → cerrar panel → limpiar filtro |

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173 (sin service worker)
npm test           # vitest: parser, filtros, datos, sync, QA
npm run build      # tsc + build en dist/ (genera dist/sw.js versionado)
npm run preview    # sirve dist/ en http://localhost:4173 (con service worker)
npm run icons      # regenera iconos y splash desde scripts/icon.svg
```

Requiere Node ≥ 22.3.

## Sincronización (opcional): Supabase

Sin configurar, la app funciona solo en local. Para sincronizar Mac e iPhone:

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. **SQL Editor** → pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql) (tabla `items`, RLS por usuario y trigger last-write-wins). Es re-ejecutable.
3. **Project Settings → API**: copia la *Project URL* y la clave *anon/publishable* a `.env` (ver `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   La clave anon es pública por diseño; los datos los protege RLS.
4. **Authentication → URL Configuration**: *Site URL* = la URL desplegada (p. ej. `https://lista-xxx.pages.dev`). En *Redirect URLs* añade esa URL y `http://localhost:4173/` y `http://localhost:5173/` para probar en local.

### Acceso con Google

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *Crear credenciales* → *ID de cliente de OAuth* → tipo *Aplicación web*. Si lo pide, configura la pantalla de consentimiento (tipo *Externo*, solo tu email como usuario de prueba basta).
2. *URI de redireccionamiento autorizados*: `https://xxxx.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → Sign In / Providers → Google**: activar y pegar *Client ID* y *Client Secret*.

En la app: **Ajustes → Continuar con Google**. La sesión se renueva sola: solo se entra una vez por dispositivo. Es el único método de acceso (sin contraseñas ni códigos por email); verificado también en la app instalada del iPhone.

Cómo sincroniza: cada cambio se guarda en local al instante y se sube en segundo plano (1,5 s tras escribir, al volver a la app, al recuperar conexión y cada 60 s con la app visible). Conflictos: gana la última edición de cada tarea (por marca de tiempo); los borrados son *tombstones* y también se sincronizan.

**Por qué Supabase y no Firebase**: el SDK de Firestore pesa más que todo el presupuesto de bundle; Supabase se usa con dos APIs HTTP (auth y PostgREST) y unos cientos de líneas. Plan gratuito (consultado en octubre de 2026): 500 MB de base de datos, 50.000 usuarios activos/mes, 5 GB de transferencia, 2 proyectos; **se pausa tras 7 días sin actividad** (los datos se conservan y se reactiva desde el panel). Firebase Spark: 50k lecturas / 20k escrituras al día y 1 GiB, sin pausa, pero con el coste de bundle citado.

## Despliegue: Cloudflare Pages (gratis)

Elegido frente a GitHub Pages porque permite cabeceras propias ([`public/_headers`](public/_headers)): `sw.js` e `index.html` sin caché, `assets/` inmutables.

**Automático con GitHub Actions** ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): cada PR pasa los tests; cada merge/push a `main` pasa los tests, compila y despliega.

Configuración, una sola vez:
1. Crea el proyecto de Pages (vacío) con la API o el dashboard de Cloudflare: *Workers & Pages* → *Create* → *Pages* → *Direct Upload*, nombre `lista` (si usas otro, ponlo en la variable de repositorio `CLOUDFLARE_PAGES_PROJECT`).
2. Token de Cloudflare con un solo permiso: *Account → Cloudflare Pages → Edit* ([API tokens](https://dash.cloudflare.com/profile/api-tokens)).
3. En GitHub → *Settings → Secrets and variables → Actions*, crea los secretos:
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (opcionales; sin ellos no hay sincronización)

**Manual desde tu equipo**: guarda token y Account ID en `.env.cloudflare` (ignorado por git) y ejecuta `npm run deploy`.
```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

> No uses `wrangler pages project create` ni `wrangler deploy` dentro del proyecto: las versiones recientes de Wrangler intentan convertirlo en un Worker y modifican `vite.config.ts` y `package.json`.

> Ningún secreto vive en el repositorio: `.env`, `.env.cloudflare` y cualquier `.env*` (salvo `.env.example`) están en `.gitignore`. La clave *anon/publishable* de Supabase acaba en el JS publicado por diseño; los datos los protege RLS.

La URL ya es HTTPS, requisito para PWA y service worker. Cloudflare Pages redirige `/index.html` → `/`; por eso el service worker navega siempre por `./`.

## Instalar

### iPhone 16 (Chrome, iOS ≥ 16.4)
1. Abre la URL en Chrome.
2. Botón **Compartir** (en la barra de direcciones) → **Añadir a pantalla de inicio** → Añadir.
3. Ábrela desde el icono: se ejecuta a pantalla completa, sin barra de Chrome, con splash y safe areas (Dynamic Island y barra inferior).

En iOS todas las PWA usan WebKit aunque se instalen desde Chrome; los datos de la app instalada son independientes de los de la pestaña de Chrome (inicia sesión dentro de la app instalada).

### Mac (Chrome)
Abre la URL → icono **Instalar** en la barra de direcciones (o menú ⋮ → *Transmitir, guardar y compartir* → *Instalar página como aplicación*). Queda en el Dock y en Launchpad.

## Actualizaciones (sin quedarse en versiones antiguas)

- Cada build genera `sw.js` con una versión = hash del contenido.
- La navegación va **red primero** (sin caché HTTP, 3 s de margen) con *fallback* offline a la copia cacheada.
- El SW nuevo se activa en cuanto se instala y borra las cachés antiguas; la app comprueba actualizaciones al volver a primer plano y cada 30 min.
- La recarga se hace cuando la app pasa a segundo plano, nunca mientras escribes.

## Copias de seguridad

**Ajustes → Exportar** descarga un JSON con todo. **Importar · combinar** fusiona (gana lo más reciente); **Importar · sustituir** reemplaza todo (y con sync activo, se propaga a los demás dispositivos). La app pide almacenamiento persistente (`navigator.storage.persist()`) para que el sistema no borre los datos.

## Arquitectura

```
src/
  types.ts        contratos entre módulos (tipos e interfaces Repo / Sync)
  lib/            fechas locales, normalización de claves, recurrencias (puro)
  parser/         sintaxis de una línea → ParsedLine (puro, chrono-node/es + reglas propias)
  filters/        motor de filtros, orden y agrupación (puro)
  data/           Dexie: tareas, temas, personas, filtros, meta; LWW y marcas dirty
  sync/           auth + PostgREST por fetch, push/pull incremental, estado observable
  pwa/            service worker y registro
  ui/             Preact: App, Capture, TaskList, FilterBar, Settings, estilos
supabase/schema.sql
scripts/          iconos (resvg) y plugin de Vite que genera sw.js
```

## Limitaciones conocidas

- Probado en producción: login con Google contra Supabase real, captura en iPhone instalado y Chrome en Mac. Sin batería de pruebas formal en dispositivo; la sincronización Mac ↔ iPhone está cubierta por tests pero queda por comprobar a fondo con uso real.
- Fechas sin hora: "mañana a las 10" guarda mañana y deja "a las 10" en el título.
- Subtareas desactivadas en la interfaz por ahora (el modelo de datos las mantiene: `parentId`).
- No hay "cada 2 lunes" (intervalo + día de la semana a la vez).
- Conflictos: gana la última edición de **toda** la tarea (no se fusionan campos). Depende de que los relojes de los dispositivos estén en hora.
- Si un dispositivo borra una tarea y otro la edita **después**, la edición gana y la tarea reaparece (sin las subtareas borradas con ella).
- El ✓ de la barra sobre el teclado de iOS es del sistema y solo cierra el teclado; la tarea se guarda con la tecla *intro*.
- `#diseño` y `#diseno` son temas distintos (la ñ se respeta); las tildes sí se ignoran (`@José` = `@jose`).
- Solo se usa la primera fecha de la línea: en "hoy y mañana" la fecha es hoy y "y mañana" queda en el título.
- Supabase gratuito se pausa tras 7 días sin uso: la app sigue funcionando en local y sincroniza al reactivar el proyecto.
- La sesión de Supabase se guarda en `localStorage` del dispositivo.
- Sin notificaciones push (v1): las vencidas y las de hoy se ven en la lista.
- El orden manual (arrastrar) no está en la interfaz; el orden es por vencidas, fecha y prioridad.
- La búsqueda de texto de una subtarea no mira el texto de su tarea padre (los temas y personas sí se heredan).
