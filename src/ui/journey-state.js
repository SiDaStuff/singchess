// Offers follow demonstrated use. Unknown account/plan state never produces
// an upgrade, and practice that is free is never presented as a paid feature.
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;

export function journeyOffer(state, context = 'home') {
  if (!state.resolved || state.blocked) return null;
  const progress = state.progress || {}, usage = state.usage || {}, limits = state.limits || {};
  if (!state.signedIn) {
    if (context === 'review' && !state.reviewReady) return null;
    if (context === 'puzzles' && !state.puzzleSolved) return null;
    if (!['home', 'account', 'review', 'puzzles'].includes(context)) return null;
    const review = context === 'review', puzzle = context === 'puzzles';
    return {
      kind: 'signup', key: `signup-${context}`, icon: puzzle ? 'extension' : 'person_add',
      eyebrow: 'Free account',
      title: review ? 'Move explanations' : puzzle ? 'Save puzzle progress' : 'Free account',
      description: review ? 'Sign up to see move explanations and sync your settings.'
        : puzzle ? 'Keep your puzzle rating when you switch devices.'
          : 'Save puzzle progress, sync settings, and get move explanations.',
      label: 'Create free account', href: `/signup?src=${context}&quick=1`,
      note: 'No card needed. Browser reviews and puzzles stay free.',
    };
  }
  if (!['free', 'boost'].includes(state.plan)) return null;
  const coachPercent = Number(usage.coachUsagePercent);
  if (state.features?.coach !== false && Number.isFinite(coachPercent) && coachPercent >= 80 && ['coach', 'home', 'account'].includes(context)) {
    const tier = state.plan === 'boost' ? 'Max' : 'Boost';
    return {
      kind: 'upgrade', key: `coach-${tier.toLowerCase()}`, icon: 'chat', eyebrow: tier,
      title: 'More Coach allowance',
      description: `${tier} includes a larger daily Coach allowance.`,
      proof: `${Math.min(100, Math.round(coachPercent))}% of your daily Coach allowance used`,
      label: `Compare ${tier}`, href: `/plans?src=coach&focus=${tier.toLowerCase()}`, tier,
      note: 'Your current allowance resets daily. Free practice remains available.',
    };
  }
  if (state.plan !== 'free' || state.features?.serverReviews === false || !['home', 'account', 'review'].includes(context)) return null;
  const knownUsage = Object.hasOwn(usage, 'serverReviews') && Number.isFinite(Number(usage.serverReviews)) && Number(usage.serverReviews) >= 0;
  const knownLimit = limits.serverReviewsPerDay !== null && positive(limits.serverReviewsPerDay);
  const nearLimit = knownUsage && knownLimit && Number(usage.serverReviews) >= Math.max(1, Number(limits.serverReviewsPerDay) - 1);
  if (!progress.review && !state.reviewReady && !nearLimit) return null;
  // A per-account unlimited server allowance already supplies this benefit.
  if (limits.serverReviewsPerDay === null) return null;
  return {
    kind: 'upgrade', key: 'server-boost', icon: 'bolt', tier: 'Boost', eyebrow: 'Boost',
    title: 'Unlimited server reviews',
    description: 'With Boost, reviews run on the server without a daily cap.',
    proof: knownUsage && knownLimit ? `${Number(usage.serverReviews)} of ${Number(limits.serverReviewsPerDay)} server reviews used in your current daily allowance` : '',
    label: 'Compare Boost', href: '/plans?src=review&focus=boost',
    note: 'Your free plan keeps unlimited browser analysis and puzzles.',
  };
}

export function journeySteps(signedIn, progress = {}, solved = 0) {
  return [
    { label: 'Create your account', done: signedIn, href: '/signup?src=home&quick=1', icon: 'person_add' },
    { label: 'Review a game', done: progress.review === true, href: '/review', icon: 'analytics' },
    { label: 'Solve a puzzle', done: progress.puzzle === true || Number(solved) > 0, href: '/puzzles', icon: 'extension' },
  ];
}

export function offerDismissed(value, now = Date.now()) {
  return Number.isFinite(value) && value > now && value <= now + 24 * 60 * 60 * 1000;
}
