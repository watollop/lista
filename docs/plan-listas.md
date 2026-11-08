# Plan: varias listas y listas compartidas

## 1. Objetivo y principios

**Objetivo:** tener varias listas (Personal, Compra, Trabajo…) y poder **compartir** una lista con otras personas (por ejemplo, la compra en pareja), sin renunciar al cifrado de extremo a extremo.

**Principios**
- **Con una sola lista, Lista se ve igual que hoy.** «Una lista. Nada más.» sigue siendo verdad para quien no quiere más. Las listas aparecen cuando creas la segunda.
- **Una tarea está en una sola lista.** Es lo que la distingue de un `#tema`, que cruza listas.
- **Igual en escritorio y en móvil:** todo lo que se hace con ratón o teclado tiene su gesto o botón en el móvil, con el mismo vocabulario.
- **El servidor no puede leer una lista compartida**, igual que ahora no puede leer las tareas.
- **Sin contraseñas ni servicios de terceros**, como en el cifrado (docs/plan-cifrado.md).

## 2. Cómo lo vive el usuario

### Listas propias (fase 1)
- **La principal** se llama «Personal» por defecto, se puede renombrar y no se puede borrar. Las tareas que ya existen están en ella sin migrar nada.
- **Lista actual.** Cada dispositivo recuerda la última que abriste (`localStorage`, no se sincroniza): el portátil del trabajo abre Trabajo y el móvil, Personal.
- **Todas las listas.** Vista que mezcla todas. Cada tarea lleva una etiqueta pequeña con su lista; tocarla abre esa lista.
- **Todo se calcula en la lista actual:** bloques (Hoy, Mañana…), contadores, mini calendario, temas y personas con pendientes, búsqueda y filtros. Los temas, las personas y los filtros guardados son comunes a todas las listas.
- **Escritorio:** sección **Listas** arriba de la barra lateral (encima del mini calendario), con pendientes por lista, **Todas las listas** y **+ Nueva lista**. Lápiz y papelera al pasar el ratón, como los temas. Con una sola lista, la sección no aparece: solo un discreto **+ Nueva lista** al final de la barra. Una tarea se mueve **arrastrándola** (asa ⠿ del editor) a una lista de la barra. Tecla **l**: abre el selector de listas.
- **Móvil:** el nombre de la cabecera («Lista») pasa a ser el nombre de la lista actual, con ▾ cuando hay más de una. Al tocarlo se abre la hoja de listas: listas con pendientes, **Todas las listas** y **+ Nueva lista**; el lápiz de cada lista la renombra o la borra. En la cabecera, la vista conjunta se llama «Todas».
- **Editor de tarea:** junto a **+ Subtarea**, **Calendario** y **Borrar**, el botón **Mover a…** (solo con más de una lista) abre la hoja de listas para elegir destino. Es el equivalente táctil de arrastrar a la barra.
- **Ajustes → Listas:** crear, renombrar y borrar, en los dos tamaños de pantalla.
- **Borrar una lista** borra también sus tareas, tras confirmar («Compra tiene 12 tareas. Se borrarán con ella.»), y ofrece **Deshacer**.

### Escribir en otra lista
- `Leche /compra` apunta la tarea en Compra aunque estés en otra lista. Se autocompleta al escribir `/`, como `#` y `@`.
- **Solo se reconocen listas que existen** (si no, `/xyz` se queda como texto): una errata no crea una lista.
- Solo cuenta al principio de una palabra, así que `15/11`, `y/o` y las URL no cambian.
- La clave ignora mayúsculas, tildes, espacios y guiones (`listKey` en `src/lib/text.ts`): «La compra» se escribe `/la-compra` o `/lacompra`. El autocompletado inserta `/La-compra`.
- Lo que escribes en **Todas las listas**, lo que llega por **Compartir con Lista** y `?nueva=` va a la principal, salvo que lleve `/lista`.
- Si la tarea va a otra lista, el aviso lo dice: «Añadida a Compra», con **Ver** para ir a esa lista.
- Al editar una tarea, escribir `/trabajo` la mueve (con sus subtareas). No escribir ninguna lista no la cambia.

