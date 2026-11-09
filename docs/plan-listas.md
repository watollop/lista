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
- **Todas.** Primera pestaña: mezcla todas las listas (solo aparece con dos o más). Cada tarea lleva una etiqueta pequeña con su lista; tocarla abre esa lista.
- **Todo se calcula en la lista actual:** bloques (Hoy, Mañana…), contadores, mini calendario, temas y personas con pendientes, búsqueda y filtros. Los temas, las personas y los filtros guardados son comunes a todas las listas.
- **Escritorio:** las listas son pestañas en la cabecera, junto al logo «LISTA»: **Todas · Personal · Compra · +**. Siempre se ven, aunque solo haya una lista. Tocar una pestaña cambia de lista; tocar la activa (con ▾) abre su menú: **Renombrar**, **Compartir** y **Borrar lista**. Doble clic en una pestaña la renombra. Una tarea se mueve **arrastrándola** a su pestaña, desde el asa ⠿ que aparece a la izquierda de la casilla al pasar el ratón. **+** crea una lista con un campo de nombre (Enter). Tecla **l**: siguiente lista.
- **Móvil:** las mismas pestañas van bajo la cabecera, encima de los filtros (Fecha, Tema, Persona, Prioridad), con el mismo comportamiento: tocar cambia de lista y tocar la activa abre su menú. **+** crea una lista. La cabecera muestra siempre el logo «LISTA».
- **Editor de tarea:** junto a **+ Subtarea**, **Calendario** y **Borrar**, el botón **Mover a…** (solo con más de una lista) abre la hoja de listas para elegir destino. Es el equivalente táctil de arrastrar a la barra.
- **Borrar una lista** borra también sus tareas, tras confirmar («Compra tiene 12 tareas. Se borrarán con ella.»), y ofrece **Deshacer**.

### Escribir en otra lista
- `Leche /compra` apunta la tarea en Compra aunque estés en otra lista. Se autocompleta al escribir `/`, como `#` y `@`.
- **Solo se reconocen listas que existen** (si no, `/xyz` se queda como texto): una errata no crea una lista.
- Solo cuenta al principio de una palabra, así que `15/11`, `y/o` y las URL no cambian.
- La clave ignora mayúsculas, tildes, espacios y guiones (`listKey` en `src/lib/text.ts`): «La compra» se escribe `/la-compra` o `/lacompra`. El autocompletado inserta `/La-compra`.
- Lo que escribes en **Todas**, lo que llega por **Compartir con Lista** y `?nueva=` va a la principal, salvo que lleve `/lista`.
- Si la tarea va a otra lista, el aviso lo dice: «Añadida a Compra», con **Ver** para ir a esa lista.
- Al editar una tarea, escribir `/trabajo` la mueve (con sus subtareas). No escribir ninguna lista no la cambia.

### Novedades y bienvenida
- **Novedades:** quien ya usaba Lista ve una vez, al principio de la lista (sin tapar la cabecera), una tarjeta «Nuevo: listas» con una frase y **Ver** (abre la hoja de Novedades) o **Cerrar**. Las entradas viven en `src/ui/news.ts` (`{ id, title, text }`, textos con `tr`) y la tarjeta y la hoja en `src/ui/WhatsNew.tsx`; se recuerda cuáles se vieron en `localStorage` (`lista.news`). Quien llega nuevo ve la bienvenida, no las novedades: al cerrarla se marcan todas como vistas. **Ajustes → Novedades** las muestra siempre.
- **Bienvenida:** una slide sobre las listas, con su demo, y la mención a `/lista` en la referencia de lo que se puede escribir.

### Listas compartidas (fase 2)
- **Compartir** (en el menú de la pestaña de la lista) crea un **enlace de invitación** de un solo uso, válido 7 días, y abre el menú de compartir del sistema (WhatsApp, Mensajes…) o lo copia. Hace falta haber entrado con Google.
- Quien recibe el enlace lo abre, entra con Google si no lo había hecho y ve «Te han invitado a «Compra»» con **Unirme**. La lista aparece en sus dispositivos.
- Una lista compartida lleva un pequeño icono de personas en su pestaña, y su diálogo muestra con quién se comparte.
- Cualquier miembro puede editar tareas, renombrar la lista e invitar. Quien la creó puede **quitar** a alguien y **borrar la lista para todos**. Cualquiera puede **salir** (menú de la pestaña → **Salir de la lista**): la lista desaparece de sus dispositivos y sigue para el resto.
- Si quien la creó sale o borra su cuenta, la lista **pasa al miembro más antiguo**, que hereda quitar y borrar. Solo desaparece cuando no queda nadie.
- **Personal no se comparte:** se comparten las demás listas. Si solo tienes Personal, **Compartir** propone crear una lista nueva.
- Al compartir una lista se van con ella todas sus tareas, también las completadas.
- No se muestra quién añadió o completó cada tarea (se puede añadir más adelante).
- **Mover** una tarea entre una lista compartida y otra cambia quién la ve: el editor lo avisa.

