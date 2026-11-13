// Local storage: plain JSON files per PC. No native modules, so the same
// code runs unmodified on Windows 7 and Windows 10 with Electron's bundled
// Node - nothing to compile, nothing that can mismatch between machines.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function uid() {
  return crypto.randomBytes(9).toString("base64url");
}

class Store {
  constructor(userDataDir) {
    this.dir = path.join(userDataDir, "data");
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    this.files = {
      products: path.join(this.dir, "products.json"),
      sales: path.join(this.dir, "sales.json"),
      events: path.join(this.dir, "events.json"),
      notes: path.join(this.dir, "notes.json"),
      settings: path.join(this.dir, "settings.json")
    };
    this.products = this._load("products", {});
    this.sales = this._load("sales", []);
    this.events = this._load("events", []);
    this.notes = this._load("notes", {}); // credit / debt notes, by id
    this.settings = this._load("settings", {
      pcId: "PC-" + uid().slice(0, 6),
      pcName: "",
      lang: "fr",
      webAppUrl: "",
      syncKey: "",
      lastPulledRow: 2,
      setupDone: false
    });
  }

  _load(key, fallback) {
    try {
      const raw = fs.readFileSync(this.files[key], "utf8");
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  _save(key) {
    const tmp = this.files[key] + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this[key], null, 0), "utf8");
    fs.renameSync(tmp, this.files[key]);
  }

  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this._save("settings");
    return this.settings;
  }

  // ---- events (the sync log) ----
  appendEvent(type, payload) {
    const ev = {
      id: uid(),
      ts: Date.now(),
      pc: this.settings.pcId,
      type,
      payload,
      synced: false
    };
    this.events.push(ev);
    this._save("events");
    return ev;
  }

  getUnsyncedEvents() {
    return this.events.filter((e) => !e.synced);
  }

  markEventsSynced(ids) {
    const set = new Set(ids);
    let changed = false;
    for (const e of this.events) {
      if (set.has(e.id) && !e.synced) {
        e.synced = true;
        changed = true;
      }
    }
    if (changed) this._save("events");
  }

  hasAppliedRemote(id) {
    return this.events.some((e) => e.id === id);
  }

  // Apply an event coming from the Sheet (own or another PC's) to local state.
  // Idempotent: skips if this event id was already recorded locally.
  applyEvent(ev) {
    if (this.hasAppliedRemote(ev.id)) return false;
    this._applyToState(ev);
    this.events.push({ ...ev, synced: true });
    this._save("events");
    return true;
  }

  _applyToState(ev) {
    const { undoOf, ...p } = ev.payload || {};
    // An undo event points at the event it reverses; remember that so the
    // log shows it as undone on every PC, and it cannot be undone twice.
    if (undoOf) {
      const orig = this.events.find((e) => e.id === undoOf);
      if (orig) orig.undoneBy = ev.id;
    }
    // Snapshot the product before a change, so the change can be undone.
    if ((ev.type === "product_upsert" || ev.type === "product_delete") && !ev.prev) {
      const before = this.products[p.code];
      ev.prev = before ? { ...before } : null;
    }
    if ((ev.type === "note_upsert" || ev.type === "note_delete") && ev.prev === undefined) {
      const before = this.notes[p.id];
      ev.prev = before ? { ...before } : null;
    }
    switch (ev.type) {
      case "product_upsert": {
        const existing = this.products[p.code] || {};
        // last-write-wins by timestamp
        if (!existing.updatedAt || ev.ts >= existing.updatedAt) {
          this.products[p.code] = { ...existing, ...p, updatedAt: ev.ts };
        }
        this._save("products");
        break;
      }
      case "product_delete": {
        if (this.products[p.code]) {
          this.products[p.code].deleted = true;
          this.products[p.code].updatedAt = ev.ts;
          this._save("products");
        }
        break;
      }
      case "stock_adjust": {
        const prod = this.products[p.code];
        if (prod) {
          // Adjustments are deltas, so they are commutative and safe to replay in any order.
          prod.stock = round2((prod.stock || 0) + p.delta);
          prod.updatedAt = ev.ts;
          this._save("products");
        }
        break;
      }
      case "sale_confirm": {
        if (!this.sales.some((s) => s.id === p.id)) {
          this.sales.push(p);
          this._save("sales");
        }
        for (const line of p.lines) {
          const prod = this.products[line.code];
          if (prod) prod.stock = round2((prod.stock || 0) - line.qty);
        }
        this._save("products");
        break;
      }
      case "sale_cancel": {
        const sale = this.sales.find((s) => s.id === p.id);
        if (sale && !sale.cancelled) {
          sale.cancelled = true;
          sale.cancelledAt = ev.ts;
          for (const line of sale.lines) {
            const prod = this.products[line.code];
            if (prod) prod.stock = round2((prod.stock || 0) + line.qty);
          }
          this._save("sales");
          this._save("products");
        }
        break;
      }
      case "note_upsert": {
        // Text fields: last-write-wins. "paid" is never set here, only by payments.
        const existing = this.notes[p.id] || { paid: 0, createdAt: ev.ts, pc: ev.pc };
        if (!existing.updatedAt || ev.ts >= existing.updatedAt) {
          const { paid, ...fields } = p;
          this.notes[p.id] = { ...existing, ...fields, updatedAt: ev.ts };
        }
        this._save("notes");
        break;
      }
      case "note_delete": {
        if (this.notes[p.id]) {
          this.notes[p.id].deleted = true;
          this.notes[p.id].updatedAt = ev.ts;
          this._save("notes");
        }
        break;
      }
      case "note_payment": {
        // A delta, like stock: two PCs taking payments at once both count.
        const n = this.notes[p.id];
        if (n) {
          n.paid = round2((n.paid || 0) + (Number(p.amount) || 0));
          n.lastPaymentAt = ev.ts;
          this._save("notes");
        }
        break;
      }
      case "sale_restore": {
        // Reverses a cancellation: the sale counts again and stock goes back down.
        const sale = this.sales.find((s) => s.id === p.id);
        if (sale && sale.cancelled) {
          sale.cancelled = false;
          delete sale.cancelledAt;
          for (const line of sale.lines) {
            const prod = this.products[line.code];
            if (prod) prod.stock = round2((prod.stock || 0) - line.qty);
          }
          this._save("sales");
          this._save("products");
        }
        break;
      }
    }
  }

  // ---- high level actions used by the renderer ----
  upsertProduct(fields) {
    const code = fields.code || nextCode(this.products);
    const now = Date.now();
    const payload = { ...fields, code };
    const ev = this.appendEvent("product_upsert", payload);
    this._applyLocalOnly(ev);
    return this.products[code];
  }

  // Applying our own event locally without waiting for the sync round trip.
  _applyLocalOnly(ev) {
    this._applyToState(ev);
    this._save("events"); // keeps the undo snapshot / undone mark
  }

  // ---- activity log + undo ----
  _productName(code) {
    const p = this.products[code];
    return p ? p.name : code;
  }

  // Why an event cannot be undone (null = it can).
  _undoBlocker(ev) {
    if (ev.undoneBy) return "undone";
    const p = ev.payload || {};
    if (p.undoOf) return "is_undo";
    switch (ev.type) {
      case "sale_confirm": {
        const s = this.sales.find((x) => x.id === p.id);
        return !s ? "missing" : s.cancelled ? "already" : null;
      }
      case "sale_cancel": {
        const s = this.sales.find((x) => x.id === p.id);
        return !s ? "missing" : !s.cancelled ? "already" : null;
      }
      case "sale_restore": return "is_undo";
      case "stock_adjust": return this.products[p.code] ? null : "missing";
      case "note_payment": return this.notes[p.id] ? null : "missing";
      case "note_upsert":
      case "note_delete": {
        if (ev.prev === undefined) return "no_snapshot";
        const idx = this.events.indexOf(ev);
        const later = this.events.some((e, i) => i > idx && (e.type === "note_upsert" || e.type === "note_delete") && e.payload && e.payload.id === p.id);
        return later ? "changed_since" : null;
      }
      case "product_upsert":
      case "product_delete": {
        if (ev.prev === undefined) return "no_snapshot";
        // Only the latest edit/delete of a product can be undone, so an older
        // undo never silently overwrites newer edits. (Sales and +/- stock
        // moves do not count: stock is handled as a delta, see undo().)
        const later = this.events.some((e) => e !== ev && e.ts >= ev.ts && this.events.indexOf(e) > this.events.indexOf(ev) &&
          (e.type === "product_upsert" || e.type === "product_delete") && e.payload && e.payload.code === p.code);
        return later ? "changed_since" : null;
      }
    }
    return "unknown";
  }

  // ---- credit / debt notes ----
  listNotes() {
    return Object.entries(this.notes)
      .filter(([, n]) => !n.deleted)
      .map(([id, n]) => ({ id, ...n }));
  }

  upsertNote(fields) {
    const id = fields.id || uid();
    const { paid, createdAt, updatedAt, lastPaymentAt, pc, deleted, ...clean } = fields;
    const ev = this.appendEvent("note_upsert", { ...clean, id });
    this._applyLocalOnly(ev);
    return { id, ...this.notes[id] };
  }

  addNotePayment(id, amount) {
    const ev = this.appendEvent("note_payment", { id, amount: Number(amount) || 0 });
    this._applyLocalOnly(ev);
    return { id, ...this.notes[id] };
  }

  deleteNote(id) {
    const ev = this.appendEvent("note_delete", { id });
    this._applyLocalOnly(ev);
  }

  // Undo the latest cancellation of a sale (the "Restaurer" button).
  restoreSale(saleId) {
    const ev = [...this.events].reverse().find((e) => e.type === "sale_cancel" && e.payload && e.payload.id === saleId);
    return ev ? this.undo(ev.id) : { ok: false, reason: "missing" };
  }

  listActivity({ start = 0, end = Infinity, limit = 300 } = {}) {
    const out = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const ev = this.events[i];
      if (ev.ts < start || ev.ts >= end) continue;
      const p = ev.payload || {};
      let sale = null;
      if (ev.type.startsWith("sale_")) {
        const s = ev.type === "sale_confirm" ? p : this.sales.find((x) => x.id === p.id);
        if (s) sale = { id: s.id, total: s.total, date: s.date, lines: (s.lines || []).map((l) => ({ name: l.name, qty: l.qty })) };
      }
      out.push({
        id: ev.id, ts: ev.ts, pc: ev.pc, type: ev.type,
        productName: p.code ? (p.name || this._productName(p.code)) : null,
        delta: p.delta, reason: p.reason, sale,
        note: ev.type.startsWith("note_") ? (() => {
          const n = this.notes[p.id] || {};
          return { person: p.person || n.person || "", kind: p.kind || n.kind, amount: ev.type === "note_payment" ? p.amount : (p.amount ?? n.amount) };
        })() : null,
        isUndo: !!p.undoOf || ev.type === "sale_restore",
        undone: !!ev.undoneBy,
        blocker: this._undoBlocker(ev)
      });
    }
    return out;
  }

  undo(eventId) {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev) return { ok: false, reason: "missing" };
    const blocker = this._undoBlocker(ev);
    if (blocker) return { ok: false, reason: blocker };
    const p = ev.payload || {};
    let type, payload;
    switch (ev.type) {
      case "sale_confirm": type = "sale_cancel"; payload = { id: p.id }; break;
      case "sale_cancel": type = "sale_restore"; payload = { id: p.id }; break;
      case "stock_adjust": type = "stock_adjust"; payload = { code: p.code, delta: -p.delta, reason: "annulation" }; break;
      case "product_delete":
        type = "product_upsert"; payload = { code: p.code, deleted: false }; break;
      case "note_payment":
        type = "note_payment"; payload = { id: p.id, amount: -(Number(p.amount) || 0) }; break;
      case "note_delete":
        type = "note_upsert"; payload = { id: p.id, deleted: false }; break;
      case "note_upsert": {
        if (ev.prev === null) { type = "note_delete"; payload = { id: p.id }; break; }
        const restore = { ...ev.prev };
        for (const k of Object.keys(p)) if (!(k in restore)) restore[k] = null;
        delete restore.updatedAt; delete restore.paid; delete restore.lastPaymentAt;
        type = "note_upsert"; payload = restore;
        break;
      }
      case "product_upsert": {
        if (ev.prev === null) { type = "product_delete"; payload = { code: p.code }; break; }
        // Put back every field as it was; fields the edit introduced are cleared.
        const restore = { ...ev.prev };
        for (const k of Object.keys(p)) if (!(k in restore)) restore[k] = null;
        delete restore.updatedAt;
        // Stock: undo only what the edit itself changed, keep sales/moves since.
        const cur = this.products[p.code];
        if (p.stock !== undefined && cur) {
          restore.stock = round2((ev.prev.stock || 0) + ((cur.stock || 0) - (Number(p.stock) || 0)));
        } else {
          delete restore.stock;
        }
        type = "product_upsert"; payload = restore;
        break;
      }
      default: return { ok: false, reason: "unknown" };
    }
    const u = this.appendEvent(type, { ...payload, undoOf: ev.id });
    this._applyLocalOnly(u);
    return { ok: true };
  }

  deleteProduct(code) {
    const ev = this.appendEvent("product_delete", { code });
    this._applyLocalOnly(ev);
  }

  adjustStock(code, delta, reason) {
    const ev = this.appendEvent("stock_adjust", { code, delta, reason: reason || "" });
    this._applyLocalOnly(ev);
  }

  confirmSale(sale) {
    const full = { ...sale, id: uid(), pc: this.settings.pcId, date: Date.now(), cancelled: false };
    const ev = this.appendEvent("sale_confirm", full);
    this._applyLocalOnly(ev);
    return full;
  }

  cancelSale(id) {
    const ev = this.appendEvent("sale_cancel", { id });
    this._applyLocalOnly(ev);
  }

  listProducts() {
    return Object.values(this.products).filter((p) => !p.deleted);
  }

  findByBarcode(code) {
    return findBarcodeIn(this.listProducts(), code);
  }

  salesForDay(dayStartMs, dayEndMs) {
    return this.sales.filter((s) => s.date >= dayStartMs && s.date < dayEndMs);
  }
}

// Barcodes are compared without spaces, case or leading zeros
// (the same product can read as EAN-13 "0123..." or UPC-A "123...").
function normBarcode(b) {
  return String(b == null ? "" : b).replace(/\s+/g, "").toUpperCase().replace(/^0+(?=.)/, "");
}
function findBarcodeIn(products, code) {
  const exact = products.find((p) => p.barcode === code || (p.barcodes || []).includes(code));
  if (exact) return exact;
  const n = normBarcode(code);
  if (!n) return undefined;
  return products.find((p) => normBarcode(p.barcode) === n || (p.barcodes || []).some((b) => normBarcode(b) === n));
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function nextCode(products) {
  let max = 0;
  for (const k of Object.keys(products)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

module.exports = { Store, normBarcode, findBarcodeIn };
