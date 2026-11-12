import React, { useEffect, useState, useCallback } from "react";
import { makeT } from "./i18n.js";
import Produits from "./pages/Produits.jsx";
import Caisse from "./pages/Caisse.jsx";
import Historique from "./pages/Historique.jsx";
import Parametres from "./pages/Parametres.jsx";
import Analytique from "./pages/Analytique.jsx";
import Credits from "./pages/Credits.jsx";

export default function App() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState("caisse");
  const [syncStatus, setSyncStatus] = useState({ ok: null });
  const [lastScan, setLastScan] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [update, setUpdate] = useState({ status: "idle" });
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
        {page === "analytique" && <Analytique t={t} active />}
        {page === "parametres" && <Parametres t={t} settings={settings} saveSettings={saveSettings} />}
      </div>
    </div>
  );
}