### Interfaz de compartir (fase 2D)
- **Dónde está.** Igual en escritorio y en móvil: el menú de la pestaña activa (▾) → **Compartir**. Si ya está compartida, el mismo diálogo muestra a sus miembros. Personal no tiene esa opción.
- **Diálogo «Compartir «Compra»».**
  - **Si falta algo:** sin sesión, explica y ofrece **Entrar con Google**; con el dispositivo bloqueado, remite a enlazarlo.
  - **Si no está compartida:** explica qué pasa (todos ven y editan sus tareas, todo va cifrado) y ofrece **Compartir**.
  - **Al compartir o al invitar:** muestra el enlace con un solo botón, **Enviar** (menú de compartir del sistema) si el dispositivo lo tiene, o **Copiar** si no, y avisa de que sirve para una persona y caduca en 7 días.
  - **Si ya está compartida:** muestra los miembros (nombre o email, «tú», quién la administra) y **Invitar a alguien**. Quien administra puede **Quitar** a cada persona y **Borrar para todos**. **Salir de la lista** está en el menú de la pestaña (abre este diálogo en esa confirmación); si sale quien administra, dice a quién pasa.
- **Unirse.**
  - **Al abrir el enlace:** Lista guarda `#unirse=…` en `sessionStorage` y lo quita de la barra antes de nada, porque el regreso de Google también usa el fragmento. Luego muestra «Te han invitado a una lista compartida» con **Unirme**; sin sesión, **Entrar con Google** primero.
  - **Al terminar:** cambia a esa lista y avisa «Te has unido a «Compra»».
  - **En iPhone, en Safari y sin sesión:** ofrece **Copiar enlace** para pegarlo en la app.
  - **Pegar el enlace a mano:** basta con pegarlo en la caja donde se escriben las tareas. Lista lo reconoce, muestra el diálogo para unirse y no crea tarea. No hay botón «Unirse con un enlace».
- **Al mover una tarea:** en **Mover a…**, las listas compartidas llevan el icono y una línea avisa de que lo que muevas ahí lo verán sus miembros.
- **Avisos.** «Ya no formas parte de «Compra»» cuando el sync quita una lista. Al borrar la cuenta, Ajustes avisa de que tus listas compartidas pasan a la persona más antigua de cada una.
- **Sin sincronización configurada** (`status: 'disabled'`): no aparece nada de compartir.

### Pestañas (9 nov 2026)
- **Qué cambió.** Las listas son pestañas (**Todas · Personal · Compra · +**) en la cabecera, en vez de la sección de la barra lateral, la hoja de listas del móvil y «Ajustes → Listas». En Ajustes, el grupo pasa a llamarse **Temas y personas**.
- **Por qué.** Un solo sitio para gestionar las listas, sin entradas repetidas: cambiar, renombrar, compartir y borrar se hacen desde la pestaña donde se ven. «Todas» solo aparece con dos o más listas.
- **Unirse.** El enlace basta: se abre y listo. Se quitaron los botones «Unirse con un enlace». En iPhone, si el enlace se abre en Safari, «Copiar enlace» y pegarlo en la caja donde se escriben las tareas cubre el caso.
- **Invitar.** El panel tiene un solo botón: **Enviar** si el dispositivo tiene menú de compartir, o **Copiar** si no.
- **Barra lateral.** Sin «Todas»: repetía los pendientes de la pantalla de Hoy y chocaba con la pestaña «Todas». Con un filtro puesto aparece **Quitar filtros**.
- **Arrastrar (escritorio).** Al pasar el ratón por una tarea, el asa ⠿ aparece a la izquierda de la casilla: se arrastra a otro día o a otra pestaña sin abrir el editor.

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
| Enlaces | **Uno por persona:** un solo uso, 7 días | Si alguien se adelanta al invitado, entra una sola persona y se ve en Miembros. Decidido con el usuario (2026-11-08). |
| Permisos | Todos editan, renombran e invitan; **quitar y borrar para todos, solo el owner** | Evita que cualquiera vacíe una lista de grupo. Decidido con el usuario. |
| Si el owner se va | **Pasa al miembro más antiguo** (también al borrar la cuenta) | Tu pareja no pierde la lista de la compra porque tú borres la cuenta. Decidido con el usuario. |
| Autor de cada tarea | **No se muestra** en esta fase | Las tareas se ven igual que en las listas propias. Añadirlo después no exige migrar nada. |
| Personal | **No se comparte** | Las capturas externas y las tareas sin lista van a Personal: compartirla mezclaría lo privado. |

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

