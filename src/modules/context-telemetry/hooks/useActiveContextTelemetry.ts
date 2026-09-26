import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/manager";
import type { ContextTelemetryResponse } from "../ipc/router";

export interface UseActiveContextTelemetryOptions {
  target?: "app" | "ide" | "cli" | "agy";
  refetchInterval?:
    | number
    | false
    | ((query: {
        state: { data?: ContextTelemetryResponse };
      }) => number | false);
  enabled?: boolean;
}

export const CONTEXT_TELEMETRY_QUERY_KEY = ["context", "telemetry"] as const;

export function calculatePollingInterval(
  data?: ContextTelemetryResponse,
): number {
  if (data?.pollingIntervalMs) {
    return data.pollingIntervalMs;
  }
  return data?.primaryChat?.status === "running" ? 3000 : 15000;
}

export function useActiveContextTelemetry(
  options?: UseActiveContextTelemetryOptions,
) {
  const target = options?.target ?? "app";

  return useQuery<ContextTelemetryResponse>({
    queryKey: [...CONTEXT_TELEMETRY_QUERY_KEY, target],
    queryFn: async () => {
      return ipc.client.context.getActiveTelemetry({ target });
    },
    staleTime: 2000,
    refetchInterval: (query) => {
      if (options?.refetchInterval !== undefined) {
        return typeof options.refetchInterval === "function"
          ? options.refetchInterval(query as any)
          : options.refetchInterval;
      }
      return calculatePollingInterval(query.state.data);
    },
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  });
}
