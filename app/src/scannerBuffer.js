// Pure logic for telling a barcode scanner's keystrokes apart from a human
// typing. A scanner "types" very fast and constantly; a person typing, even
// quickly, is slower and uneven. No DOM here, so this can be unit-tested.

// Map a keydown to the character the scanner meant, independent of the OS
// keyboard layout. A USB scanner sends US-layout key positions; on a French
// AZERTY layout the top row yields "&é\"'(" instead of digits, so we read
// the physical key (e.code) first and fall back to e.key.
export function keyToChar(key, code) {
  if (code) {
    let m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (m) return m[1];
    m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    if (code === "Minus" || code === "NumpadSubtract") return "-";
  }
  if (key && key.length === 1) return key;
  return null;
}

export function createScannerBuffer({ maxGapMs = 120, maxAvgMsPerChar = 50, minLength = 4 } = {}) {
  let chars = [];
  let times = [];

  function reset() {
    chars = [];
    times = [];
  }

  function feedChar(ch, now) {
    if (times.length > 0 && now - times[times.length - 1] > maxGapMs) reset();
    chars.push(ch);
    times.push(now);
  }

  function pending() {
    return chars.length;
  }

  // Call on Enter/Tab, or on idle timeout (scanner with no terminator).
  // Returns { code, ok, raw, avg, reason }; ok=false means "not a scan".
  function consume(now) {
    const raw = chars.join("");
    const n = times.length;
    const avg = n > 1 ? (times[n - 1] - times[0]) / (n - 1) : 0;
    let reason = null;
    if (raw.length < minLength) reason = "short";
    else if (!/^[A-Za-z0-9-]+$/.test(raw)) reason = "chars";
    else if (now - times[n - 1] > maxGapMs) reason = "gap";
    else if (avg > maxAvgMsPerChar) reason = "slow";
    reset();
    return { code: reason ? null : raw, ok: !reason, raw, avg: Math.round(avg), reason };
  }

  // Backwards-compatible API used by the tests.
  function consumeOnTerminator(now) {
    return consume(now).code;
  }

  return { feedChar, consume, consumeOnTerminator, reset, pending };
}
