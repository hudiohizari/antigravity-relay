import crypto from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MIB = 1024 * 1024;

export const DEFAULT_AUDIT_BUDGETS = {
  minSizeMiB: 10,
  maxSizeMiB: 250,
  maxAsarMiB: 150,
};

export function bytesToMiB(bytes) {
  return bytes / MIB;
}

export function listFilesRecursive(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = readdirSync(rootDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursive(entryPath);
    }
    if (entry.isFile()) {
      return [entryPath];
    }
    return [];
  });
}

export function parseArgs(argv) {
  const result = {
    platform: process.env.TARGET_PLATFORM || process.platform,
    arch: process.env.TARGET_ARCH || process.arch,
    rootDir: process.cwd(),
    minSizeMiB: process.env.AUDIT_MIN_SIZE_MB
      ? Number(process.env.AUDIT_MIN_SIZE_MB)
      : DEFAULT_AUDIT_BUDGETS.minSizeMiB,
    maxSizeMiB: process.env.AUDIT_MAX_SIZE_MB
      ? Number(process.env.AUDIT_MAX_SIZE_MB)
      : DEFAULT_AUDIT_BUDGETS.maxSizeMiB,
    maxAsarMiB: process.env.AUDIT_MAX_ASAR_MB
      ? Number(process.env.AUDIT_MAX_ASAR_MB)
      : DEFAULT_AUDIT_BUDGETS.maxAsarMiB,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith('--platform=')) {
      result.platform = arg.split('=')[1];
    } else if (arg === '--platform') {
      result.platform = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--arch=')) {
      result.arch = arg.split('=')[1];
    } else if (arg === '--arch') {
      result.arch = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--root-dir=')) {
      result.rootDir = arg.split('=')[1];
    } else if (arg === '--root-dir') {
      result.rootDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--min-size-mb=')) {
      result.minSizeMiB = Number(arg.split('=')[1]);
    } else if (arg === '--min-size-mb') {
      result.minSizeMiB = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--max-size-mb=')) {
      result.maxSizeMiB = Number(arg.split('=')[1]);
    } else if (arg === '--max-size-mb') {
      result.maxSizeMiB = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--max-asar-mb=')) {
      result.maxAsarMiB = Number(arg.split('=')[1]);
    } else if (arg === '--max-asar-mb') {
      result.maxAsarMiB = Number(argv[index + 1]);
      index += 1;
    }
  }

  return result;
}

function normalizePlatform(platform) {
  if (platform === 'windows' || platform === 'win32') {
    return 'win32';
  }
  if (platform === 'mac' || platform === 'macos' || platform === 'darwin') {
    return 'darwin';
  }
  return 'linux';
}

function getExpectedInstallers(platform) {
  const normPlatform = normalizePlatform(platform);
  if (normPlatform === 'win32') {
    return [
      {
        id: 'setupExe',
        label: 'Windows setup executable (.exe)',
        pattern: /\.exe$/,
      },
      {
        id: 'fullNupkg',
        label: 'Squirrel full package (.nupkg)',
        pattern: /-full\.nupkg$/,
      },
      {
        id: 'releases',
        label: 'Squirrel RELEASES manifest',
        pattern: /(^|[/\\])RELEASES$/,
        skipSizeCheck: true,
      },
    ];
  }

  if (normPlatform === 'darwin') {
    return [
      {
        id: 'dmg',
        label: 'macOS disk image (.dmg)',
        pattern: /\.dmg$/,
      },
      {
        id: 'zip',
        label: 'macOS update archive (.zip)',
        pattern: /\.zip$/,
      },
    ];
  }

  return [
    {
      id: 'deb',
      label: 'Debian package (.deb)',
      pattern: /\.deb$/,
    },
    {
      id: 'rpm',
      label: 'RedHat package (.rpm)',
      pattern: /\.rpm$/,
    },
  ];
}

