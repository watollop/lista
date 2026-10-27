# Lista

Gestor de tareas personal en forma de PWA. Todo empieza en una sola caja de texto: escribes la tarea en una línea y la app detecta fecha, temas, personas, prioridad y recurrencia.

Es **local-first**: los datos viven en el dispositivo, funciona sin conexión y, opcionalmente, se sincroniza entre dispositivos con Supabase.

```
Revisar informe @ana #marketing mañana !1 cada lunes
```

## Características

- **Captura en una línea** con lenguaje natural en español, vista previa de lo detectado y autocompletado de temas y personas.
- **Filtros combinables** por fecha, tema, persona, prioridad y texto, que se pueden guardar y reutilizar.
- **Tareas recurrentes**: al completar una tarea se crea la siguiente ocurrencia.
- **Gestos y teclado**: desliza a la derecha para completar en móvil; atajos tipo Vim en escritorio.
- **Offline y sincronización**: IndexedDB en local y sincronización en segundo plano con Supabase, con acceso mediante Google.
- **Instalable** en iOS, Android y escritorio, con tema claro, oscuro o el del sistema.
- **Bienvenida** de tres pasos la primera vez (también en *Ajustes → Cómo funciona*).
- **Ligera**: unos 70 KB comprimidos en total y sin dependencias de UI pesadas.

## Sintaxis

| Escribe | Resultado |
|---|---|
| `#tema` | Asigna un tema; se crea si no existe y se queda en el texto, resaltado. Sin distinguir mayúsculas ni tildes. |
| `@persona` | Asigna una persona, con el mismo comportamiento que los temas. |
| `hoy`, `mañana`, `pasado` o `pasado mañana`, `el viernes`, `el lunes que viene`, `15 nov`, `en 3 días`, `dentro de 2 semanas`, `la próxima semana`, `fin de mes`, `el finde` | Fecha de vencimiento. |
| `esta semana`, `este mes`, `este trimestre` / `T4`, `este año` | Fecha de periodo: vence al final de la semana (viernes), del mes, del trimestre natural o del año. Se muestra como `esta semana`, `octubre`, `este trimestre`, `2026` y se agrupa en su bloque. También `la semana que viene`, `el mes que viene`, `el trimestre que viene`, `el año que viene`. |
| `vence:2026-11-15`, `vence:15/11` | Fecha exacta; tiene prioridad sobre la natural. |
| `!alta` `!media` `!baja` (o `!1` `!2` `!3`) | Prioridad; se muestra como ⇈ ↑ ↓. |
| `cada día`, `cada lunes`, `cada 2 semanas`, `cada mes`, `cada año`, `a diario` | Recurrencia. |

Al pegar varias líneas se crea una tarea por línea.

## Uso

- **Editar**: toca una tarea para editarla con la misma sintaxis.
- **Completar**: toca el check o desliza a la derecha. Las tareas completadas hoy siguen visibles al final de su bloque y desaparecen al día siguiente; puedes consultarlas en *Fecha → Hechas*.
- **Filtrar**: toca un chip (`#tema`, `@persona`, la fecha o la prioridad) para filtrar por él, o usa los selectores *Fecha · Tema · Persona · Prioridad*. Las opciones de un mismo selector se combinan con O y los selectores entre sí con Y.
- **Borrar**: desliza a la izquierda (móvil) o usa la papelera que aparece al pasar el ratón (escritorio). Borrar una tarea recurrente no crea la siguiente.
- **Deshacer**: completar y borrar se pueden deshacer desde el aviso inferior.

### Atajos de teclado

| Tecla | Acción |
|---|---|
| `⌘K` `/` `n` | Escribir una tarea |
| `j` `k` · `↓` `↑` | Moverse por la lista |
| `x` · espacio | Completar |
| `e` · Intro | Editar |
| `⌫` | Borrar |
| `h` `s` `v` | Filtrar por hoy, semana o vencidas |
| `1`–`9` | Aplicar un filtro guardado |
| `f` | Buscar |
| `Esc` | Quitar la selección, cerrar el panel o limpiar el filtro |

## Puesta en marcha

Requiere Node 22 o superior.

```bash
npm install
npm run dev       # servidor de desarrollo en http://localhost:5173
npm test          # tests (Vitest)
npm run build     # comprobación de tipos y build de producción en dist/
npm run preview   # sirve dist/ con service worker en http://localhost:4173
```

Sin configuración adicional la app funciona en modo local, sin sincronización.

## Sincronización con Supabase (opcional)

