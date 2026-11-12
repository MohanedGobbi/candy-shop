import React, { useEffect, useState, useCallback, useMemo } from "react";
import { computeAlerts, SALES_WINDOW_MS } from "./alerts.js";
import { makeT } from "./i18n.js";
import Produits from "./pages/Produits.jsx";
import Caisse from "./pages/Caisse.jsx";
import Historique from "./pages/Historique.jsx";
import Parametres from "./pages/Parametres.jsx";
import Analytique from "./pages/Analytique.jsx";
import Credits from "./pages/Credits.jsx";
import Alertes from "./pages/Alertes.jsx";

export default function App() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState("caisse");
  const [syncStatus, setSyncStatus] = useState({ ok: null });
  const [lastScan, setLastScan] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [update, setUpdate] = useState({ status: "idle" });

  // Data for the Alertes page and the menu badge: products, last 60 days of
  // sales, credit notes. Reloaded on page change, sync, refresh, and every minute.
  const [alertData, setAlertData] = useState({ products: [], sales: [], notes: [] });
  const loadAlertData = useCallback(async () => {
    const now = Date.now();
    const [products, sales, notes] = await Promise.all([
      window.api.listProducts(),
      window.api.salesForDay(now - SALES_WINDOW_MS, now + 60000),
      window.api.listNotes()
    ]);
    setAlertData({ products, sales, notes });
  }, []);
  useEffect(() => {
    loadAlertData();
    const unsub = window.api.onSyncStatus((st) => { if (st && st.ok) loadAlertData(); });
    window.addEventListener("products:reload", loadAlertData);
    const timer = setInterval(loadAlertData, 60000);
    return () => { unsub(); window.removeEventListener("products:reload", loadAlertData); clearInterval(timer); };
  }, [loadAlertData]);
  useEffect(() => { loadAlertData(); }, [page, loadAlertData]);
  const alertBadge = useMemo(
    () => computeAlerts({ ...alertData, threshold: Number((settings && settings.lowStockThreshold) ?? 3) }).badge,
    [alertData, settings]
  );
  useEffect(() => {
    window.api.getUpdate().then(setUpdate).catch(() => {});
    return window.api.onUpdate(setUpdate);
  }, []);

  const refreshProducts = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await window.api.syncNow(); } catch {}
    window.dispatchEvent(new Event("products:reload"));
    setTimeout(() => setRefreshing(false), 400);
  }, [refreshing]);

  useEffect(() => {
    const h = (e) => setLastScan(e.detail);
    window.addEventListener("scanner:read", h);
    return () => window.removeEventListener("scanner:read", h);
  }, []);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setPage(s.pcName && s.pcName.toLowerCase().includes("stock") ? "produits" : "caisse");
    });
    const unsub = window.api.onSyncStatus(setSyncStatus);
    return unsub;
  }, []);

  const saveSettings = useCallback(async (patch) => {
    const s = await window.api.saveSettings(patch);
    setSettings(s);
    return s;
  }, []);

  if (!settings) return null;

  const lang = settings.lang || "fr";
  const t = makeT(lang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  let pill = { cls: "warn", text: t("sync_not_configured") };
  if (syncStatus.ok === true) pill = { cls: "ok", text: t("sync_synced") };
  else if (syncStatus.ok === false) {
    if (syncStatus.reason === "not_configured") pill = { cls: "warn", text: t("sync_not_configured") };
    else pill = { cls: "err", text: t("sync_error") };
  }

  return (
    <div className="app" dir={dir} lang={lang}>
      <div className="topbar">
        <div className="nav">
          <button className={page === "caisse" ? "active" : ""} onClick={() => setPage("caisse")}>{t("nav_caisse")}</button>
          <button className={page === "produits" ? "active" : ""} onClick={() => setPage("produits")}>{t("nav_produits")}</button>
          <button className={page === "historique" ? "active" : ""} onClick={() => setPage("historique")}>{t("nav_historique")}</button>
          <button className={page === "credits" ? "active" : ""} onClick={() => setPage("credits")}>{t("nav_credits")}</button>
          <button className={page === "alertes" ? "active" : ""} onClick={() => setPage("alertes")}>
            {t("nav_alertes")}{alertBadge > 0 && <span className="nav-badge">{alertBadge > 99 ? "99+" : alertBadge}</span>}
          </button>
          <button className={page === "analytique" ? "active" : ""} onClick={() => setPage("analytique")}>{t("nav_analytique")}</button>
          <button className={page === "parametres" ? "active" : ""} onClick={() => setPage("parametres")}>{t("nav_parametres")}</button>
        </div>
        <div className="topbar-right">
          {lastScan && (
            <span
              className={"scan-pill " + (lastScan.ok ? "ok" : "err")}
              title={lastScan.ok ? "" : lastScan.reason + " · " + lastScan.avg + " ms/car"}
            >
              {(lastScan.ok ? t("scan_last") : t("scan_rejected")) + ": " + lastScan.raw}
            </span>
          )}
          {update.status === "ready" && (
            <button className="btn update-btn" onClick={() => window.api.installUpdate()}>
              {t("update_ready")} {update.version}
            </button>
          )}
          <button className={"refresh-btn" + (refreshing ? " spinning" : "")} onClick={refreshProducts} disabled={refreshing} title={t("refresh")}>
            <span className="refresh-icon" aria-hidden="true">⟳</span> {t("refresh")}
          </button>
          <span className={"sync-pill " + pill.cls}>{pill.text}</span>
          <div className="lang-switch">
            <button className={lang === "fr" ? "active" : ""} onClick={() => saveSettings({ lang: "fr" })}>FR</button>
            <button className={lang === "ar" ? "active" : ""} onClick={() => saveSettings({ lang: "ar" })}>AR</button>
          </div>
        </div>
      </div>
      <div className="page">
        {/* Caisse stays mounted so open carts survive switching pages. */}
        <div style={{ display: page === "caisse" ? "block" : "none" }}>
          <Caisse t={t} active={page === "caisse"} />
        </div>
        {page === "produits" && <Produits t={t} />}
        {page === "historique" && <Historique t={t} />}
        {page === "credits" && <Credits t={t} />}
        {page === "alertes" && (
          <Alertes t={t} data={alertData} settings={settings} saveSettings={saveSettings}
            reload={() => window.dispatchEvent(new Event("products:reload"))} />
        )}
        {page === "analytique" && <Analytique t={t} active />}
        {page === "parametres" && <Parametres t={t} settings={settings} saveSettings={saveSettings} />}
      </div>
    </div>
  );
}
