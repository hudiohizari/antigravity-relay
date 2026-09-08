import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { getAgentDir } from '@/shared/platform/paths';
import { logger } from '@/shared/logging/logger';

const APP_SETTINGS_FILENAME = 'manager_app_settings.json';

const AppSettingsSchema = z.record(z.string(), z.unknown());

type AppSettings = z.infer<typeof AppSettingsSchema>;

function getAppSettingsPath(): string {
  const appSettingsDir = getAgentDir();
  if (!fs.existsSync(appSettingsDir)) {
    fs.mkdirSync(appSettingsDir, { recursive: true });
  }

  return path.join(appSettingsDir, APP_SETTINGS_FILENAME);
}

function readAppSettings(): AppSettings {
  const settingsPath = getAppSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = AppSettingsSchema.safeParse(JSON.parse(content));
    if (parsed.success) {
      return parsed.data;
    }
  } catch (error) {
    logger.error('AppSettings: Failed to read app settings', error);
  }

  return {};
}

function writeAppSettings(settings: AppSettings): void {
  const settingsPath = getAppSettingsPath();
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    logger.error('AppSettings: Failed to write app settings', error);
  }
}

export function getAppSetting<TSchema extends z.ZodType>(
  key: string,
  schema: TSchema,
  fallback: z.output<TSchema>,
): z.output<TSchema> {
  const settings = readAppSettings();
  if (!(key in settings)) {
    return fallback;
  }

  const parsed = schema.safeParse(settings[key]);
  return parsed.success ? parsed.data : fallback;
}

export function setAppSetting(key: string, value: unknown): void {
  const settings = readAppSettings();
  settings[key] = value;
  writeAppSettings(settings);
}
