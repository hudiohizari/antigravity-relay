export function isValidProxyUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "socks:", "socks4:", "socks5:"].includes(
      parsed.protocol,
    );
  } catch {
    return false;
  }
}

export function escapeHtml(str: string): string {
  return str.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] || c,
  );
}

export function isTrustedGitHubUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "github.com"
    ) {
      return false;
    }
    const pathname = parsedUrl.pathname.replace(/\/+$/, "");
    return (
      pathname === "/hudiohizari/antigravity-relay" ||
      pathname.startsWith("/hudiohizari/antigravity-relay/")
    );
  } catch {
    return false;
  }
}

export function isTrustedExternalUrl(url: string): boolean {
  if (isTrustedGitHubUrl(url)) return true;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      const hostname = parsedUrl.hostname.toLowerCase();
      return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".trycloudflare.com") ||
        hostname === "developers.cloudflare.com" ||
        hostname.endsWith(".cloudflare.com") ||
        hostname === "cloudflare.com" ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
      );
    }
    return false;
  } catch {
    return false;
  }
}
