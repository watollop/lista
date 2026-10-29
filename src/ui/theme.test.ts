// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo } from '../data/repo';
import { DEFAULT_SECONDARY_COLOR } from '../lib/preferences';
import { applyTheme, bindSecondaryColor, getSubtaskColor, setSubtaskColor } from './theme';

let dispose: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-look');
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});

describe('persistencia y aplicación del color secundario', () => {
  it('migra el color anterior sin reiniciarlo al recargar ni cambiar de estilo', async () => {
    localStorage.setItem('lista.subtaskColor', '#7849ce');
    const name = 'theme-' + crypto.randomUUID();
    const repo = createRepo(name);
    const onError = vi.fn();
    dispose = bindSecondaryColor(repo, onError);
    await vi.waitFor(async () => expect(await repo.getSecondaryColor()).toMatchObject({ value: '#7849ce', updatedAt: 0 }));
    applyTheme('light', 'classic');
    expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe('#7849ce');
    applyTheme('dark', 'industrial');
    expect(getSubtaskColor()).toBe('#7849ce');
    dispose();
    localStorage.removeItem('lista.subtaskColor');
    dispose = bindSecondaryColor(createRepo(name), onError);
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#7849ce'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('no inventa una selección local por defecto que pueda sobrescribir la nube', async () => {
    const repo = createRepo('theme-' + crypto.randomUUID());
    const read = vi.spyOn(repo, 'getSecondaryColor');
    dispose = bindSecondaryColor(repo, vi.fn());
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(await repo.getSecondaryColor()).toBeUndefined();
    expect(await repo.pendingChanges()).toEqual([]);
    expect(getSubtaskColor()).toBe(DEFAULT_SECONDARY_COLOR);
    await vi.waitFor(() => expect(localStorage.getItem('lista.subtaskColor')).toBeNull());
    dispose();
    dispose = bindSecondaryColor(repo, vi.fn());
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(await repo.getSecondaryColor()).toBeUndefined();
    expect(await repo.pendingChanges()).toEqual([]);
  });

  it('actualiza el color al recibir otra escritura del repositorio y lo reinicia al borrar datos', async () => {
    const repo = createRepo('theme-' + crypto.randomUUID());
    dispose = bindSecondaryColor(repo, vi.fn());
    await repo.setSecondaryColor('#3689cc');
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#3689cc'));
    await repo.setSecondaryColor('#58a676');
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#58a676'));
    await repo.clearAll();
    await vi.waitFor(() => expect(getSubtaskColor()).toBe(DEFAULT_SECONDARY_COLOR));
  });

  it('descarta lecturas antiguas que terminan después de una nueva selección', async () => {
    const repo = createRepo('theme-' + crypto.randomUUID());
    await repo.setSecondaryColor('#3689cc');
    let release!: () => void;
    vi.spyOn(repo, 'getSecondaryColor').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { id: 'secondaryColor', value: '#3689cc', dirty: 0, deleted: 0, updatedAt: 1 };
    });
    dispose = bindSecondaryColor(repo, vi.fn());
    await vi.waitFor(() => expect(release).toBeDefined());
    await repo.setSecondaryColor('#58a676');
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#58a676'));
    release();
    await Promise.resolve();
    expect(getSubtaskColor()).toBe('#58a676');
  });

  it('al desmontar deja de aplicar cambios pendientes', async () => {
    const repo = createRepo('theme-' + crypto.randomUUID());
    dispose = bindSecondaryColor(repo, vi.fn());
    await repo.setSecondaryColor('#3689cc');
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#3689cc'));
    dispose();
    await repo.setSecondaryColor('#58a676');
    expect(getSubtaskColor()).toBe('#3689cc');
  });

  it('propaga errores de lectura en vez de aparentar una sincronización correcta', async () => {
    const repo = createRepo('theme-' + crypto.randomUUID());
    vi.spyOn(repo, 'getSecondaryColor').mockRejectedValue(new Error('Base no disponible'));
    const onError = vi.fn();
    dispose = bindSecondaryColor(repo, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Base no disponible' })));
  });

  it('informa de errores al migrar la selección anterior sin borrar su caché', async () => {
    localStorage.setItem('lista.subtaskColor', '#7849ce');
    const repo = createRepo('theme-' + crypto.randomUUID());
    vi.spyOn(repo, 'initializeSecondaryColor').mockRejectedValue(new Error('No se pudo migrar'));
    const onError = vi.fn();
    dispose = bindSecondaryColor(repo, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'No se pudo migrar' })));
    expect(getSubtaskColor()).toBe('#7849ce');
    expect(await repo.getSecondaryColor()).toBeUndefined();
  });

  it('rechaza valores no hexadecimales antes de tocar el estilo', () => {
    setSubtaskColor('#7849ce');
    expect(() => setSubtaskColor('var(--accent)')).toThrow('color válido');
    expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe('#7849ce');
  });
});
