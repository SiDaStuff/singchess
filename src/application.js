import './ui/runtime-libraries.js';
import './ui/styles.css';
import './ui/bootstrap.js';
import './api-base.js';
import './firebase-config.js';
import './pieces.js';
import './board.js';
import './play/fair-play.js';
import './chess-core.js';
import './app-dialog.js';
import './footer.js';
import './ui/feature-loader.js';
import './app.js';
import './ui/workspace.js';
import './ui/forms.js';
import './ui/linked-chess.js';
import './ui/quality-of-life.js';
import './ui/training-journey.js';
import './ui/route-pages.js';

// ── Deferred module loaders ──────────────────────────────────────────────
// These modules are heavy and only needed on specific user actions. They are
// loaded on demand instead of blocking the initial application bundle.

let engineModule;
export async function loadEngine() {
  if (!engineModule) engineModule = await import('./engine.js');
  return engineModule;
}

let boostModule;
export async function loadBoost() {
  if (!boostModule) boostModule = await import('./boost.js');
  return boostModule;
}
