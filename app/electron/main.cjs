"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { Store } = require("./db.cjs");
const { runSync } = require("./sync.cjs");

// Keep the data folder from before the rename to "Candy Shop", so existing
// products, sales and settings stay where they are.
app.setName("Candy Shop");
app.setPath("userData", path.join(app.getPath("appData"), "Magasin"));
if (process.platform === "win32") app.setAppUserModelId("com.magasin.app");

let store;
let mainWindow;
let syncTimer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Candy Shop",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
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
  autoUpdater.on("update-downloaded", (i) => sendUpdate({ status: "ready", version: i.version }));
  autoUpdater.on("error", () => sendUpdate({ status: "idle" })); // offline etc.: try again later
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10 * 1000);
  setInterval(check, 2 * 3600 * 1000);
  ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());
}
ipcMain.handle("update:get", () => updateState);
ipcMain.handle("app:version", () => app.getVersion());

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