function getExpectedMetadataFiles(platform, arch) {
  const normPlatform = normalizePlatform(platform);
  if (normPlatform === 'win32') {
    return [
      {
        id: 'latestYml',
        label: 'electron-updater metadata (latest.yml)',
        pattern: /(^|[/\\])latest\.yml$/,
      },
      {
        id: 'sha256sums',
        label: `SHA-256 checksum manifest for win32/${arch}`,
        pattern: new RegExp(`(^|[\\/\\\\])sha256sums-(?:windows|win32)-${arch}\\.txt$`),
      },
    ];
  }

  if (normPlatform === 'darwin') {
    return [
      {
        id: 'latestMacYml',
        label: 'electron-updater metadata (latest-mac.yml)',
        pattern: /(^|[/\\])latest-mac\.yml$/,
      },
      {
        id: 'sha256sums',
        label: `SHA-256 checksum manifest for darwin/${arch}`,
        pattern: new RegExp(`(^|[\\/\\\\])sha256sums-(?:mac|darwin)-${arch}\\.txt$`),
      },
    ];
  }

  const linuxArchPatterns = arch === 'arm64' ? ['aarch64', 'arm64'] : ['amd64', 'x64', 'x86_64'];
  const archRegex = `(?:${linuxArchPatterns.join('|')})`;

  return [
    {
      id: 'latestLinuxYml',
      label: `electron-updater metadata (latest-linux*.yml)`,
      pattern: /(^|[/\\])latest-linux.*\.yml$/,
    },
    {
      id: 'sha256sums',
      label: `SHA-256 checksum manifest for linux/${arch}`,
      pattern: new RegExp(`(^|[\\/\\\\])sha256sums-linux-${archRegex}\\.txt$`),
    },
  ];
}

