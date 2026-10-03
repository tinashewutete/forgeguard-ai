export interface ElectronAPI {
  platform: string;
  arch: string;
  versions: NodeJS.ProcessVersions;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
