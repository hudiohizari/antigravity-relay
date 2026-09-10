import fs from 'fs';
import path from 'path';

export function ensureWinstaller7z(baseDir = process.cwd(), hostArch = process.arch) {
  const vendorDir = path.resolve(baseDir, 'node_modules/electron-winstaller/vendor');

  if (!fs.existsSync(vendorDir)) {
    return { status: 'skipped', reason: 'vendor directory not found' };
  }

  const effectiveArch = hostArch === 'arm64' ? 'arm64' : 'x64';
  let exeSrc = path.join(vendorDir, `7z-${effectiveArch}.exe`);
  let dllSrc = path.join(vendorDir, `7z-${effectiveArch}.dll`);

  if (!fs.existsSync(exeSrc)) {
    exeSrc = path.join(vendorDir, '7z-x64.exe');
  }
  if (!fs.existsSync(dllSrc)) {
    dllSrc = path.join(vendorDir, '7z-x64.dll');
  }

  const exeDst = path.join(vendorDir, '7z.exe');
  const dllDst = path.join(vendorDir, '7z.dll');

  let exeCopied = false;
  let dllCopied = false;

  if (fs.existsSync(exeSrc) && !fs.existsSync(exeDst)) {
    fs.copyFileSync(exeSrc, exeDst);
    exeCopied = true;
  }

  if (fs.existsSync(dllSrc) && !fs.existsSync(dllDst)) {
    fs.copyFileSync(dllSrc, dllDst);
    dllCopied = true;
  }

  return {
    status: 'ok',
    vendorDir,
    arch: effectiveArch,
    exeCopied,
    dllCopied,
    exeExists: fs.existsSync(exeDst),
    dllExists: fs.existsSync(dllDst),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const res = ensureWinstaller7z();
  console.log('[ensure-winstaller-7z]', JSON.stringify(res));
}
