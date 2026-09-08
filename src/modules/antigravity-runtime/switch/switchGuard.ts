import { logger } from '@/shared/logging/logger';

type SwitchOwner = 'local-account-switch' | 'cloud-account-switch';

interface SwitchTask {
  owner: SwitchOwner;
  action: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

let activeSwitchOwner: SwitchOwner | null = null;
const pendingQueue: SwitchTask[] = [];
let processing = false;

function processQueue(): void {
  if (processing) {
    return;
  }

  const nextTask = pendingQueue.shift();
  if (!nextTask) {
    return;
  }

  processing = true;
  activeSwitchOwner = nextTask.owner;
  logger.info(`Acquired switch guard: ${nextTask.owner}`);

  Promise.resolve()
    .then(nextTask.action)
    .then((result) => {
      nextTask.resolve(result);
    })
    .catch((error) => {
      nextTask.reject(error);
    })
    .finally(() => {
      logger.info(`Released switch guard: ${nextTask.owner}`);
      activeSwitchOwner = null;
      processing = false;
      processQueue();
    });
}

export async function runWithSwitchGuard<T>(
  owner: SwitchOwner,
  action: () => Promise<T>,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    pendingQueue.push({
      owner,
      action: async () => await action(),
      resolve: (value) => {
        resolve(value as T);
      },
      reject,
    });
    logger.info(
      `Queued switch request: ${owner} (active=${activeSwitchOwner || 'none'}, pending=${pendingQueue.length})`,
    );
    processQueue();
  });
}

export function getActiveSwitchOwner(): SwitchOwner | null {
  return activeSwitchOwner;
}

export function getSwitchGuardSnapshot(): {
  activeOwner: SwitchOwner | null;
  pendingOwners: SwitchOwner[];
  pendingCount: number;
} {
  return {
    activeOwner: activeSwitchOwner,
    pendingOwners: pendingQueue.map((item) => item.owner),
    pendingCount: pendingQueue.length,
  };
}
