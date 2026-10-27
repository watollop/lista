// QA: tests de borde entre módulos (parser + repo + filtros + sync).
// Convención: lo que el usuario espera => `it`; bug confirmado => `it.fails` con // BUG:;
// comportamiento debatible => aserta lo actual con // NOTA:.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRepo } from '../data/repo';
import { parseLine, parseBlock, formatLine } from '../parser';
import { applyFilter, emptyFilter } from '../filters';
import type { Filter, ParsedLine, Repo, Task } from '../types';

const TODAY = '2026-10-27'; // martes

const at = (y: number, m: number, d: number, h = 10, min = 0): Date => new Date(y, m - 1, d, h, min);
const parse = (s: string, now: Date = at(2026, 10, 27)): ParsedLine => parseLine(s, now);
const newRepo = (): Repo => createRepo(`qa-${crypto.randomUUID()}`);
const f = (p: Partial<Filter> = {}): Filter => ({ ...emptyFilter(), ...p });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(2026, 10, 27));
});

afterEach(() => {
  vi.useRealTimers();
});

async function topicNamesOf(r: Repo, keys: string[]): Promise<string[]> {
  const all = await r.listTopics();
  return keys.map((k) => all.find((e) => e.key === k)!.name);
}

async function peopleNamesOf(r: Repo, keys: string[]): Promise<string[]> {
  const all = await r.listPeople();
  return keys.map((k) => all.find((e) => e.key === k)!.name);
}

// ---------- 1. acentos y mayúsculas ----------

describe('1. acentos y mayúsculas', () => {
  it('NOTA: #Diseño, #diseno y #DISEÑO son dos temas porque la ñ forma parte de la clave', async () => {
    const r = newRepo();
    const tasks = await r.addParsed([parse('Maquetar #Diseño'), parse('Revisar #diseno'), parse('Exportar #DISEÑO')]);
    const topics = await r.listTopics();
    expect(topics.map((t) => t.key).sort()).toEqual(['diseno', 'diseño']);
    expect(tasks[0].topics).toEqual(['diseño']);
    expect(tasks[2].topics).toEqual(['diseño']);
    expect(tasks[1].topics).toEqual(['diseno']);
    expect(topics.find((t) => t.key === 'diseño')!.name).toBe('Diseño');
  });

  it('@José y @jose son una sola persona', async () => {
    const r = newRepo();
    const [a, b] = await r.addParsed([parse('Llamar @José'), parse('Enviar fotos @jose')]);
    const people = await r.listPeople();
    expect(people).toHaveLength(1);
    expect(a.people).toEqual(['jose']);
    expect(b.people).toEqual(['jose']);
    expect(people[0].name).toBe('José');
  });

  it('la búsqueda "jose" (y "JOSÉ") encuentra la tarea con @José', async () => {
    const r = newRepo();
    await r.addParsed([parse('Llamar @José'), parse('Comprar pan')]);
    const tasks = await r.listTasks();
    expect(applyFilter(tasks, f({ text: 'jose' }), TODAY).map((t) => t.title)).toEqual(['Llamar @José']);
    expect(applyFilter(tasks, f({ text: 'JOSÉ' }), TODAY).map((t) => t.title)).toEqual(['Llamar @José']);
  });

  it('título con emoji y «comillas» sobrevive parse -> repo -> formatLine -> parse', async () => {
    const r = newRepo();
    const p1 = parse('Llamar a «Ana» 📞 #Casa @José !2');
    expect(p1.title).toBe('Llamar a «Ana» 📞 #Casa @José');
    const [t] = await r.addParsed([p1]);
    const line = formatLine({
      title: t.title,
      topicNames: await topicNamesOf(r, t.topics),
      peopleNames: await peopleNamesOf(r, t.people),
      due: t.due,
      priority: t.priority,
      recurrence: t.recurrence,
    });
    const p2 = parse(line);
    expect(p2.title).toBe(p1.title);
    expect(p2.topics).toEqual(['Casa']);
    expect(p2.people).toEqual(['José']);
    expect(p2.priority).toBe(2);
  });
});

