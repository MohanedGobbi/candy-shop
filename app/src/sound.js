// Loud POS error buzzer using Web Audio API + OS system beep.
// Plays a sharp two-pulse buzzer tone (square/sawtooth) typical of supermarket scanners.

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playErrorSound() {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      // Pulse helper: frequency in Hz, start offset in seconds, duration
      const pulse = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth"; // sharp, loud, buzzer-like tone
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(1.0, start);
        gain.gain.setValueAtTime(1.0, start + duration * 0.85);
        gain.gain.exponentialRampToValueAtTime(0.01, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration);
      };

      // Two loud, low buzzing pulses: BUZZ - BUZZ
      pulse(160, now, 0.18);
      pulse(130, now + 0.22, 0.28);
    }
  } catch {
    // best-effort audio
  }

  // Trigger Windows OS beep through Electron if available
  try {
    if (window.api && typeof window.api.beep === "function") {
      window.api.beep();
    }
  } catch {
    // best effort
  }
}
