import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AntigravityDatabaseDiscoverySource } from "@/modules/cloud-account/local-import/sources/antigravity-database.source";
import { AntigravityKeyringDiscoverySource } from "@/modules/cloud-account/local-import/sources/antigravity-keyring.source";
import { LegacyAgentDiscoverySource } from "@/modules/cloud-account/local-import/sources/legacy-agent.source";
import { AntigravityCliDiscoverySource } from "@/modules/cloud-account/local-import/sources/antigravity-cli.source";
import { LocalAccountDiscoveryService } from "@/modules/cloud-account/local-import/local-account-discovery.service";
import { ProtobufUtils } from "@/shared/serialization/protobuf";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "antigravity-local-discovery-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AntigravityKeyringDiscoverySource", () => {
  it("returns a typed missing result when no system credential exists", async () => {
    const source = new AntigravityKeyringDiscoverySource({
      readCredential: () => null,
    });

    await expect(source.discover()).resolves.toEqual({
      candidates: [],
      failures: [
        {
          source: { id: "antigravity-keyring" },
          code: "missing",
          message: "The local credential source was not found.",
        },
      ],
      inspectedLocations: 1,
    });
  });

  it("converts the system credential into a read-only candidate", async () => {
    const source = new AntigravityKeyringDiscoverySource({
      readCredential: () => ({
        accessToken: "keyring-access",
        refreshToken: "keyring-refresh",
        projectId: "keyring-project",
        expiryTimestamp: 1_800_000_000,
      }),
    });

    await expect(source.discover()).resolves.toEqual({
      candidates: [
        {
          source: { id: "antigravity-keyring" },
          credential: {
            accessToken: "keyring-access",
            refreshToken: "keyring-refresh",
            projectId: "keyring-project",
            expiryTimestamp: 1_800_000_000,
          },
        },
      ],
      failures: [],
      inspectedLocations: 1,
    });
  });
});

describe("AntigravityDatabaseDiscoverySource", () => {
  it("reads every existing database path instead of stopping after the first token", async () => {
    const readTokenInfoFromPath = vi
      .fn()
      .mockReturnValueOnce({
        accessToken: "access-a",
        refreshToken: "refresh-a",
      })
      .mockReturnValueOnce({
        accessToken: "access-b",
        refreshToken: "refresh-b",
      });
    const source = new AntigravityDatabaseDiscoverySource("classic", {
      existsSync: () => true,
      getDbPaths: () => ["first.vscdb", "second.vscdb"],
      readTokenInfoFromPath,
    });

    const result = await source.discover();

    expect(readTokenInfoFromPath).toHaveBeenCalledTimes(2);
    expect(result.candidates).toEqual([
      {
        source: { id: "antigravity-classic-db", location: "first.vscdb" },
        credential: {
          accessToken: "access-a",
          refreshToken: "refresh-a",
        },
      },
      {
        source: { id: "antigravity-classic-db", location: "second.vscdb" },
        credential: {
          accessToken: "access-b",
          refreshToken: "refresh-b",
        },
      },
    ]);
  });

  it("records a damaged database and continues with the remaining paths", async () => {
    const leakedToken = "refresh-token-must-not-leak";
    const readTokenInfoFromPath = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error(`SQLITE_CORRUPT ${leakedToken}`);
      })
      .mockReturnValueOnce({
        accessToken: "access-b",
        refreshToken: "refresh-b",
      });
    const source = new AntigravityDatabaseDiscoverySource("ide", {
      existsSync: () => true,
      getDbPaths: () => ["damaged.vscdb", "healthy.vscdb"],
      readTokenInfoFromPath,
    });

    const result = await source.discover();

    expect(result.candidates).toHaveLength(1);
    expect(result.failures).toEqual([
      {
        source: { id: "antigravity-ide-db", location: "damaged.vscdb" },
        code: "malformed",
        message: "The local credential data is malformed.",
      },
    ]);
    expect(JSON.stringify(result.failures)).not.toContain(leakedToken);
  });

  it("discovers classic and IDE databases in one session and deduplicates their token", async () => {
    const dependencies = {
      existsSync: () => true,
      getDbPaths: (target: "classic" | "ide") => [`${target}.vscdb`],
      readTokenInfoFromPath: () => ({
        accessToken: "shared-access",
        refreshToken: "shared-refresh",
      }),
    };
    const service = new LocalAccountDiscoveryService({
      digestKey: Buffer.alloc(32, 11),
      sources: [
        new AntigravityDatabaseDiscoverySource("classic", dependencies),
        new AntigravityDatabaseDiscoverySource("ide", dependencies),
      ],
    });

    const session = await service.discover();

    expect(session.result.accounts).toHaveLength(1);
    expect(session.result.duplicateCount).toBe(1);
    expect(session.result.accounts[0].sources).toEqual([
      { id: "antigravity-classic-db", location: "classic.vscdb" },
      { id: "antigravity-ide-db", location: "ide.vscdb" },
    ]);
  });
});

