import { z } from 'zod';
import { os } from '@orpc/server';
import { AppConfigSchema } from '@/modules/config/types';
import { loadConfig, saveConfig } from '@/modules/config/ipc/handlers';

export const configRouter = os.router({
  load: os.output(AppConfigSchema).handler(async () => {
    return loadConfig();
  }),

  save: os
    .input(AppConfigSchema)
    .output(z.void())
    .handler(async ({ input }) => {
      await saveConfig(input);
    }),
});
