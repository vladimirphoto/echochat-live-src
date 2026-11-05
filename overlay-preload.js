'use strict';
// Мост между окном оверлея и приложением: окно получает только то, что нужно для показа, и может лишь менять свои настройки.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => { if (typeof cb === 'function') ipcRenderer.on(channel, (_e, data) => cb(data)); };

contextBridge.exposeInMainWorld('overlay', {
  state: () => ipcRenderer.invoke('ov:state'),      // { settings, stats, feed }
  set: (patch) => ipcRenderer.invoke('ov:set', patch),
  clear: () => ipcRenderer.invoke('ov:clear'),
  grip: (m) => ipcRenderer.send('ov:grip', m),      // растягивание за край: { phase: start|move|end, dir, dx, dy }
  close: () => ipcRenderer.send('ov:close'),
  onMsg: on('ov:msg'),
  onLike: on('ov:like'),
  onJoin: on('ov:join'),
  onLiker: on('ov:liker'),
  onStats: on('ov:stats'),
  onSettings: on('ov:settings'),
  onClear: on('ov:clear-feed'),
});
