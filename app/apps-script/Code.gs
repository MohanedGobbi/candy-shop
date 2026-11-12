// Paste this whole file into Extensions > Apps Script, in the Google Sheet
// that the store's PCs share. Then deploy it as a Web App (instructions are
// in app/apps-script/SETUP.md). No Google Cloud project, no service account,
// no key file - just this script living inside the Sheet.
//
// Tabs:
//   Events   - the sync log the app reads/writes. Do not edit by hand.
//   Produits - readable product list (stock, prices...), updated on every sync.
//   Ventes   - readable list of sales, updated on every sync.
// Produits and Ventes are views built from Events: editing them by hand
// does not change the app. Menu "Candy Shop > Reconstruire" rebuilds them.

// 1) Put your password here (keep the one you already use!), and the SAME
//    value in the app's Settings page ("Clé de synchronisation").
var SECRET_KEY = "CHANGE_ME";

var TAB_NAME = "Events";
var HEADER = ["id", "ts", "pc", "type", "payload"];

var PROD_TAB = "Produits";
// [header, product field]
var PROD_COLS = [
  ["Code", "code"], ["Désignation", "name"], ["Code-barres", "barcode"], ["Catégorie", "category"],
  ["Prix vente", "price"], ["Prix achat", "cost"], ["Prix gros", "priceWholesale"], ["Stock", "stock"],
  ["Unité", "unit"], ["Stock min", "minStock"], ["Supprimé", "_deleted"], ["Modifié le", "_updated"], ["Poste", "_pc"]
];
var SALES_TAB = "Ventes";
var SALES_HEADER = ["Vente", "Date", "Poste", "Articles", "Total", "Statut", "lignes"];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_NAME);
    sheet.appendRow(HEADER);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// GET ?key=...&action=pull&after=<row number, 1-based, inclusive>
function doGet(e) {
  var p = e.parameter || {};
  if (p.key !== SECRET_KEY) return jsonOut_({ ok: false, error: "bad_key" });

  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var after = Math.max(parseInt(p.after || "2", 10), 2);

  var rows = [];
  if (lastRow >= after) {
    var numRows = lastRow - after + 1;
    var values = sheet.getRange(after, 1, numRows, HEADER.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (values[i][0]) rows.push(values[i]);
    }
  }
  return jsonOut_({ ok: true, rows: rows, lastRow: lastRow });
}

// POST body: { "key": "...", "events": [[id, ts, pc, type, payloadJson], ...] }
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "bad_json" });
  }
  if (body.key !== SECRET_KEY) return jsonOut_({ ok: false, error: "bad_key" });

  var events = body.events || [];
  if (events.length === 0) return jsonOut_({ ok: true, appended: 0 });

  // Avoid two PCs writing at the exact same moment from colliding.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    // Skip events already stored (a retried push after a timeout), so
    // nothing is written or counted twice.
    var last = sheet.getLastRow();
    var seen = {};
    if (last >= 2) {
      var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) seen[ids[i][0]] = true;
    }
    events = events.filter(function (ev) { return !seen[ev[0]]; });
    if (events.length) sheet.getRange(last + 1, 1, events.length, HEADER.length).setValues(events);
    var lastRow = sheet.getLastRow();
    // Update the readable tabs. A problem there must never make the sync fail:
    // the events are already safely stored above.
    try {
      updateViews_(events);
    } catch (viewErr) {
      console.error("updateViews_ failed: " + viewErr);
    }
    return jsonOut_({ ok: true, appended: events.length, lastRow: lastRow });
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Readable tabs ----------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Candy Shop")
    .addItem("Reconstruire Produits et Ventes", "rebuildViews")
    .addToUi();
}

// Rebuild Produits and Ventes from the whole Events log.
function rebuildViews() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var events = getSheet_();
  var last = events.getLastRow();
  var rows = last >= 2 ? events.getRange(2, 1, last - 1, HEADER.length).getValues() : [];
  var state = { products: {}, order: [], sales: {}, salesOrder: [] };
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] || seen[rows[i][0]]) continue; // skip blanks and duplicate rows
    seen[rows[i][0]] = true;
    applyToState_(state, parseEvent_(rows[i]));
  }
  writeAllProducts_(ss, state);
  writeAllSales_(ss, state);
}

