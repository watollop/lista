# Plan: cifrado de extremo a extremo de los datos en Supabase

## 1. Objetivo y alcance

**Objetivo:** que el administrador del servidor (Supabase, backups, panel) no pueda leer el contenido de los usuarios: títulos de tareas, nombres de temas y personas, filtros y preferencias.

**Principios**
- **Sin contraseñas.** El usuario no crea, guarda ni escribe ninguna contraseña.
- **Sin servicios de terceros** para guardar la clave (descartados Google Drive y Google Cloud KMS).
- **Irreversible.** El cifrado se activa por persona con un toggle y, una vez activado, no se puede desactivar.
- **Compromiso al estilo WhatsApp:** seguridad fuerte por defecto (enlace entre dispositivos) y recuperación opcional para quien la quiera.

**Fuera de alcance**
- Metadatos: el email, el número de registros y las horas de actividad siguen siendo visibles. El tipo de cada registro deja de serlo (ver §4).
- IndexedDB local sigue en claro. Es el modelo normal de una PWA.
- El backup JSON exportable sigue en claro, porque es del usuario.
- Apps nativas (iOS/Android) y passkeys: previstas en el diseño (§13), no en este plan.

**Requisitos**
- Con el toggle sin activar, el comportamiento es idéntico al actual.
- Los dispositivos con una versión antigua de la app no deben romperse ni corromper datos.
- El login sigue siendo Google SSO vía Supabase.

## 2. Cómo lo vive el usuario

**Activar (una vez)**
1. Ana usa la app como siempre: entra con Google y sus tareas se sincronizan.
2. En Ajustes → Cifrado activa el toggle. Aparece un aviso: "Tus datos se cifrarán y nadie más podrá leerlos, ni el administrador. **Una vez activado no se puede desactivar.**" Confirma.
3. Ve "Cifrando…" y después "Cifrado activo". Se le ofrece, sin obligar, "Guardar clave de recuperación".

**Otro dispositivo (como WhatsApp Web)**
1. Abre la app en el portátil y entra con Google. Ve: "Tus datos están cifrados. Abre Lista en un dispositivo ya activado para enlazar este". Debajo, un código: `482 913`.
2. En el móvil, ya activado, aparece: "¿Enlazar un dispositivo nuevo? Código `482 913`".
3. Ana comprueba que los dos códigos coinciden y pulsa "Enlazar". El portátil se desbloquea. Solo ocurre una vez por dispositivo.

**Si ha perdido todos sus dispositivos**
- Con la clave de recuperación: "Usar clave de recuperación" y se desbloquea.
- Sin ella: "Restablecer cifrado". Se pierden los datos del servidor (en la práctica, los que no estaban en ningún dispositivo) y empieza de nuevo, cifrado.

## 3. Decisiones de diseño

| Decisión | Elección | Motivo |
|---|---|---|
| Origen de la clave | DK aleatoria generada en el primer dispositivo | Sin contraseñas ni terceros. El servidor nunca la tiene. |
| Llevar la clave a otro dispositivo | Enlace con un dispositivo ya activado, comparando un código de 6 dígitos | Funciona en cualquier navegador, sin cámara y sin contraseña. El servidor solo hace de mensajero. |
| Recuperación | Clave de recuperación **opcional** (como la de 64 dígitos de WhatsApp) | Cubre la pérdida de todos los dispositivos sin imponer nada a quien no la quiera. |
| Reversibilidad | Ninguna: no hay flujo de desactivar | Requisito. Simplifica el sync. |
| Cifrado | AES-256-GCM, ECDH P-256 y HKDF con Web Crypto, sin dependencias | Nativo y sin añadir paquetes. |
| Filas cifradas | `kind` nuevo `'enc'`, con el tipo real dentro del contenido cifrado | Los clientes antiguos ignoran los `kind` desconocidos (`applyByKind` en `src/data/repo.ts`), así que nunca ven contenido cifrado. Además oculta el tipo. |
| Marcador en el servidor | Fila `kind='key'` **sin la DK**, con su identificador y, si existe, la DK envuelta con la clave de recuperación | Indica a los dispositivos que el cifrado está activo y con qué clave. |
| Tabla de enlace | Tabla nueva `pairings`, efímera | Canal de mensajes entre dispositivos durante el enlace. |

