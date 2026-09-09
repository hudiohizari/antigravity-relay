import { networkInterfaces, NetworkInterfaceInfo } from "os";

export interface IpInfo {
  address: string;
  name: string;
  isRecommended: boolean;
}

export function isRfc1918Address(addr: string): boolean {
  if (addr.startsWith("192.168.") || addr.startsWith("10.")) {
    return true;
  }
  return /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr);
}

export function isVirtualAdapter(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("utun") ||
    lower.startsWith("docker") ||
    lower.startsWith("vmnet") ||
    lower.startsWith("vboxnet") ||
    lower.startsWith("tailscale") ||
    lower.includes("tailscale") ||
    lower.includes("docker") ||
    lower.includes("vmnet") ||
    lower.includes("vboxnet") ||
    lower.includes("utun")
  );
}

export function isLanInterfaceName(name: string): boolean {
  if (isVirtualAdapter(name)) {
    return false;
  }
  const lower = name.toLowerCase();
  return (
    lower.includes("wlan") ||
    lower.includes("wi-fi") ||
    lower.includes("wifi") ||
    lower.includes("wireless") ||
    lower.includes("ethernet") ||
    lower === "以太网" ||
    /^eth\d+/i.test(lower) ||
    /^en\d+$/i.test(lower) ||
    /^wlan\d+/i.test(lower) ||
    /^enp\w+/i.test(lower) ||
    /^wlp\w+/i.test(lower)
  );
}

export function resolveLocalIps(
  nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): IpInfo[] {
  const results: IpInfo[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const isIPv4 = net.family === "IPv4";

      if (!isIPv4 || net.internal) {
        continue;
      }

      const addr = net.address;

      // Skip non-LAN addresses
      if (addr.startsWith("169.254.")) continue; // APIPA
      if (addr.startsWith("198.18.")) continue; // CGNAT / VPN

      let isRecommended = false;
      if (
        isRfc1918Address(addr) &&
        isLanInterfaceName(name) &&
        !isVirtualAdapter(name)
      ) {
        isRecommended = true;
      }

      results.push({ address: addr, name, isRecommended });
    }
  }

  // Fallback if no network interfaces found (airplane / air-gapped mode)
  if (results.length === 0) {
    results.push({
      address: "127.0.0.1",
      name: "loopback",
      isRecommended: false,
    });
  }

  // Sort: recommended first, then by address
  results.sort((a, b) => {
    if (a.isRecommended !== b.isRecommended) {
      return a.isRecommended ? -1 : 1;
    }
    return a.address.localeCompare(b.address);
  });

  return results;
}

export function getRecommendedLocalIp(
  nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | null {
  const ips = resolveLocalIps(nets);
  const recommended = ips.find((ip) => ip.isRecommended && ip.address !== "127.0.0.1");
  if (recommended) {
    return recommended.address;
  }
  const nonLoopback = ips.find(
    (ip) => ip.address !== "127.0.0.1" && !ip.address.startsWith("127."),
  );
  return nonLoopback?.address ?? null;
}
