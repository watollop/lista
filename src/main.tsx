import { render } from 'preact';
import { initLang } from './i18n';
import './ui/styles.css';
import './ui/look.css';
import { createRepo } from './data/repo';
import { createSync, syncConfigFromEnv } from './sync';
import { registerSW, requestPersistence } from './pwa/register';
import { applyTheme } from './ui/theme';
import { App } from './ui/App';
import { whenIdle } from './ui/lazy';
import { captureJoinLink } from './ui/sharing';

/** Tombstones sincronizados que se conservan en local antes de purgarlos (el servidor los guarda siempre). */
const TOMBSTONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

initLang(); // antes de pintar nada: idioma del navegador o el elegido en Ajustes
// Enlace de invitación (#unirse=…): se guarda y se quita de la URL antes de nada, porque el regreso de Google
// también usa el fragmento (docs/plan-listas.md §4.5). App abre el diálogo de unirse.
captureJoinLink();
const repo = createRepo();
const sync = createSync(repo, syncConfigFromEnv());

render(<App repo={repo} sync={sync} />, document.getElementById('app')!);
sync.start();
applyTheme();
registerSW();
void requestPersistence();
whenIdle(() => {
  repo.purgeTombstones(TOMBSTONE_RETENTION_MS).catch((error) => console.warn('Purga de borrados locales fallida', error));
});