## 4. Modelo criptográfico

- **DK** (clave de datos): AES-256-GCM aleatoria de 256 bits, una por usuario, generada al activar.
- **`keyId`**: `HMAC-SHA256(DK, 'lista-key-id')` en hex, truncado. Permite comprobar qué clave cifra los datos sin revelarla.
- **Fila marcador** en `items` con `kind='key'`, `id='dk'`:
  `data = { v:1, keyId, recovery: null | { iv, wrapped } }`.
- **Fila cifrada** en `items` con `kind='enc'`:
  - `id = HMAC-SHA256(DK, kindReal + ':' + idReal)` en hex. Es determinista, así que el mismo registro siempre cae en la misma fila y el LWW sigue funcionando.
  - `data = { v:1, iv, ct }`, con `ct` = `{ kind, id, data }` reales (sin `dirty`) cifrado con la DK. El IV es aleatorio de 12 B y nuevo en cada cifrado.
- **AAD** de AES-GCM: `'enc:' + idRemoto + ':' + updated_at + ':' + (deleted ? 1 : 0)`. El servidor no puede intercambiar contenido entre filas, alterar el orden LWW ni borrar o resucitar registros sin que el descifrado falle.
- **Al descifrar** se reconstruye el `RemoteItem` con el `kind` y el `id` reales sacados del contenido, antes de `applyRemote`. Nunca llega al repo un ID hasheado.
- **En claro** (el servidor lo necesita para LWW y para el cursor): `user_id`, `kind` (`'enc'` o `'key'`), `id` (opaco), `updated_at`, `deleted`, `synced_at`.
- **Clave de recuperación**: 32 bytes aleatorios, mostrados en base32 en grupos de 4 (unos 52 caracteres, del estilo `K7RM-2QXP-…`). Por su entropía no necesita KDF lento: `HKDF(claveRecuperación)` da la clave que envuelve la DK en `recovery`.
- **Almacenamiento local**: la DK se guarda en `meta` con la clave `dk:<userId>`, en base64. Ligarla al `userId` evita que otra cuenta que entre en el mismo dispositivo use la DK del usuario anterior.

### Protocolo de enlace
Objetivo: pasar la DK de un dispositivo activado (A) a uno nuevo (B) a través del servidor, sin que el servidor pueda leerla ni suplantar a ninguno de los dos.

1. **B** genera un par ECDH efímero y un nonce `nB`. Crea una fila en `pairings` con su clave pública `pkB` y un **compromiso** `cB = SHA-256(pkB ‖ nB)`, sin revelar `nB`.
2. **A** (en su sync) ve la petición, genera su par ECDH efímero y un nonce `nA`, y escribe `pkA` y `nA`.
3. **B** revela `nB`. **A** comprueba que `SHA-256(pkB ‖ nB) = cB`.
4. Los dos calculan el código `SAS = SHA-256(pkA ‖ pkB ‖ nA ‖ nB) mod 10⁶` y lo muestran. El usuario confirma en **A** que coincide con el de **B**.
5. **A** deriva `K = HKDF(ECDH(skA, pkB))`, cifra la DK con `K` (AES-GCM, AAD = id del enlace) y la escribe en la fila.
6. **B** deriva la misma `K`, descifra la DK, comprueba el `keyId` contra la fila marcador, la guarda y borra la fila de `pairings`.

El compromiso del paso 1 impide que un servidor malicioso pruebe claves hasta conseguir el mismo código: tiene que fijar sus valores antes de conocer los del otro dispositivo, así que acertar los 6 dígitos tiene una probabilidad de 1 entre un millón por intento, y cada intento exige que el usuario confirme un enlace. Es el mismo esquema que la comparación numérica de Bluetooth. El código de enlace se revisará con especial cuidado y tendrá tests específicos (§10).

## 5. Servidor (`supabase/schema.sql`)

- Ampliar `items_kind_check` con `'enc'` y `'key'`. El script es idempotente, así que basta volver a ejecutarlo.
- Tabla nueva `pairings`:
  - `id uuid`, `user_id` (por defecto `auth.uid()`), `pk_b`, `commit_b`, `n_b`, `pk_a`, `n_a`, `wrapped_dk`, `created_at`, `expires_at` (10 minutos).
  - RLS "own rows", como `items`.
  - Las filas caducadas se ignoran en el cliente y se borran al crear una nueva.
