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
        appName: "Antigravity Switcher",
      }),
    ).toBe("C:\\Users\\Alice\\AppData\\Local\\antigravity_switcher");
  });

  it("treats packaged Windows apps outside the per-user install root as unmanaged", () => {
    expect(
      isRunningFromExpectedInstallDir({
        platform: "win32",
        isPackaged: true,
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Switcher",
        execPath:
          "C:\\Users\\Alice\\AppData\\Local\\antigravity_switcher\\app-1.3.0\\antigravity-switcher.exe",
      }),
    ).toBe(true);

    expect(
      isRunningFromExpectedInstallDir({
        platform: "win32",
        isPackaged: true,
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Switcher",
        execPath: "C:\\Program Files\\Antigravity Switcher\\antigravity-switcher.exe",
      }),
    ).toBe(false);

    expect(
      isRunningFromExpectedInstallDir({
        platform: "win32",
        isPackaged: true,
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Switcher",
        execPath:
          "C:\\Users\\Alice\\AppData\\Local\\antigravity-switcher\\app-1.3.0\\antigravity-switcher.exe",
      }),
    ).toBe(true);

    expect(
      isRunningFromExpectedInstallDir({
        platform: "win32",
        isPackaged: true,
        localAppData: "C:\\Users\\Alice\\AppData\\Local",
        appName: "Antigravity Switcher",
        execPath:
          "C:\\Users\\Alice\\AppData\\Local\\antigravity_switcher\\app-1.3.0\\antigravity-switcher.exe",
      }),
    ).toBe(true);
  });

  it("resolves and returns notice text for all supported languages including tr and id", async () => {
    const { resolveInstallNoticeLanguage, getInstallNoticeText } =
      await import("@/modules/app-shell/utils/installNotice");

    expect(resolveInstallNoticeLanguage({ locale: "tr-TR" })).toBe("tr");
    expect(resolveInstallNoticeLanguage({ locale: "id-ID" })).toBe("id");
    expect(resolveInstallNoticeLanguage({ locale: "fr-FR" })).toBe("fr");
    expect(resolveInstallNoticeLanguage({ locale: "vi-VN" })).toBe("vi");
    expect(resolveInstallNoticeLanguage({ locale: "ru-RU" })).toBe("ru");
    expect(resolveInstallNoticeLanguage({ locale: "zh-CN" })).toBe("zh-CN");
    expect(resolveInstallNoticeLanguage({ locale: "en-US" })).toBe("en");

    expect(getInstallNoticeText("tr").buttons.length).toBe(2);
    expect(getInstallNoticeText("id").buttons.length).toBe(2);
  });
});
