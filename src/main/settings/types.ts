import { z } from "zod";
import {
  AppSettings,
  OAuthSettings,
  BinaryPaths,
  NetworkSettings,
  NotificationPreferences,
  SupportedLocale,
  EncryptedFieldEnvelope,
} from "../../shared/types";

export type {
  AppSettings,
  OAuthSettings,
  BinaryPaths,
  NetworkSettings,
  NotificationPreferences,
  SupportedLocale,
  EncryptedFieldEnvelope,
};

export const OAuthSettingsSchema = z.object({
  clientId: z.string().min(1, "OAuth Client ID is required"),
  clientSecret: z.string().optional(),
  isCustom: z.boolean().default(false),
});

export const BinaryPathsSchema = z.object({
  agyDaemonPath: z.string().min(1, "AGY daemon path is required"),
  ideExecutablePath: z.string().min(1, "IDE executable path is required"),
  autoDetected: z.boolean().default(true),
});

export const NetworkSettingsSchema = z.object({
  relayPort: z
    .number()
    .int()
    .min(1, "Port must be at least 1")
    .max(65535, "Port must not exceed 65535")
    .default(4040),
  relayHost: z.string().min(1, "Relay host is required").default("127.0.0.1"),
  cloudflareNamedToken: z.string().optional(),
  tunnelToken: z.string().optional(),
});

export const NotificationPreferencesSchema = z.object({
  enabled: z.boolean().default(true),
  notifyOnAutoSwitch: z.boolean().default(true),
  notifyOnRateLimit: z.boolean().default(true),
  notifyOnProcessCrash: z.boolean().default(true),
  debounceMs: z.number().int().min(0).default(5000),
});

export const AppSettingsSchema = z.object({
  version: z.literal(1).default(1),
  theme: z.enum(["dark", "light", "system"]).default("system"),
  locale: z.enum(["en", "id"]).default("en"),
  launchOnStartup: z.boolean().default(false),
  minimizeToTrayOnClose: z.boolean().default(true),
  oauth: OAuthSettingsSchema,
  binaryPaths: BinaryPathsSchema,
  network: NetworkSettingsSchema,
  notifications: NotificationPreferencesSchema,
  updatedAt: z.number().default(0),
});

export const PartialAppSettingsSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  locale: z.enum(["en", "id"]).optional(),
  launchOnStartup: z.boolean().optional(),
  minimizeToTrayOnClose: z.boolean().optional(),
  oauth: OAuthSettingsSchema.partial().optional(),
  binaryPaths: BinaryPathsSchema.partial().optional(),
  network: NetworkSettingsSchema.partial().optional(),
  notifications: NotificationPreferencesSchema.partial().optional(),
});

export type PartialAppSettings = z.infer<typeof PartialAppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  theme: "system",
  locale: "en",
  launchOnStartup: false,
  minimizeToTrayOnClose: true,
  oauth: {
    clientId:
      process.env.GOOGLE_CLIENT_ID ||
      "antigravity-relay.apps.googleusercontent.com",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    isCustom: false,
  },
  binaryPaths: {
    agyDaemonPath: "agy",
    ideExecutablePath: "/Applications/Antigravity.app",
    autoDetected: true,
  },
  network: {
    relayPort: 4040,
    relayHost: "127.0.0.1",
    cloudflareNamedToken: "",
  },
  notifications: {
    enabled: true,
    notifyOnAutoSwitch: true,
    notifyOnRateLimit: true,
    notifyOnProcessCrash: true,
    debounceMs: 5000,
  },
  updatedAt: 0,
};

export interface PersistedSettingsData {
  version: 1;
  theme: "dark" | "light" | "system";
  locale: SupportedLocale;
  launchOnStartup: boolean;
  minimizeToTrayOnClose: boolean;
  oauth: {
    clientId: string;
    clientSecret?: string | EncryptedFieldEnvelope;
    isCustom: boolean;
  };
  binaryPaths: BinaryPaths;
  network: {
    relayPort: number;
    relayHost: string;
    cloudflareNamedToken?: string | EncryptedFieldEnvelope;
    tunnelToken?: string | EncryptedFieldEnvelope;
  };
  notifications: NotificationPreferences;
  updatedAt: number;
}
