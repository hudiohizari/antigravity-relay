import axios from 'axios';

export interface ViteServerWaitOptions {
  delayMs?: number;
  maxRetries?: number;
  request?: (url: string) => Promise<{ status: number }>;
}

async function requestViteDevServer(url: string): Promise<{ status: number }> {
  const response = await axios.get(url, {
    // Native fetch resolves for non-2xx responses; retain that retry behavior.
    validateStatus: () => true,
  });
  return { status: response.status };
}

export async function waitForViteDevServer(
  url: string,
  { delayMs = 500, maxRetries = 30, request = requestViteDevServer }: ViteServerWaitOptions = {},
): Promise<number | null> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await request(url);
      if (response.status >= 200 && response.status < 300) {
        return attempt * delayMs;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}
