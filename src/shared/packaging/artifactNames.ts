interface ArtifactFileNameInput {
  baseName: string;
  version: string;
  arch: string;
  extension: string;
}

export function getArtifactFileName({ baseName, version, arch, extension }: ArtifactFileNameInput) {
  if (extension === '.rpm') {
    return `${baseName}-${version}-1.${arch}${extension}`;
  }

  if (extension === '.deb') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  if (extension === '.AppImage') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  if (extension === '.dmg') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  if (extension === '.exe') {
    return `${baseName}-${version}-win32-${arch}-setup${extension}`;
  }

  if (extension === '.msi') {
    return `${baseName}_${version}_${arch}_en-US${extension}`;
  }

  if (extension === '.zip') {
    return `${baseName}_${version}_${arch}${extension}`;
  }

  return `${baseName}_${version}_${arch}${extension}`;
}
