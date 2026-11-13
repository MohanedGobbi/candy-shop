import React, { useState } from "react";

export default function Parametres({ t, settings, saveSettings, appVersion, onOpenWhatsNew }) {
  const [form, setForm] = useState({
    pcName: settings.pcName || "",
    webAppUrl: settings.webAppUrl || "",
    syncKey: settings.syncKey || ""
  });
  const [syncResult, setSyncResult] = useState(null);

  async function save() {
    await saveSettings(form);
  }

  async function syncNow() {
    setSyncResult({ busy: true });
    const r = await window.api.syncNow();
    setSyncResult(r);
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <div className="field">
        <label>{t("pc_name")}</label>
        <input
          placeholder={t("pc_name_placeholder")}
          value={form.pcName}
          onChange={(e) => setForm({ ...form, pcName: e.target.value })}
        />
      </div>

      <hr />

      <div className="field">
        <label>{t("web_app_url")}</label>
        <input
          placeholder="https://script.google.com/macros/s/.../exec"
          value={form.webAppUrl}
          onChange={(e) => setForm({ ...form, webAppUrl: e.target.value })}
        />
        <span className="hint">{t("web_app_url_help")}</span>
      </div>

      <div className="field">
        <label>{t("sync_key")}</label>
        <input
          value={form.syncKey}
          onChange={(e) => setForm({ ...form, syncKey: e.target.value })}
        />
        <span className="hint">{t("sync_key_help")}</span>
      </div>

      <button className="btn" onClick={save}>{t("save_settings")}</button>

      <hr />

      <button className="btn ghost" onClick={syncNow}>{t("sync_now")}</button>
      {syncResult && !syncResult.busy && (
        <div className="hint" style={{ marginTop: 8 }}>
          {syncResult.ok
            ? `OK — ${t("pulled")}: ${syncResult.pulled}, ${t("pushed")}: ${syncResult.pushed}`
            : `${syncResult.reason}${syncResult.detail ? ": " + syncResult.detail : ""}`}
        </div>
      )}

      <hr />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="hint">Mouza Shop {appVersion ? `v${appVersion}` : ""}</span>
        {onOpenWhatsNew && (
          <button className="btn ghost" onClick={onOpenWhatsNew}>
            {t("whats_new_button")}
          </button>
        )}
      </div>
    </div>
  );
}
