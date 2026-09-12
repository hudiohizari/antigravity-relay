import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  cleanPromptText,
  detectActiveTurn,
  isCliTarget,
} from "@/modules/chat-resume/activeTurnDetector";
import { getAntigravityConversationDbPaths } from "@/shared/platform/paths";
import { SessionContinuityBuffer } from "@/modules/chat-resume/SessionContinuityBuffer";
import {
  AutoSwitchService,
  resolveQuotaGroupId,
} from "@/modules/cloud-account/services/AutoSwitchService";
import type { CloudAccount } from "@/modules/cloud-account/types";

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-settings-store",
  () => ({
    CloudAccountSettingsStore: {
      getSetting: vi.fn(() => ({})),
      getActiveAccountIdForTarget: vi.fn(),
      isUnifiedMode: vi.fn(() => false),
      setUnifiedMode: vi.fn(),
      getOperationalState: vi.fn(),
    },
  }),
);

describe("Chat Resume Detection & Turn Draining", () => {
  describe("Transcript Prompt Unwrapping & Tag Stripping", () => {
    it("strips XML tags USER_REQUEST, ADDITIONAL_METADATA, and USER_SETTINGS_CHANGE", () => {
      const raw = `
        <USER_REQUEST>
        Please refactor the database query layer
        </USER_REQUEST>
        <ADDITIONAL_METADATA>
        {"workspace": "/projects/backend"}
        </ADDITIONAL_METADATA>
        <USER_SETTINGS_CHANGE>
        model: claude-3-5-sonnet
        </USER_SETTINGS_CHANGE>
      `;
      const cleaned = cleanPromptText(raw);
      expect(cleaned).toBe("Please refactor the database query layer");
    });

    it("handles already clean plaintext without modification", () => {
      const plain = "Fix port discovery binding in main.ts";
      expect(cleanPromptText(plain)).toBe(
        "Fix port discovery binding in main.ts",
      );
    });

    it("returns empty string for null, undefined or empty input", () => {
      expect(cleanPromptText("")).toBe("");
      expect(cleanPromptText(null as unknown as string)).toBe("");
      expect(cleanPromptText(undefined as unknown as string)).toBe("");
    });
  });

  describe("Conversation Database Paths & CLI Exemption", () => {
    it("strictly returns empty array for CLI and agy targets", () => {
      expect(getAntigravityConversationDbPaths("cli")).toEqual([]);
      expect(getAntigravityConversationDbPaths("agy" as any)).toEqual([]);
    });

    it("verifies isCliTarget classifies correctly", () => {
      expect(isCliTarget("cli")).toBe(true);
      expect(isCliTarget("agy" as any)).toBe(true);
      expect(isCliTarget("ide")).toBe(false);
      expect(isCliTarget("app")).toBe(false);
    });
  });

  describe("SessionContinuityBuffer Singleflight Mutex & Draft Scratch", () => {
    let buffer: SessionContinuityBuffer;

    beforeEach(() => {
      buffer = new SessionContinuityBuffer();
    });

    it("atomically claims snapshot in_flight exactly once", () => {
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-claim-test",
        promptPayload: { prompt: "Refactor concurrency buffer" },
      });

      const firstClaim = buffer.claimInFlight(snapshot.resumptionId);
      expect(firstClaim).not.toBeNull();
      expect(firstClaim?.status).toBe("in_flight");

      // Second claim attempt must return null
      const secondClaim = buffer.claimInFlight(snapshot.resumptionId);
      expect(secondClaim).toBeNull();
    });

    it("claimLatestForTarget claims and transitions status to in_flight", () => {
      buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-claim-target-1",
        promptPayload: { prompt: "First prompt" },
      });

      const snapshot = buffer.claimLatestForTarget("ide");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.status).toBe("in_flight");
      expect(snapshot?.cascadeId).toBe("cascade-claim-target-1");

      // Consecutive claim must return null because it is already in_flight
      const secondClaim = buffer.claimLatestForTarget("ide");
      expect(secondClaim).toBeNull();
    });

    it("preserves draft scratch with account email and reason", () => {
      buffer.saveDraft({
        resumptionId: "res-draft-1",
        prompt: "Preserved prompt content",
        appTarget: "ide",
        reason: "process_crashed",
        accountEmail: "dev@company.com",
      });

      const saved = buffer.getDraft("res-draft-1");
      expect(saved).not.toBeNull();
      expect(saved?.resumptionId).toBe("res-draft-1");
      expect(saved?.prompt).toBe("Preserved prompt content");
      expect(saved?.accountEmail).toBe("dev@company.com");
      expect(saved?.reason).toBe("process_crashed");
    });
  });

  describe("Active Model Scoping & Quota Group Resolution", () => {
    it("correctly maps models to quota group identifiers", () => {
      expect(resolveQuotaGroupId("claude-3-5-sonnet")).toBe("claude");
      expect(resolveQuotaGroupId("claude-opus-4")).toBe("claude");
      expect(resolveQuotaGroupId("gemini-1.5-pro")).toBe("gemini-3-pro-high");
      expect(resolveQuotaGroupId("gemini-2.5-flash")).toBe("gemini-3-flash");
      expect(resolveQuotaGroupId("unknown-model-xyz")).toBe(
        "unknown-model-xyz",
      );
    });

    it("scopes account depletion check to activeModel when provided", () => {
      const account: CloudAccount = {
        id: "acc-1",
        provider: "google",
        email: "user@example.com",
        token: {
          access_token: "token-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        created_at: Date.now(),
        last_used: Date.now(),
        status: "active",
        quota: {
          models: {
            "claude-3-5-sonnet": {
              percentage: 0, // Depleted!
              resetTime: new Date(Date.now() + 3600000).toISOString(),
            },
            "gemini-1.5-pro": {
              percentage: 85, // Healthy
              resetTime: new Date(Date.now() + 3600000).toISOString(),
            },
          },
        },
      };

      // With activeModel 'claude-3-5-sonnet', account should be considered depleted
      expect(
        AutoSwitchService.isAccountDepleted(account, "claude-3-5-sonnet"),
      ).toBe(true);

      // With activeModel 'gemini-1.5-pro', account should NOT be considered depleted
      expect(
        AutoSwitchService.isAccountDepleted(account, "gemini-1.5-pro"),
      ).toBe(false);

      // Without activeModel (overall depletion), since one enabled quota group is depleted, unscoped check returns true
      expect(AutoSwitchService.isAccountDepleted(account)).toBe(true);
    });
  });
});
