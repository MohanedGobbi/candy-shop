// Runs apps-script/Code.gs against a tiny in-memory fake of SpreadsheetApp,
// to check the Produits / Ventes tabs are built and updated correctly.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeSheet(name) {
  const data = []; // rows of arrays, 1-based externally
  const sheet = {
    name, data, hidden: [],
    getLastRow: () => { let n = data.length; while (n && data[n - 1].every((v) => v === "")) n--; return n; },
    appendRow: (r) => { const n = sheet.getLastRow(); data.length = n; data.push(r.slice()); },
    setFrozenRows() {},
    hideColumns(c) { sheet.hidden.push(c); },
    getRange(row, col, nr = 1, nc = 1) {
      if (typeof row === "string") return { setNumberFormat() {} };
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((data[row - 1 + i] || [])[col - 1 + j] ?? ""))),
        setValues: (vals) => vals.forEach((r, i) => { const R = (data[row - 1 + i] ||= []); r.forEach((v, j) => (R[col - 1 + j] = v)); }),
        clearContent: () => { for (let i = 0; i < nr; i++) if (data[row - 1 + i]) for (let j = 0; j < nc; j++) data[row - 1 + i][col - 1 + j] = ""; }
      };
    }
  };
  return sheet;
}
const sheets = {};
const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({}) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 1 } },
  console, JSON, Date, Math, Number, String, Object
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx);

let t = 1000, n = 0;
const ev = (type, payload) => [`e${++n}`, ++t, "PC-A", type, JSON.stringify(payload)];
const post = (events) => ctx.doPost({ postData: { contents: JSON.stringify({ key: "CHANGE_ME", events }) } });
const prod = (code) => {
  const d = sheets.Produits.data; const r = d.find((x) => String(x[0]) === code);
  return r && { name: r[1], barcode: r[2], price: r[4], stock: r[7], deleted: r[10] };
};

// Existing log (like the 4,542 imported products) then the first push with the new script.
assert.ok(post([ev("product_upsert", { code: "1", name: "Biscuit", barcode: "0612", price: 200, stock: 10 })]).ok);
assert.ok(!sheets.Produits, "no slow rebuild inside a sync request");
ctx.rebuildViews(); // the user runs this once from the menu
assert.ok(sheets.Produits && sheets.Ventes, "tabs created by rebuild");
assert.deepStrictEqual(prod("1"), { name: "Biscuit", barcode: "0612", price: 200, stock: 10, deleted: "" });

// New product, edit, stock move, sale, cancel, restore, delete, undelete.
post([ev("product_upsert", { code: "2", name: "aaa", price: 50, stock: 4 })]);
assert.strictEqual(prod("2").name, "aaa", "new product appears in Produits");
post([ev("product_upsert", { code: "1", name: "Biscuit", price: 220, stock: 10 })]);
assert.strictEqual(prod("1").price, 220);
assert.strictEqual(prod("1").barcode, "0612", "fields not in the edit are kept");
const adj = ev("stock_adjust", { code: "1", delta: 5 });
post([adj]);
assert.strictEqual(prod("1").stock, 15);
post([adj]); // retried push after a timeout
assert.strictEqual(prod("1").stock, 15, "retried event not counted twice");
post([ev("sale_confirm", { id: "S1", date: 5000, pc: "PC-A", total: 440, lines: [{ code: "1", name: "Biscuit", qty: 2 }] })]);
assert.strictEqual(prod("1").stock, 13);
assert.strictEqual(sheets.Ventes.data[1][3], "Biscuit x2");
post([ev("sale_cancel", { id: "S1" })]);
assert.strictEqual(prod("1").stock, 15);
assert.strictEqual(sheets.Ventes.data[1][5], "Annulée");
post([ev("sale_restore", { id: "S1", undoOf: "x" })]);
assert.strictEqual(prod("1").stock, 13);
assert.strictEqual(sheets.Ventes.data[1][5], "");
post([ev("product_delete", { code: "2" })]);
assert.strictEqual(prod("2").deleted, "oui");
post([ev("product_upsert", { code: "2", deleted: false, undoOf: "y" })]);
assert.strictEqual(prod("2").deleted, "");
assert.strictEqual(prod("2").name, "aaa", "undelete keeps the name");

// Credit / debt notes -> Crédits tab.
post([ev("note_upsert", { id: "N1", kind: "credit", person: "Ahmed", phone: "0555123456", amount: 1500, note: "biscuits" })]);
const note = () => sheets["Crédits"].data.find((r) => r[0] === "N1");
assert.ok(note(), "note appears in Crédits");
assert.strictEqual(note()[3], "0555123456");
post([ev("note_payment", { id: "N1", amount: 500 })]);
post([ev("note_payment", { id: "N1", amount: 1000 })]);
assert.deepStrictEqual([note()[5], note()[6], note()[8]], [1500, 0, "Soldé"]);
post([ev("note_payment", { id: "N1", amount: -1000, undoOf: "z" })]);
assert.deepStrictEqual([note()[6], note()[8]], [1000, "En cours"]);
post([ev("note_upsert", { id: "N1", kind: "credit", person: "Ahmed B.", phone: "0555123456", amount: 1500, note: "biscuits + jus" })]);
assert.strictEqual(note()[2], "Ahmed B.");
assert.strictEqual(note()[5], 500, "edit keeps payments");
post([ev("note_upsert", { id: "N2", kind: "debt", person: "Fournisseur", amount: 30000, note: "" })]);
post([ev("note_delete", { id: "N2" })]);
assert.strictEqual(sheets["Crédits"].data.find((r) => r[0] === "N2")[8], "Supprimé");
const notesBefore = JSON.stringify(sheets["Crédits"].data.slice(0, 3).map((r) => r.slice(0, 9)));

// Rebuilding from the whole log gives the same tabs.
const before = JSON.stringify([sheets.Produits.data.slice(0, 3).map((r) => r.slice(0, 11)), sheets.Ventes.data.slice(0, 2)]);
ctx.rebuildViews();
const after = JSON.stringify([sheets.Produits.data.slice(0, 3).map((r) => r.slice(0, 11)), sheets.Ventes.data.slice(0, 2)]);
assert.strictEqual(after, before, "incremental updates match a full rebuild");
assert.strictEqual(JSON.stringify(sheets["Crédits"].data.slice(0, 3).map((r) => r.slice(0, 9))), notesBefore, "Crédits rebuild matches");

// Pull still works.
const pulled = ctx.doGet({ parameter: { key: "CHANGE_ME", action: "pull", after: "2" } });
assert.ok(pulled.ok && pulled.rows.length === n);

console.log("APPS SCRIPT VIEWS TEST PASSED");
