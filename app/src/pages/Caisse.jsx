import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useBarcodeScanner } from "../useBarcodeScanner.js";

function newCart(label) {
  return { id: Math.random().toString(36).slice(2), label, lines: [], given: "" };
}

// Carts are saved locally so they survive a page switch or an app restart.
const CARTS_KEY = "caisse.carts.v1";
function loadCarts() {
  try {
    const saved = JSON.parse(localStorage.getItem(CARTS_KEY));
    if (saved && Array.isArray(saved.carts) && saved.carts.length) return saved;
  } catch {}
  const c = newCart("1");
  return { carts: [c], activeId: c.id };
}

export default function Caisse({ t, active: pageActive = true }) {
  const [initial] = useState(loadCarts);
  const [carts, setCarts] = useState(initial.carts);
  const [activeId, setActiveId] = useState(initial.activeId);

  useEffect(() => {
    try { localStorage.setItem(CARTS_KEY, JSON.stringify({ carts, activeId })); } catch {}
  }, [carts, activeId]);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState(null);
  const [editingPriceFor, setEditingPriceFor] = useState(null); // code awaiting a manual price

  useEffect(() => {
    const load = () => window.api.listProducts().then(setProducts);
    load();
    window.addEventListener("products:reload", load);
    return () => window.removeEventListener("products:reload", load);
  }, []);

  // Pick up products/prices/stock another PC changed, as soon as a sync pulls them in.
  useEffect(() => {
    const unsub = window.api.onSyncStatus((status) => {
      if (status && status.ok) window.api.listProducts().then(setProducts);
    });
    return unsub;
  }, []);

  const active = carts.find((c) => c.id === activeId) || carts[0];

  // Current stock per product, to warn when the cart asks for more than exists.
  const stockOf = useMemo(() => {
    const m = new Map();
    for (const p of products) m.set(p.code, Number(p.stock) || 0);
    return m;
  }, [products]);

  const warnIfShort = useCallback((code, name, qty, knownStock) => {
    const stock = knownStock ?? stockOf.get(code);
    if (stock === undefined || qty <= stock) return false;
    setMessage({
      type: "warn",
      text: t("stock_short").replace("{name}", name).replace("{stock}", stock).replace("{qty}", qty)
    });
    return true;
  }, [stockOf, t]);

  const addLine = useCallback((product, qtyDelta = 1) => {
    setMessage(null);
    if (product.price == null && editingPriceFor !== product.code) {
      const typed = prompt(t("price") + " - " + product.name);
      const price = Number(typed);
      if (!typed || !Number.isFinite(price) || price < 0) return;
      product = { ...product, price };
    }
    const cur = carts.find((c) => c.id === activeId);
    const inCart = cur ? (cur.lines.find((l) => l.code === product.code) || { qty: 0 }).qty : 0;
    warnIfShort(product.code, product.name, inCart + qtyDelta, product.stock != null ? Number(product.stock) : undefined);
    setCarts((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        const existing = c.lines.find((l) => l.code === product.code);
        let lines;
        if (existing) {
          lines = c.lines.map((l) => (l.code === product.code ? { ...l, qty: l.qty + qtyDelta } : l));
        } else {
          lines = [...c.lines, { code: product.code, name: product.name, price: product.price, qty: qtyDelta }];
        }
        return { ...c, lines: lines.filter((l) => l.qty > 0) };
      })
    );
  }, [activeId, editingPriceFor, t, carts, warnIfShort]);

  const onScan = useCallback(async (code) => {
    const local = products.find((p) => p.barcode === code || (p.barcodes || []).includes(code));
    if (local) { addLine(local, 1); return; }
    const fresh = await window.api.findByBarcode(code);
    if (fresh) { addLine(fresh, 1); return; }
    setMessage({ type: "warn", text: code + " — ?" });
  }, [products, addLine]);

  useBarcodeScanner(onScan, pageActive);

  const filteredSearch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return products.filter((p) => (p.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [products, query]);

  function setQty(code, qty) {
    const line = active.lines.find((l) => l.code === code);
    if (line && qty > line.qty) warnIfShort(code, line.name, qty);
    else setMessage(null);
    setCarts((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        const lines = c.lines
          .map((l) => (l.code === code ? { ...l, qty } : l))
          .filter((l) => l.qty > 0);
        return { ...c, lines };
      })
    );
  }

  function removeLine(code) {
    setCarts((prev) => prev.map((c) => (c.id === activeId ? { ...c, lines: c.lines.filter((l) => l.code !== code) } : c)));
  }

  const total = active.lines.reduce((s, l) => s + l.qty * (l.price || 0), 0);
  const given = Number(active.given) || 0;
  const change = given - total;

  async function confirm() {
    if (active.lines.length === 0) return;
    const short = active.lines.filter((l) => stockOf.has(l.code) && l.qty > stockOf.get(l.code));
    if (short.length) {
      const list = short.map((l) => "• " + l.name + " : " + t("stock_label") + " " + stockOf.get(l.code) + ", " + t("qty") + " " + l.qty).join("\n");
      if (!window.confirm(t("stock_short_confirm") + "\n\n" + list)) return;
    }
    if (active.given !== "" && change < 0) {
      setMessage({ type: "warn", text: t("not_enough") });
      return;
    }
    await window.api.confirmSale({
      lines: active.lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, price: l.price })),
      total,
      given: active.given === "" ? total : given,
      change: active.given === "" ? 0 : change
    });
    setMessage({ type: "ok", text: t("sale_confirmed") });
    setCarts((prev) => {
      const rest = prev.filter((c) => c.id !== activeId);
      if (rest.length > 0) { setActiveId(rest[0].id); return rest; }
      const fresh = newCart("1");
      setActiveId(fresh.id);
      return [fresh];
    });
    window.api.listProducts().then(setProducts);
  }

  function addCart() {
    const n = newCart(String(carts.length + 1));
    setCarts((prev) => [...prev, n]);
    setActiveId(n.id);
  }

  function renameCart(id) {
    const label = prompt(t("cart_rename"));
    if (!label) return;
    setCarts((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));
  }

  function deleteCart(id) {
    setCarts((prev) => {
      const rest = prev.filter((c) => c.id !== id);
      const final = rest.length > 0 ? rest : [newCart("1")];
      if (id === activeId) setActiveId(final[0].id);
      return final;
    });
  }

  return (
    <div>
      {message && <div className={"banner " + (message.type === "ok" ? "ok" : "warn")}>{message.text}</div>}

      <div className="tabs">
        {carts.map((c) => (
          <button
            key={c.id}
            className={"tab " + (c.id === activeId ? "active" : "")}
            onClick={() => setActiveId(c.id)}
            onDoubleClick={() => renameCart(c.id)}
          >
            {t("cart_tab")} {c.label} ({c.lines.length})
          </button>
        ))}
        <button className="tab" onClick={addCart}>{t("cart_new")}</button>
      </div>

      <div className="caisse-layout">
        <div className="card">
          <div className="toolbar" style={{ position: "relative" }}>
            <input
              type="text"
              placeholder={t("scan_or_search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {filteredSearch.length > 0 && (
            <div className="card" style={{ marginBottom: 10 }}>
              {filteredSearch.map((p) => (
                <div key={p.code} style={{ padding: "6px 0", display: "flex", justifyContent: "space-between" }}>
                  <span>{p.name}</span>
                  <button className="btn ghost" onClick={() => { addLine(p, 1); setQuery(""); }}>+</button>
                </div>
              ))}
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("qty")}</th>
                <th>{t("price")}</th>
                <th>{t("total_line")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.lines.length === 0 && <tr><td colSpan={5} className="hint">{t("cart_empty")}</td></tr>}
              {active.lines.map((l) => {
                const stock = stockOf.get(l.code);
                const short = stock !== undefined && l.qty > stock;
                return (
                <tr key={l.code} className={short ? "stock-short" : ""}>
                  <td>
                    {l.name}
                    {short && <div className="stock-short-note">{t("stock_label")} : {stock}</div>}
                  </td>
                  <td>
                    <div className="qty-stepper">
                      <button onClick={() => setQty(l.code, l.qty - 1)}>−</button>
                      <span>{l.qty}</span>
                      <button onClick={() => setQty(l.code, l.qty + 1)}>+</button>
                    </div>
                  </td>
                  <td>{l.price}</td>
                  <td>{(l.qty * (l.price || 0)).toFixed(2)}</td>
                  <td><button className="btn ghost" onClick={() => removeLine(l.code)}>{t("delete")}</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="field">
            <label>{t("cart_total")}</label>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{total.toFixed(2)}</div>
          </div>
          <div className="field">
            <label>{t("amount_given")}</label>
            <input
              type="number"
              value={active.given}
              onChange={(e) => setCarts((prev) => prev.map((c) => (c.id === activeId ? { ...c, given: e.target.value } : c)))}
            />
          </div>
          <div className="field">
            <label>{t("change_due")}</label>
            <div style={{ fontSize: 20, fontWeight: 700, color: change < 0 ? "#b3261e" : "inherit" }}>
              {active.given === "" ? "—" : change.toFixed(2)}
            </div>
          </div>
          <button className="btn" style={{ width: "100%" }} disabled={active.lines.length === 0} onClick={confirm}>
            {t("confirm_sale")}
          </button>
          <div style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => deleteCart(activeId)}>{t("cart_delete")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
