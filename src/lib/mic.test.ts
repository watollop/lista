import { describe, expect, it } from 'vitest';
import { micSteps } from './mic';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('micSteps', () => {
  it('iPhone en Safari: ajustes del sitio desde «aA»', () => {
    expect(micSteps('mic', IPHONE_SAFARI, false, 5)[0]).toMatch(/aA/);
  });
  it('iPhone con la app instalada: Ajustes → Safari y reabrir', () => {
    const s = micSteps('mic', IPHONE_SAFARI, true, 5);
    expect(s[0]).toMatch(/Apps → Safari → Micrófono/);
    expect(s[2]).toMatch(/vuelve a abrirla/);
  });
  it('iPhone con dictado desactivado: activar Dictado en el teclado', () => {
    expect(micSteps('service', IPHONE_SAFARI, false, 5)[1]).toMatch(/Dictado/);
  });
  it('Chrome en iPhone: permiso de la app del navegador', () => {
    expect(micSteps('mic', IPHONE_CHROME, false, 5)[0]).toMatch(/tu navegador/);
  });
  it('iPad (se anuncia como Mac, pero es táctil)', () => {
    expect(micSteps('mic', IPAD, false, 5)[0]).toMatch(/aA/);
  });
  it('Safari en Mac: Ajustes → Sitios web', () => {
    expect(micSteps('mic', IPAD, false, 0)[0]).toMatch(/Sitios web/);
  });
  it('Android instalada: permisos de la app', () => {
    expect(micSteps('mic', ANDROID, true, 5)[1]).toMatch(/Permisos → Micrófono/);
  });
  it('Chrome (Android en navegador o escritorio): icono junto a la dirección', () => {
    expect(micSteps('mic', ANDROID, false, 5)[0]).toMatch(/dirección/);
    expect(micSteps('mic', MAC_CHROME, false, 0)[0]).toMatch(/dirección/);
  });
});
