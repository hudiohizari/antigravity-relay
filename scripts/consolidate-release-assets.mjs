import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
export function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursive(fullPath);
    }
    if (entry.isFile()) {
      return [fullPath];
    }
    return [];
  });
}

export function parseArgs(argv) {
  const result = {
    sourceDir: 'release-assets',
    outputDir: 'dist-release-assets',
    legacyReleases: 'github-release-assets/RELEASES',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--source=')) {
      result.sourceDir = arg.split('=')[1];
    } else if (arg === '--source') {
      result.sourceDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--output=')) {
      result.outputDir = arg.split('=')[1];
    } else if (arg === '--output') {
      result.outputDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--legacy-releases=')) {
      result.legacyReleases = arg.split('=')[1];
    } else if (arg === '--legacy-releases') {
      result.legacyReleases = argv[index + 1];
      index += 1;
    }
  }

  return result;
}

function parseValue(key, val) {
  const clean = val.replace(/^['"]|['"]$/g, '');
  if (key === 'size' || key === 'blockMapSize' || key === 'stagingPercentage') {
    const num = Number(clean);
    return isNaN(num) ? clean : num;
  }
  if (key === 'isAdminRightsRequired') {
    return clean === 'true';
  }
  return clean;
}

export function parseYamlManifest(yamlText) {
  if (!yamlText || !yamlText.trim()) return { files: [] };
  const lines = yamlText.split(/\r?\n/);
  const result = { files: [] };
  let inFiles = false;
  let currentFile = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      const colonIdx = line.indexOf(':');
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();

      if (key === 'files') {
        inFiles = true;
        if (currentFile) {
          result.files.push(currentFile);
          currentFile = null;
        }
        continue;
      }

      inFiles = false;
      if (currentFile) {
        result.files.push(currentFile);
        currentFile = null;
      }
      result[key] = parseValue(key, val);
      continue;
    }

    if (inFiles) {
      if (trimmed.startsWith('- ')) {
        if (currentFile) {
          result.files.push(currentFile);
        }
        currentFile = {};
        const rest = trimmed.slice(2).trim();
        const colonIdx = rest.indexOf(':');
        if (colonIdx > -1) {
          const key = rest.slice(0, colonIdx).trim();
          const rawVal = rest.slice(colonIdx + 1).trim();
          currentFile[key] = parseValue(key, rawVal);
        }
      } else if (currentFile) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > -1) {
          const key = trimmed.slice(0, colonIdx).trim();
          const rawVal = trimmed.slice(colonIdx + 1).trim();
          currentFile[key] = parseValue(key, rawVal);
        }
      }
    }
  }

  if (currentFile) {
    result.files.push(currentFile);
  }

  return result;
}

export function stringifyYamlManifest(doc) {
  const lines = [];
  if (doc.version) lines.push(`version: ${doc.version}`);
  if (Array.isArray(doc.files) && doc.files.length > 0) {
    lines.push('files:');
    for (const f of doc.files) {
      const keys = Object.keys(f);
      if (keys.length === 0) continue;
      lines.push(`  - ${keys[0]}: ${f[keys[0]]}`);
      for (let i = 1; i < keys.length; i += 1) {
        lines.push(`    ${keys[i]}: ${f[keys[i]]}`);
      }
    }
  }
  for (const [key, val] of Object.entries(doc)) {
    if (key === 'version' || key === 'files') continue;
    if (val != null) lines.push(`${key}: ${val}`);
  }
  return lines.join('\n') + '\n';
}

export function mergeYamlManifests(existingYamlText, newYamlText) {
  if (!existingYamlText) return newYamlText;
  const existingDoc = parseYamlManifest(existingYamlText);
  const newDoc = parseYamlManifest(newYamlText);

  const mergedFiles = [...(existingDoc.files || [])];
  const knownUrls = new Set(mergedFiles.map((f) => f.url));

  for (const file of newDoc.files || []) {
    if (!knownUrls.has(file.url)) {
      mergedFiles.push(file);
      knownUrls.add(file.url);
    }
  }

  const mergedDoc = {
    version: newDoc.version || existingDoc.version,
    files: mergedFiles,
    path: existingDoc.path || newDoc.path,
    sha512: existingDoc.sha512 || newDoc.sha512,
    releaseDate: newDoc.releaseDate || existingDoc.releaseDate,
  };

  return stringifyYamlManifest(mergedDoc);
}

export function consolidateReleaseAssets({
  sourceDir = 'release-assets',
  outputDir = 'dist-release-assets',
  legacyReleases = 'github-release-assets/RELEASES',
} = {}) {
  const allSourceFiles = listFilesRecursive(sourceDir);
  if (allSourceFiles.length === 0) {
    throw new Error(`No files found in source directory: ${sourceDir}`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const yamlByBasename = new Map();
  const copiedFiles = new Map();

  for (const filePath of allSourceFiles) {
    const base = path.basename(filePath);

    // Skip nested RELEASES manifests; legacy feed is handled explicitly
    if (base === 'RELEASES') {
      continue;
    }

    if (base.endsWith('.yml') || base.endsWith('.yaml')) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const existing = yamlByBasename.get(base);
      yamlByBasename.set(base, mergeYamlManifests(existing, content));
      continue;
    }

    // Binary installer / package / checksum file
    const destPath = path.join(outputDir, base);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(filePath, destPath);
      copiedFiles.set(base, destPath);
    }
  }

  // Write merged YAML files
  for (const [base, yamlContent] of yamlByBasename.entries()) {
    const destPath = path.join(outputDir, base);
    fs.writeFileSync(destPath, yamlContent);
    copiedFiles.set(base, destPath);
  }

  // Include legacy RELEASES feed if provided
  if (legacyReleases && fs.existsSync(legacyReleases)) {
    const destPath = path.join(outputDir, 'RELEASES');
    fs.copyFileSync(legacyReleases, destPath);
    copiedFiles.set('RELEASES', destPath);
  }

  return {
    outputDir,
    totalFiles: copiedFiles.size,
    files: [...copiedFiles.keys()].sort(),
  };
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = consolidateReleaseAssets(options);
  console.log(`[consolidate-release-assets] Consolidated ${result.totalFiles} unique assets in ${result.outputDir}:`);
  for (const file of result.files) {
    console.log(`  - ${file}`);
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  runCli();
}
