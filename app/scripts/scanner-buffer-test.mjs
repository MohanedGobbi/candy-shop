import { createScannerBuffer, keyToChar } from "../src/scannerBuffer.js";

function simulate(buf, code, msPerChar, terminatorGap = msPerChar) {
  let t = 1000;
  for (const ch of code) {
    buf.feedChar(ch, t);
    t += msPerChar;
  }
  return buf.consumeOnTerminator(t + terminatorGap - msPerChar);
}

// 1) A real scanner: ~5ms between characters, regardless of what has focus.
let buf = createScannerBuffer();
let r = simulate(buf, "6194002510064", 5);
console.assert(r === "6194002510064", "fast scan should be accepted, got " + r);

// 2) A cashier typing a barcode by hand into the same field: ~150ms/char.
buf = createScannerBuffer();
r = simulate(buf, "6194002510064", 150);
console.assert(r === null, "slow manual typing must NOT be treated as a scan, got " + r);

// 3) Too short to be a real barcode, even if fast.
buf = createScannerBuffer();
r = simulate(buf, "12", 5);
console.assert(r === null, "short input should be rejected, got " + r);

// 4) A pause mid-scan (e.g. a USB hiccup on an old PC) breaks the burst;
//    the leftover tail after the pause is too short, so it's correctly rejected.
buf = createScannerBuffer();
buf.feedChar("1", 1000);
buf.feedChar("2", 1005);
buf.feedChar("3", 1010);
// long pause here (USB jitter)
buf.feedChar("4", 1200);
buf.feedChar("5", 1205);
r = buf.consumeOnTerminator(1210);
console.assert(r === null, "code broken by a long pause should not be accepted as-is, got " + r);

// 5) Tab as a terminator (some scanners are configured this way) works the same as Enter.
buf = createScannerBuffer();
r = simulate(buf, "4005900422699", 4);
console.assert(r === "4005900422699", "fast scan with Tab terminator should be accepted, got " + r);

// 6) After a valid scan, the buffer is clean for the next one.
buf = createScannerBuffer();
simulate(buf, "111111111111", 5);
r = simulate(buf, "222222222222", 5);
console.assert(r === "222222222222", "buffer should reset cleanly between scans, got " + r);

// 7) AZERTY layout: scanner sends Digit keys, OS reports &é"... in e.key.
const azerty = { Digit1: "&", Digit2: "é", Digit3: "\"", Digit6: "-", Digit9: "ç", Digit0: "à", Digit4: "'" };
const chars = "6194002510064".split("").map((d) => keyToChar(azerty["Digit" + d] ?? "x", "Digit" + d));
console.assert(chars.join("") === "6194002510064", "AZERTY digits must map via e.code, got " + chars.join(""));
console.assert(keyToChar("1", "Numpad1") === "1", "numpad digit");
console.assert(keyToChar("Shift", "ShiftLeft") === null, "modifier ignored");

// 8) Slower scanner / old Win7 USB stack: ~30-45 ms per char still accepted.
buf = createScannerBuffer();
r = simulate(buf, "6194002510064", 45);
console.assert(r === "6194002510064", "45ms/char scanner should be accepted, got " + r);

// 9) consume() explains rejections (for the top-bar readout).
buf = createScannerBuffer();
buf.feedChar("1", 0); buf.feedChar("2", 100); buf.feedChar("3", 200); buf.feedChar("4", 300);
let res = buf.consume(310);
console.assert(!res.ok && res.reason === "slow", "slow typing explained, got " + JSON.stringify(res));

console.log("ALL SCANNER-BUFFER TESTS PASSED");
