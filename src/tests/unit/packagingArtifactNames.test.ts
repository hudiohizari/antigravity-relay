import { describe, expect, it } from "vitest";
import { getArtifactFileName } from "@/shared/packaging/artifactNames";

describe("packaging artifact names", () => {
  it("names Windows setup executables for update.electronjs.org platform detection", () => {
    expect(
      getArtifactFileName({
        baseName: "Antigravity.Relay",
        version: "0.17.1",
        arch: "arm64",
        extension: ".exe",
      }),
    ).toBe("Antigravity.Relay-0.17.1-win32-arm64-setup.exe");

    expect(
      getArtifactFileName({
        baseName: "Antigravity.Relay",
        version: "0.17.1",
        arch: "x64",
        extension: ".exe",
      }),
    ).toBe("Antigravity.Relay-0.17.1-win32-x64-setup.exe");
  });
});
