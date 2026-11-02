import { describe, expect, it } from 'vitest';
import { precacheHas } from './register';

const SCOPE = 'https://lista.app/';

describe('precacheHas', () => {
  it('reconoce la build que ya se está ejecutando', () => {
    expect(precacheHas(['./', 'assets/index-abc.js', 'sw.js'], SCOPE, 'https://lista.app/assets/index-abc.js')).toBe(true);
  });
  it('una build distinta sí es versión nueva', () => {
    expect(precacheHas(['./', 'assets/index-def.js'], SCOPE, 'https://lista.app/assets/index-abc.js')).toBe(false);
  });
  it('sin respuesta del SW o sin script, se avisa como antes', () => {
    expect(precacheHas(null, SCOPE, 'https://lista.app/assets/index-abc.js')).toBe(false);
    expect(precacheHas(['assets/index-abc.js'], SCOPE, undefined)).toBe(false);
  });
  it('funciona con la app publicada en una subcarpeta', () => {
    expect(precacheHas(['assets/index-abc.js'], 'https://x.dev/lista/', 'https://x.dev/lista/assets/index-abc.js')).toBe(true);
  });
});
