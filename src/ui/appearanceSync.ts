import type { Repo } from '../types';
import { getLook, getSubtaskColor, getTheme, setLook, setSubtaskColor, setTheme, type Look, type Theme } from './theme';
import { isSecondaryColor } from '../lib/preferences';

/** Apariencia que viaja con la cuenta (ver Repo.setSetting). */
export interface Appearance { theme: Theme; look: Look; subtaskColor: string }

const KEY = 'appearance';
const valid = (a: unknown): a is Appearance => {
  return !!a && typeof a === 'object' &&
    'theme' in a && (a.theme === 'system' || a.theme === 'light' || a.theme === 'dark') &&
    'look' in a && (a.look === 'classic' || a.look === 'industrial') &&
    'subtaskColor' in a && isSecondaryColor(a.subtaskColor);
};
const current = (): Appearance => ({ theme: getTheme(), look: getLook(), subtaskColor: getSubtaskColor() });
const same = (a: Appearance, b: Appearance) => a.theme === b.theme && a.look === b.look && a.subtaskColor.toLowerCase() === b.subtaskColor.toLowerCase();

/** Guarda la apariencia actual en el repo para que se sincronice. Llamar tras cambiar tema, estilo o color. */
export async function saveAppearance(repo: Repo): Promise<void> {
  await repo.setSetting(KEY, current());
}

/** ¿Hay algo elegido a mano en este dispositivo? (si no, no hay nada que subir ni que pisar) */
const hasLocalChoice = (): boolean => {
  try {
    return ['lista.theme', 'lista.look', 'lista.subtaskColor'].some((k) => localStorage.getItem(k) !== null);
  } catch { return false; }
};

/**
 * Mantiene la apariencia al día con la del repo: lo que llega de otro dispositivo se aplica aquí.
 * La primera vez, si este dispositivo ya tenía elecciones y la cuenta no tiene ninguna, las sube.
 */
export function startAppearanceSync(repo: Repo, onError: (error: unknown) => void): () => void {
  let seeded = false;
  let active = true;
  let revision = 0;
  const apply = async () => {
    const reading = ++revision;
    const s = await repo.getSetting(KEY);
    if (!active || reading !== revision) return;
    if (!s) {
      const initialize = !seeded && hasLocalChoice();
      seeded = true;
      if (initialize) await repo.setSetting(KEY, current(), 'initialize');
      return;
    }
    seeded = true;
    if (!valid(s.value)) throw new Error('La apariencia sincronizada no es válida.');
    if (same(s.value, current())) return;
    setTheme(s.value.theme);
    setLook(s.value.look);
    setSubtaskColor(s.value.subtaskColor);
  };
  const refresh = () => { void apply().catch((error) => { if (active) onError(error); }); };
  const unsubscribe = repo.subscribe(refresh);
  refresh();
  return () => { active = false; unsubscribe(); };
}
