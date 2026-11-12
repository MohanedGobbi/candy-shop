// One-off: load the EasyCom product export into the real app's local data,
// then push every product as a sync event to the configured Google Sheet.
// Run with the app NOT running (it reads settings.json once at startup and
// would overwrite these files with its stale in-memory copy on exit).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Store } = require("../electron/db.cjs");
const { runSync } = require("../electron/sync.cjs");

const USER_DATA = path.join(os.homedir(), "AppData", "Roaming", "Magasin");
const TSV = process.argv[2];

function num(v) {
  v = (v || "").trim().replace(",", ".");
  if (v === "") return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
}

const lines = fs.readFileSync(TSV, "utf8").split(/\r?\n/).filter(Boolean);
const header = lines[0].split("\t");
const idx = (name) => header.indexOf(name);

const store = new Store(USER_DATA);
console.log("Using existing settings:", JSON.stringify(store.settings));
if (!store.settings.webAppUrl || !store.settings.syncKey) {
  console.log("No sync configured yet - import will only go local. Set up Paramètres first for the push step.");
}

let imported = 0;
let skipped = 0;
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split("\t");
  const name = (cols[idx("name")] || "").trim();
  if (!name) { skipped++; continue; }
  const extras = [cols[idx("bc2")], cols[idx("bc3")], cols[idx("bc4")], cols[idx("bc5")]]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  store.upsertProduct({
    name,
    barcode: (cols[idx("barcode")] || "").trim(),
    barcodes: extras,
    category: (cols[idx("category")] || "").trim(),
    price: num(cols[idx("price")]),
    cost: num(cols[idx("cost")]),
    priceWholesale: num(cols[idx("price_wholesale")]),
    stock: num(cols[idx("stock")]) || 0,
    unit: (cols[idx("unit")] || "").trim() || "Pièce",
    minStock: num(cols[idx("min_stock")])
  });
  imported++;
}
console.log(`Imported ${imported} products locally (${skipped} skipped - no name).`);

(async () => {
  if (!store.settings.webAppUrl || !store.settings.syncKey) {
    console.log("Skipping push (sync not configured).");
    return;
  }
  console.log("Pushing to the Google Sheet (this can take a little while for ~4500 rows)...");
  const result = await runSync(store);
  console.log("Sync result:", JSON.stringify(result));
})();
