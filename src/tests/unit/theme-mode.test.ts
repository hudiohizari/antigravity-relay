import { describe, expect, it } from 'vitest';
import { parseThemeMode } from '@/modules/app-shell/types/theme-mode';

describe('parseThemeMode', () => {
  it.each(['dark', 'light', 'system'])('accepts the supported %s theme mode', (value) => {
    expect(parseThemeMode(value)).toBe(value);
  });

  it.each([null, 'contrast', { mode: 'dark' }])('rejects persisted invalid values', (value) => {
    expect(parseThemeMode(value)).toBeNull();
  });
});
