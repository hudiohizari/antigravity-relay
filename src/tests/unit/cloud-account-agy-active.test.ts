import { describe, expect, it } from "vitest";

import { CloudAccountSchema } from "@/modules/cloud-account/types";

describe("Cloud account active states (Dual-Property Contract)", () => {
  it("parses app, classic, cli, and agy active state from account payloads", () => {
    const parsed = CloudAccountSchema.parse({
      id: "account-1",
      provider: "google",
      email: "user@example.com",
      token: {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        expiry_timestamp: 1700000000,
        token_type: "Bearer",
      },
      created_at: 1700000000,
      last_used: 1700000000,
      is_active_app: true,
      is_active_classic: true,
      is_active_cli: true,
      is_active_agy: true,
    });

    expect(parsed.is_active_app).toBe(true);
    expect(parsed.is_active_classic).toBe(true);
    expect(parsed.is_active_cli).toBe(true);
    expect(parsed.is_active_agy).toBe(true);
  });
});
