// A presentation layer for verified facts. All chess calculations live in
// TacticsCoach; demonstrations never change the application's game history.
const coaches = new WeakMap();
let current = null;
const roles = { suggestion: 'Suggested move', threat: 'Opponent threat', tactic: 'Tactical relationship', defense: 'Defender or support' };
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const button = (text, className, action) => {
  const el = node('button', className || 'btn btn-secondary btn-small', text);
  el.type = 'button'; el.addEventListener('click', action); return el;
};
const heading = (parent, title) => parent.append(node('h4', 'tactical-section-title', title));
const statusOf = value => typeof value === 'string' ? value : value?.status || '';
const annotations = (fact, id, opacity) => ({ fen: fact.fen, explanationId: id,
  arrows: fact.arrows || [], highlights: fact.highlights || [], opacity });
const readableVerification = value => statusOf(value).includes('line') ? 'Verified in the line' : 'Verified on the board';

export function structuredLesson(result) {
  const app = window.app;
  if (!app?.analyzer || !window.TacticsCoach) return null;
  let coach = coaches.get(app.analyzer);
  if (!coach) { coach = new window.TacticsCoach(app.analyzer, window.Chess); coaches.set(app.analyzer, coach); }
  return coach.analyze(result);
}

function pause(state = current) {
  if (!state) return;
  clearTimeout(state.timer); state.timer = null; state.playing = false;
  if (state.play) state.play.textContent = 'Play demonstration';
  if (state.dockPlay) state.dockPlay.textContent = 'Play';
}
function resetPreviewState() {
  if (!current) return;
  pause(); current.variation = null; current.index = -1;
  if (current.demo) current.demo.hidden = true;
  if (current.dock) current.dock.hidden = true;
  document.body.classList.remove('coach-demo-active');
  current.launches?.forEach(el => el.setAttribute('aria-pressed', 'false'));
}
function legalStep(step) {
  const board = new window.Chess();
  return typeof step?.fen === 'string' && board.load(step.fen) ? board : null;
}
function updateStep(index, state = current) {
  if (!state || state !== current || !state.variation) return false;
  const steps = state.variation.steps;
  index = Math.max(0, Math.min(steps.length - 1, index));
  const step = steps[index];
  if (!legalStep(step)) { pause(); return false; }
  // Main review navigation or a new result invalidates this controller.
  if (!window.app.analyzer.matchesExplanationPosition(state.result, window.app.chess.fen())) {
    window.MoveExplanationUI?.clear(); return false;
  }
  const sequential = index === state.index + 1;
  state.index = index;
  const move = step.move;
  const reference = { kind: 'demonstration', fen: step.fen,
    text: step.text || (index ? 'Follow the continuation.' : 'Position before the move.'),
    from: move?.from, to: move?.to, animate: sequential && index > 0,
    annotations: annotations(step, `${state.model.id}/${state.variation.id}/${index}`, state.opacity) };
  if (!window.MoveExplanationUI?.showPosition(reference, state.launch)) return false;
  state.demo.hidden = false;
  state.dock.hidden = false;
  document.body.classList.add('coach-demo-active');
  state.stepText.textContent = reference.text;
  state.stepCount.textContent = `Step ${index + 1} of ${steps.length}`;
  state.prev.disabled = index === 0; state.next.disabled = index === steps.length - 1;
  state.dockPrev.disabled = state.prev.disabled; state.dockNext.disabled = state.next.disabled;
  state.dockLabel.textContent = `${state.variation.label} · Step ${index + 1}/${steps.length}${move?.san ? ` · ${move.san}` : ''}`;
  state.play.disabled = steps.length < 2;
  const focusOnTimeline = state.timeline.contains(document.activeElement);
  state.timeline.replaceChildren();
  steps.forEach((item, i) => {
    const el = button(i === 0 ? 'Position' : item.move?.san || String(i), 'coach-step-chip', () => { pause(); updateStep(i); });
    el.setAttribute('aria-label', `Go to step ${i + 1}: ${item.text || item.move?.san || 'Position'}`);
    el.setAttribute('aria-current', i === index ? 'step' : 'false');
    state.timeline.append(el);
  });
  if (focusOnTimeline) state.timeline.children[index]?.focus({ preventScroll: true });
  state.relationships.replaceChildren();
  const descriptions = [...(step.arrows || []).map(a => a.label || `${roles[a.role] || 'Relationship'}: ${a.from} to ${a.to}`),
    ...(step.highlights || []).map(h => h.label || `${roles[h.role] || 'Important square'}: ${h.square}`)];
  if (descriptions.length) {
    const summary = node('summary', '', 'What the markings show');
    const list = node('ul'); descriptions.forEach(text => list.append(node('li', '', text)));
    state.relationships.append(summary, list); state.relationships.hidden = false;
  } else state.relationships.hidden = true;
  return true;
}
function play() {
  const state = current;
  if (!state?.variation) return;
  if (state.playing) { pause(); return; }
  if (state.index >= state.variation.steps.length - 1) updateStep(0);
  state.playing = true; state.play.textContent = 'Pause demonstration';
  state.dockPlay.textContent = 'Pause';
  const tick = () => {
    if (current !== state || !state.playing) return;
    if (!updateStep(state.index + 1)) { pause(state); return; }
    if (state.index >= state.variation.steps.length - 1) { pause(state); return; }
    state.timer = setTimeout(tick, 1600);
  };
  state.timer = setTimeout(tick, 1600);
}
function launch(variation, source) {
  const state = current;
  if (!state || !variation?.steps?.length || !variation.steps.every(legalStep)) return;
  window.MoveExplanationUI?.clear();
  state.variation = variation; state.launch = source;
  state.branch.value = variation.id;
  state.demoTitle.textContent = variation.label || 'Follow the position';
  const engine = variation.source !== 'board' && variation.source !== 'played';
  state.lineNote.textContent = engine
    ? 'A legal engine continuation. A reply is labelled forced only when it is the only legal move.'
    : 'The recorded move is legal. Further replies are shown only when a verified continuation is available.';
  updateStep(0);
}
function previewFact(fact, trigger, selected = false) {
  if (!current || !legalStep(fact)) return;
  if (current.variation) {
    if (!selected) return;
    window.MoveExplanationUI?.clear();
  }
  window.MoveExplanationUI?.hoverPosition({ kind: 'fact', fen: fact.fen, text: fact.explanation || fact.text || fact.label,
    annotations: annotations(fact, fact.id || current.model.id, current.opacity) }, trigger);
}
function factCard(fact, phase = '') {
  const card = node('article', 'coach-fact');
  const trigger = button(fact.label || fact.type || 'Position insight', 'coach-insight-trigger explanation-reference', () => previewFact(fact, trigger, true));
  trigger.title = 'Preview the verified relationships on the board';
  trigger.setAttribute('aria-pressed', 'false');
  trigger.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') previewFact(fact, trigger); });
  trigger.addEventListener('focus', () => previewFact(fact, trigger));
  card.append(trigger, node('p', '', fact.explanation || fact.text));
  const phaseLabel = phase === 'reply' ? 'Opponent reply' : phase === 'alternative' ? 'Engine alternative' : 'Played move';
  card.append(node('small', 'coach-fact-evidence', `${phaseLabel} · ${readableVerification(fact.verification)}`));
  return card;
}

