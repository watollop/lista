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

La guía de sintaxis permanece visible mientras escribes, con el mismo tamaño de letra y menor opacidad.

**Subtareas**: pulsa **+ subtarea** al escribir una tarea. Enter en una subtarea con texto abre la siguiente; Enter en una vacía guarda la tarea con todas sus subtareas. También puedes usar **Guardar tarea**. Para añadirlas a una tarea existente, abre su editor y pulsa **+ subtarea**.

## 2 · Completa y filtra

- Desliza a la **derecha** para completarla y a la **izquierda** para borrarla.
- Toca `#trabajo`, `@ana` o una fecha para ver solo eso.
- Las tareas se agrupan solas: Vencidas · Hoy · Mañana · Esta semana · Próximas.
- Para cambiarla de día, tócala y arrastra **Mover**.
- Las tareas con subtareas muestran un icono rosa: toca el icono o el título para desplegarlas. El lápiz permite editar la tarea principal.
- Una tarea con subtareas se completa al terminar todas; reabrir una subtarea reabre la principal.

## 3 · Tus datos, contigo

- Todo se guarda **en tu dispositivo** y funciona sin conexión.
- Si quieres verlas en el móvil y en el ordenador, entra con **Google** y se sincronizan.
- Puedes exportarlo todo o borrarlo todo desde Ajustes.

## 4 · A tu gusto

- Claro, oscuro o el del sistema.
- Dos estilos: **Clásico** (blanco y negro) o **Industrial** (gris cálido, letra de puntos y naranja).
- Color del icono de subtareas personalizable en **Ajustes → Apariencia**, con rosa por defecto.
- Se instala como una app más: *Compartir → Añadir a pantalla de inicio* (iPhone) o *Instalar app* (Android y ordenador).

---

## Parte técnica

**Stack**: Vite · TypeScript · Preact · Dexie (IndexedDB) · Supabase · Cloudflare Pages.

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run build
```

Sin configurar nada, funciona en local sin sincronización.

**Sincronización (opcional)**
1. Crea un proyecto en Supabase y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
2. Copia `.env.example` a `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
3. Activa Google en *Authentication → Providers* y añade tu URL en *Redirect URLs*.

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
