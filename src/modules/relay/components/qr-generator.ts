/**
 * Pure TypeScript QR Code Matrix Generator (ISO/IEC 18004 compliant).
 * Zero runtime dependencies, supporting Versions 1-10 with Error Correction Level L.
 */

// Galois Field GF(256) logarithm and exponent tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

let gfVal = 1;
for (let i = 0; i < 255; i++) {
  GF_EXP[i] = gfVal;
  GF_EXP[i + 255] = gfVal;
  GF_LOG[gfVal] = i;
  gfVal = (gfVal << 1) ^ (gfVal & 0x80 ? 0x11d : 0);
}

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Version table parameters for EC Level L
interface VersionSpec {
  version: number;
  totalCodewords: number;
  dataCodewords: number;
  ecCodewordsPerBlock: number;
  blocksGroup1: number;
  dataPerBlockGroup1: number;
  blocksGroup2: number;
  dataPerBlockGroup2: number;
  alignmentPatterns: number[];
  remainderBits: number;
}

const VERSION_SPECS: VersionSpec[] = [
  {
    version: 1,
    totalCodewords: 26,
    dataCodewords: 19,
    ecCodewordsPerBlock: 7,
    blocksGroup1: 1,
    dataPerBlockGroup1: 19,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [],
    remainderBits: 0,
  },
  {
    version: 2,
    totalCodewords: 44,
    dataCodewords: 34,
    ecCodewordsPerBlock: 10,
    blocksGroup1: 1,
    dataPerBlockGroup1: 34,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 18],
    remainderBits: 7,
  },
  {
    version: 3,
    totalCodewords: 70,
    dataCodewords: 55,
    ecCodewordsPerBlock: 15,
    blocksGroup1: 1,
    dataPerBlockGroup1: 55,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 22],
    remainderBits: 7,
  },
  {
    version: 4,
    totalCodewords: 100,
    dataCodewords: 80,
    ecCodewordsPerBlock: 20,
    blocksGroup1: 1,
    dataPerBlockGroup1: 80,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 26],
    remainderBits: 7,
  },
  {
    version: 5,
    totalCodewords: 134,
    dataCodewords: 108,
    ecCodewordsPerBlock: 26,
    blocksGroup1: 1,
    dataPerBlockGroup1: 108,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 30],
    remainderBits: 7,
  },
  {
    version: 6,
    totalCodewords: 172,
    dataCodewords: 136,
    ecCodewordsPerBlock: 18,
    blocksGroup1: 2,
    dataPerBlockGroup1: 68,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 34],
    remainderBits: 7,
  },
  {
    version: 7,
    totalCodewords: 196,
    dataCodewords: 156,
    ecCodewordsPerBlock: 20,
    blocksGroup1: 2,
    dataPerBlockGroup1: 78,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 22, 38],
    remainderBits: 0,
  },
  {
    version: 8,
    totalCodewords: 242,
    dataCodewords: 194,
    ecCodewordsPerBlock: 24,
    blocksGroup1: 2,
    dataPerBlockGroup1: 97,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 24, 42],
    remainderBits: 0,
  },
  {
    version: 9,
    totalCodewords: 292,
    dataCodewords: 232,
    ecCodewordsPerBlock: 30,
    blocksGroup1: 2,
    dataPerBlockGroup1: 116,
    blocksGroup2: 0,
    dataPerBlockGroup2: 0,
    alignmentPatterns: [6, 26, 46],
    remainderBits: 0,
  },
  {
    version: 10,
    totalCodewords: 346,
    dataCodewords: 274,
    ecCodewordsPerBlock: 18,
    blocksGroup1: 2,
    dataPerBlockGroup1: 68,
    blocksGroup2: 2,
    dataPerBlockGroup2: 69,
    alignmentPatterns: [6, 28, 50],
    remainderBits: 0,
  },
];

// Precomputed 15-bit format strings for EC Level L, masks 0-7
const FORMAT_INFO_LEVEL_L: number[] = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

// 18-bit version information for versions 7-10
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

function getGeneratorPolynomial(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMultiply(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomon(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = getGeneratorPolynomial(ecCount);
  const remainder = new Uint8Array(data.length + ecCount);
  remainder.set(data);

  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor !== 0) {
      for (let j = 0; j < gen.length; j++) {
        remainder[i + j] ^= gfMultiply(gen[j], factor);
      }
    }
  }

  return remainder.slice(data.length);
}

class BitBuffer {
  private buffer: number[] = [];
  private length: number = 0;

  public put(val: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.buffer.push((val >>> i) & 1);
      this.length++;
    }
  }

  public getBits(): number[] {
    return this.buffer;
  }

  public getByteLength(): number {
    return Math.ceil(this.length / 8);
  }

  public toBytes(): Uint8Array {
    const bytes = new Uint8Array(this.getByteLength());
    for (let i = 0; i < this.length; i++) {
      bytes[Math.floor(i / 8)] |= this.buffer[i] << (7 - (i % 8));
    }
    return bytes;
  }
}

