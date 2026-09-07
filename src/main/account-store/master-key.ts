import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = "sha256";
const APPLICATION_PEPPER = "antigravity-relay-vault-v1";

let cachedHardwareId: string | null = null;

export function getSystemHardwareId(): string {
  if (cachedHardwareId) {
    return cachedHardwareId;
  }

  const platform = os.platform();

  if (platform === "darwin") {
    try {
      const output = childProcess.execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice",
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000,
        },
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match && match[1]) {
        cachedHardwareId = match[1].trim();
        return cachedHardwareId;
      }
    } catch {
      // Fallback below
    }
  } else if (platform === "linux") {
    for (const machineIdPath of [
      "/etc/machine-id",
      "/var/lib/dbus/machine-id",
    ]) {
      try {
        if (fs.existsSync(machineIdPath)) {
          const id = fs.readFileSync(machineIdPath, "utf8").trim();
          if (id) {
            cachedHardwareId = id;
            return cachedHardwareId;
          }
        }
      } catch {
        // Fallback below
      }
    }
  } else if (platform === "win32") {
    try {
      const output = childProcess.execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000,
        },
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
      if (match && match[1]) {
        cachedHardwareId = match[1].trim();
        return cachedHardwareId;
      }
    } catch {
      // Fallback below
    }
  }

  // Fallback platform fingerprint
  const fallback = [
    os.hostname(),
    os.arch(),
    os.platform(),
    os.userInfo().username,
  ].join("|");

  cachedHardwareId = crypto.createHash("sha256").update(fallback).digest("hex");
  return cachedHardwareId;
}

export function resetHardwareIdCache(): void {
  cachedHardwareId = null;
}

export function generateSalt(length = 16): Buffer {
  return crypto.randomBytes(length);
}

export function deriveMasterKey(
  salt: Buffer,
  machineIdOverride?: string,
): Buffer {
  if (!Buffer.isBuffer(salt) || salt.length < 16) {
    throw new Error("Salt must be a Buffer of at least 16 bytes");
  }

  const machineId = machineIdOverride || getSystemHardwareId();
  const secret = `${machineId}:${APPLICATION_PEPPER}`;

  return crypto.pbkdf2Sync(
    secret,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST,
  );
}