// ---------- 2. fechas ambiguas ----------

describe('2. fechas ambiguas', () => {
  it('"mañana por la mañana": vence mañana; "por la mañana" no se toma como fecha', () => {
    const p = parse('Comprar mañana por la mañana');
    expect(p.due).toBe('2026-10-28');
    // NOTA: el título conserva "por la mañana"; solo se quita "mañana" (la franja no se elimina).
    expect(p.title).toBe('Comprar por la mañana');
  });

  it('"el 31" desde 15 de septiembre (sept. tiene 30 días) -> 31 de octubre', () => {
    expect(parse('Pagar la luz el 31', at(2026, 9, 15)).due).toBe('2026-10-31');
  });

  it('ARREGLADO: "29 feb" desde octubre de 2026 debe dar 29/02/2028 (actual: null, la fecha se pierde)', () => {
    // BUG: src/parser/dates.ts parseSpanishDate: chrono descarta el 29/02/2026 (no bisiesto) y no
    // reintenta el siguiente año bisiesto; el token no se reconoce y el título conserva "29 feb".
    expect(parse('Renovar carnet 29 feb').due).toBe('2028-02-29');
  });

  it('"lunes" en lunes -> el lunes de la semana siguiente (no hoy)', () => {
    // 2026-10-26 es lunes
    expect(parse('Ir al médico lunes', at(2026, 10, 26)).due).toBe('2026-11-02');
  });

  it('"vence:2026-02-30" (fecha inexistente) no produce una fecha', () => {
    expect(parse('Pagar vence:2026-02-30').due).toBeNull();
  });

  it('"vence:31/02" (fecha inexistente) no produce una fecha', () => {
    expect(parse('Pagar vence:31/02').due).toBeNull();
  });

  it('"hoy y mañana": solo se usa la primera (hoy)', () => {
    const p = parse('Llamar hoy y mañana');
    expect(p.due).toBe(TODAY);
    // NOTA: "y mañana" queda en el título.
    expect(p.title).toBe('Llamar y mañana');
  });

  it('"Comprar 15 nov" es fecha; "Leer capítulo 15" no', () => {
    const a = parse('Comprar 15 nov');
    expect(a.due).toBe('2026-11-15');
    expect(a.title).toBe('Comprar');
    const b = parse('Leer capítulo 15');
    expect(b.due).toBeNull();
    expect(b.title).toBe('Leer capítulo 15');
  });
});

// ---------- 3. duplicados ----------

async function countsOf(r: Repo) {
  return {
    tasks: (await r.listTasks()).length,
    topics: (await r.listTopics()).length,
    people: (await r.listPeople()).length,
    filters: (await r.listFilters()).length,
  };
}

describe('3. duplicados', () => {
  it('dos tareas con tema nuevo en el mismo lote crean una sola entidad', async () => {
    const r = newRepo();
    const tasks = await r.addParsed([parse('Limpiar #Casa'), parse('Regar #casa')]);
    expect(await r.listTopics()).toHaveLength(1);
    expect(tasks[0].topics).toEqual(['casa']);
    expect(tasks[1].topics).toEqual(['casa']);
  });

  it('borrar una tarea no borra su tema ni su persona', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([parse('Llamar #Casa @Ana')]);
    await r.deleteTask(t.id);
    expect((await r.listTopics()).map((e) => e.key)).toEqual(['casa']);
    expect((await r.listPeople()).map((e) => e.key)).toEqual(['ana']);
  });

  it('importBackup en modo merge dos veces es idempotente', async () => {
    const src = newRepo();
    await src.addParsed(parseBlock('Comprar pan #Casa @Ana\n> Harina #Casa\nLlamar !1', at(2026, 10, 27)));
    const backup = await src.exportBackup();
    const dst = newRepo();
    await dst.importBackup(backup, 'merge');
    const first = await countsOf(dst);
    expect(first).toEqual({ tasks: 3, topics: 1, people: 1, filters: 0 });
    await dst.importBackup(backup, 'merge');
    expect(await countsOf(dst)).toEqual(first);
  });
});