export function renderTacticalLesson(container, model, result) {
  if (!container) return;
  resetPreviewState(); current?.dock?.remove(); container.replaceChildren();
  if (!model || statusOf(model.verification) === 'invalid') { container.hidden = true; current = null; return; }
  container.hidden = false;
  const state = { model, result, container, opacity: 0.7, index: -1, playing: false, timer: null, launches: [] };
  current = state;
  const top = node('header', 'tactical-coach-heading');
  top.append(node('h3', '', 'Understand this position'), node('span', 'coach-verified', 'Verified chess facts'));
  container.append(top);

  const insights = node('section', 'tactical-coach-section'); heading(insights, 'Tactical & positional insights');
  const motifs = model.motifs || [];
  if (motifs.length) {
    const important = node('div', 'coach-facts');
    motifs.slice(0, 4).forEach(fact => important.append(factCard(fact, fact.phase))); insights.append(important);
    if (motifs.length > 4) {
      const more = node('details', 'coach-more-insights'); more.append(node('summary', '', `${motifs.length - 4} more verified ideas`));
      motifs.slice(4).forEach(fact => more.append(factCard(fact, fact.phase))); insights.append(more);
    }
  } else insights.append(node('p', 'coach-quiet-note', model.lesson || 'No special tactic was verified. Use the legal continuation to compare how the pieces coordinate.'));
  container.append(insights);

  const threats = node('section', 'tactical-coach-section'); heading(threats, 'What was threatened?');
  if (model.threats?.length) {
    const renderThreat = (parent, fact) => {
      if (typeof fact === 'string') parent.append(node('p', '', fact));
      else parent.append(factCard(fact, fact.phase || 'reply'));
    };
    model.threats.slice(0, 3).forEach(fact => renderThreat(threats, fact));
    if (model.threats.length > 3) {
      const more = node('details', 'coach-more-insights'); more.append(node('summary', '', `${model.threats.length - 3} more verified threats`));
      model.threats.slice(3).forEach(fact => renderThreat(more, fact)); threats.append(more);
    }
  } else threats.append(node('p', 'coach-quiet-note', 'No concrete immediate threat was verified in this position.'));
  container.append(threats);

  if (model.better) {
    const better = node('section', 'tactical-coach-section'); heading(better, 'Better move');
    const move = model.better.move;
    const san = typeof move === 'string' ? move : move?.san || model.better.moveSan || '';
    const mainIdea = model.better.motifs?.find(item => item.fen === model.better.fen);
    const fact = { ...model.better, label: san || 'Engine alternative', id: `${model.id}/better`,
      arrows: [...(typeof move === 'object' && move.from && move.to ? [{ from: move.from, to: move.to, role: 'suggestion', label: `Engine recommendation: ${san}` }] : []), ...(mainIdea?.arrows || [])],
      highlights: [...(typeof move === 'object' && move.to ? [{ square: move.to, role: 'suggestion', label: san }] : []), ...(mainIdea?.highlights || [])],
    };
    better.append(factCard(fact, 'alternative')); container.append(better);
  }
  const lesson = node('section', 'tactical-coach-section coach-takeaway'); heading(lesson, 'What should I learn?');
  lesson.append(node('p', '', model.lesson || model.explanation)); container.append(lesson);

  const variations = (model.variations || []).filter(v => v.steps?.length && v.steps.every(legalStep));
  if (variations.length) buildDemonstration(container, state, variations);
  else {
    const unavailable = node('p', 'coach-quiet-note', 'No complete legal continuation is available for a demonstration. A fresh review can supply one.');
    container.append(unavailable);
  }
  if (model.verification?.rejectedVariations?.length) {
    const details = node('details', 'coach-verification-note');
    details.append(node('summary', '', 'Why some saved continuations are unavailable'));
    const list = node('ul'); model.verification.rejectedVariations.forEach(item => list.append(node('li', '', `${item.source}: ${item.reason}`)));
    details.append(list); container.append(details);
  }
  container.addEventListener('pointerleave', event => {
    if (current === state && !state.variation && event.pointerType !== 'touch') window.MoveExplanationUI?.clear();
  });
}

