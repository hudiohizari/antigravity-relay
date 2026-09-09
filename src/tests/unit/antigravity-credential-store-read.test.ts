import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSecret: vi.fn(),
  spawnSync: vi.fn(),
  withTarget: vi.fn(),
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: {
    withTarget: mocks.withTarget,
  },
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const execFileSync = vi.fn();
  return {
    ...actual,
    default: {
      ...actual,
      execFileSync,
      spawnSync: mocks.spawnSync,
    },
    execFileSync,
    spawnSync: mocks.spawnSync,
  };
});

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

describe("readAntigravityCredentialStoreToken", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSecret.mockReset();
    mocks.spawnSync.mockReset();
    mocks.withTarget.mockReset();
    mocks.withTarget.mockReturnValue({
      getSecret: mocks.getSecret,
    });
    setPlatform("win32");
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("parses the nested credential payload from native keyring bytes", async () => {
    mocks.getSecret.mockReturnValue(
      Array.from(
        Buffer.from(
          JSON.stringify({
            token: {
              access_token: "access-nested",
              refresh_token: "refresh-nested",
              id_token: "id-nested",
            },
          }),
          "utf-8",
        ),
      ),
    );
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toEqual({
      accessToken: "access-nested",
      refreshToken: "refresh-nested",
      idToken: "id-nested",
    });
  });

  it("parses the compatible top-level refresh token payload", async () => {
    mocks.getSecret.mockReturnValue(
      Array.from(
        Buffer.from(
          JSON.stringify({
            access_token: "access-top-level",
            refresh_token: "refresh-top-level",
            project_id: "project-top-level",
          }),
          "utf-8",
        ),
      ),
    );
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toEqual({
      accessToken: "access-top-level",
      refreshToken: "refresh-top-level",
      projectId: "project-top-level",
    });
  });

  it("decodes a macOS go-keyring-base64 payload", async () => {
    setPlatform("darwin");
    const payload = JSON.stringify({
      token: {
        refresh_token: "refresh-macos",
      },
    });
    mocks.getSecret.mockReturnValue(
      Array.from(
        Buffer.from(
          `go-keyring-base64:${Buffer.from(payload, "utf-8").toString("base64")}`,
        ),
      ),
    );
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toEqual({
      refreshToken: "refresh-macos",
    });
  });

  it("uses the bounded Linux secret-tool fallback after native keyring failure", async () => {
    setPlatform("linux");
    mocks.getSecret.mockImplementation(() => {
      throw new Error("native backend unavailable");
    });
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify({
        token: {
          refresh_token: "refresh-linux",
        },
      }),
      stderr: "",
    });
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toEqual({
      refreshToken: "refresh-linux",
    });
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "secret-tool",
      ["lookup", "service", "gemini", "username", "antigravity"],
      expect.objectContaining({
        encoding: "utf-8",
        timeout: 10_000,
      }),
    );
  });

  it("returns a typed timeout error without leaking the credential output", async () => {
    setPlatform("linux");
    mocks.getSecret.mockImplementation(() => {
      throw new Error("native backend unavailable");
    });
    mocks.spawnSync.mockReturnValue({
      error: Object.assign(new Error("timed out with refresh-secret-leak"), {
        code: "ETIMEDOUT",
      }),
      status: null,
      stdout: "",
      stderr: "refresh-secret-leak",
    });
    const { CredentialStoreReadError, readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      CredentialStoreReadError,
    );
    try {
      readAntigravityCredentialStoreToken();
    } catch (error) {
      expect(error).toMatchObject({
        code: "timed-out",
        message: "Timed out while reading the Antigravity credential store.",
      });
      expect(String(error)).not.toContain("refresh-secret-leak");
    }
  });

  it("classifies native permission errors without leaking their message", async () => {
    mocks.getSecret.mockImplementation(() => {
      throw Object.assign(
        new Error("permission denied for refresh-secret-leak"),
        {
          code: "EACCES",
        },
      );
    });
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    try {
      readAntigravityCredentialStoreToken();
      expect.unreachable("Expected the credential read to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "permission-denied",
        message:
          "Permission was denied while reading the Antigravity credential store.",
      });
      expect(String(error)).not.toContain("refresh-secret-leak");
    }
  });

  it("reports a missing Linux secret-tool fallback as unavailable", async () => {
    setPlatform("linux");
    mocks.getSecret.mockImplementation(() => {
      throw new Error("native backend unavailable");
    });
    mocks.spawnSync.mockReturnValue({
      error: Object.assign(new Error("spawn secret-tool ENOENT"), {
        code: "ENOENT",
      }),
      status: null,
      stdout: "",
      stderr: "",
    });
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      "The Antigravity credential store is unavailable.",
    );
  });

  it("rejects malformed payloads without including their contents in the error", async () => {
    const malformedPayload = '{"refresh_token":"refresh-secret-leak"';
    mocks.getSecret.mockReturnValue(
      Array.from(Buffer.from(malformedPayload, "utf-8")),
    );
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      "The Antigravity credential payload is malformed.",
    );
    try {
      readAntigravityCredentialStoreToken();
    } catch (error) {
      expect(String(error)).not.toContain("refresh-secret-leak");
    }
  });

  it("reads macOS keychain via /usr/bin/security subprocess", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify({
        token: {
          access_token: "access-macos-security",
          refresh_token: "refresh-macos-security",
        },
      }),
      stderr: "",
    });
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toEqual({
      accessToken: "access-macos-security",
      refreshToken: "refresh-macos-security",
    });
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "/usr/bin/security",
      ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"],
      expect.objectContaining({
        encoding: "utf-8",
        shell: false,
        timeout: 5000,
        killSignal: "SIGKILL",
      }),
    );
  });

  it("returns null when macOS /usr/bin/security returns status 44", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      status: 44,
      stdout: "",
      stderr:
        "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n",
    });
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toBeNull();
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it("throws permission-denied when macOS /usr/bin/security returns status 128", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      status: 128,
      stdout: "",
      stderr:
        "security: SecKeychainItemCopyAttributesAndData: User canceled the operation.\n",
    });
    const { CredentialStoreReadError, readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      CredentialStoreReadError,
    );
    try {
      readAntigravityCredentialStoreToken();
    } catch (error) {
      expect(error).toMatchObject({
        code: "permission-denied",
      });
    }
  });

  it("throws permission-denied when macOS /usr/bin/security reports user interaction not allowed", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      status: 1,
      stdout: "",
      stderr:
        "security: SecKeychainItemCopyAttributesAndData: User interaction is not allowed.\n",
    });
    const { CredentialStoreReadError, readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      CredentialStoreReadError,
    );
    try {
      readAntigravityCredentialStoreToken();
    } catch (error) {
      expect(error).toMatchObject({
        code: "permission-denied",
      });
    }
  });

  it("throws locked when macOS /usr/bin/security reports keychain is locked", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      status: 1,
      stdout: "",
      stderr:
        "security: SecKeychainItemCopyAttributesAndData: The specified keychain is locked.\n",
    });
    const { CredentialStoreReadError, readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      CredentialStoreReadError,
    );
    try {
      readAntigravityCredentialStoreToken();
    } catch (error) {
      expect(error).toMatchObject({
        code: "locked",
      });
    }
  });

  it("throws timed-out when macOS /usr/bin/security times out without leaking secrets", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: Object.assign(new Error("timed out with secret-macos-token"), {
        code: "ETIMEDOUT",
      }),
      status: null,
      stdout: "",
      stderr: "secret-macos-token",
    });
    const { CredentialStoreReadError, readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(() => readAntigravityCredentialStoreToken()).toThrow(
      CredentialStoreReadError,
    );
    try {
      readAntigravityCredentialStoreToken();
    } catch (error) {
      expect(error).toMatchObject({
        code: "timed-out",
      });
      expect(String(error)).not.toContain("secret-macos-token");
    }
  });

  it("falls back to native keyring when macOS /usr/bin/security is unavailable", async () => {
    setPlatform("darwin");
    mocks.spawnSync.mockReturnValue({
      error: Object.assign(new Error("spawn /usr/bin/security ENOENT"), {
        code: "ENOENT",
      }),
      status: null,
      stdout: "",
      stderr: "",
    });
    const payload = JSON.stringify({
      token: {
        refresh_token: "refresh-macos-fallback",
      },
    });
    mocks.getSecret.mockReturnValue(Array.from(Buffer.from(payload, "utf-8")));
    const { readAntigravityCredentialStoreToken } =
      await import("@/modules/cloud-account/persistence/antigravityCredentialStore");

    expect(readAntigravityCredentialStoreToken()).toEqual({
      refreshToken: "refresh-macos-fallback",
    });
    expect(mocks.getSecret).toHaveBeenCalledTimes(1);
  });
});
