// Original, synthesized audio. No downloaded recordings or third-party licenses.
// A soft filtered-noise body supplies the natural wood-like attack; a lower
// sibling tone adds warmth. Pitches vary slightly between identical moves so
// repeated sounds never feel robotic. The AudioContext is created only during
// a user gesture, and the volume preference is applied on a shared master bus.
export class BoardSounds {
  constructor(preferences = {}) {
    this.preferences = { sounds: true, volume: .45, ...preferences };
    this.context = null;
    this.destroyed = false;
    this._pitchCycle = 0;
    this._unlock = () => this.unlock();
    globalThis.document?.addEventListener('pointerdown', this._unlock, { passive: true });
    globalThis.document?.addEventListener('keydown', this._unlock);
  }
  setPreferences(patch) { Object.assign(this.preferences, patch); }
  async unlock() {
    if (this.destroyed || !this.preferences.sounds) return;
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return;
      this.context ||= new Context();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Browsers may keep audio suspended until their next gesture. */ }
  }

  _master() {
    const ctx = this.context;
    if (!ctx) return null;
    if (!this._masterNode) {
      const node = ctx.createGain();
      node.gain.value = this.preferences.volume;
      node.connect(ctx.destination);
      this._masterNode = node;
    } else {
      // Keep the same node connected; only retune its level.
      this._masterNode.gain.value = this.preferences.volume;
    }
    return this._masterNode;
  }

  // Gentle musical tone. attack ramps up quickly-but-smoothly so nothing
  // "clicks" — the source of the jarring feel in most synthesized sounds.
  _tone(at, { freq = 330, end, duration = .12, gain = .08, type = 'sine', attack = .005 } = {}) {
    const ctx = this.context, master = this._master();
    if (!ctx || !master) return;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    const finalFreq = Math.max(20, end ?? freq * .88);
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), at);
    osc.frequency.exponentialRampToValueAtTime(finalFreq, at + duration);
    env.gain.setValueAtTime(.0001, at);
    env.gain.linearRampToValueAtTime(Math.max(.0001, gain), at + attack);
    env.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(env); env.connect(master);
    osc.start(at); osc.stop(at + duration + .06);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  // Wood-like tap built from low-passed noise with a smooth attack and a warm,
  // round decay (shorter attack + higher cutoff = harder; lower cutoff = softer).
  _noise(at, { duration = .045, cutoff = 1050, gain = .3, attack = .0025 } = {}) {
    const ctx = this.context, master = this._master();
    if (!ctx || !master) return;
    const samples = Math.max(1, Math.ceil(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    const pole = Math.min(1, cutoff / ctx.sampleRate);
    for (let i = 0; i < samples; i++) {
      last += (Math.random() * 2 - 1 - last) * pole;
      data[i] = last;
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), env = ctx.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = cutoff;
    env.gain.setValueAtTime(.0001, at);
    env.gain.linearRampToValueAtTime(Math.max(.0001, gain), at + attack);
    env.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter); filter.connect(env); env.connect(master);
    source.start(at); source.onended = () => { source.disconnect(); filter.disconnect(); env.disconnect(); };
  }

  play(type = 'move') {
    const ctx = this.context;
    if (this.destroyed || !this.preferences.sounds || !ctx || ctx.state !== 'running') return false;
    const at = ctx.currentTime + .002;
    const v = () => Math.max(.02, this.preferences.volume || 0);
    // Humanize: nudge pitch on a short cycle so repeated moves vary a little.
    const p = [1, .955, 1.045][this._pitchCycle++ % 3];
    const notes = (steps) => steps.forEach(([delay, freq, gain = .08, duration = .18], i) =>
      this._tone(at + delay, { freq: freq * p, end: freq * .92 * p, duration, gain }));

    if (type === 'start') {
      notes([[0, 262, .07, .16], [.08, 330, .07, .16], [.16, 392, .08, .2], [.24, 523, .09, .28]]);
    } else if (type === 'end') {
      notes([[0, 392, .08, .2], [.11, 330, .08, .24], [.22, 262, .09, .38]]);
    } else if (type === 'promotion') {
      notes([[0, 392, .08, .16], [.09, 494, .08, .16], [.18, 587, .1, .3]]);
    } else if (type === 'lowTime') {
      this._tone(at, { freq: 680 * p, duration: .06, gain: .05, type: 'square' });
    } else {
      const capture = type === 'capture';
      const castle = type === 'castle';
      if (capture) {
        // A duller, deeper "wooden clunk": low body tone + short low noise.
        this._noise(at, { duration: .06, cutoff: 600, gain: v() * .55, attack: .002 });
        this._tone(at, { freq: 136 * p, end: 88, duration: .17, gain: .12, type: 'triangle' });
        this._noise(at + .025, { duration: .045, cutoff: 280, gain: v() * .42 });
      } else {
        this._noise(at, { duration: .045, cutoff: 1180, gain: v() * .38 });
        this._tone(at, { freq: 300 * p, end: 210 * p, duration: .1, gain: .07 });
        if (castle) {
          this._noise(at + .1, { duration: .045, cutoff: 1180, gain: v() * .34 });
          this._tone(at + .1, { freq: 210 * p, end: 150 * p, duration: .1, gain: .06 });
        }
      }
      if (type === 'check') {
        // A bright two-note chime (fifth) that reads as "attention", not alarm.
        this._tone(at + .02, { freq: 660 * p, duration: .18, gain: .06, type: 'triangle' });
        this._tone(at + .055, { freq: 880 * p, duration: .22, gain: .055, type: 'triangle' });
      }
    }
    return true;
  }

  destroy() {
    this.destroyed = true;
    globalThis.document?.removeEventListener('pointerdown', this._unlock);
    globalThis.document?.removeEventListener('keydown', this._unlock);
    try { this._masterNode?.disconnect?.(); } catch (_) {}
    this.context?.close?.().catch?.(() => {});
    this.context = null;
  }
}