### 4.3 Servidor (`supabase/migrations/20261108_listas.sql` y `schema.sql`) ✅
- `lists (id uuid pk, created_by → auth.users on delete set null, created_at)`. El id es **el mismo que el de la lista local**.
- `list_members (list_id → lists on delete cascade, user_id → auth.users on delete cascade, role 'owner'|'member', joined_at, pk (list_id, user_id))`. Índice único parcial: un solo `owner` por lista.
- `list_items (list_id → lists on delete cascade, kind, id, data jsonb, updated_at bigint, deleted bool, synced_at, pk (list_id, kind, id))`, con su trigger LWW (`list_items_lww`, igual que `items_lww`), el mismo límite de 64 KiB y `check (kind = 'enc')`.
- `list_invites (id uuid pk generado por el cliente, list_id, created_by, token_hash hex 64, wrapped ≤ 4 KiB, created_at, expires_at default now() + 7 días, used_by, used_at)`.
- `is_member(list_id)` e `is_list_owner(list_id)`: `security definer` para las políticas (evita la recursión de RLS sobre `list_members`).
- **RLS** (solo `authenticated`):
  - `lists`: select si miembro; delete si owner. Sin insert ni update: se crean con `create_list`.
  - `list_members`: select si miembro; delete de la propia fila (salir) o de cualquiera si owner. Sin insert ni update: se entra con `create_list` o `accept_invite`.
  - `list_items`: select, insert y update si miembro. **Sin delete**: los borrados son tombstones.
  - `list_invites`: select y delete si miembro; insert si miembro, a su nombre, sin usar y con 7 días como mucho.
- **Trigger `list_members_after_delete`** (al salir, ser quitado o borrar la cuenta): anula las invitaciones sin usar de esa persona (no puede volver con un enlace suyo), pasa el owner al miembro más antiguo y, si no queda nadie, borra la lista con todo.
- **RPC `create_list(p_list)`**: crea la lista y al llamante como owner. Devuelve `{ created }`: `false` si ya existía y ya era miembro (reintento u otro de sus dispositivos), y entonces el cliente **no usa la LK que acaba de generar**. Error `list_exists` si es de otro; `too_many_lists` a partir de 200.
- **RPC `accept_invite(p_invite, p_auth)`**: `p_auth` = authKey en hex. Comprueba **primero el secreto** (sin él no se sabe si la invitación existe, está usada o caducada), después uso y caducidad; inserta al llamante como `member`, marca la invitación como usada y devuelve `{ list_id, wrapped }`. Idempotente para quien ya la usó y sigue dentro. Si ya era miembro no gasta la invitación. Errores: `invite_invalid`, `invite_used`, `invite_expired`, `list_full` (50 miembros).
- **RPC `list_members_info(p_list)`**: email y nombre de Google de los miembros, solo para miembros.
- `delete_account` sale primero de sus listas (el trigger traspasa o borra) y borra sus invitaciones.
- `purge_old_invites` (pg_cron, diaria): caducadas sin usar a partir de 1 día, usadas a los 30 días.
- **Cliente** en `src/sync/listapi.ts`: un 404 (falta la migración) lanza `SharingUnavailableError`; los rechazos de invitación, `InviteRejectedError` con su código.
- **Probado** en un Postgres en memoria (PGlite) que imita Supabase: 59 casos de permisos, traspaso y borrado, tanto con `schema.sql` (dos veces) como con la migración sobre el esquema anterior (dos veces).

### 4.4 Sincronización (fase 2C)

**Espacios.** Cada registro vive en un espacio: el **personal** (`items`, cifrado con la DK) o el de una **lista compartida** (`list_items`, cifrado con su LK).

| Registro | Espacio |
|---|---|
| Tarea (también su tombstone) | El de su `listId` si esa lista está compartida (`TodoList.shared`); si no, el personal |
| Tema / persona | El personal y, además, cada lista compartida con tareas vivas que lo usan (solo vivos) |
| Filtro, preferencia | El personal |
| Lista (`TodoList`) | El personal, con `shared: { lk, nameAt }`: así la LK llega a mis otros dispositivos |
| Nombre de una lista compartida | Registro `meta` (id `list`, `{ name }`) en la propia lista, con `updated_at = nameAt` |

