/** Sin permiso para dictar: 'mic' = micrófono denegado al sitio; 'service' = dictado desactivado en el sistema (iOS). */
export type Blocked = 'mic' | 'service';

/** Pasos para permitir el micrófono, según el dispositivo y el navegador. */
export function micSteps(kind: Blocked, ua: string, standalone: boolean, touch: number): string[] {
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  const android = /Android/.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
  if (ios && kind === 'service') return ['Abre Ajustes del iPhone → General → Teclado.', 'Activa «Dictado».', 'Vuelve aquí y toca «Reintentar».'];
  if (ios && standalone) return ['Abre Ajustes del iPhone → Apps → Safari → Micrófono.', 'Elige «Preguntar» o «Permitir».', 'Cierra Lista del todo y vuelve a abrirla.'];
  if (ios && safari) return ['Toca «aA» en la barra de direcciones → Ajustes del sitio web.', 'En Micrófono, elige «Permitir».', 'Si no aparece: Ajustes del iPhone → Apps → Safari → Micrófono → «Preguntar».'];
  if (ios) return ['Abre Ajustes del iPhone → Apps → tu navegador.', 'Activa «Micrófono».', 'Vuelve aquí y toca «Reintentar».'];
  if (android && standalone) return ['Mantén pulsado el icono de Lista → Información de la app.', 'Permisos → Micrófono → «Permitir solo mientras se usa la app».', 'Vuelve aquí y toca «Reintentar».'];
  if (safari) return ['En la barra de menús: Safari → Ajustes → Sitios web → Micrófono.', 'Busca este sitio y elige «Permitir».', 'Vuelve aquí y toca «Reintentar».'];
  return ['Toca el icono a la izquierda de la dirección (el candado o los ajustes).', 'En Micrófono, elige «Permitir».', 'Vuelve aquí y toca «Reintentar».'];
}
