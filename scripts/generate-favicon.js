const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

function generateFavicon() {
  const rootDir = path.resolve(__dirname, "..");
  const iconPngPath = path.join(rootDir, "images", "icon.png");
  const faviconIcoPath = path.join(rootDir, "images", "favicon.ico");
  const favicon32Path = path.join(rootDir, "images", "favicon-32.png");
  const size32Path = path.join(rootDir, "images", "32x32.png");

  if (!fs.existsSync(iconPngPath)) {
    throw new Error(`Source icon not found at ${iconPngPath}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "favicon-gen-"));
  const sizes = [16, 32, 48];
  const pngEntries = [];

  try {
    for (const size of sizes) {
      const outPng = path.join(tmpDir, `${size}.png`);
      execSync(`sips -z ${size} ${size} "${iconPngPath}" --out "${outPng}"`, {
        stdio: "pipe",
      });
      const buffer = fs.readFileSync(outPng);
      pngEntries.push({ size, buffer });

      if (size === 32) {
        fs.writeFileSync(favicon32Path, buffer);
        fs.writeFileSync(size32Path, buffer);
      }
    }

    // Pack into ICO
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type 1 = icon
    header.writeUInt16LE(sizes.length, 4); // count

    const dirEntries = [];
    let offset = 6 + 16 * sizes.length;

    for (const item of pngEntries) {
      const entry = Buffer.alloc(16);
      entry.writeUInt8(item.size === 256 ? 0 : item.size, 0);
      entry.writeUInt8(item.size === 256 ? 0 : item.size, 1);
      entry.writeUInt8(0, 2); // color count
      entry.writeUInt8(0, 3); // reserved
      entry.writeUInt16LE(1, 4); // planes
      entry.writeUInt16LE(32, 6); // bit count
      entry.writeUInt32LE(item.buffer.length, 8); // bytes in res
      entry.writeUInt32LE(offset, 12); // image offset
      dirEntries.push(entry);
      offset += item.buffer.length;
    }

    const icoBuffer = Buffer.concat([
      header,
      ...dirEntries,
      ...pngEntries.map((p) => p.buffer),
    ]);
    fs.writeFileSync(faviconIcoPath, icoBuffer);
    console.log(
      `Successfully generated favicon.ico (${icoBuffer.length} bytes) with sizes: ${sizes.join(", ")}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

generateFavicon();
