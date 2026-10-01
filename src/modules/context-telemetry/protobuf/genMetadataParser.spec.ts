import { describe, it, expect } from "vitest";
import {
  parseGenMetadataProtobuf,
  parseStepMetadataProtobuf,
  readVarint,
} from "./genMetadataParser";

/**
 * Encodes a JavaScript number into protobuf varint bytes.
 */
function encodeVarint(val: number): number[] {
  const bytes: number[] = [];
  let n = val;
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n & 0x7f);
  return bytes;
}

/**
 * Encodes a protobuf field tag (fieldNumber << 3 | wireType).
 */
function encodeTag(fieldNum: number, wireType: number): number[] {
  return encodeVarint((fieldNum << 3) | wireType);
}

/**
 * Builds a length-delimited protobuf field (wireType = 2).
 */
function encodeLengthDelimited(fieldNum: number, content: number[] | Uint8Array): number[] {
  const tag = encodeTag(fieldNum, 2);
  const len = encodeVarint(content.length);
  return [...tag, ...len, ...Array.from(content)];
}

/**
 * Builds a varint protobuf field (wireType = 0).
 */
function encodeVarintField(fieldNum: number, val: number): number[] {
  const tag = encodeTag(fieldNum, 0);
  const v = encodeVarint(val);
  return [...tag, ...v];
}

describe("genMetadataParser.spec (Varint Drainage & Context Telemetry)", () => {
  describe("AC-01: 10-Byte Varint Drainage & Stream Desync Prevention", () => {
    it("drains full 10 bytes for 64-bit negative varint -1", () => {
      // 10-byte representation of -1: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]
      const negativeOneBytes = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
      ]);

      const [, nextOffset] = readVarint(negativeOneBytes, 0);

      expect(nextOffset).toBe(10);
      expect(nextOffset).toBe(negativeOneBytes.length);
    });

    it("prevents wireType = 7 corruption by aligning offset to subsequent field tag", () => {
      // 10-byte varint followed immediately by Field 10 (wireType = 2, length-delimited)
      const negativeOneVarint = [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
      ];
      const field10Tag = encodeTag(10, 2); // 0x52 = 82
      const payload = new Uint8Array([...negativeOneVarint, ...field10Tag]);

      const [, nextOffset] = readVarint(payload, 0);
      expect(nextOffset).toBe(10);

      const [tagKey, afterTag] = readVarint(payload, nextOffset);
      const wireType = tagKey & 0x07;
      const fieldNum = Math.floor(tagKey / 8);

      expect(wireType).toBe(2);
      expect(wireType).not.toBe(7); // Wire type 7 is strictly averted
      expect(fieldNum).toBe(10);
      expect(afterTag).toBe(11);
    });

    it("caps malformed continuation sequences at 10 bytes to prevent unbounded loops", () => {
      // Stream with 15 continuation bytes (0x80)
      const infiniteStream = new Uint8Array(15).fill(0x80);
      const [, nextOffset] = readVarint(infiniteStream, 0);

      expect(nextOffset).toBe(10);
    });

    it("returns safely when stream terminates prematurely at EOF", () => {
      const truncated = new Uint8Array([0x80, 0x80]);
      const [, nextOffset] = readVarint(truncated, 0);

      expect(nextOffset).toBe(2);
    });
  });

  describe("AC-02: Authentic max_context_tokens Extraction Preceded by 64-Bit Varints", () => {
    it("extracts max_context_tokens = 256000 when preceded by 10-byte varints in Field 9", () => {
      // 10-byte varint for -1: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]
      const tenByteVarint = [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
      ];

      // Intermediate Field 3 (wireType = 0) with 10-byte varint
      const intermediateField3 = [
        ...encodeTag(3, 0),
        ...tenByteVarint,
      ];

      // ContextWindowMetadata (Field 10) -> max_context_tokens (Field 4 = 256_000)
      const maxTokensVarint = encodeVarintField(4, 256_000);
      const field10Bytes = encodeLengthDelimited(10, maxTokensVarint);

      // ChatStartMetadata (Field 9) contains intermediate Field 3 followed by Field 10
      const field9Bytes = encodeLengthDelimited(9, [
        ...intermediateField3,
        ...field10Bytes,
      ]);

      // TokenAccounting (Field 4): cached 75,000 + fresh 25,000 = 100,000
      const tokenAccountingBytes = encodeLengthDelimited(4, [
        ...encodeVarintField(2, 25_000),
        ...encodeVarintField(5, 75_000),
      ]);

      // Field 1: contains Field 4 and Field 9
      const field1Bytes = encodeLengthDelimited(1, [
        ...tokenAccountingBytes,
        ...field9Bytes,
      ]);

      const topBytes = new Uint8Array(field1Bytes);
      const metrics = parseGenMetadataProtobuf(topBytes);

      expect(metrics.maxContextTokens).toBe(256_000);
      expect(metrics.usedTokens).toBe(100_000);
      expect(metrics.cachedTokens).toBe(75_000);
      expect(metrics.freshInputTokens).toBe(25_000);
      expect(metrics.isEstimated).toBe(false);
    });

    it("parses authentic token metrics cleanly with zero estimation", () => {
      const submessage4Bytes = [
        ...encodeVarintField(2, 12_000),
        ...encodeVarintField(5, 48_000),
        ...encodeVarintField(3, 1_500),
      ];
      const field1Bytes = encodeLengthDelimited(1, encodeLengthDelimited(4, submessage4Bytes));

      const metrics = parseGenMetadataProtobuf(new Uint8Array(field1Bytes));
      expect(metrics.usedTokens).toBe(60_000);
      expect(metrics.cachedTokens).toBe(48_000);
      expect(metrics.freshInputTokens).toBe(12_000);
      expect(metrics.completionTokens).toBe(1_500);
      expect(metrics.isEstimated).toBe(false);
    });
  });
});
