import { describe, it, expect } from "vitest";
import {
  resolveModelContextWindow,
  calculatePressureState,
  getAvailableModelCeilings,
  KNOWN_MODEL_CEILINGS,
} from "./modelCeilings";

describe("modelCeilings.spec (Ceiling Alignment & Compaction Guard)", () => {
  describe("AC-03: Gemini 3.8 Flash Active Compaction Ceiling (256,000 tokens)", () => {
    it("resolves gemini-3.8-flash to 256,000 tokens ceiling with authoritative true", () => {
      const ceiling = resolveModelContextWindow("gemini-3.8-flash");
      expect(ceiling.displayName).toBe("Gemini 3.8 Flash");
      expect(ceiling.maxTokens).toBe(256_000);
      expect(ceiling.isAuthoritative).toBe(true);
    });

    it("resolves gemini-3.8-flash-high to 256,000 tokens ceiling with authoritative true", () => {
      const ceiling = resolveModelContextWindow("gemini-3.8-flash-high");
      expect(ceiling.displayName).toBe("Gemini 3.8 Flash (High)");
      expect(ceiling.maxTokens).toBe(256_000);
      expect(ceiling.isAuthoritative).toBe(true);
    });

    it("resolves MODEL_PLACEHOLDER_M318 wire placeholder to 256,000 tokens ceiling", () => {
      const ceiling = resolveModelContextWindow("MODEL_PLACEHOLDER_M318");
      expect(ceiling.displayName).toBe("Gemini 3.8 Flash");
      expect(ceiling.maxTokens).toBe(256_000);
      expect(ceiling.isAuthoritative).toBe(true);
    });

    it("verifies KNOWN_MODEL_CEILINGS array strictly defines 256_000 for Flash variants", () => {
      const flashHighDef = KNOWN_MODEL_CEILINGS.find((c) => c.id === "gemini-3.8-flash-high");
      expect(flashHighDef).toBeDefined();
      expect(flashHighDef?.maxTokens).toBe(256_000);

      const flashDef = KNOWN_MODEL_CEILINGS.find((c) => c.id === "gemini-3.8-flash");
      expect(flashDef).toBeDefined();
      expect(flashDef?.maxTokens).toBe(256_000);
    });
  });

  describe("AC-04: Accurate Context Pressure & Compaction Risk Telemetry", () => {
    it("evaluates 230,000 tokens on 256,000 ceiling as 89.8% (high_pressure) and prevents normal misreporting", () => {
      const usedTokens = 230_000;
      const trueCeiling = 256_000;
      const oldCeiling = 1_000_000;

      // True Antigravity 2.0 ceiling ratio
      const ratio = Number(((usedTokens / trueCeiling) * 100).toFixed(1));
      expect(ratio).toBe(89.8);
      expect(calculatePressureState(ratio)).toBe("high_pressure");

      // Critical risk threshold: 230,400+ tokens evaluates to >= 90.0%
      const criticalTokens = 230_400;
      const criticalRatio = Number(((criticalTokens / trueCeiling) * 100).toFixed(1));
      expect(criticalRatio).toBe(90.0);
      expect(calculatePressureState(criticalRatio)).toBe("critical_risk");

      // 2-arg calculation
      expect(calculatePressureState(criticalTokens, trueCeiling)).toBe("critical_risk");
      expect(calculatePressureState(usedTokens, trueCeiling)).toBe("high_pressure");

      // Verifies contrast against old misleading 1M ceiling
      const oldRatio = Number(((usedTokens / oldCeiling) * 100).toFixed(1));
      expect(oldRatio).toBe(23.0);
      expect(calculatePressureState(oldRatio)).toBe("normal");
      expect(calculatePressureState(usedTokens, oldCeiling)).toBe("normal");
    });

    it("verifies strict percentage boundaries for 1-arg calculatePressureState", () => {
      expect(calculatePressureState(0.0)).toBe("normal");
      expect(calculatePressureState(69.9)).toBe("normal");
      expect(calculatePressureState(70.0)).toBe("high_pressure");
      expect(calculatePressureState(89.9)).toBe("high_pressure");
      expect(calculatePressureState(90.0)).toBe("critical_risk");
      expect(calculatePressureState(100.0)).toBe("critical_risk");
    });
  });
});