function buildDemonstration(container, state, variations) {
  const section = node('section', 'tactical-coach-section coach-demonstration');
  const line = node('div', 'coach-demo-launch'); heading(line, 'Show me why');
  state.branch = node('select', 'input-select coach-variation-select');
  state.branch.setAttribute('aria-label', 'Choose a verified demonstration');
  variations.forEach(v => { const option = node('option', '', v.label); option.value = v.id; state.branch.append(option); });
  const start = button('Show me why', 'btn btn-primary btn-small', () => launch(variations.find(v => v.id === state.branch.value), start));
  start.setAttribute('aria-pressed', 'false'); state.launches.push(start);
  state.branch.addEventListener('change', () => { if (state.variation) launch(variations.find(v => v.id === state.branch.value), start); });
  line.append(state.branch, start); section.append(line);
  state.demo = node('div', 'coach-demo-player'); state.demo.hidden = true;
  const demoHead = node('div', 'coach-demo-heading'); state.demoTitle = node('strong'); state.stepCount = node('span', 'coach-step-count');
  demoHead.append(state.demoTitle, state.stepCount);
  state.lineNote = node('p', 'coach-line-note'); state.stepText = node('p', 'coach-step-explanation'); state.stepText.setAttribute('aria-live', 'polite');
  state.timeline = node('div', 'coach-demo-timeline'); state.timeline.setAttribute('aria-label', 'Demonstration steps');
  const controls = node('div', 'coach-demo-controls');
  state.prev = button('Previous step', '', () => { pause(); updateStep(state.index - 1); });
  state.next = button('Next step', '', () => { pause(); updateStep(state.index + 1); });
  state.play = button('Play demonstration', '', play);
  const restart = button('Restart', '', () => { pause(); updateStep(0); });
  const back = button('Return to reviewed move', 'btn btn-secondary btn-small coach-demo-return', () => window.MoveExplanationUI?.clear());
  controls.append(state.prev, state.play, state.next, restart, back);
  state.relationships = node('details', 'coach-marking-descriptions');
  const legend = node('ul', 'coach-annotation-legend');
  for (const [role, description] of Object.entries(roles)) {
    const item = node('li'); item.append(node('span', `coach-role-dot coach-role-${role}`), node('span', '', description)); legend.append(item);
  }
  const opacity = node('label', 'coach-opacity-label'); opacity.append(node('span', '', 'Marking opacity'));
  const slider = node('input'); slider.type = 'range'; slider.min = '0.2'; slider.max = '1'; slider.step = '0.05'; slider.value = String(state.opacity);
  slider.setAttribute('aria-label', 'Board marking opacity');
  slider.addEventListener('input', () => { state.opacity = Number(slider.value); if (state.variation) updateStep(state.index); }); opacity.append(slider);
  state.demo.append(demoHead, state.lineNote, state.stepText, state.timeline, controls, legend, opacity, state.relationships);
  section.append(state.demo); container.append(section);
  // Keep the board and compact controls together while the player reads the
  // longer explanation, particularly on mobile.
  state.dock = node('div', 'coach-board-dock'); state.dock.hidden = true;
  state.dockLabel = node('p', 'coach-dock-label'); state.dockLabel.setAttribute('aria-live', 'polite');
  const dockControls = node('div', 'coach-dock-controls');
  state.dockPrev = button('Previous', 'btn btn-secondary btn-small', () => { pause(); updateStep(state.index - 1); });
  state.dockPlay = button('Play', 'btn btn-secondary btn-small', play);
  state.dockNext = button('Next', 'btn btn-secondary btn-small', () => { pause(); updateStep(state.index + 1); });
  const dockBack = button('Return', 'btn btn-secondary btn-small', () => window.MoveExplanationUI?.clear());
  dockControls.append(state.dockPrev, state.dockPlay, state.dockNext, dockBack);
  state.dock.append(state.dockLabel, dockControls);
  document.querySelector('.main-content > .board-section')?.append(state.dock);
}

if (typeof window !== 'undefined') {
  window.TacticalCoachUI = {
    onPreviewCleared: resetPreviewState,
    isDemonstrating: () => !!current?.variation,
    getState: () => ({ lessonId: current?.model.id || null, variationId: current?.variation?.id || null,
      index: current?.index ?? -1, playing: !!current?.playing, fen: current?.variation?.steps?.[current.index]?.fen || null }),
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
}
