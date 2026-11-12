const os = require("os");
const fs = require("fs");
const path = require("path");
const { Store } = require("../electron/db.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "magasin-test-"));
const store = new Store(tmp);

// add product
const p = store.upsertProduct({ name: "Test Savon", barcode: "123456", price: 150, cost: 90, stock: 10, unit: "Pièce" });
console.assert(p.stock === 10, "stock should start at 10, got " + p.stock);

// find by barcode
const found = store.findByBarcode("123456");
console.assert(found && found.name === "Test Savon", "findByBarcode failed");

// confirm a sale of 3
const sale = store.confirmSale({ lines: [{ code: p.code, name: p.name, qty: 3, price: 150 }], total: 450, given: 500, change: 50 });
console.assert(store.products[p.code].stock === 7, "stock after sale should be 7, got " + store.products[p.code].stock);

// cancel the sale -> stock restored
store.cancelSale(sale.id);
console.assert(store.products[p.code].stock === 10, "stock after cancel should be 10, got " + store.products[p.code].stock);

// stock adjust manual
store.adjustStock(p.code, -2, "manuel");
console.assert(store.products[p.code].stock === 8, "stock after manual adjust should be 8, got " + store.products[p.code].stock);

// simulate applying a remote event from another PC (idempotent replay)
const remoteEvent = { id: "remote-abc", ts: Date.now(), pc: "PC-OTHER", type: "stock_adjust", payload: { code: p.code, delta: 5 } };
const applied1 = store.applyEvent(remoteEvent);
const applied2 = store.applyEvent(remoteEvent); // replay should be a no-op
console.assert(applied1 === true && applied2 === false, "idempotent replay failed");
console.assert(store.products[p.code].stock === 13, "stock after remote +5 should be 13, got " + store.products[p.code].stock);

// unsynced events exist and can be marked synced
const unsynced = store.getUnsyncedEvents();
console.assert(unsynced.length > 0, "expected unsynced local events");
store.markEventsSynced(unsynced.map((e) => e.id));
console.assert(store.getUnsyncedEvents().length === 0, "events should be marked synced");

console.log("ALL SMOKE TESTS PASSED");
fs.rmSync(tmp, { recursive: true, force: true });
