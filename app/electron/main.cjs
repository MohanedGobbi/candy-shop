"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { Store } = require("./db.cjs");
const { runSync } = require("./sync.cjs");

// Keep the data folder from before the renames (Candy Shop, now Mouza Shop), so existing
// products, sales and settings stay where they are.
app.setName("Mouza Shop");
app.setPath("userData", path.join(app.getPath("appData"), "Magasin"));
if (process.platform === "win32") app.setAppUserModelId("com.magasin.app");

let store;
let mainWindow;
let syncTimer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Mouza Shop",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // F11 confirms the sale on the Caisse page. Catch it here so Electron's
  // default menu does not use it for fullscreen.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      mainWindow.webContents.send("key:f11");
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function broadcastSyncStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sync:status", status);
  }
}

async function syncOnce() {
  if (!store) return;
  const result = await runSync(store);
  broadcastSyncStatus(result);
  return result;
}

// ---- Auto-update from GitHub Releases (installed app only) ----
let updateState = { status: "idle" };
function sendUpdate(state) {
  updateState = state;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:status", state);
}
function setupAutoUpdate() {
  if (!app.isPackaged) return; // dev runs never update themselves
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // installs on next close even if nobody clicks
  autoUpdater.on("update-available", (i) => sendUpdate({ status: "downloading", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => {
    try {
      const fs = require("fs");
      const p = path.join(app.getPath("userData"), "last_update_notes.json");
      fs.writeFileSync(p, JSON.stringify({
        version: i.version,
        releaseNotes: i.releaseNotes,
        releaseName: i.releaseName,
        date: Date.now()
      }));
    } catch {}
    sendUpdate({ status: "ready", version: i.version, releaseNotes: i.releaseNotes, releaseName: i.releaseName });
  });
  autoUpdater.on("error", () => sendUpdate({ status: "idle" })); // offline etc.: try again later
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10 * 1000);
  setInterval(check, 2 * 3600 * 1000);
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());
}
ipcMain.handle("update:get", () => updateState);
ipcMain.handle("update:getLastNotes", () => {
  try {
    const fs = require("fs");
    const p = path.join(app.getPath("userData"), "last_update_notes.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return null;
});
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:beep", () => {
  if (shell && typeof shell.beep === "function") shell.beep();
});

app.whenReady().then(() => {
  store = new Store(app.getPath("userData"));
  createWindow();
  setupAutoUpdate();

  // Sync every 15s. Each run is independent and safe to overlap-skip.
  let syncing = false;
  syncTimer = setInterval(async () => {
    if (syncing) return;
    syncing = true;
    try { await syncOnce(); } finally { syncing = false; }
  }, 15000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (syncTimer) clearInterval(syncTimer);
  if (process.platform !== "darwin") app.quit();
});

// ---------------- IPC ----------------

ipcMain.handle("settings:get", () => store.settings);
ipcMain.handle("settings:save", (_e, patch) => store.saveSettings(patch));

ipcMain.handle("products:list", () => store.listProducts());
ipcMain.handle("products:upsert", (_e, fields) => store.upsertProduct(fields));
ipcMain.handle("products:delete", (_e, code) => store.deleteProduct(code));
ipcMain.handle("products:adjustStock", (_e, { code, delta, reason }) => {
  store.adjustStock(code, delta, reason);
  return store.products[code];
});
ipcMain.handle("products:findByBarcode", (_e, code) => store.findByBarcode(code) || null);

ipcMain.handle("sales:confirm", (_e, sale) => store.confirmSale(sale));
ipcMain.handle("sales:cancel", (_e, id) => store.cancelSale(id));
ipcMain.handle("sales:forDay", (_e, { start, end }) => store.salesForDay(start, end));

ipcMain.handle("sync:now", () => syncOnce());

ipcMain.handle("activity:list", (_e, opts) => store.listActivity(opts || {}));
ipcMain.handle("activity:undo", (_e, id) => store.undo(id));
ipcMain.handle("sales:restore", (_e, id) => store.restoreSale(id));
ipcMain.handle("notes:list", () => store.listNotes());
ipcMain.handle("notes:upsert", (_e, fields) => store.upsertNote(fields));
ipcMain.handle("notes:pay", (_e, { id, amount }) => store.addNotePayment(id, amount));
ipcMain.handle("notes:delete", (_e, id) => store.deleteNote(id));