describe("LegacyAgentDiscoverySource", () => {
  it("discovers direct token backups without writing or validating accounts", async () => {
    const agentDir = createTemporaryDirectory();
    fs.mkdirSync(path.join(agentDir, "backups"));
    fs.writeFileSync(
      path.join(agentDir, "antigravity_accounts.json"),
      JSON.stringify({
        accounts: {
          "account-a": {
            email: "legacy@example.com",
            backup_file: "account-a.json",
          },
        },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(agentDir, "backups", "account-a.json"),
      JSON.stringify({
        token: {
          access_token: "legacy-access",
          refresh_token: "legacy-refresh",
          project_id: "legacy-project",
          expiry_timestamp: 1_800_000_000,
        },
      }),
      "utf-8",
    );
    const source = new LegacyAgentDiscoverySource({ agentDir });

    const result = await source.discover();

    expect(result.candidates).toEqual([
      {
        source: {
          id: "legacy-agent",
          location: path.join(agentDir, "backups", "account-a.json"),
        },
        credential: {
          accessToken: "legacy-access",
          refreshToken: "legacy-refresh",
          projectId: "legacy-project",
          expiryTimestamp: 1_800_000_000,
        },
        emailHint: "legacy@example.com",
      },
    ]);
    expect(result.failures).toEqual([]);
  });

  it("supports protobuf backups and does not emit Unknown as an email hint", async () => {
    const agentDir = createTemporaryDirectory();
    fs.writeFileSync(
      path.join(agentDir, "accounts.json"),
      JSON.stringify({
        accountA: {
          email: "Unknown",
          data_file: "account-a.json",
        },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(agentDir, "account-a.json"),
      JSON.stringify({
        data: {
          "jetskiStateSync.agentManagerInitState":
            Buffer.from("protobuf-state").toString("base64"),
        },
      }),
      "utf-8",
    );
    vi.spyOn(ProtobufUtils, "extractOAuthTokenInfo").mockReturnValue({
      accessToken: "protobuf-access",
      refreshToken: "protobuf-refresh",
      idToken: "protobuf-id",
    });
    const source = new LegacyAgentDiscoverySource({ agentDir });

    const result = await source.discover();

    expect(result.candidates).toEqual([
      {
        source: {
          id: "legacy-agent",
          location: path.join(agentDir, "account-a.json"),
        },
        credential: {
          accessToken: "protobuf-access",
          refreshToken: "protobuf-refresh",
          idToken: "protobuf-id",
        },
      },
    ]);
  });

  it("keeps a valid legacy account when another backup is malformed", async () => {
    const agentDir = createTemporaryDirectory();
    fs.writeFileSync(
      path.join(agentDir, "accounts.json"),
      JSON.stringify({
        broken: {
          email: "broken@example.com",
          data_file: "broken.json",
        },
        healthy: {
          email: "healthy@example.com",
          data_file: "healthy.json",
        },
      }),
      "utf-8",
    );
    fs.writeFileSync(path.join(agentDir, "broken.json"), "{malformed", "utf-8");
    fs.writeFileSync(
      path.join(agentDir, "healthy.json"),
      JSON.stringify({
        token: {
          refresh_token: "healthy-refresh",
        },
      }),
      "utf-8",
    );
    const source = new LegacyAgentDiscoverySource({ agentDir });

    const result = await source.discover();

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].emailHint).toBe("healthy@example.com");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      source: {
        id: "legacy-agent",
        location: path.join(agentDir, "broken.json"),
      },
      code: "malformed",
    });
  });

  it("does not follow a legacy backup path outside the agent directory", async () => {
    const agentDir = createTemporaryDirectory();
    const externalDir = createTemporaryDirectory();
    const externalBackup = path.join(externalDir, "external.json");
    fs.writeFileSync(
      externalBackup,
      JSON.stringify({
        token: {
          refresh_token: "external-refresh",
        },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(agentDir, "accounts.json"),
      JSON.stringify({
        external: {
          email: "external@example.com",
          data_file: externalBackup,
        },
      }),
      "utf-8",
    );
    const source = new LegacyAgentDiscoverySource({ agentDir });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].code).toBe("missing");
  });
});

