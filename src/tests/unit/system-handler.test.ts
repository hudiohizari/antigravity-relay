import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NetworkInterfaceInfo } from "os";
import { createRouterClient } from "@orpc/server";
import type { RunningAntigravityProcess } from "@/shared/platform/paths";

const { showOpenDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
  shell: {
    openPath: vi.fn(),
  },
}));

const {
  refreshAntigravityProcessCacheMock,
  getRunningAntigravityProcessesMock,
  getAntigravityLaunchArgsFromRunningProcessMock,
} = vi.hoisted(() => ({
  refreshAntigravityProcessCacheMock: vi.fn<
    (...args: unknown[]) => Promise<void>
  >(async () => {}),
  getRunningAntigravityProcessesMock: vi.fn<
    (...args: unknown[]) => RunningAntigravityProcess[]
  >(() => []),
  getAntigravityLaunchArgsFromRunningProcessMock: vi.fn<
    (...args: unknown[]) => string[]
  >(() => []),
}));

vi.mock("@/shared/platform/paths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/platform/paths")>();
  return {
    ...actual,
    refreshAntigravityProcessCache: refreshAntigravityProcessCacheMock,
    getRunningAntigravityProcesses: getRunningAntigravityProcessesMock,
    getAntigravityLaunchArgsFromRunningProcess:
      getAntigravityLaunchArgsFromRunningProcessMock,
  };
});

import {
  isRfc1918Address,
  isVirtualAdapter,
  isLanInterfaceName,
  resolveLocalIps,
  systemHandler,
} from "@/modules/app-shell/ipc/system/handler";

