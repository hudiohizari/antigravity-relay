import { describe, expect, it } from "vitest";
import {
  getExpectedInstallRoot,
  isRunningFromExpectedInstallDir,
} from "@/modules/app-shell/utils/installNotice";

describe("install notice policy", () => {
  it("resolves the expected Windows per-user install root", () => {
    expect(
      getExpectedInstallRoot({
        platform: "win32",
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Relay",
      }),
    ).toBe("C:\\Users\\Alice\\AppData\\Local\\antigravity_relay");
  });

  it("treats packaged Windows apps outside the per-user install root as unmanaged", () => {
    expect(
      isRunningFromExpectedInstallDir({
        platform: "win32",
        isPackaged: true,
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Relay",
        execPath:
          "C:\\Users\\Alice\\AppData\\Local\\antigravity_relay\\app-1.3.0\\antigravity-relay.exe",
      }),
    ).toBe(true);

    expect(
      isRunningFromExpectedInstallDir({
        platform: "win32",
        isPackaged: true,
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Relay",
        execPath: "C:\\Program Files\\Antigravity Relay\\antigravity-relay.exe",
      }),
    ).toBe(false);
  });
});
