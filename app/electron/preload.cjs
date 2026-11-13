"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),

  listProducts: () => ipcRenderer.invoke("products:list"),
  upsertProduct: (fields) => ipcRenderer.invoke("products:upsert", fields),
  deleteProduct: (code) => ipcRenderer.invoke("products:delete", code),
  adjustStock: (code, delta, reason) => ipcRenderer.invoke("products:adjustStock", { code, delta, reason }),
  findByBarcode: (code) => ipcRenderer.invoke("products:findByBarcode", code),

  confirmSale: (sale) => ipcRenderer.invoke("sales:confirm", sale),
  cancelSale: (id) => ipcRenderer.invoke("sales:cancel", id),
  salesForDay: (start, end) => ipcRenderer.invoke("sales:forDay", { start, end }),

  listActivity: (opts) => ipcRenderer.invoke("activity:list", opts),
  undo: (id) => ipcRenderer.invoke("activity:undo", id),
  restoreSale: (id) => ipcRenderer.invoke("sales:restore", id),
  listNotes: () => ipcRenderer.invoke("notes:list"),
  upsertNote: (fields) => ipcRenderer.invoke("notes:upsert", fields),
  payNote: (id, amount) => ipcRenderer.invoke("notes:pay", { id, amount }),
  deleteNote: (id) => ipcRenderer.invoke("notes:delete", id),

  getUpdate: () => ipcRenderer.invoke("update:get"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  appVersion: () => ipcRenderer.invoke("app:version"),
  beep: () => ipcRenderer.invoke("app:beep"),
  onUpdate: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("update:status", h);
    return () => ipcRenderer.removeListener("update:status", h);
  },

  onF11: (cb) => {
    const h = () => cb();
    ipcRenderer.on("key:f11", h);
    return () => ipcRenderer.removeListener("key:f11", h);
  },

  syncNow: () => ipcRenderer.invoke("sync:now"),
  onSyncStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on("sync:status", handler);
    return () => ipcRenderer.removeListener("sync:status", handler);
  }
});
