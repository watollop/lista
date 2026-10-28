import { describe, expect, it } from 'vitest';
import { micSteps } from './mic';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const ANDROID_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';

describe('micSteps: Safari', () => {
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
  it('iPad (se anuncia como Mac, pero es táctil)', () => {
    expect(micSteps('mic', IPAD, false, 5)[0]).toMatch(/aA/);
  });
  it('Safari en Mac: Ajustes → Sitios web', () => {
    expect(micSteps('mic', IPAD, false, 0)[0]).toMatch(/Sitios web/);
  });
});

describe('micSteps: Chrome y otros', () => {
  it('Chrome en iPhone: permiso de Chrome en Ajustes de iOS', () => {
    const s = micSteps('mic', IPHONE_CHROME, false, 5);
    expect(s[0]).toMatch(/Apps → Chrome/);
    expect(s[2]).toMatch(/Vuelve a Chrome/);
  });
  it('Chrome en Android (navegador): icono de la dirección y permiso de Android para Chrome', () => {
    const s = micSteps('mic', ANDROID_CHROME, false, 5);
    expect(s[0]).toMatch(/izquierda de la dirección → Permisos/);
    expect(s[1]).toMatch(/Apps → Chrome → Permisos/);
  });
  it('Android con la app instalada: configuración de sitios de Chrome', () => {
    expect(micSteps('mic', ANDROID_CHROME, true, 5)[0]).toMatch(/Chrome → ⋮ → Ajustes → Configuración de sitios/);
  });
  it('Samsung Internet no se confunde con Chrome', () => {
    expect(micSteps('mic', ANDROID_SAMSUNG, false, 5)[1]).toMatch(/Samsung Internet/);
  });
  it('Chrome en Mac: permiso del sitio y de macOS para Chrome', () => {
    const s = micSteps('mic', MAC_CHROME, false, 0);
    expect(s[0]).toMatch(/izquierda de la dirección/);
    expect(s[1]).toMatch(/Privacidad y seguridad → Micrófono → activa Chrome/);
  });
  it('Chrome y Edge en Windows: permiso de Windows', () => {
    expect(micSteps('mic', WIN_CHROME, false, 0)[1]).toMatch(/Configuración de Windows/);
    expect(micSteps('mic', WIN_EDGE, false, 0)[1]).toMatch(/Configuración de Windows/);
  });
});
