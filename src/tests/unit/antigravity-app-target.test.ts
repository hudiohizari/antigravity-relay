import { describe, expect, it } from "vitest";

import {
  AntigravityAppTargetSchema,
  CanonicalAntigravityAppTargetSchema,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";

describe("Antigravity app targets", () => {
  it("normalizes legacy targets via preprocess", () => {
    const parsedAgy = AntigravityAppTargetSchema.safeParse("agy");
    expect(parsedAgy.success).toBe(true);
    if (parsedAgy.success) {
      expect(parsedAgy.data).toBe("cli");
    }

    const parsedClassic = AntigravityAppTargetSchema.safeParse("classic");
    expect(parsedClassic.success).toBe(true);
    if (parsedClassic.success) {
      expect(parsedClassic.data).toBe("app");
    }
  });

  it("accepts canonical targets (app, ide, cli)", () => {
    expect(AntigravityAppTargetSchema.safeParse("app").data).toBe("app");
    expect(AntigravityAppTargetSchema.safeParse("ide").data).toBe("ide");
    expect(AntigravityAppTargetSchema.safeParse("cli").data).toBe("cli");
  });

  it("rejects invalid targets", () => {
    expect(AntigravityAppTargetSchema.safeParse("unknown").success).toBe(false);
    expect(AntigravityAppTargetSchema.safeParse(123).success).toBe(false);
  });

  it("resolves targets deterministically with app as default fallback", () => {
    expect(resolveAntigravityAppTarget("agy")).toBe("cli");
    expect(resolveAntigravityAppTarget("cli")).toBe("cli");
    expect(resolveAntigravityAppTarget("classic")).toBe("app");
    expect(resolveAntigravityAppTarget("app")).toBe("app");
    expect(resolveAntigravityAppTarget("ide")).toBe("ide");
    expect(resolveAntigravityAppTarget(null)).toBe("app");
    expect(resolveAntigravityAppTarget(undefined)).toBe("app");
    expect(resolveAntigravityAppTarget("unknown")).toBe("app");
  });

  it("exposes options matching CanonicalAntigravityAppTargetSchema", () => {
    expect(AntigravityAppTargetSchema.options).toEqual(["app", "ide", "cli"]);
    expect(CanonicalAntigravityAppTargetSchema.options).toEqual([
      "app",
      "ide",
      "cli",
    ]);
  });
});
