export interface ParsedTokenMetrics {
  usedTokens: number; // cachedTokens + freshInputTokens (or estimated fallback)
  cachedTokens: number; // cached_content_token_count (Tag 5)
  freshInputTokens: number; // input_tokens (Tag 2)
  completionTokens: number; // completion_tokens (Tag 3)
  thinkingTokens: number; // thinking_tokens (Tag 9)
  outputTokens: number; // output_tokens (Tag 10)
  modelEnumRaw?: string; // e.g. MODEL_PLACEHOLDER_M318
  modelNameRaw?: string; // e.g. gemini-3.8-flash
  maxContextTokens?: number; // e.g. 200000 or 1000000 extracted from ChatStartMetadata
  isEstimated: boolean; // false when parsed authentically from gen_metadata
}

/**
 * Reads a protobuf varint from buffer starting at offset.
 * Returns [value, nextOffset].
 */
function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buf.length) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) {
      return [result, pos];
    }
    shift += 7;
    if (shift > 49) {
      // Beyond safe integer bounds or malformed
      break;
    }
  }

  return [result, pos];
}

/**
 * Traverses a submessage and collects metrics from TokenAccounting (Tag 4 in gen_metadata or Tag 9 in step metadata).
 */
function parseTokenAccountingSubmessage(
  buf: Uint8Array,
  start: number,
  end: number,
  metrics: ParsedTokenMetrics,
): { rawTag1?: number } {
  let pos = start;
  let rawTag1: number | undefined;

  while (pos < end) {
    const [tagKey, nextPos] = readVarint(buf, pos);
    if (nextPos === pos || nextPos > end) break;
    pos = nextPos;

    const fieldNum = Math.floor(tagKey / 8);
    const wireType = tagKey & 0x07;

    if (wireType === 0) {
      // Varint
      const [val, afterVal] = readVarint(buf, pos);
      if (afterVal === pos || afterVal > end) break;
      pos = afterVal;

      switch (fieldNum) {
        case 1:
          rawTag1 = val;
          break;
        case 2:
          metrics.freshInputTokens = val;
          break;
        case 3:
          metrics.completionTokens = val;
          break;
        case 5:
          metrics.cachedTokens = val;
          break;
        case 9:
          metrics.thinkingTokens = val;
          break;
        case 10:
          metrics.outputTokens = val;
          break;
      }
    } else if (wireType === 2) {
      // Length-delimited
      const [len, afterLen] = readVarint(buf, pos);
      if (afterLen === pos || afterLen + len > end) break;
      pos = afterLen + len;
    } else if (wireType === 1) {
      // 64-bit
      pos += 8;
    } else if (wireType === 5) {
      // 32-bit
      pos += 4;
    } else {
      // Unknown wire type, break
      break;
    }
  }

  return { rawTag1 };
}

/**
 * Traverses ChatStartMetadata (Field 9 of Field 1, wireType 2) to locate ContextWindowMetadata (Field 10, wireType 2)
 * and its max_context_tokens (Field 4, wireType 0 varint).
 */
function parseChatStartMetadataSubmessage(
  buf: Uint8Array,
  start: number,
  end: number,
  metrics: ParsedTokenMetrics,
): void {
  let pos = start;

  while (pos < end) {
    const [tagKey, nextPos] = readVarint(buf, pos);
    if (nextPos === pos || nextPos > end) break;
    pos = nextPos;

    const fieldNum = Math.floor(tagKey / 8);
    const wireType = tagKey & 0x07;

    if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      if (afterLen === pos || afterLen + len > end) break;
      const subStart = afterLen;
      const subEnd = afterLen + len;
      pos = subEnd;

      if (fieldNum === 10) {
        // ContextWindowMetadata (Field 10)
        let cPos = subStart;
        while (cPos < subEnd) {
          const [cTagKey, cNextPos] = readVarint(buf, cPos);
          if (cNextPos === cPos || cNextPos > subEnd) break;
          cPos = cNextPos;

          const cFieldNum = Math.floor(cTagKey / 8);
          const cWireType = cTagKey & 0x07;

          if (cWireType === 0) {
            const [val, afterVal] = readVarint(buf, cPos);
            if (afterVal === cPos || afterVal > subEnd) break;
            cPos = afterVal;

            if (cFieldNum === 4 && val > 0) {
              metrics.maxContextTokens = val;
            }
          } else if (cWireType === 2) {
            const [cLen, cAfterLen] = readVarint(buf, cPos);
            if (cAfterLen === cPos || cAfterLen + cLen > subEnd) break;
            cPos = cAfterLen + cLen;
          } else if (cWireType === 1) {
            cPos += 8;
          } else if (cWireType === 5) {
            cPos += 4;
          } else {
            break;
          }
        }
      }
    } else if (wireType === 0) {
      const [, afterVal] = readVarint(buf, pos);
      if (afterVal === pos || afterVal > end) break;
      pos = afterVal;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }
}