### Novedades y bienvenida
- **Novedades:** quien ya usaba Lista ve una vez, al principio de la lista (sin tapar la cabecera), una tarjeta «Nuevo: listas» con una frase y **Ver** (abre la hoja de Novedades) o **Cerrar**. Las entradas viven en `src/ui/news.ts` (`{ id, title, text }`, textos con `tr`) y la tarjeta y la hoja en `src/ui/WhatsNew.tsx`; se recuerda cuáles se vieron en `localStorage` (`lista.news`). Quien llega nuevo ve la bienvenida, no las novedades: al cerrarla se marcan todas como vistas. **Ajustes → Novedades** las muestra siempre.
- **Bienvenida:** una slide sobre las listas, con su demo, y la mención a `/lista` en la referencia de lo que se puede escribir.

### Listas compartidas (fase 2)
- **Compartir lista** (en la hoja o la barra, y en Ajustes → Listas) crea un **enlace de invitación** de un solo uso, válido 7 días, y abre el menú de compartir del sistema (WhatsApp, Mensajes…) o lo copia. Hace falta haber entrado con Google.
- Quien recibe el enlace lo abre, entra con Google si no lo había hecho y ve «Te han invitado a «Compra»» con **Unirme**. La lista aparece en sus dispositivos.
- Las listas compartidas llevan un pequeño icono de personas. En sus ajustes se ve con quién se comparte.
- Cualquier miembro puede editar tareas, renombrar la lista e invitar. Quien la creó puede **quitar** a alguien y **borrar la lista para todos**. Los demás pueden **salir**: la lista desaparece de sus dispositivos y sigue para el resto.
- **Mover** una tarea entre una lista compartida y otra cambia quién la ve: el editor lo avisa.

## 3. Modelo de datos (fase 1)

| Pieza | Cambio |
|---|---|
| `TodoList` (`src/types.ts`) | `{ id, name, order }` + `SyncRec`. La principal es `MAIN_LIST = 'main'` y **solo tiene registro si se renombra**: así un dispositivo nuevo no crea un «Personal» que pise el nombre sincronizado. |
| `Task.listId` | `null` o ausente = la principal. Las subtareas siempre en la lista de su principal (`addParsed`, `moveToList` y `reconcileFamilies` lo garantizan). |
| Dexie v5 | Tabla `lists: 'id, dirty, deleted'`. Sin migración de tareas. |
| Sync | `SyncKind` incorpora `'list'`. Viaja cifrado como `'enc'` (el servidor no cambia). `KINDS` de `src/sync/crypto.ts` y `PLAIN_KINDS` de `src/sync/index.ts` lo incluyen. |
| Copia de seguridad | `version: 2` con `lists`. |
| Parser | `ParsedLine.list` (listKey o null), token `'list'`, `ActiveToken.type 'list'`. El parser solo reconoce las listas que la app le da con `setKnownLists(keys)`, igual que el idioma es global. |

**Dispositivos con una versión anterior:** descifran la fila, no conocen el tipo `'list'` y la omiten sin error (`CorruptItemError` → `skipped` en `src/sync/index.ts`). Al editar una tarea conservan su `listId`, porque copian la tarea entera (`{ ...task, ...patch }`). Hasta actualizarse ven todas las tareas mezcladas.

## 4. Compartir: diseño (fase 2)

### 4.1 Decisiones

| Decisión | Elección | Motivo |
|---|---|---|
| Clave | Cada lista compartida tiene su **clave de lista (LK)** AES-256-GCM | La DK es personal y no se puede dar a otros. |
| Invitar | **Enlace con un secreto en el fragmento** (`#unirse=<id>.<secreto>`) | El fragmento no llega nunca al servidor. Se comparte por WhatsApp como cualquier enlace. Funciona aunque el invitado aún no tenga cuenta. Sin contraseñas. |
| Alternativa descartada | Invitar por email con claves públicas | Exige directorio de usuarios (enumerar emails), que el invitado ya tenga cuenta y verificar huellas para evitar que el servidor sustituya la clave pública. Más complejo y peor UX. |
| Dónde guarda cada miembro la LK | En su espacio personal, como registro `list` cifrado con su DK | Llega sola a todos sus dispositivos ya enlazados: no hay que enlazar cada dispositivo a cada lista. |
| Dónde viven los datos de la lista | Tabla nueva `list_items`, una fila por registro **y lista** (no por usuario) | Una sola copia que ven todos los miembros, con el mismo LWW. |
| Mover entre espacios | **Copiar con id nuevo y borrar el original** | El tombstone del espacio de origen y la tarea viva del de destino nunca chocan en el mismo id local. Lo mismo al compartir una lista que ya tenía tareas. |
| Quitar a alguien | Se le quita el acceso (RLS). **Sin rotar la LK** en esta fase | Rotar exige poder dar la clave nueva a los demás sin la vieja (claves de identidad, ver §4.7). |

