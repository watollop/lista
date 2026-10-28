/** Sin permiso para dictar: 'mic' = micrófono denegado al sitio; 'service' = dictado desactivado en el sistema (iOS). */
export type Blocked = 'mic' | 'service';

const RETRY = 'Vuelve aquí y toca «Reintentar».';

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
  const name = edge ? 'Edge' : chrome ? 'Chrome' : samsung ? 'Samsung Internet' : 'tu navegador';

  // iPhone y iPad: todos los navegadores usan el permiso de iOS.
  if (ios && kind === 'service') return ['Abre Ajustes del iPhone → General → Teclado.', 'Activa «Dictado».', RETRY];
  if (ios && standalone) return ['Abre Ajustes del iPhone → Apps → Safari → Micrófono.', 'Elige «Preguntar» o «Permitir».', 'Cierra Lista del todo y vuelve a abrirla.'];
  if (ios && safari) return ['Toca «aA» en la barra de direcciones → Ajustes del sitio web.', 'En Micrófono, elige «Permitir».', 'Si no aparece: Ajustes del iPhone → Apps → Safari → Micrófono → «Preguntar».'];
  if (ios) return [`Abre Ajustes del iPhone → Apps → ${name}.`, 'Activa «Micrófono».', `Vuelve a ${name} y toca «Reintentar».`];

  // Android: permiso del sitio en el navegador y, debajo, el del sistema para el navegador.
  if (android) return [
    standalone
      ? `Abre ${name} → ⋮ → Ajustes → Configuración de sitios → Micrófono, busca este sitio y elige «Permitir».`
      : 'Toca el icono a la izquierda de la dirección → Permisos → Micrófono → «Permitir».',
    `Si sigue sin funcionar: Ajustes de Android → Apps → ${name} → Permisos → Micrófono → «Permitir mientras se usa la app».`,
    RETRY,
  ];

  // Escritorio.
  if (safari) return ['En la barra de menús: Safari → Ajustes → Sitios web → Micrófono.', 'Busca este sitio y elige «Permitir».', RETRY];
  const system = mac
    ? `Si sigue sin funcionar: Ajustes del Sistema → Privacidad y seguridad → Micrófono → activa ${name}.`
    : windows
      ? 'Si sigue sin funcionar: Configuración de Windows → Privacidad y seguridad → Micrófono → permite el acceso a las aplicaciones de escritorio.'
      : 'Si sigue sin funcionar, revisa que el sistema deje usar el micrófono al navegador.';
  return [`Haz clic en el icono a la izquierda de la dirección → Micrófono → «Permitir».`, system, RETRY];
}
