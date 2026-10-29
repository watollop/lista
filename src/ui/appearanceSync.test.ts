// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo } from '../data/repo';
import { DEFAULT_SECONDARY_COLOR } from '../lib/preferences';
import { applyTheme, getLook, getSubtaskColor, getTheme, setSubtaskColor } from './theme';
import { saveAppearance, startAppearanceSync, type Appearance } from './appearanceSync';

let dispose: (() => void) | undefined;
const appearance = (subtaskColor: string): Appearance => ({ theme: 'dark', look: 'classic', subtaskColor });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-look');
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});

describe('apariencia sincronizada existente', () => {
  it('migra la elección anterior sin reiniciarla al recargar ni cambiar de estilo', async () => {
    localStorage.setItem('lista.subtaskColor', '#7849ce');
    const name = 'appearance-' + crypto.randomUUID();
    const repo = createRepo(name);
    const onError = vi.fn();
    dispose = startAppearanceSync(repo, onError);
    await vi.waitFor(async () => expect(await repo.getSetting('appearance')).toMatchObject({
      value: { subtaskColor: '#7849ce' }, updatedAt: 0,
    }));
    applyTheme('light', 'classic');
    expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe('#7849ce');
    applyTheme('dark', 'industrial');
    expect(getSubtaskColor()).toBe('#7849ce');
    dispose();
    localStorage.removeItem('lista.subtaskColor');
    dispose = startAppearanceSync(createRepo(name), onError);
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#7849ce'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('no inventa una selección por defecto que pueda sobrescribir la nube', async () => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    const read = vi.spyOn(repo, 'getSetting');
    dispose = startAppearanceSync(repo, vi.fn());
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(await repo.getSetting('appearance')).toBeUndefined();
    expect(await repo.pendingChanges()).toEqual([]);
    expect(getSubtaskColor()).toBe(DEFAULT_SECONDARY_COLOR);
    expect(localStorage.getItem('lista.subtaskColor')).toBeNull();
  });

  it('aplica tema, estilo y color sin volver a sembrarlos después de borrar datos', async () => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    dispose = startAppearanceSync(repo, vi.fn());
    await repo.setSetting('appearance', appearance('#3689cc'));
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#3689cc'));
    expect(getTheme()).toBe('dark');
    expect(getLook()).toBe('classic');
    await repo.clearAll();
    expect(await repo.getSetting('appearance')).toBeUndefined();
    expect(await repo.pendingChanges()).toEqual([]);
  });

  it('descarta lecturas antiguas que terminan después de una selección nueva', async () => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    await repo.setSetting('appearance', appearance('#3689cc'));
    let release!: () => void;
    vi.spyOn(repo, 'getSetting').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { value: appearance('#3689cc'), updatedAt: 1 };
    });
    dispose = startAppearanceSync(repo, vi.fn());
    await vi.waitFor(() => expect(release).toBeDefined());
    await repo.setSetting('appearance', appearance('#58a676'));
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#58a676'));
    release();
    await Promise.resolve();
    expect(getSubtaskColor()).toBe('#58a676');
  });

  it('deja de aplicar cambios tras desmontar', async () => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    dispose = startAppearanceSync(repo, vi.fn());
    await repo.setSetting('appearance', appearance('#3689cc'));
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#3689cc'));
    dispose();
    await repo.setSetting('appearance', appearance('#58a676'));
    expect(getSubtaskColor()).toBe('#3689cc');
  });

  it('informa de errores de lectura', async () => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    vi.spyOn(repo, 'getSetting').mockRejectedValue(new Error('Base no disponible'));
    const onError = vi.fn();
    dispose = startAppearanceSync(repo, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Base no disponible' })));
  });

  it('informa de errores de migración sin borrar la selección local', async () => {
    localStorage.setItem('lista.subtaskColor', '#7849ce');
    const repo = createRepo('appearance-' + crypto.randomUUID());
    vi.spyOn(repo, 'setSetting').mockRejectedValue(new Error('No se pudo migrar'));
    const onError = vi.fn();
    dispose = startAppearanceSync(repo, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'No se pudo migrar' })));
    expect(getSubtaskColor()).toBe('#7849ce');
  });

  it.each(['red', 'var(--accent)', '#123', ''])('no aplica colores remotos inválidos: %s', async (value) => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    await repo.setSetting('appearance', appearance(value));
    const onError = vi.fn();
    dispose = startAppearanceSync(repo, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'La apariencia sincronizada no es válida.' })));
    expect(getSubtaskColor()).toBe(DEFAULT_SECONDARY_COLOR);
  });

  it('evita escrituras redundantes para una apariencia ya guardada', async () => {
    const repo = createRepo('appearance-' + crypto.randomUUID());
    setSubtaskColor('#7849ce');
    const changed = vi.fn();
    repo.subscribe(changed);
    await saveAppearance(repo);
    const first = await repo.getSetting('appearance');
    await saveAppearance(repo);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await repo.getSetting('appearance')).toEqual(first);
    expect(await repo.getSetting('appearance')).toMatchObject({ value: { subtaskColor: '#7849ce' } });
  });
});
