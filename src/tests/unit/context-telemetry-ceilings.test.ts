import { describe, it, expect } from "vitest";
import {
  resolveModelContextWindow,
  calculatePressureState,
  getAvailableModelCeilings,
} from "@/modules/context-telemetry/models/modelCeilings";

describe("modelCeilings (Context Ceiling Mapping & Pressure Bounds)", () => {
  describe("resolveModelContextWindow (Antigravity 2.0 Models)", () => {
    it("maps Claude 4.6 Opus (Thinking) to exact displayName and 200,000 tokens", () => {
      const thinking = resolveModelContextWindow("claude-opus-4-6-thinking");
      expect(thinking.displayName).toBe("Claude 4.6 Opus (Thinking)");
      expect(thinking.maxTokens).toBe(200_000);
      expect(thinking.isAuthoritative).toBe(true);

      const standard = resolveModelContextWindow("claude-opus-4-6");
      expect(standard.displayName).toBe("Claude 4.6 Opus (Thinking)");
      expect(standard.maxTokens).toBe(200_000);
      expect(standard.isAuthoritative).toBe(true);
    });

    it("maps Claude 4.6 Sonnet (Thinking) and 3.7 Sonnet to exact displayName and 200,000 tokens", () => {
      const sonnet46Thinking = resolveModelContextWindow("claude-sonnet-4-6-thinking");
      expect(sonnet46Thinking.displayName).toBe("Claude 4.6 Sonnet (Thinking)");
      expect(sonnet46Thinking.maxTokens).toBe(200_000);
      expect(sonnet46Thinking.isAuthoritative).toBe(true);

      const sonnet46 = resolveModelContextWindow("claude-sonnet-4-6");
      expect(sonnet46.displayName).toBe("Claude 4.6 Sonnet (Thinking)");
      expect(sonnet46.maxTokens).toBe(200_000);
      expect(sonnet46.isAuthoritative).toBe(true);

      const sonnet37 = resolveModelContextWindow("claude-3-7-sonnet");
      expect(sonnet37.displayName).toBe("Claude 4.6 Sonnet (Thinking)");
      expect(sonnet37.maxTokens).toBe(200_000);
      expect(sonnet37.isAuthoritative).toBe(true);
    });

    it("maps Claude 4.5 Opus and Sonnet (Thinking) to exact displayNames and 200,000 tokens", () => {
      const opus45 = resolveModelContextWindow("claude-opus-4-5-thinking");
      expect(opus45.displayName).toBe("Claude 4.5 Opus (Thinking)");
      expect(opus45.maxTokens).toBe(200_000);
      expect(opus45.isAuthoritative).toBe(true);

      const sonnet45 = resolveModelContextWindow("claude-sonnet-4-5-thinking");
      expect(sonnet45.displayName).toBe("Claude 4.5 Sonnet (Thinking)");
      expect(sonnet45.maxTokens).toBe(200_000);
      expect(sonnet45.isAuthoritative).toBe(true);
    });

    it("maps Claude 3.5 Sonnet and wire enums M26/M34 to Claude 3.5 Sonnet and 200,000 tokens", () => {
      const sonnet35 = resolveModelContextWindow("claude-3-5-sonnet");
      expect(sonnet35.displayName).toBe("Claude 3.5 Sonnet");
      expect(sonnet35.maxTokens).toBe(200_000);
      expect(sonnet35.isAuthoritative).toBe(true);

      const m26 = resolveModelContextWindow("MODEL_PLACEHOLDER_M26");
      expect(m26.displayName).toBe("Claude 3.5 Sonnet");
      expect(m26.maxTokens).toBe(200_000);
      expect(m26.isAuthoritative).toBe(true);

      const m34 = resolveModelContextWindow("MODEL_PLACEHOLDER_M34");
      expect(m34.displayName).toBe("Claude 3.5 Sonnet");
      expect(m34.maxTokens).toBe(200_000);
      expect(m34.isAuthoritative).toBe(true);
    });

    it("maps Gemini 3.8 Flash (High) to exact displayName and 1,000,000 tokens", () => {
      const flashHigh = resolveModelContextWindow("gemini-3.8-flash-high");
      expect(flashHigh.displayName).toBe("Gemini 3.8 Flash (High)");
      expect(flashHigh.maxTokens).toBe(1_000_000);
      expect(flashHigh.isAuthoritative).toBe(true);
    });

    it("maps Gemini 3.8 Flash and M318 wire placeholder to exact displayName and 1,000,000 tokens", () => {
      const flash = resolveModelContextWindow("gemini-3.8-flash");
      expect(flash.displayName).toBe("Gemini 3.8 Flash");
      expect(flash.maxTokens).toBe(1_000_000);
      expect(flash.isAuthoritative).toBe(true);

      const m318 = resolveModelContextWindow("MODEL_PLACEHOLDER_M318");
      expect(m318.displayName).toBe("Gemini 3.8 Flash");
      expect(m318.maxTokens).toBe(1_000_000);
      expect(m318.isAuthoritative).toBe(true);
    });

    it("maps Gemini 3.1 Pro and M29 wire placeholder to exact displayName and 2,000,000 tokens", () => {
      const pro = resolveModelContextWindow("gemini-3.1-pro");
      expect(pro.displayName).toBe("Gemini 3.1 Pro");
      expect(pro.maxTokens).toBe(2_000_000);
      expect(pro.isAuthoritative).toBe(true);

      const m29 = resolveModelContextWindow("MODEL_PLACEHOLDER_M29");
      expect(m29.displayName).toBe("Gemini 3.1 Pro");
      expect(m29.maxTokens).toBe(2_000_000);
      expect(m29.isAuthoritative).toBe(true);
    });

    it("falls back to default fallback (128,000 tokens, isAuthoritative: false) for non-Antigravity models (GPT-4o, DeepSeek)", () => {
      const gpt4o = resolveModelContextWindow("gpt-4o");
      expect(gpt4o.maxTokens).toBe(128_000);
      expect(gpt4o.isAuthoritative).toBe(false);

      const gpt4oMini = resolveModelContextWindow("gpt-4o-mini");
      expect(gpt4oMini.maxTokens).toBe(128_000);
      expect(gpt4oMini.isAuthoritative).toBe(false);

      const o1 = resolveModelContextWindow("o1-preview");
      expect(o1.maxTokens).toBe(128_000);
      expect(o1.isAuthoritative).toBe(false);

      const deepseekChat = resolveModelContextWindow("deepseek-chat");
      expect(deepseekChat.maxTokens).toBe(128_000);
      expect(deepseekChat.isAuthoritative).toBe(false);

      const deepseekR1 = resolveModelContextWindow("deepseek-r1");
      expect(deepseekR1.maxTokens).toBe(128_000);
      expect(deepseekR1.isAuthoritative).toBe(false);
    });

    it("falls back to 128,000 tokens for unknown or empty models with isAuthoritative = false", () => {
      const fallback = resolveModelContextWindow("custom-fine-tuned-model");
      expect(fallback.maxTokens).toBe(128_000);
      expect(fallback.isAuthoritative).toBe(false);

      const nullFallback = resolveModelContextWindow(undefined);
      expect(nullFallback.maxTokens).toBe(128_000);
      expect(nullFallback.isAuthoritative).toBe(false);

      const emptyFallback = resolveModelContextWindow("");
      expect(emptyFallback.maxTokens).toBe(128_000);
      expect(emptyFallback.isAuthoritative).toBe(false);
    });
  });

  describe("calculatePressureState (Strict Boundaries)", () => {
    it("classifies < 70.0% as normal", () => {
      expect(calculatePressureState(0.0)).toBe("normal");
      expect(calculatePressureState(45.5)).toBe("normal");
      expect(calculatePressureState(69.9)).toBe("normal");
    });

    it("classifies 70.0% - 89.9% as high_pressure", () => {
      expect(calculatePressureState(70.0)).toBe("high_pressure");
      expect(calculatePressureState(75.2)).toBe("high_pressure");
      expect(calculatePressureState(89.9)).toBe("high_pressure");
    });

    it("classifies >= 90.0% as critical_risk", () => {
      expect(calculatePressureState(90.0)).toBe("critical_risk");
      expect(calculatePressureState(95.0)).toBe("critical_risk");
      expect(calculatePressureState(100.0)).toBe("critical_risk");
      expect(calculatePressureState(115.0)).toBe("critical_risk");
    });
  });

  describe("getAvailableModelCeilings", () => {
    it("returns empty model list since switch compatibility preview is removed", () => {
      const models = getAvailableModelCeilings();
      expect(models).toEqual([]);
    });
  });
});
