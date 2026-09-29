// Electron shell: files, native dialogs, recent projects. The editor itself lives in the page (src/).
// The page is served from app://visual/ instead of file:// so its ES modules load like on a web server.
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, protocol, session, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const smoke = process.argv.includes('--smoke-test');
if (!smoke && !app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---------- settings (recent projects) ----------
// The self check keeps its saved file out of the real recent list.
const settingsDir = process.env.VISUAL_HOME || (smoke ? join(tmpdir(), `visual-smoke-${process.pid}`) : join(homedir(), '.visual'));
const settingsFile = join(settingsDir, 'settings.json');
function readSettings() {
  try { return { recents: [], ...JSON.parse(readFileSync(settingsFile, 'utf8')) }; } catch { return { recents: [] }; }
}
function writeSettings(s) { mkdirSync(settingsDir, { recursive: true }); writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }
function addRecent(path, name) {
  const s = readSettings();
  s.recents = [{ path, name, opened: new Date().toISOString() }, ...s.recents.filter(r => r.path.toLowerCase() !== path.toLowerCase())].slice(0, 12);
  writeSettings(s);
}
const recents = () => readSettings().recents.map(r => ({ ...r, missing: !existsSync(r.path) }));

// ---------- files ----------
const filters = [{ name: 'Visual design', extensions: ['visual'] }];
function readDoc(path) {
  const text = readFileSync(path, 'utf8');
  addRecent(path, basename(path, extname(path)));
  return { path, text };
}
// Writes next to the file first and then swaps it in, so a crash halfway never leaves a half-written design.
function writeDoc(path, text) {
  const tmp = `${path}.saving`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  addRecent(path, basename(path, extname(path)));
  return path;
}

let win, allowClose = false, pendingOpen = process.argv.slice(1).find(a => a.toLowerCase().endsWith('.visual') && existsSync(a)) || null;

ipcMain.handle('recents', () => recents());
ipcMain.handle('recents-remove', (_e, path) => { const s = readSettings(); s.recents = s.recents.filter(r => r.path !== path); writeSettings(s); return recents(); });
ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open design', filters, properties: ['openFile'] });
  return r.filePaths[0] ? readDoc(r.filePaths[0]) : null;
});
ipcMain.handle('read', (_e, path) => readDoc(path));
ipcMain.handle('save', (_e, path, text) => writeDoc(path, text));
ipcMain.handle('save-dialog', async (_e, name) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save design', defaultPath: join(app.getPath('documents'), `${name || 'Untitled'}.visual`), filters });
  return r.canceled ? null : r.filePath;
});
// The page passes the texts in the interface language: { message, detail, buttons: [save, discard, cancel] }.
ipcMain.handle('confirm-unsaved', async (_e, texts) => {
  const r = await dialog.showMessageBox(win, { type: 'question', defaultId: 0, cancelId: 2, noLink: true, ...texts });
  return ['save', 'discard', 'cancel'][r.response];
});
// Export: asks for a folder (unless one is given, as by the self check) and writes the files there.
// files: [{ name, data: ArrayBuffer | string }]. Returns { folder, names } or null when cancelled.
let lastExportDir = null;
ipcMain.handle('export-files', async (_e, files, title, folder) => {
  if (!folder) {
    const r = await dialog.showOpenDialog(win, { title, defaultPath: lastExportDir || app.getPath('pictures'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    folder = lastExportDir = r.filePaths[0];
  }
  mkdirSync(folder, { recursive: true });
  for (const f of files) writeFileSync(join(folder, basename(f.name)), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
  return { folder, names: files.map(f => basename(f.name)) };
});
ipcMain.handle('open-folder', (_e, folder) => shell.openPath(folder));
ipcMain.handle('clipboard-image', (_e, data) => clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(data))));
ipcMain.handle('clipboard-text', (_e, text) => clipboard.writeText(text));
ipcMain.handle('pending-open', () => { const p = pendingOpen; pendingOpen = null; return p; });
ipcMain.handle('close-window', () => { allowClose = true; win?.close(); });
ipcMain.handle('show-in-folder', (_e, path) => shell.showItemInFolder(path));
ipcMain.handle('window', (_e, action) => {
  if (action === 'devtools') win?.webContents.toggleDevTools();
  if (action === 'fullscreen') win?.setFullScreen(!win.isFullScreen());
});

async function createWindow() {
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = normalize(join(here, decodeURIComponent(pathname)));
    if (relative(here, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Lets the font menu list the fonts installed on this PC.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'local-fonts'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts');

  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 960, minHeight: 600,
    show: false, backgroundColor: '#0f1013', title: 'Visual',
    icon: join(here, 'resources', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#16171b', symbolColor: '#e8e9ed', height: 40 },
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.once('ready-to-show', () => { if (!smoke) { win.maximize(); win.show(); } });
  // Unsaved changes: the page decides (it knows whether the design changed) and calls close-window when done.
  win.on('close', e => {
    if (allowClose || smoke) return;
    e.preventDefault();
    win.webContents.send('request-close');
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await win.loadURL('app://visual/index.html');
  if (smoke) await runSmoke();
}

// Self check (npm run smoke / packaged exe --smoke-test [shot.png]): the editor starts, a design is made, drawn and
// saved and read back through the same code the buttons use.
async function runSmoke() {
  const shot = process.argv[process.argv.indexOf('--smoke-test') + 1];
  const startShot = process.argv.includes('--start-shot') && process.argv[process.argv.indexOf('--start-shot') + 1];
  if (startShot) {
    // The start screen and the template picker, before the check opens a design.
    win.setSize(1400, 860); win.show();
    await new Promise(r => setTimeout(r, 1000));
    writeFileSync(startShot, (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('[data-new]').click()`);
    await new Promise(r => setTimeout(r, 400));
    writeFileSync(startShot.replace(/\.png$/i, '-templates.png'), (await win.webContents.capturePage()).toPNG());
  }
  const out = join(app.getPath('temp'), `visual-smoke-${process.pid}.visual`);
  const result = await win.webContents.executeJavaScript(`window.__visual.smoke(${JSON.stringify(out)})`);
  console.log('SMOKE', JSON.stringify(result));
  if (shot && !shot.startsWith('--')) {
    win.setSize(1400, 860);
    win.show();
    await new Promise(r => setTimeout(r, 1200));
    writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  }
  // Its own files; the settings folder only when it is the temporary one made for the check.
  const temporary = [out, out.replace(/\.visual$/i, '-export'), ...(process.env.VISUAL_HOME ? [] : [settingsDir])];
  for (const p of temporary) rmSync(p, { recursive: true, force: true });
  app.exit(result.ok ? 0 : 1);
}

app.on('second-instance', (_e, argv) => {
  const file = argv.find(a => a.toLowerCase().endsWith('.visual') && existsSync(a));
  if (file) win?.webContents.send('open-path', file);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(createWindow).catch(err => { dialog.showErrorBox('Visual could not start', String(err.stack || err)); app.exit(1); });