### 4.2 Modelo criptográfico
- **LK:** AES-256-GCM aleatoria, una por lista compartida.
- **Filas de la lista** en `list_items`: `id = HMAC-SHA256(LK, kind + ':' + id)`, `data = { v:1, iv, ct }` con `ct = AES-GCM(LK, { kind, id, data })`.
- **AAD:** `'list:' + listId + ':' + idRemoto + ':' + updated_at + ':' + (deleted ? 1 : 0)`. Además de lo que ya protege el AAD de `'enc'`, ata la fila a su lista: el servidor no puede moverla a otra.
- **Ficha de la lista** dentro de la propia lista: registro `meta` (id `list`) con `{ name }`. Así un cambio de nombre lo ven todos.
- **Secreto de la invitación `S`:** 32 bytes aleatorios en base64url en el fragmento del enlace.
  - `authKey = HKDF(S, 'lista-invite-auth')`: el servidor guarda solo `SHA-256(authKey)` y la exige para aceptar.
  - `wrapKey = HKDF(S, 'lista-invite-wrap')`: cifra `{ lk, name }` con AAD `inviteId + ':' + listId`. El servidor nunca la ve: de `authKey` no se puede sacar `wrapKey`.
- **Registro personal de cada miembro** (`kind 'list'`, cifrado con su DK): `{ id, order, shared: { lk } }`. El nombre de una lista compartida sale de su `meta`.
- **Temas y personas** que usan las tareas de una lista compartida viajan también en ella (`topic`/`person` en `list_items`). Al llegar se crean en local si no existían, con ese nombre; si ya existían, se conserva el nombre local.

### 4.3 Servidor (`supabase/migrations/…_listas.sql` y `schema.sql`)
- `lists (id uuid pk, created_by uuid default auth.uid(), created_at)`.
- `list_members (list_id → lists on delete cascade, user_id → auth.users on delete cascade, role 'owner'|'member', joined_at, pk (list_id, user_id))`.
- `list_items (list_id → lists on delete cascade, kind, id, data jsonb, updated_at bigint, deleted bool, synced_at, pk (list_id, kind, id))`, con el mismo trigger LWW, el mismo límite de 64 KiB y `check (kind = 'enc')`.
- `list_invites (id uuid pk, list_id, created_by, token_hash, wrapped, expires_at default now() + 7 días, used_by, used_at)`.
- `is_member(list_id)`: función `security definer` para las políticas (evita la recursión de RLS sobre `list_members`).
- **RLS**: `list_items` para todo si `is_member`; `list_members` select si `is_member`, delete si es uno mismo (salir) o si se es `owner`; `lists` delete solo `created_by`; `list_invites` insert/select/delete por miembros.
- **RPC `accept_invite(invite_id, auth)`** (`security definer`): comprueba hash, caducidad y que no esté usada; inserta al llamante como `member`, marca la invitación como usada y devuelve `{ list_id, wrapped }`. Errores claros: caducada, usada, ya eres miembro.
- **RPC `list_members_info(list_id)`**: emails y nombres de Google de los miembros, solo para miembros.
- `delete_account` borra también las listas que creó el usuario (para todos) y sus membresías.

### 4.4 Sincronización
- Cada sync pide **mis membresías** (`list_members` del usuario). Con eso y los registros `list` personales sabe qué listas compartidas tiene y con qué LK.
- Por cada lista compartida: sube sus pendientes cifrados con su LK y baja desde **su propio cursor** (`sync.cursor.list:<id>` en `meta`, con el mismo solapamiento). Un cursor global no sirve: al unirse a una lista, sus filas antiguas tienen `synced_at` anteriores.
- `pendingChanges()` sigue devolviendo todo; el sync reparte cada registro a su espacio según el `listId` de la tarea (o, para temas y personas, a todos los espacios cuyas tareas los usan).
- **Membresía perdida** (me quitaron o se borró la lista): se borran **solo en local** la lista y sus tareas, físicamente y sin marcarlas `dirty` (un tombstone las borraría para todos), y se avisa: «Ya no formas parte de «Compra»».
- **Salir:** igual, después de borrar mi fila de `list_members`.