// ---------- 4. recurrencias ----------

describe('4. recurrencias', () => {
  it('"cada mes" desde 31 ene: al completar genera 28 feb', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([parse('Pagar alquiler cada mes', at(2026, 1, 31))]);
    expect(t.due).toBe('2026-01-31');
    vi.setSystemTime(at(2026, 1, 31));
    const { spawned } = await r.toggleDone(t.id);
    expect(spawned!.due).toBe('2026-02-28');
  });

  it('ARREGLADO: "cada mes" ancla el día: 28 feb completada debe generar 31 mar (actual: 28 mar)', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([parse('Pagar alquiler cada mes', at(2026, 1, 31))]);
    vi.setSystemTime(at(2026, 1, 31));
    const { spawned: feb } = await r.toggleDone(t.id);
    vi.setSystemTime(at(2026, 2, 28));
    const { spawned: mar } = await r.toggleDone(feb!.id);
    // BUG: src/data/repo.ts toggleDone usa task.due (28 feb) como base; nextOccurrence
    // (src/lib/recurrence.ts) solo conserva el día 31 si recibe la base original (31 ene).
    expect(mar!.due).toBe('2026-03-31');
  });

  it('tarea diaria vencida hace 3 días: al completar vence mañana', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([parse('Tomar pastilla cada día', at(2026, 10, 24))]);
    expect(t.due).toBe('2026-10-24');
    const { spawned } = await r.toggleDone(t.id);
    expect(spawned!.due).toBe('2026-10-28');
  });

  it('completar + reabrir + completar deja exactamente una ocurrencia abierta', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([parse('Regar plantas cada día')]);
    const first = await r.toggleDone(t.id);
    expect(first.spawned).not.toBeNull();
    await r.toggleDone(t.id); // reabrir
    const second = await r.toggleDone(t.id); // completar otra vez
    expect(second.spawned).not.toBeNull();

    const open = (await r.listTasks()).filter((x) => x.done === 0 && x.title === 'Regar plantas');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(second.spawned!.id);
    expect(open[0].due).toBe('2026-10-28');
  });

  it('completar una subtarea recurrente conserva parentId', async () => {
    const r = newRepo();
    const [p, s] = await r.addParsed(parseBlock('Mudanza\n> Regar cada día', at(2026, 10, 27)));
    expect(s.parentId).toBe(p.id);
    const { spawned } = await r.toggleDone(s.id);
    expect(spawned!.parentId).toBe(p.id);
    expect(spawned!.due).toBe('2026-10-28');
  });
});

// ---------- 5. subtareas ----------

describe('5. subtareas', () => {
  it('bloque con tabs y sangrado mixto: todas las líneas sangradas cuelgan de la primera', async () => {
    const lines = parseBlock('Compra\n\tPan\n  Leche\n> Huevos\n    Café', at(2026, 10, 27));
    expect(lines.map((l) => l.isSubtask)).toEqual([false, true, true, true, true]);
    expect(lines.map((l) => l.title)).toEqual(['Compra', 'Pan', 'Leche', 'Huevos', 'Café']);
    const r = newRepo();
    const tasks = await r.addParsed(lines);
    expect(tasks.slice(1).every((t) => t.parentId === tasks[0].id)).toBe(true);
  });

  it('"> ..." sin padre en el lote se crea como tarea normal', async () => {
    const r = newRepo();
    const [t] = await r.addParsed(parseBlock('> Huevos', at(2026, 10, 27)));
    expect(t.parentId).toBeNull();
    expect(t.title).toBe('Huevos');
    expect(await r.listTasks()).toHaveLength(1);
  });

  it('filtrar por tema del padre muestra también la subtarea', async () => {
    const r = newRepo();
    await r.addParsed(parseBlock('Mudanza #Casa\n  Cajas\nOtra cosa', at(2026, 10, 27)));
    const shown = applyFilter(await r.listTasks(), f({ topics: ['casa'] }), TODAY).map((t) => t.title);
    expect(shown.sort()).toEqual(['Cajas', 'Mudanza #Casa']);
  });

  it('borrar el padre tombstonea los hijos y restoreTask los devuelve', async () => {
    const r = newRepo();
    const [p] = await r.addParsed(parseBlock('Mudanza\n  Cajas\n  Cinta', at(2026, 10, 27)));
    await r.deleteTask(p.id);
    expect(await r.listTasks()).toHaveLength(0);
    await r.restoreTask(p.id);
    expect((await r.listTasks()).map((t) => t.title).sort()).toEqual(['Cajas', 'Cinta', 'Mudanza']);
  });
});

