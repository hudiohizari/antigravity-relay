import { z } from 'zod';

export const LocalAccountImportORPCErrorCodeSchema = z.enum([
  'preview-failed',
  'session-not-found',
  'session-expired',
  'session-consumed',
  'background-task-not-found',
  'confirmation-failed',
  'internal-error',
]);

/** The only feature-specific data allowed across the local-import IPC boundary. */
export const LocalAccountImportORPCErrorDataSchema = z
  .object({
    localAccountImportErrorCode: LocalAccountImportORPCErrorCodeSchema,
  })
  .strip();

export type LocalAccountImportORPCErrorData = z.infer<typeof LocalAccountImportORPCErrorDataSchema>;

export function parseLocalAccountImportORPCErrorData(
  value: unknown,
): LocalAccountImportORPCErrorData | null {
  const parsed = LocalAccountImportORPCErrorDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
