'use strict';
// Мост окна трекера аватара: получает команды от приложения и отдаёт результаты. Больше ничего окну не доступно.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('avatarHost', {
  onCmd: (cb) => { if (typeof cb === 'function') ipcRenderer.on('av:cmd', (_e, c) => cb(c)); },
  reply: (id, data) => ipcRenderer.send('av:reply', id, data),
  frame: (p) => ipcRenderer.send('av:frame', p),
  state: (s) => ipcRenderer.send('av:state', s),
  ready: () => ipcRenderer.send('av:ready'),
});