**Nombre de una lista compartida.** `shared.nameAt` es la versión del nombre. Renombrar pone `nameAt = ahora` y sube `meta`. Al llegar un `meta` con `updated_at > nameAt`, se cambia el nombre y `nameAt` sin marcar `dirty`. Al llegar el registro personal de la lista, gana el `nameAt` mayor de los dos. El nombre nunca retrocede por un orden de llegada distinto.

**Mover entre espacios = copiar con id nuevo y tombstone del original.** Lo hace el repo, sin estado extra en el sync:
- **Cuándo:** al mover una familia (`moveToList`, `replaceParsed` con `/lista`) entre listas de **espacios distintos** (personal ↔ compartida, o entre dos compartidas). Entre dos listas personales, como hasta ahora.
- **Qué se crea:** copia viva de cada tarea de la familia, con id nuevo, en la lista de destino. Se remapean `parentId` y `nextId` dentro de la familia; un `nextId` que apunta fuera queda en `null`.
- **Qué queda:** cada original pasa a tombstone, conserva su `listId` de origen y sube a su espacio. Así nunca hay una tarea viva y un tombstone con el mismo id en dos espacios.
- **Deshacer:** es otro movimiento entre espacios.
- **Compartir una lista existente** (`markShared`) hace lo mismo con todas sus tareas vivas, también las completadas. Los originales quedan como tombstones con `listId = null`, para que suban al espacio personal y no al compartido. Los tombstones antiguos de esa lista también pasan a `listId = null`.

**Un ciclo de sync:**
1. **Subida personal:** todo lo pendiente salvo las tareas de listas compartidas.
2. **Bajada personal.**
3. **Membresías:** se piden **después** de la bajada personal. Así, si llega el registro de una lista a la que mi otro dispositivo se acaba de unir, la membresía ya existe.
4. **Por cada lista con `shared`:**
   - Si estoy en las membresías: sube sus tareas pendientes, los temas y personas que usan sus tareas vivas y el `meta` si el registro de la lista está pendiente. Luego baja desde **su cursor** (`sync.cursor.list:<id>`, con el mismo solapamiento de 5 s) y aplica.
   - Si no estoy: **membresía perdida**.
5. Un 404 de las tablas o RPC nuevas (falta la migración) se ignora: solo sincroniza lo personal.

**Membresías sin LK local** (me uní en otro dispositivo y aún no ha llegado su registro): se ignoran.

**Al aplicar lo que llega de una lista compartida** (`repo.applyShared`):
- **Tareas:** LWW. Se fuerza `listId` a esa lista. Un `parentId` que no es de esa lista pasa a `null`. Nunca pisa una tarea local de otro espacio con el mismo id.
- **Temas y personas:** se crean si no existen vivos en local; si existen, se queda el nombre local. Los tombstones se ignoran.
- **`meta`:** cambia el nombre según `nameAt`.

**Membresía perdida, salir o borrar para todos** (`repo.purgeShared`):
- **En local:** se borran físicamente sus tareas, sin marcarlas `dirty` (un tombstone las borraría para todos).
- **El registro de la lista** queda como tombstone pendiente, sin LK, para que mis otros dispositivos también la quiten.
- **En mis otros dispositivos:** al aplicar el tombstone remoto de una lista que tenían compartida, borran también sus tareas en local.
- **Aviso:** «Ya no formas parte de «Compra»».

**Compartir** (`sync.shareList`, operación exclusiva):
1. Generar la LK y guardar `sync.pendingShare = { listId, lk }`.
2. `create_list`.
3. `repo.markShared` y borrar `pendingShare`.
4. Sync.
5. Crear la invitación.

Si la app se cierra a medias, el siguiente sync retoma desde `pendingShare`. `create_list` con `created: false` y la lista ya compartida en local significa que otro dispositivo se adelantó: se usa su LK.

**Unirse** (`sync.joinList`):
1. Parsear el enlace y llamar a `accept_invite`.
2. Desenvolver `{ lk, name }` y crear la lista en local con `repo.joinShared`. Puede repetir nombre con una lista propia.
3. Sync.

`accept_invite` es idempotente, así que repetir con el mismo enlace sirve si la app se cerró a medias.

### 4.5 Flujos
**Compartir una lista** (con sesión y el dispositivo desbloqueado)
1. Generar LK y llamar a `create_list`. Si devuelve `created: false`, esperar al sync del registro personal y usar la LK que traiga.
2. Mover sus tareas al espacio compartido (id nuevo, §4.1) y escribir `meta`.
3. Guardar `{ shared: { lk } }` en mi registro personal de la lista.
4. Crear la invitación y abrir el menú de compartir con el enlace.

