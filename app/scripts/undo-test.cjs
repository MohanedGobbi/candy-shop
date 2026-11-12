// Undo: each action can be reversed, undo is recorded as a new synced event,
// and a second PC replaying the log ends up in the same state.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("../electron/db.cjs");

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), "undo-" + n + "-"));
const a = new Store(tmp("a"));
const last = (s) => s.events[s.events.length - 1];
const find = (s, type) => [...s.events].reverse().find((e) => e.type === type && !(e.payload || {}).undoOf);

// Product create -> undo removes it.
a.upsertProduct({ code: "P1", name: "Bonbon", price: 50, stock: 10 });
assert.ok(a.undo(find(a, "product_upsert").id).ok);
assert.ok(a.products.P1.deleted, "undoing a create deletes the product");

// Recreate, then edit price+stock, sell 2, undo edit -> old price, stock keeps the sale.
a.upsertProduct({ code: "P2", name: "Choco", price: 100, stock: 20 });
a.upsertProduct({ code: "P2", name: "Choco", price: 120, stock: 25 });
const edit = find(a, "product_upsert");
const sale = a.confirmSale({ lines: [{ code: "P2", name: "Choco", price: 120, qty: 2 }], total: 240 });
assert.strictEqual(a.products.P2.stock, 23);
assert.ok(a.undo(edit.id).ok);
assert.strictEqual(a.products.P2.price, 100, "price restored");
assert.strictEqual(a.products.P2.stock, 18, "stock back to 20, minus the 2 sold since");
assert.ok(!a.undo(edit.id).ok, "cannot undo twice");

// Stock +/- undo.
a.adjustStock("P2", 5, "manuel");
assert.ok(a.undo(find(a, "stock_adjust").id).ok);
assert.strictEqual(a.products.P2.stock, 18);

// Sale -> undo cancels it; cancel -> undo restores it.
const saleEv = a.events.find((e) => e.type === "sale_confirm" && e.payload.id === sale.id);
assert.ok(a.undo(saleEv.id).ok);
assert.strictEqual(a.sales[0].cancelled, true);
assert.strictEqual(a.products.P2.stock, 20);
const sale2 = a.confirmSale({ lines: [{ code: "P2", name: "Choco", price: 120, qty: 2 }], total: 240 });
a.cancelSale(sale2.id); // cancelled from Historique
assert.strictEqual(a.products.P2.stock, 20);
assert.ok(a.undo(find(a, "sale_cancel").id).ok, "a cancellation can be undone");
assert.strictEqual(a.sales[1].cancelled, false);
assert.strictEqual(a.products.P2.stock, 18);

// Delete -> undo brings it back.
a.deleteProduct("P2");
assert.ok(a.undo(find(a, "product_delete").id).ok);
assert.ok(!a.products.P2.deleted);

// An older edit cannot be undone once a newer edit exists.
a.upsertProduct({ code: "P2", name: "Choco", price: 130, stock: 18 });
const older = find(a, "product_upsert");
a.upsertProduct({ code: "P2", name: "Choco noir", price: 130, stock: 18 });
assert.strictEqual(a.undo(older.id).reason, "changed_since");

// Activity log lists actions with undo state.
const log = a.listActivity();
assert.ok(log.length > 5 && log.some((x) => x.undone) && log.some((x) => x.isUndo));

// Replay the whole log on a second PC (as the sync does): same state.
const b = new Store(tmp("b"));
for (const ev of a.events) b.applyEvent({ id: ev.id, ts: ev.ts, pc: ev.pc, type: ev.type, payload: ev.payload });
for (const code of ["P1", "P2"]) {
  assert.strictEqual(!!b.products[code].deleted, !!a.products[code].deleted, code + " deleted matches");
  assert.strictEqual(b.products[code].stock, a.products[code].stock, code + " stock matches");
  assert.strictEqual(b.products[code].price, a.products[code].price, code + " price matches");
}
assert.strictEqual(b.sales[0].cancelled, a.sales[0].cancelled);
assert.strictEqual(b.sales[1].cancelled, a.sales[1].cancelled);
assert.ok(!b.undo(edit.id).ok, "undone mark syncs to the other PC");

console.log("ALL UNDO TESTS PASSED");
