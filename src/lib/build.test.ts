import { describe, expect, it } from 'vitest';
import { buildLabel } from './build';

describe('buildLabel', () => {
  it('une versión, fecha y commit', () => {
    const label = buildLabel({ version: '1.0.0', time: '2026-11-03T08:51:00Z', commit: 'a1b2c3d' }, 'es');
    expect(label).toMatch(/^v1\.0\.0 · .*2026.* · a1b2c3d$/);
  });
  it('omite lo que falta', () => {
    expect(buildLabel({ version: '1.0.0', time: '', commit: '' }, 'es')).toBe('v1.0.0');
    expect(buildLabel({ version: '', time: 'no', commit: 'abc' }, 'es')).toBe('abc');
  });
});
