// Vistas que no hacen falta en el primer pintado: cada import() es un chunk aparte (ver lazy.ts).
// Se precargan en reposo (App) para que abrirlas no tenga retardo; el SW las precachea como cualquier asset.
import { lazy } from './lazy';

export const LazySettings = lazy(() => import('./Settings').then((m) => m.Settings));
export const LazyOnboarding = lazy(() => import('./Onboarding').then((m) => m.Onboarding));
export const LazyShortcutsSheet = lazy(() => import('./ShortcutsSheet').then((m) => m.ShortcutsSheet));
export const LazyLinkDialog = lazy(() => import('./Encryption').then((m) => m.LinkDialog));
export const LazyLockedPanel = lazy(() => import('./Encryption').then((m) => m.LockedPanel));
export const LazyDictation = lazy(() => import('./Dictation').then((m) => m.Dictation));
export const LazyShareDialog = lazy(() => import('./Share').then((m) => m.ShareDialog));
export const LazyJoinDialog = lazy(() => import('./Share').then((m) => m.JoinDialog));

const VIEWS = [LazySettings, LazyOnboarding, LazyShortcutsSheet, LazyLinkDialog, LazyLockedPanel, LazyDictation, LazyShareDialog, LazyJoinDialog];

/** Empieza a bajar los chunks de todas las vistas diferidas. */
export const preloadViews = () => VIEWS.forEach((view) => view.preload());
