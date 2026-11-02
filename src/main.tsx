import { render } from 'preact';
import './ui/styles.css';
import './ui/look.css';
import { createRepo } from './data/repo';
import { createSync, syncConfigFromEnv } from './sync';
import { registerSW, requestPersistence } from './pwa/register';
import { applyTheme } from './ui/theme';
import { App } from './ui/App';
import { whenIdle } from './ui/lazy';

/** Tombstones sincronizados que se conservan en local antes de purgarlos (el servidor los guarda siempre). */
const TOMBSTONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

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