1. Crea un proyecto en [Supabase](https://supabase.com).
2. En el **SQL Editor**, ejecuta [`supabase/schema.sql`](supabase/schema.sql). Crea la tabla `items`, las políticas RLS por usuario, un trigger *last-write-wins* y la función `delete_account` (para que cada usuario pueda eliminar su cuenta desde Ajustes). Se puede volver a ejecutar sin problema.
3. Copia `.env.example` a `.env` y rellena la *Project URL* y la clave pública (*anon* o *publishable*):
   ```
   VITE_SUPABASE_URL=https://<proyecto>.supabase.co
   VITE_SUPABASE_ANON_KEY=<clave pública>
   ```
4. En **Authentication → URL Configuration**:
   - *Site URL*: la URL de producción.
   - *Redirect URLs*: la URL de producción y, para desarrollo, `http://localhost:5173/` y `http://localhost:4173/`.

### Acceso con Google

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crea un *ID de cliente de OAuth* de tipo *Aplicación web*.
2. Añade como URI de redirección autorizada `https://<proyecto>.supabase.co/auth/v1/callback`.
3. En Supabase, en **Authentication → Sign In / Providers → Google**, actívalo e introduce el *Client ID* y el *Client Secret*.

En la app, ve a **Ajustes → Continuar con Google**. La sesión se renueva automáticamente.

### Cómo funciona

- Cada cambio se guarda en local al instante y se sube en segundo plano: tras escribir, al volver a la app, al recuperar la conexión y periódicamente.
- Los conflictos se resuelven por tarea con *last-write-wins*, según la marca de tiempo. Los borrados se propagan como *tombstones*.
- La clave pública de Supabase forma parte del cliente por diseño; los datos están protegidos por RLS.

## Despliegue

El proyecto se despliega en **Cloudflare Pages**, que permite definir cabeceras propias ([`public/_headers`](public/_headers)): caché del service worker y cabeceras de seguridad. La *Content-Security-Policy* se completa en cada build con los hashes del script y el estilo en línea de `index.html` ([`scripts/csp-plugin.ts`](scripts/csp-plugin.ts)).

### GitHub Actions

El workflow [`deploy.yml`](.github/workflows/deploy.yml) ejecuta los tests en cada pull request y, en cada push a `main`, ejecuta los tests, compila y despliega.

Configuración inicial:

1. Crea en Cloudflare un proyecto de Pages de tipo *Direct Upload* llamado `lista`. Si usas otro nombre, defínelo en la variable de repositorio `CLOUDFLARE_PAGES_PROJECT`.
2. Crea un token de API con el permiso *Account → Cloudflare Pages → Edit*.
3. En GitHub, en **Settings → Secrets and variables → Actions**, añade los secretos:

| Secreto | Obligatorio |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Sí |
| `CLOUDFLARE_ACCOUNT_ID` | Sí |
| `VITE_SUPABASE_URL` | Solo para sincronización |
| `VITE_SUPABASE_ANON_KEY` | Solo para sincronización |

### Despliegue manual

Crea `.env.cloudflare` con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` y ejecuta:

```bash
npm run deploy
```

Los archivos `.env*`, salvo `.env.example`, están excluidos del control de versiones.

## Instalación como app

- **iOS (16.4 o superior)**: abre la URL en Safari o Chrome y usa *Compartir → Añadir a pantalla de inicio*. La app instalada guarda sus datos aparte del navegador, así que hay que iniciar sesión dentro de ella.
- **Android**: abre la URL en Chrome y usa *Instalar app* en el menú.
- **Escritorio** (Chrome o Edge): usa el icono de instalación de la barra de direcciones.

## Actualizaciones y modo offline

- El service worker se versiona con un hash del contenido de cada build.
- La navegación va primero a la red y, sin conexión, usa la copia en caché.
- Los recursos con hash se sirven desde caché.
- Una versión nueva se activa sola y borra las cachés anteriores. La recarga se aplica cuando la app pasa a segundo plano, nunca mientras escribes.
- La app solicita almacenamiento persistente para que el sistema no borre los datos locales.

### Eliminar datos

**Ajustes → Eliminar datos** borra todo lo de este dispositivo. Con sesión iniciada, además borra los datos de la nube y la cuenta de Supabase. Pide confirmación y no se puede deshacer.

### Copias de seguridad

En **Ajustes → Copia de seguridad** puedes exportar todos los datos a JSON e importarlos de dos formas:

- **Combinar**: se queda con la versión más reciente de cada elemento.
- **Sustituir**: reemplaza todos los datos actuales.

## Arquitectura

| Ruta | Contenido |
|---|---|
| `src/types.ts` | Contratos entre módulos (tipos e interfaces `Repo` y `Sync`) |
| `src/lib/` | Fechas, normalización y recurrencias (funciones puras) |
| `src/parser/` | Sintaxis de una línea a `ParsedLine` (chrono-node y reglas propias) |
| `src/filters/` | Motor de filtros, orden y agrupación (funciones puras) |
| `src/data/` | Persistencia con Dexie/IndexedDB y marcas de sincronización |
| `src/sync/` | Autenticación y PostgREST mediante `fetch`; push/pull incremental |
| `src/pwa/` | Service worker y registro |
| `src/ui/` | Componentes Preact y estilos |
| `supabase/schema.sql` | Esquema, RLS y trigger de resolución de conflictos |
| `scripts/` | Generación de iconos y plugin de Vite para el service worker |

**Stack**: Vite, TypeScript, Preact, Dexie, chrono-node y Supabase (sin SDK).

## Hoja de ruta

- Fechas con hora y recordatorios.
- Subtareas.
- Orden manual arrastrando.
- Recurrencias con intervalo y día de la semana a la vez (por ejemplo, "cada 2 lunes").