function parseEvent_(row) {
  var payload = {};
  try { payload = JSON.parse(row[4]); } catch (e) { payload = {}; }
  return { id: row[0], ts: Number(row[1]), pc: row[2], type: row[3], payload: payload };
}

function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function applyToState_(state, ev) {
  var p = ev.payload || {};
  var prod = p.code ? state.products[p.code] : null;
  switch (ev.type) {
    case "product_upsert":
      if (!prod) { prod = state.products[p.code] = {}; state.order.push(p.code); }
      if (!prod._ts || ev.ts >= prod._ts) {
        for (var k in p) if (k !== "undoOf") prod[k] = p[k];
        prod._ts = ev.ts;
        prod._pc = ev.pc;
        if (p.deleted === false) prod.deleted = false;
      }
      break;
    case "product_delete":
      if (prod) { prod.deleted = true; prod._ts = ev.ts; prod._pc = ev.pc; }
      break;
    case "stock_adjust":
      if (prod) prod.stock = round2_((Number(prod.stock) || 0) + (Number(p.delta) || 0));
      break;
    case "sale_confirm":
      if (!state.sales[p.id]) {
        state.sales[p.id] = { id: p.id, date: p.date || ev.ts, pc: p.pc || ev.pc, total: p.total, lines: p.lines || [], cancelled: false };
        state.salesOrder.push(p.id);
        moveStock_(state, p.lines, -1);
      }
      break;
    case "sale_cancel":
      var s = state.sales[p.id];
      if (s && !s.cancelled) { s.cancelled = true; moveStock_(state, s.lines, +1); }
      break;
    case "sale_restore":
      var r = state.sales[p.id];
      if (r && r.cancelled) { r.cancelled = false; moveStock_(state, r.lines, -1); }
      break;
  }
}

function moveStock_(state, lines, sign) {
  for (var i = 0; i < (lines || []).length; i++) {
    var prod = state.products[lines[i].code];
    if (prod) prod.stock = round2_((Number(prod.stock) || 0) + sign * (Number(lines[i].qty) || 0));
  }
}

function productRow_(prod) {
  return PROD_COLS.map(function (c) {
    var f = c[1];
    if (f === "_deleted") return prod.deleted ? "oui" : "";
    if (f === "_updated") return prod._ts ? new Date(prod._ts) : "";
    if (f === "_pc") return prod._pc || "";
    var v = prod[f];
    return v === undefined || v === null ? "" : v;
  });
}

function rowToProduct_(row) {
  var prod = {};
  PROD_COLS.forEach(function (c, i) {
    var f = c[1], v = row[i];
    if (f === "_deleted") prod.deleted = v === "oui";
    else if (f === "_updated") prod._ts = v instanceof Date ? v.getTime() : (v ? Number(v) : 0);
    else if (f === "_pc") prod._pc = v;
    else if (v !== "") prod[f] = v;
  });
  return prod;
}

function saleRow_(s) {
  var items = (s.lines || []).map(function (l) { return l.name + " x" + l.qty; }).join(", ");
  return [s.id, new Date(s.date), s.pc, items, s.total, s.cancelled ? "Annulée" : "", JSON.stringify(s.lines || [])];
}

function prodSheet_(ss) {
  var sh = ss.getSheetByName(PROD_TAB);
  if (!sh) {
    sh = ss.insertSheet(PROD_TAB);
    sh.appendRow(PROD_COLS.map(function (c) { return c[0]; }));
    sh.setFrozenRows(1);
    // Codes and barcodes as text, so 6194002510064 is not shown as 6.19E+12
    // and leading zeros are kept.
    sh.getRange("A:A").setNumberFormat("@");
    sh.getRange("C:C").setNumberFormat("@");
  }
  return sh;
}

function salesSheet_(ss) {
  var sh = ss.getSheetByName(SALES_TAB);
  if (!sh) {
    sh = ss.insertSheet(SALES_TAB);
    sh.appendRow(SALES_HEADER);
    sh.setFrozenRows(1);
    sh.hideColumns(SALES_HEADER.length); // raw "lignes" column, used to undo cancellations
  }
  return sh;
}

