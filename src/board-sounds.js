// Original, synthesized audio. No downloaded recordings or third-party licenses.
// A short filtered noise tap supplies the natural wood-like attack; quiet sine
// partials add warmth. The AudioContext is created only during a user gesture.
export class BoardSounds {
  constructor(preferences = {}) {
    this.preferences = { sounds: true, volume: .45, ...preferences };
    this.context = null;
    this.destroyed = false;
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
  _tone(at, frequency, duration, gain = .2) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator(), envelope = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * .78, at + duration);
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0001, gain * this.preferences.volume), at + .004);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(envelope); envelope.connect(ctx.destination);
    oscillator.start(at); oscillator.stop(at + duration + .01);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
  _tap(at, capture = false) {
    const ctx = this.context, duration = capture ? .085 : .045;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * .009));
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = capture ? 1700 : 1250;
    gain.gain.value = this.preferences.volume * (capture ? .35 : .24);
    source.connect(filter); filter.connect(gain); gain.connect(ctx.destination); source.start(at);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    this._tone(at, capture ? 220 : 330, capture ? .11 : .07, .13);
  }
  play(type = 'move') {
    const ctx = this.context;
    if (this.destroyed || !this.preferences.sounds || !ctx || ctx.state !== 'running') return false;
    const at = ctx.currentTime + .003;
    if (type === 'start' || type === 'end' || type === 'promotion') {
      const notes = type === 'end' ? [392, 330, 262] : type === 'promotion' ? [392, 494, 587] : [330, 440];
      notes.forEach((frequency, index) => this._tone(at + index * .08, frequency, .19, .1));
    } else if (type === 'lowTime') {
      this._tone(at, 440, .11, .1); this._tone(at + .15, 392, .13, .08);
    } else {
      this._tap(at, type === 'capture');
      if (type === 'castle') this._tap(at + .07);
      if (type === 'check') this._tone(at + .02, 520, .14, .08);
    }
    return true;
  }
  destroy() {
    this.destroyed = true;
    globalThis.document?.removeEventListener('pointerdown', this._unlock);
    globalThis.document?.removeEventListener('keydown', this._unlock);
    this.context?.close?.().catch?.(() => {});
    this.context = null;
  }
}
