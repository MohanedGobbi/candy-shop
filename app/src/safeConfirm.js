// Electron on Windows leaves the page unable to take keyboard focus after a
// native confirm()/alert(): inputs look normal but typing does nothing. Bouncing
// window focus after the dialog closes restores it.
export function safeConfirm(message) {
  const ok = window.confirm(message);
  restoreFocus();
  return ok;
}

export function restoreFocus() {
  try {
    window.blur();
    window.focus();
    setTimeout(() => {
      window.blur();
      window.focus();
    }, 0);
  } catch {
    // best effort
  }
}
