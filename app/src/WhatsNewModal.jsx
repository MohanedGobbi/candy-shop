import React from "react";
import changelog from "./changelog.json";

export default function WhatsNewModal({ t, lang, version, onClose, customNotes }) {
  // Find matching version in changelog or default to the most recent entry
  const entry = changelog.find((e) => e.version === version) || changelog[0] || {};
  const isAr = lang === "ar";

  let items = isAr ? (entry.items_ar || entry.items_fr || []) : (entry.items_fr || []);

  // If customNotes is provided from GitHub release, format or use them
  let noteText = "";
  if (customNotes) {
    if (typeof customNotes === "string") noteText = customNotes;
    else if (Array.isArray(customNotes)) noteText = customNotes.map((n) => n.note || n).join("\n");
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal whats-new-modal">
        <div className="whats-new-header">
          <span className="whats-new-icon" aria-hidden="true">🎉</span>
          <div>
            <h2 style={{ margin: 0 }}>
              {t("whats_new_title")} {version ? `(v${version})` : ""}
            </h2>
            <div className="whats-new-sub">{t("whats_new_subtitle")}</div>
          </div>
        </div>

        {noteText ? (
          <div className="whats-new-notes">{noteText}</div>
        ) : (
          <ul className="whats-new-list">
            {items.map((item, idx) => (
              <li key={idx}>
                <span className="whats-new-check">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn" autoFocus onClick={onClose} style={{ minWidth: 120 }}>
            {t("whats_new_close")}
          </button>
        </div>
      </div>
    </div>
  );
}