function writeAllProducts_(ss, state) {
  var sh = prodSheet_(ss);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, PROD_COLS.length).clearContent();
  var rows = state.order.map(function (code) { return productRow_(state.products[code]); });
  if (rows.length) sh.getRange(2, 1, rows.length, PROD_COLS.length).setValues(rows);
}

function writeAllSales_(ss, state) {
  var sh = salesSheet_(ss);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SALES_HEADER.length).clearContent();
  var rows = state.salesOrder.map(function (id) { return saleRow_(state.sales[id]); });
  if (rows.length) sh.getRange(2, 1, rows.length, SALES_HEADER.length).setValues(rows);
}

// Incremental update for the events of one push: only the touched rows are rewritten.
function updateViews_(rawEvents) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Tabs are built once from the menu (Candy Shop > Reconstruire), not here:
  // a full build inside a sync request could be slow enough to time out.
  if (!ss.getSheetByName(PROD_TAB) || !ss.getSheetByName(SALES_TAB)) return;
  if (!rawEvents.length) return;
  var psh = prodSheet_(ss), ssh = salesSheet_(ss);

  // Load only what these events touch.
  var state = { products: {}, order: [], sales: {}, salesOrder: [] };
  var prodRowOf = {}, saleRowOf = {};
  var pLast = psh.getLastRow();
  if (pLast > 1) {
    var pVals = psh.getRange(2, 1, pLast - 1, PROD_COLS.length).getValues();
    for (var i = 0; i < pVals.length; i++) if (pVals[i][0] !== "") prodRowOf[String(pVals[i][0])] = { row: i + 2, values: pVals[i] };
  }
  var sLast = ssh.getLastRow();
  if (sLast > 1) {
    var sVals = ssh.getRange(2, 1, sLast - 1, SALES_HEADER.length).getValues();
    for (var j = 0; j < sVals.length; j++) if (sVals[j][0] !== "") saleRowOf[String(sVals[j][0])] = { row: j + 2, values: sVals[j] };
  }

  var events = rawEvents.map(parseEvent_);
  var touchedP = {}, touchedS = {};
  function loadProduct(code) {
    code = String(code);
    if (state.products[code] || !prodRowOf[code]) return;
    state.products[code] = rowToProduct_(prodRowOf[code].values);
  }
  function loadSale(id) {
    id = String(id);
    if (state.sales[id] || !saleRowOf[id]) return;
    var v = saleRowOf[id].values, lines = [];
    try { lines = JSON.parse(v[6]); } catch (e) {}
    state.sales[id] = { id: id, date: v[1] instanceof Date ? v[1].getTime() : v[1], pc: v[2], total: v[4], lines: lines, cancelled: v[5] === "Annulée" };
  }
  events.forEach(function (ev) {
    var p = ev.payload || {};
    if (p.code !== undefined) { loadProduct(p.code); touchedP[String(p.code)] = true; }
    if (ev.type.indexOf("sale_") === 0 && p.id) {
      loadSale(p.id); touchedS[String(p.id)] = true;
      var s = state.sales[String(p.id)] || p;
      (s.lines || []).forEach(function (l) { loadProduct(l.code); touchedP[String(l.code)] = true; });
    }
  });

  events.forEach(function (ev) { applyToState_(state, ev); });

  var newP = [], newS = [];
  Object.keys(touchedP).forEach(function (code) {
    var prod = state.products[code];
    if (!prod) return;
    var row = productRow_(prod);
    if (prodRowOf[code]) psh.getRange(prodRowOf[code].row, 1, 1, PROD_COLS.length).setValues([row]);
    else newP.push(row);
  });
  Object.keys(touchedS).forEach(function (id) {
    var s = state.sales[id];
    if (!s) return;
    var row = saleRow_(s);
    if (saleRowOf[id]) ssh.getRange(saleRowOf[id].row, 1, 1, SALES_HEADER.length).setValues([row]);
    else newS.push(row);
  });
  if (newP.length) psh.getRange(psh.getLastRow() + 1, 1, newP.length, PROD_COLS.length).setValues(newP);
  if (newS.length) ssh.getRange(ssh.getLastRow() + 1, 1, newS.length, SALES_HEADER.length).setValues(newS);
}
