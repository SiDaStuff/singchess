// Professional chess sounds. Uses real recorded MP3s from /sounds/ when
// available, falling back to clean synthesis. No third-party licenses.
// The AudioContext is created only during a user gesture, and the volume
// preference is applied on a shared master bus.
// Real sound files on disk, keyed by the logical play() type. play() uses
// 'promotion' but the file on disk is named 'promote.mp3'; any type missing
// from this map (e.g. lowTime) intentionally falls back to synthesis.
const SOUND_FILES = {
  move: 'move',
  capture: 'capture',
  castle: 'castle',
  check: 'check',
  promotion: 'promote',
  start: 'start',
  end: 'end',
};
export class BoardSounds {
  constructor(preferences = {}) {
    this.preferences = { sounds: true, volume: .45, ...preferences };
    this.context = null;
    this.destroyed = false;
    this._pitchCycle = 0;
    this._unlock = () => this.unlock();
    globalThis.document?.addEventListener('pointerdown', this._unlock, { passive: true });
    globalThis.document?.addEventListener('keydown', this._unlock);
    // Preloaded real audio buffers, keyed by sound type.
    this._buffers = new Map();
    this._preloadPromise = null;
  }
  setPreferences(patch) { Object.assign(this.preferences, patch); }

  // Preload real MP3 sound effects. Safe to call multiple times.
  preload() {
    if (this._preloadPromise) return this._preloadPromise;
    this._preloadPromise = (async () => {
      const ctx = await this._audioContext();
      if (!ctx) return;
      const types = Object.keys(SOUND_FILES);
      await Promise.all(types.map(type => this._loadBuffer(ctx, type)));
    })();
    return this._preloadPromise;
  }

  async _audioContext() {
    if (this.context) return this.context;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return null;
    this.context = new Context();
    if (this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { /* gesture may be required */ }
    }
    return this.context;
  }

  async _loadBuffer(ctx, type) {
    try {
      const file = SOUND_FILES[type];
      if (!file) return;
      const res = await fetch(`/sounds/${file}.mp3`);
      if (!res.ok) return;
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      this._buffers.set(type, audioBuffer);
    } catch { /* fall back to synthesis for this type */ }
  }

