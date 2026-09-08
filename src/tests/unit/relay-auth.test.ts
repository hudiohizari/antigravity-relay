import { describe, it, expect, beforeEach } from "vitest";
import {
  generateSessionToken,
  generateSessionId,
  generatePairingKey,
  extractTokenFromHeader,
  extractTokenFromQuery,
  validateToken,
  AuthRateLimiter,
} from "@/modules/relay/relay-auth";

describe("Relay Authentication & Cryptographic Utilities", () => {
  describe("Cryptographic Token Generation", () => {
    it("should generate 256-bit high-entropy session tokens", () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();

      expect(token1).toBeTypeOf("string");
      expect(token1.length).toBe(64); // 32 bytes in hex
      expect(token2.length).toBe(64);
      expect(token1).not.toBe(token2);
    });

    it("should generate unique session UUIDs", () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();

      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(id1).not.toBe(id2);
    });

    it("should generate 128-bit pairing keys", () => {
      const key1 = generatePairingKey();
      const key2 = generatePairingKey();

      expect(key1).toBeTypeOf("string");
      expect(key1.length).toBe(32); // 16 bytes in hex
      expect(key1).not.toBe(key2);
    });
  });

  describe("Token Extraction", () => {
    it("should extract token from Bearer authorization header", () => {
      expect(extractTokenFromHeader("Bearer secret-token-123")).toBe(
        "secret-token-123",
      );
      expect(extractTokenFromHeader("bearer lowercase-bearer-token")).toBe(
        "lowercase-bearer-token",
      );
      expect(extractTokenFromHeader("BEARER uppercase-token")).toBe(
        "uppercase-token",
      );
      expect(extractTokenFromHeader("raw-token-without-prefix")).toBe(
        "raw-token-without-prefix",
      );
    });

    it("should return null for empty or undefined headers", () => {
      expect(extractTokenFromHeader(undefined)).toBeNull();
      expect(extractTokenFromHeader("")).toBeNull();
      expect(extractTokenFromHeader("   ")).toBeNull();
    });

    it("should extract token and pairing key from URL query strings", () => {
      const query1 = extractTokenFromQuery(
        "https://example.com/ws?token=my-token",
      );
      expect(query1.token).toBe("my-token");
      expect(query1.pair).toBeUndefined();

      const query2 = extractTokenFromQuery("/ws?pair=pair-key-xyz");
      expect(query2.pair).toBe("pair-key-xyz");
      expect(query2.token).toBeUndefined();

      const query3 = extractTokenFromQuery("token=t1&pair=p1");
      expect(query3.token).toBe("t1");
      expect(query3.pair).toBe("p1");

      const query4 = extractTokenFromQuery("/ws");
      expect(query4.token).toBeUndefined();
      expect(query4.pair).toBeUndefined();
    });
  });

  describe("Constant-Time Token Validation", () => {
    it("should validate identical tokens successfully", () => {
      const token = generateSessionToken();
      expect(validateToken(token, token)).toBe(true);
    });

    it("should reject mismatched tokens of equal length", () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(validateToken(token1, token2)).toBe(false);
    });

    it("should reject tokens of differing lengths safely", () => {
      expect(validateToken("short", "much-longer-token-string")).toBe(false);
      expect(validateToken("", "non-empty")).toBe(false);
      expect(validateToken("non-empty", "")).toBe(false);
    });
  });

  describe("Authentication Rate Limiting", () => {
    let rateLimiter: AuthRateLimiter;

    beforeEach(() => {
      rateLimiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 500 });
    });

    it("should permit attempts below threshold", () => {
      expect(rateLimiter.isRateLimited("127.0.0.1")).toBe(false);
      rateLimiter.recordFailure("127.0.0.1");
      expect(rateLimiter.isRateLimited("127.0.0.1")).toBe(false);
      rateLimiter.recordFailure("127.0.0.1");
      expect(rateLimiter.isRateLimited("127.0.0.1")).toBe(false);
    });

    it("should block IP after reaching maximum failed attempts", () => {
      rateLimiter.recordFailure("10.0.0.1");
      rateLimiter.recordFailure("10.0.0.1");
      rateLimiter.recordFailure("10.0.0.1");

      expect(rateLimiter.isRateLimited("10.0.0.1")).toBe(true);
      expect(rateLimiter.isRateLimited("10.0.0.2")).toBe(false);
    });

    it("should reset rate limit on successful authentication", () => {
      rateLimiter.recordFailure("192.168.1.1");
      rateLimiter.recordFailure("192.168.1.1");
      rateLimiter.recordFailure("192.168.1.1");
      expect(rateLimiter.isRateLimited("192.168.1.1")).toBe(true);

      rateLimiter.recordSuccess("192.168.1.1");
      expect(rateLimiter.isRateLimited("192.168.1.1")).toBe(false);
    });

    it("should reset specific IP or all IPs", () => {
      rateLimiter.recordFailure("1.1.1.1");
      rateLimiter.recordFailure("1.1.1.1");
      rateLimiter.recordFailure("1.1.1.1");
      rateLimiter.recordFailure("2.2.2.2");
      rateLimiter.recordFailure("2.2.2.2");
      rateLimiter.recordFailure("2.2.2.2");

      rateLimiter.reset("1.1.1.1");
      expect(rateLimiter.isRateLimited("1.1.1.1")).toBe(false);
      expect(rateLimiter.isRateLimited("2.2.2.2")).toBe(true);

      rateLimiter.reset();
      expect(rateLimiter.isRateLimited("2.2.2.2")).toBe(false);
    });

    it("should allow attempts again after window expires", async () => {
      rateLimiter.recordFailure("3.3.3.3");
      rateLimiter.recordFailure("3.3.3.3");
      rateLimiter.recordFailure("3.3.3.3");
      expect(rateLimiter.isRateLimited("3.3.3.3")).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(rateLimiter.isRateLimited("3.3.3.3")).toBe(false);
    });
  });
});
