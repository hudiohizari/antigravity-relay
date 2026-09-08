declare module 'electron-packager-languages' {
  type AfterCopyHook = (
    buildPath: string,
    electronVersion: string,
    platform: string,
    arch: string,
    callback: () => void,
  ) => void;

  interface SetLanguagesOptions {
    allowRemovingAll?: boolean;
  }

  function setLanguages(languages: string[], options?: SetLanguagesOptions): AfterCopyHook;

  export = setLanguages;
}

declare module '@pengx17/electron-forge-maker-appimage' {
  import type MakerBase from '@electron-forge/maker-base';
  import type { ForgePlatform } from '@electron-forge/shared-types';

  export interface AppImageForgeConfig {
    template?: string;
    chmodChromeSandbox?: string;
    icons?: { file: string; size: number }[];
  }

  export interface MakerAppImageConfig {
    config?: AppImageForgeConfig;
  }

  export default class MakerAppImage extends MakerBase<MakerAppImageConfig> {
    name: string;
    defaultPlatforms: ForgePlatform[];
    isSupportedOnCurrentPlatform(): boolean;
  }
}
