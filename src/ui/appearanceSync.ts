import type { Repo } from '../types';
import { getLook, getSubtaskColor, getTheme, setLook, setSubtaskColor, setTheme, type Look, type Theme } from './theme';

/** Apariencia que viaja con la cuenta (ver Repo.setSetting). */
export interface Appearance { theme: Theme; look: Look; subtaskColor: string }

const KEY = 'appearance';
const valid = (a: unknown): a is Appearance => {
  const v = a as Appearance | null;
  return !!v && ['system', 'light', 'dark'].includes(v.theme) && ['classic', 'industrial'].includes(v.look)
    && /^#[\da-f]{6}$/i.test(v.subtaskColor);
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
export function startAppearanceSync(repo: Repo): () => void {
  let seeded = false;
  const apply = async () => {
    const s = await repo.getSetting<Appearance>(KEY);
    if (!s) {
      if (!seeded && hasLocalChoice()) { seeded = true; await saveAppearance(repo); }
      return;
    }
    seeded = true;
    if (!valid(s.value) || same(s.value, current())) return;
    setTheme(s.value.theme);
    setLook(s.value.look);
    setSubtaskColor(s.value.subtaskColor);
  };
  void apply();
  return repo.subscribe(() => void apply());
}