export function generateQrMatrix(text: string): boolean[][] {
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(text);

  // Find minimum version that fits data
  let spec: VersionSpec | null = null;
  for (const candidate of VERSION_SPECS) {
    const charCountBits = candidate.version < 10 ? 8 : 16;
    const requiredBits = 4 + charCountBits + rawBytes.length * 8;
    if (requiredBits <= candidate.dataCodewords * 8) {
      spec = candidate;
      break;
    }
  }

  if (!spec) {
    spec = VERSION_SPECS[VERSION_SPECS.length - 1];
  }

  const charCountBits = spec.version < 10 ? 8 : 16;
  const bitBuf = new BitBuffer();

  // Mode: Byte (0100)
  bitBuf.put(0b0100, 4);
  // Character count
  bitBuf.put(rawBytes.length, charCountBits);
  // Data bytes
  for (let i = 0; i < rawBytes.length; i++) {
    bitBuf.put(rawBytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const maxBits = spec.dataCodewords * 8;
  const remainingBits = maxBits - bitBuf.getBits().length;
  const terminatorBits = Math.min(4, Math.max(0, remainingBits));
  bitBuf.put(0, terminatorBits);

  // Pad to byte boundary
  const padToByte = (8 - (bitBuf.getBits().length % 8)) % 8;
  bitBuf.put(0, padToByte);

  // Pad bytes alternating 0xEC and 0x11
  let padToggle = false;
  while (bitBuf.getBits().length < maxBits) {
    bitBuf.put(padToggle ? 0x11 : 0xec, 8);
    padToggle = !padToggle;
  }

  const allDataCodewords = bitBuf.toBytes();

  // Divide data into blocks and calculate EC codewords
  interface Block {
    data: Uint8Array;
    ec: Uint8Array;
  }

  const blocks: Block[] = [];
  let dataOffset = 0;

  for (let b = 0; b < spec.blocksGroup1; b++) {
    const blockData = allDataCodewords.slice(
      dataOffset,
      dataOffset + spec.dataPerBlockGroup1,
    );
    dataOffset += spec.dataPerBlockGroup1;
    const blockEc = computeReedSolomon(blockData, spec.ecCodewordsPerBlock);
    blocks.push({ data: blockData, ec: blockEc });
  }

  for (let b = 0; b < spec.blocksGroup2; b++) {
    const blockData = allDataCodewords.slice(
      dataOffset,
      dataOffset + spec.dataPerBlockGroup2,
    );
    dataOffset += spec.dataPerBlockGroup2;
    const blockEc = computeReedSolomon(blockData, spec.ecCodewordsPerBlock);
    blocks.push({ data: blockData, ec: blockEc });
  }

  // Interleave data codewords
  const interleavedBits: number[] = [];
  let maxBlockDataLen = 0;
  for (const blk of blocks) {
    if (blk.data.length > maxBlockDataLen) maxBlockDataLen = blk.data.length;
  }

  for (let i = 0; i < maxBlockDataLen; i++) {
    for (const blk of blocks) {
      if (i < blk.data.length) {
        for (let b = 7; b >= 0; b--) {
          interleavedBits.push((blk.data[i] >>> b) & 1);
        }
      }
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const blk of blocks) {
      if (i < blk.ec.length) {
        for (let b = 7; b >= 0; b--) {
          interleavedBits.push((blk.ec[i] >>> b) & 1);
        }
      }
    }
  }

  // Remainder bits
  for (let i = 0; i < spec.remainderBits; i++) {
    interleavedBits.push(0);
  }

  // Initialize Matrix
  const matrixSize = 17 + 4 * spec.version;
  const matrix: (boolean | null)[][] = Array.from({ length: matrixSize }, () =>
    Array(matrixSize).fill(null),
  );
  const isFunctionModule: boolean[][] = Array.from({ length: matrixSize }, () =>
    Array(matrixSize).fill(false),
  );

  // Helper to place module
  const setModule = (r: number, c: number, val: boolean, isFunc = true) => {
    matrix[r][c] = val;
    if (isFunc) isFunctionModule[r][c] = true;
  };

  // 1. Finder patterns (7x7) + Separators
  const placeFinder = (startRow: number, startCol: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBlack =
          r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setModule(startRow + r, startCol + c, isBlack);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, matrixSize - 7);
  placeFinder(matrixSize - 7, 0);

  // Separators around finders
  // Top-left separator
  for (let i = 0; i < 8; i++) {
    setModule(7, i, false);
    setModule(i, 7, false);
  }
  // Top-right separator
  for (let i = 0; i < 8; i++) {
    setModule(7, matrixSize - 8 + i, false);
    setModule(i, matrixSize - 8, false);
  }
  // Bottom-left separator
  for (let i = 0; i < 8; i++) {
    setModule(matrixSize - 8, i, false);
    setModule(matrixSize - 8 + i, 7, false);
  }

  // 2. Alignment patterns (5x5)
  const alignCoords = spec.alignmentPatterns;
  for (let i = 0; i < alignCoords.length; i++) {
    for (let j = 0; j < alignCoords.length; j++) {
      const cr = alignCoords[i];
      const cc = alignCoords[j];

      // Skip if overlapping with finder patterns
      if (
        (cr <= 8 && cc <= 8) ||
        (cr <= 8 && cc >= matrixSize - 8) ||
        (cr >= matrixSize - 8 && cc <= 8)
      ) {
        continue;
      }

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isBlack =
            r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          setModule(cr + r, cc + c, isBlack);
        }
      }
    }
  }

  // 3. Timing patterns
  for (let c = 8; c < matrixSize - 8; c++) {
    if (matrix[6][c] === null) {
      setModule(6, c, c % 2 === 0);
    }
  }
  for (let r = 8; r < matrixSize - 8; r++) {
    if (matrix[r][6] === null) {
      setModule(r, 6, r % 2 === 0);
    }
  }

  // 4. Dark Module
  setModule(4 * spec.version + 9, 8, true);

  // 5. Reserve Format Info area
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    isFunctionModule[8][i] = true;
    if (matrix[i][8] === null) matrix[i][8] = false;
    isFunctionModule[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    const r = matrixSize - 1 - i;
    matrix[r][8] = false;
    isFunctionModule[r][8] = true;

    const c = matrixSize - 8 + i;
    matrix[8][c] = false;
    isFunctionModule[8][c] = true;
  }

  // 6. Reserve Version Info area for version >= 7
  if (spec.version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        isFunctionModule[r][matrixSize - 11 + c] = true;
        isFunctionModule[matrixSize - 11 + c][r] = true;
      }
    }
  }

  // 7. Place data bits using Mask 0: (row + col) % 2 === 0
  let bitIndex = 0;
  let directionUp = true;

  for (let rightCol = matrixSize - 1; rightCol > 0; rightCol -= 2) {
    // Skip vertical timing column 6
    if (rightCol === 6) {
      rightCol--;
    }

    const rowRange: number[] = [];
    if (directionUp) {
      for (let r = matrixSize - 1; r >= 0; r--) rowRange.push(r);
    } else {
      for (let r = 0; r < matrixSize; r++) rowRange.push(r);
    }

    for (const r of rowRange) {
      for (let cOffset = 0; cOffset < 2; cOffset++) {
        const c = rightCol - cOffset;
        if (!isFunctionModule[r][c]) {
          let bit = 0;
          if (bitIndex < interleavedBits.length) {
            bit = interleavedBits[bitIndex++];
          }
          // Mask 0 pattern: invert if (r + c) % 2 === 0
          const maskInvert = (r + c) % 2 === 0;
          matrix[r][c] = maskInvert ? bit === 0 : bit === 1;
        }
      }
    }

    directionUp = !directionUp;
  }

  // 8. Place Format Information bits (Mask 0, Level L: 0x77c4)
  const formatBits = FORMAT_INFO_LEVEL_L[0];
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >>> (14 - i)) & 1) === 1;

    // First placement: around top-left
    let r1: number;
    let c1: number;
    if (i < 6) {
      r1 = 8;
      c1 = i;
    } else if (i === 6) {
      r1 = 8;
      c1 = 7;
    } else if (i === 7) {
      r1 = 8;
      c1 = 8;
    } else if (i === 8) {
      r1 = 7;
      c1 = 8;
    } else {
      r1 = 14 - i;
      c1 = 8;
    }
    matrix[r1][c1] = bit;

    // Second placement: bottom-left and top-right
    let r2: number;
    let c2: number;
    if (i < 7) {
      r2 = matrixSize - 1 - i;
      c2 = 8;
    } else {
      r2 = 8;
      c2 = matrixSize - 8 + (i - 7);
    }
    matrix[r2][c2] = bit;
  }

  // 9. Place Version Information for version >= 7
  if (spec.version >= 7 && VERSION_INFO[spec.version] !== undefined) {
    const vBits = VERSION_INFO[spec.version];
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> (17 - i)) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = i % 3;

      // Bottom-left block
      matrix[matrixSize - 11 + r][c] = bit;
      // Top-right block
      matrix[c][matrixSize - 11 + r] = bit;
    }
  }

  // Convert to non-null boolean matrix
  return matrix.map((row) => row.map((cell) => cell === true));
}
