import type { Repo } from '../types';
import { effectiveLang, hasStoredLang, isLangPref, lang, langPref, setLangPref, storeLangPref, type LangPref } from '../i18n';

/** Idioma que viaja con la cuenta (ver Repo.setSetting), como la apariencia. */
const KEY = 'lang';

/** Guarda la elección en la cuenta y la aplica (recarga). */
export async function chooseLang(repo: Repo, pref: LangPref): Promise<void> {
  try { await repo.setSetting(KEY, pref); } catch { /* se aplica igual en este dispositivo */ }
  setLangPref(pref);
}

/**
 * Mantiene el idioma al día con el de la cuenta: si otro dispositivo lo cambia, se aplica aquí (y se recarga solo si
 * el idioma que se ve cambia). La primera vez, si este dispositivo ya tenía uno elegido y la cuenta no, lo sube.
 */
export function startLangSync(repo: Repo): () => void {
  let seeded = false;
  let active = true;
  const apply = async () => {
    const s = await repo.getSetting(KEY);
    if (!active) return;
    if (!s) {
      if (!seeded && hasStoredLang()) await repo.setSetting(KEY, langPref(), 'initialize');
      seeded = true;
      return;
    }
    seeded = true;
    if (!isLangPref(s.value) || s.value === langPref()) return;
    if (effectiveLang(s.value) !== lang()) setLangPref(s.value); // recarga en el idioma nuevo
    else storeLangPref(s.value);
  };
  const refresh = () => { void apply().catch(() => { /* sin idioma remoto: se queda el local */ }); };
  const unsubscribe = repo.subscribe(refresh);
  refresh();
  return () => { active = false; unsubscribe(); };
}