- `delete_account` borra también las filas de `pairings` del usuario.
- El trigger LWW acepta `updated_at` **igual** (solo descarta si es menor). Eso permite resubir los datos sin tocar `updatedAt`.
- Excepción al principio de "nunca se borra la fila": al migrar se borran físicamente las filas en claro, porque su contenido ya vive en la fila `enc` equivalente. La política RLS `for all` ya permite ese `DELETE`.

## 6. Cambios por archivo

### `src/sync/crypto.ts` (nuevo)
- `generateDk`, `keyIdOf(dk)`.
- `encryptItem(dk, item)`: devuelve la fila `enc`. `decryptItem(dk, row)`: devuelve el `RemoteItem` real, con `kind` e `id` restaurados.
- `remoteId(dk, kind, id)`.
- Clave de recuperación: `generateRecoveryKey`, `formatRecoveryKey` / `parseRecoveryKey` (tolerante a mayúsculas, espacios y guiones), `wrapWithRecovery` / `unwrapWithRecovery`.
- Error tipado `CorruptItemError`.

### `src/sync/pairing.ts` (nuevo)
- Las dos mitades del protocolo de §4: `startPairing()` (dispositivo B) y `answerPairing()` / `confirmPairing()` (dispositivo A), más el cálculo del código.
- Sin estado propio: lee y escribe la fila de `pairings` a través de `api.ts`.

### `src/sync/api.ts`
- `fetchKeyRow`, `putKeyRow` (insert que **ignora conflicto**) y `updateKeyRow` (para añadir la recuperación).
- `deleteItems(kind, ids)` para borrar las filas en claro tras migrar.
- CRUD de `pairings`.

### `src/types.ts`
- `SyncKind` (el del servidor) incorpora `'enc'` y `'key'`. Los tipos locales no cambian.
- Tipos para la fila cifrada, la fila marcador y la fila de enlace.
- `SyncState` incorpora el estado de cifrado: `off`, `on`, `locked`, `migrating`.

### `src/sync/index.ts`
- `doSync` consulta primero la fila `key`, en su propia petición. Si el servidor responde 400 (SQL sin actualizar), se trata como "sin fila `key`" y el sync normal sigue, igual que hoy con `setting`. Según el resultado decide el modo de la ejecución:
  - sin fila `key`: flujo actual;
  - con fila `key` y DK local con el mismo `keyId`: cifra al subir y descifra al bajar;
  - con fila `key` y sin DK local (o con otro `keyId`): estado `locked` y **no sube nada** (así un dispositivo bloqueado nunca sube en claro).
- Con cifrado activo, si se baja una fila en claro (de un dispositivo antiguo), se aplica normalmente, se marca `dirty` para que suba cifrada y se borra la fila en claro.
- Con cifrado activo, cada sync comprueba si hay peticiones de enlace pendientes y lo notifica a la UI.
- Cifrar tras `repo.pendingChanges()`, descifrar tras `pullItems`.
- Un registro que no se pueda descifrar se omite y se avisa. Nunca sobrescribe el local.
- Métodos nuevos en `Sync`: `enableEncryption()`, `createRecoveryKey()`, `requestPairing()`, `confirmPairing(id)`, `unlockWithRecovery(key)` y `resetEncryption()`.
- La activación se ejecuta dentro del mismo mutex que `syncNow`, para que no corran a la vez.

### `src/data/repo.ts`
- `markAllDirty()`: marca como `dirty` todos los registros, **incluidos los tombstones** (`deleted=1`, que conservan el título), sin cambiar `updatedAt`.

### `src/ui/Settings.tsx`
- Sección "Cifrado" bajo la cuenta, solo con sesión iniciada.
- Toggle con el aviso de irreversibilidad y una confirmación explícita. Una vez activado, el toggle queda fijo con el texto "Cifrado activo".
- "Guardar clave de recuperación": muestra la clave, con botones "Copiar" y "Descargar".
- Estado bloqueado: código de enlace, "Usar clave de recuperación" y, como último recurso, "Restablecer cifrado".
- Aviso en dispositivos activados: "¿Enlazar un dispositivo nuevo? Código …" con "Enlazar" y "Rechazar".

