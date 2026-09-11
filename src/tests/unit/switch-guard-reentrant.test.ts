import { describe, it, expect } from "vitest";
import { runWithSwitchGuard } from "@/modules/antigravity-runtime/switch/switchGuard";

describe("runWithSwitchGuard reentrancy", () => {
  it("allows nested calls with the same owner without deadlocking", async () => {
    let innerExecuted = false;

    const result = await runWithSwitchGuard("cloud-account-switch", async () => {
      return await runWithSwitchGuard("cloud-account-switch", async () => {
        innerExecuted = true;
        return "nested-success";
      });
    });

    expect(innerExecuted).toBe(true);
    expect(result).toBe("nested-success");
  });

  it("serializes concurrent calls properly", async () => {
    const order: string[] = [];

    const p1 = runWithSwitchGuard("cloud-account-switch", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first");
    });

    const p2 = runWithSwitchGuard("cloud-account-switch", async () => {
      order.push("second");
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(["first", "second"]);
  });
});
