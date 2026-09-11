import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import findProcess from "find-process";
import psList from "ps-list";

const WINDOWS_PROCESS_COMMAND_TIMEOUT_MS = 3000;
const WINDOWS_SYSTEM_ROOT =
  process.env.SystemRoot && path.win32.isAbsolute(process.env.SystemRoot)
    ? process.env.SystemRoot
    : "C:\\Windows";
const WINDOWS_TASKKILL_PATH = path.win32.join(
  WINDOWS_SYSTEM_ROOT,
  "System32",
  "taskkill.exe",
);
const execFileAsync = promisify(execFile);
const runningImageProcessQueries = new Map<
  string,
  Promise<WindowsProcessInfo[] | null>
>();

export interface WindowsProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cmd?: string;
}

export function isSafeWindowsImageName(imageName: string): boolean {
  if (
    imageName !== imageName.trim() ||
    imageName !== path.win32.basename(imageName) ||
    imageName.length <= ".exe".length ||
    !imageName.toLowerCase().endsWith(".exe")
  ) {
    return false;
  }

  return !Array.from(imageName).some(
    (character) =>
      character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character),
  );
}

/**
 * Keep status polling off Electron's main event loop and reuse an in-flight query when rapid UI
 * mounts request the same image before the process scan has returned.
 */
export function getRunningWindowsImageProcesses(
  imageName: string,
): Promise<WindowsProcessInfo[] | null> {
  const queryKey = imageName.toLowerCase();
  const activeQuery = runningImageProcessQueries.get(queryKey);
  if (activeQuery) {
    return activeQuery;
  }

  const query = queryWindowsProcessesByImageName(imageName).finally(() => {
    runningImageProcessQueries.delete(queryKey);
  });
  runningImageProcessQueries.set(queryKey, query);
  return query;
}

export async function isWindowsImageRunning(
  imageName: string,
): Promise<boolean | null> {
  const processes = await getRunningWindowsImageProcesses(imageName);
  return processes ? processes.length > 0 : null;
}

export async function killWindowsImageTree(
  imageName: string,
): Promise<boolean> {
  if (!isSafeWindowsImageName(imageName)) {
    throw new Error(`Invalid Windows executable image name: ${imageName}`);
  }

  const processes = await queryWindowsProcessesByImageName(imageName);
  if (!processes) {
    return false;
  }
  if (processes.length === 0) {
    return true;
  }

  const targetPids = new Set(processes.map((processItem) => processItem.pid));
  const rootProcesses = processes.filter(
    (processItem) => !targetPids.has(processItem.ppid),
  );

  for (const processItem of rootProcesses) {
    try {
      await execFileAsync(
        WINDOWS_TASKKILL_PATH,
        ["/F", "/T", "/PID", String(processItem.pid)],
        {
          encoding: "utf-8",
          maxBuffer: 64 * 1024,
          shell: false,
          timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
          windowsHide: true,
        },
      );
    } catch {
      // A process may exit between enumeration and taskkill. The fresh query below is authoritative.
    }
  }

  const remainingProcesses = await queryWindowsProcessesByImageName(imageName);
  return remainingProcesses !== null && remainingProcesses.length === 0;
}

export async function queryWindowsProcessesByImageName(
  imageName: string,
): Promise<WindowsProcessInfo[] | null> {
  if (!isSafeWindowsImageName(imageName)) {
    throw new Error(`Invalid Windows executable image name: ${imageName}`);
  }

  try {
    const normalizedImageName = imageName.toLowerCase();
    const processes =
      process.arch === "arm64"
        ? await findProcess("name", imageName, { strict: true })
        : await psList();
    return processes
      .filter(
        (processItem) =>
          Number.isSafeInteger(processItem.pid) &&
          processItem.pid > 0 &&
          processItem.name.toLowerCase() === normalizedImageName,
      )
      .map((processItem) => {
        const rawCmd = (processItem as { cmd?: unknown }).cmd;
        const cmd =
          typeof rawCmd === "string" && rawCmd.trim().length > 0
            ? rawCmd
            : undefined;
        return {
          pid: processItem.pid,
          ppid:
            Number.isSafeInteger(processItem.ppid) && processItem.ppid >= 0
              ? processItem.ppid
              : 0,
          name: processItem.name,
          ...(cmd ? { cmd } : {}),
        };
      });
  } catch {
    return null;
  }
}