// ---------- 6. sincronización entre dispositivos ----------

const SYNC_CFG = { url: 'https://qa.supabase.test', anonKey: 'anon-key' };
const BASE_TS = Date.parse('2026-10-27T10:00:00Z');

interface Row {
  user_id: string;
  kind: string;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers as Record<string, string> | undefined;
  return h?.[name];
}

/** Servidor falso (GoTrue + PostgREST mínimos) con LWW por updated_at, como el trigger de Supabase. */
class FakeServer {
  users = new Map<string, { id: string; email: string; password: string }>();
  accessTokens = new Map<string, string>();
  refreshTokens = new Map<string, { userId: string; email: string }>();
  rows = new Map<string, Row>();
  private tokenSeq = 0;
  private seq = 0;

  addUser(email: string, password: string): void {
    this.users.set(email, { id: `user-${this.users.size + 1}`, email, password });
  }

  private issue(userId: string, email: string) {
    const access = `at-${++this.tokenSeq}`;
    const refresh = `rt-${this.tokenSeq}`;
    this.accessTokens.set(access, userId);
    this.refreshTokens.set(refresh, { userId, email });
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: userId, email },
    };
  }

  private nextSynced(): string {
    this.seq++;
    return new Date(BASE_TS + this.seq * 1000).toISOString().replace('Z', '+00:00');
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (headerOf(init, 'apikey') !== SYNC_CFG.anonKey) return json({ message: 'Invalid API key' }, 401);

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const u = this.users.get(body.email);
        if (!u || u.password !== body.password) {
          return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
        }
        return json(this.issue(u.id, u.email));
      }
      const stored = this.refreshTokens.get(body.refresh_token);
      if (!stored) return json({ error_description: 'Invalid Refresh Token' }, 400);
      this.refreshTokens.delete(body.refresh_token);
      return json(this.issue(stored.userId, stored.email));
    }

    if (url.pathname === '/rest/v1/items') {
      const token = headerOf(init, 'Authorization')?.replace('Bearer ', '') ?? '';
      const uid = this.accessTokens.get(token);
      if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
      return method === 'POST' ? this.upsert(uid, body) : this.select(uid, url);
    }
    return json({ message: 'not found' }, 404);
  };

  private upsert(uid: string, rows: Array<Omit<Row, 'synced_at'>>): Response {
    for (const r of rows) {
      const key = `${uid}|${r.kind}|${r.id}`;
      const cur = this.rows.get(key);
      if (cur && r.updated_at < cur.updated_at) continue; // LWW: se descarta la escritura más antigua
      this.rows.set(key, { ...r, user_id: uid, synced_at: this.nextSynced() });
    }
    return new Response(null, { status: 201 });
  }

  private select(uid: string, url: URL): Response {
    let list = [...this.rows.values()].filter((r) => r.user_id === uid);
    const since = url.searchParams.get('synced_at');
    if (since) {
      const t = Date.parse(since.replace(/^gt\./, ''));
      list = list.filter((r) => Date.parse(r.synced_at) > t);
    }
    list.sort((a, b) => Date.parse(a.synced_at) - Date.parse(b.synced_at));
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    return json(
      list.slice(0, limit).map(({ kind, id, data, updated_at, deleted, synced_at }) => ({
        kind,
        id,
        data,
        updated_at: String(updated_at),
        deleted,
        synced_at,
      })),
    );
  }
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/**
 * Dispositivo = repo real + sync real con su propio módulo. Se recarga el módulo para que cada
 * dispositivo tenga su propio contador monotónico (stamp) y así el reloj de cada uno sea independiente.
 */