  async unlock() {
    if (this.destroyed || !this.preferences.sounds) return;
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return;
      this.context ||= new Context();
      if (this.context.state === 'suspended') await this.context.resume();
      await this.preload();
    } catch { /* Browsers may keep audio suspended until their next gesture. */ }
  }

  _master() {
    const ctx = this.context;
    if (!ctx) return null;
    if (!this._masterNode) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.1;
      const master = ctx.createGain();
      master.gain.value = this.preferences.volume;
      compressor.connect(master);
      master.connect(ctx.destination);
      this._compressor = compressor;
      this._masterNode = master;
    } else {
      this._masterNode.gain.value = this.preferences.volume;
    }
    return this._masterNode;
  }

  // Play a preloaded real audio buffer.
  _playBuffer(type, at) {
    const ctx = this.context;
    const buffer = this._buffers.get(type);
    if (!ctx || !buffer) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Humanize pitch slightly so repeated moves vary.
    const p = [1, .96, 1.04][this._pitchCycle++ % 3];
    if (p !== 1) source.playbackRate.value = p;
    source.connect(this._master());
    source.start(at);
    source.onended = () => { try { source.disconnect(); } catch (_) {} };
    return true;
  }

  // Fallback synthesized sounds when real audio isn't available.
  _noiseBurst(at, { duration = .05, cutoff = 1500, gain = .3, attack = .005 } = {}) {
    const ctx = this.context, master = this._master();
    if (!ctx || !master) return;
    const samples = Math.max(1, Math.ceil(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 12;
    const env = ctx.createGain();
    env.gain.setValueAtTime(.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(env);
    env.connect(master);
    source.start(at);
    source.onended = () => { source.disconnect(); filter.disconnect(); env.disconnect(); };
  }

  _tone(at, { freq = 330, end, duration = .15, gain = .08, type = 'sine', attack = .01, decay = .08 } = {}) {
    const ctx = this.context, master = this._master();
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const finalFreq = end ?? freq;
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), at);
    if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    env.gain.setValueAtTime(.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + duration + .05);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  _woodTap(at, { freq = 180, duration = .2, gain = .15, attack = .005 } = {}) {
    const ctx = this.context, master = this._master();
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * .7, at + duration);
    env.gain.setValueAtTime(.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + duration + .05);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  play(type = 'move') {
    const ctx = this.context;
    if (this.destroyed || !this.preferences.sounds || !ctx || ctx.state !== 'running') return false;
    const at = ctx.currentTime + .005;
    const v = () => Math.max(.02, this.preferences.volume || 0);

    // Try real audio first.
    if (this._playBuffer(type, at)) return true;

    // Fallback to synthesis.
    const p = [1, .96, 1.04][this._pitchCycle++ % 3];

    if (type === 'start') {
      this._tone(at, { freq: 220 * p, duration: .25, gain: .06, type: 'triangle' });
      this._tone(at + .08, { freq: 330 * p, duration: .25, gain: .06, type: 'triangle' });
      this._tone(at + .16, { freq: 440 * p, duration: .4, gain: .07, type: 'triangle' });
      this._woodTap(at + .02, { freq: 150 * p, duration: .3, gain: .1 });
    } else if (type === 'end') {
      this._tone(at, { freq: 330 * p, end: 262 * p, duration: .5, gain: .06, type: 'triangle' });
      this._tone(at + .12, { freq: 220 * p, end: 165 * p, duration: .6, gain: .05, type: 'triangle' });
      this._woodTap(at + .05, { freq: 120 * p, duration: .4, gain: .08 });
    } else if (type === 'promotion') {
      this._tone(at, { freq: 523 * p, duration: .15, gain: .07, type: 'triangle' });
      this._tone(at + .07, { freq: 659 * p, duration: .15, gain: .07, type: 'triangle' });
      this._tone(at + .14, { freq: 784 * p, duration: .2, gain: .08, type: 'triangle' });
      this._tone(at + .21, { freq: 1047 * p, duration: .35, gain: .09, type: 'triangle' });
      this._noiseBurst(at + .02, { duration: .04, cutoff: 2500, gain: v() * .25 });
    } else if (type === 'lowTime') {
      this._tone(at, { freq: 880 * p, duration: .05, gain: .05, type: 'square' });
      this._tone(at + .09, { freq: 700 * p, duration: .05, gain: .05, type: 'square' });
    } else {
      const capture = type === 'capture';
      const castle = type === 'castle';
      if (capture) {
        this._noiseBurst(at, { duration: .07, cutoff: 700, gain: v() * .6, attack: .003 });
        this._woodTap(at, { freq: 110 * p, duration: .25, gain: .14, attack: .003 });
        this._tone(at, { freq: 165 * p, end: 90 * p, duration: .2, gain: .08, type: 'triangle' });
      } else {
        this._noiseBurst(at, { duration: .045, cutoff: 1800, gain: v() * .35, attack: .004 });
        this._woodTap(at, { freq: 220 * p, duration: .18, gain: .1, attack: .004 });
        this._tone(at, { freq: 440 * p, end: 330 * p, duration: .12, gain: .05, type: 'triangle' });
        if (castle) {
          this._noiseBurst(at + .12, { duration: .045, cutoff: 1400, gain: v() * .3, attack: .004 });
          this._woodTap(at + .12, { freq: 160 * p, duration: .18, gain: .09, attack: .004 });
        }
      }
      if (type === 'check') {
        this._tone(at + .02, { freq: 660 * p, duration: .2, gain: .06, type: 'triangle' });
        this._tone(at + .06, { freq: 988 * p, duration: .25, gain: .055, type: 'triangle' });
      }
    }
    return true;
  }

  destroy() {
    this.destroyed = true;
    globalThis.document?.removeEventListener('pointerdown', this._unlock);
    globalThis.document?.removeEventListener('keydown', this._unlock);
    try { this._masterNode?.disconnect?.(); } catch (_) {}
    try { this._compressor?.disconnect?.(); } catch (_) {}
    this.context?.close?.().catch?.(() => {});
    this.context = null;
    this._buffers.clear();
  }
}