## 7. Flujos

**Activar**
1. Aviso de irreversibilidad y confirmación.
2. Generar la DK.
3. `putKeyRow` con el `keyId`. Si ya existe (otro dispositivo se adelantó), abortar y pasar a `locked` para enlazar con ese dispositivo.
4. Guardar `encryption: 'migrating'` y `dk:<userId>` en local.
5. **Pull completo** antes de generar la clave, `markAllDirty()` con tombstones incluidos, resubir todo como `enc` y borrar todas las filas en claro. (Se descartó cifrar solo lo nuevo: con el cifrado irreversible, dejar filas en claro era peor y el código es casi el mismo.)
6. **Verificación**: pull completo y comprobar que no queda ninguna fila que no sea `enc` o `key`. Si queda alguna, se repite en el siguiente sync.
7. `encryption: 'on'`. Si se interrumpe, la operación se reanuda desde `migrating`.
8. Ofrecer, sin obligar, "Guardar clave de recuperación".

**Enlazar un dispositivo**
- Según el protocolo de §4. Requiere que los dos dispositivos estén abiertos y con conexión a la vez.
- Si el dispositivo activado no responde en 10 minutos, la petición caduca y se puede repetir.
- "Rechazar" en el dispositivo activado borra la petición.

**Clave de recuperación**
- Crear: generar la clave, envolver la DK con ella y `updateKeyRow`. Se muestra **una sola vez**. Crear una nueva sustituye a la anterior.
- Usar: en un dispositivo bloqueado, introducirla para desenvolver la DK de `recovery`.

**Restablecer cifrado** (perdidos todos los dispositivos y sin clave de recuperación)
1. Aviso: se perderán los datos del servidor que no estén en este dispositivo.
2. Nueva DK, borrar todas las filas `enc` y la fila `key`, y crear la nueva fila `key`.
3. `markAllDirty()` y resubir los datos locales cifrados con la nueva DK.
4. El cifrado sigue activo. Los demás dispositivos pasan a `locked` y se enlazan de nuevo.

## 8. Casos límite

- Dos dispositivos activando a la vez: `putKeyRow` ignora el conflicto. El segundo ve otro `keyId`, pasa a `locked` y se enlaza con el primero.
- Dispositivo con versión antigua de la app: ignora las filas `enc` y `key`, porque no conoce esos `kind`. Si sube cambios en claro, cualquier dispositivo nuevo los recifra y borra la fila en claro en su siguiente sync.
- Sin conexión durante la activación: queda en `migrating` y se reanuda al volver.
- Un único dispositivo activado que se pierde, sin clave de recuperación: solo queda "Restablecer cifrado". Por eso la clave de recuperación se ofrece justo después de activar.
- Petición de enlace que nadie pidió (alguien con acceso a la cuenta de Google): el dispositivo activado muestra el aviso y el usuario puede rechazarla. Sin confirmación no se envía nada.
- Otra cuenta en el mismo dispositivo: la DK va ligada a `dk:<userId>`, así que la nueva cuenta no la ve y pasa a `locked` si tiene cifrado.
- Cierre de sesión: la DK local se conserva (va ligada a `dk:<userId>`), así que al volver a entrar no hay que enlazar de nuevo. `clearAll` (Borrar datos) sí la elimina, porque limpia `meta`.

## 9. Validación sin reversibilidad

Como el cifrado no se puede desactivar, las pruebas reales se hacen solo con **cuentas de prueba**. Si hay que volver a empezar con una de ellas, se borran a mano sus filas en Supabase (`items` y `pairings` de ese `user_id`) y los datos locales del navegador. No se añade ninguna función de desactivar en la app.

## 10. Tests (`vitest` + `fake-indexeddb`)