async function makeDevice(server: FakeServer) {
  vi.resetModules();
  const repoMod = await import('../data/repo');
  const syncMod = await import('../sync');
  const repo = repoMod.createRepo(`qa-sync-${crypto.randomUUID()}`);
  const sync = syncMod.createSync(repo, SYNC_CFG, {
    fetch: server.fetch as unknown as typeof fetch,
    storage: memStorage(),
  });
  return { repo, sync };
}

async function twoDevices() {
  const server = new FakeServer();
  server.addUser('ana@qa.io', 'secreto');
  const a = await makeDevice(server);
  const b = await makeDevice(server);
  await a.sync.signIn('ana@qa.io', 'secreto');
  await b.sync.signIn('ana@qa.io', 'secreto');
  return { server, a, b };
}

const titleOf = async (r: Repo, id: string): Promise<string | undefined> =>
  (await r.listTasks()).find((t) => t.id === id)?.title;

describe('6. conflictos de sincronización', () => {
  it('ambos editan offline la misma tarea: convergen a la edición posterior', async () => {
    const { a, b } = await twoDevices();
    vi.setSystemTime(at(2026, 10, 27, 10, 0));
    const [t] = await a.repo.addParsed([parse('Llamar')]);
    await a.sync.syncNow();
    await b.sync.syncNow();

    vi.setSystemTime(at(2026, 10, 27, 10, 1));
    await a.repo.updateTask(t.id, { title: 'Llamar A' });
    vi.setSystemTime(at(2026, 10, 27, 10, 2));
    await b.repo.updateTask(t.id, { title: 'Llamar B' });

    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await titleOf(a.repo, t.id)).toBe('Llamar B');
    expect(await titleOf(b.repo, t.id)).toBe('Llamar B');
  });

  it('uno borra y el otro edita ANTES: gana el borrado', async () => {
    const { a, b } = await twoDevices();
    vi.setSystemTime(at(2026, 10, 27, 10, 0));
    const [t] = await a.repo.addParsed([parse('Llamar')]);
    await a.sync.syncNow();
    await b.sync.syncNow();

    vi.setSystemTime(at(2026, 10, 27, 10, 3));
    await b.repo.updateTask(t.id, { title: 'Llamar tarde' }); // edición anterior al borrado
    vi.setSystemTime(at(2026, 10, 27, 10, 5));
    await a.repo.deleteTask(t.id);

    await a.sync.syncNow();
    await b.sync.syncNow();
    await b.sync.syncNow();
    expect(await titleOf(a.repo, t.id)).toBeUndefined();
    expect(await titleOf(b.repo, t.id)).toBeUndefined();
  });

  it('NOTA: uno borra y el otro edita DESPUÉS: la edición gana y la tarea resucita', async () => {
    const { a, b } = await twoDevices();
    vi.setSystemTime(at(2026, 10, 27, 10, 0));
    const [p] = await a.repo.addParsed(parseBlock('Mudanza\n  Cajas', at(2026, 10, 27, 10, 0)));
    await a.sync.syncNow();
    await b.sync.syncNow();

    vi.setSystemTime(at(2026, 10, 27, 10, 5));
    await a.repo.deleteTask(p.id); // borra padre e hijo
    vi.setSystemTime(at(2026, 10, 27, 10, 7));
    await b.repo.updateTask(p.id, { title: 'Mudanza urgente' }); // edición posterior

    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    // NOTA: LWW gana la edición posterior, así que el padre resucita con el título nuevo.
    expect(await titleOf(a.repo, p.id)).toBe('Mudanza urgente');
    expect(await titleOf(b.repo, p.id)).toBe('Mudanza urgente');
    // NOTA: la subtarea borrada junto al padre NO vuelve (sigue tombstoned en ambos dispositivos).
    expect((await a.repo.listTasks()).map((t) => t.title)).toEqual(['Mudanza urgente']);
  });

  it('NOTA: reloj del dispositivo B 10 min atrás: su edición posterior en tiempo real pierde contra la anterior', async () => {
    const { a, b } = await twoDevices();
    vi.setSystemTime(at(2026, 10, 27, 10, 0));
    const [t] = await a.repo.addParsed([parse('Llamar')]);
    await a.sync.syncNow();
    await b.sync.syncNow();

    // Tiempo real 10:05: A edita y sincroniza con su reloj correcto.
    vi.setSystemTime(at(2026, 10, 27, 10, 5));
    await a.repo.updateTask(t.id, { title: 'A a las 10:05' });
    await a.sync.syncNow();

    // Tiempo real 10:06: B edita, pero su reloj marca 09:56 (10 min atrás).
    vi.setSystemTime(at(2026, 10, 27, 9, 56));
    await b.repo.updateTask(t.id, { title: 'B a las 10:06' });
    await b.sync.syncNow();
    await a.sync.syncNow();

    // NOTA: LWW por reloj del cliente: la edición de B (09:56) se descarta aunque sea la más reciente.
    expect(await titleOf(a.repo, t.id)).toBe('A a las 10:05');
    expect(await titleOf(b.repo, t.id)).toBe('A a las 10:05');
  });
});