**Invitar a otra persona:** paso 4, desde una lista ya compartida. Cada enlace sirve para una persona.

**Unirse**
1. El enlace abre Lista con `#unirse=…`. El fragmento se guarda en `sessionStorage` antes de nada, porque el regreso de Google también usa el fragmento.
2. Sin sesión: «Te han invitado a una lista» y **Entrar con Google**. Con el dispositivo bloqueado: primero enlazarlo (cifrado).
3. `accept_invite` → desenvolver con `wrapKey` → guardar la LK en el registro personal → sync.
4. **iPhone:** la app instalada no comparte datos con Safari. Si el enlace se abre en Safari y ahí no hay sesión, la página ofrece **Copiar enlace** para pegarlo en la app: en la caja donde se escriben las tareas, Lista reconoce el enlace y muestra el diálogo para unirse (no crea tarea).

### 4.6 Casos límite
- Enlace usado por otra persona antes que el invitado: el invitado ve «Este enlace ya se usó» y el creador ve un miembro que no esperaba y puede quitarlo.
- Dos miembros editan la misma tarea a la vez: LWW, como entre dispositivos.
- Si el owner sale o borra su cuenta, pasa a serlo el miembro más antiguo; la lista solo se borra cuando no queda nadie. Ajustes lo explica al borrar la cuenta.
- Quien sale o es quitado no puede volver con un enlace que creó él: sus invitaciones sin usar se anulan.
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
| 2A ✅ | Cripto de listas e invitaciones (`src/sync/listcrypto.ts`) + tests de ataque | Sin tocar nada más. |
| 2B ✅ | Servidor (migración SQL) y capa de API (`src/sync/listapi.ts`) | Suite intacta. Hay que ejecutar la migración en Supabase. |
| 2C ✅ | Sync multiespacio (`src/sync/shared.ts`): cursores por lista, reparto, membresía perdida, compartir, unirse, salir, quitar y borrar | Dos usuarios simulados comparten una lista (`src/sync/shared.test.ts`, contra `src/sync/fakeSupabase.ts`). |
| 2D ✅ | Interfaz de compartir, unirse, miembros, salir y quitar (`Share.tsx`, `sharing.ts`); Novedades, bienvenida, Ajustes y README | Flujos de §4.5 en escritorio y móvil. |
| 2E | Validación real con dos cuentas de Google, en iPhone, Android y ordenador. Ensayada en local contra Supabase real (§6) | Sin pérdida de datos. |

## 6. Tests
- Repo: crear, renombrar (también la principal), duplicados por listKey, borrar con tareas y deshacer, mover familias, subtareas heredan lista, copia v2, sync de `list`, purga.
- Parser: `/lista` solo si existe, al inicio de palabra; `15/11`, `y/o`, URL; listKey con espacios y tildes; autocompletado.
- Cliente antiguo que baja un `list`: lo omite y no rompe nada.
- Cripto (2A): round-trip con LK; AAD que impide mover filas entre listas; invitación con secreto erróneo, `authKey` sin `wrapKey`, invitación manipulada.
- Sync (2C), de punta a punta con tres usuarios (y dos dispositivos de una misma cuenta) contra `fakeSupabase.ts`, que imita la migración:
  - **Privacidad:** el servidor no ve ningún título, nombre de lista ni tema en claro.
  - **Unirse:** un enlace sirve una sola vez; el otro dispositivo del que comparte (que ya tenía las tareas) acaba con una sola copia; el segundo dispositivo de quien se une recibe la lista; se puede repetir nombre con una lista propia.
  - **Cambios entre miembros:** añadir, completar, borrar y renombrar llegan a todos sin retroceder; mover entre espacios no duplica ni pierde tareas.
  - **Salir, quitar y borrar:** quitar o salir borra solo en local y avisa (`takeLostLists`); borrar para todos desaparece en todos los dispositivos; si el owner sale, la lista pasa al siguiente.
  - **Casos raros:** un «compartir» cortado se termina en el siguiente sync; sin la migración, lo personal sincroniza igual.
- Contra Supabase real (`src/sync/shared.supabase.test.ts`, `npm run test:supabase`): los mismos flujos con Postgres, Auth y PostgREST en Docker y `schema.sql`, para que `fakeSupabase.ts` no se separe de la migración. Incluye borrar la cuenta siendo owner (la lista pasa al siguiente miembro).
- Ensayo de la 2E (9 nov): con ese servidor local y dos navegadores (escritorio y móvil), Ana comparte, Bea abre el enlace y se une, editan las dos, Ana ve a los miembros y quita a Bea, y a Bea se le avisa. Sin errores. Falta la prueba con Google en dispositivos reales.
