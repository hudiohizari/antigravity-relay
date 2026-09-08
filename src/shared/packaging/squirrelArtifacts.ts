import * as fs from 'fs';
import * as path from 'path';

interface NormalizeSquirrelArtifactsInput {
  artifacts: string[];
  platform: string;
  arch: string;
}

const SQUIRREL_PACKAGE_REGEX =
  /^(?<base>.+?)(?:-(?<arch>[A-Za-z0-9_]+))?-(?<kind>full|delta)\.nupkg$/;

function getQualifiedSquirrelPackageName(fileName: string, arch: string) {
  const match = SQUIRREL_PACKAGE_REGEX.exec(fileName);
  const groups = match?.groups;
  if (!groups?.base || !groups.kind) {
    return fileName;
  }

  if (groups.arch === arch) {
    return fileName;
  }

  return `${groups.base}-${arch}-${groups.kind}.nupkg`;
}

function renameArtifact(artifact: string, fileName: string) {
  const nextArtifact = path.join(path.dirname(artifact), fileName);
  if (nextArtifact !== artifact) {
    fs.renameSync(artifact, nextArtifact);
  }

  return nextArtifact;
}

export function normalizeSquirrelArtifacts({
  artifacts,
  platform,
  arch,
}: NormalizeSquirrelArtifactsInput) {
  if (platform !== 'win32' || arch === 'x64') {
    return artifacts;
  }

  const packageNameReplacements = new Map<string, string>();
  const nextArtifacts = artifacts.map((artifact) => {
    const fileName = path.basename(artifact);
    if (!fileName.endsWith('.nupkg')) {
      return artifact;
    }

    const nextFileName = getQualifiedSquirrelPackageName(fileName, arch);
    if (nextFileName !== fileName) {
      packageNameReplacements.set(fileName, nextFileName);
    }

    return renameArtifact(artifact, nextFileName);
  });

  return nextArtifacts.map((artifact) => {
    const fileName = path.basename(artifact);
    if (fileName !== 'RELEASES') {
      return artifact;
    }

    let releaseContent = fs.readFileSync(artifact, 'utf8');
    for (const [oldName, nextName] of packageNameReplacements.entries()) {
      releaseContent = releaseContent.replaceAll(oldName, nextName);
    }
    fs.writeFileSync(artifact, releaseContent);

    return artifact;
  });
}
