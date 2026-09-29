// Bridge between the editor page and Electron: files, dialogs, recent projects and closing.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  recents: () => ipcRenderer.invoke('recents'),
  removeRecent: path => ipcRenderer.invoke('recents-remove', path),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  read: path => ipcRenderer.invoke('read', path),
  save: (path, text) => ipcRenderer.invoke('save', path, text),
  saveDialog: name => ipcRenderer.invoke('save-dialog', name),
  confirmUnsaved: texts => ipcRenderer.invoke('confirm-unsaved', texts),
  pendingOpen: () => ipcRenderer.invoke('pending-open'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  showInFolder: path => ipcRenderer.invoke('show-in-folder', path),
  window: action => ipcRenderer.invoke('window', action),
  exportFiles: (files, title, folder) => ipcRenderer.invoke('export-files', files, title, folder),
  openFolder: folder => ipcRenderer.invoke('open-folder', folder),
  importDialog: title => ipcRenderer.invoke('import-dialog', title),
  recoveryWrite: (id, meta, text) => ipcRenderer.invoke('recovery-write', id, meta, text),
  recoveryRemove: id => ipcRenderer.invoke('recovery-remove', id),
  recoveryRead: id => ipcRenderer.invoke('recovery-read', id),
  recoveryList: () => ipcRenderer.invoke('recovery-list'),
  copyImage: data => ipcRenderer.invoke('clipboard-image', data),
  copyText: text => ipcRenderer.invoke('clipboard-text', text),
  onRequestClose: cb => ipcRenderer.on('request-close', () => cb()),
  onOpenPath: cb => ipcRenderer.on('open-path', (_e, path) => cb(path))
});
