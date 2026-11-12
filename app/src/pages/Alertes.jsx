import React, { useMemo, useState } from "react";
import { computeAlerts } from "../alerts.js";

const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Alertes({ t, data, settings, saveSettings, reload }) {
  const [tab, setTab] = useState("out");
  const [showAll, setShowAll] = useState(false);
  const [restock, setRestock] = useState(null); // row
  const [minFor, setMinFor] = useState(null); // row
  const [msg, setMsg] = useState(null);
  const threshold = Number(settings.lowStockThreshold ?? 3);

  const r = useMemo(
    () => computeAlerts({ products: data.products, sales: data.sales, notes: data.notes, threshold, showAll }),
    [data, threshold, showAll]
  );

  const tabs = [
    ["out", r.out.length],
    ["low", r.low.length],
    ["credits", r.credits.length],
    ["check", r.check.length]
  ];

  async function doRestock(row, qty) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return;
    await window.api.adjustStock(row.code, n, "réappro");
    setRestock(null);
    setMsg({ type: "ok", text: t("al_restocked").replace("{name}", row.name).replace("{qty}", n) });
    reload();
  }

  async function doSetMin(row, value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    await window.api.upsertProduct({ code: row.code, minStock: n });
    setMinFor(null);
    setMsg({ type: "ok", text: t("al_min_saved") });
    reload();
  }

  const hiddenCount = tab === "out" ? r.hidden.out : tab === "low" ? r.hidden.low : 0;

  return (
    <div>
      <div className="toolbar al-toolbar">
        <div className="seg">
          {tabs.map(([k, n]) => (
            <button key={k} className={tab === k ? "active" : ""} onClick={() => { setTab(k); setMsg(null); }}>
              {t("al_tab_" + k)} <span className={"al-count" + (n ? " on" : "")}>{n}</span>
            </button>
          ))}
        </div>
        {(tab === "out" || tab === "low") && (
          <label className="cr-check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {t("al_show_all")}
          </label>
        )}
        {tab === "low" && (
          <label className="cr-check">
            {t("al_threshold")}
            <input
              type="number" min="0" className="al-threshold" value={threshold}
              onChange={(e) => saveSettings({ lowStockThreshold: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        )}
      </div>

      <div className="hint al-explain">{t("al_explain_" + tab)}</div>
      {msg && <div className={"banner " + msg.type}>{msg.text}</div>}

      <div className="card">
        {tab === "credits" ? (
          <table>
            <thead>
              <tr><th>{t("cr_person")}</th><th>{t("cr_phone")}</th><th>{t("al_type")}</th><th>{t("cr_remaining")}</th><th>{t("al_since")}</th></tr>
            </thead>
            <tbody>
              {r.credits.length === 0 && <tr><td colSpan={5} className="hint">{t("al_none")}</td></tr>}
              {r.credits.map((n) => (
                <tr key={n.id}>
                  <td>{n.person}</td>
                  <td dir="ltr" style={{ textAlign: "start" }}>{n.phone || "—"}</td>
                  <td><span className={"cr-tag " + (n.kind === "debt" ? "debt" : "credit")}>{t(n.kind === "debt" ? "cr_kind_debt" : "cr_kind_credit")}</span></td>
                  <td><b>{fmt(n.remaining)}</b></td>
                  <td>{t("al_days").replace("{n}", n.ageDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("barcode")}</th>
                <th>{t("stock")}</th>
                {tab !== "check" && <th>{t("al_min")}</th>}
                {tab !== "check" && <th>{t("al_sold30")}</th>}
                {tab === "low" && <th>{t("al_days_left")}</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(r[tab] || []).length === 0 && <tr><td colSpan={7} className="hint">{t("al_none")}</td></tr>}
              {(r[tab] || []).slice(0, 500).map((p) => (
                <tr key={p.code} className={p.negative ? "stock-short" : ""}>
                  <td>
                    {p.name}
                    {p.negative && <div className="stock-short-note">{t("al_negative")}</div>}
                  </td>
                  <td>{p.barcode || "—"}</td>
                  <td><b>{p.stock}</b></td>
                  {tab !== "check" && <td>{p.min || "—"}</td>}
                  {tab !== "check" && <td>{p.sold30 || "—"}</td>}
                  {tab === "low" && (
                    <td>{p.daysLeft == null ? "—" : <span className={p.soon ? "al-soon" : ""}>{t("al_days").replace("{n}", Math.max(0, Math.round(p.daysLeft)))}</span>}</td>
                  )}
                  <td className="row-actions">
                    {tab === "check" ? (
                      <span className="hint">{t("al_fix_in_products")}</span>
                    ) : (
                      <>
                        <button className="btn" onClick={() => setRestock(p)}>{t("al_restock")}</button>
                        <button className="btn ghost" onClick={() => setMinFor(p)}>{t("al_set_min")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hiddenCount > 0 && !showAll && (
          <div className="hint al-hidden">{t("al_hidden").replace("{n}", hiddenCount)}</div>
        )}
      </div>

      {restock && (
        <NumberModal
          t={t} title={t("al_restock") + " — " + restock.name}
          label={t("al_qty_received")} initial="" onCancel={() => setRestock(null)}
          onSave={(v) => doRestock(restock, v)}
        />
      )}
      {minFor && (
        <NumberModal
          t={t} title={t("al_set_min") + " — " + minFor.name}
          label={t("al_min_hint")} initial={String(minFor.min || threshold)} onCancel={() => setMinFor(null)}
          onSave={(v) => doSetMin(minFor, v)}
        />
      )}
    </div>
  );
}

function NumberModal({ t, title, label, initial, onCancel, onSave }) {
  const [v, setV] = useState(initial);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="field">
          <label>{label}</label>
          <input type="number" min="0" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(v); }} />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
          <button className="btn" onClick={() => onSave(v)}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