1. `crypto.test.ts`: round-trip, IV distintos, manipulación de `id` o `updated_at` (AAD), HMAC determinista, `keyId` estable y clave de recuperación (formato, lectura tolerante, envolver y desenvolver).
2. `pairing.test.ts`: enlace completo entre dos dispositivos simulados; código idéntico en ambos; compromiso falso o `nB` que no coincide; servidor que sustituye `pkA` o `pkB` (códigos distintos y DK no recuperable); petición caducada o rechazada.
3. Sync: el servidor simulado **no contiene ningún título ni nombre en claro** en lo subido tras activar.
4. Migración con filas en el servidor que el dispositivo no tenía, y tombstones: tras activar, no queda ninguna en claro.
5. Cliente antiguo (repo sin cambios) que baja filas `enc` y `key`: no modifica nada local.
6. Dos dispositivos con la misma DK: conflicto LWW con datos cifrados.
7. Registros mezclados (claro y cifrado) en la misma bajada: la fila en claro se recifra y se borra.
8. Dispositivo bloqueado: no sube nada y se desbloquea por enlace o por clave de recuperación.
9. Restablecer cifrado: nueva DK, datos locales resubidos y el otro dispositivo pasa a `locked`.
10. Dos cuentas en el mismo dispositivo: la segunda no usa la DK de la primera.
11. Activación concurrente; migración interrumpida y reanudada.
12. Servidor sin el SQL actualizado (400 al leer `key`): el sync normal sigue funcionando.
13. Regresión: toda la suite actual sin cifrado activado, sin cambios.
14. Comprobar que `crypto.subtle` está disponible en el entorno de test (jsdom); si no, usar el `webcrypto` de Node.

## 11. Fases (una rama y PR por fase)

| Fase | Contenido | Criterio de aceptación |
|---|---|---|
| A | `crypto.ts` + tests | Tests verdes, sin tocar nada más. |
| B | Servidor (`kind` `'enc'` y `'key'`, tabla `pairings`) y capa de API | Suite actual intacta. |
| C | Integración en el sync, desactivada si no hay fila `key`. Solo cifra lo nuevo | Sin cifrado activado, el comportamiento es idéntico al actual. |
| D | `pairing.ts` + tests | Enlace entre dos dispositivos simulados, incluidos los ataques del test 2. |
| E | UI: toggle, aviso, enlace, clave de recuperación y restablecer | Flujos de la sección 7 funcionando. |
| F | Validación real con cuentas de prueba: dos navegadores, un móvil y un dispositivo en la versión anterior; comprobar en Supabase que lo nuevo es ilegible | Sin pérdida de datos ni errores. |
| G | Cifrado de los datos anteriores (`markAllDirty`, borrado de filas en claro, verificación) | En Supabase solo quedan filas `enc` y `key` en las cuentas cifradas. |
| H | Activar para personas concretas y observar | Sin incidencias. |

## 12. Riesgos y límites

- **Irreversible:** un error en la activación no se puede deshacer desde la app. Por eso la validación con cuentas de prueba (§9) y la fase G antes de activar para otras personas.
- **Datos anteriores**: hasta la fase G, lo que existía antes de activar sigue en claro en el servidor.
- **Backups y WAL**: si Supabase tiene PITR, conservan el contenido en claro anterior a la migración. Se purga cuando rotan.
- **Código controlado por el admin**: protege contra mirar los datos, no contra un administrador que modifique la web para leer la clave.
- **Pérdida de todos los dispositivos sin clave de recuperación**: los datos del servidor se pierden. Mitigado por la clave de recuperación opcional y porque cada dispositivo tiene todos los datos en local.
- **El enlace exige dos dispositivos a la vez**: si el usuario solo tiene uno activado y lo pierde, el enlace no sirve; solo la clave de recuperación.
- **Protocolo de enlace**: es la parte criptográfica más delicada. Se implementa siguiendo un esquema conocido (comparación numérica con compromiso) y con tests de ataque.

## 13. Evolución prevista (fuera de este plan)

- **Apps nativas:** la DK se guarda también en iCloud Keychain (iOS) o Block Store (Android), que la sincronizan solas dentro de cada ecosistema con cifrado de extremo a extremo. El enlace solo hace falta entre ecosistemas o con la web. No cambian ni el formato de los datos ni el servidor.
- **Passkeys (PRF):** alternativa a la clave de recuperación, con huella o Face ID.
- **Enlace con QR**: atajo para dispositivos con cámara, que evita comparar el código.

## 14. Estado

Fases A–E y G implementadas (la G se adelantó a la activación, ver §7). Pendientes: F (validación real con cuentas de prueba) y H (activar para personas concretas). De paso se corrigió `clearAll`, que no limpiaba la tabla `settings`.
