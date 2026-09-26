import { describe, it, expect } from "vitest";
import {
  parseGenMetadataProtobuf,
  parseStepMetadataProtobuf,
} from "@/modules/context-telemetry/protobuf/genMetadataParser";

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

describe("genMetadataParser (Pure Protobuf Decoding)", () => {
  it("decodes authentic token metrics from Field 1 -> Submessage 4", () => {
    // Construct submessage 4:
    // Tag 2: input_tokens = 5,142
    // Tag 3: completion_tokens = 344
    // Tag 5: cached_content_token_count = 138,595
    // Tag 9: thinking_tokens = 295
    // Tag 10: output_tokens = 49
    const submessage4Bytes = [
      ...encodeVarintField(2, 5142),
      ...encodeVarintField(3, 344),
      ...encodeVarintField(5, 138595),
      ...encodeVarintField(9, 295),
      ...encodeVarintField(10, 49),
    ];

    // Submessage 19: model_name string
    const modelNameBytes = new TextEncoder().encode("gemini-3.8-flash");
    const submessage19Bytes = encodeLengthDelimited(19, modelNameBytes);

    // Submessage 20: model_enum KV tuple
    const kvString = "model_enum: MODEL_PLACEHOLDER_M318";
    const submessage20Bytes = encodeLengthDelimited(20, new TextEncoder().encode(kvString));

    // Construct Field 1:
    const field1Bytes = [
      ...encodeLengthDelimited(4, submessage4Bytes),
      ...submessage19Bytes,
      ...submessage20Bytes,
    ];

    // Top message
    const topBytes = new Uint8Array(encodeLengthDelimited(1, field1Bytes));

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.cachedTokens).toBe(138595);
    expect(metrics.freshInputTokens).toBe(5142);
    expect(metrics.usedTokens).toBe(143737); // 138595 + 5142
    expect(metrics.completionTokens).toBe(344);
    expect(metrics.thinkingTokens).toBe(295);
    expect(metrics.outputTokens).toBe(49);
    expect(metrics.modelNameRaw).toBe("gemini-3.8-flash");
    expect(metrics.modelEnumRaw).toBe("MODEL_PLACEHOLDER_M318");
    expect(metrics.isEstimated).toBe(false);
  });

  it("calculates usedTokens when cached_content_token_count is omitted (zero cache)", () => {
    // Submessage 4 with only fresh input tokens
    const submessage4Bytes = [
      ...encodeVarintField(2, 45210),
      ...encodeVarintField(3, 1200),
    ];

    const field1Bytes = encodeLengthDelimited(4, submessage4Bytes);
    const topBytes = new Uint8Array(encodeLengthDelimited(1, field1Bytes));

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.freshInputTokens).toBe(45210);
    expect(metrics.cachedTokens).toBe(0);
    expect(metrics.usedTokens).toBe(45210);
    expect(metrics.completionTokens).toBe(1200);
  });

  it("synthesizes completionTokens from thinking + output when completion is omitted", () => {
    const submessage4Bytes = [
      ...encodeVarintField(2, 1000),
      ...encodeVarintField(9, 600), // thinking
      ...encodeVarintField(10, 400), // output
    ];

    const field1Bytes = encodeLengthDelimited(4, submessage4Bytes);
    const topBytes = new Uint8Array(encodeLengthDelimited(1, field1Bytes));

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.thinkingTokens).toBe(600);
    expect(metrics.outputTokens).toBe(400);
    expect(metrics.completionTokens).toBe(1000); // 600 + 400
  });

  it("handles empty or null buffer gracefully", () => {
    const emptyResult = parseGenMetadataProtobuf(new Uint8Array(0));
    expect(emptyResult.usedTokens).toBe(0);
    expect(emptyResult.isEstimated).toBe(false);

    const nullResult = parseGenMetadataProtobuf(null);
    expect(nullResult.usedTokens).toBe(0);

    const undefinedResult = parseGenMetadataProtobuf(undefined);
    expect(undefinedResult.usedTokens).toBe(0);
  });

  it("absorbs truncated or malformed buffers without throwing", () => {
    // Truncated length-delimited wire
    const corruptBytes = new Uint8Array([0x0a, 0x50, 0x12, 0x88]); // declares 80 bytes, only provides 2
    const metrics = parseGenMetadataProtobuf(corruptBytes);

    expect(metrics.usedTokens).toBe(0);
  });

  it("absorbs completely random byte noise safely", () => {
    const randomBytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xaa, 0xbb, 0xcc, 0x01, 0x02]);
    const metrics = parseGenMetadataProtobuf(randomBytes);

    expect(metrics.usedTokens).toBe(0);
  });

  it("skips 64-bit (wire type 1) and 32-bit (wire type 5) fields cleanly across all message levels", () => {
    const encodeFixed64 = (fieldNum: number) => [
      ...encodeTag(fieldNum, 1),
      1, 2, 3, 4, 5, 6, 7, 8,
    ];
    const encodeFixed32 = (fieldNum: number) => [
      ...encodeTag(fieldNum, 5),
      1, 2, 3, 4,
    ];

    // Inside submessage 4
    const submessage4Bytes = [
      ...encodeFixed64(15),
      ...encodeFixed32(16),
      ...encodeVarintField(2, 8000), // input_tokens
      ...encodeVarintField(5, 12000), // cached_tokens
    ];

    // Inside Field 1
    const field1Bytes = [
      ...encodeFixed64(25),
      ...encodeFixed32(26),
      ...encodeLengthDelimited(4, submessage4Bytes),
    ];

    // At Top Level
    const topBytes = new Uint8Array([
      ...encodeFixed64(35),
      ...encodeFixed32(36),
      ...encodeLengthDelimited(1, field1Bytes),
    ]);

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.freshInputTokens).toBe(8000);
    expect(metrics.cachedTokens).toBe(12000);
    expect(metrics.usedTokens).toBe(20000);
  });

  it("falls back to Tag 1 total tokens when input and cached tokens are missing", () => {
    // Submessage 4 where Tag 1 has total tokens (> 2000), e.g. 35000, and Tag 3 has 500 completion tokens
    const submessage4Bytes = [
      ...encodeVarintField(1, 35000), // total tokens
      ...encodeVarintField(3, 500), // completion tokens
    ];

    const field1Bytes = encodeLengthDelimited(4, submessage4Bytes);
    const topBytes = new Uint8Array(encodeLengthDelimited(1, field1Bytes));

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.usedTokens).toBe(34500); // 35000 - 500
    expect(metrics.freshInputTokens).toBe(34500);
    expect(metrics.cachedTokens).toBe(0);
    expect(metrics.completionTokens).toBe(500);
    expect(metrics.isEstimated).toBe(true);
  });

  it("falls back to completion tokens baseline when usedTokens is 0 but completionTokens > 0", () => {
    // Submessage 4 where Tag 2 and Tag 5 are 0, but Tag 3 has completion tokens
    const submessage4Bytes = [
      ...encodeVarintField(3, 1500),
    ];

    const field1Bytes = encodeLengthDelimited(4, submessage4Bytes);
    const topBytes = new Uint8Array(encodeLengthDelimited(1, field1Bytes));

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.completionTokens).toBe(1500);
    expect(metrics.usedTokens).toBe(1500);
    expect(metrics.freshInputTokens).toBe(1500);
    expect(metrics.isEstimated).toBe(true);
  });

  it("decodes step metadata protobuf using parseStepMetadataProtobuf (Field 9 and Field 11)", () => {
    // Step metadata: Field 9 is TokenAccounting, Field 11 is model wire enum (1026 -> M26)
    const submessage9Bytes = [
      ...encodeVarintField(1, 1026),
      ...encodeVarintField(2, 4599),
      ...encodeVarintField(3, 51),
      ...encodeVarintField(5, 61042),
      ...encodeVarintField(10, 51),
    ];

    const stepBytes = new Uint8Array([
      ...encodeLengthDelimited(9, submessage9Bytes),
      ...encodeVarintField(11, 1026),
    ]);

    const metrics = parseStepMetadataProtobuf(stepBytes);

    expect(metrics.cachedTokens).toBe(61042);
    expect(metrics.freshInputTokens).toBe(4599);
    expect(metrics.usedTokens).toBe(65641);
    expect(metrics.completionTokens).toBe(51);
    expect(metrics.outputTokens).toBe(51);
    expect(metrics.modelEnumRaw).toBe("MODEL_PLACEHOLDER_M26");
    expect(metrics.isEstimated).toBe(true);
  });

  it("extracts maxContextTokens from Field 1 -> Field 9 (ChatStartMetadata) -> Field 10 (ContextWindowMetadata) -> Field 4", () => {
    // Field 10 (ContextWindowMetadata): Tag 4: max_context_tokens = 1_000_000
    const contextWindowBytes = encodeVarintField(4, 1_000_000);
    const field10Bytes = encodeLengthDelimited(10, contextWindowBytes);

    // Field 9 (ChatStartMetadata): contains Field 10
    const field9Bytes = encodeLengthDelimited(9, field10Bytes);

    // Field 4 (TokenAccounting): cached 100,000 + fresh 50,000 = 150,000
    const tokenAccountingBytes = [
      ...encodeVarintField(2, 50_000),
      ...encodeVarintField(5, 100_000),
    ];
    const field4Bytes = encodeLengthDelimited(4, tokenAccountingBytes);

    // Field 1: contains Field 4 and Field 9
    const field1Bytes = [
      ...field4Bytes,
      ...field9Bytes,
    ];

    // Top message
    const topBytes = new Uint8Array(encodeLengthDelimited(1, field1Bytes));

    const metrics = parseGenMetadataProtobuf(topBytes);

    expect(metrics.maxContextTokens).toBe(1_000_000);
    expect(metrics.usedTokens).toBe(150_000);
    expect(metrics.cachedTokens).toBe(100_000);
    expect(metrics.freshInputTokens).toBe(50_000);
  });
});
