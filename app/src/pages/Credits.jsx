import { safeConfirm } from "../safeConfirm.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";

// Credit = a customer owes the shop. Debt = the shop owes someone (supplier...).
const BLANK = { kind: "credit", person: "", phone: "", amount: "", note: "" };
const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const remaining = (n) => Math.max(0, (Number(n.amount) || 0) - (Number(n.paid) || 0));
const settled = (n) => (Number(n.amount) || 0) > 0 && remaining(n) <= 0;

export default function Credits({ t }) {
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState("all"); // all | credit | debt
  const [query, setQuery] = useState("");
  const [showSettled, setShowSettled] = useState(false);
  const [edit, setEdit] = useState(null); // form data
  const [paying, setPaying] = useState(null); // note
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => window.api.listNotes().then(setNotes), []);
  useEffect(() => {
    load();
    const unsub = window.api.onSyncStatus((st) => { if (st && st.ok) load(); });
    window.addEventListener("products:reload", load);
    return () => { unsub(); window.removeEventListener("products:reload", load); };
  }, [load]);

  const totals = useMemo(() => {
    let credit = 0, debt = 0;
    for (const n of notes) {
      if (n.kind === "debt") debt += remaining(n);
      else credit += remaining(n);
    }
    return { credit, debt };
  }, [notes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => filter === "all" || (n.kind || "credit") === filter)
      .filter((n) => showSettled || !settled(n))
      .filter((n) => !q || [n.person, n.phone, n.note].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((a, b) => (settled(a) - settled(b)) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [notes, filter, query, showSettled]);

  async function save(form) {
    const amount = Number(form.amount);
    if (!form.person.trim() || !Number.isFinite(amount) || amount < 0) {
      setMsg({ type: "warn", text: t("cr_required") });
      return;
    }
    await window.api.upsertNote({
      id: form.id,
      kind: form.kind,
      person: form.person.trim(),
      phone: form.phone.trim(),
      amount,
      note: form.note
    });
    setEdit(null);
    setMsg({ type: "ok", text: t("cr_saved") });
    load();
  }

  async function pay(note, amount) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a === 0) return;
    await window.api.payNote(note.id, a);
    setPaying(null);
    setMsg({ type: "ok", text: t("cr_payment_saved") });
    load();
  }

  async function settle(note) {
    if (!safeConfirm(t("cr_settle_confirm").replace("{p}", note.person))) return;
    await pay(note, remaining(note));
  }

  async function remove(note) {
    if (!safeConfirm(t("cr_delete_confirm").replace("{p}", note.person))) return;
    await window.api.deleteNote(note.id);
    setMsg({ type: "ok", text: t("cr_deleted") });
    load();
  }

  return (
    <div className="credits">
      <div className="cr-summary">
        <div className="card kpi">
          <div className="kpi-label">{t("cr_total_credit")}</div>
          <div className="kpi-value cr-credit-text">{fmt(totals.credit)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">{t("cr_total_debt")}</div>
          <div className="kpi-value cr-debt-text">{fmt(totals.debt)}</div>
        </div>
      </div>

      <div className="toolbar cr-toolbar">
        <div className="seg">
          {["all", "credit", "debt"].map((k) => (
            <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{t("cr_filter_" + k)}</button>
          ))}
        </div>
        <input type="text" placeholder={t("cr_search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="cr-check">
          <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} /> {t("cr_show_settled")}
        </label>
        <button className="btn" onClick={() => { setMsg(null); setEdit({ ...BLANK, kind: filter === "debt" ? "debt" : "credit" }); }}>
          {t("cr_new")}
        </button>
      </div>

      {msg && <div className={"banner " + msg.type}>{msg.text}</div>}

      {shown.length === 0 ? (
        <div className="card hint cr-empty">{t("cr_empty")}</div>
      ) : (
        <div className="cr-grid">
          {shown.map((n) => {
            const total = Number(n.amount) || 0;
            const paid = Number(n.paid) || 0;
            const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
            const isDebt = n.kind === "debt";
            const done = settled(n);
            return (
              <div key={n.id} className={"card cr-card " + (isDebt ? "debt" : "credit") + (done ? " settled" : "")}>
                <div className="cr-card-top">
                  <span className={"cr-tag " + (isDebt ? "debt" : "credit")}>{t(isDebt ? "cr_kind_debt" : "cr_kind_credit")}</span>
                  {done && <span className="cr-tag settled">{t("cr_settled")}</span>}
                  <span className="cr-date">{new Date(n.createdAt || n.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="cr-person">{n.person}</div>
                {n.phone && <div className="cr-phone" dir="ltr">{n.phone}</div>}
                {n.note && <div className="cr-note">{n.note}</div>}
                <div className="cr-amounts">
                  <div>
                    <div className="cr-small">{t("cr_remaining")}</div>
                    <div className="cr-remaining">{fmt(remaining(n))}</div>
                  </div>
                  <div className="cr-small cr-paid">{t("cr_paid")} {fmt(paid)} / {fmt(total)}</div>
                </div>
                <div className="cr-bar"><div style={{ width: pct + "%" }} /></div>
                <div className="cr-actions">
                  {!done && <button className="btn" onClick={() => setPaying(n)}>{t("cr_add_payment")}</button>}
                  {!done && <button className="btn ghost" onClick={() => settle(n)}>{t("cr_settle")}</button>}
                  <button className="btn ghost" onClick={() => setEdit({ id: n.id, kind: n.kind || "credit", person: n.person || "", phone: n.phone || "", amount: n.amount ?? "", note: n.note || "" })}>{t("cr_edit_btn")}</button>
                  <button className="btn ghost" onClick={() => remove(n)}>{t("delete")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {edit && <NoteModal t={t} data={edit} onCancel={() => setEdit(null)} onSave={save} />}
      {paying && <PayModal t={t} note={paying} onCancel={() => setPaying(null)} onPay={(a) => pay(paying, a)} />}
    </div>
  );
}

function NoteModal({ t, data, onCancel, onSave }) {
  const [form, setForm] = useState(data);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal cr-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{data.id ? t("cr_edit") : t("cr_new_title")}</h2>
        <div className="seg cr-kind">
          <button type="button" className={form.kind === "credit" ? "active" : ""} onClick={() => setForm({ ...form, kind: "credit" })}>{t("cr_kind_credit_long")}</button>
          <button type="button" className={form.kind === "debt" ? "active" : ""} onClick={() => setForm({ ...form, kind: "debt" })}>{t("cr_kind_debt_long")}</button>
        </div>
        <div className="field">
          <label>{t("cr_person")}</label>
          <input autoFocus value={form.person} onChange={set("person")} />
        </div>
        <div className="field">
          <label>{t("cr_phone")}</label>
          <input value={form.phone} onChange={set("phone")} dir="ltr" />
        </div>
        <div className="field">
          <label>{t("cr_amount")}</label>
          <input type="number" min="0" value={form.amount} onChange={set("amount")} />
        </div>
        <div className="field">
          <label>{t("cr_note")}</label>
          <textarea rows={6} value={form.note} onChange={set("note")} placeholder={t("cr_note_hint")} />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
          <button className="btn" onClick={() => onSave(form)}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}

function PayModal({ t, note, onCancel, onPay }) {
  const [amount, setAmount] = useState(String(remaining(note)));
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("cr_add_payment")} — {note.person}</h2>
        <div className="hint" style={{ marginBottom: 10 }}>{t("cr_remaining")}: {fmt(remaining(note))}</div>
        <div className="field">
          <label>{t("cr_amount")}</label>
          <input
            type="number" min="0" autoFocus value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onPay(amount); }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
          <button className="btn" onClick={() => onPay(amount)}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
