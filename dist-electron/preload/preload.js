import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
  // Platform info
  platform: process.platform,
  arch: process.arch,
  versions: process.versions
  // Example: you can add IPC handlers here for future Node.js features
  // Example: read a file
  // readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
});
