import { render } from 'preact';
import './ui/styles.css';
import './ui/look.css';
import { createRepo } from './data/repo';
import { createSync, syncConfigFromEnv } from './sync';
import { registerSW, requestPersistence } from './pwa/register';
import { applyTheme } from './ui/theme';
import { App } from './ui/App';
import { startAppearanceSync } from './ui/appearanceSync';

const repo = createRepo();
const sync = createSync(repo, syncConfigFromEnv());

render(<App repo={repo} sync={sync} />, document.getElementById('app')!);
sync.start();
startAppearanceSync(repo);
applyTheme();
registerSW();
void requestPersistence();
