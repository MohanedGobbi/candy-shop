import React, { useEffect, useMemo, useState } from "react";

const DAY = 24 * 3600 * 1000;

// Local-date helpers (not toISOString, which is UTC and shifts the day near midnight).
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

// Returns { start, end } in ms, end exclusive.
function rangeFor(preset, from, to) {
  const today = startOfDay(new Date());
  const t0 = today.getTime();
  switch (preset) {
    case "today": return { start: t0, end: t0 + DAY };
    case "yesterday": return { start: t0 - DAY, end: t0 };
    case "7d": return { start: t0 - 6 * DAY, end: t0 + DAY };
    case "30d": return { start: t0 - 29 * DAY, end: t0 + DAY };
    case "month": return { start: new Date(today.getFullYear(), today.getMonth(), 1).getTime(), end: t0 + DAY };
    case "lastmonth": return {
      start: new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(),
      end: new Date(today.getFullYear(), today.getMonth(), 1).getTime()
    };
    case "year": return { start: new Date(today.getFullYear(), 0, 1).getTime(), end: t0 + DAY };
    default: {
      const a = parseYmd(from).getTime();
      const b = parseYmd(to).getTime();
      return { start: Math.min(a, b), end: Math.max(a, b) + DAY };
    }
  }
}

const PRESETS = ["today", "yesterday", "7d", "30d", "month", "lastmonth", "year", "custom"];

