// Snow Day as a desktop app (Electron): its own window, icon and full screen, no browser.
// Unbound starts it with the Play Snow Day button (or run: npx electron snowday).
// The game's files come from public/snowday and three.js from node_modules, through the app's own
// snowday:// address, so it doesn't need anything else running to open. Gifts come from Unbound.

const { app, BrowserWindow, protocol, net, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const GAME = path.join(ROOT, 'public', 'snowday');
const THREE = path.join(ROOT, 'node_modules', 'three');

// your level and snow are kept with Unbound's own data (kept through updates)
app.setPath('userData', path.join(ROOT, 'data', 'snowday-app'));
app.setName('Snow Day');
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([{ scheme: 'snowday', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Unbound's game link port (Look & settings can change it)
function wsPort() {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'settings.json'), 'utf8')).wsPort || 8765; } catch { return 8765; }
}

let win = null;
function open() {
    win = new BrowserWindow({
        width: 1280, height: 800, show: false, backgroundColor: '#0b1030', title: 'Snow Day',
        icon: path.join(ROOT, 'icon.ico'), autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
    });
    Menu.setApplicationMenu(null);
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.loadURL(`snowday://app/index.html?ws=${wsPort()}${process.env.SNOWDAY_JS ? '&test' : ''}`);
    // links never open inside the game
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    // (for testing) SNOWDAY_SHOT=<file.png>: saves a picture of the window after a few seconds and closes;
    // SNOWDAY_JS=<file.js>: runs that script in the game first (it's given the test hooks) and prints its result
    if (process.env.SNOWDAY_SHOT) {
        win.webContents.once('did-finish-load', () => setTimeout(async () => {
            await win.webContents.executeJavaScript("document.getElementById('start').classList.add('hidden'); window.__err = document.querySelector('pre')?.textContent || ''; window.__err");
            if (process.env.SNOWDAY_JS) console.log('JS', await win.webContents.executeJavaScript(`(async () => { ${fs.readFileSync(process.env.SNOWDAY_JS, 'utf8')} })()`).catch(e => 'ERROR ' + e.message));
            setTimeout(async () => {
                const err = await win.webContents.executeJavaScript('window.__err + (document.querySelector("pre")?.textContent || "") + " | link: " + document.getElementById("linkText").textContent + " | snow: " + document.getElementById("count").textContent');
                fs.writeFileSync(process.env.SNOWDAY_SHOT, (await win.webContents.capturePage()).toPNG());
                console.log('SHOT', err);
                app.quit();
            }, 2500);
        }, 6000));
    }
}

app.whenReady().then(() => {
    protocol.handle('snowday', req => {
        const url = new URL(req.url);
        let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = rel.startsWith('vendor/three/') ? path.join(THREE, rel.slice('vendor/three/'.length)) : path.join(GAME, rel || 'index.html');
        const base = rel.startsWith('vendor/three/') ? THREE : GAME;
        if (!path.resolve(file).startsWith(base)) return new Response('Not allowed', { status: 403 });
        return net.fetch(pathToFileURL(file).toString());
    });
    ipcMain.on('fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));
    open();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
