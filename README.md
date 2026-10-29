# Lista

**Una lista. Nada más.**

Una app de tareas sin cuentas, sin menús y sin ruido. Escribes, la haces, la tachas.

→ **[Pruébala](https://lista-7bi.pages.dev/)** · funciona en iPhone, Android y ordenador.

---

## 1 · Escribe en una línea

```
Revisar ventas cada lunes #trabajo !alta
```

Lista entiende lo que escribes y lo ordena sola:

- **Cuándo**: `hoy`, `mañana`, `el viernes`, `15 nov`, `esta semana`, `este trimestre`
- **Tema**: `#trabajo` · **Persona**: `@ana`
- **Prioridad**: `!alta` `!media` `!baja`
- **Repetir**: `cada lunes`, `cada mes`, `a diario`

También puedes dictarla con el micrófono, una tarea tras otra.

El campo vacío muestra el ejemplo `Viaje <Billetes mañana !alta #ocio @ana`. Al escribir desaparece el ejemplo, pero la guía `#tema @persona !prioridad fecha <subtarea` permanece visible, con letra más pequeña y menor opacidad.

**Subtareas**: separa las subtareas con `<` en la misma línea, por ejemplo `Tarea A <Subtarea B <Subtarea C !alta mañana #tema`. Enter guarda la tarea con dos subtareas hermanas; cada una tiene sus propios metadatos (en el ejemplo, solo C recibe prioridad, fecha y tema).

En la captura se añaden subtareas con `<`, sin botones adicionales. Para añadirlas a una tarea existente, abre su editor y pulsa **+** o usa el **+** del grupo desplegado. Enter en una subtarea con texto abre la siguiente; Enter en una vacía guarda las subtareas. También puedes usar **Añadir subtareas**.

## 2 · Completa y filtra

- Desliza a la **derecha** para completarla y a la **izquierda** para borrarla.
- Toca `#trabajo`, `@ana` o una fecha para ver solo eso.
- Las tareas se agrupan solas: Vencidas · Hoy · Mañana · Esta semana · Próximas.
- Para cambiarla de día, tócala y arrastra **Mover**.
- Solo la fila seleccionada muestra una línea a la izquierda: en Clásico usa el color secundario si es una tarea con subtareas o una subtarea; en Industrial usa el naranja del estilo. Toca el título de la tarea principal para desplegar sus subtareas y el lápiz para editarla.
- Dentro del grupo desplegado, toca el **+** junto a la casilla de la última subtarea, a su izquierda y al nivel de la casilla principal, para añadir más subtareas.
- En Clásico, la línea inferior de las subtareas y los **+** usan el color secundario sin transparencia. Industrial conserva sus puntos y su acento naranja.
- Completar la tarea principal cierra todas sus subtareas. También se completa al terminar la última subtarea; reabrir una subtarea reabre la principal y reabrir la principal reabre todas.
- **Deshacer** recupera el estado previo sin reabrir subtareas que ya estaban hechas.
- En Clásico, las subtareas completadas usan el color elegido en la casilla y en la línea de tachado.

## 3 · Tus datos, contigo

- Todo se guarda **en tu dispositivo** y funciona sin conexión.
- Si quieres verlas en el móvil y en el ordenador, entra con **Google** y se sincronizan.
- Puedes exportarlo todo o borrarlo todo desde Ajustes.

## 4 · A tu gusto

- Claro, oscuro o el del sistema.
- Dos estilos: **Clásico** (blanco y negro) o **Industrial** (gris cálido, letra de puntos y naranja).
- **Color secundario**, solo en **Clásico**, en **Ajustes → Apariencia**: círculos rosa (por defecto), azul, verde y naranja, y uno multicolor para elegir un color personalizado. La elección se conserva al cambiar de estilo; Industrial no la utiliza ni muestra la paleta.
- Con la misma cuenta, el color se sincroniza entre móvil y ordenador. Sin conexión queda guardado en el dispositivo y se envía al recuperar la conexión; ante cambios simultáneos gana el más reciente. El estilo y el modo claro/oscuro siguen siendo propios de cada dispositivo.
- Se instala como una app más: *Compartir → Añadir a pantalla de inicio* (iPhone) o *Instalar app* (Android y ordenador).

---

## Parte técnica

**Stack**: Vite · TypeScript · Preact · Dexie (IndexedDB) · Supabase · Cloudflare Pages.

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run test:coverage
npm run build
```

Sin configurar nada, funciona en local sin sincronización.

La cobertura incluye todo `src/` y genera los informes LCOV y JSON en `coverage/`, excluidos de Git.

**Sincronización (opcional)**
1. Crea un proyecto en Supabase y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
2. Copia `.env.example` a `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
3. Activa Google en *Authentication → Providers* y añade tu URL en *Redirect URLs*.

**Instalaciones existentes:** antes de publicar esta versión, ejecuta la migración de preferencias de `supabase/migrations/` en el SQL editor de Supabase, o vuelve a ejecutar `supabase/schema.sql`. Amplía los tipos de registro admitidos para incluir el color, manteniendo las políticas de acceso por usuario y el mecanismo de conflictos existente. Sin actualizar el esquema, el servidor rechazará los envíos de preferencias y Ajustes mostrará el error de sincronización.

El color anterior guardado en el dispositivo se migra una sola vez. No sobrescribe una elección ya sincronizada. Si varios dispositivos conservaban colores antiguos distintos, convergen en el aceptado por el servidor. Al actualizar, la base local fuerza una descarga completa para recuperar preferencias que una versión anterior pudo ignorar. Las copias nuevas incluyen el color; importar una copia antigua sin preferencias conserva el color actual.

**Despliegue**: cada merge a `main` pasa los tests y publica en Cloudflare Pages ([`deploy.yml`](.github/workflows/deploy.yml)). Necesita los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, y los de Supabase si usas sincronización.

**Cómo está hecho**
- Local-first: cada cambio se guarda al instante y se sube en segundo plano; si hay conflicto gana el más reciente.
- Los datos de cada usuario están protegidos con RLS en Supabase.
- Service worker propio: funciona sin conexión y se actualiza solo.
- Sin peticiones a terceros: las fuentes van incluidas y la CSP es estricta.

| Carpeta | Qué hay |
|---|---|
| `src/parser/` | Entiende la línea que escribes |
| `src/data/` | Base de datos local |
| `src/sync/` | Sincronización con Supabase |
| `src/ui/` | Pantallas y estilos |
| `src/pwa/` | Service worker |

---

Código Do Norte ♥ Coruña