const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Analytique({ t, active }) {
  const [preset, setPreset] = useState("today");
  const todayStr = ymd(new Date());
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [pc, setPc] = useState("all");

  const range = useMemo(() => rangeFor(preset, from, to), [preset, from, to]);

  // Money in the safe at the start of the day, saved per day on this PC.
  const [settings, setSettings] = useState(null);
  const [openingDraft, setOpeningDraft] = useState("");
  useEffect(() => { window.api.getSettings().then(setSettings); }, []);
  const singleDay = range.end - range.start === DAY ? ymd(new Date(range.start)) : null;
  const savedOpening = singleDay && settings && settings.openingCash ? settings.openingCash[singleDay] : undefined;
  useEffect(() => { setOpeningDraft(savedOpening != null ? String(savedOpening) : ""); }, [singleDay, savedOpening]);

  async function saveOpening() {
    if (!singleDay || !settings) return;
    const v = openingDraft.trim();
    const n = Number(v);
    const map = { ...(settings.openingCash || {}) };
    if (v === "" || !Number.isFinite(n) || n < 0) delete map[singleDay];
    else map[singleDay] = Math.round(n * 100) / 100;
    setSettings(await window.api.saveSettings({ openingCash: map }));
  }

  useEffect(() => {
    let alive = true;
    function load() {
      Promise.all([window.api.salesForDay(range.start, range.end), window.api.listProducts()]).then(([s, p]) => {
        if (!alive) return;
        setSales(s);
        setProducts(p);
      });
    }
    load();
    window.addEventListener("products:reload", load);
    const unsub = window.api.onSyncStatus((st) => { if (st && st.ok) load(); });
    return () => { alive = false; window.removeEventListener("products:reload", load); unsub(); };
  }, [range.start, range.end, active]);

  const pcs = useMemo(() => [...new Set(sales.map((s) => s.pc).filter(Boolean))].sort(), [sales]);

  const r = useMemo(() => {
    const costOf = new Map(products.map((p) => [p.code, p.cost]));
    const scoped = sales.filter((s) => pc === "all" || s.pc === pc);
    const valid = scoped.filter((s) => !s.cancelled);
    const cancelled = scoped.length - valid.length;
    let revenue = 0, items = 0, cost = 0, costKnownRevenue = 0;
    const byProduct = new Map();
    for (const s of valid) {
      revenue += s.total;
      for (const l of s.lines) {
        const lineTotal = (Number(l.price) || 0) * l.qty;
        items += l.qty;
        const c = costOf.get(l.code);
        if (c != null && c !== "" && Number.isFinite(Number(c))) {
          cost += Number(c) * l.qty;
          costKnownRevenue += lineTotal;
        }
        const e = byProduct.get(l.code) || { name: l.name, qty: 0, total: 0 };
        e.qty += l.qty;
        e.total += lineTotal;
        byProduct.set(l.code, e);
      }
    }
    const top = [...byProduct.values()].sort((a, b) => b.total - a.total).slice(0, 10);

    // Buckets: by hour for a single day, by day for up to ~62 days, else by month.
    const days = Math.round((range.end - range.start) / DAY);
    let mode = days <= 1 ? "hour" : days <= 62 ? "day" : "month";
    const buckets = new Map();
    const order = [];
    if (mode === "hour") {
      for (let h = 0; h < 24; h++) { const k = String(h).padStart(2, "0") + "h"; buckets.set(k, 0); order.push(k); }
    } else if (mode === "day") {
      for (let x = range.start; x < range.end; x += DAY) {
        const d = new Date(x); const k = String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
        if (!buckets.has(k)) { buckets.set(k, 0); order.push(k); }
      }
    } else {
      const d = new Date(range.start);
      for (let y = d.getFullYear(), m = d.getMonth(); new Date(y, m, 1).getTime() < range.end; m++) {
        const dd = new Date(y, m, 1); const k = String(dd.getMonth() + 1).padStart(2, "0") + "/" + dd.getFullYear();
        if (!buckets.has(k)) { buckets.set(k, 0); order.push(k); }
      }
    }
    for (const s of valid) {
      const d = new Date(s.date);
      const k = mode === "hour" ? String(d.getHours()).padStart(2, "0") + "h"
        : mode === "day" ? String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0")
        : String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
      if (buckets.has(k)) buckets.set(k, buckets.get(k) + s.total);
    }
    let series = order.map((k) => ({ k, v: buckets.get(k) }));
    if (mode === "hour") {
      // Trim empty hours at both ends so the chart shows the opening hours.
      const nz = series.map((x, i) => (x.v > 0 ? i : -1)).filter((i) => i >= 0);
      if (nz.length) series = series.slice(Math.max(0, nz[0] - 1), Math.min(24, nz[nz.length - 1] + 2));
      else series = series.slice(8, 21);
    }

    return {
      revenue, count: valid.length, cancelled, items,
      avg: valid.length ? revenue / valid.length : 0,
      margin: costKnownRevenue ? costKnownRevenue - cost : null,
      marginCoverage: revenue ? costKnownRevenue / revenue : 0,
      top, series, mode,
      // This PC's takings: its safe gets only the cash it took in.
      thisPcRevenue: sales.filter((s) => !s.cancelled && settings && s.pc === settings.pcId).reduce((a, s) => a + s.total, 0)
    };
  }, [sales, products, pc, range.start, range.end, settings]);

  const max = Math.max(1, ...r.series.map((x) => x.v));

  return (
    <div className="analytics">
      <div className="toolbar an-filters">
        <div className="seg">
          {PRESETS.map((p) => (
            <button key={p} className={preset === p ? "active" : ""} onClick={() => setPreset(p)}>{t("an_" + p)}</button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="an-dates">
            <label>{t("an_from")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>{t("an_to")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}
        {pcs.length > 1 && (
          <select value={pc} onChange={(e) => setPc(e.target.value)}>
            <option value="all">{t("an_all_pcs")}</option>
            {pcs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button className="btn ghost an-print" onClick={() => window.print()}>{t("an_print")}</button>
      </div>

      <div className="an-period hint">
        {new Date(range.start).toLocaleDateString()} – {new Date(range.end - 1).toLocaleDateString()}
      </div>

      <div className="an-kpis">
        <Kpi label={t("an_revenue")} value={fmt(r.revenue)} big />
        <Kpi label={t("an_sales")} value={r.count} />
        <Kpi label={t("an_avg")} value={fmt(r.avg)} />
        <Kpi label={t("an_items")} value={r.items} />
        <Kpi
          label={t("an_margin")}
          value={r.margin == null ? "—" : fmt(r.margin)}
          note={r.margin != null && r.marginCoverage < 0.999 ? t("an_margin_partial").replace("{p}", Math.round(r.marginCoverage * 100)) : null}
        />
        <Kpi label={t("an_cancelled")} value={r.cancelled} />
      </div>

      {singleDay && (
        <div className="card an-safe">
          <div className="field">
            <label>{t("an_opening_cash")}</label>
            <input
              type="number"
              min="0"
              value={openingDraft}
              placeholder="0"
              onChange={(e) => setOpeningDraft(e.target.value)}
              onBlur={saveOpening}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveOpening(); } }}
            />
          </div>
          <div className="an-safe-sum">
            <span>{t("an_opening_cash")} {fmt(savedOpening || 0)}</span>
            <span>+ {t("an_revenue")}{pcs.length > 1 ? " (" + t("an_this_pc") + ")" : ""} {fmt(r.thisPcRevenue)}</span>
            <strong>= {t("an_expected_cash")} {fmt((savedOpening || 0) + r.thisPcRevenue)}</strong>
          </div>
        </div>
      )}

      <div className="an-grid">
        <div className="card">
          <h3 className="an-h">{t(r.mode === "hour" ? "an_by_hour" : r.mode === "day" ? "an_by_day" : "an_by_month")}</h3>
          {r.count === 0 ? (
            <div className="hint">{t("an_empty")}</div>
          ) : (
            <div className="an-bars" dir="ltr">
              {r.series.map((x, i) => (
                <div className="an-bar" key={x.k} title={x.k + " : " + fmt(x.v)}>
                  <div className="an-bar-fill" style={{ height: (x.v / max) * 100 + "%" }} />
                  {i % Math.ceil(r.series.length / 12) === 0 && <div className="an-bar-label">{x.k}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="an-h">{t("an_top")}</h3>
          {r.top.length === 0 ? (
            <div className="hint">{t("an_empty")}</div>
          ) : (
            <table>
              <thead>
                <tr><th>{t("name")}</th><th>{t("qty")}</th><th>{t("total_line")}</th></tr>
              </thead>
              <tbody>
                {r.top.map((p, i) => (
                  <tr key={i}><td>{p.name}</td><td>{p.qty}</td><td>{fmt(p.total)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, big }) {
  return (
    <div className={"card kpi" + (big ? " big" : "")}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}