describe("System Handler LAN Interface Detection & RFC1918 Recognition", () => {
  describe("isRfc1918Address", () => {
    it("should recognize standard Class C private range (192.168.0.0/16)", () => {
      expect(isRfc1918Address("192.168.1.1")).toBe(true);
      expect(isRfc1918Address("192.168.0.100")).toBe(true);
      expect(isRfc1918Address("192.168.254.254")).toBe(true);
    });

    it("should recognize standard Class A private range (10.0.0.0/8)", () => {
      expect(isRfc1918Address("10.0.0.1")).toBe(true);
      expect(isRfc1918Address("10.200.1.50")).toBe(true);
      expect(isRfc1918Address("10.255.255.255")).toBe(true);
    });

    it("should recognize standard Class B private range (172.16.0.0/12)", () => {
      expect(isRfc1918Address("172.16.0.1")).toBe(true);
      expect(isRfc1918Address("172.20.10.2")).toBe(true);
      expect(isRfc1918Address("172.31.255.254")).toBe(true);
    });

    it("should reject non-RFC1918 addresses", () => {
      expect(isRfc1918Address("172.15.0.1")).toBe(false);
      expect(isRfc1918Address("172.32.0.1")).toBe(false);
      expect(isRfc1918Address("8.8.8.8")).toBe(false);
      expect(isRfc1918Address("1.1.1.1")).toBe(false);
      expect(isRfc1918Address("169.254.1.1")).toBe(false);
      expect(isRfc1918Address("127.0.0.1")).toBe(false);
    });
  });

  describe("isVirtualAdapter", () => {
    it("should identify virtual adapter names", () => {
      expect(isVirtualAdapter("utun0")).toBe(true);
      expect(isVirtualAdapter("utun3")).toBe(true);
      expect(isVirtualAdapter("docker0")).toBe(true);
      expect(isVirtualAdapter("vmnet1")).toBe(true);
      expect(isVirtualAdapter("vboxnet0")).toBe(true);
      expect(isVirtualAdapter("tailscale0")).toBe(true);
      expect(isVirtualAdapter("Tailscale-Adapter")).toBe(true);
    });

    it("should not flag physical LAN adapters as virtual", () => {
      expect(isVirtualAdapter("en0")).toBe(false);
      expect(isVirtualAdapter("en1")).toBe(false);
      expect(isVirtualAdapter("eth0")).toBe(false);
      expect(isVirtualAdapter("wlan0")).toBe(false);
      expect(isVirtualAdapter("Wi-Fi")).toBe(false);
      expect(isVirtualAdapter("Ethernet")).toBe(false);
    });
  });

  describe("isLanInterfaceName", () => {
    it("should recognize macOS interface naming (en0, en1, etc.)", () => {
      expect(isLanInterfaceName("en0")).toBe(true);
      expect(isLanInterfaceName("en1")).toBe(true);
      expect(isLanInterfaceName("en12")).toBe(true);
    });

    it("should recognize Linux standard naming (eth*, wlan*, enp*, wlp*)", () => {
      expect(isLanInterfaceName("eth0")).toBe(true);
      expect(isLanInterfaceName("eth1")).toBe(true);
      expect(isLanInterfaceName("wlan0")).toBe(true);
      expect(isLanInterfaceName("enp3s0")).toBe(true);
      expect(isLanInterfaceName("wlp2s0")).toBe(true);
    });

    it("should recognize Windows interface naming (Wi-Fi, Ethernet, etc.)", () => {
      expect(isLanInterfaceName("Wi-Fi")).toBe(true);
      expect(isLanInterfaceName("Ethernet")).toBe(true);
      expect(isLanInterfaceName("Wireless Network Connection")).toBe(true);
      expect(isLanInterfaceName("以太网")).toBe(true);
    });

    it("should reject virtual adapters even if name contains lan/net", () => {
      expect(isLanInterfaceName("vboxnet0")).toBe(false);
      expect(isLanInterfaceName("vmnet8")).toBe(false);
      expect(isLanInterfaceName("docker0")).toBe(false);
      expect(isLanInterfaceName("utun0")).toBe(false);
    });
  });

  describe("resolveLocalIps", () => {
    function makeNet(
      address: string,
      family: "IPv4" | "IPv6" = "IPv4",
      internal = false,
    ): NetworkInterfaceInfo {
      if (family === "IPv6") {
        return {
          address,
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "00:00:00:00:00:00",
          internal,
          cidr: `${address}/64`,
          scopeid: 0,
        };
      }
      return {
        address,
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal,
        cidr: `${address}/24`,
      };
    }

    it("should identify macOS en0 with RFC1918 address as recommended", () => {
      const nets: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        en0: [makeNet("192.168.1.100")],
        lo0: [makeNet("127.0.0.1", "IPv4", true)],
      };

      const results = resolveLocalIps(nets);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        name: "en0",
        address: "192.168.1.100",
        isRecommended: true,
      });
    });

    it("should identify Linux wlan0 and eth0 with RFC1918 as recommended", () => {
      const nets: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        wlan0: [makeNet("10.0.0.15")],
        docker0: [makeNet("172.17.0.1")],
        lo: [makeNet("127.0.0.1", "IPv4", true)],
      };

      const results = resolveLocalIps(nets);
      expect(results).toHaveLength(2);

      // wlan0 should be recommended and sorted first
      expect(results[0].name).toBe("wlan0");
      expect(results[0].isRecommended).toBe(true);

      // docker0 is virtual, so isRecommended should be false
      expect(results[1].name).toBe("docker0");
      expect(results[1].isRecommended).toBe(false);
    });

    it("should identify Windows Wi-Fi and Ethernet adapters with RFC1918", () => {
      const nets: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        "Wi-Fi": [makeNet("172.20.10.2")],
        Tailscale: [makeNet("100.64.0.1")],
      };

      const results = resolveLocalIps(nets);
      const wifi = results.find((r) => r.name === "Wi-Fi");
      expect(wifi?.isRecommended).toBe(true);

      const tailscale = results.find((r) => r.name === "Tailscale");
      expect(tailscale?.isRecommended).toBe(false);
    });

    it("should exclude APIPA (169.254.*) and CGNAT (198.18.*)", () => {
      const nets: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        en0: [makeNet("169.254.5.10")],
        utun1: [makeNet("198.18.0.5")],
        en1: [makeNet("192.168.50.2")],
      };

      const results = resolveLocalIps(nets);
      expect(results).toHaveLength(1);
      expect(results[0].address).toBe("192.168.50.2");
      expect(results[0].isRecommended).toBe(true);
    });

    it("should sort recommended interfaces first, then alphabetically by address", () => {
      const nets: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        virtualNet: [makeNet("10.0.0.1")], // not recommended adapter name
        en0: [makeNet("192.168.2.5")], // recommended
        en1: [makeNet("10.0.1.2")], // recommended
      };

      const results = resolveLocalIps(nets);
      expect(results).toHaveLength(3);
      expect(results[0].isRecommended).toBe(true);
      expect(results[1].isRecommended).toBe(true);
      expect(results[2].isRecommended).toBe(false);

      // Between en1 (10.0.1.2) and en0 (192.168.2.5), 10.0.1.2 comes first alphabetically
      expect(results[0].address).toBe("10.0.1.2");
      expect(results[1].address).toBe("192.168.2.5");
      expect(results[2].address).toBe("10.0.0.1");
    });

    it("should fall back to loopback 127.0.0.1 when no external interfaces exist", () => {
      const nets: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        lo0: [makeNet("127.0.0.1", "IPv4", true)],
      };

      const results = resolveLocalIps(nets);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        address: "127.0.0.1",
        name: "loopback",
        isRecommended: false,
      });
    });

    it("should fall back to loopback 127.0.0.1 when nets dictionary is completely empty", () => {
      const results = resolveLocalIps({});
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        address: "127.0.0.1",
        name: "loopback",
        isRecommended: false,
      });
    });
  });
});

