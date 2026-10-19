const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
const colorKey = color => color === 'w' ? 'white' : color === 'b' ? 'black' : color;

/** Clock values are sampled when server state arrives, then interpolated locally.
 * No network latency is guessed and reaching zero never declares a game over. */
export class PlayClock {
  constructor({ now = monotonicNow } = {}) {
    this.now = now;
    this.white = 0;
    this.black = 0;
    this.running = null;
    this.sampledAt = now();
  }
  sync({ white, black, running = null }) {
    if (!Number.isFinite(white) || !Number.isFinite(black)) return false;
    this.white = Math.max(0, white);
    this.black = Math.max(0, black);
    const color = colorKey(running);
    this.running = color === 'white' || color === 'black' ? color : null;
    this.sampledAt = this.now();
    return true;
  }
  values(at = this.now()) {
    const elapsed = Math.max(0, at - this.sampledAt);
    return { white: Math.max(0, this.white - (this.running === 'white' ? elapsed : 0)),
      black: Math.max(0, this.black - (this.running === 'black' ? elapsed : 0)), running: this.running };
  }
  stop() { const values = this.values(); this.sync({ ...values, running: null }); }
}

export function formatPlayClock(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  // Avoid displaying 0:00 while there is still time remaining.
  const seconds = ms < 10000 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const whole = `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  return ms < 10000 ? `${whole}.${Math.floor(ms % 1000 / 100)}` : whole;
}

export class PlayClockPair {
  constructor({ whiteElement, blackElement, onLowTime, now, lowTimeMs = 15000 } = {}) {
    this.elements = { white: whiteElement, black: blackElement };
    this.clock = new PlayClock({ now });
    this.onLowTime = onLowTime;
    this.lowTimeMs = lowTimeMs;
    this.warned = { white: false, black: false };
    this.destroyed = false;
    this._visibility = () => this._render();
    globalThis.document?.addEventListener('visibilitychange', this._visibility);
    this._render();
    this.timer = setInterval(() => this._render(), 50);
  }
  sync(state) {
    if (!this.clock.sync(state)) return false;
    // Re-arm after a time-control period or substantial correction, not each increment.
    for (const color of ['white', 'black']) if (state[color] > this.lowTimeMs * 2) this.warned[color] = false;
    this._render();
    return true;
  }
  _render() {
    if (this.destroyed) return;
    const values = this.clock.values();
    for (const color of ['white', 'black']) {
      const element = this.elements[color];
      if (element) {
        const text = formatPlayClock(values[color]);
        if (element.textContent !== text) element.textContent = text;
        element.classList.toggle('is-running', values.running === color);
        element.classList.toggle('is-low', values[color] <= this.lowTimeMs);
        element.dataset.running = String(values.running === color);
        element.setAttribute('aria-label', `${color === 'white' ? 'White' : 'Black'}: ${text}${values.running === color ? ', running' : ''}`);
      }
      if (values.running === color && values[color] > 0 && values[color] <= this.lowTimeMs && !this.warned[color]) {
        this.warned[color] = true;
        this.onLowTime?.(color);
      }
    }
  }
  stop() { this.clock.stop(); this._render(); }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    globalThis.document?.removeEventListener('visibilitychange', this._visibility);
  }
}
