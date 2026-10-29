export const DEFAULT_SECONDARY_COLOR = '#db729f';

export function isSecondaryColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
}