/**
 * Parses Field 1 (Execution details) of gen_metadata protobuf.
 */
function parseField1Submessage(
  buf: Uint8Array,
  start: number,
  end: number,
  metrics: ParsedTokenMetrics,
): { rawTag1?: number } {
  let pos = start;
  let rawTag1: number | undefined;

  while (pos < end) {
    const [tagKey, nextPos] = readVarint(buf, pos);
    if (nextPos === pos || nextPos > end) break;
    pos = nextPos;

    const fieldNum = Math.floor(tagKey / 8);
    const wireType = tagKey & 0x07;

    if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      if (afterLen === pos || afterLen + len > end) break;
      const subStart = afterLen;
      const subEnd = afterLen + len;
      pos = subEnd;

      if (fieldNum === 4) {
        // Tag 4: Token metrics submessage
        const subResult = parseTokenAccountingSubmessage(buf, subStart, subEnd, metrics);
        if (subResult.rawTag1 !== undefined) {
          rawTag1 = subResult.rawTag1;
        }
      } else if (fieldNum === 9) {
        // Tag 9: ChatStartMetadata submessage (contains Field 10 ContextWindowMetadata -> Field 4 max_context_tokens)
        parseChatStartMetadataSubmessage(buf, subStart, subEnd, metrics);
      } else if (fieldNum === 19) {
        // Tag 19: model_name string
        try {
          const nameBytes = buf.subarray(subStart, subEnd);
          const nameStr = new TextDecoder("utf-8").decode(nameBytes).trim();
          if (nameStr.length > 0 && !metrics.modelNameRaw) {
            metrics.modelNameRaw = nameStr;
          }
        } catch {
          // Ignore string decode errors
        }
      } else if (fieldNum === 20) {
        // Tag 20: Key-value string tuples (e.g. model_enum: MODEL_PLACEHOLDER_M318)
        try {
          const str = new TextDecoder("latin1").decode(buf.subarray(subStart, subEnd));
          if (!metrics.modelEnumRaw) {
            const enumMatch = str.match(/model_enum[^\w]*(MODEL_[A-Z0-9_]+)/i);
            if (enumMatch && enumMatch[1]) {
              metrics.modelEnumRaw = enumMatch[1];
            }
          }
          if (!metrics.modelNameRaw) {
            const nameMatch = str.match(
              /(?:claude-[a-z0-9_\-\.]+|gemini-[a-z0-9_\-\.]+|gpt-[a-z0-9_\-\.]+|deepseek-[a-z0-9_\-\.]+)/i,
            );
            if (nameMatch && nameMatch[0]) {
              metrics.modelNameRaw = nameMatch[0];
            }
          }
        } catch {
          // Ignore kv decode errors
        }
      }
    } else if (wireType === 0) {
      const [, afterVal] = readVarint(buf, pos);
      if (afterVal === pos || afterVal > end) break;
      pos = afterVal;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }

  return { rawTag1 };
}

/**
 * Pure, zero-dependency parser for gen_metadata Protocol Buffer BLOBs.
 * Extracts authentic token metrics and model metadata with resilient fallbacks.
 */
export function parseGenMetadataProtobuf(
  buffer: Uint8Array | Buffer | null | undefined,
): ParsedTokenMetrics {
  const result: ParsedTokenMetrics = {
    usedTokens: 0,
    cachedTokens: 0,
    freshInputTokens: 0,
    completionTokens: 0,
    thinkingTokens: 0,
    outputTokens: 0,
    isEstimated: false,
  };

  if (!buffer || buffer.length === 0) {
    return result;
  }

  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  try {
    let pos = 0;
    let foundField1 = false;
    let rawTag1: number | undefined;

    while (pos < buf.length) {
      const [tagKey, nextPos] = readVarint(buf, pos);
      if (nextPos === pos || nextPos > buf.length) break;
      pos = nextPos;

      const fieldNum = Math.floor(tagKey / 8);
      const wireType = tagKey & 0x07;

      if (wireType === 2) {
        const [len, afterLen] = readVarint(buf, pos);
        if (afterLen === pos || afterLen + len > buf.length) break;
        const subStart = afterLen;
        const subEnd = afterLen + len;
        pos = subEnd;

        if (fieldNum === 1) {
          foundField1 = true;
          const f1Result = parseField1Submessage(buf, subStart, subEnd, result);
          if (f1Result.rawTag1 !== undefined) {
            rawTag1 = f1Result.rawTag1;
          }
        } else if (fieldNum === 9) {
          // Direct token accounting submessage (observed in step metadata)
          const subResult = parseTokenAccountingSubmessage(buf, subStart, subEnd, result);
          if (subResult.rawTag1 !== undefined) {
            rawTag1 = subResult.rawTag1;
          }
        }
      } else if (wireType === 0) {
        const [, afterVal] = readVarint(buf, pos);
        if (afterVal === pos || afterVal > buf.length) break;
        pos = afterVal;
      } else if (wireType === 1) {
        pos += 8;
      } else if (wireType === 5) {
        pos += 4;
      } else {
        break;
      }
    }

    // Live Context Window Formula: cached_content_token_count + input_tokens
    result.usedTokens = result.cachedTokens + result.freshInputTokens;

    // Consistency check: if thinkingTokens + outputTokens exist but completionTokens is 0
    if (result.completionTokens === 0 && (result.thinkingTokens > 0 || result.outputTokens > 0)) {
      result.completionTokens = result.thinkingTokens + result.outputTokens;
    }

    // Fallback 1: If usedTokens is 0 and rawTag1 is present with value > 2000 (distinct from wire enums like 26, 318, 1026, 1318),
    // treat rawTag1 as total_token_count
    if (result.usedTokens === 0 && rawTag1 !== undefined && rawTag1 > 2000) {
      result.freshInputTokens = Math.max(0, rawTag1 - result.completionTokens);
      result.usedTokens = result.cachedTokens + result.freshInputTokens;
      result.isEstimated = true;
    }

    // Fallback 2: If usedTokens is 0 but blob has positive completionTokens,
    // input context cannot be 0. Estimate fresh input based on completion tokens as fallback baseline.
    if (result.usedTokens === 0 && result.completionTokens > 0) {
      result.freshInputTokens = Math.max(1, result.completionTokens);
      result.usedTokens = result.cachedTokens + result.freshInputTokens;
      result.isEstimated = true;
    }

    if (!foundField1) {
      result.isEstimated = false;
    }

    return result;
  } catch {
    // Return gracefully on corrupted binary input
    return {
      usedTokens: 0,
      cachedTokens: 0,
      freshInputTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
      outputTokens: 0,
      isEstimated: true,
    };
  }
}

