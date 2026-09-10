import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isMasterKeyInitialized,
  resetMasterKeyManager,
  initializeMasterKey,
  getSecurityStatus,
} from "@/shared/security/security";

describe("Security Master Key Lifecycle (security.ts)", () => {
  beforeEach(() => {
    resetMasterKeyManager();
  });

  it("reports uninitialized by default and after reset", () => {
    expect(isMasterKeyInitialized()).toBe(false);
    expect(getSecurityStatus().state).toBe("locked");

    resetMasterKeyManager();
    expect(isMasterKeyInitialized()).toBe(false);
  });

  it("transitions to initialized after successful initializeMasterKey() and resets back", async () => {
    expect(isMasterKeyInitialized()).toBe(false);

    // Initializing with zero samples creates a new key in fallback or available provider
    await initializeMasterKey({ encryptedSamples: [], storedAccountCount: 0 });

    expect(isMasterKeyInitialized()).toBe(true);
    expect(getSecurityStatus().state).not.toBe("locked");

    resetMasterKeyManager();
    expect(isMasterKeyInitialized()).toBe(false);
    expect(getSecurityStatus().state).toBe("locked");
  });
});
