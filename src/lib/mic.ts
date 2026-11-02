import { tr } from '../i18n';

/** Sin permiso para dictar: 'mic' = micrófono denegado al sitio; 'service' = dictado desactivado en el sistema (iOS). */
export type Blocked = 'mic' | 'service';

const retry = () => tr('Vuelve aquí y toca «Reintentar».', 'Come back here and tap “Try again”.');

/** Pasos para permitir el micrófono, según el dispositivo y el navegador (Safari, Chrome, Edge…). */
export function micSteps(kind: Blocked, ua: string, standalone: boolean, touch: number): string[] {
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  const android = /Android/.test(ua);
  const mac = /Macintosh/.test(ua) && !ios;
  const windows = /Windows/.test(ua);
  const edge = /Edg(e|A|iOS)?\//.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const chrome = /Chrome|CriOS/.test(ua) && !edge && !samsung && !/OPR\//.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
  const name = edge ? 'Edge' : chrome ? 'Chrome' : samsung ? 'Samsung Internet' : tr('tu navegador', 'your browser');
  const RETRY = retry();

  // iPhone y iPad: todos los navegadores usan el permiso de iOS.
  if (ios && kind === 'service') return [tr('Abre Ajustes del iPhone → General → Teclado.', 'Open iPhone Settings → General → Keyboard.'), tr('Activa «Dictado».', 'Turn on “Dictation”.'), RETRY];
  if (ios && standalone) return [tr('Abre Ajustes del iPhone → Apps → Safari → Micrófono.', 'Open iPhone Settings → Apps → Safari → Microphone.'), tr('Elige «Preguntar» o «Permitir».', 'Choose “Ask” or “Allow”.'), tr('Cierra Lista del todo y vuelve a abrirla.', 'Close Lista completely and open it again.')];
  if (ios && safari) return [tr('Toca «aA» en la barra de direcciones → Ajustes del sitio web.', 'Tap “aA” in the address bar → Website Settings.'), tr('En Micrófono, elige «Permitir».', 'Under Microphone, choose “Allow”.'), tr('Si no aparece: Ajustes del iPhone → Apps → Safari → Micrófono → «Preguntar».', 'If it’s not there: iPhone Settings → Apps → Safari → Microphone → “Ask”.')];
  if (ios) return [tr(`Abre Ajustes del iPhone → Apps → ${name}.`, `Open iPhone Settings → Apps → ${name}.`), tr('Activa «Micrófono».', 'Turn on “Microphone”.'), tr(`Vuelve a ${name} y toca «Reintentar».`, `Go back to ${name} and tap “Try again”.`)];

  // Android: permiso del sitio en el navegador y, debajo, el del sistema para el navegador.
  if (android) return [
    standalone
      ? tr(`Abre ${name} → ⋮ → Ajustes → Configuración de sitios → Micrófono, busca este sitio y elige «Permitir».`, `Open ${name} → ⋮ → Settings → Site settings → Microphone, find this site and choose “Allow”.`)
      : tr('Toca el icono a la izquierda de la dirección → Permisos → Micrófono → «Permitir».', 'Tap the icon left of the address → Permissions → Microphone → “Allow”.'),
    tr(`Si sigue sin funcionar: Ajustes de Android → Apps → ${name} → Permisos → Micrófono → «Permitir mientras se usa la app».`, `If it still doesn’t work: Android Settings → Apps → ${name} → Permissions → Microphone → “Allow while using the app”.`),
    RETRY,
  ];

  // Escritorio.
  if (safari) return [tr('En la barra de menús: Safari → Ajustes → Sitios web → Micrófono.', 'In the menu bar: Safari → Settings → Websites → Microphone.'), tr('Busca este sitio y elige «Permitir».', 'Find this site and choose “Allow”.'), RETRY];
  const system = mac
    ? tr(`Si sigue sin funcionar: Ajustes del Sistema → Privacidad y seguridad → Micrófono → activa ${name}.`, `If it still doesn’t work: System Settings → Privacy & Security → Microphone → turn on ${name}.`)
    : windows
      ? tr('Si sigue sin funcionar: Configuración de Windows → Privacidad y seguridad → Micrófono → permite el acceso a las aplicaciones de escritorio.', 'If it still doesn’t work: Windows Settings → Privacy & security → Microphone → let desktop apps access it.')
      : tr('Si sigue sin funcionar, revisa que el sistema deje usar el micrófono al navegador.', 'If it still doesn’t work, check that your system lets the browser use the microphone.');
  return [tr('Haz clic en el icono a la izquierda de la dirección → Micrófono → «Permitir».', 'Click the icon left of the address → Microphone → “Allow”.'), system, RETRY];
}