describe("AntigravityCliDiscoverySource", () => {
  it("discovers valid CLI candidate token without requiring executable in PATH", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: (p) => p === tokenPath,
      statSync: () => ({ size: 256 }),
      readFileSync: () =>
        JSON.stringify({
          token: {
            access_token: "cli-access",
            refresh_token: "cli-refresh",
            id_token: "cli-id",
            project_id: "cli-project",
            expiry_timestamp: 1_800_000_000,
          },
        }),
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([
      {
        source: {
          id: "antigravity-cli-token",
          location: tokenPath,
        },
        credential: {
          accessToken: "cli-access",
          refreshToken: "cli-refresh",
          idToken: "cli-id",
          projectId: "cli-project",
          expiryTimestamp: 1_800_000_000,
        },
      },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.inspectedLocations).toBe(1);
  });

  it("reports missing failure when no CLI token files exist on disk", async () => {
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [
        "/home/user/.gemini/antigravity-cli/antigravity-oauth-token",
      ],
      existsSync: () => false,
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      {
        source: { id: "antigravity-cli-token" },
        code: "missing",
        message: "The local credential source was not found.",
      },
    ]);
    expect(result.inspectedLocations).toBe(1);
  });

  it("rejects token file exceeding 64KB with malformed error", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: () => true,
      statSync: () => ({ size: 65 * 1024 }),
      readFileSync: () => '{"token":{"refresh_token":"abc"}}',
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      {
        source: {
          id: "antigravity-cli-token",
          location: tokenPath,
        },
        code: "malformed",
        message: "The local credential data is malformed.",
      },
    ]);
  });

  it("rejects 0-byte token file as malformed", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: () => true,
      statSync: () => ({ size: 0 }),
      readFileSync: () => "",
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      {
        source: {
          id: "antigravity-cli-token",
          location: tokenPath,
        },
        code: "malformed",
        message: "The local credential data is malformed.",
      },
    ]);
  });

  it("rejects truncated/corrupt JSON as malformed", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: () => true,
      statSync: () => ({ size: 50 }),
      readFileSync: () => '{"token":{"refresh_token":',
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures[0]).toMatchObject({
      source: {
        id: "antigravity-cli-token",
        location: tokenPath,
      },
      code: "malformed",
    });
  });

  it("rejects payload missing refresh_token as malformed", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: () => true,
      statSync: () => ({ size: 50 }),
      readFileSync: () => '{"token":{"access_token":"only-access"}}',
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures[0]).toMatchObject({
      source: {
        id: "antigravity-cli-token",
        location: tokenPath,
      },
      code: "malformed",
    });
  });

  it("reports permission-denied when reading token file fails with EACCES", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: () => true,
      statSync: () => {
        const error = new Error("permission denied");
        (error as { code?: string }).code = "EACCES";
        throw error;
      },
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      {
        source: {
          id: "antigravity-cli-token",
          location: tokenPath,
        },
        code: "permission-denied",
        message: "The local credential source denied access.",
      },
    ]);
  });

  it("omits accessToken from candidate when empty or undefined", async () => {
    const tokenPath =
      "/home/user/.gemini/antigravity-cli/antigravity-oauth-token";
    const source = new AntigravityCliDiscoverySource({
      getCandidatePaths: () => [tokenPath],
      existsSync: () => true,
      statSync: () => ({ size: 100 }),
      readFileSync: () =>
        JSON.stringify({
          token: {
            access_token: "",
            refresh_token: "valid-refresh-only",
          },
        }),
    });

    const result = await source.discover();

    expect(result.candidates).toEqual([
      {
        source: {
          id: "antigravity-cli-token",
          location: tokenPath,
        },
        credential: {
          refreshToken: "valid-refresh-only",
        },
      },
    ]);
    expect(result.candidates[0].credential.accessToken).toBeUndefined();
  });
});
