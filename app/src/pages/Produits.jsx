import { safeConfirm } from "../safeConfirm.js";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useBarcodeScanner } from "../useBarcodeScanner.js";

const BLANK = { code: "", name: "", barcode: "", category: "", price: "", cost: "", priceWholesale: "", stock: "", unit: "Pièce", minStock: "" };

export default function Produits({ t }) {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null); // { mode: 'add'|'edit', data }
  const [banner, setBanner] = useState(null);

  const refresh = useCallback(() => {
    window.api.listProducts().then(setProducts);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener("products:reload", refresh);
    return () => window.removeEventListener("products:reload", refresh);
  }, [refresh]);

  // Pick up products another PC added/changed, as soon as a sync pulls them in.
  useEffect(() => {
    const unsub = window.api.onSyncStatus((status) => {
      if (status && status.ok) refresh();
    });
    return unsub;
  }, [refresh]);

  const onScan = useCallback(async (code) => {
    if (modal) return; // modal has its own field, ignore global scans while open
    const existing = await window.api.findByBarcode(code);
    if (existing) {
      setBanner({ type: "ok", text: `${t("scanned_existing")}: ${existing.name}` });
      setModal({ mode: "edit", data: toForm(existing) });
    } else {
      setBanner({ type: "warn", text: t("scanned_new_product") });
      setModal({ mode: "add", data: { ...BLANK, barcode: code } });
    }
  }, [modal, t]);

  useBarcodeScanner(onScan, !modal);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q)
    );
  }, [products, query]);

  async function quickAdjust(p, delta) {
    await window.api.adjustStock(p.code, delta, "manuel");
    refresh();
  }

  async function deleteProduct(p) {
    if (!safeConfirm(p.name)) return;
    await window.api.deleteProduct(p.code);
    refresh();
  }

  async function save(form) {
    if (!form.name.trim() || form.stock === "" || form.stock === null) {
      setBanner({ type: "warn", text: t("name_qty_required") });
      return;
    }
    const payload = {
      code: form.code || undefined,
      name: form.name.trim(),
      barcode: form.barcode.trim(),
      category: form.category.trim(),
      price: numOrNull(form.price),
      cost: numOrNull(form.cost),
      priceWholesale: numOrNull(form.priceWholesale),
      stock: Number(form.stock) || 0,
      unit: form.unit || "Pièce",
      minStock: numOrNull(form.minStock)
    };
    await window.api.upsertProduct(payload);
    setModal(null);
    setBanner(null);
    refresh();
  }

  return (
    <div>
      {banner && <div className={"banner " + (banner.type === "ok" ? "ok" : "warn")}>{banner.text}</div>}
      <div className="toolbar">
        <input
          type="text"
          placeholder={t("search_products")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={() => setModal({ mode: "add", data: { ...BLANK } })}>{t("add_product")}</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("barcode")}</th>
              <th>{t("category")}</th>
              <th>{t("price")}</th>
              <th>{t("stock")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="hint">{t("no_products")}</td></tr>
            )}
            {filtered.map((p) => {
              const low = p.minStock != null && p.stock <= p.minStock;
              return (
                <tr key={p.code} className={low ? "low-stock" : ""}>
                  <td>{p.name}</td>
                  <td>{p.barcode || "—"}</td>
                  <td>{p.category || "—"}</td>
                  <td>{p.price != null ? p.price : "—"}</td>
                  <td>
                    <div className="qty-stepper">
                      <button onClick={() => quickAdjust(p, -1)}>−</button>
                      <span>{p.stock}</span>
                      <button onClick={() => quickAdjust(p, 1)}>+</button>
                    </div>
                  </td>
                  <td>
                    <button className="btn ghost" onClick={() => { setModal({ mode: "edit", data: toForm(p) }); setBanner(null); }}>{t("edit_product")}</button>
                    <button className="btn ghost" onClick={() => deleteProduct(p)}>{t("delete")}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <ProductModal
          t={t}
          mode={modal.mode}
          data={modal.data}
          onCancel={() => { setModal(null); setBanner(null); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function toForm(p) {
  return {
    code: p.code,
    name: p.name || "",
    barcode: p.barcode || "",
    category: p.category || "",
    price: p.price ?? "",
    cost: p.cost ?? "",
    priceWholesale: p.priceWholesale ?? "",
    stock: p.stock ?? 0,
    unit: p.unit || "Pièce",
    minStock: p.minStock ?? ""
  };
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ProductModal({ t, mode, data, onCancel, onSave }) {
  const [form, setForm] = useState(data);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h2>{mode === "add" ? t("add_product") : t("edit_product")}</h2>

        <div className="field required">
          <label>{t("name")}</label>
          <input autoFocus value={form.name} onChange={set("name")} />
        </div>
        <div className="field required">
          <label>{t("stock")}</label>
          <input type="number" value={form.stock} onChange={set("stock")} />
        </div>
        <div className="field">
          <label>{t("barcode")}</label>
          <input value={form.barcode} onChange={set("barcode")} />
        </div>
        <div className="field">
          <label>{t("category")}</label>
          <input value={form.category} onChange={set("category")} />
        </div>
        <div className="field">
          <label>{t("price")}</label>
          <input type="number" value={form.price} onChange={set("price")} />
        </div>
        <div className="field">
          <label>{t("cost")}</label>
          <input type="number" value={form.cost} onChange={set("cost")} />
        </div>
        <div className="field">
          <label>{t("unit")}</label>
          <input value={form.unit} onChange={set("unit")} />
        </div>
        <div className="field">
          <label>{t("min_stock")}</label>
          <input type="number" value={form.minStock} onChange={set("minStock")} />
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
          <button className="btn" onClick={() => onSave(form)}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
