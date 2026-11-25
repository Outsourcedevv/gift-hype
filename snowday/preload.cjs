// The little the game may ask of its window: full screen on F11.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snowdayApp', { fullscreen: () => ipcRenderer.send('fullscreen') });