/**
 * Fallback parser for steps.metadata Protocol Buffer BLOBs (step_type = 15).
 * In step metadata:
 * - Field 9 (wireType = 2): TokenAccounting submessage (Tag 2: freshInput, Tag 3: completion, Tag 5: cached, Tag 10: output, etc.)
 * - Field 11 (wireType = 0): model enum wire id (e.g. 1026 -> MODEL_PLACEHOLDER_M26, 1318 -> MODEL_PLACEHOLDER_M318)
 */
export function parseStepMetadataProtobuf(
  buffer: Uint8Array | Buffer | null | undefined,
): ParsedTokenMetrics {
  const result: ParsedTokenMetrics = {
    usedTokens: 0,
    cachedTokens: 0,
    freshInputTokens: 0,
    completionTokens: 0,
    thinkingTokens: 0,
    outputTokens: 0,
    isEstimated: true,
  };

  if (!buffer || buffer.length === 0) {
    return result;
  }

  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  try {
    let pos = 0;
    let rawTag1: number | undefined;

    while (pos < buf.length) {
      const [tagKey, nextPos] = readVarint(buf, pos);
      if (nextPos === pos || nextPos > buf.length) break;
      pos = nextPos;

      const fieldNum = Math.floor(tagKey / 8);
      const wireType = tagKey & 0x07;

      if (wireType === 2) {
        const [len, afterLen] = readVarint(buf, pos);
        if (afterLen === pos || afterLen + len > buf.length) break;
        const subStart = afterLen;
        const subEnd = afterLen + len;
        pos = subEnd;

        if (fieldNum === 9) {
          const subResult = parseTokenAccountingSubmessage(buf, subStart, subEnd, result);
          if (subResult.rawTag1 !== undefined) {
            rawTag1 = subResult.rawTag1;
          }
        }
      } else if (wireType === 0) {
        const [val, afterVal] = readVarint(buf, pos);
        if (afterVal === pos || afterVal > buf.length) break;
        pos = afterVal;

        if (fieldNum === 11) {
          if (val === 1026 || val === 26) {
            result.modelEnumRaw = "MODEL_PLACEHOLDER_M26";
          } else if (val === 1318 || val === 318) {
            result.modelEnumRaw = "MODEL_PLACEHOLDER_M318";
          } else if (val === 29) {
            result.modelEnumRaw = "MODEL_PLACEHOLDER_M29";
          } else if (val === 34) {
            result.modelEnumRaw = "MODEL_PLACEHOLDER_M34";
          }
        }
      } else if (wireType === 1) {
        pos += 8;
      } else if (wireType === 5) {
        pos += 4;
      } else {
        break;
      }
    }

    result.usedTokens = result.cachedTokens + result.freshInputTokens;

    if (result.completionTokens === 0 && (result.thinkingTokens > 0 || result.outputTokens > 0)) {
      result.completionTokens = result.thinkingTokens + result.outputTokens;
    }

    if (result.usedTokens === 0 && rawTag1 !== undefined && rawTag1 > 2000) {
      result.freshInputTokens = Math.max(0, rawTag1 - result.completionTokens);
      result.usedTokens = result.cachedTokens + result.freshInputTokens;
    }

    return result;
  } catch {
    return result;
  }
}