// ---------- 7. filtros ----------

describe('7. filtros', () => {
  it('filtro "semana" cruza el cambio de mes desde 28 oct (hasta 3 nov incluido)', () => {
    const mk = (title: string, due: string): Task => ({
      id: title, title, topics: [], people: [], due, priority: null, recurrence: null, parentId: null,
      done: 0, doneAt: null, nextId: null, order: 0, createdAt: 0, updatedAt: 0, deleted: 0, dirty: 0,
    });
    const tasks = [
      mk('ayer', '2026-10-27'),
      mk('hoy', '2026-10-28'),
      mk('fin-semana', '2026-11-03'),
      mk('fuera', '2026-11-04'),
    ];
    const shown = applyFilter(tasks, f({ dates: ['week'] }), '2026-10-28').map((t) => t.title);
    expect(shown.sort()).toEqual(['fin-semana', 'hoy']);
  });

  it('búsqueda de texto ignora espacios repetidos y en los extremos', async () => {
    const r = newRepo();
    await r.addParsed([parse('Comprar pan integral'), parse('Comprar leche')]);
    const tasks = await r.listTasks();
    const titles = (text: string) => applyFilter(tasks, f({ text }), TODAY).map((t) => t.title);
    expect(titles('   compra    pan  ')).toEqual(['Comprar pan integral']);
    expect(titles('  PAN')).toEqual(['Comprar pan integral']);
    // solo espacios => sin restricción de texto: todas las abiertas
    expect(titles('   ').sort()).toEqual(['Comprar leche', 'Comprar pan integral']);
  });

  it('filtro vacío equivale a tareas abiertas (sin hechas ni borradas)', async () => {
    const r = newRepo();
    const [abierta, hecha, borrada] = await r.addParsed([parse('Abierta'), parse('Hecha'), parse('Borrada')]);
    await r.toggleDone(hecha.id);
    await r.deleteTask(borrada.id);
    const shown = applyFilter(await r.listTasks(), emptyFilter(), TODAY).map((t) => t.id);
    expect(shown).toEqual([abierta.id]);
  });

  it('NOTA: padre hecho con hijo abierto aparece en el filtro vacío (el padre se muestra por su hijo)', async () => {
    const r = newRepo();
    const [p] = await r.addParsed(parseBlock('Mudanza\n  Cajas', at(2026, 10, 27)));
    await r.toggleDone(p.id);
    const shown = applyFilter(await r.listTasks(), emptyFilter(), TODAY).map((t) => t.title);
    expect(shown.sort()).toEqual(['Cajas', 'Mudanza']);
  });
});