export function auditBuildArtifacts(options = {}) {
  const config = {
    ...parseArgs([]),
    ...options,
  };

  const { rootDir, minSizeMiB, maxSizeMiB, maxAsarMiB } = config;
  const platform = normalizePlatform(config.platform);
  const arch = config.arch;

  const outDir = path.join(rootDir, 'out');
  const makeDir = path.join(outDir, 'make');
  const allMakeFiles = listFilesRecursive(makeDir);
  const allOutFiles = listFilesRecursive(outDir);

  const checks = [];
  const errors = [];

  // 1. Check existence of expected installer files & size budgets
  const expectedInstallers = getExpectedInstallers(platform);
  for (const installer of expectedInstallers) {
    const matchedFiles = allMakeFiles.filter((filePath) => installer.pattern.test(filePath));

    if (matchedFiles.length === 0) {
      const msg = `Missing expected installer file: ${installer.label}`;
      checks.push({ name: installer.id, status: 'FAIL', message: msg });
      errors.push(msg);
      continue;
    }

    const targetFile = matchedFiles[0];
    const { size } = statSync(targetFile);
    const sizeMiB = bytesToMiB(size);

    if (installer.skipSizeCheck) {
      checks.push({
        name: installer.id,
        status: 'PASS',
        message: `${installer.label} exists (${size} bytes)`,
        filePath: targetFile,
      });
      continue;
    }

    if (sizeMiB < minSizeMiB) {
      const msg = `${installer.label} size (${sizeMiB.toFixed(2)} MiB) is below minimum required ${minSizeMiB} MiB`;
      checks.push({ name: installer.id, status: 'FAIL', message: msg, filePath: targetFile });
      errors.push(msg);
    } else if (sizeMiB > maxSizeMiB) {
      const msg = `${installer.label} size (${sizeMiB.toFixed(2)} MiB) exceeds maximum budget ${maxSizeMiB} MiB`;
      checks.push({ name: installer.id, status: 'FAIL', message: msg, filePath: targetFile });
      errors.push(msg);
    } else {
      checks.push({
        name: installer.id,
        status: 'PASS',
        message: `${installer.label} is valid (${sizeMiB.toFixed(2)} MiB within [${minSizeMiB}, ${maxSizeMiB}] MiB)`,
        filePath: targetFile,
      });
    }
  }

  // 2. Check metadata files (latest*.yml, sha256sums-*.txt)
  const expectedMetadata = getExpectedMetadataFiles(platform, arch);
  let checksumFilePath = null;

  for (const metadata of expectedMetadata) {
    const matchedFiles = allMakeFiles.filter((filePath) => metadata.pattern.test(filePath));

    if (matchedFiles.length === 0) {
      const msg = `Missing expected metadata file: ${metadata.label}`;
      checks.push({ name: metadata.id, status: 'FAIL', message: msg });
      errors.push(msg);
      continue;
    }

    const targetFile = matchedFiles[0];
    if (metadata.id === 'sha256sums') {
      checksumFilePath = targetFile;
    }

    checks.push({
      name: metadata.id,
      status: 'PASS',
      message: `${metadata.label} exists`,
      filePath: targetFile,
    });
  }

  // 3. Verify checksum file content matches generated binaries
  if (checksumFilePath && existsSync(checksumFilePath)) {
    const content = readFileSync(checksumFilePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      const msg = `Checksum file is empty: ${checksumFilePath}`;
      checks.push({ name: 'checksumContent', status: 'FAIL', message: msg });
      errors.push(msg);
    } else {
      let allChecksumsValid = true;
      for (const line of lines) {
        const match = line.match(/^([0-9a-fA-F]{64})\s+(.+)$/);
        if (!match) {
          const msg = `Malformed checksum line in ${path.basename(checksumFilePath)}: '${line}'`;
          checks.push({ name: 'checksumLine', status: 'FAIL', message: msg });
          errors.push(msg);
          allChecksumsValid = false;
          continue;
        }

        const [, expectedHash, fileName] = match;
        const targetArtifact = allMakeFiles.find(
          (filePath) => path.basename(filePath) === fileName.trim(),
        );

        if (!targetArtifact) {
          const msg = `Checksum file references missing artifact: ${fileName.trim()}`;
          checks.push({ name: `checksum-${fileName}`, status: 'FAIL', message: msg });
          errors.push(msg);
          allChecksumsValid = false;
          continue;
        }

        const fileBytes = readFileSync(targetArtifact);
        const actualHash = crypto.createHash('sha256').update(fileBytes).digest('hex');

        if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
          const msg = `Checksum mismatch for ${fileName.trim()}: expected ${expectedHash}, computed ${actualHash}`;
          checks.push({ name: `checksum-${fileName}`, status: 'FAIL', message: msg });
          errors.push(msg);
          allChecksumsValid = false;
        } else {
          checks.push({
            name: `checksum-${fileName}`,
            status: 'PASS',
            message: `Checksum verified for ${fileName.trim()} (${expectedHash.slice(0, 12)}...)`,
          });
        }
      }

      if (allChecksumsValid) {
        checks.push({
          name: 'checksumsVerified',
          status: 'PASS',
          message: `All ${lines.length} artifacts in ${path.basename(checksumFilePath)} verified successfully`,
        });
      }
    }
  }

  // 4. Packaged app.asar and unpacked native module audit
  const asarCandidates = allOutFiles.filter(
    (filePath) =>
      filePath.endsWith(`${path.sep}resources${path.sep}app.asar`) ||
      filePath.endsWith('Contents/Resources/app.asar') ||
      path.basename(filePath) === 'app.asar',
  );

  if (asarCandidates.length === 0) {
    const msg = `Missing app.asar in packaged output directory (${outDir})`;
    checks.push({ name: 'appAsar', status: 'FAIL', message: msg });
    errors.push(msg);
  } else {
    const asarPath = asarCandidates[0];
    const { size } = statSync(asarPath);
    const asarMiB = bytesToMiB(size);

    if (size === 0) {
      const msg = `app.asar exists but is empty (0 bytes): ${asarPath}`;
      checks.push({ name: 'appAsar', status: 'FAIL', message: msg });
      errors.push(msg);
    } else if (asarMiB > maxAsarMiB) {
      const msg = `app.asar size (${asarMiB.toFixed(2)} MiB) exceeds budget ${maxAsarMiB} MiB`;
      checks.push({ name: 'appAsar', status: 'FAIL', message: msg });
      errors.push(msg);
    } else {
      checks.push({
        name: 'appAsar',
        status: 'PASS',
        message: `app.asar verified (${asarMiB.toFixed(2)} MiB)`,
        filePath: asarPath,
      });
    }

    // Inspect app.asar.unpacked
    const unpackedDir = path.join(path.dirname(asarPath), 'app.asar.unpacked');
    const requiredModules = ['better-sqlite3', 'keytar'];

    if (!existsSync(unpackedDir)) {
      const msg = `Missing app.asar.unpacked directory at ${unpackedDir}`;
      checks.push({ name: 'asarUnpacked', status: 'FAIL', message: msg });
      errors.push(msg);
    } else {
      for (const modName of requiredModules) {
        const modInNodeModules = path.join(unpackedDir, 'node_modules', modName);
        const modDirect = path.join(unpackedDir, modName);
        const exists = existsSync(modInNodeModules) || existsSync(modDirect);

        if (!exists) {
          const msg = `Required native module '${modName}' not unpacked in ${unpackedDir}`;
          checks.push({ name: `unpack-${modName}`, status: 'FAIL', message: msg });
          errors.push(msg);
        } else {
          checks.push({
            name: `unpack-${modName}`,
            status: 'PASS',
            message: `Native module '${modName}' correctly unpacked`,
          });
        }
      }
    }
  }

  // 5. Check for disallowed dev files leaked into packaged output
  const disallowedPatterns = [
    { pattern: /(^|[/\\])\.env(\.[a-zA-Z0-9_-]+)?$/, label: 'Environment file (.env)' },
    { pattern: /\.map$/, label: 'Source map file (*.map)' },
    { pattern: /\.(test|spec)\.[cm]?[jt]sx?$/, label: 'Test file (*.test.* / *.spec.*)' },
    { pattern: /(^|[/\\])\.git([/\\]|$)/, label: 'Git internal directory (.git)' },
  ];

  // Only inspect packaged app folders under out/, excluding make/
  const packagedFiles = allOutFiles.filter((filePath) => !filePath.includes(`${path.sep}make${path.sep}`));
  let leakFound = false;

  for (const file of packagedFiles) {
    for (const rule of disallowedPatterns) {
      if (rule.pattern.test(file)) {
        const relPath = path.relative(rootDir, file);
        const msg = `Security/Hygiene failure: ${rule.label} leaked into packaged app: ${relPath}`;
        checks.push({ name: 'disallowedFile', status: 'FAIL', message: msg, filePath: file });
        errors.push(msg);
        leakFound = true;
        break;
      }
    }
  }

  if (!leakFound) {
    checks.push({
      name: 'hygiene',
      status: 'PASS',
      message: 'Zero development/debug files leaked into packaged output',
    });
  }

  return {
    ok: errors.length === 0,
    platform,
    arch,
    checks,
    errors,
  };
}

export function formatAuditReport(result) {
  const lines = [
    `==================================================`,
    `Build Artifact Audit Report: [${result.platform}-${result.arch}]`,
    `Status: ${result.ok ? 'SUCCESS (PASS)' : 'FAILED (FAIL)'}`,
    `==================================================`,
  ];

  for (const check of result.checks) {
    const symbol = check.status === 'PASS' ? '✓ [PASS]' : '✗ [FAIL]';
    lines.push(`${symbol} ${check.message}`);
  }

  if (!result.ok) {
    lines.push('');
    lines.push(`Total Errors: ${result.errors.length}`);
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }

  lines.push(`==================================================`);
  return lines.join('\n');
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = auditBuildArtifacts(options);
  console.log(formatAuditReport(result));

  if (!result.ok) {
    process.exit(1);
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  runCli();
}
