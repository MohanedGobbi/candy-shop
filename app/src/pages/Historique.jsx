import React, { useEffect, useMemo, useState, useCallback } from "react";

// Local date (toISOString is UTC and shifts the day near midnight).
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dayBounds(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d).getTime();
  return { start, end: new Date(y, m - 1, d + 1).getTime() };
}

const fmt = (n) => (Number(n) || 0).toFixed(2);

export default function Historique({ t }) {
  const [tab, setTab] = useState("sales");
  const [dateStr, setDateStr] = useState(() => ymd(new Date()));
  const [sales, setSales] = useState([]);
  const [activity, setActivity] = useState([]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const { start, end } = dayBounds(dateStr);
    const [rows, act] = await Promise.all([
      window.api.salesForDay(start, end),
      window.api.listActivity({ start, end })
    ]);
    setSales(rows.sort((a, b) => b.date - a.date));
    setActivity(act);
  }, [dateStr]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unsub = window.api.onSyncStatus((st) => { if (st && st.ok) load(); });
    window.addEventListener("products:reload", load);
    return () => { unsub(); window.removeEventListener("products:reload", load); };
  }, [load]);

  const dayTotal = useMemo(
    () => sales.filter((s) => !s.cancelled).reduce((sum, s) => sum + s.total, 0),
    [sales]
  );

  async function after(res) {
    if (res && res.ok === false) setMsg({ type: "warn", text: t("undo_blocked_" + res.reason) || t("undo_failed") });
    else setMsg({ type: "ok", text: t("undo_done") });
    await load();
    window.dispatchEvent(new Event("products:reload")); // stock/prices changed elsewhere too
  }

  async function cancel(s) {
    if (!confirm(t("cancel_sale") + " ?")) return;
    await window.api.cancelSale(s.id);
    after({ ok: true });
  }
  async function restore(s) {
    if (!confirm(t("restore_sale") + " ?")) return;
    after(await window.api.restoreSale(s.id));
  }
  async function undo(a) {
    if (!confirm(t("undo_confirm") + "\n\n" + describe(a, t))) return;
    after(await window.api.undo(a.id));
  }

  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>{t("hist_sales")}</button>
          <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>{t("hist_log")}</button>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <input type="date" value={dateStr} onChange={(e) => { setMsg(null); setDateStr(e.target.value); }} />
        </div>
        <button className="btn ghost" onClick={() => setDateStr(ymd(new Date()))}>{t("today")}</button>
        {tab === "sales" && (
          <div style={{ marginInlineStart: "auto", fontWeight: 700, fontSize: 18 }}>
            {t("day_total")}: {fmt(dayTotal)}
          </div>
        )}
      </div>

      {msg && <div className={"banner " + msg.type} style={{ marginBottom: 12 }}>{msg.text}</div>}

      {tab === "sales" ? (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>{t("sale_id")}</th>
                <th>{t("pc")}</th>
                <th>{t("name")}</th>
                <th>{t("total_line")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 && <tr><td colSpan={5} className="hint">{t("no_sales")}</td></tr>}
              {sales.map((s) => (
                <tr key={s.id} className={s.cancelled ? "cancelled" : ""}>
                  <td>{new Date(s.date).toLocaleTimeString()}</td>
                  <td>{s.pc}</td>
                  <td>{s.lines.map((l) => `${l.name} x${l.qty}`).join(", ")}</td>
                  <td>{fmt(s.total)}</td>
                  <td className="row-actions">
                    {!s.cancelled && <button className="btn ghost" onClick={() => cancel(s)}>{t("cancel_sale")}</button>}
                    {s.cancelled && (
                      <>
                        <span className="hint">{t("cancelled")}</span>
                        <button className="btn ghost" onClick={() => restore(s)}>{t("restore_sale")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>{t("log_time")}</th>
                <th>{t("pc")}</th>
                <th>{t("log_action")}</th>
                <th>{t("log_details")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activity.length === 0 && <tr><td colSpan={5} className="hint">{t("log_empty")}</td></tr>}
              {activity.map((a) => (
                <tr key={a.id} className={a.undone ? "cancelled" : ""}>
                  <td>{new Date(a.ts).toLocaleTimeString()}</td>
                  <td>{a.pc}</td>
                  <td>
                    <span className={"act-tag " + (a.isUndo ? "undo" : a.type)}>{t(a.isUndo ? "act_undo" : "act_" + a.type)}</span>
                  </td>
                  <td>{details(a, t)}</td>
                  <td className="row-actions">
                    {a.undone ? (
                      <span className="hint">{t("log_undone")}</span>
                    ) : a.blocker === null ? (
                      <button className="btn ghost" onClick={() => undo(a)}>{t("undo")}</button>
                    ) : a.blocker === "changed_since" ? (
                      <span className="hint" title={t("undo_blocked_changed_since")}>{t("log_newer")}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function details(a, t) {
  if (a.sale) {
    const items = a.sale.lines.map((l) => `${l.name} x${l.qty}`).join(", ");
    return `${items} — ${fmt(a.sale.total)}`;
  }
  if (a.type === "stock_adjust") {
    const d = Number(a.delta) || 0;
    return `${a.productName} : ${d > 0 ? "+" : ""}${d}`;
  }
  return a.productName || "";
}

function describe(a, t) {
  return t(a.isUndo ? "act_undo" : "act_" + a.type) + " — " + details(a, t);
}
