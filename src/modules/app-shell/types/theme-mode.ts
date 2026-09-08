import { z } from 'zod';

export const ThemeModeSchema = z.enum(['dark', 'light', 'system']);

export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export function parseThemeMode(value: unknown): ThemeMode | null {
  const parsed = ThemeModeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
