import { useEffect, useRef } from "react";
import { createScannerBuffer, keyToChar } from "./scannerBuffer.js";

// How long after the last character we treat the burst as finished, for
// scanners configured without an Enter/Tab suffix.
const IDLE_FLUSH_MS = 150;

// React's controlled inputs ignore a plain `el.value = ""`, because React
// tracks changes through its own value setter. This writes through the
// native setter instead and fires a real "input" event.
function clearControlledInput(el, removeChars) {
  try {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    // Remove only what the scan typed (its tail), keep what the user had typed before.
    const v = el.value || "";
    const next = removeChars && v.length >= removeChars ? v.slice(0, v.length - removeChars) : "";
    setter.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    // best effort
  }
}

function eventTime(e) {
  try {
    const t = performance.timeOrigin + e.timeStamp;
    if (Number.isFinite(t) && Math.abs(t - Date.now()) < 5000) return t;
  } catch {}
  return Date.now();
}

// Broadcast what the scanner sent so the top bar can show it (diagnostics).
function report(info) {
  try {
    window.__lastScan = info;
    window.dispatchEvent(new CustomEvent("scanner:read", { detail: info }));
  } catch {}
}

// A barcode scanner behaves like a keyboard that types very fast, usually
// ending with Enter (sometimes Tab, sometimes nothing). We tell it apart from
// a person typing by speed, not by which field has focus.
// `enabled` lets a page turn scanning off entirely (e.g. a modal with its own
// barcode field).
export function useBarcodeScanner(onScan, enabled = true) {
  const bufRef = useRef(null);
  if (!bufRef.current) bufRef.current = createScannerBuffer();
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let idleTimer = null;
    let typedInField = 0; // chars of the current burst that landed in an input

    function finish(now, e) {
      clearTimeout(idleTimer);
      idleTimer = null;
      const buf = bufRef.current;
      if (!buf.pending()) return false;
      const res = buf.consume(now);
      const typed = typedInField;
      typedInField = 0;
      // Show scans and near-misses in the top bar, not ordinary human typing.
      if (res.ok || (res.raw.length >= 4 && res.avg < 150)) report(res);
      if (!res.ok) return false;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && typed) clearControlledInput(el, typed);
      onScanRef.current(res.code);
      return true;
    }

    function handleKeyDown(e) {
      // Use when the key was actually pressed, not when we got to handle it:
      // a page busy redrawing (e.g. the product list filtering on every
      // scanned character) delays handling and would split one scan in two.
      const now = eventTime(e);

      if (e.key === "Enter" || e.key === "Tab" || e.code === "NumpadEnter") {
        finish(now, e);
        return;
      }

      const ch = keyToChar(e.key, e.code);
      if (ch === null) return; // Shift, NumLock, etc.
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      bufRef.current.feedChar(ch, now);
      if (bufRef.current.pending() === 1) typedInField = 0; // new burst
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) typedInField++;
      else typedInField = 0;

      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(Date.now() - IDLE_FLUSH_MS + 1, null), IDLE_FLUSH_MS);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [enabled]);
}
