import { os } from "@orpc/server";
import { z } from "zod";
import { networkInterfaces, NetworkInterfaceInfo } from "os";
import { dialog, shell } from "electron";
import {
  getAgentDir,
  getAntigravityLaunchArgsFromRunningProcess,
  getRunningAntigravityProcesses,
  refreshAntigravityProcessCache,
} from "@/shared/platform/paths";
import {
  AntigravityAppTargetSchema,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";

import {
  IpInfo,
  isRfc1918Address,
  isVirtualAdapter,
  isLanInterfaceName,
  resolveLocalIps,
  getRecommendedLocalIp,
} from "@/shared/platform/network";

export {
  isRfc1918Address,
  isVirtualAdapter,
  isLanInterfaceName,
  resolveLocalIps,
  getRecommendedLocalIp,
};

// Schema for IP info
export const IpInfoSchema = z.object({
  address: z.string(),
  name: z.string(),
  isRecommended: z.boolean(),
});

export type { IpInfo };

export const systemHandler = os.router({
  // Get all available local IPs with their adapter names
  get_local_ips: os.output(z.array(IpInfoSchema)).handler(async () => {
    return resolveLocalIps(networkInterfaces());
  }),

  // Open log directory in file explorer
  openLogDirectory: os.output(z.void()).handler(async () => {
    const logDir = getAgentDir();
    await shell.openPath(logDir);
  }),

  selectAntigravityExecutable: os
    .input(
      z.object({ target: AntigravityAppTargetSchema.optional() }).optional(),
    )
    .output(z.string().nullable())
    .handler(async ({ input }) => {
      const target = resolveAntigravityAppTarget(input?.target);
      const appName =
        target === "ide"
          ? "Antigravity IDE"
          : target === "cli"
            ? "Antigravity CLI (agy)"
            : "Antigravity";
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "showHiddenFiles"],
        filters: [
          {
            name: `${appName} executable`,
            extensions:
              process.platform === "win32" ? ["exe", "cmd", "bat"] : ["*"],
          },
        ],
      });

      return result.canceled ? null : result.filePaths[0] || null;
    }),

  getAntigravityArgs: os
    .input(
      z.object({ target: AntigravityAppTargetSchema.optional() }).optional(),
    )
    .output(
      z.object({
        running: z.boolean(),
        args: z.array(z.string()),
      }),
    )
    .handler(async ({ input }) => {
      const target = resolveAntigravityAppTarget(input?.target);
      await refreshAntigravityProcessCache(target);
      const runningProcesses = getRunningAntigravityProcesses(target);
      return {
        running: runningProcesses.length > 0,
        args: getAntigravityLaunchArgsFromRunningProcess(target),
      };
    }),
});
