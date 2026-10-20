let playChunks, coachTask, adminTask, teachingTask;
function loadTeaching() {
  return teachingTask ||= import('../tactics-coach.js')
    .then(() => Promise.all([import('../tactics-advanced.js'), import('./move-explanation.js'), import('./tactical-coach.css')]))
    .then(() => { window.app?._refreshInsightsForAuth(); })
    .catch(error => { teachingTask = null; throw error; });
}
export function loadPlay() {
  // The #play-page section is an EMPTY container that mountPlay fills async.
  // route-pages prunes hidden page panels out of the live DOM, so an import
  // that happens to resolve while the container is detached would mount into
  // "nothing" and - because the chunk promise is cached - never retry. Cache
  // only the chunk fetch and re-run the (idempotent) mount on every warm so
  // it succeeds the moment #play-page is back in the DOM.
  if (!playChunks) playChunks = import('../play/index.js').catch(error => { playChunks = null; throw error; });
  return playChunks.then(module => module.mountPlay());
}
export function loadCoach() {
  return coachTask ||= Promise.all([import('../coach-chat.js'), window.loadChessMarkdown()]).then(() => window.CoachChat)
    .catch(error => { coachTask = null; throw error; });
}
const coach = {};
for (const name of ['mount', 'onAuth', 'renderGate', 'send', 'stop']) {
  coach[name] = (...args) => {
    if (name === 'onAuth') { coach.app = args[0]; return; }
    if (name === 'stop' && !coachTask) return;
    return loadCoach().then(controller => { if (coach.app) controller.onAuth(coach.app); return controller[name](...args); });
  };
}
window.CoachChat = coach;
window.AdminProfileUI = {
  onAuth(app) {
    if (!app.authState.isAdmin && !adminTask) return;
    (adminTask ||= import('./admin-profile.js')).then(() => window.AdminProfileUI.onAuth(app));
  },
};
const warm = path => {
  if (path.startsWith('/play')) void loadPlay();
  if (path === '/coach') void loadCoach();
  if (['/review', '/puzzles', '/anticheat'].includes(path)) void loadTeaching();
};
window.addEventListener('play:route', () => warm('/play'));
window.addEventListener('app:route', event => warm(event.detail?.route || location.pathname));
document.addEventListener('pointerover', event => {
  const anchor = event.target.closest('a[href]');
  if (anchor && anchor.origin === location.origin && window.app) warm(anchor.pathname);
}, { passive: true });
