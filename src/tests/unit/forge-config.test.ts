import { describe, expect, it } from "vitest";
import config from "../../../forge.config";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";

describe("forge configuration", () => {
  it("defines expected packager config for Antigravity Switcher", () => {
    expect(config.packagerConfig?.name).toBe("Antigravity Switcher");
    expect(config.packagerConfig?.executableName).toBe("antigravity-switcher");
  });

  it("configures MakerSquirrel with expected appUserModelId and setupIcon", async () => {
    const squirrelMaker = config.makers?.find(
      (maker) => maker instanceof MakerSquirrel,
    ) as MakerSquirrel | undefined;

    expect(squirrelMaker).toBeDefined();
    await squirrelMaker?.prepareConfig("x64");
    expect(squirrelMaker?.config).toMatchObject({
      setupIcon: "images/icon.ico",
      appUserModelId: "com.squirrel.antigravity-switcher.AntigravitySwitcher",
    });
  });

  it("configures MakerDeb and MakerRpm with expected Linux app icon", async () => {
    const debMaker = config.makers?.find(
      (maker) => maker instanceof MakerDeb,
    ) as MakerDeb | undefined;
    const rpmMaker = config.makers?.find(
      (maker) => maker instanceof MakerRpm,
    ) as MakerRpm | undefined;

    expect(debMaker).toBeDefined();
    expect(rpmMaker).toBeDefined();
    await debMaker?.prepareConfig("x64");
    await rpmMaker?.prepareConfig("x64");
    expect(debMaker?.config?.options?.icon).toBe("images/icon.png");
    expect(rpmMaker?.config?.options?.icon).toBe("images/icon.png");
  });
});
