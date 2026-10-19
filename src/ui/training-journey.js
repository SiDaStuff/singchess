import { readJson, writeJson } from './qol-state.js';
import { journeyOffer, journeySteps, offerDismissed } from './journey-state.js';
import './training-journey.css';

const create = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const icon = name => { const node = create('span', name, 'material-symbols-outlined'); node.setAttribute('aria-hidden', 'true'); return node; };
const link = (label, href, symbol, className = 'btn btn-primary') => {
  const node = create('a', null, className); node.href = href;
  if (symbol) node.append(icon(symbol)); node.append(create('span', label)); return node;
};

export function installTrainingJourney(app) {
  const home = create('section', null, 'journey-card journey-home'); home.id = 'training-journey-home'; home.hidden = true;
  document.querySelector('.home-workspace')?.after(home);
  const account = create('section', null, 'journey-card'); account.id = 'training-journey-account'; account.hidden = true;
  document.querySelector('#account-signed-in-page .account-hero')?.after(account);
  const review = create('section', null, 'card panel-wide journey-card'); review.id = 'training-journey-review'; review.hidden = true;
  document.getElementById('review-summary')?.after(review);
  const puzzle = create('section', null, 'journey-card'); puzzle.id = 'training-journey-puzzle'; puzzle.hidden = true;
  document.getElementById('puzzle-card')?.append(puzzle);
  const coach = create('section', null, 'journey-card journey-coach'); coach.id = 'training-journey-coach'; coach.hidden = true;
  document.getElementById('coach-usage-bar')?.after(coach);
  const planContext = create('section', null, 'journey-plan-context'); planContext.id = 'training-journey-plan-context'; planContext.hidden = true;
  document.querySelector('.plans-page-head')?.after(planContext);
  const sidebar = document.querySelector('.sidebar-upgrade');
  const scope = () => app.authState.user?.uid || 'guest';
  const progressKey = () => `sidastuff.trainingJourney.${scope()}`;
  const dismissKey = () => `sidastuff.journeyDismissals.${scope()}`;
  const progress = () => readJson(progressKey(), {}) || {};
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true; queueMicrotask(() => { queued = false; render(); });
  }
  function snapshot() {
    return {
      resolved: app.authState.initialized === true,
      signedIn: !!app.authState.user,
      // A failed profile fetch must not classify a paid subscriber as Free.
      plan: app.authState.me?.plan?.plan,
      blocked: !!window.PlayFairPlay?.isBlocked(),
      features: app.authState.me?.features,
      usage: app.authState.usage || {}, limits: app.authState.limits || {}, progress: progress(),
      reviewReady: !!app.analysisResults?.length && app.analysisResults.length === app.gameMoves.length,
      puzzleSolved: !!app.puzzleMode.solved,
    };
  }
  function record(key) {
    writeJson(progressKey(), { ...progress(), [key]: true }); schedule();
  }
  function price(tier) {
    const card = document.querySelector(`.plan-tier-${tier?.toLowerCase()}`);
    return [card?.querySelector('.amount')?.textContent, card?.querySelector('.period')?.textContent].filter(Boolean).join('');
  }
  function renderOffer(host, offer, dismissible = true) {
    host.replaceChildren();
    host.hidden = !offer || (dismissible && offerDismissed(readJson(dismissKey(), {})?.[offer.key]));
    if (host.hidden) return;
    host.setAttribute('aria-label', offer.kind === 'signup' ? 'Free account benefits' : `${offer.tier} benefits`);
    const title = create('h3', offer.title), description = create('p', offer.description);
    host.append(title, description);
    if (offer.proof) host.append(create('p', offer.proof, 'journey-proof'));
    if (offer.tier && price(offer.tier)) host.append(create('p', `${offer.tier} · ${price(offer.tier)}`, 'journey-price'));
    const actions = create('div', null, 'journey-actions'); actions.append(link(offer.label, offer.href, offer.kind === 'signup' ? 'person_add' : 'arrow_forward'));
    if (dismissible) {
      const dismiss = create('button', 'Not now', 'btn btn-ghost btn-small'); dismiss.type = 'button';
      dismiss.addEventListener('click', () => {
        writeJson(dismissKey(), { ...readJson(dismissKey(), {}), [offer.key]: Date.now() + 24 * 60 * 60 * 1000 });
        host.hidden = true;
      }); actions.append(dismiss);
    }
    host.append(actions, create('small', offer.note, 'journey-note'));
  }
  function renderDashboard(host, state) {
    host.replaceChildren(); host.hidden = !state.resolved || state.blocked;
    if (host.hidden) return;
    if (!state.signedIn) { renderOffer(host, journeyOffer(state, 'home'), false); return; }
    host.setAttribute('aria-label', 'Your training steps');
    const steps = journeySteps(true, state.progress, app.authState.profile?.puzzleStats?.solved);
    const done = steps.filter(step => step.done).length;
    host.append(create('h3', done === 3 ? 'Practice' : 'Getting started'),
      create('p', `${done} of 3 first steps complete`, 'journey-proof'));
    const meter = create('progress'); meter.max = 3; meter.value = done; meter.setAttribute('aria-label', 'First training steps'); host.append(meter);
    const list = create('ul', null, 'journey-steps');
    for (const step of steps) {
      const item = create('li'); item.classList.toggle('is-complete', step.done);
      if (step.done) { item.append(icon('check_circle'), create('span', step.label), create('span', 'Complete', 'sr-only')); }
      else item.append(link(step.label, step.href, step.icon, 'btn-link'));
      list.append(item);
    }
    host.append(list);
    const offer = create('div', null, 'journey-next'); renderOffer(offer, journeyOffer(state, 'account')); host.append(offer);
  }
  function renderSidebar(state) {
    if (!sidebar) return;
    sidebar.hidden = !state.resolved || state.blocked;
    if (sidebar.hidden) return;
    const guest = !state.signedIn, free = state.plan === 'free';
    const href = guest ? '/signup?src=sidebar&quick=1' : free ? '/plans?src=sidebar&focus=boost' : '/account';
    sidebar.href = href; sidebar.dataset.route = href.split('?')[0];
    sidebar.querySelector('.material-symbols-outlined').textContent = guest ? 'person_add' : free ? 'bolt' : 'account_circle';
    sidebar.querySelector('strong').textContent = guest ? 'Free account' : free ? 'Boost' : state.plan ? `${state.plan === 'max' ? 'Max' : 'Boost'} is active` : 'Your chess account';
    sidebar.querySelector('p').textContent = guest ? 'Save puzzle progress and sync your setup.' : free ? 'Unlimited server reviews with Boost.' : 'Your plan, usage, and training progress.';
    sidebar.querySelector('.upgrade-label').replaceChildren(create('span', guest ? 'Create free account' : free ? 'Compare Boost' : 'Your account'), icon('arrow_outward'));
    if (free && state.features?.serverReviews === false) {
      sidebar.href = '/account'; sidebar.dataset.route = '/account';
      sidebar.querySelector('strong').textContent = 'Your chess account'; sidebar.querySelector('p').textContent = 'Your plan, usage, and training progress.';
      sidebar.querySelector('.upgrade-label').textContent = 'Your account';
    }
  }
  function renderPlans(state) {
    document.querySelectorAll('.plan-tier').forEach(card => card.classList.remove('journey-recommended'));
    const params = new URLSearchParams(location.search), requested = params.get('focus');
    const recommendation = journeyOffer(state, params.get('src') === 'coach' ? 'coach' : 'account');
    const tier = state.signedIn && ['boost', 'max'].includes(requested) ? requested : recommendation?.tier?.toLowerCase();
    const validUpgrade = tier && ((state.plan === 'free') || (state.plan === 'boost' && tier === 'max'));
    const recommended = validUpgrade && !state.blocked ? document.querySelector(`.plan-tier-${tier}`) : null;
    if (recommended) recommended.classList.add('journey-recommended');
    const freeCta = document.getElementById('plan-free-signup'); if (freeCta) freeCta.hidden = !state.resolved || state.signedIn;
    planContext.hidden = !state.resolved || state.blocked || !state.signedIn;
    planContext.replaceChildren(); if (planContext.hidden) return;
    planContext.append(create('h2', recommended ? `A closer look at ${tier === 'max' ? 'Max' : 'Boost'}` : 'Choose what fits your training.'),
      create('p', recommendation?.description || 'Browser reviews and puzzles are included on every plan. Compare server capacity and Coach allowance below.'));
  }
  function render() {
    const state = snapshot(), route = location.pathname;
    renderSidebar(state);
    if (['/', '/index'].includes(route)) renderDashboard(home, state); else home.hidden = true;
    if (route === '/account' && state.signedIn) renderDashboard(account, state); else account.hidden = true;
    renderOffer(review, route === '/review' && !app.puzzleMode.active && !app.coachMode.active ? journeyOffer(state, 'review') : null);
    renderOffer(puzzle, route === '/puzzles' && !state.signedIn ? journeyOffer(state, 'puzzles') : null);
    renderOffer(coach, route === '/coach' ? journeyOffer(state, 'coach') : null);
    if (['/plans', '/boost'].includes(route)) renderPlans(state);
  }
  const wrap = (name, decorate) => { if (typeof app[name] === 'function') app[name] = decorate(app[name].bind(app)); };
  wrap('_showReviewSummary', original => (...args) => { const value = original(...args); if (snapshot().reviewReady && !snapshot().blocked) record('review'); return value; });
  wrap('_recordPuzzleAttempt', original => async (won, ...args) => {
    const owner = scope(), value = await original(won, ...args);
    if (won && value === true && owner === scope() && !window.PlayFairPlay?.isBlocked()) record('puzzle');
    return value;
  });
  for (const name of ['_syncAccountUi', '_renderAccountUsageBars', '_syncPuzzlePanel', '_loadGame']) wrap(name, original => (...args) => { const value = original(...args); schedule(); return value; });
  for (const event of ['app:route', 'play:auth', 'linked-auth', 'play:fairplay', 'popstate']) window.addEventListener(event, schedule);
  window.addEventListener('storage', event => { if (event.key?.startsWith('sidastuff.trainingJourney.') || event.key?.startsWith('sidastuff.journeyDismissals.')) schedule(); });
  render();
}

document.addEventListener('DOMContentLoaded', () => { if (window.app) installTrainingJourney(window.app); });
