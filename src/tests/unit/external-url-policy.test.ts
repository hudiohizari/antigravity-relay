import { describe, it, expect } from "vitest";
import {
  isTrustedGitHubUrl,
  isTrustedExternalUrl,
  isValidProxyUrl,
  escapeHtml,
} from "@/shared/utils/url";

describe("isTrustedGitHubUrl", () => {
  it("accepts repository root with and without trailing slash", () => {
    expect(
      isTrustedGitHubUrl("https://github.com/hudiohizari/antigravity-relay"),
    ).toBe(true);
    expect(
      isTrustedGitHubUrl("https://github.com/hudiohizari/antigravity-relay/"),
    ).toBe(true);
  });

  it("accepts repository issues and specific issue items", () => {
    expect(
      isTrustedGitHubUrl(
        "https://github.com/hudiohizari/antigravity-relay/issues",
      ),
    ).toBe(true);
    expect(
      isTrustedGitHubUrl(
        "https://github.com/hudiohizari/antigravity-relay/issues/42",
      ),
    ).toBe(true);
  });

  it("accepts repository releases and release tags", () => {
    expect(
      isTrustedGitHubUrl(
        "https://github.com/hudiohizari/antigravity-relay/releases",
      ),
    ).toBe(true);
    expect(
      isTrustedGitHubUrl(
        "https://github.com/hudiohizari/antigravity-relay/releases/tag/v0.0.5",
      ),
    ).toBe(true);
  });

  it("rejects non-https schemes", () => {
    expect(
      isTrustedGitHubUrl("http://github.com/hudiohizari/antigravity-relay"),
    ).toBe(false);
  });

  it("rejects different github repositories or spoofed domains", () => {
    expect(
      isTrustedGitHubUrl(
        "https://github.com/hudiohizari/antigravity-relay-phishing",
      ),
    ).toBe(false);
    expect(
      isTrustedGitHubUrl("https://github.com/anotheruser/antigravity-relay"),
    ).toBe(false);
    expect(
      isTrustedGitHubUrl(
        "https://evil-github.com/hudiohizari/antigravity-relay",
      ),
    ).toBe(false);
  });

  it("rejects invalid URLs gracefully", () => {
    expect(isTrustedGitHubUrl("not-a-url")).toBe(false);
    expect(isTrustedGitHubUrl("")).toBe(false);
  });
});

describe("isTrustedExternalUrl", () => {
  it("allows trusted GitHub URLs", () => {
    expect(
      isTrustedExternalUrl("https://github.com/hudiohizari/antigravity-relay"),
    ).toBe(true);
    expect(
      isTrustedExternalUrl(
        "https://github.com/hudiohizari/antigravity-relay/issues",
      ),
    ).toBe(true);
  });

  it("allows local and loopback addresses", () => {
    expect(isTrustedExternalUrl("http://localhost:4040")).toBe(true);
    expect(isTrustedExternalUrl("http://127.0.0.1:4040/dashboard")).toBe(true);
    expect(isTrustedExternalUrl("https://localhost:8443")).toBe(true);
  });

  it("allows private LAN ranges", () => {
    expect(isTrustedExternalUrl("http://192.168.1.100:4040")).toBe(true);
    expect(isTrustedExternalUrl("http://10.0.0.5:4040")).toBe(true);
    expect(isTrustedExternalUrl("http://172.20.0.15:4040")).toBe(true);
  });

  it("allows Cloudflare tunnel and documentation domains", () => {
    expect(
      isTrustedExternalUrl(
        "https://sample-tunnel.trycloudflare.com",
      ),
    ).toBe(true);
    expect(
      isTrustedExternalUrl(
        "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
      ),
    ).toBe(true);
    expect(
      isTrustedExternalUrl(
        "https://cloudflare.com",
      ),
    ).toBe(true);
  });

  it("rejects untrusted domains and dangerous schemes", () => {
    expect(isTrustedExternalUrl("https://google.com")).toBe(false);
    expect(isTrustedExternalUrl("https://malicious-site.com")).toBe(false);
    expect(isTrustedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedExternalUrl("data:text/html,<h1>test</h1>")).toBe(false);
    expect(isTrustedExternalUrl("ftp://localhost:21")).toBe(false);
  });

  it("rejects malformed URLs gracefully", () => {
    expect(isTrustedExternalUrl("not-a-valid-url")).toBe(false);
    expect(isTrustedExternalUrl("")).toBe(false);
  });
});

describe("isValidProxyUrl", () => {
  it("validates supported proxy protocols", () => {
    expect(isValidProxyUrl("http://proxy.local:8080")).toBe(true);
    expect(isValidProxyUrl("https://secure-proxy.local:8443")).toBe(true);
    expect(isValidProxyUrl("socks://socks.local:1080")).toBe(true);
    expect(isValidProxyUrl("socks4://socks4.local:1080")).toBe(true);
    expect(isValidProxyUrl("socks5://socks5.local:1080")).toBe(true);
  });

  it("rejects unsupported protocols and invalid URLs", () => {
    expect(isValidProxyUrl("ftp://proxy.local:21")).toBe(false);
    expect(isValidProxyUrl("ws://socket.local")).toBe(false);
    expect(isValidProxyUrl("")).toBe(false);
    expect(isValidProxyUrl("invalid-proxy")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes dangerous HTML characters properly", () => {
    expect(escapeHtml("<script>alert('xss') & \"test\"</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;) &amp; &quot;test&quot;&lt;/script&gt;",
    );
  });

  it("returns unchanged text when no special characters are present", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});
