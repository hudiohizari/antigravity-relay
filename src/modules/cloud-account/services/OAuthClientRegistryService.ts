import { isEmpty, isString } from "lodash-es";
import { logger } from "@/shared/logging/logger";

const OAUTH_CLIENTS_ENV = "ANTIGRAVITY_OAUTH_CLIENTS";
const ACTIVE_OAUTH_CLIENT_ENV = "ANTIGRAVITY_OAUTH_CLIENT_KEY";
const DEFAULT_OAUTH_CLIENT_KEY = "antigravity_enterprise";

export interface OAuthClientConfig {
  key: string;
  label: string;
  client_id: string;
  client_secret: string;
  is_builtin: boolean;
}

interface OAuthClientRegistry {
  clients: OAuthClientConfig[];
  activeKey: string;
}

export interface OAuthClientDescriptor {
  key: string;
  label: string;
  client_id: string;
  is_active: boolean;
  is_builtin: boolean;
  is_configured: boolean;
}

let cachedOAuthClientRegistry: OAuthClientRegistry | null = null;

export function resetRegistryCache(): void {
  cachedOAuthClientRegistry = null;
}

export function normalizeOAuthClientKey(key: string): string {
  return key.trim().toLowerCase();
}

function isConfiguredClient(
  client: OAuthClientConfig | null | undefined,
): boolean {
  if (!client) {
    return false;
  }
  return client.client_id.trim() !== "" && client.client_secret.trim() !== "";
}

function getClientByKey(
  clients: OAuthClientConfig[],
  clientKey: string | undefined,
): OAuthClientConfig | null {
  if (!clientKey) {
    return null;
  }
  const normalizedKey = normalizeOAuthClientKey(clientKey);
  return clients.find((client) => client.key === normalizedKey) ?? null;
}

function buildOAuthClientRegistry(): OAuthClientRegistry {
  const enterpriseClientId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "";
  const enterpriseClientSecret =
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || "";

  const clients: OAuthClientConfig[] = [
    {
      key: normalizeOAuthClientKey(DEFAULT_OAUTH_CLIENT_KEY),
      label: "Antigravity Enterprise",
      client_id: enterpriseClientId,
      client_secret: enterpriseClientSecret,
      is_builtin: true,
    },
  ];

  const rawExtraClients = process.env[OAUTH_CLIENTS_ENV];
  if (isString(rawExtraClients) && !isEmpty(rawExtraClients.trim())) {
    for (const entry of rawExtraClients.split(";")) {
      const trimmed = entry.trim();
      if (trimmed === "") {
        continue;
      }

      const parts = trimmed.split("|").map((part) => part.trim());
      const key = normalizeOAuthClientKey(parts[0] || "");
      if (key === "") {
        logger.warn(
          `[OAuthClientRegistryService] Ignored invalid OAuth client entry in ${OAUTH_CLIENTS_ENV}: ${trimmed}`,
        );
        continue;
      }

      const clientId = parts[1] || "";
      const clientSecret = parts[2] || "";
      if (clientId === "" || clientSecret === "") {
        logger.warn(
          `[OAuthClientRegistryService] OAuth client '${key}' in ${OAUTH_CLIENTS_ENV} is registered without full credentials (client_id or client_secret is empty)`,
        );
      }

      const clientConfig: OAuthClientConfig = {
        key,
        label: parts[3] && parts[3] !== "" ? parts[3] : key,
        client_id: clientId,
        client_secret: clientSecret,
        is_builtin: false,
      };

      const existingIndex = clients.findIndex((client) => client.key === key);
      if (existingIndex >= 0) {
        clients[existingIndex] = clientConfig;
      } else {
        clients.push(clientConfig);
      }
    }
  }

  let activeKey = normalizeOAuthClientKey(
    process.env[ACTIVE_OAUTH_CLIENT_ENV] || DEFAULT_OAUTH_CLIENT_KEY,
  );
  if (!clients.some((client) => client.key === activeKey)) {
    activeKey =
      clients[0]?.key ?? normalizeOAuthClientKey(DEFAULT_OAUTH_CLIENT_KEY);
  }

  return {
    clients,
    activeKey,
  };
}

function getOAuthClientRegistry(): OAuthClientRegistry {
  if (cachedOAuthClientRegistry) {
    return cachedOAuthClientRegistry;
  }
  cachedOAuthClientRegistry = buildOAuthClientRegistry();
  return cachedOAuthClientRegistry;
}