### 4.5 Flujos
**Compartir una lista** (con sesión y el dispositivo desbloqueado)
1. Generar LK; crear `lists` y mi fila `owner` en `list_members`.
2. Mover sus tareas al espacio compartido (id nuevo, §4.1) y escribir `meta`.
3. Guardar `{ shared: { lk } }` en mi registro personal de la lista.
4. Crear la invitación y abrir el menú de compartir con el enlace.

**Invitar a otra persona:** paso 4, desde una lista ya compartida. Cada enlace sirve para una persona.

**Unirse**
1. El enlace abre Lista con `#unirse=…`. El fragmento se guarda en `sessionStorage` antes de nada, porque el regreso de Google también usa el fragmento.
2. Sin sesión: «Te han invitado a una lista» y **Entrar con Google**. Con el dispositivo bloqueado: primero enlazarlo (cifrado).
3. `accept_invite` → desenvolver con `wrapKey` → guardar la LK en el registro personal → sync.
4. **iPhone:** la app instalada no comparte datos con Safari. Si el enlace se abre en Safari y ahí no hay sesión, la página ofrece **Copiar enlace** para pegarlo en la app: hoja de listas → **Unirse con un enlace**.

### 4.6 Casos límite
- Enlace usado por otra persona antes que el invitado: el invitado ve «Este enlace ya se usó» y el creador ve un miembro que no esperaba y puede quitarlo.
- Dos miembros editan la misma tarea a la vez: LWW, como entre dispositivos.
- Quien creó la lista no puede salir sin borrarla (en esta fase no hay traspaso).
- Borrar la cuenta borra las listas que creaste para todos: Ajustes lo avisa.
- Una invitación caducada o usada no revela nada: `wrapped` solo lo devuelve `accept_invite`.

### 4.7 Límites
- **El enlace es la llave:** quien lo tenga antes de que se use puede unirse. Por eso caduca, es de un solo uso y los miembros son visibles.
- **Sin rotación de clave al quitar a alguien:** el expulsado ya no puede leer el servidor (RLS), pero conserva la LK. Solo colaborando con un administrador del servidor podría leer cambios posteriores. Se resolverá con claves de identidad por usuario (fase futura).
- **Metadatos visibles para el servidor:** quién comparte con quién, cuántas filas tiene cada lista y cuándo hay actividad.
- **No es instantáneo:** los cambios del otro llegan en el siguiente sync (al volver a la app, al recuperar conexión o cada 30 s con actividad). Supabase Realtime podría avisar antes (fase futura).

## 5. Fases (una rama y PR por fase)

| Fase | Contenido | Criterio |
|---|---|---|
| 1 ✅ | Listas propias: datos, sync del nuevo tipo, parser `/lista`, interfaz en escritorio y móvil, Novedades, bienvenida, Ajustes, atajos y README | Con una lista, todo igual. Tests verdes. |
| 2A | Cripto de listas e invitaciones (`src/sync/listcrypto.ts`) + tests de ataque | Sin tocar nada más. |
| 2B | Servidor (migración SQL) y capa de API | Suite intacta. Hay que ejecutar la migración en Supabase. |
| 2C | Sync multiespacio (cursores por lista, reparto, membresía perdida) | Dos usuarios simulados comparten una lista. |
| 2D | Interfaz de compartir, unirse, miembros, salir y quitar; Novedades y bienvenida | Flujos de §4.5 en escritorio y móvil. |
| 2E | Validación real con dos cuentas de Google, en iPhone, Android y ordenador | Sin pérdida de datos. |

## 6. Tests
- Repo: crear, renombrar (también la principal), duplicados por listKey, borrar con tareas y deshacer, mover familias, subtareas heredan lista, copia v2, sync de `list`, purga.
- Parser: `/lista` solo si existe, al inicio de palabra; `15/11`, `y/o`, URL; listKey con espacios y tildes; autocompletado.
- Cliente antiguo que baja un `list`: lo omite y no rompe nada.
- Cripto (2A): round-trip con LK; AAD que impide mover filas entre listas; invitación con secreto erróneo, `authKey` sin `wrapKey`, invitación manipulada.
- Sync (2C): el servidor simulado no ve ningún título en claro de la lista compartida; membresía perdida borra solo en local sin subir tombstones; mover entre espacios no deja tareas duplicadas ni perdidas.
