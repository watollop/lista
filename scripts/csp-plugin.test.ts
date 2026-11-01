import { describe, it, expect } from 'vitest';
import { connectSrc } from './csp-plugin';

describe('connectSrc', () => {
  it("sin VITE_SUPABASE_URL solo permite 'self'", () => {
    expect(connectSrc(undefined)).toBe("'self'");
    expect(connectSrc('')).toBe("'self'");
    expect(connectSrc('   ')).toBe("'self'");
  });

  it('usa el origen exacto del proyecto, sin ruta ni barra final', () => {
    expect(connectSrc('https://abcd.supabase.co')).toBe("'self' https://abcd.supabase.co");
    expect(connectSrc('https://abcd.supabase.co/')).toBe("'self' https://abcd.supabase.co");
    expect(connectSrc('https://abcd.supabase.co/rest/v1')).toBe("'self' https://abcd.supabase.co");
  });

  it('acepta localhost y 127.0.0.1 en http para desarrollo', () => {
    expect(connectSrc('http://localhost:54321')).toBe("'self' http://localhost:54321");
    expect(connectSrc('http://127.0.0.1:54321')).toBe("'self' http://127.0.0.1:54321");
  });

  it('rechaza http en otros hosts', () => {
    expect(() => connectSrc('http://abcd.supabase.co')).toThrow(/https/);
  });

  it('rechaza URLs inválidas', () => {
    expect(() => connectSrc('abcd.supabase.co')).toThrow(/no es una URL válida/);
  });
});