export class OAuthClientRegistryService {
  static resetRegistryCache(): void {
    resetRegistryCache();
  }

  static isClientConfigured(key?: string): boolean {
    const registry = getOAuthClientRegistry();
    const client =
      isString(key) && !isEmpty(key.trim())
        ? getClientByKey(registry.clients, key)
        : (getClientByKey(registry.clients, registry.activeKey) ??
          registry.clients[0] ??
          null);
    return isConfiguredClient(client);
  }

  static hasAnyConfiguredClient(): boolean {
    const registry = getOAuthClientRegistry();
    return registry.clients.some(isConfiguredClient);
  }

  static listOAuthClients(): OAuthClientDescriptor[] {
    const registry = getOAuthClientRegistry();
    return registry.clients.map((client) => {
      return {
        key: client.key,
        label: client.label,
        client_id: client.client_id,
        is_active: client.key === registry.activeKey,
        is_builtin: client.is_builtin,
        is_configured: isConfiguredClient(client),
      };
    });
  }

  static getActiveOAuthClientKey(): string {
    const registry = getOAuthClientRegistry();
    return registry.activeKey;
  }

  static setActiveOAuthClientKey(clientKey: string): void {
    const registry = getOAuthClientRegistry();
    const normalized = normalizeOAuthClientKey(clientKey);
    const exists = registry.clients.some((client) => client.key === normalized);
    if (!exists) {
      const available = registry.clients.map((client) => client.key).join(", ");
      throw new Error(
        `Unknown OAuth client key '${clientKey}'. Available: ${available}`,
      );
    }
    registry.activeKey = normalized;
    process.env[ACTIVE_OAUTH_CLIENT_ENV] = normalized;
  }

  static getCandidateClients(preferredClientKey?: string): OAuthClientConfig[] {
    const registry = getOAuthClientRegistry();
    const candidates: OAuthClientConfig[] = [];
    const seen = new Set<string>();

    const pushCandidate = (candidate: OAuthClientConfig | null) => {
      if (!candidate || seen.has(candidate.key)) {
        return;
      }
      seen.add(candidate.key);
      candidates.push(candidate);
    };

    const preferred = getClientByKey(registry.clients, preferredClientKey);
    if (preferredClientKey && !preferred) {
      logger.warn(
        `[OAuthClientRegistryService] Preferred OAuth client '${preferredClientKey}' not found; fallback to active client list`,
      );
    }

    pushCandidate(preferred);
    pushCandidate(getClientByKey(registry.clients, registry.activeKey));

    for (const client of registry.clients) {
      pushCandidate(client);
    }

    return candidates;
  }

  static selectAuthClient(clientKey?: string): OAuthClientConfig {
    const registry = getOAuthClientRegistry();
    if (registry.clients.length === 0) {
      throw new Error("No OAuth clients configured");
    }

    if (isString(clientKey) && !isEmpty(clientKey.trim())) {
      const selected = getClientByKey(registry.clients, clientKey);
      if (!selected) {
        throw new Error(`Unknown OAuth client key: ${clientKey}`);
      }
      return selected;
    }

    return (
      getClientByKey(registry.clients, registry.activeKey) ??
      registry.clients[0]
    );
  }

  static normalizeRefreshedOAuthClientKey(
    currentToken: { oauth_client_key?: string; project_id?: string },
    refreshedClientKey?: string,
  ): string | undefined {
    const resolved = refreshedClientKey ?? currentToken.oauth_client_key;
    const projectMissing =
      !isString(currentToken.project_id) ||
      isEmpty(currentToken.project_id.trim());

    if (
      !isString(currentToken.oauth_client_key) &&
      projectMissing &&
      resolved &&
      normalizeOAuthClientKey(resolved) === DEFAULT_OAUTH_CLIENT_KEY
    ) {
      logger.warn(
        "[OAuthClientRegistryService] Refreshed token via enterprise client for a legacy account without project_id; keep oauth_client_key unset to avoid accidental enterprise lock",
      );
      return undefined;
    }

    return resolved ? normalizeOAuthClientKey(resolved) : undefined;
  }
}

export function isClientConfigured(key?: string): boolean {
  return OAuthClientRegistryService.isClientConfigured(key);
}

export function hasAnyConfiguredClient(): boolean {
  return OAuthClientRegistryService.hasAnyConfiguredClient();
}