describe("systemHandler IPC Router", () => {
  const client = createRouterClient(systemHandler);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("selectAntigravityExecutable", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("should configure dialog with showHiddenFiles and CLI app name for cli target", async () => {
      showOpenDialogMock.mockResolvedValueOnce({
        canceled: false,
        filePaths: ["/Users/test/.local/bin/agy"],
      });

      const result = await client.selectAntigravityExecutable({
        target: "cli",
      });

      expect(result).toBe("/Users/test/.local/bin/agy");
      expect(showOpenDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ["openFile", "showHiddenFiles"],
          filters: [
            {
              name: "Antigravity CLI (agy) executable",
              extensions: expect.any(Array),
            },
          ],
        }),
      );
    });

    it("should configure dialog with IDE app name for ide target", async () => {
      showOpenDialogMock.mockResolvedValueOnce({
        canceled: false,
        filePaths: ["/Applications/Antigravity IDE.app"],
      });

      const result = await client.selectAntigravityExecutable({
        target: "ide",
      });

      expect(result).toBe("/Applications/Antigravity IDE.app");
      expect(showOpenDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ["openFile", "showHiddenFiles"],
          filters: [
            {
              name: "Antigravity IDE executable",
              extensions: expect.any(Array),
            },
          ],
        }),
      );
    });

    it("should configure dialog with classic App name for app target or undefined", async () => {
      showOpenDialogMock.mockResolvedValueOnce({
        canceled: false,
        filePaths: ["/Applications/Antigravity.app"],
      });

      const result = await client.selectAntigravityExecutable();

      expect(result).toBe("/Applications/Antigravity.app");
      expect(showOpenDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ["openFile", "showHiddenFiles"],
          filters: [
            {
              name: "Antigravity executable",
              extensions: expect.any(Array),
            },
          ],
        }),
      );
    });

    it("should use Windows extensions exe, cmd, bat on win32", async () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      showOpenDialogMock.mockResolvedValueOnce({
        canceled: false,
        filePaths: ["C:\\Users\\test\\.local\\bin\\agy.cmd"],
      });

      await client.selectAntigravityExecutable({ target: "cli" });

      expect(showOpenDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ["openFile", "showHiddenFiles"],
          filters: [
            {
              name: "Antigravity CLI (agy) executable",
              extensions: ["exe", "cmd", "bat"],
            },
          ],
        }),
      );
    });

    it("should return null when dialog is canceled", async () => {
      showOpenDialogMock.mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      });

      const result = await client.selectAntigravityExecutable({
        target: "ide",
      });
      expect(result).toBeNull();
    });
  });

  describe("getAntigravityArgs", () => {
    it("should call refreshAntigravityProcessCache and return running: false when process is not running", async () => {
      getRunningAntigravityProcessesMock.mockReturnValueOnce([]);
      getAntigravityLaunchArgsFromRunningProcessMock.mockReturnValueOnce([]);

      const result = await client.getAntigravityArgs({ target: "ide" });

      expect(refreshAntigravityProcessCacheMock).toHaveBeenCalledWith("ide");
      expect(result).toEqual({
        running: false,
        args: [],
      });
    });

    it("should return running: true and empty args when process is running without extra args", async () => {
      getRunningAntigravityProcessesMock.mockReturnValueOnce([
        {
          pid: 1234,
          name: "Antigravity IDE",
          executablePath: "/path/to/ide",
          commandLine: "/path/to/ide",
        },
      ]);
      getAntigravityLaunchArgsFromRunningProcessMock.mockReturnValueOnce([]);

      const result = await client.getAntigravityArgs({ target: "ide" });

      expect(refreshAntigravityProcessCacheMock).toHaveBeenCalledWith("ide");
      expect(result).toEqual({
        running: true,
        args: [],
      });
    });

    it("should return running: true and parsed args when process is running with custom arguments", async () => {
      getRunningAntigravityProcessesMock.mockReturnValueOnce([
        {
          pid: 5678,
          name: "Antigravity IDE",
          executablePath: "/path/to/ide",
          commandLine: "/path/to/ide --user-data-dir /tmp/dir",
        },
      ]);
      getAntigravityLaunchArgsFromRunningProcessMock.mockReturnValueOnce([
        "--user-data-dir",
        "/tmp/dir",
      ]);

      const result = await client.getAntigravityArgs({ target: "ide" });

      expect(refreshAntigravityProcessCacheMock).toHaveBeenCalledWith("ide");
      expect(result).toEqual({
        running: true,
        args: ["--user-data-dir", "/tmp/dir"],
      });
    });

    it("should default to app target when target is omitted", async () => {
      getRunningAntigravityProcessesMock.mockReturnValueOnce([]);
      getAntigravityLaunchArgsFromRunningProcessMock.mockReturnValueOnce([]);

      const result = await client.getAntigravityArgs();

      expect(refreshAntigravityProcessCacheMock).toHaveBeenCalledWith("app");
      expect(result).toEqual({
        running: false,
        args: [],
      });
    });
  });
});
