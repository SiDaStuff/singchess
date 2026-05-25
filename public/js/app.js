// Main Application - Chess Game Review
class ChessReviewApp {
  constructor() {
    this.board = new ChessBoard('chess-board');
    this.engine = null;
    this.analyzer = new MoveAnalyzer();
    this.chess = new Chess();
		const _savedEngineSettings = (() => { try { const r = window.localStorage?.getItem('sidastuff.engineSettings'); return r ? JSON.parse(r) : {}; } catch (_) { return {}; } })();
		this.engineSettings = {
				source: 'browser',
				module: _savedEngineSettings.module || 'lite-single',
						strength: _savedEngineSettings.strength || 'depth14',
						maxTimeMs: Number(_savedEngineSettings.maxTimeMs) || 12000,
						analysisLocation: 'server',
						serverStrongReview: false,
			};
	    this.engineSettings.module = this._recommendedEngineModule();
    this.engineInitToken = 0;
    this.liveEvalToken = 0;
    this.failedBrowserModules = new Set();

    this.gameMoves = [];
    this.gameHeaders = {};
    this.originalGameMoves = [];
    this.initialFen = this.chess.fen();
	    this.currentMoveIndex = -1;
	    this.analysisResults = null;
	    this.liveMoveResults = [];
	    this.explorerReturnState = null;
	    this.isAnalyzing = false;
	    this.autoPlaying = false;
	    this._setAnticheatChecking(false);
	    this.reviewPlaybackTimer = null;
	    this.liveEvalHistory = [];
    this.lastLiveEvalFen = '';
    this.gameStatus = null;
    this.currentEvalScore = 0;
	    this.coachMode = {
      active: false,
      humanColor: 'w',
      elo: 1200,
	      skill: 'intermediate',
	      aiAdjust: true,
	      adjustStyle: 'better',
	      adjustedElo: 1200,
	      adjustment: 0,
	      performanceEma: 0,
	      mistakeRateEma: 0,
		      thinking: false,
		      gameOverCelebrated: false,
	      lastAdviceMoveIndex: null,
	      hintLevel: 0,
	      hintFen: '',
	      hintMove: '',
	    };
	    this.puzzleMode = {
	      active: false,
	      loading: false,
	      current: null,
	      source: '',
	      initialFen: '',
	      solution: [],
	      step: 0,
	      solved: false,
	      failed: false,
	      hintLevel: 0,
	      rating: 1500,
	      streak: 0,
	      solvedCount: 0,
	      attemptedCount: 0,
	      attemptedPuzzleIds: new Set(),
	      lastDelta: 0,
	      requestToken: 0,
	    };
	    this.anticheatMode = {
	      active: false,
	      checking: false,
	      statusTimer: null,
	      results: null,
	    };
	    this.authMode = 'signin';
		    this.authState = {
		      user: null,
		      profile: null,
		      me: null,
		      plan: { plan: 'free', name: 'Free' },
		      usage: {},
		      limits: {},
		      isAdmin: false,
		      initialized: false,
		      dbReady: false,
		    };

    this.board.setChessInstance(this.chess);
    this.board.interactive = true;
    this.board.onMove = (from, to) => this._handleBoardMove(from, to);
	    this.board.onFlip = () => {
	      this._syncPlayerNameplates();
	      this._updateEvalBar(this.currentEvalScore);
	      this._refreshMoveBadgePosition();
	    };

    this.elEvalGraph = document.getElementById('eval-graph');
    this.evalGraphCtx = this.elEvalGraph.getContext('2d');

    this.soundFiles = {
      start: '/sounds/start.mp3',
      move: '/sounds/move.mp3',
      capture: '/sounds/capture.mp3',
      castle: '/sounds/castle.mp3',
      check: '/sounds/check.mp3',
      promote: '/sounds/promote.mp3',
      end: '/sounds/end.mp3',
	    };
	    this.soundPool = {};
	    this.soundPoolIndex = {};
	    this.soundPreloadPromise = null;
	    this._preloadSounds().catch(() => {});

	    this._bindElements();
		    this._initEngineControls();
		    this._applyLocalPuzzleProfile();
		    this._bindEvents();
    this._syncPlayerNameplates();
	    this._syncCoachVisibility();
	    this._syncPuzzleVisibility();
	    this._initEngine();
		    this._initAuth();
		    this._updateBoard();
		    this._updateLiveEvalPanel();
		    this._resetInsightPanel();
		    this._loadPublicStats();
			    this._initRouting();
			    window.addEventListener('resize', () => this._updateEvalBar(this.currentEvalScore), { passive: true });
		  }

	  _bindElements() {
		    this.elMainMenu = document.getElementById('main-menu');
	    this.elPublicStats = document.getElementById('public-stats');
	    this.elStatsGamesAnalyzed = document.getElementById('stats-games-analyzed');
	    this.elStatsCoachGames = document.getElementById('stats-coach-games');
	    this.elStatsPuzzlesSolved = document.getElementById('stats-puzzles-solved');
	    this.elBtnMenuImport = document.getElementById('btn-menu-import');
	    this.elBtnMenuCoach = document.getElementById('btn-menu-coach');
		    this.elBtnMenuPuzzles = document.getElementById('btn-menu-puzzles');
		    this.elBtnMenuAnticheat = document.getElementById('btn-menu-anticheat');
		    this.elBtnMenuBoost = document.getElementById('btn-menu-boost');
    this.elBoostPage = document.getElementById('boost-page');
    this.elBtnBoostPurchase = document.getElementById('btn-boost-purchase');
    this.elBtnCloseBoost = document.getElementById('btn-close-boost');
    this.elBtnBackMenu = document.getElementById('btn-back-menu');
    this.elEngineChoiceModal = document.getElementById('engine-choice-modal');
    this.elEngineChoiceClose = document.getElementById('engine-choice-close');
	    this.elEngineChoiceModule = document.getElementById('engine-choice-module');
	    this.elEngineChoiceRecommendation = document.getElementById('engine-choice-recommendation');
	    this.elBtnEngineChoiceConfirm = document.getElementById('btn-engine-choice-confirm');
		    this.elEngineLoadingOverlay = document.getElementById('engine-loading-overlay');
		    this.elEngineLoadingText = document.getElementById('engine-loading-text');
		    this.elEngineLoadingFill = document.getElementById('engine-loading-fill');
		    this.elAppLoadingOverlay = document.getElementById('app-loading-overlay');
		    this.elAppLoadingText = document.getElementById('app-loading-text');
	    this.elPromotionModal = document.getElementById('promotion-modal');
	    this.elPromotionOptions = document.getElementById('promotion-options');
    this.elBtnImport = document.getElementById('btn-import');
	    this.elBtnCoach = document.getElementById('btn-coach');
	    this.elBtnPuzzles = document.getElementById('btn-puzzles');
	    this.elBtnAnticheat = document.getElementById('btn-anticheat');
	    this.elBtnAccount = document.getElementById('btn-account');
	    this.elAccountBtnLabel = document.getElementById('account-btn-label');
    this.elBtnSettings = document.getElementById('btn-settings');
    this.elBtnReview = document.getElementById('btn-review');
    this.elReviewBtnText = document.getElementById('review-btn-text');
    this.elBtnFlip = document.getElementById('btn-flip');
    this.elBtnFirst = document.getElementById('btn-first');
    this.elBtnPrev = document.getElementById('btn-prev');
    this.elBtnNext = document.getElementById('btn-next');
    this.elBtnLast = document.getElementById('btn-last');
    this.elBtnAuto = document.getElementById('btn-auto');
    this.elBtnReset = document.getElementById('btn-reset');
    this.elBtnAutoLabel = this.elBtnAuto.querySelector('.btn-label');
    this.elMoveList = document.getElementById('move-list');
    this.elEvalBarWhite = document.getElementById('eval-bar-white');
    this.elEvalBarBlack = document.getElementById('eval-bar-black');
    this.elEvalScore = document.getElementById('eval-score');
	    this.elEngineStatus = document.getElementById('engine-status');
	    this.elEngineLine = document.getElementById('engine-line');
	    this.elLiveEval = document.getElementById('live-eval');
	    this.elLiveEvalStatus = document.getElementById('live-eval-status');
	    this.elLiveEvalScore = document.getElementById('live-eval-score');
	    this.elLiveEvalLine = document.getElementById('live-eval-line');
	    this.elLiveEvalMeta = document.getElementById('live-eval-meta');
	    this.elCurrentMoveIndicator = document.getElementById('current-move-indicator');
    this.elEngineSource = document.getElementById('engine-source');
    this.elEngineModule = document.getElementById('engine-module');
    this.elEngineStrength = document.getElementById('engine-strength');
    this.elEngineMaxTime = document.getElementById('engine-max-time');
	    this.elAnalysisLocation = document.getElementById('analysis-location');
	    this.elServerBoostToggle = document.getElementById('server-boost-toggle');
	    this.elServerStrongReview = document.getElementById('server-strong-review');
	    this.elBoostPage = document.getElementById('boost-page');
	    this.elBtnBoostAccount = document.getElementById('btn-boost-account');
    this.elEngineLoadProgress = document.getElementById('engine-load-progress');
    this.elEngineLoadProgressFill = document.getElementById('engine-load-progress-fill');
    this.elReviewSummary = document.getElementById('review-summary');
    this.elProgressBar = document.getElementById('review-progress');
    this.elProgressFill = document.getElementById('progress-fill');
    this.elMoveBadge = document.getElementById('move-badge');
    this.elBadgeIcon = document.getElementById('badge-icon');
    this.elBadgeText = document.getElementById('badge-text');
    this.elPlayerTop = document.getElementById('player-top');
    this.elPlayerBottom = document.getElementById('player-bottom');
    this.elOpeningInfo = document.getElementById('opening-info');
    this.elOpeningName = document.getElementById('opening-name');
    this.elGameStatus = document.getElementById('game-status');
    this.elGameStatusTitle = document.getElementById('game-status-title');
    this.elGameStatusReason = document.getElementById('game-status-reason');
    this.elGameStatusDetails = document.getElementById('game-status-details');

    this.elCapsWhite = document.getElementById('caps-white-val');
	    this.elCapsBlack = document.getElementById('caps-black-val');
	    this.elAcplWhite = document.getElementById('acpl-white-val');
	    this.elAcplBlack = document.getElementById('acpl-black-val');
	    this.elPhaseBreakdown = document.getElementById('phase-breakdown');
	    this.elReviewNarrative = document.getElementById('review-narrative');
	    this.elTrainingList = document.getElementById('training-list');
	    this.elOpeningDrift = document.getElementById('opening-drift');
	    this.elPatternList = document.getElementById('pattern-list');

	    this.elMoveInsights = document.getElementById('move-insights');
	    this.elInsightEmpty = document.getElementById('insight-empty');
	    this.elInsightContent = document.getElementById('insight-content');
    this.elInsightMove = document.getElementById('insight-move');
    this.elInsightClass = document.getElementById('insight-class');
    this.elInsightCpLoss = document.getElementById('insight-cploss');
	    this.elInsightSwing = document.getElementById('insight-swing');
	    this.elInsightBestMove = document.getElementById('insight-bestmove');
	    this.elInsightPhase = document.getElementById('insight-phase');
	    this.elInsightPlanTags = document.getElementById('insight-plan-tags');
	    this.elInsightThreatRow = document.getElementById('insight-threat-row');
	    this.elInsightThreat = document.getElementById('insight-threat');
	    this.elInsightEndgameRow = document.getElementById('insight-endgame-row');
	    this.elInsightEndgame = document.getElementById('insight-endgame');
	    this.elInsightCoach = document.getElementById('insight-coach');
	    this.elBtnLineExplorer = document.getElementById('btn-line-explorer');
	    this.elBtnReturnExplorer = document.getElementById('btn-return-explorer');
	    this.elInsightAlternatives = document.getElementById('insight-alternatives');

    this.elCoachCard = document.getElementById('coach-card');
    this.elCoachState = document.getElementById('coach-state');
    this.elCoachDialog = document.getElementById('coach-dialog');
    this.elCoachSkill = document.getElementById('coach-skill');
    this.elCoachElo = document.getElementById('coach-elo');
    this.elCoachColor = document.getElementById('coach-color');
    this.elBtnCoachStart = document.getElementById('btn-coach-start');
    this.elBtnCoachTakeback = document.getElementById('btn-coach-takeback');
    this.elBtnCoachHint = document.getElementById('btn-coach-hint');
    this.elCoachSetupModal = document.getElementById('coach-setup-modal');
	    this.elCoachSetupClose = document.getElementById('coach-setup-close');
	    this.elCoachSetupElo = document.getElementById('coach-setup-elo');
	    this.elCoachSetupAiAdjust = document.getElementById('coach-setup-ai-adjust');
	    this.elCoachSetupAdjustStyle = document.getElementById('coach-setup-adjust-style');
	    this.elBtnCoachSetupStart = document.getElementById('btn-coach-setup-start');

	    this.elPuzzleCard = document.getElementById('puzzle-card');
	    this.elPuzzleSource = document.getElementById('puzzle-source');
	    this.elPuzzleUserRating = document.getElementById('puzzle-user-rating');
	    this.elPuzzleTargetRating = document.getElementById('puzzle-target-rating');
	    this.elPuzzleStreak = document.getElementById('puzzle-streak');
	    this.elPuzzleScore = document.getElementById('puzzle-score');
	    this.elPuzzleStatus = document.getElementById('puzzle-status');
	    this.elPuzzleTags = document.getElementById('puzzle-tags');
	    this.elPuzzleTheme = document.getElementById('puzzle-theme');
	    this.elPuzzleDifficulty = document.getElementById('puzzle-difficulty');
	    this.elBtnPuzzleNext = document.getElementById('btn-puzzle-next');
	    this.elBtnPuzzleDaily = document.getElementById('btn-puzzle-daily');
		    this.elBtnPuzzleRetry = document.getElementById('btn-puzzle-retry');
		    this.elBtnPuzzleHint = document.getElementById('btn-puzzle-hint');
		    this.elBtnPuzzleReview = document.getElementById('btn-puzzle-review');
		    this.elBtnExportPgn = document.getElementById('btn-export-pgn');
		    this.elBtnExportFen = document.getElementById('btn-export-fen');
		    this.elAnticheatCard = document.getElementById('anticheat-card');
	    this.elAnticheatSource = document.getElementById('anticheat-source');
	    this.elAnticheatUsername = document.getElementById('anticheat-username');
	    this.elAnticheatLimit = document.getElementById('anticheat-limit');
	    this.elAnticheatPgn = document.getElementById('anticheat-pgn');
	    this.elBtnAnticheatRun = document.getElementById('btn-anticheat-run');
	    this.elAnticheatStatus = document.getElementById('anticheat-status');
	    this.elAnticheatResults = document.getElementById('anticheat-results');
	    this.elAnticheatRiskPill = document.getElementById('anticheat-risk-pill');

    this.elCriticalMoments = document.getElementById('critical-moments');
    this.elCriticalList = document.getElementById('critical-list');

    this.elPgnModal = document.getElementById('pgn-modal');
    this.elPgnInput = document.getElementById('pgn-input');
    this.elBtnPgnLoad = document.getElementById('btn-pgn-load');
    this.elModalClose = document.getElementById('modal-close');
    this.elSettingsModal = document.getElementById('settings-modal');
    this.elSettingsClose = document.getElementById('settings-close');
    this.elImportSource = document.getElementById('import-source');
    this.elImportUsername = document.getElementById('import-username');
    this.elImportLimit = document.getElementById('import-limit');
    this.elBtnImportUsername = document.getElementById('btn-import-username');
    this.elImportStatus = document.getElementById('import-status');
    this.elImportResults = document.getElementById('import-results');
	    this.elAccountModal = document.getElementById('account-modal');
	    this.elAccountClose = document.getElementById('account-close');
	    this.elAccountSignedOut = document.getElementById('account-signed-out');
	    this.elAccountSignedIn = document.getElementById('account-signed-in');
	    this.elAuthUsernameField = document.getElementById('auth-username-field');
	    this.elAuthUsername = document.getElementById('auth-username');
	    this.elAuthEmail = document.getElementById('auth-email');
	    this.elAuthPassword = document.getElementById('auth-password');
	    this.elBtnAuthSigninMode = document.getElementById('btn-auth-signin-mode');
	    this.elBtnAuthSignupMode = document.getElementById('btn-auth-signup-mode');
	    this.elBtnAuthSubmit = document.getElementById('btn-auth-submit');
	    this.elBtnGoogleAuth = document.getElementById('btn-google-auth');
	    this.elBtnAuthSignout = document.getElementById('btn-auth-signout');
	    this.elAccountStatus = document.getElementById('account-status');
	    this.elAccountDisplayName = document.getElementById('account-display-name');
	    this.elAccountEmailLabel = document.getElementById('account-email-label');
		    this.elAccountPuzzleRating = document.getElementById('account-puzzle-rating');
		    this.elAccountPuzzlesSolved = document.getElementById('account-puzzles-solved');
		    this.elAccountPuzzlesAttempted = document.getElementById('account-puzzles-attempted');
		    this.elAccountPlan = document.getElementById('account-plan');
		    this.elAccountUsage = document.getElementById('account-usage');
		    this.elAdminBoostPanel = document.getElementById('admin-boost-panel');
		    this.elGiftBoostEmail = document.getElementById('gift-boost-email');
		    this.elGiftBoostDays = document.getElementById('gift-boost-days');
		    this.elBtnGiftBoost = document.getElementById('btn-gift-boost');
		    this.elGiftBoostStatus = document.getElementById('gift-boost-status');
		    this.elMainContent = document.querySelector('main.main-content');
		    this.elLoginPage = document.getElementById('page-login');
		    this.elSignupPage = document.getElementById('page-signup');
		    this.elAccountPage = document.getElementById('page-account');
		    this.elSettingsPage = document.getElementById('page-settings');
		    this.elLoginEmail = document.getElementById('login-email');
		    this.elLoginPassword = document.getElementById('login-password');
		    this.elLoginStatus = document.getElementById('login-status');
		    this.elLoginSubmit = document.getElementById('btn-login-submit');
		    this.elLoginGoogle = document.getElementById('btn-login-google');
		    this.elSignupEmail = document.getElementById('signup-email');
		    this.elSignupPassword = document.getElementById('signup-password');
		    this.elSignupStatus = document.getElementById('signup-status');
		    this.elSignupSubmit = document.getElementById('btn-signup-submit');
		    this.elSignupGoogle = document.getElementById('btn-signup-google');
		    this.elPageToSignup = document.getElementById('btn-page-to-signup');
		    this.elPageToLogin = document.getElementById('btn-page-to-login');
		    this.elPageAccountSignin = document.getElementById('btn-page-account-signin');
		    this.elPageAccountSignout = document.getElementById('btn-page-account-signout');
		    this.elSettingsSummary = document.getElementById('settings-summary');
		    this.elPageClearCache = document.getElementById('btn-page-clear-cache');
	  }

  _initEngineControls() {
	    this.elEngineSource.value = this.engineSettings.source;
	    this.elEngineStrength.value = this.engineSettings.strength;
	    if (this.elEngineMaxTime) this.elEngineMaxTime.value = String(this.engineSettings.maxTimeMs);
	    if (this.elAnalysisLocation) this.elAnalysisLocation.value = this.engineSettings.analysisLocation;
	    if (this.elServerStrongReview) this.elServerStrongReview.checked = !!this.engineSettings.serverStrongReview;
	    this._populateEngineModules();
	  }
	
		  _getReviewProfile() {
		    const profile = { ...getReviewProfileConfig(this.engineSettings.strength) };
		    profile.timeoutMs = Math.max(1000, Number(this.engineSettings.maxTimeMs) || profile.timeoutMs);
		    return profile;
		  }

		  _showPopup(options = {}) {
			    const config = {
			      icon: options.icon || 'info',
			      title: options.title || '',
			      text: options.text || options.message || '',
			      html: options.html,
			      confirmButtonColor: '#202721',
			      confirmButtonText: options.confirmButtonText || 'OK',
			      showCancelButton: !!options.showCancelButton,
			      cancelButtonText: options.cancelButtonText || 'Cancel',
			      showDenyButton: !!options.showDenyButton,
			      denyButtonText: options.denyButtonText || 'No',
				      denyButtonColor: options.denyButtonColor || '#c8b6ff',
			      reverseButtons: options.reverseButtons ?? true,
			      allowOutsideClick: options.allowOutsideClick ?? true,
			      focusConfirm: options.focusConfirm ?? true,
			      preConfirm: options.preConfirm,
			      didOpen: options.didOpen,
			      customClass: {
			        popup: `app-popup ${options.form ? 'app-popup-form' : ''}`.trim(),
			        confirmButton: 'app-popup-confirm',
			        cancelButton: 'app-popup-cancel',
			        denyButton: 'app-popup-deny',
			      },
			    };

	    if (window.Swal?.fire) {
	      return window.Swal.fire(config);
	    }

		    const confirmed = !config.showCancelButton || window.confirm([config.title, config.text || options.message || ''].filter(Boolean).join('\n'));
		    return Promise.resolve({ isConfirmed: confirmed, isDismissed: !confirmed });
		  }

		  _initRouting() {
    const pageRoute = document.body.dataset.page ? `/${document.body.dataset.page}` : '';
    const currentPath = pageRoute || this._normalizeRoute(window.location.pathname || '/index');
    const restoreRoute = pageRoute ? null : this._restoreActiveRoute();
    const restoreDisabled = this._routeRestoreDisabled();
    if (restoreDisabled) {
      try {
        if (window.localStorage) window.localStorage.removeItem('sidastuff.disableRouteRestore');
      } catch (_err) {
        // ignore local storage failures.
      }
    }
    if (restoreRoute && !restoreDisabled && (currentPath === '/' || currentPath === '/index')) {
      this._applyRoute(restoreRoute, { replace: true });
    } else {
      this._applyRoute(currentPath, { replace: true });
    }
    window.addEventListener('popstate', () => this._applyRoute(window.location.pathname || '/index'));
  }

		  _normalizeRoute(path) {
		    let route = String(path || '/index').split('?')[0].replace(/\/+$/, '') || '/index';
		    route = route.replace(/\.html$/i, '');
		    if (route === '/signin') return '/login';
		    return route;
		  }

		  _routeUrl(path) {
		    const route = this._normalizeRoute(path);
		    const map = {
		      '/index': '/',
		      '/login': '/signin.html',
		      '/signup': '/signup.html',
		      '/account': '/account.html',
		      '/settings': '/settings.html',
		      '/auth': '/auth.html',
		      '/boost': '/boost.html',
		      '/review': '/review.html',
		      '/coach': '/coach.html',
		      '/puzzles': '/puzzles.html',
		      '/anticheat': '/anticheat.html',
		    };
		    return map[route] || `${route}.html`;
		  }
_navigateTo(path, options = {}) {
    const route = this._normalizeRoute(path || '/index');
    if (options.disableRestore) this._disableRouteRestore();
		    const target = this._routeUrl(route);
		    if (this._normalizeRoute(window.location.pathname) !== route) {
		      window.location.assign(target);
		      return;
		    }
		    this._applyRoute(route);
		  }

		  _hideRoutePages() {
		    if (this.elLoginPage) this.elLoginPage.hidden = true;
		    if (this.elSignupPage) this.elSignupPage.hidden = true;
		    if (this.elAccountPage) this.elAccountPage.hidden = true;
		    if (this.elSettingsPage) this.elSettingsPage.hidden = true;
		  }

		  _saveActiveRoute(route) {
		    try {
		      if (!window.localStorage) return;
		      if (route && route !== '/index') {
		        window.localStorage.setItem('sidastuff.activeRoute', route);
		      } else {
		        window.localStorage.removeItem('sidastuff.activeRoute');
		      }
		    } catch (_err) {
		      // ignore local storage failures.
		    }
		  }

  _disableRouteRestore() {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem('sidastuff.disableRouteRestore', '1');
    } catch (_err) {
      // ignore local storage failures.
    }
  }

  _routeRestoreDisabled() {
    try {
      return !!window.localStorage?.getItem('sidastuff.disableRouteRestore');
    } catch (_err) {
      return false;
    }
  }

  _restoreActiveRoute() {
    try {
      const stored = window.localStorage?.getItem('sidastuff.activeRoute');
      return stored ? String(stored).replace(/\/+$/, '') || '/index' : null;
    } catch (_err) {
      return null;
    }
  }

		    this._hideSettingsModal();
		    this._hideAccountModal();
		    this._hideRoutePages();
		    if (this.elMainContent) this.elMainContent.hidden = true;
		    if (page === 'login' && this.elLoginPage) {
		      this.elLoginPage.hidden = false;
		      this._setAuthMode('signin');
		    }
		    if (page === 'signup' && this.elSignupPage) {
		      this.elSignupPage.hidden = false;
		      this._setAuthMode('signup');
		    }
		    if (page === 'account' && this.elAccountPage) {
		      this.elAccountPage.hidden = false;
		      this._syncAccountPage();
		    }
		    if (page === 'settings' && this.elSettingsPage) {
		      this.elSettingsPage.hidden = false;
		      this._syncSettingsPage();
		    }
		  }

		  _syncAccountPage() {
		    const signedIn = !!this.authState.user;
		    const messageEl = document.getElementById('account-page-message');
		    if (messageEl) {
		      messageEl.textContent = signedIn
		        ? 'Manage your account and sign out.'
		        : 'Manage your account, sign in, or view your plan.';
		    }
		    if (this.elPageAccountSignin) this.elPageAccountSignin.hidden = signedIn;
		    if (this.elPageAccountSignout) this.elPageAccountSignout.hidden = !signedIn;
		  }

		  _syncSettingsPage() {
		    if (!this.elSettingsSummary) return;
		    const profile = this._localPuzzleProfile();
		    this.elSettingsSummary.textContent = [
		      `Engine source: ${this.engineSettings.source}`,
		      `Module: ${this.engineSettings.module}`,
		      `Strength: ${this.engineSettings.strength}`,
		      `Analysis location: ${this.engineSettings.analysisLocation}`,
		      `Saved puzzle profile: ${profile ? 'Yes' : 'No'}`,
		    ].join(' · ');
		  }

		  _clearLocalCache() {
		    try {
		      if (!window.localStorage) throw new Error('Local storage unavailable.');
		      const keys = [];
		      for (let i = 0; i < window.localStorage.length; i += 1) {
		        const key = window.localStorage.key(i);
		        if (typeof key === 'string' && key.startsWith('sidastuff.')) keys.push(key);
		      }
		      keys.forEach((key) => window.localStorage.removeItem(key));
		      this._syncSettingsPage();
		      this._showPopup({ icon: 'success', title: 'Cache cleared', text: 'Local settings and puzzle cache were cleared.' });
		    } catch (err) {
		      this._showPopup({ icon: 'error', title: 'Clear failed', text: err.message || 'Unable to clear local cache.' });
		    }
		  }

		  async _handlePageEmailAuth(mode) {
		    const isSignup = mode === 'signup';
		    this._setAuthMode(isSignup ? 'signup' : 'signin');
		    const statusEl = isSignup ? this.elSignupStatus : this.elLoginStatus;
		    try {
		      await this._handleEmailAuth({
		        email: isSignup ? this.elSignupEmail?.value : this.elLoginEmail?.value,
		        password: isSignup ? this.elSignupPassword?.value : this.elLoginPassword?.value,
		        statusEl,
		      });
		      this._navigateTo('/account');
		    } catch (_err) {
		      // _handleEmailAuth has already rendered the form-level error.
		    }
		  }

		  _applyRoute(path, options = {}) {
		    const route = this._normalizeRoute(path || '/index');
		    if (options.replace && window.location.pathname !== route) {
		      window.history.replaceState({}, '', route);
		    }
		    this._saveActiveRoute(route);
		    this._hideRoutePages();

		    if (route === '/login') {
		      this._showRoutePage('login');
		      document.title = 'Sign In | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/signup') {
		      this._showRoutePage('signup');
		      document.title = 'Sign Up | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/account') {
		      this._showRoutePage('account');
		      document.title = 'Account | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/settings') {
		      this._showRoutePage('settings');
		      document.title = 'Settings | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/puzzles') {
		      this._hideSettingsModal();
		      this._hideAccountModal();
		      this._enterPuzzleMode();
		      document.title = 'Puzzles | SiDaStuff Chess';
		      return;
		    }

			    if (route === '/anticheat') {
		      this._hideSettingsModal();
		      this._hideAccountModal();
		      this._enterAnticheatMode();
		      document.title = 'Anticheat | SiDaStuff Chess';
		      return;
		    }

			    if (route === '/coach') {
			      this._hideSettingsModal();
				      this._hideAccountModal();
				      const savedCoach = this._loadSavedGameState('coach');
				      if (savedCoach) {
				        this._promptSavedGameRestore('coach', savedCoach);
				      } else {
				        this._showEngineChoiceModal('coach');
				      }
		      document.title = 'Coach | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/review') {
		      this._hideSettingsModal();
			      this._hideAccountModal();
				      const savedReview = this._loadSavedGameState('review');
				      if (savedReview) {
				        this._promptSavedGameRestore('review', savedReview);
				      } else {
			        this._showEngineChoiceModal('import');
			      }
		      document.title = 'Review | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/boost') {
		      this._hideSettingsModal();
		      this._hideAccountModal();
		      this._enterBoostPage();
		      document.title = 'Boost | SiDaStuff Chess';
		      return;
		    }

		    this._hideSettingsModal();
		    this._hideAccountModal();
		    this._showMainMenu();
		    document.title = 'SiDaStuff Chess';
		  }

	  _setButtonLabel(button, label) {
	    const target = button?.querySelector('.btn-label');
	    if (target) {
	      target.textContent = label;
	      return;
	    }
	    if (button) button.textContent = label;
	  }

	  _formatPublicStat(value) {
	    const number = Math.max(0, Number(value) || 0);
	    if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
	    if (number >= 10000) return `${Math.round(number / 1000)}k`;
	    return number.toLocaleString();
	  }

		  _renderPublicStats(stats = {}) {
		    this.elPublicStats?.classList.remove('stats-loading');
		    if (this.elStatsGamesAnalyzed) this.elStatsGamesAnalyzed.textContent = this._formatPublicStat(stats.movesAnalyzed ?? stats.gamesAnalyzed);
		    if (this.elStatsCoachGames) this.elStatsCoachGames.textContent = this._formatPublicStat(stats.coachGamesPlayed);
		    if (this.elStatsPuzzlesSolved) this.elStatsPuzzlesSolved.textContent = this._formatPublicStat(stats.puzzlesSolved ?? stats.brilliantMoves);
		  }

		  async _loadPublicStats() {
		    this.elPublicStats?.classList.add('stats-loading');
	    try {
		const response = await fetch('/api/public-stats', { cache: 'no-store' });
	      if (!response.ok) throw new Error(`Stats responded with ${response.status}`);
	      const data = await response.json();
	      this._renderPublicStats(data.stats || {});
		    } catch (_err) {
		      this._renderPublicStats({ movesAnalyzed: 0, coachGamesPlayed: 0, puzzlesSolved: 0 });
			    }
			  }

		  async _recordPublicStatEvent(event, extra = {}) {
		    try {
			const response = await fetch('/api/public-stats', {
		        method: 'POST',
		        headers: { 'Content-Type': 'application/json' },
		        cache: 'no-store',
		        body: JSON.stringify({ event, ...extra }),
		      });
		      if (!response.ok) return;
		      const data = await response.json();
		      this._renderPublicStats(data.stats || {});
		    } catch (_err) {
		      // Public stats never block chess.
		    }
		  }

	  _brilliantMoveKeys(results = this.analysisResults) {
	    if (!Array.isArray(results)) return [];
	    return results
	      .filter((entry) => entry?.classificationKey === 'BRILLIANT' && entry.fen && entry.moveUci)
	      .map((entry) => this._brilliantMoveKey(entry));
	  }

	  _brilliantMoveKey(entry) {
	    if (!entry?.fen || !entry?.moveUci) return '';
	    return `${String(entry.fen).split(/\s+/).slice(0, 4).join(' ')}|${entry.moveUci}`;
	  }

	  _recordBrilliantMove(result) {
	    // Public stat slot now tracks puzzles solved instead of brilliant moves.
	  }

	  _firebaseConfig() {
	    return {
	      apiKey: 'AIzaSyAVG8Awwd2FmVIvhzHTrZ19nhoUowZ1H3M',
	      authDomain: 'singchess-sd.firebaseapp.com',
	      databaseURL: 'https://singchess-sd-default-rtdb.firebaseio.com',
	      projectId: 'singchess-sd',
	      storageBucket: 'singchess-sd.firebasestorage.app',
	      messagingSenderId: '784279280538',
	      appId: '1:784279280538:web:88a78b114e8f997b0fb823',
	      measurementId: 'G-TFW7HFWKYP',
	    };
	  }

	  _ensureFirebase() {
	    if (!window.firebase?.initializeApp) return null;
	    if (!window.firebase.apps?.length) {
	      window.firebase.initializeApp(this._firebaseConfig());
	    }
	    return window.firebase;
	  }

		  _initAuth() {
		    const firebase = this._ensureFirebase();
		    if (!firebase?.auth) {
	      this._setAccountStatus('Firebase auth did not load. Account features are unavailable.', 'error');
	      this._syncAccountUi();
	      return;
	    }

		    this.authState.dbReady = !!firebase.database;
		    this._showAppLoadingOverlay('Loading profile...');
		    const authInitFallback = setTimeout(() => {
		      if (!this.authState.initialized) this._hideAppLoadingOverlay();
		    }, 12000);
		    firebase.auth().onAuthStateChanged(async (user) => {
		      clearTimeout(authInitFallback);
		      this.authState.user = user || null;
		      this.authState.initialized = false;
			      if (user) {
			        this.authState.profile = await this._loadUserProfile(user);
			        this._applyProfileToPuzzleMode(this.authState.profile);
			      } else {
			        this.authState.profile = null;
			        this._applyLocalPuzzleProfile();
			      }
		      this.authState.initialized = true;
			      this._syncAccountUi();
			      this._syncPuzzlePanel();
			      this._refreshPuzzleForCurrentUser();
		      this._hideAppLoadingOverlay();
		    });
		  }

		  _friendlyAuthError(err) {
		    const code = String(err?.code || '');
		    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) {
		      return 'Email or password is incorrect.';
		    }
		    if (code === 'auth/email-already-in-use') return 'An account already exists for that email.';
		    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
		    return err?.message || 'Authentication failed.';
		  }

			  async _loadUserProfile(user) {
		    const fallback = {
		      uid: user.uid,
		      username: user.displayName || (user.email ? user.email.split('@')[0] : 'Player'),
		      email: user.email || '',
		      puzzleRating: 1500,
		      puzzleStats: { solved: 0, attempted: 0, streak: 0 },
		    };
	
			    let timeout = null;
			    try {
		      const controller = new AbortController();
		      timeout = setTimeout(() => controller.abort(), 10000);
			      const response = await fetch('/api/users/me', {
			        headers: await this._authHeaders(),
			        cache: 'no-store',
			        signal: controller.signal,
			      });
		      clearTimeout(timeout);
			      if (!response.ok) throw new Error(`Account API responded with ${response.status}`);
		      const me = await response.json();
		      this.authState.me = me;
		      this.authState.plan = me.plan || { plan: 'free', name: 'Free' };
		      this.authState.usage = me.usage || {};
		      this.authState.limits = me.limits || {};
		      this.authState.isAdmin = !!me.isAdmin;
		      const profile = me.profile || {};
		      const hasServerProfile = Object.keys(profile).length > 0;
		      const localProfile = hasServerProfile ? null : this._localPuzzleProfile();
		      const profileFallback = localProfile
		        ? {
	            ...fallback,
	            puzzleRating: localProfile.rating,
	            puzzleStats: {
	              solved: localProfile.solved,
	              attempted: localProfile.attempted,
	              streak: localProfile.streak,
	            },
	          }
	        : fallback;
	      const merged = {
	        ...profileFallback,
	        ...profile,
	        puzzleStats: {
	          ...profileFallback.puzzleStats,
	          ...(profile.puzzleStats || {}),
	        },
	      };
	      if (!profile.uid) await this._saveUserProfile(merged);
	      return merged;
			    } catch (_err) {
			      if (timeout) clearTimeout(timeout);
		      this.authState.me = null;
		      this.authState.plan = { plan: 'free', name: 'Free' };
		      this.authState.usage = {};
		      this.authState.limits = {};
		      this.authState.isAdmin = false;
		      return fallback;
		    }
		  }

		  async _refreshMe() {
		    const user = this.authState.user;
		    if (!user) return null;
		    const response = await fetch('/api/users/me', {
		      headers: await this._authHeaders(),
		      cache: 'no-store',
		    });
		    if (!response.ok) throw new Error(`Account API responded with ${response.status}`);
		    const me = await response.json();
		    this.authState.me = me;
		    this.authState.profile = me.profile || this.authState.profile;
		    this.authState.plan = me.plan || { plan: 'free', name: 'Free' };
		    this.authState.usage = me.usage || {};
		    this.authState.limits = me.limits || {};
		    this.authState.isAdmin = !!me.isAdmin;
		    this._applyProfileToPuzzleMode(this.authState.profile);
		    this._syncAccountUi();
		    this._syncPuzzlePanel();
		    return me;
		  }

		  async _authHeaders(extra = {}) {
		    const token = await this.authState.user?.getIdToken?.();
		    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
		  }

		  _normalizePlayerName(value) {
		    return String(value || '').trim().toLowerCase();
		  }

		  _sideForUsername(headers, username) {
		    const target = this._normalizePlayerName(username);
		    if (!target) return null;
		    if (this._normalizePlayerName(headers.White) === target) return 'white';
		    if (this._normalizePlayerName(headers.Black) === target) return 'black';
		    return null;
		  }

		  _isOutOfUsage(kind) {
		    if (this.authState.plan?.plan === 'boost') return false;
		    const usage = this.authState.usage || {};
		    const limits = this.authState.limits || {};
		    if (kind === 'anticheat') {
		      return Math.max(0, Number(usage.anticheat) || 0) >= Math.max(1, Number(limits.anticheatRunsPerDay) || 1);
		    }
		    return Math.max(0, Number(usage.serverReviews) || 0) >= Math.max(1, Number(limits.serverReviewsPerDay) || 3);
		  }

		  async _refreshUsageBeforeAction() {
		    if (!this.authState.user) return;
		    try {
		      await this._refreshMe();
		    } catch (_err) {
		      // Continue with the last known usage; the server still enforces the limit.
		    }
		  }

		  async _showUsageLimitPopup(kind) {
		    const isReview = kind === 'serverReviews';
		    const title = isReview ? 'You are out of server reviews!' : 'You are out of server anticheat runs!';
		    const text = isReview
		      ? 'Review in the browser, or buy Boost for unlimited server reviews.'
		      : 'Anticheat only runs on the server. Buy Boost for unlimited runs, or wait for the daily reset.';
		    const result = await this._showPopup({
		      icon: 'warning',
		      title,
		      text,
		      confirmButtonText: isReview ? 'Review in browser' : 'OK',
		      denyButtonText: 'Buy Boost',
		      showDenyButton: true,
		      showCancelButton: true,
		      cancelButtonText: 'Cancel',
		    });
		    if (result.isDenied) {
		      this._navigateTo('/boost');
		      return 'boost';
		    }
		    return isReview && result.isConfirmed ? 'browser' : 'cancel';
		  }

	  async _saveUserProfile(profile = this.authState.profile) {
	    const user = this.authState.user;
	    if (!user || !profile) return;
		      this.authState.profile = {
		      ...profile,
	      uid: user.uid,
	      email: user.email || profile.email || '',
	      updatedAt: Date.now(),
	    };
	    try {
	      const firebase = this._ensureFirebase();
	      if (!firebase?.database) return;
		      await firebase.database().ref(`users/${user.uid}/profile`).set(this.authState.profile);
		      this._refreshMe().catch(() => {});
	    } catch (_err) {
	      // Auth remains useful even if the database rules reject profile writes.
	    }
	  }

		  _applyProfileToPuzzleMode(profile) {
		    if (!profile) return;
		    const stats = profile.puzzleStats || {};
			    this.puzzleMode.rating = Math.max(100, Math.round(Number(profile.puzzleRating) || 1500));
			    this.puzzleMode.solvedCount = Math.max(0, Number(stats.solved) || 0);
			    this.puzzleMode.attemptedCount = Math.max(0, Number(stats.attempted) || 0);
			    this.puzzleMode.streak = Math.max(0, Number(stats.streak) || 0);
			  }

		  _localPuzzleProfile() {
	    try {
	      const raw = window.localStorage?.getItem('sidastuff.puzzleProfile');
	      const parsed = raw ? JSON.parse(raw) : null;
	      if (!parsed || typeof parsed !== 'object') return null;
	      return {
	        rating: Math.max(100, Math.round(Number(parsed.rating) || 1500)),
	        solved: Math.max(0, Number(parsed.solved) || 0),
	        attempted: Math.max(0, Number(parsed.attempted) || 0),
	        streak: Math.max(0, Number(parsed.streak) || 0),
	      };
	    } catch (_err) {
	      return null;
	    }
	  }

	  _applyLocalPuzzleProfile() {
	    const profile = this._localPuzzleProfile();
	    if (!profile || this.authState?.user) return;
	    this.puzzleMode.rating = profile.rating;
		    this.puzzleMode.solvedCount = profile.solved;
		    this.puzzleMode.attemptedCount = profile.attempted;
		    this.puzzleMode.streak = profile.streak;
		  }

		  _saveLocalPuzzleProfile() {
		    if (this.authState?.user) return;
		    try {
	      window.localStorage?.setItem('sidastuff.puzzleProfile', JSON.stringify({
	        rating: Math.max(100, Math.round(Number(this.puzzleMode.rating) || 1500)),
	        solved: Math.max(0, Number(this.puzzleMode.solvedCount) || 0),
	        attempted: Math.max(0, Number(this.puzzleMode.attemptedCount) || 0),
	        streak: Math.max(0, Number(this.puzzleMode.streak) || 0),
	        updatedAt: Date.now(),
	      }));
	    } catch (_err) {
	      // Signed-out puzzle progress is best-effort local state.
	    }
	  }

			  _rememberLocalPuzzleAttempt(_puzzleId) {}

	  _syncAccountUi() {
	    const user = this.authState.user;
	    const profile = this.authState.profile || {};
	    const signedIn = !!user;
		    if (this.elAccountSignedOut) this.elAccountSignedOut.hidden = signedIn;
		    if (this.elAccountSignedIn) this.elAccountSignedIn.hidden = !signedIn;
		    if (this.elAccountBtnLabel) {
		      this.elAccountBtnLabel.textContent = signedIn ? (profile.username || user.displayName || 'Account') : 'Account';
		    }
		    if (!signedIn && this.elAdminBoostPanel) this.elAdminBoostPanel.hidden = true;
		    if (!signedIn) {
		      this._syncServerStrongToggle();
		      return;
		    }
	
		    const stats = profile.puzzleStats || {};
		    const plan = this.authState.plan || { name: 'Free', plan: 'free' };
		    const usage = this.authState.usage || {};
		    const limits = this.authState.limits || {};
		    if (this.elAccountDisplayName) this.elAccountDisplayName.textContent = profile.username || user.displayName || 'Player';
		    if (this.elAccountEmailLabel) this.elAccountEmailLabel.textContent = user.email || profile.email || '';
		    if (this.elAccountPuzzleRating) this.elAccountPuzzleRating.textContent = Math.round(Number(profile.puzzleRating) || this.puzzleMode.rating || 1500);
		    if (this.elAccountPuzzlesSolved) this.elAccountPuzzlesSolved.textContent = Math.max(0, Number(stats.solved) || 0);
		    if (this.elAccountPuzzlesAttempted) this.elAccountPuzzlesAttempted.textContent = Math.max(0, Number(stats.attempted) || 0);
		    if (this.elAccountPlan) {
		      const expires = plan.expiresAt ? ` until ${new Date(plan.expiresAt).toLocaleDateString()}` : '';
		      this.elAccountPlan.textContent = `${plan.name || 'Free'}${expires}`;
		      this.elAccountPlan.classList.toggle('boost-plan', plan.plan === 'boost');
		    }
		    if (this.elAccountUsage) {
		      if (plan.plan === 'boost') {
		        this.elAccountUsage.textContent = 'Boost includes unlimited server reviews and anticheat runs.';
		      } else {
		        const anticheat = Math.max(0, Number(usage.anticheat) || 0);
		        const reviews = Math.max(0, Number(usage.serverReviews) || 0);
		        this.elAccountUsage.textContent = `Today: ${anticheat}/${limits.anticheatRunsPerDay || 1} anticheat, ${reviews}/${limits.serverReviewsPerDay || 3} server reviews. Extra reviews run in the browser until reset.`;
		      }
			    }
			    if (this.elAdminBoostPanel) this.elAdminBoostPanel.hidden = !this.authState.isAdmin;
			    this._syncServerStrongToggle();
			    if (this.elAccountPage && !this.elAccountPage.hidden) this._syncAccountPage();
			  }

	  _setAuthMode(mode) {
	    this.authMode = mode === 'signup' ? 'signup' : 'signin';
	    this.elBtnAuthSigninMode?.classList.toggle('active', this.authMode === 'signin');
	    this.elBtnAuthSignupMode?.classList.toggle('active', this.authMode === 'signup');
	    if (this.elAuthUsernameField) this.elAuthUsernameField.style.display = this.authMode === 'signup' ? 'flex' : 'none';
	    this._setButtonLabel(this.elBtnAuthSubmit, this.authMode === 'signup' ? 'Sign Up' : 'Sign In');
	    this._setAccountStatus('');
	  }

		  _accountSwalHtml() {
		    this._syncAccountUi();
		    const user = this.authState.user;
		    if (!user) {
        return `
          <div class="swal-form-grid">
            <div class="account-mode-switch" role="group">
              <button type="button" class="account-mode ${this.authMode === 'signin' ? 'active' : ''}" data-auth-mode="signin">Sign In</button>
              <button type="button" class="account-mode ${this.authMode === 'signup' ? 'active' : ''}" data-auth-mode="signup">Sign Up</button>
            </div>
            <label class="field">
              <span class="field-label">Email</span>
              <input id="swal-auth-email" class="input-select" type="email" autocomplete="email" placeholder="you@example.com">
            </label>
            <label class="field">
              <span class="field-label">Password</span>
              <input id="swal-auth-password" class="input-select" type="password" autocomplete="current-password" placeholder="At least 6 characters">
            </label>
            <p class="account-status" id="swal-account-status"></p>
          </div>`;		    }

		    const profile = this.authState.profile || {};
		    const plan = this.authState.plan || { name: 'Free', plan: 'free' };
		    const usage = this.authState.usage || {};
		    const limits = this.authState.limits || {};
		    const expires = plan.expiresAt ? ` until ${new Date(plan.expiresAt).toLocaleDateString()}` : '';
		    const usageText = plan.plan === 'boost'
		      ? 'Boost includes unlimited server reviews and anticheat runs.'
		      : `Today: ${Math.max(0, Number(usage.anticheat) || 0)}/${limits.anticheatRunsPerDay || 1} anticheat, ${Math.max(0, Number(usage.serverReviews) || 0)}/${limits.serverReviewsPerDay || 3} server reviews.`;
		    const adminHtml = this.authState.isAdmin ? `
	          <div class="admin-boost-panel">
	            <h3>Gift Boost</h3>
	            <label class="field">
	              <span class="field-label">Email</span>
	              <input id="swal-gift-boost-email" class="input-select" type="email" placeholder="player@example.com">
	            </label>
	            <label class="field">
	              <span class="field-label">Days</span>
	              <input id="swal-gift-boost-days" class="input-select" type="number" min="1" max="366" value="30">
	            </label>
	            <p class="account-status" id="swal-gift-boost-status"></p>
	            <button type="button" class="btn btn-primary" id="swal-gift-boost-btn">Gift Boost</button>
	          </div>` : '';
		    return `
	      <div class="account-profile">
	        <span class="account-avatar material-symbols-outlined" aria-hidden="true">person</span>
	        <div>
	          <strong>${this._escapeHtml(profile.username || user.displayName || 'Player')}</strong>
	          <span>${this._escapeHtml(user.email || profile.email || '')}</span>
	        </div>
	      </div>
	      <div class="account-stats-grid">
	        <div><span>Plan</span><strong>${this._escapeHtml(`${plan.name || 'Free'}${expires}`)}</strong></div>
	        <div><span>Puzzle rating</span><strong>${Math.round(Number(profile.puzzleRating) || this.puzzleMode.rating || 1500)}</strong></div>
	        <div><span>Solved</span><strong>${Math.max(0, Number(profile.puzzleStats?.solved) || 0)}</strong></div>
	        <div><span>Attempted</span><strong>${Math.max(0, Number(profile.puzzleStats?.attempted) || 0)}</strong></div>
	      </div>
	      <p class="account-usage">${this._escapeHtml(usageText)}</p>
	      ${adminHtml}`;
		  }

		  async _showAccountModal() {
		    const signedIn = !!this.authState.user;
		    const result = await this._showPopup({
		      form: true,
		      title: 'Account',
		      html: this._accountSwalHtml(),
		      showCancelButton: true,
		      cancelButtonText: signedIn ? 'Close' : 'Cancel',
		      confirmButtonText: signedIn ? 'Sign Out' : (this.authMode === 'signup' ? 'Sign Up' : 'Sign In'),
		      showDenyButton: !signedIn,
		      denyButtonText: 'Google',
		      didOpen: () => {
		        const root = window.Swal?.getHtmlContainer?.();
		        if (!root) return;
		        root.querySelector('#swal-gift-boost-btn')?.addEventListener('click', () => {
		          this._giftBoostFromSwal(root);
		        });
		        root.querySelectorAll('[data-auth-mode]').forEach((button) => {
		          button.addEventListener('click', () => {
		            this._setAuthMode(button.dataset.authMode);
		            const usernameField = root.querySelector('#swal-auth-username-field');
		            if (usernameField) usernameField.hidden = this.authMode !== 'signup';
		            root.querySelectorAll('[data-auth-mode]').forEach((entry) => {
		              entry.classList.toggle('active', entry.dataset.authMode === this.authMode);
		            });
		          });
		        });
		      },
		      preConfirm: async () => {
		        if (this.authState.user) {
		          return true;
		        }
		        const root = window.Swal.getHtmlContainer();
		        const email = (root.querySelector('#swal-auth-email')?.value || '').trim();
		        const password = root.querySelector('#swal-auth-password')?.value || '';
		        const statusEl = root.querySelector('#swal-account-status');
		        if (!email || !password) {
		          if (statusEl) {
		            statusEl.textContent = 'Fill in the required account fields.';
		            statusEl.className = 'account-status error';
		          }
		          return false;
		        }
		        try {
		          await this._handleEmailAuth({ email, password, statusEl });
		          return true;
		        } catch (err) {
		          if (statusEl) {
		            statusEl.textContent = err.message || 'Authentication failed.';
		            statusEl.className = 'account-status error';
		          }
		          return false;
		        }
		      },
		    });
		    if (signedIn && result.isConfirmed) {
		      await this._handleSignOut();
		    } else if (!signedIn && result.isDenied) {
		      await this._handleGoogleAuth();
		    }
		  }

		  _hideAccountModal() {
		    if (window.Swal?.isVisible?.()) window.Swal.close();
		  }

		  async _giftBoostFromSwal(root) {
		    const email = (root.querySelector('#swal-gift-boost-email')?.value || '').trim();
		    const days = Math.max(1, Math.min(parseInt(root.querySelector('#swal-gift-boost-days')?.value || '30', 10) || 30, 366));
		    const statusEl = root.querySelector('#swal-gift-boost-status');
		    if (!email) {
		      if (statusEl) statusEl.textContent = 'Enter an email to gift Boost.';
		      return;
		    }
		    try {
		      const response = await fetch('/api/admin/gift-boost', {
		        method: 'POST',
		        headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
		        body: JSON.stringify({ email, days }),
		      });
		      const data = await response.json().catch(() => ({}));
		      if (!response.ok) throw new Error(data.error || 'Gift failed.');
		      if (statusEl) {
		        statusEl.textContent = `Boost gifted to ${email} for ${days} days.`;
		        statusEl.className = 'account-status success';
		      }
		    } catch (err) {
		      if (statusEl) {
		        statusEl.textContent = err.message || 'Gift failed.';
		        statusEl.className = 'account-status error';
		      }
		    }
		  }

	  _setAccountStatus(message, kind = '') {
	    if (!this.elAccountStatus) return;
	    this.elAccountStatus.textContent = message || '';
	    this.elAccountStatus.className = `account-status ${kind}`.trim();
	  }

	  async _handleEmailAuth(fields = null) {
	    const firebase = this._ensureFirebase();
	    if (!firebase?.auth) {
	      const message = 'Firebase auth is unavailable.';
	      if (fields?.statusEl) {
	        fields.statusEl.textContent = message;
	        fields.statusEl.className = 'account-status error';
	      } else {
	        this._setAccountStatus(message, 'error');
	      }
	      throw new Error(message);
	    }
	    const email = (fields?.email || this.elAuthEmail?.value || '').trim();
	    const password = fields?.password || this.elAuthPassword?.value || '';
	    const username = (fields?.username || this.elAuthUsername?.value || '').trim();
	    if (!email || !password) {
	      const message = 'Fill in the required account fields.';
	      if (fields?.statusEl) {
	        fields.statusEl.textContent = message;
	        fields.statusEl.className = 'account-status error';
	      } else {
	        this._setAccountStatus(message, 'error');
	      }
	      throw new Error(message);
	    }

		    this._showAppLoadingOverlay(this.authMode === 'signup' ? 'Creating account...' : 'Signing in...');
		    if (fields?.statusEl) {
		      fields.statusEl.textContent = 'Working...';
	      fields.statusEl.className = 'account-status';
	    } else {
	      this._setAccountStatus('Working...');
	    }
	    try {
	      let credential;
	      if (this.authMode === 'signup') {
	        credential = await firebase.auth().createUserWithEmailAndPassword(email, password);
	        this.authState.user = credential.user;
	        const displayName = username || (email.split('@')[0] || 'Player');
	        await credential.user.updateProfile({ displayName });
	        await this._saveUserProfile({
	          uid: credential.user.uid,
	          username: displayName,
	          email,
	          puzzleRating: this.puzzleMode.rating || 1500,
	          puzzleStats: {
	            solved: this.puzzleMode.solvedCount || 0,
	            attempted: this.puzzleMode.attemptedCount || 0,
	            streak: this.puzzleMode.streak || 0,
	          },
	        });
	      } else {
	        credential = await firebase.auth().signInWithEmailAndPassword(email, password);
	      }
	      if (fields?.statusEl) {
	        fields.statusEl.textContent = 'Signed in.';
	        fields.statusEl.className = 'account-status success';
	      } else {
	        this._setAccountStatus('Signed in.', 'success');
	      }
	      setTimeout(() => this._hideAccountModal(), 450);
	    } catch (err) {
		      const message = this._friendlyAuthError(err);
		      if (fields?.statusEl) {
		        fields.statusEl.textContent = message;
		        fields.statusEl.className = 'account-status error';
		      } else {
		        this._setAccountStatus(message, 'error');
		      }
		      throw err;
		    } finally {
		      this._hideAppLoadingOverlay();
		    }
		  }

	  async _handleGoogleAuth() {
	    const firebase = this._ensureFirebase();
	    if (!firebase?.auth?.GoogleAuthProvider) {
	      this._setAccountStatus('Google auth is unavailable.', 'error');
	      return;
	    }
	    this._setAccountStatus('Opening Google sign-in...');
	    try {
	      const provider = new firebase.auth.GoogleAuthProvider();
	      const credential = await firebase.auth().signInWithPopup(provider);
	      const user = credential.user;
	      this.authState.user = user;
	      const existing = await this._loadUserProfile(user);
	      
	      // If this is a new user (no existing profile), ask for username
	      let username = existing.username;
	      if (!existing.username || existing.username === user.displayName || existing.username === (user.email ? user.email.split('@')[0] : 'Player')) {
	        // First time signing up with Google, prompt for username
	        const result = await this._showPopup({
	          title: 'Choose Your Username',
	          text: 'Please enter a username for your chess profile',
	          input: 'text',
	          inputValue: user.displayName || (user.email ? user.email.split('@')[0] : ''),
	          inputPlaceholder: 'Your chess username',
	          inputValidator: (value) => {
	            if (!value || value.trim().length < 2) {
	              return 'Username must be at least 2 characters';
	            }
	            return undefined;
	          },
	          showCancelButton: false,
	          confirmButtonText: 'Create Account',
	        });
	        if (result.isConfirmed && result.value) {
	          username = result.value.trim();
	        } else {
	          throw new Error('Username selection cancelled');
	        }
	      }
	      
	      await this._saveUserProfile({
	        ...existing,
	        uid: user.uid,
	        username: username,
	        email: user.email || existing.email || '',
	        puzzleRating: existing.puzzleRating || this.puzzleMode.rating || 1500,
	      });
	      this._setAccountStatus('Signed in with Google.', 'success');
	      setTimeout(() => this._hideAccountModal(), 450);
	    } catch (err) {
	      this._setAccountStatus(err.message || 'Google sign-in failed.', 'error');
	    }
	  }

		  async _handleSignOut() {
		    const firebase = this._ensureFirebase();
		    if (!firebase?.auth) return;
		    await firebase.auth().signOut();
		    this._setAccountStatus('');
		    this._syncAccountUi();
		  }

		  async _giftBoost() {
		    if (!this.authState.isAdmin) return;
		    const email = (this.elGiftBoostEmail?.value || '').trim();
		    const days = Math.max(1, Math.min(parseInt(this.elGiftBoostDays?.value || '30', 10) || 30, 366));
		    if (!email) {
		      if (this.elGiftBoostStatus) this.elGiftBoostStatus.textContent = 'Enter an email first.';
		      return;
		    }
		    if (this.elGiftBoostStatus) this.elGiftBoostStatus.textContent = 'Gifting Boost...';
		    try {
		      const response = await fetch('/api/admin/gift-boost', {
		        method: 'POST',
		        headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
		        cache: 'no-store',
		        body: JSON.stringify({ email, days }),
		      });
		      const data = await response.json().catch(() => null);
		      if (!response.ok) throw new Error(data?.error || `Gift failed with ${response.status}`);
		      if (this.elGiftBoostStatus) this.elGiftBoostStatus.textContent = `Boost gifted to ${data.email} until ${new Date(data.expiresAt).toLocaleDateString()}.`;
		    } catch (err) {
		      if (this.elGiftBoostStatus) this.elGiftBoostStatus.textContent = err.message || 'Could not gift Boost.';
		    }
		  }

	  _syncPuzzleVisibility() {
	    if (this.elPuzzleCard) this.elPuzzleCard.hidden = !this.puzzleMode.active;
	  }

		  _syncAnticheatVisibility() {
		    if (this.elAnticheatCard) this.elAnticheatCard.hidden = !this.anticheatMode.active;
		  }

		  _syncBoostPageVisibility() {
		    if (this.elBoostPage) this.elBoostPage.hidden = document.body.dataset.mode !== 'boost';
		  }

		  _syncServerStrongToggle() {
    const isBoost = this.authState.plan?.plan === 'boost';
    const showInReview = this.engineSettings.analysisLocation === 'server' && document.body.dataset.mode === 'review';
	    if (this.elServerBoostToggle) {
	      this.elServerBoostToggle.classList.toggle('boost-locked', !isBoost);
	      this.elServerBoostToggle.style.display = showInReview ? '' : 'none';
	      this.elServerBoostToggle.title = isBoost ? '' : 'Boost unlocks stronger server review.';
	    }
    const lockIcon = document.getElementById('boost-lock-icon');
    if (lockIcon) lockIcon.style.display = isBoost ? 'none' : '';
    if (!isBoost && this.elServerStrongReview) {
      this.elServerStrongReview.checked = false;
      this.elServerStrongReview.disabled = true;
      this.engineSettings.serverStrongReview = false;
    } else if (isBoost && this.elServerStrongReview) {
      this.elServerStrongReview.disabled = false;
    }
  }

			  _enterBoostPage() {
			    document.body.classList.add('menu-active');
			    document.body.dataset.mode = 'boost';
			    if (this.elMainMenu) this.elMainMenu.hidden = true;
			    if (this.elMainContent) this.elMainContent.hidden = true;
		    this.puzzleMode.active = false;
		    this.anticheatMode.active = false;
		    if (this.coachMode.active) {
		      this.coachMode.active = false;
		      this.coachMode.thinking = false;
		      this._syncCoachControls();
		    }
		    if (this.elLiveEval) this.elLiveEval.hidden = true;
		    if (this.elReviewSummary) this.elReviewSummary.style.display = 'none';
		    this._syncPuzzleVisibility();
		    this._syncAnticheatVisibility();
		    this._syncBoostPageVisibility();
			    this._syncServerStrongToggle();
			  }

			  _closeBoostPage() {
			    this._navigateTo('/index');
			  }

			  _handleBoostPurchase() {
			    this._setAuthMode(this.authState.user ? 'signin' : 'signup');
			    this._navigateTo(this.authState.user ? '/account' : '/signup');
			  }

		  _enterAnticheatMode() {
	    document.body.classList.remove('menu-active');
	    document.body.dataset.mode = 'anticheat';
	    this.liveEvalToken += 1;
	    this.puzzleMode.active = false;
	    this.coachMode.active = false;
	    this.coachMode.thinking = false;
	    this.anticheatMode.active = true;
	    this.board.clearLoading();
	    this.board.clearBestMoveArrow();
	    this.board.setHighlights([]);
	    if (this.elLiveEval) this.elLiveEval.hidden = true;
	    this.elReviewSummary.style.display = 'none';
	    this.elCriticalMoments.style.display = 'none';
	    this.elMoveBadge.style.display = 'none';
	    this._syncCoachVisibility();
	    this._syncPuzzleVisibility();
		    this._syncAnticheatVisibility();
		    this._syncBoostPageVisibility();
		    this._syncAnticheatForm();
	    this._syncActionButtons();
	  }

		  _syncPuzzlePanel() {
		    if (!this.elPuzzleCard) return;
		    const mode = this.puzzleMode;
		    const currentPuzzleId = mode.current?.puzzle?.id || '';
		    const alreadyAttempted = !!(currentPuzzleId && mode.attemptedPuzzleIds?.has(currentPuzzleId));
		    this.elPuzzleCard.classList.toggle('puzzle-loading', !!mode.loading);
		    if (this.elPuzzleUserRating) this.elPuzzleUserRating.textContent = Math.round(mode.rating || 1500);
	    if (this.elPuzzleTargetRating) this.elPuzzleTargetRating.textContent = mode.loading ? '--' : (mode.current?.puzzle?.rating || mode.rating || 1500);
		    if (this.elPuzzleStreak) this.elPuzzleStreak.textContent = String(mode.streak || 0);
		    if (this.elPuzzleScore) this.elPuzzleScore.textContent = `${mode.solvedCount || 0} / ${mode.attemptedCount || 0}`;
		    if (this.elPuzzleSource) this.elPuzzleSource.textContent = mode.loading ? 'Finding puzzle' : (mode.source || 'Lichess training');
			if (this.elBtnPuzzleNext) {
				this.elBtnPuzzleNext.disabled = !!mode.loading;
				if (this.elBtnPuzzleNext.disabled) this.elBtnPuzzleNext.classList.remove('pulse');
				else this.elBtnPuzzleNext.classList.add('pulse');
			}
		    if (this.elBtnPuzzleDaily) this.elBtnPuzzleDaily.disabled = !!mode.loading;
			    if (this.elBtnPuzzleRetry) this.elBtnPuzzleRetry.disabled = !mode.current || !!mode.loading || alreadyAttempted || mode.solved || mode.failed;
			    if (this.elBtnPuzzleHint) this.elBtnPuzzleHint.disabled = !mode.current || mode.loading || mode.solved || mode.failed;
		    if (this.elBtnPuzzleReview) this.elBtnPuzzleReview.disabled = this.gameMoves.length === 0 || this.isAnalyzing;
	    if (this.elPuzzleTags) {
	      if (mode.loading) {
	        this.elPuzzleTags.innerHTML = this._renderSkeletonLines(4, 'puzzle-tag-skeleton');
	        return;
	      }
	      const themes = mode.current?.puzzle?.themes || [];
	      this.elPuzzleTags.innerHTML = themes.length
	        ? themes.slice(0, 8).map((theme) => `<span class="puzzle-tag">${this._escapeHtml(this._formatPuzzleTheme(theme))}</span>`).join('')
	        : '';
	    }
	  }

	  _setPuzzleStatus(message, kind = '') {
	    if (!this.elPuzzleStatus) return;
	    this.elPuzzleStatus.textContent = message || '';
	    this.elPuzzleStatus.className = `puzzle-status ${kind}`.trim();
	    // Visual celebration and rating chip on success
	    try {
	      if (this.elPuzzleCard) {
	        if (kind === 'success') {
	          this.elPuzzleCard.classList.add('success-celebrate');
	          setTimeout(() => this.elPuzzleCard.classList.remove('success-celebrate'), 1400);
	        }
	      }
			if (kind === 'success' && this.elPuzzleUserRating) {
				// briefly show a rating chip if rating changed element exists
				const delta = Number(this.puzzleMode?.lastDelta || 0);
				if (delta !== 0) {
					const chip = document.createElement('span');
					chip.className = 'rating-chip';
					chip.textContent = (delta >= 0 ? '+' : '') + String(delta);
					this.elPuzzleUserRating.appendChild(chip);
					setTimeout(() => chip.remove(), 1600);
				}
			}
	    } catch (e) {
	      // non-fatal UI enhancement
	      console.debug('Puzzle status UI enhancement failed', e);
	    }
	  }

	  _escapeHtml(value) {
	    return String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;')
	      .replace(/"/g, '&quot;')
	      .replace(/'/g, '&#39;');
	  }

	  _formatPuzzleTheme(theme) {
	    return String(theme || '')
	      .replace(/([a-z])([A-Z])/g, '$1 $2')
	      .replace(/^./, (ch) => ch.toUpperCase());
	  }

				  _bindEvents() {
    this.elBtnMenuImport?.addEventListener('click', () => this._navigateTo('/review', { disableRestore: true }));
	    this.elBtnMenuCoach?.addEventListener('click', () => this._navigateTo('/coach', { disableRestore: true }));
	    this.elBtnMenuPuzzles?.addEventListener('click', () => this._navigateTo('/puzzles', { disableRestore: true }));
	    this.elBtnMenuAnticheat?.addEventListener('click', () => this._navigateTo('/anticheat', { disableRestore: true }));
    this.elBtnMenuBoost?.addEventListener('click', () => this._navigateTo('/boost', { disableRestore: true }));
    this.elBtnCloseBoost?.addEventListener('click', () => this._closeBoostPage());
	    this.elBtnBoostPurchase?.addEventListener('click', () => this._handleBoostPurchase());
		    this.elBtnBoostAccount?.addEventListener('click', () => this._navigateTo(this.authState.user ? '/account' : '/signup'));
    this.elBtnBackMenu?.addEventListener('click', () => this._navigateTo('/index', { disableRestore: true }));
    this.elEngineChoiceClose?.addEventListener('click', () => this._hideEngineChoiceModal());
    this.elEngineChoiceModal?.addEventListener('click', (e) => {
      if (e.target === this.elEngineChoiceModal) this._hideEngineChoiceModal();
    });
	    this.elBtnEngineChoiceConfirm?.addEventListener('click', () => this._confirmEngineChoice());
	    this.elEngineChoiceModule?.addEventListener('change', () => {
	      const selected = this._selectedEngineModule(this.elEngineChoiceModule, this.engineSettings.module);
	      this.elEngineChoiceRecommendation.textContent = this._engineRecommendationText(selected);
	    });
	    this.elPromotionOptions?.addEventListener('click', (e) => {
	      const button = e.target.closest?.('[data-piece]');
	      if (button) this._finishPromotionChoice(button.dataset.piece);
	    });
	    this.elBtnImport.addEventListener('click', () => this._navigateTo('/review', { disableRestore: true }));
	    this.elBtnPuzzles?.addEventListener('click', () => this._navigateTo('/puzzles', { disableRestore: true }));
	    this.elBtnAnticheat?.addEventListener('click', () => this._navigateTo('/anticheat', { disableRestore: true }));
			    this.elBtnAccount?.addEventListener('click', () => this._navigateTo('/account', { disableRestore: true }));
		    this.elBtnSettings.addEventListener('click', () => this._navigateTo('/settings', { disableRestore: true }));
	    this.elPageToSignup?.addEventListener('click', () => this._navigateTo('/signup'));
	    this.elPageToLogin?.addEventListener('click', () => this._navigateTo('/login'));
	    this.elLoginSubmit?.addEventListener('click', () => this._handlePageEmailAuth('signin'));
	    this.elSignupSubmit?.addEventListener('click', () => this._handlePageEmailAuth('signup'));
	    this.elLoginGoogle?.addEventListener('click', () => this._handleGoogleAuth());
	    this.elSignupGoogle?.addEventListener('click', () => this._handleGoogleAuth());
	    this.elPageAccountSignin?.addEventListener('click', () => this._navigateTo('/signin'));
	    this.elPageAccountSignout?.addEventListener('click', () => this._handleSignOut());
	    this.elPageClearCache?.addEventListener('click', () => this._clearLocalCache());
	    this.elAccountClose?.addEventListener('click', () => this._hideAccountModal());
	    this.elAccountModal?.addEventListener('click', (e) => {
	      if (e.target === this.elAccountModal) this._hideAccountModal();
	    });
	    this.elBtnAuthSigninMode?.addEventListener('click', () => this._setAuthMode('signin'));
	    this.elBtnAuthSignupMode?.addEventListener('click', () => this._setAuthMode('signup'));
	    this.elBtnAuthSubmit?.addEventListener('click', () => this._handleEmailAuth());
	    this.elBtnGoogleAuth?.addEventListener('click', () => this._handleGoogleAuth());
	    this.elBtnAuthSignout?.addEventListener('click', () => this._handleSignOut());
	    this.elBtnGiftBoost?.addEventListener('click', () => this._giftBoost());
    this.elModalClose.addEventListener('click', () => this._hidePgnModal());
    this.elSettingsClose.addEventListener('click', () => this._hideSettingsModal());
    this.elPgnModal.addEventListener('click', (e) => {
      if (e.target === this.elPgnModal) this._hidePgnModal();
    });
    this.elSettingsModal.addEventListener('click', (e) => {
      if (e.target === this.elSettingsModal) this._hideSettingsModal();
    });
    this.elBtnPgnLoad.addEventListener('click', () => this._loadPgn());
    this.elBtnImportUsername.addEventListener('click', () => this._loadGamesByUsername());
    this.elImportSource.addEventListener('change', () => this._syncImportMode());

	    this.elBtnCoach.addEventListener('click', () => this._navigateTo('/coach'));
    this.elBtnCoachStart.addEventListener('click', () => this._toggleCoachMode());
    this.elBtnCoachTakeback.addEventListener('click', () => this._coachTakeback());
    this.elBtnCoachHint?.addEventListener('click', () => this._handleCoachHint());
    this.elCoachSetupClose?.addEventListener('click', () => this._hideCoachSetupModal());
	    this.elCoachSetupModal?.addEventListener('click', (e) => {
	      if (e.target === this.elCoachSetupModal) this._hideCoachSetupModal();
	    });
	    this.elCoachSetupAiAdjust?.addEventListener('change', () => {
	      if (this.elCoachSetupAdjustStyle) {
	        this.elCoachSetupAdjustStyle.disabled = this.elCoachSetupAiAdjust.checked === false;
	      }
	    });
	    this.elBtnCoachSetupStart?.addEventListener('click', () => this._startCoachFromSetup());
	    this.elBtnPuzzleNext?.addEventListener('click', () => this._loadNextPuzzle());
	    this.elBtnPuzzleDaily?.addEventListener('click', () => this._loadDailyPuzzle());
		    this.elBtnPuzzleRetry?.addEventListener('click', () => this._retryCurrentPuzzle());
		    this.elBtnPuzzleHint?.addEventListener('click', () => this._showPuzzleHint());
		    this.elBtnPuzzleReview?.addEventListener('click', () => this._reviewCurrentPuzzleLine());
		    this.elBtnExportPgn?.addEventListener('click', () => this._exportCurrentPgn());
		    this.elBtnExportFen?.addEventListener('click', () => this._exportCurrentFen());
		    this.elAnticheatSource?.addEventListener('change', () => this._syncAnticheatForm());
	    this.elBtnAnticheatRun?.addEventListener('click', () => this._startAnticheatCheck());
	    this.elBtnReview.addEventListener('click', () => this._startReview());
	    this.elBtnLineExplorer?.addEventListener('click', () => this._exploreBestLineFromCurrentMove());
	    this.elBtnReturnExplorer?.addEventListener('click', () => this._returnFromLineExplorer());
	    this.elBtnReset.addEventListener('click', () => this._resetGame());
    this.elEngineSource.addEventListener('change', () => this._handleEngineSourceChange());
	    this.elEngineModule.addEventListener('change', () => this._handleEngineModuleChange());
	    this.elEngineStrength.addEventListener('change', () => this._handleEngineStrengthChange());
	    this.elEngineMaxTime?.addEventListener('change', () => this._handleEngineMaxTimeChange());
	    this.elAnalysisLocation?.addEventListener('change', () => {
	      this.engineSettings.analysisLocation = this.elAnalysisLocation.value;
	      this._syncServerStrongToggle();
	      this._renderIdleEngineInfo();
	    });
		    this.elServerStrongReview?.addEventListener('change', () => {
		      if (this.authState.plan?.plan !== 'boost') {
		        this.elServerStrongReview.checked = false;
		        this.engineSettings.serverStrongReview = false;
		        this._navigateTo('/boost');
		        return;
		      }
		      this.engineSettings.serverStrongReview = this.elServerStrongReview.checked;
		    });
	    this.elBtnBoostAccount?.addEventListener('click', () => this._navigateTo(this.authState.user ? '/account' : '/signup'));

    this.elBtnFlip.addEventListener('click', () => this.board.flip());
    this.elBtnFirst.addEventListener('click', () => this._goToMove(-1));
    this.elBtnPrev.addEventListener('click', () => this._goToMove(this.currentMoveIndex - 1));
    this.elBtnNext.addEventListener('click', () => this._goToMove(this.currentMoveIndex + 1));
    this.elBtnLast.addEventListener('click', () => this._goToMove(this.gameMoves.length - 1));
    this.elBtnAuto.addEventListener('click', () => this._toggleAutoPlay());

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this._goToMove(this.currentMoveIndex - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this._goToMove(this.currentMoveIndex + 1);
          break;
        case 'Home':
          e.preventDefault();
          this._goToMove(-1);
          break;
        case 'End':
          e.preventDefault();
          this._goToMove(this.gameMoves.length - 1);
          break;
      }
	    });
	  }

		  _enterReviewMode() {
		    document.body.classList.remove('menu-active');
		    document.body.dataset.mode = 'review';
		    this.puzzleMode.active = false;
		    this.anticheatMode.active = false;
		    this._syncPuzzleVisibility();
		    this._syncAnticheatVisibility();
		    this._syncBoostPageVisibility();
		    if (this.elLiveEval) this.elLiveEval.hidden = false;
	    if (this.coachMode.active) {
	      this.coachMode.active = false;
	      this.coachMode.thinking = false;
	      this.board.clearBestMoveArrow();
	      this._syncCoachControls();
		    }
		    this._syncServerStrongToggle();
		    this._syncActionButtons();
		    this._updateCurrentMoveIndicator();
		  }

	  _enterCoachMode(options = null) {
	    document.body.classList.remove('menu-active');
	    document.body.dataset.mode = 'coach';
	    this.puzzleMode.active = false;
	    this.anticheatMode.active = false;
	    this._syncPuzzleVisibility();
	    this._syncAnticheatVisibility();
	    if (this.elLiveEval) this.elLiveEval.hidden = false;
		    this.elReviewSummary.style.display = 'none';
		    this.elCriticalMoments.style.display = 'none';
		    this.elMoveBadge.style.display = 'none';
		    this._resetInsightPanel();
	    const restoredCoachGame = this._isCoachGame() && this.coachMode.active;
	    if (restoredCoachGame) {
	      this._setBoardOrientationForColor(this.coachMode.humanColor || this._coachHumanColorFromHeaders() || 'w');
	      this._setCoachDialog('Coach game restored. Continue from the current position.', 'Coaching');
	      this._syncBoostPageVisibility();
	      this._syncServerStrongToggle();
	      this._syncCoachControls();
	      this._syncActionButtons();
	      this._updateCurrentMoveIndicator();
	      this._requestLiveEvaluation('Analyzing restored coach position...');
	      return;
	    }
	    if (options) this.pendingCoachSetup = options;
    if (this.engine?.ready && !this.isAnalyzing) {
      this._startCoachGame(this.pendingCoachSetup || options || {});
      this.pendingCoachSetup = null;
      return;
    }
    this.coachMode.active = true;
	    this._syncCoachVisibility();
	    this._setCoachDialog('Loading Stockfish. Coach will start when ready.', 'Loading');
	    this._updateLiveEvalPanel({
	      busy: true,
	      score: null,
	      line: 'Preparing coach.',
	      meta: 'The board will unlock when the engine is ready.',
	    });
    this._syncCoachControls();
    this._updateCurrentMoveIndicator();
  }

	  _showMainMenu() {
	    this.autoPlaying = false;
	    this._setButtonLabel(this.elBtnAuto, 'Auto');
	    this.liveEvalToken += 1;
	    this.explorerReturnState = null;
		    this.coachMode.active = false;
		    this.coachMode.thinking = false;
		    this.puzzleMode.active = false;
			    this.anticheatMode.active = false;
			    this.board.clearLoading();
			    this.board.clearBestMoveArrow();
		    delete document.body.dataset.mode;
			    this._syncCoachVisibility();
			    this._syncPuzzleVisibility();
	    this._syncAnticheatVisibility();
	    this._syncBoostPageVisibility();
		    if (this.elMainMenu) this.elMainMenu.hidden = false;
	    this._hideRoutePages();
	    if (this.elMainContent) this.elMainContent.hidden = false;
	    document.body.classList.add('menu-active');
	  }

  async _initEngine() {
    const initToken = ++this.engineInitToken;
    const moduleConfig = getEngineModuleConfig(this.engineSettings.source, this.engineSettings.module);
    let initialized = false;

    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }

	    this._setEngineControlsDisabled(true);
	    this._showEngineLoadingOverlay('Preparing engine settings...');
	    this.elEngineStatus.textContent = `${moduleConfig.engineLabel}: Loading`;
    this.elEngineStatus.classList.remove('ready');
    this._setEngineLoadProgress(5, 'Preparing engine settings...');
    this._renderIdleEngineInfo('Preparing engine settings...');
    this.board.setLoading(null, 'Loading engine');

    try {
      this._setEngineLoadProgress(15, 'Preloading sounds...');
      await this._preloadSounds((pct) => {
        if (initToken !== this.engineInitToken) return;
        this._setEngineLoadProgress(15 + Math.round(pct * 0.25), 'Preloading sounds...');
      });
      if (initToken !== this.engineInitToken) return;

      this._setEngineLoadProgress(42, 'Starting Stockfish...');
      const engine = createEngineController({
        source: this.engineSettings.source,
        module: this.engineSettings.module,
      });
      await engine.init();
      if (initToken !== this.engineInitToken) {
        engine.destroy();
        return;
      }

      this.engine = engine;
      this._setEngineLoadProgress(88, 'Stockfish ready...');
      this.elEngineStatus.textContent = `${moduleConfig.engineLabel}: Ready`;
      this.elEngineStatus.classList.add('ready');
      this._renderIdleEngineInfo();
	      this._requestLiveEvaluation(this.currentMoveIndex >= 0
	        ? 'Analyzing current position...'
	        : 'Analyzing original position...');
	      initialized = true;
	      this._setEngineLoadProgress(100, 'Ready');
	      if (document.body.dataset.mode === 'coach' && this.coachMode.active && this.gameHeaders.Event !== 'Coach') {
	        this._startCoachGame(this.pendingCoachSetup || {});
	        this.pendingCoachSetup = null;
	      }
    } catch (err) {
      if (initToken !== this.engineInitToken) return;

      const nextBrowserModule = this._nextBrowserModuleAfterFailure(this.engineSettings.module);
      if (this.engineSettings.source === 'browser' && nextBrowserModule) {
	        this.engineSettings.module = nextBrowserModule;
	        this._populateEngineModules();
	        this.elEngineStatus.textContent = 'Browser engine unavailable. Trying another Stockfish module...';
	        this._renderIdleEngineInfo('Switching browser engine...');
	        return this._initEngine();
      }

      this.elEngineStatus.textContent = `${moduleConfig.engineLabel}: Failed`;
      this.elEngineLine.textContent = err.message;
      this._setEngineLoadProgress(0, 'Engine failed');
      console.error('Engine init failed:', err);
    } finally {
	      if (initToken === this.engineInitToken) {
	        this.board.clearLoading();
	        this._hideEngineLoadingOverlay();
	        this._setEngineControlsDisabled(this.isAnalyzing);
	        this._syncActionButtons();
	      }
    }

    return initialized;
  }

	  _populateEngineModules() {
	    const modules = getEngineModules(this.engineSettings.source);
	    const recommended = this._recommendedEngineModule();
	    const nextModule = modules.some((entry) => entry.key === this.engineSettings.module && !(entry.requiresIsolation && !window.crossOriginIsolated))
	      ? this.engineSettings.module
	      : recommended;

	    this.engineSettings.module = nextModule;
	    this._renderEngineModuleRadios(this.elEngineModule, 'engine-module', modules, nextModule, recommended);
	  }

	  _selectedEngineModule(container, fallback = this.engineSettings.module) {
	    const checked = container?.querySelector('input[type="radio"]:checked');
	    return checked?.value || fallback;
	  }

	  _renderEngineModuleRadios(container, name, modules, selected, recommended) {
	    if (!container) return;
	    container.innerHTML = '';

	    modules.forEach((entry) => {
	      const unavailable = !!entry.requiresIsolation && !window.crossOriginIsolated;
		      const label = document.createElement('label');
		      label.className = `engine-radio-card${unavailable ? ' disabled' : ''}`;
		      const note = entry.downloadLabel || (entry.key === recommended ? 'Recommended for this computer' : `${entry.threads || 1} thread${entry.threads === 1 ? '' : 's'}`);
	      label.innerHTML = `
	        <input type="radio" name="${name}" value="${entry.key}" ${entry.key === selected ? 'checked' : ''} ${unavailable ? 'disabled data-unavailable="true"' : ''}>
	        <span>
	          ${entry.label}
	          <small>${unavailable ? 'Needs cross-origin isolation' : note}</small>
	        </span>
	      `;
	      container.appendChild(label);
	    });
	  }

	  _nextBrowserModuleAfterFailure(failedKey) {
	    if (failedKey) this.failedBrowserModules.add(failedKey);
	    const preferred = ['lite-single', 'full-single'];
    const available = getEngineModules('browser')
      .filter((entry) => !entry.requiresIsolation || window.crossOriginIsolated)
      .map((entry) => entry.key);
    return preferred.find((key) => available.includes(key) && !this.failedBrowserModules.has(key)) || null;
  }

  async _recoverLiveEngineFailure(err, { silent = false } = {}) {
    if (this.engineSettings.source !== 'browser') return false;
    const nextModule = this._nextBrowserModuleAfterFailure(this.engineSettings.module);
    if (!nextModule) return false;
	    this.engineSettings.module = nextModule;
	    this._populateEngineModules();
	    if (!silent) {
      this._updateLiveEvalPanel({
        busy: false,
        score: null,
        line: 'Stockfish crashed. Switching engine...',
        meta: err?.message || '',
      });
    }
    await this._initEngine();
    return true;
  }

	  _setEngineControlsDisabled(disabled) {
	    this.elEngineSource.disabled = disabled;
	    this.elEngineModule.querySelectorAll('input').forEach((input) => {
	      input.disabled = disabled || input.dataset.unavailable === 'true';
	    });
	    this.elEngineStrength.disabled = disabled;
	    if (this.elAnalysisLocation) this.elAnalysisLocation.disabled = disabled;
	  }

	  _setEngineLoadProgress(percent, message = '') {
	    if (!this.elEngineLoadProgress || !this.elEngineLoadProgressFill) return;
	    const pct = clamp(Math.round(percent || 0), 0, 100);
	    this.elEngineLoadProgress.classList.toggle('ready', pct >= 100);
	    this.elEngineLoadProgressFill.style.width = `${pct}%`;
	    this.elEngineLoadProgress.title = message || `${pct}%`;
	    if (this.elEngineLoadingFill) this.elEngineLoadingFill.style.width = `${pct}%`;
	    if (this.elEngineLoadingText) this.elEngineLoadingText.textContent = message || `${pct}%`;
	  }

			  _showEngineLoadingOverlay(message = 'Preparing Stockfish...') {
			    if (!this.elEngineLoadingOverlay) return;
			    if (document.body.classList.contains('menu-active') && !document.body.dataset.page) {
			      if (this.elEngineLoadingText) this.elEngineLoadingText.textContent = message;
			      return;
			    }
		    this.elEngineLoadingOverlay.style.display = 'flex';
		    if (this.elEngineLoadingText) this.elEngineLoadingText.textContent = message;
		  }

		  _hideEngineLoadingOverlay() {
		    if (this.elEngineLoadingOverlay) this.elEngineLoadingOverlay.style.display = 'none';
		  }

		  _showAppLoadingOverlay(message = 'Loading...') {
		    if (!this.elAppLoadingOverlay) return;
		    this.elAppLoadingOverlay.style.display = 'flex';
		    if (this.elAppLoadingText) this.elAppLoadingText.textContent = message;
		  }

		  _hideAppLoadingOverlay() {
		    if (this.elAppLoadingOverlay) this.elAppLoadingOverlay.style.display = 'none';
		  }

  _preloadSounds(onProgress) {
	    if (this.soundPreloadPromise) return this.soundPreloadPromise;
	    const entries = Object.entries(this.soundFiles);
	    const total = entries.length * 3;
	    let complete = 0;
	    const report = () => {
	      complete += 1;
	      if (onProgress) onProgress(total ? complete / total : 1);
	    };

	    this.soundPreloadPromise = Promise.all(entries.flatMap(([name, file]) => {
	      const pool = [0, 1, 2].map(() => {
	        const audio = new Audio(file);
	        audio.preload = 'auto';
	        return audio;
	      });
	      this.soundPool[name] = pool;
	      this.soundPoolIndex[name] = 0;
	      return pool.map((audio) => new Promise((resolve) => {
	      let settled = false;
	      let timer = null;
	      const done = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
	        audio.removeEventListener('canplaythrough', done);
	        audio.removeEventListener('loadeddata', done);
	        audio.removeEventListener('error', done);
	        report();
	        resolve();
	      };
      audio.addEventListener('canplaythrough', done, { once: true });
      audio.addEventListener('loadeddata', done, { once: true });
	      audio.addEventListener('error', done, { once: true });
	      timer = setTimeout(done, 2500);
	      audio.load();
	      }));
	    })).then(() => true);

    return this.soundPreloadPromise;
  }

		  _syncActionButtons() {
			const engineReady = !!this.engine?.ready;
			const serverReview = this.engineSettings.analysisLocation === 'server';
		    this.elBtnReview.disabled = this.isAnalyzing || this.gameMoves.length === 0 || (!serverReview && !engineReady);
		    if (this.elBtnExportPgn) this.elBtnExportPgn.disabled = this.gameMoves.length === 0;
		    if (this.elBtnExportFen) this.elBtnExportFen.disabled = this.isAnalyzing;
	    if (this.elBtnCoachStart) this.elBtnCoachStart.disabled = this.isAnalyzing || !engineReady;
    if (this.elBtnCoachTakeback) {
      this.elBtnCoachTakeback.disabled = !this.coachMode.active || this.gameMoves.length === 0;
    }
	    if (this.elBtnReset) {
	      this.elBtnReset.disabled = this.isAnalyzing || (this.gameMoves.length === 0 && this.currentMoveIndex === -1);
	    }
	    if (this.elBtnPuzzleReview) {
	      this.elBtnPuzzleReview.disabled = this.isAnalyzing || this.gameMoves.length === 0;
	    }
		    if (this.elBtnPuzzleRetry) {
		      const puzzleId = this.puzzleMode.current?.puzzle?.id || '';
		      const alreadyAttempted = !!(puzzleId && this.puzzleMode.attemptedPuzzleIds?.has(puzzleId));
		      const canRetry = !this.isAnalyzing && !this.puzzleMode.loading && !!this.puzzleMode.current && !this.puzzleMode.solved && (this.puzzleMode.failed || !alreadyAttempted);
      this.elBtnPuzzleRetry.disabled = !canRetry;
		    }
	    if (this.elBtnPuzzleHint) {
	      this.elBtnPuzzleHint.disabled = this.isAnalyzing
		        || this.puzzleMode.loading
		        || !this.puzzleMode.current
		        || this.puzzleMode.solved
		        || this.puzzleMode.failed;
	    }
	  }

	  _renderIdleEngineInfo(message) {
	    const source = ENGINE_CATALOG[this.engineSettings.source]?.label || 'Engine';
	    const moduleConfig = getEngineModuleConfig(this.engineSettings.source, this.engineSettings.module);
	    const reviewProfile = this._getReviewProfile();
		const location = this.engineSettings.analysisLocation === 'server' ? 'Server review' : 'Browser review';
	    this.elEngineLine.textContent = message || `${source} | ${moduleConfig.label} | ${reviewProfile.label} | ${location} | MultiPV ${reviewProfile.multiPv}`;
	  }

	  _renderPostReviewEvalPanel() {
		const source = this.engineSettings.analysisLocation === 'server' ? 'Server review' : 'Browser review';
	    this._updateLiveEvalPanel({
	      busy: false,
	      score: this.analysisResults?.[0]?.evalBefore ?? this.currentEvalScore,
	      line: 'Review complete.',
	      meta: source,
	    });
	    this._renderIdleEngineInfo('Review complete. Select a move for details.');
	  }

  _setLiveEvalLoading(isLoading, label = 'Live eval') {
    if (!this.elLiveEvalStatus) return;
    this.elLiveEvalStatus.classList.toggle('busy', !!isLoading);
    this.elLiveEvalStatus.innerHTML = `<span class="live-status-dot${isLoading ? ' spinning' : ''}"></span><span>${label}</span>`;
  }

  _updateLiveEvalPanel({ busy, score, line, meta } = {}) {
    if (typeof busy === 'boolean') {
      this._setLiveEvalLoading(busy, busy ? 'Analyzing' : 'Live eval');
    }

    if (this.elLiveEvalScore) {
      this.elLiveEvalScore.textContent = typeof score === 'number'
        ? this.analyzer.formatScore(score)
        : '--';
    }

    if (this.elLiveEvalLine) {
      this.elLiveEvalLine.textContent = line || 'Make a move to see a live evaluation.';
    }

    if (this.elLiveEvalMeta) {
      this.elLiveEvalMeta.textContent = meta || '';
    }
  }

  _getGameEndReason() {
    if (!this.chess.game_over()) return null;
    if (this.chess.in_checkmate()) return 'Checkmate';
    if (this.chess.in_stalemate()) return 'Stalemate';
    if (this.chess.in_threefold_repetition()) return 'Threefold repetition';
    if (this.chess.insufficient_material()) return 'Insufficient material';

    const fenParts = this.chess.fen().split(' ');
    const halfmoveClock = parseInt(fenParts[4] || '0', 10);
    if (halfmoveClock >= 100) return '50-move rule';

    if (this.chess.in_draw()) return 'Draw';
    return 'Game over';
  }

  _updateGameStatus() {
    if (!this.elGameStatus) return;

    const reason = this._getGameEndReason();
    this.gameStatus = reason;

    if (!reason) {
      this.elGameStatus.style.display = 'none';
      this.elGameStatusTitle.textContent = '';
      this.elGameStatusReason.textContent = '';
      this.elGameStatusDetails.textContent = '';
      return;
    }

    const sideToMove = this.chess.turn() === 'w' ? 'White' : 'Black';
    let details = `${reason}.`;
    if (reason === 'Checkmate') {
      details = `${sideToMove} to move is checkmated.`;
    } else if (reason === 'Threefold repetition') {
      details = 'The same position has repeated three times.';
    } else if (reason === 'Insufficient material') {
      details = 'There is not enough material left to force mate.';
    } else if (reason === '50-move rule') {
      details = 'Fifty moves have passed without a pawn move or capture.';
    } else if (reason === 'Stalemate') {
      details = `${sideToMove} has no legal moves and is not in check.`;
    } else if (reason === 'Draw') {
      details = 'The position is drawn.';
    }

    this.elGameStatus.style.display = 'block';
    this.elGameStatusTitle.textContent = 'Game End';
    this.elGameStatusReason.textContent = reason;
    this.elGameStatusDetails.textContent = details;
  }

  _refreshCurrentMove() {
    const target = typeof this.currentMoveIndex === 'number' ? this.currentMoveIndex : -1;
    this.currentMoveIndex = -9999;
    this._goToMove(target >= -1 ? target : -1);
  }

	  _invalidateAnalysisResults(options = {}) {
    const { skipBoardRefresh = false } = options;
    if (!this.analysisResults) return;

	    this.analysisResults = null;
	    if (this.elReviewBtnText) this.elReviewBtnText.textContent = 'Start Review';
	    this.elReviewSummary.style.display = 'none';
	    this.elMoveBadge.style.display = 'none';
		    this.elCriticalMoments.style.display = 'none';
		    this.elCriticalList.innerHTML = '';
		    this._clearReviewExtras();
    this._resetInsightPanel();
    this.liveEvalHistory = [];
    this._updateLiveEvalPanel({
      busy: false,
      score: null,
      line: 'Live eval will resume on the next move.',
      meta: '',
    });
    this._renderMoveList();
    this._updateEvalBar(0);
    this._drawEvalGraph();
    this._renderIdleEngineInfo();
    this.board.clearBestMoveArrow();
    if (!skipBoardRefresh) {
      this._refreshCurrentMove();
    }
  }

  async _handleEngineSourceChange() {
    this.engineSettings.source = this.elEngineSource.value;
    this.failedBrowserModules.clear();
    this._populateEngineModules();
    const initialized = await this._initEngine();
    if (initialized) this._invalidateAnalysisResults();
  }

	  async _handleEngineModuleChange() {
	    const selected = this._selectedEngineModule(this.elEngineModule);
	    if (!selected || selected === this.engineSettings.module) return;
	    this.engineSettings.module = selected;
	    this.failedBrowserModules.clear();
	    const initialized = await this._initEngine();
	    if (initialized) this._invalidateAnalysisResults();
  }

	  async _handleEngineStrengthChange() {
	    this.engineSettings.strength = this.elEngineStrength.value;
	    this._renderIdleEngineInfo();
	    this._invalidateAnalysisResults();
	  }

	  async _handleEngineMaxTimeChange() {
	    this.engineSettings.maxTimeMs = Math.max(1000, Number(this.elEngineMaxTime?.value) || 12000);
	    this._renderIdleEngineInfo();
	    this._invalidateAnalysisResults();
	  }

  _showPgnModal() {
    this.elPgnModal.style.display = 'flex';
    this._setImportStatus('');
    this._renderImportResults([]);
    this._syncImportMode();
    this.elPgnInput.focus();
  }

  _hidePgnModal() {
    this.elPgnModal.style.display = 'none';
  }

  _settingsSwalHtml() {
    const modules = getEngineModules(this.engineSettings.source);
    const moduleOptions = modules.map((entry) => `
      <option value="${entry.key}" ${entry.key === this.engineSettings.module ? 'selected' : ''}>${this._escapeHtml(entry.label)}</option>
    `).join('');
    return `
      <div class="swal-form-grid">
        <label class="field">
          <span class="field-label">Engine Model</span>
          <select id="swal-engine-module" class="input-select">${moduleOptions}</select>
        </label>
        <label class="field">
          <span class="field-label">Analysis Depth</span>
          <select id="swal-engine-strength" class="input-select">
            <option value="depth10" ${this.engineSettings.strength === 'depth10' ? 'selected' : ''}>Depth 10</option>
            <option value="depth14" ${this.engineSettings.strength === 'depth14' ? 'selected' : ''}>Depth 14</option>
            <option value="depth18" ${this.engineSettings.strength === 'depth18' ? 'selected' : ''}>Depth 18</option>
            <option value="depth22" ${this.engineSettings.strength === 'depth22' ? 'selected' : ''}>Depth 22</option>
            <option value="depth26" ${this.engineSettings.strength === 'depth26' ? 'selected' : ''}>Depth 26</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Maximum Time</span>
          <select id="swal-engine-max-time" class="input-select">
            <option value="4000" ${String(this.engineSettings.maxTimeMs) === '4000' ? 'selected' : ''}>4 seconds</option>
            <option value="8000" ${String(this.engineSettings.maxTimeMs) === '8000' ? 'selected' : ''}>8 seconds</option>
            <option value="12000" ${String(this.engineSettings.maxTimeMs) === '12000' ? 'selected' : ''}>12 seconds</option>
            <option value="20000" ${String(this.engineSettings.maxTimeMs) === '20000' ? 'selected' : ''}>20 seconds</option>
            <option value="30000" ${String(this.engineSettings.maxTimeMs) === '30000' ? 'selected' : ''}>30 seconds</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Review Location</span>
          <select id="swal-analysis-location" class="input-select">
            <option value="browser" ${this.engineSettings.analysisLocation === 'browser' ? 'selected' : ''}>Browser</option>
            <option value="server" ${this.engineSettings.analysisLocation === 'server' ? 'selected' : ''}>Server</option>
          </select>
        </label>
        <p class="modal-help">These settings apply to browser review, coach, live eval, and local engine use.</p>
      </div>`;
  }

  async _showSettingsModal() {
    const result = await this._showPopup({
      form: true,
      title: 'Engine Settings',
      html: this._settingsSwalHtml(),
      showCancelButton: true,
      cancelButtonText: 'Cancel',
      confirmButtonText: 'Save',
      preConfirm: () => {
        const root = window.Swal.getHtmlContainer();
        return {
          module: root.querySelector('#swal-engine-module')?.value,
          strength: root.querySelector('#swal-engine-strength')?.value,
          maxTimeMs: Number(root.querySelector('#swal-engine-max-time')?.value || 12000),
          analysisLocation: root.querySelector('#swal-analysis-location')?.value || 'browser',
        };
      },
    });
    if (!result.isConfirmed || !result.value) return;
    const previousModule = this.engineSettings.module;
    this.engineSettings.module = result.value.module || this.engineSettings.module;
    this.engineSettings.strength = result.value.strength || this.engineSettings.strength;
    this.engineSettings.maxTimeMs = result.value.maxTimeMs;
    this.engineSettings.analysisLocation = result.value.analysisLocation;
    this._syncSettingsModal();
    this._syncServerStrongToggle();
    this._renderIdleEngineInfo();
    if (previousModule !== this.engineSettings.module) {
      this.failedBrowserModules.clear();
      await this._initEngine();
    }
  }

  _hideSettingsModal() {
    if (window.Swal?.isVisible?.()) window.Swal.close();
  }

	  _recommendedEngineModule() {
	    return 'lite-single';
	  }

  _engineRecommendationText(moduleKey = this._recommendedEngineModule()) {
    const modules = getEngineModules(this.engineSettings.source);
    const recommended = modules.find((entry) => entry.key === this._recommendedEngineModule()) || modules[0];
    const selected = modules.find((entry) => entry.key === moduleKey) || recommended;
    const cores = navigator.hardwareConcurrency || 2;
    const isolated = window.crossOriginIsolated ? 'threaded engines are available' : 'single-threaded engines are safest';
    return `Recommended: ${recommended.label}. This computer reports ${cores} CPU threads, and ${isolated}. Selected: ${selected.label}.`;
  }

	  _showEngineChoiceModal(nextAction) {
	    this.pendingEngineAction = null;
	    this._continueAfterEngineChoice(nextAction);
	  }

  _hideEngineChoiceModal() {
    if (this.elEngineChoiceModal) this.elEngineChoiceModal.style.display = 'none';
    this.pendingEngineAction = null;
  }

  async _confirmEngineChoice() {
    const nextAction = this.pendingEngineAction;
    if (!nextAction) {
      this._hideEngineChoiceModal();
      return;
    }

	    const chosen = this._selectedEngineModule(this.elEngineChoiceModule, this.engineSettings.module);
    const changed = chosen && chosen !== this.engineSettings.module;
    this._hideEngineChoiceModal();

    if (changed) {
	      this.engineSettings.module = chosen;
	      this.failedBrowserModules.clear();
	      this._populateEngineModules();
	      await this._initEngine();
    }

    this._continueAfterEngineChoice(nextAction);
  }

  async _continueAfterEngineChoice(nextAction) {
    if (nextAction === 'coach') {
      await this._showCoachSetupModal();
      return;
    }

    this._enterReviewMode();
    this._showPgnModal();
  }

  async _showCoachSetupModal() {
    const elo = this.coachMode.elo || 1200;
    const color = this.coachMode.humanColor || 'w';
    const aiAdjust = this.coachMode.aiAdjust !== false;
    const adjustStyle = this.coachMode.adjustStyle || 'better';
    const result = await this._showPopup({
      form: true,
      title: 'Play Coach',
      html: `
        <div class="swal-form-grid">
          <label class="field">
            <span class="field-label">Coach ELO</span>
            <input id="swal-coach-elo" class="input-select" type="number" min="100" max="2800" step="50" value="${elo}">
          </label>
          <label class="checkbox-row coach-adjust-toggle">
            <input id="swal-coach-ai-adjust" type="checkbox" ${aiAdjust ? 'checked' : ''}>
            <span>AI Adjust</span>
          </label>
          <label class="field">
            <span class="field-label">Coach Target</span>
            <select id="swal-coach-adjust-style" class="input-select" ${aiAdjust ? '' : 'disabled'}>
              <option value="better" ${adjustStyle === 'better' ? 'selected' : ''}>Better than player</option>
              <option value="worse" ${adjustStyle === 'worse' ? 'selected' : ''}>Worse than player</option>
            </select>
          </label>
          <div class="coach-color-grid" role="radiogroup" aria-label="Play as">
            <label class="radio-card"><input type="radio" name="swal-coach-color" value="w" ${color === 'w' ? 'checked' : ''}><span>White</span></label>
            <label class="radio-card"><input type="radio" name="swal-coach-color" value="b" ${color === 'b' ? 'checked' : ''}><span>Black</span></label>
            <label class="radio-card"><input type="radio" name="swal-coach-color" value="random" ${color === 'random' ? 'checked' : ''}><span>Random</span></label>
          </div>
        </div>`,
      showCancelButton: true,
      cancelButtonText: 'Cancel',
      confirmButtonText: 'Start Coach',
      didOpen: () => {
        const root = window.Swal?.getHtmlContainer?.();
        const adjustToggle = root?.querySelector('#swal-coach-ai-adjust');
        const adjustStyleSelect = root?.querySelector('#swal-coach-adjust-style');
        adjustToggle?.addEventListener('change', () => {
          if (adjustStyleSelect) adjustStyleSelect.disabled = !adjustToggle.checked;
        });
      },
      preConfirm: () => {
        const root = window.Swal.getHtmlContainer();
        const rawElo = parseInt(root.querySelector('#swal-coach-elo')?.value || '1200', 10);
        const eloValue = clamp(Number.isFinite(rawElo) ? rawElo : 1200, 100, 2800);
        const colorChoice = root.querySelector('input[name="swal-coach-color"]:checked')?.value || 'w';
        const humanColor = colorChoice === 'random'
          ? (Math.random() < 0.5 ? 'w' : 'b')
          : colorChoice;
        return {
          elo: eloValue,
          humanColor,
          aiAdjust: root.querySelector('#swal-coach-ai-adjust')?.checked !== false,
          adjustStyle: root.querySelector('#swal-coach-adjust-style')?.value === 'worse' ? 'worse' : 'better',
        };
      },
    });
    if (!result.isConfirmed || !result.value) return;
    this._enterCoachMode(result.value);
  }

		  _clearReviewExtras() {
		    if (this.elReviewSummary) this.elReviewSummary.classList.remove('review-skeleton');
		    if (this.elReviewNarrative) this.elReviewNarrative.innerHTML = '';
		    if (this.elTrainingList) this.elTrainingList.innerHTML = '';
		    if (this.elOpeningDrift) this.elOpeningDrift.innerHTML = '';
		    if (this.elPatternList) this.elPatternList.innerHTML = '';
		    if (this.elPhaseBreakdown) this.elPhaseBreakdown.innerHTML = '';
		  }

  _hideCoachSetupModal() {
    if (window.Swal?.isVisible?.()) window.Swal.close();
  }

  _readCoachSetup() {
    const rawElo = parseInt(this.elCoachSetupElo?.value || '1200', 10);
    const elo = clamp(Number.isFinite(rawElo) ? rawElo : 1200, 100, 2800);
    const colorChoice = this.elCoachSetupModal?.querySelector('input[name="coach-setup-color"]:checked')?.value || 'w';
    const humanColor = colorChoice === 'random'
      ? (Math.random() < 0.5 ? 'w' : 'b')
      : colorChoice;
	    return {
	      elo,
	      humanColor,
	      aiAdjust: this.elCoachSetupAiAdjust?.checked !== false,
	      adjustStyle: this.elCoachSetupAdjustStyle?.value === 'worse' ? 'worse' : 'better',
	    };
	  }

	  _startCoachFromSetup() {
	    const setup = this._readCoachSetup();
	    this._hideCoachSetupModal();
	    this._enterCoachMode(setup);
	  }

				  async _enterPuzzleMode() {
				    document.body.classList.remove('menu-active');
				    document.body.dataset.mode = 'puzzle';
			    if (this.elLiveEval) this.elLiveEval.hidden = true;
	    if (this.coachMode.active) {
	      this.coachMode.active = false;
	      this.coachMode.thinking = false;
	      this._syncCoachControls();
	    }
		    this.puzzleMode.active = true;
		    this.anticheatMode.active = false;
			    this._syncPuzzleVisibility();
			    this._syncAnticheatVisibility();
			    this._syncBoostPageVisibility();
			    this._syncPuzzlePanel();

				    const rating = Math.round(Number(this.puzzleMode.rating) || 1500);
			    this._setPuzzleStatus(this.puzzleMode.current ? 'Continue the current puzzle.' : `Loading a ${rating}-rated puzzle...`, this.puzzleMode.current ? '' : 'loading');
		    this._syncActionButtons();
		    if (!this.puzzleMode.current) {
		      await this._loadNextPuzzle({ target: rating });
		    }
		  }

		  _refreshPuzzleForCurrentUser() {
		    if (!this.puzzleMode.active || this.puzzleMode.loading) return;
		    if (this.gameMoves.length > 0 || this.puzzleMode.solved || this.puzzleMode.failed) return;
		    const currentRating = Number(this.puzzleMode.current?.puzzle?.rating) || 0;
		    const target = Math.round(Number(this.puzzleMode.rating) || 1500);
		    if (!this.puzzleMode.current || Math.abs(currentRating - target) > 250) {
		      this._loadNextPuzzle({ target });
		    }
		  }

	  _puzzleDifficultyForRating() {
	    const selected = this.elPuzzleDifficulty?.value || 'auto';
	    if (selected !== 'auto') return selected;
	    const rating = Number(this.puzzleMode.rating) || 1500;
	    if (rating < 1000) return 'easiest';
	    if (rating < 1300) return 'easier';
	    if (rating < 1750) return 'normal';
	    if (rating < 2150) return 'harder';
	    return 'hardest';
	  }

	  async _fetchLichessJson(path, params = {}) {
	    const url = new URL(`https://lichess.org${path}`);
	    for (const [key, value] of Object.entries(params)) {
	      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
	    }
	    const response = await fetch(url.toString(), {
	      headers: { Accept: 'application/json' },
	      cache: 'no-store',
	    });
	    if (!response.ok) {
	      const text = await response.text().catch(() => '');
	      throw new Error(text || `Lichess returned ${response.status}`);
	    }
	    return response.json();
	  }

			  async _loadDailyPuzzle() {
			    await this._loadPuzzleFromSource(async () => {
					const response = await fetch('/api/puzzle?type=daily', {
			          headers: await this._authHeaders(),
		          cache: 'no-store',
		        });
		      const loaded = await response.json().catch(() => null);
		      if (!response.ok) {
		        const code = loaded?.code;
		        if (response.status === 503 && code === 'puzzle_db_missing') {
		          throw new Error('Puzzle chunks are not built on the server yet. Run npm run build:puzzles there.');
		        }
	        throw new Error(loaded?.error || `Puzzle API responded with ${response.status}`);
	      }
		      return loaded;
		    });
		  }

				  async _loadNextPuzzle(options = {}) {
				    const theme = this.elPuzzleTheme?.value || 'mix';
		    const target = Number(options.target) || Number(this.puzzleMode.rating) || 1500;
		    const difficulty = options.difficulty || this._puzzleDifficultyForRating();
		    const excludeId = options.excludeId || this.puzzleMode.current?.puzzle?.id || '';
		    await this._loadPuzzleFromSource(async () => {
		        const params = new URLSearchParams({
	          type: 'next',
	          theme,
	          difficulty,
	          target,
	          exclude: excludeId,
	          nonce: String(Date.now()),
	        });
				const response = await fetch(`/api/puzzle?${params}`, {
		          headers: await this._authHeaders(),
		          cache: 'no-store',
		        });
		      const loaded = await response.json().catch(() => null);
		      if (!response.ok) {
		        const code = loaded?.code;
		        if (response.status === 503 && code === 'puzzle_db_missing') {
		          throw new Error('Puzzle chunks are not built on the server yet. Run npm run build:puzzles there.');
		        }
	        throw new Error(loaded?.error || `Puzzle API responded with ${response.status}`);
	      }
		      if (loaded?.data?.puzzle?.id === excludeId) throw new Error('That puzzle was already on the board. Try again.');
		      return loaded;
		    }, { target });
		  }

	  async _loadPuzzleFromSource(loader, options = {}) {
	    const token = ++this.puzzleMode.requestToken;
	    this.puzzleMode.loading = true;
	    this._setPuzzleStatus('Loading puzzle...', 'loading');
	    this._syncPuzzlePanel();
	    this.board.setLoading(null, 'Loading puzzle');
	    try {
	      const loaded = await loader();
	      if (token !== this.puzzleMode.requestToken) return;
	      this._setupPuzzle(loaded.data, loaded.source, options);
	    } catch (err) {
	      console.error('Puzzle load failed:', err);
	      if (token !== this.puzzleMode.requestToken) return;
	      const message = String(err.message || '');
	      const friendly = message.toLowerCase().includes('too many requests') || message.toLowerCase().includes('busy')
	        ? 'Puzzle servers are busy. Wait a few seconds and try again.'
	        : message;
	      this._setPuzzleStatus(`Could not load a puzzle: ${friendly}`, 'error');
	    } finally {
	      if (token === this.puzzleMode.requestToken) {
	        this.puzzleMode.loading = false;
	        this.board.clearLoading();
	        this._syncPuzzlePanel();
	        this._syncActionButtons();
	      }
	    }
	  }

	  _setupPuzzle(data, source = 'Lichess puzzle', options = {}) {
	    const setup = this._puzzleSetupFromLichess(data);
	    const puzzle = data?.puzzle || {};
	    this.puzzleMode = {
	      ...this.puzzleMode,
	      active: true,
	      loading: false,
	      current: data,
	      source,
	      initialFen: setup.fen,
	      solution: Array.isArray(puzzle.solution) ? puzzle.solution.slice() : [],
	      step: 0,
		      solved: false,
      failed: false,
      hintLevel: 0,
      hintUsed: false,
      lastDelta: 0,
		    };

	    this.originalGameMoves = [];
	    this.gameMoves = [];
	    this.currentMoveIndex = -1;
	    this.explorerReturnState = null;
	    this.analysisResults = null;
	    this.liveMoveResults = [];
	    this.liveEvalHistory = [];
	    this.liveEvalToken += 1;
	    this.initialFen = setup.fen;
	    this.gameHeaders = {
	      Event: 'Lichess Puzzle',
	      Site: puzzle.id ? `https://lichess.org/training/${puzzle.id}` : 'https://lichess.org/training',
	      White: setup.whiteName,
	      Black: setup.blackName,
	      WhiteElo: setup.whiteRating,
	      BlackElo: setup.blackRating,
	      FEN: setup.fen,
	      PuzzleId: puzzle.id || '',
	      PuzzleRating: puzzle.rating ? String(puzzle.rating) : '',
	    };
	    this.chess = new Chess(setup.fen);
	    this.board.setChessInstance(this.chess);
	    this.board.selectedSquare = null;
	    this.board.legalMoves = [];
	    this.board.clearBestMoveArrow();
	    this.board.setHighlights([]);
	    this.elReviewSummary.style.display = 'none';
	    this.elMoveBadge.style.display = 'none';
	    this.elCriticalMoments.style.display = 'none';
	    this.elCriticalList.innerHTML = '';
	    this._clearReviewExtras();
	    this._resetInsightPanel();
	    this._setBoardOrientationForColor(this.chess.turn());
	    this._updateBoard();
	    this._renderMoveList();
	    this._updateCurrentMoveIndicator();
	    this._updateEvalBar(0);
		    this._drawEvalGraph();
		    this._updateGameStatus();
		    this._renderIdleEngineInfo('Puzzle loaded. Solve it, then review the line.');
		    this._playNamedSound('start');
		    const targetText = options.target ? ` Target: ${Math.round(options.target)}.` : '';
		    this._setPuzzleStatus(`${this.chess.turn() === 'w' ? 'White' : 'Black'} to move. Puzzle rating ${puzzle.rating || 'unknown'}.${targetText}`);
	    this._syncPuzzlePanel();
	    this._syncActionButtons();
	  }

		  _puzzleSetupFromLichess(data) {
		    const puzzle = data?.puzzle || {};
		    const game = data?.game || {};
		    const players = Array.isArray(game.players) ? game.players : [];
		    const white = players.find((p) => p.color === 'white') || {};
		    const black = players.find((p) => p.color === 'black') || {};
		    const base = {
		      whiteName: white.name || 'White',
		      blackName: black.name || 'Black',
		      whiteRating: white.rating ? String(white.rating) : '',
		      blackRating: black.rating ? String(black.rating) : '',
		    };
		    const solution = Array.isArray(puzzle.solution) ? puzzle.solution : [];
		    if (puzzle.fen) {
		      const check = new Chess();
		      if (check.load(puzzle.fen) && this._puzzleLineLegalInFen(puzzle.fen, solution)) {
		        return {
		          fen: puzzle.fen,
		          ...base,
		        };
		      }
		    }

		    const moves = this._parseMoveText(game.pgn || '');
		    const requested = Number.isFinite(Number(puzzle.initialPly)) ? Number(puzzle.initialPly) : moves.length;
		    const candidates = [];
		    const addCandidate = (value) => {
		      const limit = Math.max(0, Math.min(Math.trunc(value), moves.length));
		      if (!candidates.includes(limit)) candidates.push(limit);
		    };
		    [requested, requested + 1, requested - 1, requested + 2, requested - 2, moves.length, moves.length - 1].forEach(addCandidate);
		    for (let limit = moves.length; limit >= 0; limit -= 1) addCandidate(limit);
		    for (const rawLimit of candidates) {
		      const limit = rawLimit;
		      const attempt = new Chess();
		      let parsed = true;
		      for (const san of moves.slice(0, limit)) {
		        if (!attempt.move(san, { sloppy: true })) {
		          parsed = false;
		          break;
		        }
		      }
		      if (!parsed) continue;
		      const fen = attempt.fen();
		      if (this._puzzleLineLegalInFen(fen, solution)) {
		        return { fen, ...base };
		      }
		    }
		    throw new Error('Lichess sent a puzzle line that does not match the board position.');
		  }

		  _puzzleLineLegalInFen(fen, solution = []) {
		    if (!Array.isArray(solution) || solution.length === 0) return false;
		    const chess = new Chess(fen);
		    for (const uciMove of solution) {
		      if (!uciMove || uciMove.length < 4) return false;
		      const move = chess.move({
		        from: uciMove.slice(0, 2),
		        to: uciMove.slice(2, 4),
		        promotion: uciMove[4],
		      });
		      if (!move) return false;
		    }
		    return true;
		  }

		  async _handlePuzzleMove(from, to) {
		    if (this.puzzleMode.loading || this.puzzleMode.solved || this.puzzleMode.failed || !this.puzzleMode.current) return;
		    const fenBefore = this.chess.fen();
		    const promotion = this._isPromotionMove(from, to) ? await this._requestPromotionPiece() : undefined;
		    const move = this.chess.move({ from, to, promotion }, { sloppy: true });
		    if (!move) {
		      this.board.setPositionFromFen(this.chess.fen());
		      return;
		    }
	
		    const moveUci = `${move.from}${move.to}${move.promotion || ''}`;
		    const expected = this.puzzleMode.solution[this.puzzleMode.step] || '';
		    const checkmateSolved = this.chess.in_checkmate();
		    const isExpected = moveUci === expected;
		    this.gameMoves.push(move.san);
		    this.currentMoveIndex = this.gameMoves.length - 1;
		    this.board.setChessInstance(this.chess);
		    this.board.selectedSquare = null;
		    this.board.legalMoves = [];
		    this._updateBoard();
		    this._updateCurrentMoveIndicator();
		    this._renderMoveList();
		    this._playMoveSound(move, this.currentMoveIndex);
		    this.board.clearBestMoveArrow();
	
		    const liveResultPromise = this._requestLiveEvaluation(`Analyzing ${move.san}`, {
		      fenBefore,
		      fenAfter: this.chess.fen(),
		      moveObj: move,
		      moveIndex: this.currentMoveIndex,
		    });
		    liveResultPromise.catch(() => {});
	
		    if (!isExpected && !checkmateSolved) {
		      this.puzzleMode.failed = true;
		      if (this.elLiveEval) this.elLiveEval.hidden = false;
		      this.board.setHighlights(this._moveHighlightsForSquares(move.from, move.to, {
		        color: '#F8D7D4',
		        ringColor: '#CA3431',
		      }));
		      await this._recordPuzzleAttempt(false);
		      this._setPuzzleStatus('Puzzle failed. Free analysis is now unlocked for this position.', 'error');
		      this._syncPuzzlePanel();
		      this._syncActionButtons();
		      this._updateGameStatus();
		      return;
		    }
	
		    this.puzzleMode.step += 1;
		    this.puzzleMode.hintLevel = 0;
		    this.board.setHighlights(this._moveHighlightsForSquares(move.from, move.to, {
		      color: '#DCEFD7',
		      ringColor: '#4f7d3c',
		    }));
	
				    if (checkmateSolved || this.puzzleMode.step >= this.puzzleMode.solution.length) {
				      this.puzzleMode.solved = true;
				      if (this.elLiveEval) this.elLiveEval.hidden = false;
				      const rated = !this.puzzleMode.failed ? await this._recordPuzzleAttempt(true) : false;
				      this._celebrate();
				      this._setPuzzleStatus(checkmateSolved && !isExpected
				        ? 'Solved by checkmate. Free analysis is now unlocked.'
				        : !rated && !this.puzzleMode.failed
			        ? 'Solved again. Rating is unchanged. Free analysis is now unlocked.'
			        : this.puzzleMode.failed
			        ? 'Solved in practice. Free analysis is now unlocked.'
			        : `Solved. Rating ${this.puzzleMode.lastDelta >= 0 ? '+' : ''}${this.puzzleMode.lastDelta}. Free analysis is now unlocked.`, 'success');
			      this._syncPuzzlePanel();
			      this._syncActionButtons();
			      this._updateGameStatus();
			      return;
		    }
	
		    this._syncActionButtons();
		    this._setPuzzleStatus('Correct. Let the opponent reply...');
		    window.setTimeout(() => this._playPuzzleReply(), 420);
		  }

				  async _playPuzzleReply() {
		    if (!this.puzzleMode.active || this.puzzleMode.solved) return;
	    const expected = this.puzzleMode.solution[this.puzzleMode.step];
	    if (!expected) return;
	    const fenBefore = this.chess.fen();
	    const move = this.chess.move({
	      from: expected.slice(0, 2),
	      to: expected.slice(2, 4),
	      promotion: expected[4],
	    });
	    if (!move) return;
	    this.gameMoves.push(move.san);
	    this.currentMoveIndex = this.gameMoves.length - 1;
	    this.puzzleMode.step += 1;
	    this.puzzleMode.hintLevel = 0;
	    this.board.setChessInstance(this.chess);
	    this._updateBoard();
	    this._updateCurrentMoveIndicator();
	    this._renderMoveList();
	    this.board.setHighlights(this._moveHighlightsForSquares(move.from, move.to, {
	      color: '#E6EEF7',
	      ringColor: '#346ea5',
	    }));
		    this._playMoveSound(move, this.currentMoveIndex);
			    if (this.puzzleMode.step >= this.puzzleMode.solution.length) {
			      this._setPuzzleStatus('The puzzle line ended after the automatic reply. Load a new puzzle to continue.', 'error');
		    } else {
	      this._setBoardOrientationForColor(this.chess.turn());
	      this._setPuzzleStatus(`${this.chess.turn() === 'w' ? 'White' : 'Black'} to move.`);
	    }
	    this._syncPuzzlePanel();
	    this._syncActionButtons();
	  }

	  _showPuzzleHint() {
	    if (!this.puzzleMode.active || this.puzzleMode.loading || this.puzzleMode.solved) return;
	    const expected = this.puzzleMode.solution[this.puzzleMode.step] || '';
	    if (expected.length < 4) return;

	    const from = expected.slice(0, 2);
	    const to = expected.slice(2, 4);
	    const hintLevel = Math.min((this.puzzleMode.hintLevel || 0) + 1, 3);
    this.puzzleMode.hintUsed = true;
    this.puzzleMode.rated = false;
	    this.puzzleMode.hintLevel = hintLevel;
	    this._setBoardOrientationForColor(this.chess.turn());
	    this.board.clearBestMoveArrow();

	    if (hintLevel === 1) {
	      this.board.setHighlights([{ square: from, type: 'best-from' }]);
	      this._setPuzzleStatus(`Hint: look at the piece on ${from}.`);
	      return;
	    }

	    if (hintLevel === 2) {
	      this.board.setHighlights([
	        { square: from, type: 'best-from' },
	        { square: to, type: 'best-to' },
	      ]);
	      this._setPuzzleStatus(`Hint: the idea lands on ${to}.`);
	      return;
	    }

	    this.board.setBestMoveArrow(expected, { color: '#96BC4B' });
	    this.board.setHighlights([
	      { square: from, type: 'best-from' },
	      { square: to, type: 'best-to' },
	    ]);
	    this._setPuzzleStatus(`Full hint: ${this.analyzer.uciToSan(this.chess.fen(), expected) || expected}.`);
	  }

		  async _recordPuzzleAttempt(won) {
    if (this.puzzleMode.hintUsed) {
      this.puzzleMode.lastDelta = 0;
      this._setPuzzleStatus(won ? 'Solved (unrated — hint used).' : 'Failed (unrated — hint used).', won ? 'success' : 'error');
      this._syncPuzzlePanel();
      return false;
    }
		    const puzzleId = this.puzzleMode.current?.puzzle?.id || '';
		    if (!this.puzzleMode.attemptedPuzzleIds) this.puzzleMode.attemptedPuzzleIds = new Set();
		    if (puzzleId && this.puzzleMode.attemptedPuzzleIds.has(puzzleId)) {
	      this.puzzleMode.lastDelta = 0;
	      this._rememberLocalPuzzleAttempt(puzzleId);
		      this._setPuzzleStatus('Puzzle already attempted. Rating is unchanged.');
		      return false;
		    }
		    const puzzleRating = Number(this.puzzleMode.current?.puzzle?.rating) || 1500;
		    const rating = Number(this.puzzleMode.rating) || 1500;
		    if (this.authState?.user) {
		      const result = await this._persistPuzzleStats(won, rating);
		      if (!result?.success || result.duplicate) {
		        this.puzzleMode.lastDelta = 0;
		        if (result?.duplicate && puzzleId) this.puzzleMode.attemptedPuzzleIds.add(puzzleId);
		        this._syncPuzzlePanel();
		        return false;
		      }
		      if (puzzleId) this.puzzleMode.attemptedPuzzleIds.add(puzzleId);
		      const ratingAfter = Math.max(100, Math.round(Number(result.ratingAfter) || rating));
		      this.puzzleMode.rating = ratingAfter;
		      this.puzzleMode.lastDelta = Number(result.delta) || 0;
		      if (result.stats) {
		        this.puzzleMode.solvedCount = Math.max(0, Number(result.stats.solved) || 0);
		        this.puzzleMode.attemptedCount = Math.max(0, Number(result.stats.attempted) || 0);
		        this.puzzleMode.streak = Math.max(0, Number(result.stats.streak) || 0);
		      }
		      if (won) this._recordPublicStatEvent('puzzle_solved');
		      this._animatePuzzleRatingChange(rating, ratingAfter, this.puzzleMode.lastDelta);
		      this._syncPuzzlePanel();
		      this._syncAccountUi();
		      return true;
		    }
		    if (puzzleId) {
		      this.puzzleMode.attemptedPuzzleIds.add(puzzleId);
		      this._rememberLocalPuzzleAttempt(puzzleId);
		    }
		    const expected = 1 / (1 + Math.pow(10, (puzzleRating - rating) / 400));
	    const delta = Math.round(24 * ((won ? 1 : 0) - expected));
	    this.puzzleMode.rating = Math.max(100, rating + delta);
	    this.puzzleMode.lastDelta = delta;
	    this.puzzleMode.attemptedCount += 1;
	    if (won) {
	      this.puzzleMode.solvedCount += 1;
	      this.puzzleMode.streak += 1;
	    } else {
	      this.puzzleMode.streak = 0;
	    }
			    this._saveLocalPuzzleProfile();
		    if (won) this._recordPublicStatEvent('puzzle_solved');
		    this._animatePuzzleRatingChange(rating, this.puzzleMode.rating, delta);
		    this._syncPuzzlePanel();
		    return true;
		  }

			  _animatePuzzleRatingChange(fromRating, toRating, delta = 0) {
		    const target = this.elPuzzleUserRating;
		    if (!target) return;
		    const start = Math.round(Number(fromRating) || 1500);
		    const end = Math.round(Number(toRating) || start);
		    const duration = 760;
		    const startedAt = performance.now();
		    target.classList.remove('rating-up', 'rating-down');
		    target.classList.add(delta >= 0 ? 'rating-up' : 'rating-down');
		    const tick = (now) => {
		      const t = clamp((now - startedAt) / duration, 0, 1);
		      const eased = 1 - Math.pow(1 - t, 3);
		      target.textContent = String(Math.round(start + ((end - start) * eased)));
		      if (t < 1) {
		        requestAnimationFrame(tick);
		        return;
		      }
		      target.textContent = String(end);
		      setTimeout(() => target.classList.remove('rating-up', 'rating-down'), 360);
		    };
			    requestAnimationFrame(tick);
			  }

			  _celebrate() {
			    if (typeof window.confetti !== 'function') return;
			    window.confetti({
			      particleCount: 120,
			      spread: 72,
			      origin: { y: 0.68 },
			      colors: ['#f7c631', '#0d8f8b', '#346ea5', '#b88d58', '#ffffff'],
			    });
			    window.setTimeout(() => {
			      window.confetti({
			        particleCount: 70,
			        angle: 60,
			        spread: 58,
			        origin: { x: 0, y: 0.72 },
			      });
			      window.confetti({
			        particleCount: 70,
			        angle: 120,
			        spread: 58,
			        origin: { x: 1, y: 0.72 },
			      });
			    }, 160);
			  }

		  async _persistPuzzleStats(won, ratingBefore = this.puzzleMode.rating) {
		    const user = this.authState.user;
		    if (!user) return null;
	    
	    try {
				const response = await fetch('/api/puzzle/solve', {
		        method: 'POST',
		        headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
	        cache: 'no-store',
			        body: JSON.stringify({
			          userId: user.uid,
			          won: !!won,
			          puzzleRating: Number(this.puzzleMode.current?.puzzle?.rating) || 1500,
			        }),
	      });
	      
	      if (!response.ok) {
	        const errorData = await response.json().catch(() => null);
	        throw new Error(errorData?.error || `Puzzle rating update failed with ${response.status}`);
	      }
	      const result = await response.json();
	      if (result.ratingAfter !== undefined) {
	        this.authState.profile = {
	          ...(this.authState.profile || {}),
	          puzzleRating: result.ratingAfter,
	          puzzleStats: result.stats,
	        };
	      }
	      this._syncAccountUi();
	      return result;
		    } catch (err) {
		      console.error('Error persisting puzzle stats:', err);
		      this._setPuzzleStatus(err.message || 'Could not update puzzle rating.', 'error');
		      return null;
		    }
	  }

	  _retryCurrentPuzzle() {
	    const puzzleId = this.puzzleMode.current?.puzzle?.id || '';
    if (!this.puzzleMode.current) {
      this._setPuzzleStatus('No puzzle loaded to retry.', 'error');
      return;
    }
    if (this.puzzleMode.solved) {
      this._setPuzzleStatus('This puzzle is already solved. Load a new puzzle instead.', 'error');
      return;
    }
    if (!this.puzzleMode.failed && puzzleId && this.puzzleMode.attemptedPuzzleIds?.has(puzzleId)) {
      this._setPuzzleStatus('This puzzle was already attempted. Load a new puzzle instead.', 'error');
      return;
    }
    this._setupPuzzle(this.puzzleMode.current, this.puzzleMode.source || 'Puzzle');
  }

	  _playerLabel(color) {
	    const headers = this.gameHeaders || {};
	    const name = color === 'w' ? (headers.White || 'White') : (headers.Black || 'Black');
	    const elo = color === 'w' ? headers.WhiteElo : headers.BlackElo;
	    return name + (elo ? ` (${elo})` : '');
	  }

	  _playerColorFromHeaders(headers = this.gameHeaders || {}) {
	    const white = String(headers.White || '').trim().toLowerCase();
	    const black = String(headers.Black || '').trim().toLowerCase();
	    if (black === 'you' || black === 'player') return 'b';
	    if (white === 'you' || white === 'player') return 'w';
	    return null;
	  }

	  _syncPlayerNameplates() {
	    if (!this.elPlayerTop || !this.elPlayerBottom) return;
    const topColor = this.board.flipped ? 'w' : 'b';
    const bottomColor = this.board.flipped ? 'b' : 'w';
    this.elPlayerTop.dataset.color = topColor;
    this.elPlayerBottom.dataset.color = bottomColor;
	    this.elPlayerTop.querySelector('.player-name').textContent = this._playerLabel(topColor);
	    this.elPlayerBottom.querySelector('.player-name').textContent = this._playerLabel(bottomColor);
	  }

	  _currentMoveLabel(index = this.currentMoveIndex) {
	    if (index < 0 || !this.gameMoves[index]) return 'Start';
	    const moveNum = Math.floor(index / 2) + 1;
	    const prefix = index % 2 === 0 ? `${moveNum}.` : `${moveNum}...`;
	    return `${prefix} ${this.gameMoves[index]}`;
	  }

	  _updateCurrentMoveIndicator(index = this.currentMoveIndex) {
	    if (!this.elCurrentMoveIndicator) return;
	    this.elCurrentMoveIndicator.textContent = `Current: ${this._currentMoveLabel(index)}`;
	    this.elCurrentMoveIndicator.title = this._currentMoveLabel(index);
	  }

  _focusCoach() {
    if (!this.coachMode.active) {
      this._startCoachGame();
      return;
    }
    this.elCoachCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.elCoachCard?.classList.add('coach-focus');
    setTimeout(() => this.elCoachCard?.classList.remove('coach-focus'), 800);
  }

  _setCoachDialog(message, state = null) {
    if (this.elCoachDialog) this.elCoachDialog.textContent = message;
    if (this.elCoachState && state) this.elCoachState.textContent = state;
  }

  _syncCoachControls() {
    this._syncCoachVisibility();
    if (this.elBtnCoachStart) {
      this._setButtonLabel(this.elBtnCoachStart, this.coachMode.active ? 'Stop Coach' : 'Start Coach');
    }
    if (this.elBtnCoachTakeback) {
      this.elBtnCoachTakeback.disabled = !this.coachMode.active || this.gameMoves.length === 0 || this.coachMode.thinking;
    }
    if (this.elBtnCoachHint) {
      this.elBtnCoachHint.disabled = !this.coachMode.active
        || !this.engine?.ready
        || this.coachMode.thinking
        || this.chess.game_over()
        || !this._isCoachHumanTurn();
    }
  }

  _resetCoachHint() {
    this.coachMode.hintLevel = 0;
    this.coachMode.hintFen = '';
    this.coachMode.hintMove = '';
  }

  _toggleCoachMode() {
    if (this.coachMode.active) {
      this.coachMode.active = false;
      this.coachMode.thinking = false;
      this.board.clearBestMoveArrow();
      this._setCoachDialog('Coach paused. I shall wait here.', 'Paused');
      this._syncCoachControls();
      return;
    }
    this._startCoachGame();
  }

  async _startCoachGame(options = {}) {
	    if (!this.engine?.ready || this.isAnalyzing) return;
	    const humanColor = options.humanColor || this.elCoachColor?.value || 'w';
	    const elo = clamp(parseInt(options.elo ?? this.elCoachElo?.value ?? '1200', 10) || 1200, 100, 2800);
	    const aiAdjust = options.aiAdjust ?? this.coachMode.aiAdjust ?? true;
	    const adjustStyle = options.adjustStyle || this.coachMode.adjustStyle || 'better';
	    const adjustedElo = aiAdjust ? this._coachAdjustedBaseline(elo, adjustStyle) : elo;
	    const skill = this._coachSkillFromElo(adjustedElo);
    if (this.elCoachColor) this.elCoachColor.value = humanColor;
    if (this.elCoachElo) this.elCoachElo.value = String(elo);
    if (this.elCoachSkill) this.elCoachSkill.value = skill;

		    this.coachMode = {
	      active: true,
      humanColor,
	      elo,
	      skill,
	      aiAdjust,
	      adjustStyle,
		      adjustedElo,
	      adjustment: 0,
	      performanceEma: 0,
	      mistakeRateEma: 0,
		      thinking: false,
		      gameOverCelebrated: false,
	      lastAdviceMoveIndex: null,
	      hintLevel: 0,
	      hintFen: '',
		      hintMove: '',
			    };
			    this._recordPublicStatEvent('coach_game_started');
				    this._loadGame([], {
	      Event: 'Coach',
	      White: humanColor === 'w' ? 'You' : 'Coach',
	      Black: humanColor === 'b' ? 'You' : 'Coach',
	      WhiteElo: humanColor === 'b' ? String(elo) : '',
	      BlackElo: humanColor === 'w' ? String(elo) : '',
	    });
	    this._setBoardOrientationForColor(humanColor);
	    this.coachMode.active = true;
	    const targetNote = aiAdjust
	      ? `AI Adjust ${adjustStyle === 'worse' ? 'below' : 'above'} your level`
	      : 'fixed strength';
	    this._setCoachDialog(`Coach set to ${this._effectiveCoachElo()} ELO (${targetNote}). Make your first move.`, 'Coaching');
    this._syncCoachVisibility();
    this._syncCoachControls();

    if (humanColor === 'b') {
      await this._makeCoachMove();
    }
  }

  _syncCoachVisibility() {
    if (!this.elCoachCard) return;
    this.elCoachCard.hidden = !this.coachMode.active;
  }

	  _classificationIconClass(classification, baseClass) {
	    const kind = classification?.iconType === 'material' ? 'material-symbols-outlined classification-google-icon' : 'classification-text-icon';
	    return `${baseClass} ${kind}`;
	  }

	  _hexToRgb(hex) {
	    const clean = String(hex || '').replace('#', '').trim();
	    if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
	    return {
	      r: parseInt(clean.slice(0, 2), 16),
	      g: parseInt(clean.slice(2, 4), 16),
	      b: parseInt(clean.slice(4, 6), 16),
	    };
	  }

	  _mixColor(hex, target = '#ffffff', amount = 0.72) {
	    const from = this._hexToRgb(hex);
	    const to = this._hexToRgb(target);
	    if (!from || !to) return hex || '';
	    const mix = (a, b) => Math.round(a + (b - a) * amount);
	    return `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`;
	  }

		  _moveHighlightsForSquares(from, to, options = {}) {
		    if (!from || !to) return [];
		    const ringColor = options.ringColor || '#2F6F9F';
		    const color = options.color || this._mixColor(ringColor, '#ffffff', 0.72);
		    return [
		      { square: from, type: options.type || 'highlight', color, ringColor },
		      { square: to, type: options.type || 'highlight', color, ringColor },
		    ];
		  }

		  _isCoachGame() {
		    return String(this.gameHeaders?.Event || '').toLowerCase() === 'coach';
		  }

		  _coachHumanColorFromHeaders(headers = this.gameHeaders || {}) {
		    if (String(headers.White || '').trim().toLowerCase() === 'you') return 'w';
		    if (String(headers.Black || '').trim().toLowerCase() === 'you') return 'b';
		    return this.coachMode?.humanColor || null;
		  }

		  _isCoachMoveIndex(index) {
		    if (index < 0 || !this._isCoachGame()) return false;
		    const humanColor = this._coachHumanColorFromHeaders();
		    if (!humanColor) return false;
		    const movingColor = index % 2 === 0 ? 'w' : 'b';
		    return movingColor !== humanColor;
		  }

		  _moveHighlightsForResult(result, index = result?.moveIndex) {
		    if (!result || !result.moveUci || result.moveUci.length < 4) return [];
		    const isCoachMove = result.isCoachMove || this._isCoachMoveIndex(index);
		    if (isCoachMove) {
		      return this._moveHighlightsForSquares(result.moveUci.substring(0, 2), result.moveUci.substring(2, 4), {
		        color: '#D9ECFF',
		        ringColor: '#2F6F9F',
		      });
		    }
		    return this._moveHighlightsForSquares(result.moveUci.substring(0, 2), result.moveUci.substring(2, 4), {
		      color: this._mixColor(result.classification?.color, '#ffffff', 0.72),
		      ringColor: result.classification?.color,
		    });
		  }

	  _setBoardOrientationForColor(color) {
	    const shouldFlip = color === 'b';
	    if (this.board.flipped !== shouldFlip) {
	      this.board.flip();
	    } else {
	      this._syncPlayerNameplates();
	    }
	  }

  _isCoachHumanTurn() {
    if (!this.coachMode.active) return true;
    return this.chess.turn() === this.coachMode.humanColor && !this.coachMode.thinking;
  }

	  _coachSkillFromElo(elo) {
	    if (elo < 900) return 'beginner';
	    if (elo < 1600) return 'intermediate';
	    if (elo < 2200) return 'advanced';
	    return 'expert';
	  }

		  _coachAdjustedBaseline(elo, adjustStyle = 'better') {
		    if (elo <= 150) return elo;
		    const offset = adjustStyle === 'worse' ? -350 : 125;
		    return clamp(elo + offset, 100, 2800);
		  }

			  _effectiveCoachElo() {
			    if (!this.coachMode.aiAdjust) return this.coachMode.elo;
			    const baseElo = this.coachMode.elo || 1200;
			    if (baseElo <= 150) return baseElo;
			    const style = this.coachMode.adjustStyle || 'better';
		    const adjusted = this.coachMode.adjustedElo || this._coachAdjustedBaseline(baseElo, style);
		    if (style === 'worse') {
			      return clamp(Math.min(adjusted, baseElo - 160), 100, 2800);
			    }
			    return clamp(Math.max(adjusted, baseElo + 60), 100, 2800);
			  }

	  _adjustCoachSkillFromResult(result) {
	    if (!this.coachMode.aiAdjust || !result?.classificationKey) return '';
	    const quality = {
	      BRILLIANT: 1.8,
	      GREAT: 1.45,
	      BEST: 1.2,
	      EXCELLENT: 0.85,
	      GOOD: 0.35,
	      BOOK: 0.25,
	      FORCED: 0.2,
	      INACCURACY: -0.45,
	      MISTAKE: -0.95,
	      MISS: -1.05,
	      BLUNDER: -1.3,
	    }[result.classificationKey] ?? 0;
	    const mistake = ['INACCURACY', 'MISTAKE', 'MISS', 'BLUNDER'].includes(result.classificationKey) ? 1 : 0;
	    const previousPerformance = this.coachMode.performanceEma || 0;
	    const previousMistakes = this.coachMode.mistakeRateEma || 0;
	    this.coachMode.performanceEma = previousPerformance * 0.82 + quality * 0.18;
	    this.coachMode.mistakeRateEma = previousMistakes * 0.86 + mistake * 0.14;
	    this.coachMode.adjustment = clamp(this.coachMode.performanceEma, -4, 4);

		    const targetPlayerElo = clamp(
		      this.coachMode.elo + (this.coachMode.performanceEma * 110) - (this.coachMode.mistakeRateEma * 80),
		      100,
		      2800
		    );
			    const style = this.coachMode.adjustStyle || 'better';
			    const offset = style === 'worse' ? -350 : 125;
			    const lowerBound = style === 'worse' ? 100 : (this.coachMode.elo || 1200) + 60;
			    const upperBound = style === 'worse' ? Math.max(100, (this.coachMode.elo || 1200) - 160) : 2800;
			    const targetCoachElo = clamp(targetPlayerElo + offset, lowerBound, upperBound);
			    const current = this.coachMode.adjustedElo || this._coachAdjustedBaseline(this.coachMode.elo || 1200, style);
			    this.coachMode.adjustedElo = clamp(Math.round(current * 0.85 + targetCoachElo * 0.15), 100, 2800);
	    this.coachMode.skill = this._coachSkillFromElo(this._effectiveCoachElo());
	    if (this.elCoachSkill) this.elCoachSkill.value = this.coachMode.skill;
	    return '';
	  }

		  _coachDepth() {
		    const effectiveElo = this._effectiveCoachElo();
		    const eloDepth = effectiveElo < 250 ? 1
		      : effectiveElo < 500 ? 2
		        : effectiveElo < 800 ? 3
		      : effectiveElo < 1000 ? 4
		        : effectiveElo < 1300 ? 5
		          : effectiveElo < 1600 ? 7
	            : effectiveElo < 1900 ? 9
	              : effectiveElo < 2200 ? 11
	                : effectiveElo < 2500 ? 13
	                  : 15;
	    return eloDepth;
	  }

		  _coachMultiPvCount() {
		    const effectiveElo = this._effectiveCoachElo();
		    if (effectiveElo < 300) return 10;
		    if (effectiveElo < 600) return 8;
		    if (effectiveElo < 900) return 6;
		    if (effectiveElo < 1400) return 5;
		    if (effectiveElo < 1900) return 4;
		    return 3;
		  }

		  _moveObjToUci(move) {
		    return move ? `${move.from}${move.to}${move.promotion || ''}` : '';
		  }

		  _randomLegalCoachLine() {
		    const legal = this.chess.moves({ verbose: true });
		    if (!legal.length) return null;
		    const move = legal[Math.floor(Math.random() * legal.length)];
		    return { move: this._moveObjToUci(move), cp: 0, pvUci: '', pvSan: '', depth: 0 };
		  }

	  _lineDropForSide(best, candidate, isWhiteToMove) {
	    if (!best || !candidate) return 0;
	    return isWhiteToMove
	      ? Math.max(0, best.cp - candidate.cp)
	      : Math.max(0, candidate.cp - best.cp);
	  }

		  _chooseCoachLine(lines, isWhiteToMove) {
		    const ordered = this.analyzer._orderLinesForSide(lines, isWhiteToMove);
		    const effectiveElo = this._effectiveCoachElo();
		    const legalFallback = () => this._randomLegalCoachLine() || ordered[0];
		    if (effectiveElo <= 150 && Math.random() < 0.82) return legalFallback();
		    if (effectiveElo < 350 && Math.random() < 0.58) return legalFallback();
		    if (ordered.length <= 1) return ordered[0] || legalFallback();
	
			    const previousHumanResult = this.liveMoveResults?.[this.currentMoveIndex];
			    const previousKey = previousHumanResult?.classificationKey || '';
			    const bestGap = this._lineDropForSide(ordered[0], ordered[1], isWhiteToMove);
			    const punishableMistake = ['BLUNDER', 'MISS', 'MISTAKE'].includes(previousKey) && bestGap >= 60;
			    const clearTactic = bestGap >= 170;
			    if (effectiveElo >= 1800 && (punishableMistake || clearTactic)) return ordered[0];
			    if (punishableMistake && Math.random() < clamp((effectiveElo - 700) / 1600, 0.25, 0.82)) return ordered[0];
			    if (clearTactic && Math.random() < clamp((effectiveElo - 900) / 1500, 0.18, 0.86)) return ordered[0];
			    if (effectiveElo >= 2200) return ordered[0];
	
			    const mistakeStyle = clamp(this.coachMode.mistakeRateEma || 0, 0, 1);
			    const worseMode = this.coachMode.aiAdjust !== false && this.coachMode.adjustStyle === 'worse';
			    const baseElo = this.coachMode.elo || effectiveElo;
			    const oneMoveBlunderChance = worseMode
			      ? clamp(0.1 + ((baseElo - effectiveElo) / 900) + ((baseElo - 1400) / 2200), 0.12, 0.52)
			      : 0;
			    if (oneMoveBlunderChance > 0 && Math.random() < oneMoveBlunderChance) {
			      return legalFallback();
			    }

			    const maxDrop = effectiveElo < 300 ? 900
			      : effectiveElo < 600 ? 520
			        : effectiveElo < 900 ? 300
			      : effectiveElo < 1300 ? 185
			        : effectiveElo < 1700 ? 125
			          : 60;
			    const styleDrop = maxDrop + Math.round(mistakeStyle * 55) + (worseMode ? 170 : 0);
			    const candidates = ordered
			      .slice(0, this._coachMultiPvCount())
			      .filter((line) => this._lineDropForSide(ordered[0], line, isWhiteToMove) <= styleDrop);
	
		    if (candidates.length <= 1) return ordered[0];
	
			    const bestChance = effectiveElo < 300 ? 0.05
			      : effectiveElo < 600 ? 0.12
			        : effectiveElo < 900 ? 0.24
			      : effectiveElo < 1300 ? 0.32
			        : effectiveElo < 1700 ? 0.56
			          : 0.86;
			    const adjustedBestChance = clamp(bestChance - mistakeStyle * 0.14 - (worseMode ? 0.18 : 0), 0.04, 0.92);
		    const roll = Math.random();
		    if (roll < adjustedBestChance) return candidates[0];
		    if (roll < adjustedBestChance + 0.35 && candidates[1]) return candidates[1];
		    return candidates[Math.min(candidates.length - 1, 2 + Math.floor(Math.random() * 2))] || candidates[2] || candidates[1] || candidates[0];
		  }

  async _makeCoachMove() {
    if (!this.coachMode.active || !this.engine?.ready || this.chess.game_over()) return;
    if (this.chess.turn() === this.coachMode.humanColor) return;

    this.coachMode.thinking = true;
    this.liveEvalToken += 1;
    this._syncCoachControls();
    this._setCoachDialog('I am thinking...', 'Thinking');
    this.board.setLoading(null, 'Coach thinking');

    try {
	      const fenBefore = this.chess.fen();
	      const depth = this._coachDepth();
	      const multi = await this.engine.evaluateMultiPV(fenBefore, depth, this._coachMultiPvCount());
      if (!this.coachMode.active || this.chess.fen() !== fenBefore) return;

      const isWhiteToMove = fenBefore.split(' ')[1] === 'w';
      const lines = (multi.lines || []).map((line) => {
        const pvTokens = (line.pv || '').split(/\s+/).filter(Boolean);
        return {
          move: pvTokens[0] || '',
          cp: this.analyzer.normalizeScore(line.score || 0, line.scoreType || 'cp', isWhiteToMove),
          pvUci: line.pv || '',
          pvSan: this.analyzer._lineToSan(fenBefore, line.pv || '', 6),
          depth: line.depth || depth,
        };
      }).filter((line) => line.move);

      const chosen = this._chooseCoachLine(lines, isWhiteToMove);
      if (!chosen?.move) return;

      const move = this.chess.move({
        from: chosen.move.slice(0, 2),
        to: chosen.move.slice(2, 4),
        promotion: chosen.move[4],
      });
      if (!move) return;

	      this.gameMoves.push(move.san);
	      this.currentMoveIndex = this.gameMoves.length - 1;
	      this._resetCoachHint();
	      this.board.setChessInstance(this.chess);
	      this._updateBoard();
	      this._updateCurrentMoveIndicator();
	      const previousHumanResult = this.liveMoveResults?.[this.currentMoveIndex - 1];
		      const feedbackHighlights = this._moveHighlightsForResult(previousHumanResult);
		      const coachMoveHighlights = this._moveHighlightsForSquares(move.from, move.to, {
		        color: '#D9ECFF',
		        ringColor: '#2F6F9F',
		      });
		      this.board.setHighlights([...feedbackHighlights, ...coachMoveHighlights]);
	      this._renderMoveList();
	      this._updateActiveMoveInList();
	      this._updateGameStatus();
	      this._saveGameState();
	      this._playMoveSound(move, this.currentMoveIndex);
	      this._requestLiveEvaluation(`Coach played ${move.san}`, {
	        fenBefore,
	        fenAfter: this.chess.fen(),
	        moveObj: move,
	        moveIndex: this.currentMoveIndex,
	        isCoachMove: true,
	      });
	      if (!this._checkCoachGameOver()) {
	        this._setCoachDialog(`I played ${move.san}. Your move.`, 'Coaching');
	      }
    } catch (err) {
      console.error('Coach move failed:', err);
      this._setCoachDialog('The coach could not find a move. Try again in a moment.', 'Waiting');
    } finally {
      this.coachMode.thinking = false;
      this.board.clearLoading();
      this._syncCoachControls();
    }
  }

	  async _handleCoachHumanMove(move, liveResultPromise) {
	    if (!this.coachMode.active) return;
	    const result = await liveResultPromise.catch(() => null);
	    if (!this.coachMode.active) return;
	
			    const key = result?.classificationKey || '';
			    const adjustNote = this._adjustCoachSkillFromResult(result);
			    if (key === 'BRILLIANT') this._recordBrilliantMove(result);
				    if (['BLUNDER', 'MISTAKE', 'MISS', 'INACCURACY'].includes(key)) {
				      const reply = result.opponentBestMoveSan || result.opponentBestMove || 'the tactic';
				      const queenNote = /queen/i.test(result.coachText || '') ? 'This leaves your queen vulnerable.' : 'This is the key moment.';
				      const replyNote = result.coachText?.includes(reply) ? '' : ` The coach response is ${reply}.`;
					      const feedback = `${queenNote} ${result.coachText || ''}${replyNote} Use Take Back if you want another try.${adjustNote}`;
					      this._setCoachDialog(feedback, key);
					      this._renderMoveInsights(result);
					      if (this.elInsightCoach) this.elInsightCoach.textContent = feedback;
			      if (result.opponentBestMove) this.board.setBestMoveArrow(result.opponentBestMove, { color: '#CA3431' });
			      this.coachMode.lastAdviceMoveIndex = result.moveIndex;
				    } else if (key === 'BRILLIANT') {
				      this._setCoachDialog(`${move.san}!! Brilliant. Best move, hard to find, and tactically precise.${adjustNote}`, 'Brilliant');
	    } else if (key) {
	      this._setCoachDialog(`${result.classification.name}: ${move.san}. Keep going.${adjustNote}`, 'Coaching');
	    }
	
		    if (!this._checkCoachGameOver()) {
		      setTimeout(() => this._makeCoachMove(), 700);
		    }
		  }

  _checkCoachGameOver() {
    if (!this.coachMode.active || !this.chess.game_over()) return false;

    let message = 'Game over.';
    const humanWon = this.chess.in_checkmate() && this.chess.turn() !== this.coachMode.humanColor;
    const coachWon = this.chess.in_checkmate() && this.chess.turn() === this.coachMode.humanColor;

	    if (humanWon) {
	      message = 'Checkmate. You beat the coach.';
	    } else if (coachWon) {
	      message = 'Checkmate. Coach wins this one.';
    } else if (this.chess.in_draw()) {
      message = 'Draw. Nice hold.';
    }

	    this._setCoachDialog(message, 'Game Over');
	    if (!this.coachMode.gameOverCelebrated) {
	      this.coachMode.gameOverCelebrated = true;
	      this._celebrate();
	    }
	    this._syncCoachControls();
	    return true;
  }

  async _handleCoachHint() {
    if (!this.coachMode.active || this.coachMode.thinking || !this.engine?.ready || !this._isCoachHumanTurn()) return;

    const fen = this.chess.fen();
    if (this.coachMode.hintFen !== fen || !this.coachMode.hintMove) {
      this._resetCoachHint();
      this.coachMode.hintFen = fen;
      this.coachMode.thinking = true;
      this._syncCoachControls();
      this._setCoachDialog('Finding a hint...', 'Hint');
      this.board.setLoading(null, 'Hint');

      try {
        const depth = Math.min(12, Math.max(8, this._coachDepth()));
        const multi = await this.engine.evaluateMultiPV(fen, depth, 3);
        if (!this.coachMode.active || this.chess.fen() !== fen) return;
        const isWhiteToMove = fen.split(' ')[1] === 'w';
        const lines = (multi.lines || []).map((line) => {
          const pvTokens = (line.pv || '').split(/\s+/).filter(Boolean);
          return {
            move: pvTokens[0] || '',
            cp: this.analyzer.normalizeScore(line.score || 0, line.scoreType || 'cp', isWhiteToMove),
          };
        }).filter((line) => line.move);
        const best = this.analyzer._orderLinesForSide(lines, isWhiteToMove)[0];
        if (!best?.move) {
          this._setCoachDialog('No hint is available in this position.', 'Hint');
          return;
        }
        this.coachMode.hintMove = best.move;
      } catch (err) {
        console.error('Coach hint failed:', err);
        this._setCoachDialog('Hint failed. Try again in a moment.', 'Hint');
        return;
      } finally {
        this.coachMode.thinking = false;
        this.board.clearLoading();
        this._syncCoachControls();
      }
    }

    const move = this.coachMode.hintMove;
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const baseHighlights = (this.board.highlights || []).filter((h) => h.type !== 'best-from' && h.type !== 'best-to');

    if (this.coachMode.hintLevel === 0) {
      this.board.setHighlights([...baseHighlights, { square: from, type: 'best-from' }]);
      this.board.clearBestMoveArrow();
      this.coachMode.hintLevel = 1;
      this._setCoachDialog('Hint: move this piece. Press Hint again for the full move.', 'Hint');
      return;
    }

    this.board.setHighlights([...baseHighlights, { square: from, type: 'best-from' }, { square: to, type: 'best-to' }]);
    this.board.setBestMoveArrow(move, { color: '#346ea5' });
    this.coachMode.hintLevel = 2;
    this._setCoachDialog('Hint: follow the arrow.', 'Hint');
  }

  _coachTakeback() {
    if (!this.coachMode.active || this.coachMode.thinking || this.gameMoves.length === 0) return;
    const undoCount = this.chess.turn() === this.coachMode.humanColor ? 2 : 1;
    for (let i = 0; i < undoCount; i += 1) {
      const undone = this.chess.undo();
      if (!undone) break;
      this.gameMoves.pop();
      this.liveMoveResults.pop();
    }

	    this.currentMoveIndex = this.gameMoves.length - 1;
	    this.board.setChessInstance(this.chess);
	    this._updateBoard();
	    this._updateCurrentMoveIndicator();
    this.board.setHighlights([]);
    this.board.clearBestMoveArrow();
    this.elMoveBadge.style.display = 'none';
    this._renderMoveList();
    this._updateActiveMoveInList();
    this._updateGameStatus();
    this._requestLiveEvaluation('Try the position again.');
    this._setCoachDialog('Good. Try that position again.', 'Coaching');
    this._syncActionButtons();
    this._syncCoachControls();
  }

	  _syncImportMode() {
	    if (!this.elImportSource || !this.elBtnImportUsername) return;
	    const isPgnMode = this.elImportSource.value === 'pgn';
    this.elBtnImportUsername.querySelector('.btn-label').textContent = isPgnMode ? 'Load PGN' : 'Load Username';
    this.elImportUsername.disabled = isPgnMode;
    this.elImportLimit.disabled = isPgnMode;
    this.elImportUsername.parentElement.style.opacity = isPgnMode ? '0.55' : '1';
	    this.elImportLimit.parentElement.style.opacity = isPgnMode ? '0.55' : '1';
	  }

	  _syncAnticheatForm() {
	    if (!this.elAnticheatSource) return;
	    const isPgn = this.elAnticheatSource.value === 'pgn';
	    if (this.elAnticheatUsername) this.elAnticheatUsername.disabled = isPgn;
	    if (this.elAnticheatLimit) this.elAnticheatLimit.disabled = isPgn;
	    if (this.elAnticheatPgn) this.elAnticheatPgn.style.display = isPgn ? 'block' : 'none';
	  }

	  _setAnticheatStatus(message, kind = '') {
	    if (!this.elAnticheatStatus) return;
	    this.elAnticheatStatus.textContent = message || '';
	    this.elAnticheatStatus.className = `anticheat-status ${kind}`.trim();
	  }

	  _setAnticheatChecking(checking) {
		if (!this.anticheatMode) {
			this.anticheatMode = {
				active: false,
				checking: false,
				statusTimer: null,
				results: null,
			};
		}
		this.anticheatMode.checking = !!checking;
	    if (this.elBtnAnticheatRun) this.elBtnAnticheatRun.disabled = !!checking;
	    if (checking) {
	      const startedAt = Date.now();
	      this.anticheatMode.statusTimer = setInterval(() => {
	        const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
	        this._setAnticheatStatus(`Server analysis running... ${elapsed}s elapsed. Do not close this tab.`, 'loading');
	      }, 1000);
	    } else if (this.anticheatMode.statusTimer) {
	      clearInterval(this.anticheatMode.statusTimer);
	      this.anticheatMode.statusTimer = null;
	    }
	  }

		  async _startAnticheatCheck() {
		    if (this.anticheatMode.checking) return;
		    if (!this.authState.user) {
		      this._setAnticheatStatus('Log in to run anticheat. Free accounts get 1 server run per day; Boost removes that limit.', 'error');
			    this._navigateTo(this.authState.user ? '/account' : '/signup');
		      return;
		    }
	    const source = this.elAnticheatSource?.value || 'pgn';
	    const username = (this.elAnticheatUsername?.value || '').trim();
	    const pgn = this.elAnticheatPgn?.value || '';
	    const limit = Math.max(1, Math.min(parseInt(this.elAnticheatLimit?.value || '10', 10) || 10, 15));
	    if (source === 'pgn' && !pgn.trim()) {
	      this._setAnticheatStatus('Paste a PGN first.', 'error');
	      return;
	    }
		    if (source !== 'pgn' && !username) {
		      this._setAnticheatStatus('Enter a username first.', 'error');
		      return;
		    }
		    await this._refreshUsageBeforeAction();
		    if (this._isOutOfUsage('anticheat')) {
		      const choice = await this._showUsageLimitPopup('anticheat');
		      if (choice !== 'boost') {
		        this._setAnticheatStatus('Server anticheat limit reached. Anticheat cannot run in the browser. Buy Boost or wait for the daily reset.', 'error');
		      }
		      return;
		    }

		    this._setAnticheatChecking(true);
	    this._setAnticheatStatus('Server analysis running... Do not close this tab.', 'loading');
	    if (this.elAnticheatResults) this.elAnticheatResults.innerHTML = '';
	    if (this.elAnticheatRiskPill) {
	      this.elAnticheatRiskPill.textContent = 'Checking';
	      this.elAnticheatRiskPill.className = 'anticheat-risk-pill watch';
	    }

			try {
				const payload = source === 'pgn'
				  ? { source: 'pgn', pgn, limit }
				  : { source, username, limit };
				const data = await this._runAnticheatOnServer(payload);
				this.anticheatMode.results = data;
				this._renderAnticheatResults(data);
				this._setAnticheatStatus(`Checked ${data.gamesAnalyzed || 0} game${data.gamesAnalyzed === 1 ? '' : 's'} on the server.`, 'success');
				this._refreshMe().catch(() => {});
			} catch (err) {
				console.error('Anticheat failed:', err);
				if ((err?.message || '').includes('Free plan includes 1 server anticheat run per day') || err?.code === 'quota_exceeded') {
				  this._setAnticheatStatus('Daily server anticheat limit reached. Anticheat cannot run in the browser. Buy Boost or try again tomorrow.', 'error');
				  return;
				}
				this._setAnticheatStatus(err.message || 'Anticheat check failed.', 'error');
				if (this.elAnticheatRiskPill) {
				this.elAnticheatRiskPill.textContent = 'Failed';
				this.elAnticheatRiskPill.className = 'anticheat-risk-pill high';
			}
		} finally {
			this._setAnticheatChecking(false);
		}
		  }

		  async _runAnticheatOnServer(payload) {
		    const controller = new AbortController();
		    const timeout = setTimeout(() => controller.abort(), 600000);
		    try {
		      const response = await fetch('/api/anticheat/stream', {
		        method: 'POST',
		        headers: await this._authHeaders({
		          'Content-Type': 'application/json',
		          Accept: 'text/event-stream',
		        }),
		        signal: controller.signal,
		        cache: 'no-store',
		        body: JSON.stringify(payload),
		      });
		      if (!response.ok || !response.body) {
		        const text = await response.text().catch(() => '');
		        throw new Error(text || `Anticheat stream failed with ${response.status}`);
		      }
		      return await this._readAnticheatStream(response);
		    } catch (err) {
		      if (err.name === 'AbortError') throw new Error('Anticheat check timed out.');
		      throw err;
		    } finally {
		      clearTimeout(timeout);
		    }
		  }

		  async _readAnticheatStream(response) {
		    const reader = response.body.getReader();
		    const decoder = new TextDecoder();
		    let buffer = '';
		    let finalData = null;

		    const handleEvent = (raw) => {
		      const lines = raw.split(/\r?\n/);
		      let event = 'message';
		      const dataLines = [];
		      for (const line of lines) {
		        if (line.startsWith('event:')) event = line.slice(6).trim();
		        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
		      }
		      if (!dataLines.length) return;
		      const data = JSON.parse(dataLines.join('\n'));
		      if (event === 'status') {
		        this._setAnticheatStatus(`Analyzing ${data.games || 0} game${data.games === 1 ? '' : 's'} on the server...`, 'loading');
		      } else if (event === 'progress') {
		        if (data.phase === 'positions') {
		          this._setAnticheatStatus(
		            `Game ${data.gameIndex}/${data.gameTotal}: position ${data.completed}/${data.total}`,
		            'loading',
		          );
		        } else {
		          this._setAnticheatStatus(data.message || `Analyzing game ${data.gameIndex}/${data.gameTotal}...`, 'loading');
		        }
		        if (this.elAnticheatRiskPill) {
		          this.elAnticheatRiskPill.textContent = 'Checking';
		          this.elAnticheatRiskPill.className = 'anticheat-risk-pill watch';
		        }
		      } else if (event === 'complete') {
		        finalData = data;
		      } else if (event === 'error') {
		        const error = new Error(data.error || 'Anticheat analysis failed.');
		        error.code = data.code;
		        throw error;
		      }
		    };

		    while (true) {
		      const { value, done } = await reader.read();
		      if (done) break;
		      buffer += decoder.decode(value, { stream: true });
		      const events = buffer.split(/\n\n/);
		      buffer = events.pop() || '';
		      for (const eventText of events) {
		        if (eventText.trim()) handleEvent(eventText);
		      }
		    }
		    buffer += decoder.decode();
		    if (buffer.trim()) handleEvent(buffer);
		    if (!finalData?.summary) throw new Error('Anticheat stream returned no results.');
		    return finalData;
		  }

		  async _runAnticheatInBrowser({ source, username, pgn, limit }) {
		    if (!this.engine?.ready) throw new Error('Daily server anticheat is used. Browser engine is still loading; try again when Stockfish is ready.');
		    let pgnGames = [];
		    if (source === 'pgn') {
		      pgnGames = this._splitPgnGames(pgn).slice(0, limit);
		    } else {
		      const games = await this._fetchRecentGamesViaServer(source, username, limit);
		      pgnGames = (games || []).map((game) => game.pgn).filter(Boolean).slice(0, limit);
		    }
		    if (!pgnGames.length) throw new Error('No games were available for browser anticheat.');

		    const allMetrics = [];
		    const aggregatedGames = [];
		    let skipped = 0;
		    const browserProfile = this._getReviewProfile();
		    this.analyzer.setReviewProfile(browserProfile);
		    for (let i = 0; i < pgnGames.length; i += 1) {
		      this._setAnticheatStatus(`Daily server anticheat is used. Browser checking game ${i + 1}/${pgnGames.length}...`, 'loading');
		      try {
		        const chess = new Chess();
		        const normalized = this._normalizePgnText(pgnGames[i]);
		        if (!chess.load_pgn(normalized, { sloppy: true })) throw new Error('Could not parse PGN.');
		        const headers = { ...this._readPgnHeaders(normalized), ...chess.header() };
		        const moves = chess.history();
		        const results = await this.analyzer.analyzeGame(moves, this.engine, null, { headers, initialFen: headers.FEN || headers.Fen || headers.fen, skipMateThreat: true });
		        const times = moveTimesFromPgn(normalized, moves.length, headers);
			        const targetSide = this._sideForUsername(headers, username);
		        const sides = targetSide ? [targetSide] : ['white', 'black'];
		        for (const side of sides) {
		          const metrics = sideMetrics(results, side, times, headers);
		          allMetrics.push(metrics);
		          const singleScore = scoreMetrics([metrics]);
		          aggregatedGames.push({
		            title: `${metrics.player} as ${side}`,
		            score: singleScore.score,
		            note: `Accuracy ${Math.round(metrics.accuracy)}%, ACPL ${Math.round(metrics.acpl)}, fast bests ${Math.round(metrics.fastBestRate)}%`,
		          });
		        }
		      } catch (err) {
		        skipped += 1;
		        console.warn('Browser anticheat skipped a game:', err);
		      }
		    }
		    if (!allMetrics.length) throw new Error('Browser anticheat could not analyze any standard games.');
		    return {
		      summary: scoreMetrics(allMetrics),
		      games: aggregatedGames,
		      gamesAnalyzed: pgnGames.length - skipped,
		      gamesSkipped: skipped,
		      subjectsAnalyzed: allMetrics.length,
		      profile: { source: 'browser', depth: browserProfile.depth, multiPv: browserProfile.multiPv },
		    };
		  }

	  _renderAnticheatResults(data) {
	    if (!this.elAnticheatResults || !data?.summary) return;
	    const summary = data.summary;
	    const riskClass = summary.riskLevel === 'High' ? 'high' : summary.riskLevel === 'Watch' ? 'watch' : 'low';
	    if (this.elAnticheatRiskPill) {
	      this.elAnticheatRiskPill.textContent = summary.riskLevel || 'Low';
	      this.elAnticheatRiskPill.className = `anticheat-risk-pill ${riskClass}`;
	    }
	    const games = Array.isArray(data.games) ? data.games : [];
	    const metric = (label, value) => `
	      <div class="anticheat-metric">
	        <span>${this._escapeHtml(label)}</span>
	        <strong>${this._escapeHtml(value)}</strong>
	      </div>
	    `;
	    const gameRows = games.slice(0, 12).map((game) => `
	      <div class="anticheat-game">
	        <div>
	          <strong>${this._escapeHtml(game.title || 'Game')}</strong>
	          <small>${this._escapeHtml(game.note || '')}</small>
	        </div>
	        <strong>${Math.round(game.score || 0)}</strong>
	      </div>
	    `).join('');
	    this.elAnticheatResults.innerHTML = `
	      <div class="anticheat-score-card">
	        <div class="anticheat-score">${Math.round(summary.score || 0)}</div>
	        <div class="anticheat-score-details">
	          <strong>${this._escapeHtml(summary.headline || 'Anticheat score')}</strong>
	          <span>${this._escapeHtml(summary.explanation || 'This is a heuristic review, not proof of cheating.')}</span>
	          <div class="anticheat-metrics">
	            ${metric('Games', summary.games || games.length)}
	            ${metric('Win rate', `${Math.round(summary.winRate || 0)}%`)}
	            ${metric('Accuracy', `${Math.round(summary.accuracy || 0)}%`)}
	            ${metric('Best moves', `${Math.round(summary.bestRate || 0)}%`)}
	            ${metric('ACPL', Math.round(summary.acpl || 0))}
	            ${metric('Mistakes', `${Math.round(summary.mistakeRate || 0)}%`)}
	            ${metric('Fast bests', `${Math.round(summary.fastBestRate || 0)}%`)}
	            ${metric('Fast criticals', `${Math.round(summary.fastCriticalRate || 0)}%`)}
	          </div>
	        </div>
	      </div>
	      <div class="anticheat-game-list">${gameRows}</div>
	    `;
	  }

  _loadPgn() {
    const pgn = this.elPgnInput.value.trim();
    if (!pgn) return;
    try {
      const games = this._splitPgnGames(pgn);
      if (games.length > 1) {
        const items = games.map((gameText, index) => {
          const game = this._gameSummaryFromPgn(gameText, {});
          return {
            pgn: gameText,
            headers: game,
            ...this._formatImportedGameLabel(game, 'pgn', index),
          };
        });
        this._setImportStatus(`Found ${items.length} games. Click one to load it.`, 'success');
        this._renderImportResults(this._sortImportedGamesByRecent(items));
        return;
      }
      this._loadPgnText(pgn);
      this._hidePgnModal();
	    } catch (err) {
	      this._showPopup({
	        icon: 'error',
	        title: 'Could not load PGN',
	        text: err.message,
	      });
	    }
	  }

  _loadPgnText(pgnText, headers = {}) {
    const chess = new Chess();
    const normalized = this._normalizePgnText(pgnText);
    const parsedHeaders = this._readPgnHeaders(normalized);
    let loaded = chess.load_pgn(normalized, { sloppy: true });

    if (!loaded) {
      const startFen = parsedHeaders.FEN || parsedHeaders.Fen || parsedHeaders.fen;
      if (startFen) chess.load(startFen);
      else chess.reset();

      const moves = this._parseMoveText(normalized);
      for (const move of moves) {
        if (!chess.move(move, { sloppy: true })) {
          throw new Error(`Could not parse PGN near move "${move}". Please check the format.`);
        }
      }
      loaded = moves.length > 0;
    }

    if (!loaded) {
      throw new Error('Could not parse PGN. Please check the format.');
    }

    this._loadGame(chess.history(), { ...parsedHeaders, ...chess.header(), ...headers });
  }

  _normalizePgnText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  }

  _readPgnHeaders(text) {
    const headers = {};
    const matches = String(text || '').matchAll(/^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$/gm);
    for (const match of matches) headers[match[1]] = match[2];
    return headers;
  }

  _parseMoveText(text) {
    let clean = this._normalizePgnText(text);
    clean = clean.replace(/^\s*\[[^\n]*\]\s*$/gm, ' ');
    clean = clean.replace(/\{[%a-zA-Z0-9_:-][^}]*\}/g, ' ');
    clean = clean.replace(/\{[^}]*\}/g, ' ');
    while (/\([^()]*\)/.test(clean)) clean = clean.replace(/\([^()]*\)/g, ' ');
    clean = clean.replace(/;[^\n]*/g, ' ');
    clean = clean.replace(/^%[^\n]*/gm, ' ');
    clean = clean.replace(/\$\d+/g, ' ');
    clean = clean.replace(/\d+\.(\.\.)?/g, ' ');
    clean = clean.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');
    clean = clean.replace(/[?!]+/g, '');
    return clean
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '...');
  }

  _splitPgnGames(text) {
    const normalized = this._normalizePgnText(text);
    if (!normalized) return [];
    const games = normalized
      .trim()
      .split(/\n\s*\n(?=\s*\[[A-Za-z0-9_]+\s+")/g)
      .map((gameText) => gameText.trim())
      .filter(Boolean);
    return games.length ? games : [normalized];
  }

  _gameSummaryFromPgn(pgnText, fallback = {}) {
    const chess = new Chess();
    const normalized = this._normalizePgnText(pgnText);
    if (!chess.load_pgn(normalized, { sloppy: true })) {
      return {
        ...fallback,
        ...this._readPgnHeaders(normalized),
        pgn: normalized,
      };
    }

    return {
      ...fallback,
      ...chess.header(),
      pgn: normalized,
      moves: chess.history(),
    };
  }

  _formatImportedGameLabel(game, source, index) {
    const white = game.White || game.white || 'White';
    const black = game.Black || game.black || 'Black';
    const result = game.Result || game.result || '*';
    const opening = game.Opening || game.opening || game.ECO || game.eco || '';
    const date = game.Date || game.date || (game.EndTime ? new Date(Number(game.EndTime) * 1000).toISOString().slice(0, 10).replace(/-/g, '.') : '');
    const timeClass = game.TimeClass ? game.TimeClass[0].toUpperCase() + game.TimeClass.slice(1) : '';
    const timeControl = game.TimeControl || '';
    const siteLabel = source === 'chesscom' ? 'Chess.com' : 'Lichess';
    const title = `${white} vs ${black}`;
    const metaBits = [date, timeClass || timeControl, result, opening].filter(Boolean);

    return {
      title,
      subtitle: metaBits.join(' • ') || `${siteLabel} game ${index + 1}`,
      siteLabel,
    };
  }

  _setImportStatus(message, kind = 'idle') {
    if (!this.elImportStatus) return;
    this.elImportStatus.textContent = message || '';
    this.elImportStatus.className = `import-status ${kind}`.trim();
  }

  _renderImportResults(items) {
    if (!this.elImportResults) return;
    this.elImportResults.innerHTML = '';

    if (!items || items.length === 0) {
      return;
    }

    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'import-result';
      button.innerHTML = `
        <span class="import-result-title">${item.title}</span>
        <span class="import-result-subtitle">${item.subtitle}</span>
      `;
      button.addEventListener('click', () => {
        try {
          this._loadPgnText(item.pgn, item.headers || {});
          this._hidePgnModal();
	        } catch (err) {
	          this._showPopup({
	            icon: 'error',
	            title: 'Could not load PGN',
	            text: err.message,
	          });
	        }
	      });
      this.elImportResults.appendChild(button);
    }
  }

  async _loadGamesByUsername() {
    const username = (this.elImportUsername?.value || '').trim();
    const source = this.elImportSource?.value || 'pgn';
    const limit = parseInt(this.elImportLimit?.value || '10', 10);

    if (source === 'pgn') {
      this._loadPgn();
      return;
    }

    if (!username) {
      this._setImportStatus('Enter a username first.', 'error');
      return;
    }

    this._setImportStatus(`Loading ${source === 'chesscom' ? 'Chess.com' : 'Lichess'} games...`, 'loading');
    this.elBtnImportUsername.disabled = true;
    this._renderImportResults([]);

    try {
      const games = source === 'chesscom'
        ? await this._fetchChessComGames(username, limit)
        : await this._fetchLichessGames(username, limit);

      if (!games.length) {
        this._setImportStatus('No recent games were found for that user.', 'error');
        return;
      }

      this._setImportStatus(`Showing the last ${games.length} games for ${username}. Click one to load it.`, 'success');
      this._renderImportResults(games);
    } catch (err) {
      console.error('Username import failed:', err);
      this._setImportStatus(err.message || 'Could not load games for that user.', 'error');
    } finally {
      this.elBtnImportUsername.disabled = false;
    }
  }

  async _fetchLichessGames(username, limit = 10) {
    const proxied = await this._fetchRecentGamesViaServer('lichess', username, limit);
    if (proxied) return proxied;

    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${limit}&moves=true&clocks=true&opening=true&finished=true&sort=dateDesc`;
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`Lichess responded with ${response.status}`);
    }

    const text = await response.text();
    const games = this._splitPgnGames(text).map((pgnText, index) => {
      const game = this._gameSummaryFromPgn(pgnText, {});
      const summary = this._formatImportedGameLabel(game, 'lichess', index);
      return {
        pgn: pgnText,
        headers: game,
        ...summary,
      };
    });

    return this._sortImportedGamesByRecent(games).slice(0, limit);
  }

  async _fetchChessComGames(username, limit = 10) {
    const proxied = await this._fetchRecentGamesViaServer('chesscom', username, limit);
    if (proxied) return proxied;

    const archiveUrl = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
    const archiveResponse = await fetch(archiveUrl, { mode: 'cors' });
    if (!archiveResponse.ok) {
      throw new Error(`Chess.com responded with ${archiveResponse.status}`);
    }

    const archiveData = await archiveResponse.json();
    const archives = Array.isArray(archiveData.archives) ? archiveData.archives.slice().reverse() : [];
    const games = [];
    const monthGameLimit = Math.max(limit, 20);

    for (const monthUrl of archives) {
      if (games.length >= monthGameLimit) break;

      const monthResponse = await fetch(monthUrl, { mode: 'cors' });
      if (!monthResponse.ok) continue;

      const monthData = await monthResponse.json();
      const monthGames = Array.isArray(monthData.games) ? monthData.games : [];

      for (const chessComGame of monthGames) {
        if (!chessComGame?.pgn) continue;
        const game = this._gameSummaryFromPgn(chessComGame.pgn, {
          TimeControl: chessComGame.time_control,
          TimeClass: chessComGame.time_class,
          Rated: chessComGame.rated,
          EndTime: chessComGame.end_time,
          Url: chessComGame.url,
        });
        const summary = this._formatImportedGameLabel(game, 'chesscom', games.length);
        games.push({
          pgn: chessComGame.pgn,
          headers: game,
          ...summary,
        });
      }
    }

    return this._sortImportedGamesByRecent(games).slice(0, limit);
  }

  async _fetchRecentGamesViaServer(source, username, limit) {
    try {
      const params = new URLSearchParams({ source, username, limit: String(limit) });
	const response = await fetch(`/api/recent-games?${params.toString()}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data.games)) return null;
      return this._sortImportedGamesByRecent(data.games.map((game, index) => ({
        ...game,
        headers: game.headers || game,
        ...this._formatImportedGameLabel(game.headers || game, source, index),
      }))).slice(0, limit);
    } catch (_err) {
      return null;
    }
  }

  _gameTimestamp(game) {
    const headers = game.headers || game || {};
    const numeric = Number(headers.EndTime || headers.end_time || headers.createdAt || headers.lastMoveAt || 0);
    if (numeric > 0) return numeric > 100000000000 ? numeric / 1000 : numeric;
    const date = headers.Date || headers.UTCDate || headers.date || '';
    const time = headers.UTCTime || headers.Time || headers.time || '00:00:00';
    const parsed = Date.parse(`${String(date).replace(/\./g, '-')}T${time}Z`);
    return Number.isFinite(parsed) ? parsed / 1000 : 0;
  }

  _sortImportedGamesByRecent(games) {
    return (games || []).slice().sort((a, b) => this._gameTimestamp(b) - this._gameTimestamp(a));
  }

	  _isPromotionMove(from, to) {
	    const piece = this.chess.get(from);
	    if (!piece || piece.type !== 'p') return undefined;
	    return (piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1');
	  }

	  _requestPromotionPiece() {
	    if (!this.elPromotionModal) return Promise.resolve('q');
	    this.elPromotionModal.style.display = 'flex';
	    this.elPromotionOptions?.querySelector('[data-piece="q"]')?.focus();
	    return new Promise((resolve) => {
	      this.pendingPromotionResolve = resolve;
	    });
	  }

	  _finishPromotionChoice(piece = 'q') {
	    const resolve = this.pendingPromotionResolve;
	    this.pendingPromotionResolve = null;
	    if (this.elPromotionModal) this.elPromotionModal.style.display = 'none';
	    if (resolve) resolve(['q', 'r', 'b', 'n'].includes(piece) ? piece : 'q');
	  }

			  async _handleBoardMove(from, to) {
			    if (this.isAnalyzing) return;
			    if (this.puzzleMode.active && !this.puzzleMode.solved && !this.puzzleMode.failed) {
			      await this._handlePuzzleMove(from, to);
			      return;
			    }
			    if (this.puzzleMode.active && (this.puzzleMode.solved || this.puzzleMode.failed) && this.elLiveEval) {
			      this.elLiveEval.hidden = false;
			    }
		    if (this.coachMode.active && !this._isCoachHumanTurn()) return;

	    const fenBefore = this.chess.fen();
	    const promotion = this._isPromotionMove(from, to) ? await this._requestPromotionPiece() : undefined;
	    const move = this.chess.move({ from, to, promotion }, { sloppy: true });
    if (!move) {
      this.board.setPositionFromFen(this.chess.fen());
      return;
    }

    if (this.currentMoveIndex < this.gameMoves.length - 1) {
      this.gameMoves = this.gameMoves.slice(0, this.currentMoveIndex + 1);
      this.liveMoveResults = this.liveMoveResults.slice(0, this.currentMoveIndex + 1);
    }

	    this.gameMoves.push(move.san);
	    this.currentMoveIndex = this.gameMoves.length - 1;
	    this._resetCoachHint();
	    this.board.setChessInstance(this.chess);
	    this._updateBoard();
	    this._updateCurrentMoveIndicator();
    this.board.setHighlights([{ square: move.from, type: 'highlight' }, { square: move.to, type: 'highlight' }]);
    this.board.clearBestMoveArrow();

    this._invalidateAnalysisResults({ skipBoardRefresh: true });
    this._renderMoveList();
    this._saveGameState();
    this._showOpeningInfo(this.analyzer.detectOpening(this.gameMoves));
    this._updateGameStatus();
    this._playMoveSound(move, this.currentMoveIndex);
    this._syncActionButtons();
    const liveResultPromise = this._requestLiveEvaluation(`Analyzing ${move.san}`, {
      fenBefore,
      fenAfter: this.chess.fen(),
      moveObj: move,
      moveIndex: this.currentMoveIndex,
    });
    if (this.coachMode.active) {
      this._handleCoachHumanMove(move, liveResultPromise);
    }
  }

  _buildLiveMoveResult({
    fenBefore,
    fenAfter,
    moveObj,
    moveIndex,
    scoreBefore,
    scoreAfter,
    lines,
    bestMove,
    bestMoveSan,
    opponentBestMove = '',
	    opponentBestMoveSan = '',
	    depth,
	    isCoachMove = false,
	  }) {
    const prevChess = new Chess(fenBefore);
    const nextChess = new Chess(fenAfter);
    const isWhitePlaying = fenBefore.split(' ')[1] === 'w';
    const playedUci = `${moveObj.from}${moveObj.to}${moveObj.promotion || ''}`;
    const movePly = moveIndex + 1;
    const numLegalMoves = prevChess.moves({ verbose: true }).length;
    const sacResult = this.analyzer.checkSacrifice(new Chess(fenBefore), moveObj.san);
    const scoreBeforeEdge = isWhitePlaying ? scoreBefore : -scoreBefore;
    const scoreAfterEdge = isWhitePlaying ? scoreAfter : -scoreAfter;
    const playerEdgeBefore = scoreBeforeEdge;
    const playerEdgeAfter = scoreAfterEdge;
    const cpLoss = this.analyzer._cpLoss(scoreBefore, scoreAfter, isWhitePlaying);
    const secondLine = lines.length > 1 ? lines[1] : null;
    const gapToSecond = this.analyzer._gapToSecond(
      lines[0] ? lines[0].cp : scoreBefore,
      secondLine ? secondLine.cp : null,
      isWhitePlaying
    );
	    const isCheckmate = nextChess.in_checkmate();
	    const isBestMove = playedUci === bestMove;
	    const opponentJustBlundered = moveIndex > 0 && ['BLUNDER', 'MISTAKE'].includes(this.liveMoveResults[moveIndex - 1]?.classificationKey);
	    const phase = this.analyzer._phaseFromFen(fenBefore, movePly);
	    const playerRating = this.coachMode.active
	      ? this.coachMode.elo
	      : this.analyzer._ratingForColor(this.gameHeaders, isWhitePlaying);
	    const timeControl = this.gameHeaders?.TimeControl || this.gameHeaders?.Time || '';
	    const expectedLoss = this.analyzer.expectedPointLoss(playerEdgeBefore, playerEdgeAfter, playerRating);
		    const classification = this.analyzer.classifyMove({
	      movePly,
	      moveSan: moveObj.san,
	      moveUci: playedUci,
	      fenBefore,
	      numLegalMoves,
	      isCheckmate,
      isPieceSacrifice: sacResult.isPieceSacrifice,
      playerEdgeBefore,
      playerEdgeAfter,
      cpLoss,
      isBestMove,
      gapToSecond,
	      scoreBefore,
	      scoreAfter,
		      phase,
		      playerRating,
		      timeControl,
		      opponentJustBlundered,
		    });

	    const alternatives = lines.slice(0, this._getReviewProfile().multiPv).map((line, idx) => ({
	      rank: idx + 1,
      moveUci: line.move,
      moveSan: this.analyzer.uciToSan(fenBefore, line.move),
      eval: line.cp,
      evalText: this.analyzer.formatScore(line.cp),
      pvSan: line.pvSan,
    }));
	
	    const classificationKey = this.analyzer.getClassificationKey(classification);
	    const mateThreat = this.analyzer._mateThreat(fenAfter);
	    const planTags = this.analyzer._planTags({
	      fenBefore,
	      fenAfter,
	      moveObj,
	      phase,
	      classificationKey,
	      playerEdgeBefore,
	      playerEdgeAfter,
	    });
	    const endgameNotes = this.analyzer._endgameNotes(fenBefore, fenAfter, moveObj, phase);
	    const result = {
      move: moveObj.san,
      moveSan: moveObj.san,
      moveUci: playedUci,
      moveIndex,
      moveNumber: Math.floor(moveIndex / 2) + 1,
      isWhite: isWhitePlaying,
      classification,
      classificationKey,
      evalBefore: scoreBefore,
      evalAfter: scoreAfter,
	      swing: scoreAfter - scoreBefore,
	      cpLoss,
	      expectedLoss,
	      playerRating,
	      playerEdgeBefore,
	      playerEdgeAfter,
	      bestMove,
      bestMoveSan,
      opponentBestMove,
      opponentBestMoveSan,
      bestMovePv: '',
      bestMovePvSan: '',
      alternatives,
      depth,
	      fen: fenBefore,
	      fenAfter,
	      phase,
	      planTags,
	      mateThreat,
	      endgameNotes,
	      isCriticalMoment: expectedLoss >= 0.08 || cpLoss >= 120 || classificationKey === 'MISS' || classificationKey === 'BLUNDER',
	      severityScore: (expectedLoss * 2.2) + (cpLoss / 150) + (classificationKey === 'BLUNDER' ? 1.2 : classificationKey === 'MISTAKE' ? 0.9 : 0.2),
	      opponentJustBlundered,
	      isCoachMove,
	      coachText: this.analyzer._coachingText({
	        classification,
	        cpLoss,
	        expectedLoss,
	        bestMoveSan,
        bestMove: bestMove,
        opponentBestMove,
        opponentBestMoveSan,
        moveUci: playedUci,
        moveSan: moveObj.san,
        movePly,
        scoreBefore,
	        scoreAfter,
	        isWhite: isWhitePlaying,
	        playerRating,
	        opponentJustBlundered,
	        fenBefore,
        fenAfter,
      }),
    };

    this.liveMoveResults[moveIndex] = result;
    return result;
  }

	  async _requestLiveEvaluation(message = 'Analyzing current position...', context = null) {
	    if (this.puzzleMode.active) {
	      this.board.clearBestMoveArrow();
	      this.board.clearLoading();
	      return;
	    }
	    if (!this.engine?.ready) {
      if (context?.isCoachMove) return;
      this.board.clearBestMoveArrow();
      this.board.clearLoading();
      this._updateLiveEvalPanel({
        busy: false,
        score: null,
        line: 'Engine is not ready yet.',
        meta: 'Live eval becomes available once the engine finishes loading.',
      });
      return;
    }

    const token = ++this.liveEvalToken;
    this.engine.interrupt?.();
	    const fen = this.chess.fen();
	    this.lastLiveEvalFen = fen;
	    const reviewProfile = this._getReviewProfile();
	    const depth = reviewProfile.depth;

    if (!context?.isCoachMove) {
      this._updateLiveEvalPanel({
        busy: true,
        score: null,
        line: message,
        meta: `Depth ${depth} | waiting for Stockfish...`,
      });
      this.board.setLoading(context?.moveObj?.to || null, context?.moveObj ? 'Analyzing move' : 'Analyzing');
    }

    try {
      if (context?.fenBefore && context?.moveObj) {
        const prevFen = context.fenBefore;
        const nextFen = context.fenAfter || fen;
        const prevChess = new Chess(prevFen);
        const nextChess = new Chess(nextFen);
        const isWhiteToMoveBefore = prevFen.split(' ')[1] === 'w';
        const multi = await this.engine.evaluateMultiPV(prevFen, depth, reviewProfile.multiPv);
        if (token !== this.liveEvalToken) return;

        const lines = (multi.lines || [])
          .map((line) => {
            const pvTokens = (line.pv || '').split(/\s+/).filter(Boolean);
            const move = pvTokens.length > 0 ? pvTokens[0] : '';
            return {
              cp: this.analyzer.normalizeScore(line.score || 0, line.scoreType || 'cp', isWhiteToMoveBefore),
              move,
              pvUci: line.pv || '',
              pvSan: this.analyzer._lineToSan(prevFen, line.pv || '', 8),
              depth: line.depth || 0,
            };
          })
          .filter((line) => !!line.move);

        const orderedLines = this.analyzer._orderLinesForSide(lines, isWhiteToMoveBefore);
        const best = orderedLines[0] || { cp: 0, move: '' };
        const bestMove = best.move || '';
        const bestMoveSan = bestMove ? this.analyzer.uciToSan(prevFen, bestMove) : '--';
        const bestScore = best.cp || 0;
        const nextEval = await this.engine.evaluate(nextFen, depth, Math.max(6000, reviewProfile.timeoutMs));
        if (token !== this.liveEvalToken) return;
        const scoreAfter = this.analyzer.normalizeScore(nextEval.score || 0, nextEval.scoreType || 'cp', nextFen.split(' ')[1] === 'w');
        const opponentBestMove = nextEval.bestMove || '';
	        const liveResult = this._buildLiveMoveResult({
	          fenBefore: prevFen,
	          fenAfter: nextFen,
	          moveObj: context.moveObj,
	          moveIndex: context.moveIndex ?? this.currentMoveIndex,
          scoreBefore: bestScore,
          scoreAfter,
          lines: orderedLines,
          bestMove,
          bestMoveSan,
	          opponentBestMove,
	          opponentBestMoveSan: opponentBestMove ? this.analyzer.uciToSan(nextFen, opponentBestMove) : '',
	          depth: nextEval.depth || depth,
	          isCoachMove: !!context.isCoachMove,
	        });
	
		        if (!liveResult.isCoachMove) {
		          this._applyBestMoveArrow(liveResult);
		          this.board.setHighlights(this._moveHighlightsForResult(liveResult));
		          this._showMoveBadge(liveResult.classification, context.moveObj.to);
		          this._renderMoveInsights(liveResult);
		          this._showEngineLine(liveResult);
	        }
	        this._updateEvalBar(scoreAfter);
        this.liveEvalHistory.push(scoreAfter);
        if (this.liveEvalHistory.length > 60) this.liveEvalHistory.shift();
        this._drawEvalGraph();
        if (!liveResult.isCoachMove) {
          this._updateLiveEvalPanel({
            busy: false,
            score: scoreAfter,
            line: `${liveResult.classification.name}: ${context.moveObj.san}`,
            meta: `Best: ${bestMoveSan || '--'} | Depth ${nextEval.depth || depth}`,
          });
          this.board.clearLoading();
        }
        this._renderMoveList();
        this._updateActiveMoveInList();
        this._updateGameStatus();
        return liveResult;
      }

      const result = await this.engine.evaluate(fen, depth, Math.max(6000, reviewProfile.timeoutMs));
      if (token !== this.liveEvalToken) return;

      const isWhiteToMove = fen.split(' ')[1] === 'w';
      const cp = this.analyzer.normalizeScore(result.score || 0, result.scoreType || 'cp', isWhiteToMove);
      const bestMoveSan = result.bestMove ? this.analyzer.uciToSan(fen, result.bestMove) : '--';

      this.board.clearBestMoveArrow();
      this.liveEvalHistory.push(cp);
      if (this.liveEvalHistory.length > 60) {
        this.liveEvalHistory.shift();
      }

      this._updateEvalBar(cp);
      this._drawEvalGraph();
      this._updateLiveEvalPanel({
        busy: false,
        score: cp,
        line: bestMoveSan && bestMoveSan !== '--'
          ? `Best move: ${bestMoveSan}`
          : 'Best move unavailable.',
        meta: result.depth ? `Depth ${result.depth}` : `Depth ${depth}`,
      });
      this.board.clearLoading();
      this._updateGameStatus();
      return result;
	    } catch (err) {
	      if (token !== this.liveEvalToken) return;
	      if (context?.isCoachMove) {
	        await this._recoverLiveEngineFailure(err, { silent: true });
	        return;
	      }
	      if (await this._recoverLiveEngineFailure(err)) {
	        return;
	      }
	      this.board.clearBestMoveArrow();
	      this.board.clearLoading();
      this._updateLiveEvalPanel({
        busy: false,
        score: null,
        line: 'Live eval failed for this position.',
        meta: err.message,
      });
    }
  }

  _resetGame() {
	    this.liveEvalToken += 1;
		    this.analysisResults = null;
		    this.explorerReturnState = null;
		    if (this.elReviewBtnText) this.elReviewBtnText.textContent = 'Start Review';
    this.liveMoveResults = [];
	    this.currentMoveIndex = -1;
	    this._resetCoachHint();
    this.gameMoves = this.originalGameMoves.slice();
    this.chess = new Chess(this.initialFen);
    this.board.setChessInstance(this.chess);
    this.board.selectedSquare = null;
    this.board.legalMoves = [];
    this.board.setHighlights([]);
    this.board.clearBestMoveArrow();

	    this.elReviewSummary.style.display = 'none';
	    this.elMoveBadge.style.display = 'none';
	    this.elCriticalMoments.style.display = 'none';
	    this.elCriticalList.innerHTML = '';
	    this._clearReviewExtras();
    this._resetInsightPanel();
    this._renderMoveList();
	    this._updateBoard();
	    this._updateCurrentMoveIndicator();
    this._syncPlayerNameplates();
    this._updateEvalBar(0);
    this.liveEvalHistory = [];
    this._drawEvalGraph();
    this._showOpeningInfo(this.analyzer.detectOpening(this.gameMoves));
    this._updateLiveEvalPanel({
      busy: false,
      score: null,
      line: 'Board reset to the original position.',
      meta: '',
    });
    this._updateGameStatus();
    this._renderIdleEngineInfo();
    this._syncActionButtons();
    this._requestLiveEvaluation('Analyzing original position...');
    this._playNamedSound('start');
  }

  _loadGame(moves, headers = {}) {
    const loadingCoachGame = headers.Event === 'Coach';
    if (!loadingCoachGame && this.coachMode.active) {
      this.coachMode.active = false;
      this.coachMode.thinking = false;
      this._setCoachDialog('Coach paused while this game is loaded.', 'Paused');
    }
    this._syncCoachVisibility();

	    this.originalGameMoves = moves.slice();
		    this.gameMoves = moves.slice();
		    this.currentMoveIndex = -1;
		    this.explorerReturnState = null;
	    this._resetCoachHint();
	    this.analysisResults = null;
	    if (this.elReviewBtnText) this.elReviewBtnText.textContent = 'Start Review';
    this.liveMoveResults = [];
    this.initialFen = headers.FEN || headers.Fen || headers.fen || new Chess().fen();
    this.chess = new Chess(this.initialFen);
    this.board.setChessInstance(this.chess);
    this.board.selectedSquare = null;
    this.board.legalMoves = [];
    this.board.clearBestMoveArrow();
	    this.gameHeaders = headers;
	    this.liveEvalHistory = [];
	    this.liveEvalToken += 1;
	
	    const playerColor = this._playerColorFromHeaders(headers);
	    if (playerColor) this._setBoardOrientationForColor(playerColor);
	    this._syncPlayerNameplates();

    this._syncActionButtons();

    this.elReviewSummary.style.display = 'none';
    this.elMoveBadge.style.display = 'none';
    this.elCriticalMoments.style.display = 'none';
    this.elCriticalList.innerHTML = '';
    this._renderIdleEngineInfo();
    this._resetInsightPanel();
    this._updateGameStatus();
    this._updateLiveEvalPanel({
      busy: false,
      score: null,
      line: 'Select a move or play from the board to begin live analysis.',
      meta: '',
    });

    const opening = this.analyzer.detectOpening(this.gameMoves);
    this._showOpeningInfo(opening);

	    this._updateBoard();
	    this._updateCurrentMoveIndicator();
    this._renderMoveList();
    this._updateEvalBar(0);
    this._drawEvalGraph();
    this._requestLiveEvaluation('Analyzing original position...');
    this._playNamedSound('start');
    this._syncCoachControls();
    this._saveGameState();
  }

  _loadSavedGameState(type) {
    try {
      const key = type === 'coach' ? 'sidastuff.coachGame' : 'sidastuff.reviewGame';
      const raw = localStorage.getItem(key);
      if (!raw) return null;
	      const state = JSON.parse(raw);
	      const MAX_AGE = 12 * 60 * 60 * 1000;
	      const isCoach = type === 'coach' && (state?.headers?.Event === 'Coach' || state?.coachMode);
	      if ((!state?.moves?.length && !isCoach) || (Date.now() - (state.savedAt || 0)) >= MAX_AGE) return null;
	      return state;
    } catch (_) { return null; }
  }

  _saveGameState() {
    try {
      const isCoach = this.gameHeaders?.Event === 'Coach';
      const key = isCoach ? 'sidastuff.coachGame' : 'sidastuff.reviewGame';
      if (!this.gameMoves.length && !isCoach) { localStorage.removeItem(key); return; }
	      const state = {
	        moves: this.gameMoves.slice(),
	        headers: this.gameHeaders || {},
	        initialFen: this.initialFen,
	        currentMoveIndex: this.currentMoveIndex,
	        savedAt: Date.now(),
	      };
      if (isCoach) {
        state.coachMode = {
          elo: this.coachMode.elo,
          humanColor: this.coachMode.humanColor,
          aiAdjust: this.coachMode.aiAdjust,
          adjustStyle: this.coachMode.adjustStyle,
        };
      }
      localStorage.setItem(key, JSON.stringify(state));
    } catch (_) {}
  }

	  _restoreGameState() {}

	  _savedGameStorageKey(type) {
	    return type === 'coach' ? 'sidastuff.coachGame' : 'sidastuff.reviewGame';
	  }

	  _forgetSavedGameState(type) {
	    try {
	      localStorage.removeItem(this._savedGameStorageKey(type));
	    } catch (_) {}
	  }

	  _savedGameRestoreHtml(type, state = {}) {
	    const label = type === 'coach' ? 'Coach game' : 'Review game';
	    const moves = Array.isArray(state.moves) ? state.moves.length : 0;
	    const savedDate = state.savedAt ? new Date(state.savedAt).toLocaleString() : 'recently';
	    const headers = state.headers || {};
	    const white = headers.White || (type === 'coach' ? 'You/Coach' : 'White');
	    const black = headers.Black || (type === 'coach' ? 'Coach/You' : 'Black');
	    return `
	      <div class="restore-game-popup">
	        <div class="restore-game-title">${this._escapeHtml(label)}</div>
	        <div class="restore-game-row"><span>Players</span><strong>${this._escapeHtml(`${white} vs ${black}`)}</strong></div>
	        <div class="restore-game-row"><span>Moves</span><strong>${moves}</strong></div>
	        <div class="restore-game-row"><span>Saved</span><strong>${this._escapeHtml(savedDate)}</strong></div>
	      </div>`;
	  }

	  async _promptSavedGameRestore(type, state) {
	    const isCoach = type === 'coach';
	    const result = await this._showPopup({
	      form: true,
	      icon: 'question',
	      title: `Restore previous ${isCoach ? 'coach game' : 'review'}?`,
	      html: this._savedGameRestoreHtml(type, state),
	      confirmButtonText: 'Restore',
	      showCancelButton: true,
	      cancelButtonText: isCoach ? 'New coach game' : 'Import new game',
	      allowOutsideClick: false,
	      reverseButtons: false,
	    });

	    if (result.isConfirmed) {
	      if (isCoach) {
	        this._restoreSavedCoachGame(state);
	      } else {
	        this._restoreSavedReviewGame(state);
	      }
	      return;
	    }

	    this._forgetSavedGameState(type);
	    if (isCoach) {
	      this._showEngineChoiceModal('coach');
	    } else {
	      this._showEngineChoiceModal('import');
	    }
	  }

	  _restoreSavedCoachGame(state) {
	    this._loadGame(state.moves || [], state.headers || { Event: 'Coach' });
	    if (state.coachMode) {
	      Object.assign(this.coachMode, state.coachMode, {
	        active: true,
	        thinking: false,
	        gameOverCelebrated: false,
	      });
	    } else {
	      this.coachMode.active = true;
	      this.coachMode.thinking = false;
	    }
	    const restoreIndex = Number.isInteger(state.currentMoveIndex) ? state.currentMoveIndex : this.gameMoves.length - 1;
	    this._goToMove(restoreIndex);
	    this._enterCoachMode();
	  }

	  _restoreSavedReviewGame(state) {
	    this._loadGame(state.moves || [], state.headers || {});
	    if (Number.isInteger(state.currentMoveIndex)) this._goToMove(state.currentMoveIndex);
	    this._enterReviewMode();
	  }

	  _currentPgn() {
	    const headers = { ...(this.gameHeaders || {}) };
	    const chess = new Chess(this.initialFen || undefined);
	    for (const [key, value] of Object.entries(headers)) {
	      if (value !== undefined && value !== null && value !== '') chess.header(key, String(value));
	    }
	    const limit = this.currentMoveIndex >= 0 ? this.currentMoveIndex + 1 : this.gameMoves.length;
	    for (const san of this.gameMoves.slice(0, Math.max(0, limit))) {
	      if (!chess.move(san, { sloppy: true })) break;
	    }
	    return chess.pgn() || '';
	  }

	  async _copyTextToClipboard(text) {
	    if (navigator.clipboard?.writeText) {
	      await navigator.clipboard.writeText(text);
	      return true;
	    }
	    return false;
	  }

	  async _exportCurrentPgn() {
	    const pgn = this._currentPgn();
	    if (!pgn) {
	      this._showPopup({ icon: 'info', title: 'No PGN yet', text: 'Make or import moves before exporting PGN.' });
	      return;
	    }
	    const copied = await this._copyTextToClipboard(pgn).catch(() => false);
	    this._showPopup({
	      icon: copied ? 'success' : 'info',
	      title: copied ? 'PGN copied' : 'PGN export',
	      html: `<textarea class="export-textarea" readonly>${this._escapeHtml(pgn)}</textarea>`,
	      confirmButtonText: 'Done',
	    });
	  }

	  async _exportCurrentFen() {
	    const fen = this.chess?.fen?.() || '';
	    if (!fen) return;
	    const copied = await this._copyTextToClipboard(fen).catch(() => false);
	    this._showPopup({
	      icon: copied ? 'success' : 'info',
	      title: copied ? 'FEN copied' : 'FEN export',
	      html: `<textarea class="export-textarea" readonly>${this._escapeHtml(fen)}</textarea>`,
	      confirmButtonText: 'Done',
	    });
	  }

	  _goToMove(index) {
    if (index < -1) index = -1;
    if (index >= this.gameMoves.length) index = this.gameMoves.length - 1;
    if (index === this.currentMoveIndex) return;

    this.currentMoveIndex = index;
    this.chess = new Chess(this.initialFen);

    let lastMoveFrom = null;
    let lastMoveTo = null;
    let lastMoveObj = null;
    let lastFenBefore = null;

    for (let i = 0; i <= index; i++) {
      lastFenBefore = this.chess.fen();
      const move = this.chess.move(this.gameMoves[i], { sloppy: true });
      if (move) {
        lastMoveFrom = move.from;
        lastMoveTo = move.to;
        lastMoveObj = move;
      }
    }

    this.board.setChessInstance(this.chess);
    this._updateBoard();

	    const result = this.analysisResults?.[index] || this.liveMoveResults?.[index];
	    const feedbackResult = result?.isCoachMove
	      ? (this.analysisResults?.[index - 1] || this.liveMoveResults?.[index - 1])
	      : result;
		    const highlights = feedbackResult && index >= 0 && !feedbackResult.isCoachMove
		      ? this._moveHighlightsForResult(feedbackResult, feedbackResult.moveIndex)
		      : [];
		    const resultHighlights = result && index >= 0
		      ? this._moveHighlightsForResult(result, index)
		      : [];
		    for (const highlight of resultHighlights) {
		      if (!highlights.some((entry) => entry.square === highlight.square && entry.type === highlight.type)) {
		        highlights.push(highlight);
		      }
		    }
		    if (highlights.length === 0 && lastMoveFrom && lastMoveTo) {
		      highlights.push(...this._moveHighlightsForSquares(lastMoveFrom, lastMoveTo, this._isCoachMoveIndex(index)
		        ? { color: '#D9ECFF', ringColor: '#2F6F9F' }
		        : {}));
		    }
		    if (result && index >= 0 && !result.isCoachMove) {
		      if (result.bestMove && result.bestMove !== result.moveUci) {
		        highlights.push({ square: result.bestMove.substring(0, 2), type: 'best-from' });
	        highlights.push({ square: result.bestMove.substring(2, 4), type: 'best-to' });
	      }
    }

    this.board.setHighlights(highlights);

	    if (result && index >= 0) {
	      this._updateEvalBar(result.evalAfter);
	      this._drawEvalGraph();
	      if (!result.isCoachMove) {
	        this._applyBestMoveArrow(result, { allowOnQuiet: false });
	        this._showMoveBadge(result.classification, result.moveUci ? result.moveUci.substring(2, 4) : null);
	        this._renderMoveInsights(result);
	      }
	      this._showEngineLine(result);
	      this._playMoveSound(lastMoveObj, index);
    } else if (this.analysisResults && index === -1) {
      this._updateEvalBar(this.analysisResults.length > 0 ? this.analysisResults[0].evalBefore : 0);
      this._drawEvalGraph();
      this.elMoveBadge.style.display = 'none';
      this._renderIdleEngineInfo();
      this._resetInsightPanel();
      this.board.clearBestMoveArrow();
    } else {
      this.elMoveBadge.style.display = 'none';
      this._renderIdleEngineInfo();
      this._resetInsightPanel();
      this.board.clearBestMoveArrow();
      if (index >= 0) {
        this._playMoveSound(lastMoveObj, index);
      } else {
        this._updateLiveEvalPanel({
          busy: false,
          score: null,
          line: 'Original position loaded. Make a move to start live analysis.',
          meta: '',
        });
      }
      this._requestLiveEvaluation(
        index >= 0 ? `Analyzing move ${index + 1}` : 'Analyzing original position...',
        index >= 0 && lastMoveObj ? {
          fenBefore: lastFenBefore,
          fenAfter: this.chess.fen(),
          moveObj: lastMoveObj,
          moveIndex: index,
        } : null
      );
    }

		    this._updateGameStatus();
		    this._updateActiveMoveInList();
		    this._updateCurrentMoveIndicator();
		    if (!this.isAnalyzing) this._saveGameState();
		  }

  _drawEvalGraph() {
    const ctx = this.evalGraphCtx;
    const w = this.elEvalGraph.width;
    const h = this.elEvalGraph.height;
    ctx.clearRect(0, 0, w, h);

    const series = (this.analysisResults && this.analysisResults.length > 0)
      ? this.analysisResults.map((entry) => entry.evalAfter)
      : this.liveEvalHistory;

    if (!series || series.length === 0) return;

    let min = 9999;
    let max = -9999;
    for (const score of series) {
      min = Math.min(min, score);
      max = Math.max(max, score);
    }

    min = Math.max(min, -1000);
    max = Math.min(max, 1000);
    if (min === max) {
      min -= 1;
      max += 1;
    }

    ctx.strokeStyle = '#d1cabd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (series.length === 1) {
      const y = h - ((series[0] - min) / (max - min)) * h;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    } else {
      for (let i = 0; i < series.length; i++) {
        const y = h - ((series[i] - min) / (max - min)) * h;
        const x = (i / (series.length - 1)) * w;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    if (this.analysisResults && this.currentMoveIndex >= 0 && this.currentMoveIndex < this.analysisResults.length) {
      const x = this.analysisResults.length === 1
        ? w
        : (this.currentMoveIndex / (this.analysisResults.length - 1)) * w;
      ctx.strokeStyle = '#7a746a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    } else if (!this.analysisResults && this.liveEvalHistory.length > 0) {
      const x = this.liveEvalHistory.length === 1 ? w : w;
      ctx.strokeStyle = '#7a746a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

	  _playNamedSound(name) {
	    const pool = this.soundPool[name];
	    if (!Array.isArray(pool) || !pool.length) return;
	    const index = this.soundPoolIndex[name] || 0;
	    const audio = pool[index % pool.length];
	    this.soundPoolIndex[name] = (index + 1) % pool.length;
	    try {
	      audio.pause();
	      audio.currentTime = 0;
	    } catch (_err) {}
	    audio.play().catch(() => {});
	  }

  _playMoveSound(moveObj, index) {
    if (!moveObj) return;
    const flags = moveObj.flags || '';
    const isCastle = flags.includes('k') || flags.includes('q');
    const isCapture = flags.includes('c') || flags.includes('e');
    const isPromotion = !!moveObj.promotion;
    const isGameEnd = this.chess.game_over() && index === this.gameMoves.length - 1;
    const isCheckmate = this.chess.in_checkmate() && isGameEnd;
    const isCheck = /[+#]/.test(moveObj.san || '') || this.chess.in_check();

    if (isCheckmate) {
      this._playNamedSound('check');
      setTimeout(() => this._playNamedSound('end'), 140);
      return;
    }

    if (isGameEnd) {
      this._playNamedSound('end');
      return;
    }
    if (isCheck) {
      this._playNamedSound('check');
      return;
    }
    if (isPromotion) {
      this._playNamedSound('promote');
      return;
    }
    if (isCastle) {
      this._playNamedSound('castle');
      return;
    }
    if (isCapture) {
      this._playNamedSound('capture');
      return;
    }
    this._playNamedSound('move');
  }

  _updateBoard() {
    this.board.setPositionFromFen(this.chess.fen());
  }

	  _updateEvalBar(cpScore) {
	    this.currentEvalScore = typeof cpScore === 'number' ? cpScore : 0;
	    const whitePct = this.analyzer.evalBarPercent(cpScore);
	    const blackPct = 100 - whitePct;
	    const flipped = !!this.board?.flipped;
	    this.elEvalBarWhite.style.order = flipped ? '0' : '1';
	    this.elEvalBarBlack.style.order = flipped ? '1' : '0';
	    this.elEvalBarWhite.style.height = whitePct + '%';
	    this.elEvalBarWhite.style.width = '100%';
	    this.elEvalBarBlack.style.height = blackPct + '%';
	    this.elEvalBarBlack.style.width = '100%';
	    this.elEvalScore.textContent = this.analyzer.formatScore(cpScore);
	  }

  _showMoveBadge(classification, targetSquare, options = {}) {
    if (!classification) {
      this.elMoveBadge.style.display = 'none';
      return;
    }

    if (targetSquare) {
      const sqEl = this.board.container.querySelector(`[data-square="${targetSquare}"]`);
      if (sqEl) {
        const boardRect = this.board.container.parentElement.getBoundingClientRect();
        const sqRect = sqEl.getBoundingClientRect();
        const inset = Math.max(9, sqRect.width * 0.18);
        const left = sqRect.right - boardRect.left - inset;
        const top = sqRect.top - boardRect.top + inset;
        this.elMoveBadge.style.left = left + 'px';
        this.elMoveBadge.style.top = top + 'px';
        this.elMoveBadge.style.right = 'auto';
        this.elMoveBadge.style.transform = 'translate(-50%, -50%)';
      }
    }

	    this.elMoveBadge.style.display = 'flex';
	    const badgeRgb = this._hexToRgb(classification.color);
	    this.elMoveBadge.style.setProperty('--badge-color', classification.color);
	    if (badgeRgb) {
	      this.elMoveBadge.style.setProperty('--badge-rgb', `${badgeRgb.r}, ${badgeRgb.g}, ${badgeRgb.b}`);
	    }
	    this.elMoveBadge.style.background = classification.color;
	    this.elMoveBadge.style.color = '#fff';
    this.elMoveBadge.title = classification.name;
    this.elMoveBadge.setAttribute('aria-label', classification.name);
    this.elBadgeIcon.className = this._classificationIconClass(classification, 'badge-icon');
    this.elBadgeIcon.textContent = classification.icon;
    this.elBadgeText.textContent = '';

	    const key = this.analyzer.getClassificationKey(classification);
	    const hasImpactBadge = ['BRILLIANT', 'GREAT', 'BLUNDER'].includes(key);
	    this.elMoveBadge.classList.toggle('badge-impact', hasImpactBadge);
	    this.elMoveBadge.style.animation = 'none';
	    void this.elMoveBadge.offsetHeight;
	    this.elMoveBadge.style.animation = '';
	
		    if (!options.suppressFlash) {
		      this._flashBoard(classification);
		    }
		  }

	  _refreshMoveBadgePosition() {
	    const result = this.analysisResults?.[this.currentMoveIndex] || this.liveMoveResults?.[this.currentMoveIndex];
	    if (!result || result.isCoachMove || this.currentMoveIndex < 0) return;
    this._showMoveBadge(result.classification, result.moveUci ? result.moveUci.substring(2, 4) : null, { suppressFlash: true });
  }

  _applyBestMoveArrow(result, { allowOnQuiet = false } = {}) {
	    if (!result || result.isCoachMove || !result.bestMove) {
      this.board.clearBestMoveArrow();
      return;
    }

    const classificationKey = result.classificationKey || this.analyzer.getClassificationKey(result.classification);
    if (classificationKey === 'BEST' || classificationKey === 'GREAT' || classificationKey === 'BRILLIANT') {
      this.board.clearBestMoveArrow();
      return;
    }

    if (!allowOnQuiet && !result.classification) {
      this.board.clearBestMoveArrow();
      return;
    }

    this.board.setBestMoveArrow(result.bestMove);
  }

  _flashBoard(classification) {
    const existing = this.board.container.parentElement.querySelector('.board-flash');
    if (existing) existing.remove();

    let flashClass = null;
	    if (classification === MoveClassification.MISS) flashClass = 'flash-blunder';
    if (!flashClass) return;

    const flash = document.createElement('div');
    flash.className = `board-flash ${flashClass}`;
    this.board.container.parentElement.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove());
  }

	  _showEngineLine(result) {
	    if (!result) {
	      this._renderIdleEngineInfo();
	      return;
	    }

	    if (result.isCoachMove) {
	      this.elEngineLine.textContent = `Coach move: ${result.moveSan || result.move}`;
	      return;
	    }

    if (!result.alternatives || result.alternatives.length === 0) {
      if (result.bestMove !== result.moveUci) {
        this.elEngineLine.textContent = `Best: ${result.bestMoveSan} (${this.analyzer.formatScore(result.evalBefore)})`;
      } else {
        this.elEngineLine.textContent = 'Best move played.';
      }
      return;
    }

    const top = result.alternatives
      .slice(0, 3)
      .map((alt) => `${alt.rank}) ${alt.moveSan} ${alt.evalText}`)
      .join(' | ');

    if (result.bestMove !== result.moveUci) {
      this.elEngineLine.textContent = `Best: ${result.bestMoveSan}. Top lines: ${top}`;
    } else {
      this.elEngineLine.textContent = `Best move played. Top lines: ${top}`;
    }
  }

  _renderMoveList() {
    this.elMoveList.innerHTML = '';

	    if (this.gameMoves.length === 0) {
	      this.elMoveList.innerHTML = `<div class="move-list-empty">${this.puzzleMode.active ? 'Solve the puzzle to build a review line.' : 'Import a PGN or start coach to begin.'}</div>`;
	      return;
	    }

    for (let i = 0; i < this.gameMoves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const row = document.createElement('div');
      row.className = 'move-row';

      const numEl = document.createElement('span');
      numEl.className = 'move-number';
      numEl.textContent = moveNum + '.';
      row.appendChild(numEl);

      row.appendChild(this._createMoveCell(i, this.gameMoves[i]));

      if (i + 1 < this.gameMoves.length) {
        row.appendChild(this._createMoveCell(i + 1, this.gameMoves[i + 1]));
      } else {
        row.appendChild(document.createElement('div'));
      }

      this.elMoveList.appendChild(row);
    }
  }

  _createMoveCell(index, moveSan) {
    const cell = document.createElement('div');
    cell.className = 'move-cell';
    cell.dataset.moveIndex = index;

    const result = this.analysisResults?.[index] || this.liveMoveResults?.[index];

		    const shownMoveBadges = new Set(['BRILLIANT', 'GREAT', 'MISS', 'MISTAKE', 'INACCURACY', 'BLUNDER']);
		    const classificationKey = result?.classificationKey || this.analyzer.getClassificationKey(result?.classification);
		    if (result && !result.isCoachMove && shownMoveBadges.has(classificationKey)) {
		      const cls = result.classification;
		      const icon = document.createElement('span');
      icon.className = this._classificationIconClass(cls, 'move-icon');
      icon.style.background = cls.color;
      icon.textContent = cls.icon;
      cell.appendChild(icon);
      cell.title = `${cls.name} | CP loss: ${Math.round(result.cpLoss || 0)}`;
    }

    const text = document.createElement('span');
    text.textContent = moveSan;
    cell.appendChild(text);

	    if (result && !result.isCoachMove) {
	      const evalEl = document.createElement('span');
      evalEl.className = 'move-eval';
      evalEl.textContent = this.analyzer.formatScore(result.evalAfter);
      cell.appendChild(evalEl);
    }

    cell.addEventListener('click', () => this._goToMove(index));

    if (index === this.currentMoveIndex) cell.classList.add('active');
    return cell;
  }

	  _updateActiveMoveInList() {
	    const cells = this.elMoveList.querySelectorAll('.move-cell');
    cells.forEach((cell) => {
      cell.classList.toggle('active', parseInt(cell.dataset.moveIndex, 10) === this.currentMoveIndex);
    });

    const active = this.elMoveList.querySelector('.move-cell.active');
    if (!active) return;

    const container = this.elMoveList;
    const activeTop = active.offsetTop;
    const activeHeight = active.offsetHeight;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;

    if (activeTop < scrollTop) {
      container.scrollTop = activeTop;
    } else if (activeTop + activeHeight > scrollTop + containerHeight) {
	      container.scrollTop = activeTop + activeHeight - containerHeight;
	    }
	  }

		  _previewReviewPosition(index) {
		    let target = index;
		    if (target < -1) target = -1;
		    if (target >= this.gameMoves.length) target = this.gameMoves.length - 1;

	    this.currentMoveIndex = target;
	    this.chess = new Chess(this.initialFen);

	    let lastMoveFrom = null;
	    let lastMoveTo = null;
	    for (let i = 0; i <= target; i += 1) {
	      const move = this.chess.move(this.gameMoves[i], { sloppy: true });
	      if (move) {
	        lastMoveFrom = move.from;
	        lastMoveTo = move.to;
	      }
	    }

		    this.board.setChessInstance(this.chess);
		    this._updateBoard();
		    this.board.setHighlights(lastMoveFrom && lastMoveTo
		      ? this._moveHighlightsForSquares(lastMoveFrom, lastMoveTo, this._isCoachMoveIndex(target)
		        ? { color: '#D9ECFF', ringColor: '#2F6F9F' }
		        : {})
		      : []);
	    this.board.clearBestMoveArrow();
	    this.elMoveBadge.style.display = 'none';
		    this._updateActiveMoveInList();
		    this._updateCurrentMoveIndicator();
		  }

		  _startReviewPlayback(options = {}) {
		    this._stopReviewPlayback();
		    if (!this.gameMoves.length) return;

		    const start = clamp(options.start ?? 0, 0, this.gameMoves.length - 1);
		    const end = clamp(options.end ?? this.gameMoves.length - 1, start, this.gameMoves.length - 1);
			    const minDelay = options.minDelay ?? 170;
			    const maxDelay = options.maxDelay ?? 760;
			    const loop = options.loop !== false;
			    const wrap = options.wrap === true;
		    const current = Number.isInteger(this.currentMoveIndex) ? this.currentMoveIndex : start;
		    let index = clamp(options.initialIndex ?? (current >= start && current <= end ? current : start), start, end);
		    let direction = 1;

		    const tick = () => {
		      if (!this.isAnalyzing) {
		        this._stopReviewPlayback();
		        return;
		      }

		      this._previewReviewPosition(index);
		      const span = Math.max(1, end - start);
		      const progress = span === 1 ? 1 : (index - start) / span;
		      const ease = Math.sin(Math.PI * progress);
		      const delay = Math.round(maxDelay - ((maxDelay - minDelay) * ease));

		      if (start === end) {
		        index = start;
		      } else if (!loop) {
		        index = Math.min(end, index + 1);
		        if (index >= end) {
		          this.reviewPlaybackTimer = setTimeout(tick, maxDelay);
		          return;
		        }
			      } else if (wrap) {
			        index += 1;
			        if (index > end) index = start;
			      } else {
			        index += direction;
		        if (index >= end) {
		          index = end;
		          direction = -1;
		        } else if (index <= start) {
		          index = start;
		          direction = 1;
		        }
		      }

		      this.reviewPlaybackTimer = setTimeout(tick, delay);
		    };

		    tick();
		  }

		  _stopReviewPlayback() {
		    if (!this.reviewPlaybackTimer) return;
		    clearTimeout(this.reviewPlaybackTimer);
		    this.reviewPlaybackTimer = null;
		  }

		  _sprintReviewPlaybackTo(targetIndex, options = {}) {
		    this._stopReviewPlayback();
		    if (!this.gameMoves.length || !this.isAnalyzing) return Promise.resolve();

		    const target = clamp(targetIndex, 0, this.gameMoves.length - 1);
		    const start = clamp(this.currentMoveIndex < 0 ? 0 : this.currentMoveIndex, 0, this.gameMoves.length - 1);
		    if (start === target) {
		      this._previewReviewPosition(target);
		      return Promise.resolve();
		    }

		    const direction = target > start ? 1 : -1;
		    const distance = Math.abs(target - start);
		    const minDelay = options.minDelay ?? 28;
		    const maxDelay = options.maxDelay ?? 150;
		    let step = 0;
		    let index = start;

		    return new Promise((resolve) => {
		      const tick = () => {
		        if (!this.isAnalyzing) {
		          this.reviewPlaybackTimer = null;
		          resolve();
		          return;
		        }

		        index += direction;
		        step += 1;
		        this._previewReviewPosition(index);

		        if (index === target) {
		          this.reviewPlaybackTimer = setTimeout(() => {
		            this.reviewPlaybackTimer = null;
		            resolve();
		          }, maxDelay);
		          return;
		        }

		        const progress = step / Math.max(1, distance);
		        const easeToMiddle = Math.sin(Math.PI * progress);
		        const delay = Math.round(maxDelay - ((maxDelay - minDelay) * easeToMiddle));
		        this.reviewPlaybackTimer = setTimeout(tick, delay);
		      };

		      this.reviewPlaybackTimer = setTimeout(tick, minDelay);
		    });
		  }
		
			  async _startReview() {
		const serverReview = this.engineSettings.analysisLocation === 'server';
	    if (this.isAnalyzing || this.gameMoves.length === 0 || (!serverReview && !this.engine?.ready)) return;
	    let forceBrowserReview = false;
	    if (serverReview && this.authState.user) {
	      await this._refreshUsageBeforeAction();
	      if (this._isOutOfUsage('serverReviews')) {
	        const choice = await this._showUsageLimitPopup('serverReviews');
	        if (choice !== 'browser') {
	          this._updateLiveEvalPanel({
	            busy: false,
	            score: null,
	            line: 'Server review limit reached.',
	            meta: 'Buy Boost or wait for the daily reset.',
	          });
	          return;
	        }
	        forceBrowserReview = true;
	      }
	    }
	    if (forceBrowserReview && !this.engine?.ready) {
	      await this._showPopup({
	        icon: 'warning',
	        title: 'Browser engine is still loading',
	        text: 'You are out of server reviews. Wait for Stockfish to finish loading, then review in the browser.',
	      });
	      return;
	    }
	
	    this.isAnalyzing = true;
    this.liveEvalToken += 1;
    this._syncActionButtons();
    this._setEngineControlsDisabled(true);
	    this.analyzer.setReviewProfile(this._getReviewProfile());
	    this.elReviewBtnText.textContent = 'Analyzing...';
				    this.elProgressBar.style.display = 'block';
				    this.elProgressFill.style.width = '0%';
				    this._showReviewLoadingSkeleton();
				    this.board.setLoading(null, 'Reviewing game');
		    const updateReviewProgress = (current, total, message) => {
		      const pct = Math.round((current / Math.max(1, total - 1)) * 100);
		      this.elProgressFill.style.width = clamp(pct, 0, 100) + '%';
		      this.elReviewBtnText.textContent = message;
		      this._sprintReviewPlaybackTo(current - 1, { minDelay: 18, maxDelay: 90 });
		      this._updateLiveEvalPanel({
		        busy: true,
		        score: null,
	        line: message,
	        meta: `Reviewing ${this._currentMoveLabel(current - 1)}`,
	      });
	    };
	
		    try {
				      if (serverReview && !forceBrowserReview) {
				        try {
				          if (!this.authState.user) {
				            throw new Error('Log in for server review. Running this review in the browser instead.');
				          }
				          this.analysisResults = await this._analyzeGameOnServer();
						        } catch (serverErr) {
					          console.warn('Server analysis failed:', serverErr);
					          if (serverErr?.code === 'quota_exceeded' || /Free plan includes 3 server game reviews/i.test(serverErr.message || '')) {
					            const choice = await this._showUsageLimitPopup('serverReviews');
					            if (choice !== 'browser') throw serverErr;
					          }
					          if (!this.engine?.ready) throw serverErr;
				          this.elReviewBtnText.textContent = 'Browser fallback...';
				          this._updateLiveEvalPanel({
				            busy: true,
				            score: null,
					            line: /Free plan includes|Log in for server review/i.test(serverErr.message || '')
					              ? serverErr.message
					              : 'Server review unavailable. Using browser Stockfish.',
					            meta: serverErr.message || 'Local fallback',
				          });
				          this.analysisResults = await this.analyzer.analyzeGame(
				            this.gameMoves,
				            this.engine,
				            updateReviewProgress,
				            { initialFen: this.initialFen, headers: this.gameHeaders }
				          );
		        }
				      } else {
			        this.analysisResults = await this.analyzer.analyzeGame(
			          this.gameMoves,
		          this.engine,
		          updateReviewProgress,
			          { initialFen: this.initialFen, headers: this.gameHeaders }
			        );
	      }

				      this._showOpeningInfo(this.analysisResults.opening || this.analyzer.detectOpening(this.gameMoves));
				      await this._sprintReviewPlaybackTo(this.gameMoves.length - 1, { minDelay: 6, maxDelay: 22 });
			      this._showReviewSummary();
	      this._renderMoveList();
	      this._renderCriticalMoments();
	      this._renderPostReviewEvalPanel();
	      this._goToMove(0);
	    } catch (err) {
	      console.error('Analysis error:', err);
	      this._showPopup({
	        icon: 'error',
	        title: 'Analysis failed',
	        text: err.message,
	      });
			    } finally {
				      this.isAnalyzing = false;
				      this._stopReviewPlayback();
			      this._setEngineControlsDisabled(false);
			      this._syncActionButtons();
			      this.elReviewBtnText.textContent = this.analysisResults ? 'Re-analyze Game' : 'Start Review';
		      this.elProgressBar.style.display = 'none';
		      if (!this.analysisResults) {
		        this._clearReviewExtras();
		        this.elReviewSummary.style.display = 'none';
		      }
		      this.board.clearLoading();
		    }
	  }

			  async _analyzeGameOnServer() {
				    const reviewProfile = this._getReviewProfile();
				    this.elReviewBtnText.textContent = 'Sending to Server...';
		    this.elProgressFill.style.width = '8%';
		    const controller = new AbortController();
			    const timeout = setTimeout(() => controller.abort(), 180000);
			    this._startReviewPlayback({
			      start: 0,
			      end: Math.max(0, this.gameMoves.length - 1),
			      minDelay: 160,
			      maxDelay: 820,
			    });
		
			    try {
				      const response = await fetch('/api/analyze/stream', {
				        method: 'POST',
				        headers: await this._authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
			        signal: controller.signal,
			        cache: 'no-store',
			        body: JSON.stringify({
			          moves: this.gameMoves,
			          headers: this.gameHeaders || {},
			          initialFen: this.initialFen,
				          profile: {
				            key: reviewProfile.key,
				            depth: 14,
				            multiPv: 1,
				            timeoutMs: 4500,
				            serverEngine: this.engineSettings.serverStrongReview ? 'full' : 'lite',
				          },
			        }),
			      });
			      if (!response.ok || !response.body) {
			        const text = await response.text().catch(() => '');
			        throw new Error(text || `Server analysis failed with ${response.status}`);
			      }
			      const data = await this._readServerAnalysisStream(response, controller.signal);
			      this.elProgressFill.style.width = '100%';
			      return this._serverAnalysisResultsFromData(data);
			    } catch (err) {
			      if (err.name === 'AbortError') throw new Error('Server review timed out.');
			      throw err;
			    } finally {
			      clearTimeout(timeout);
			    }
				  }

				  async _readServerAnalysisStream(response, signal) {
				    const reader = response.body.getReader();
				    const decoder = new TextDecoder();
				    let buffer = '';
				    let finalData = null;
				    const handleEvent = (raw) => {
				      const lines = raw.split(/\r?\n/);
				      let event = 'message';
				      const dataLines = [];
				      for (const line of lines) {
				        if (line.startsWith('event:')) event = line.slice(6).trim();
				        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
				      }
				      if (!dataLines.length) return;
				      const data = JSON.parse(dataLines.join('\n'));
				      if (event === 'queued') {
				        this.elReviewBtnText.textContent = 'Queued';
				        this._updateLiveEvalPanel({
				          busy: true,
				          score: null,
				          line: 'Server review is queued.',
				          meta: `${data.queuedPosition || data.queued || 1} waiting`,
				        });
				      } else if (event === 'status') {
				        this.elReviewBtnText.textContent = 'Reviewing Game';
				      } else if (event === 'progress') {
				        const completed = Math.max(0, Number(data.completed) || 0);
				        const total = Math.max(1, Number(data.total) || 1);
				        const pct = 10 + Math.round((completed / total) * 84);
				        this.elProgressFill.style.width = `${clamp(pct, 10, 96)}%`;
				        this.elReviewBtnText.textContent = 'Reviewing Game';
				        this._sprintReviewPlaybackTo(completed - 1, { minDelay: 12, maxDelay: 58 });
				        this._updateLiveEvalPanel({
				          busy: true,
				          score: null,
				          line: 'Reviewing Game',
				          meta: `${completed}/${total} positions`,
				        });
				      } else if (event === 'complete') {
				        finalData = data;
				      } else if (event === 'error') {
				        const error = new Error(data.error || 'Server analysis failed.');
				        error.code = data.code;
				        throw error;
				      }
				    };

				    while (true) {
				      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
				      const { value, done } = await reader.read();
				      if (done) break;
				      buffer += decoder.decode(value, { stream: true });
				      const events = buffer.split(/\n\n/);
				      buffer = events.pop() || '';
				      for (const eventText of events) {
				        if (eventText.trim()) handleEvent(eventText);
				      }
				    }
				    buffer += decoder.decode();
				    if (buffer.trim()) handleEvent(buffer);
					    if (!Array.isArray(finalData?.results)) throw new Error('Server analysis returned no results.');
					    if (finalData.quota || finalData.plan) this._refreshMe().catch(() => {});
					    return finalData;
				  }

				  _serverAnalysisResultsFromData(data) {
	    const results = data.results.map((entry) => ({
	      ...entry,
	      classification: MoveClassification[entry.classificationKey] || MoveClassification.GOOD,
    }));
	    results.opening = data.opening || this.analyzer.detectOpening(this.gameMoves);
	    results.openingDrift = data.openingDrift || null;
	    results.trainingQueue = data.trainingQueue || [];
	    results.patternStats = data.patternStats || [];
	    results.reviewNarrative = data.reviewNarrative || [];
	    results.criticalMoments = (data.criticalMoments || []).map((entry) => ({
      ...entry,
      classification: MoveClassification[entry.classificationKey] || MoveClassification.GOOD,
    }));
    results.whiteAccuracy = data.whiteAccuracy;
    results.blackAccuracy = data.blackAccuracy;
    results.whiteAcpl = data.whiteAcpl;
    results.blackAcpl = data.blackAcpl;
    results.whiteCaps = data.whiteCaps;
	    results.blackCaps = data.blackCaps;
			    results.phaseSummary = data.phaseSummary;
				    if (data.publicStats) this._renderPublicStats(data.publicStats);
				    results.statsRecorded = Boolean(data.publicStats);
				    return results;
				  }

	  _showOpeningInfo(opening) {
    if (!opening) {
      this.elOpeningInfo.style.display = 'none';
      this.elOpeningName.textContent = '';
      return;
    }

    this.elOpeningInfo.style.display = 'flex';
    this.elOpeningName.textContent = `${opening.name}${opening.eco ? ` (${opening.eco})` : ''}`;
  }

  _renderSkeletonLines(count = 3, className = '') {
    return Array.from({ length: count }, (_, index) => {
      const width = Math.max(36, 92 - (index % 3) * 16);
      return `<span class="skeleton-line ${className}" style="--skeleton-width:${width}%"></span>`;
    }).join('');
  }

  _showReviewLoadingSkeleton() {
    if (!this.elReviewSummary) return;
    this.elReviewSummary.style.display = 'block';
    this.elReviewSummary.classList.add('review-skeleton');

    const headers = this.gameHeaders || {};
    const summaryWhiteH4 = this.elReviewSummary.querySelector('.summary-col:first-child h4');
    const summaryBlackH4 = this.elReviewSummary.querySelector('.summary-col:last-child h4');
    if (summaryWhiteH4) summaryWhiteH4.textContent = headers.White || 'White';
    if (summaryBlackH4) summaryBlackH4.textContent = headers.Black || 'Black';

    document.getElementById('accuracy-white-val').textContent = '--';
    document.getElementById('accuracy-black-val').textContent = '--';
    document.getElementById('ring-white').style.strokeDashoffset = 283;
    document.getElementById('ring-black').style.strokeDashoffset = 283;
    document.getElementById('summary-white').innerHTML = this._renderSkeletonLines(5);
    document.getElementById('summary-black').innerHTML = this._renderSkeletonLines(5);

    this.elCapsWhite.textContent = '--';
    this.elCapsBlack.textContent = '--';
    this.elAcplWhite.textContent = '--';
    this.elAcplBlack.textContent = '--';

    if (this.elReviewNarrative) this.elReviewNarrative.innerHTML = `<p>${this._renderSkeletonLines(3)}</p>`;
    if (this.elTrainingList) this.elTrainingList.innerHTML = this._renderSkeletonLines(4);
    if (this.elOpeningDrift) this.elOpeningDrift.innerHTML = this._renderSkeletonLines(2);
    if (this.elPatternList) this.elPatternList.innerHTML = this._renderSkeletonLines(3);
    if (this.elPhaseBreakdown) this.elPhaseBreakdown.innerHTML = this._renderSkeletonLines(4);
  }

  _showReviewSummary() {
	    if (!this.analysisResults) return;

	    this.elReviewSummary.style.display = 'block';
	    this.elReviewSummary.classList.remove('review-skeleton');

    const headers = this.gameHeaders || {};
    const whiteName = headers.White || 'White';
    const blackName = headers.Black || 'Black';
    const whiteElo = headers.WhiteElo ? ` (${headers.WhiteElo})` : '';
    const blackElo = headers.BlackElo ? ` (${headers.BlackElo})` : '';

    const summaryWhiteH4 = this.elReviewSummary.querySelector('.summary-col:first-child h4');
    const summaryBlackH4 = this.elReviewSummary.querySelector('.summary-col:last-child h4');
    if (summaryWhiteH4) summaryWhiteH4.textContent = whiteName + whiteElo;
    if (summaryBlackH4) summaryBlackH4.textContent = blackName + blackElo;

    const whiteAcc = this.analysisResults.whiteAccuracy ?? this.analyzer.calculateAccuracy(this.analysisResults, 'white');
    const blackAcc = this.analysisResults.blackAccuracy ?? this.analyzer.calculateAccuracy(this.analysisResults, 'black');

    document.getElementById('accuracy-white-val').textContent = Math.round(whiteAcc);
    document.getElementById('accuracy-black-val').textContent = Math.round(blackAcc);

    const circumference = 2 * Math.PI * 45;
    document.getElementById('ring-white').style.strokeDashoffset = circumference * (1 - whiteAcc / 100);
    document.getElementById('ring-black').style.strokeDashoffset = circumference * (1 - blackAcc / 100);
    document.getElementById('ring-white').style.stroke = this._accuracyColor(whiteAcc);
    document.getElementById('ring-black').style.stroke = this._accuracyColor(blackAcc);

    const whiteCounts = this.analyzer.countClassifications(this.analysisResults, 'white');
    const blackCounts = this.analyzer.countClassifications(this.analysisResults, 'black');
    document.getElementById('summary-white').innerHTML = this._renderCounts(whiteCounts);
    document.getElementById('summary-black').innerHTML = this._renderCounts(blackCounts);

    this.elCapsWhite.textContent = Math.round(this.analysisResults.whiteCaps ?? this.analyzer.calculateCapsScore(this.analysisResults, 'white'));
    this.elCapsBlack.textContent = Math.round(this.analysisResults.blackCaps ?? this.analyzer.calculateCapsScore(this.analysisResults, 'black'));
    this.elAcplWhite.textContent = Math.round(this.analysisResults.whiteAcpl ?? this.analyzer.calculateAcpl(this.analysisResults, 'white'));
	    this.elAcplBlack.textContent = Math.round(this.analysisResults.blackAcpl ?? this.analyzer.calculateAcpl(this.analysisResults, 'black'));
	
	    this._renderReviewNarrative();
	    this._renderTrainingQueue();
	    this._renderOpeningDrift();
	    this._renderPatternStats();
	    this._renderPhaseBreakdown();
	  }

	  _renderReviewNarrative() {
	    if (!this.elReviewNarrative) return;
	    const lines = this.analysisResults?.reviewNarrative || [];
	    this.elReviewNarrative.innerHTML = lines.length
	      ? lines.map((line) => `<p>${line}</p>`).join('')
	      : '<p>Run review to see the main story of the game.</p>';
	  }

	  _renderTrainingQueue() {
	    if (!this.elTrainingList) return;
	    const items = this.analysisResults?.trainingQueue || [];
	    if (items.length === 0) {
	      this.elTrainingList.innerHTML = '<div class="empty-mini">No major retry positions found.</div>';
	      return;
	    }
	    this.elTrainingList.innerHTML = '';
	    items.slice(0, 6).forEach((item, index) => {
	      const button = document.createElement('button');
	      button.className = 'training-item';
	      button.type = 'button';
	      button.innerHTML = `
	        <span class="training-index">${index + 1}</span>
	        <span class="training-copy">
	          <strong>${item.prompt}</strong>
	          <small>Solution: ${item.solution || 'review best move'}</small>
	        </span>
	      `;
	      button.addEventListener('click', () => this._goToMove(item.moveIndex));
	      this.elTrainingList.appendChild(button);
	    });
	  }

	  _renderOpeningDrift() {
	    if (!this.elOpeningDrift) return;
	    const drift = this.analysisResults?.openingDrift;
	    if (!drift) {
	      this.elOpeningDrift.innerHTML = '<div class="empty-mini">No clear book drift detected.</div>';
	      return;
	    }
	    this.elOpeningDrift.innerHTML = `
	      <button class="drift-card" type="button">
	        <strong>${drift.moveLabel}</strong>
	        <span>${drift.text}</span>
	      </button>
	    `;
	    this.elOpeningDrift.querySelector('button')?.addEventListener('click', () => this._goToMove(drift.moveIndex));
	  }

	  _renderPatternStats() {
	    if (!this.elPatternList) return;
	    const patterns = this.analysisResults?.patternStats || [];
	    if (patterns.length === 0) {
	      this.elPatternList.innerHTML = '<div class="empty-mini">No recurring mistake pattern found.</div>';
	      return;
	    }
	    this.elPatternList.innerHTML = patterns.map((pattern) => `
	      <div class="pattern-item">
	        <span>${pattern.text}</span>
	        <strong>${pattern.count}x</strong>
	      </div>
	    `).join('');
	  }

  _renderPhaseBreakdown() {
    const phaseSummary = this.analysisResults?.phaseSummary;
    if (!phaseSummary) {
      this.elPhaseBreakdown.innerHTML = '';
      return;
    }

    const phases = ['Opening', 'Middlegame', 'Endgame'];
    const rows = phases.map((phase) => {
      const w = phaseSummary.white[phase] || { accuracy: 0, acpl: 0, moves: 0 };
      const b = phaseSummary.black[phase] || { accuracy: 0, acpl: 0, moves: 0 };
      return `<div class="phase-row">
        <span class="phase-name">${phase}</span>
        <span class="phase-cell">W ${w.accuracy}% / ${w.acpl} cp</span>
        <span class="phase-cell">B ${b.accuracy}% / ${b.acpl} cp</span>
      </div>`;
    }).join('');

    this.elPhaseBreakdown.innerHTML = `<div class="phase-title">Phase Accuracy / ACPL</div>${rows}`;
  }

  _accuracyColor(accuracy) {
    if (accuracy >= 90) return '#96BC4B';
    if (accuracy >= 70) return '#F7C631';
    if (accuracy >= 50) return '#E68A2E';
    return '#CA3431';
  }

  _renderCounts(counts) {
    const categories = [
      ['BRILLIANT', 'Brilliant'],
      ['GREAT', 'Great'],
      ['BEST', 'Best'],
      ['EXCELLENT', 'Excellent'],
      ['GOOD', 'Good'],
      ['BOOK', 'Book'],
      ['FORCED', 'Forced'],
      ['INACCURACY', 'Inaccuracy'],
      ['MISTAKE', 'Mistake'],
      ['BLUNDER', 'Blunder'],
      ['MISS', 'Miss'],
    ];

    return categories
      .filter(([key]) => counts[key] > 0)
      .map(([key, label]) => {
        const cls = MoveClassification[key];
        return `<div class="summary-count-row">
          <span class="${this._classificationIconClass(cls, 'dot')}" style="background:${cls.color}">${cls.icon}</span>
          <span class="label">${label}</span>
          <span class="count">${counts[key]}</span>
        </div>`;
      })
      .join('');
  }

  _renderCriticalMoments() {
    if (!this.analysisResults || !this.analysisResults.criticalMoments || this.analysisResults.criticalMoments.length === 0) {
      this.elCriticalMoments.style.display = 'none';
      this.elCriticalList.innerHTML = '';
      return;
    }

    const items = this.analysisResults.criticalMoments.map((moment) => {
      const btn = document.createElement('button');
      btn.className = 'critical-item';
      btn.type = 'button';
      btn.innerHTML = `
        <span class="${this._classificationIconClass(moment.classification, 'critical-badge')}" style="background:${moment.classification.color}">${moment.classification.icon}</span>
        <span class="critical-text">${moment.moveNumber}${moment.isWhite ? '. ' : '... '}${moment.moveSan}</span>
        <span class="critical-loss">${Math.round(moment.cpLoss)} cp</span>
      `;
      btn.addEventListener('click', () => this._goToMove(moment.moveIndex));
      return btn;
    });

    this.elCriticalList.innerHTML = '';
    items.forEach((btn) => this.elCriticalList.appendChild(btn));
    this.elCriticalMoments.style.display = 'block';
  }

	  _resetInsightPanel() {
	    if (this.elMoveInsights) this.elMoveInsights.hidden = !this.explorerReturnState;
	    this.elInsightEmpty.style.display = 'block';
    this.elInsightContent.style.display = 'none';
    this.elInsightMove.textContent = '';
    this.elInsightClass.textContent = '';
    this.elInsightCpLoss.textContent = '0';
    this.elInsightSwing.textContent = '0.0';
	    this.elInsightBestMove.textContent = '--';
	    this.elInsightPhase.textContent = '--';
	    if (this.elInsightPlanTags) this.elInsightPlanTags.innerHTML = '';
	    if (this.elInsightThreatRow) this.elInsightThreatRow.hidden = true;
	    if (this.elInsightThreat) this.elInsightThreat.textContent = '--';
	    if (this.elInsightEndgameRow) this.elInsightEndgameRow.hidden = true;
	    if (this.elInsightEndgame) this.elInsightEndgame.textContent = '--';
	    this.elInsightCoach.textContent = '';
	    if (this.elBtnLineExplorer) this.elBtnLineExplorer.disabled = true;
	    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = !this.explorerReturnState;
	    this.elInsightAlternatives.innerHTML = '';
	  }

  _renderMoveInsights(result) {
    if (!result) {
      this._resetInsightPanel();
      return;
    }

    if (result.isCoachMove) {
      return;
    }

    if (this.elMoveInsights) this.elMoveInsights.hidden = false;
    this.elInsightEmpty.style.display = 'none';
    this.elInsightContent.style.display = 'block';

    this.elInsightMove.textContent = `${result.moveNumber}${result.isWhite ? '. ' : '... '}${result.moveSan || result.move}`;
    this.elInsightClass.textContent = result.classification.name;
    this.elInsightClass.style.background = result.classification.color;
    this.elInsightClass.style.color = '#fff';

    this.elInsightCpLoss.textContent = Math.round(result.cpLoss || 0) + ' cp';
    this.elInsightSwing.textContent = this.analyzer.formatScore(result.swing || 0);
	    this.elInsightBestMove.textContent = result.bestMoveSan || '--';
	    this.elInsightPhase.textContent = result.phase || '--';
	    this.elInsightCoach.textContent = result.coachText || '';
	    if (this.elInsightPlanTags) {
	      const tags = result.planTags || [];
	      this.elInsightPlanTags.innerHTML = tags.length
	        ? tags.map((tag) => `<span class="insight-tag">${tag}</span>`).join('')
	        : '<span class="empty-mini">None</span>';
	    }
	    if (this.elInsightThreatRow && this.elInsightThreat) {
	      this.elInsightThreatRow.hidden = !result.mateThreat;
	      this.elInsightThreat.textContent = result.mateThreat?.text || '--';
	    }
	    if (this.elInsightEndgameRow && this.elInsightEndgame) {
	      const notes = result.endgameNotes || [];
	      this.elInsightEndgameRow.hidden = notes.length === 0;
	      this.elInsightEndgame.textContent = notes.join(' ');
	    }
	    if (this.elBtnLineExplorer) {
	      this.elBtnLineExplorer.disabled = !result.bestMove || result.bestMove === result.moveUci;
	      this.elBtnLineExplorer.dataset.moveIndex = String(result.moveIndex);
	    }
	    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = !this.explorerReturnState;

    if (!result.alternatives || result.alternatives.length === 0) {
      this.elInsightAlternatives.innerHTML = '';
      return;
    }

    const rows = result.alternatives.slice(0, 3).map((alt) => `
      <div class="alt-row">
        <span class="alt-rank">#${alt.rank}</span>
        <span class="alt-move">${alt.moveSan}</span>
        <span class="alt-eval">${alt.evalText}</span>
      </div>
    `).join('');

	    this.elInsightAlternatives.innerHTML = `<div class="alt-title">Top Engine Lines</div>${rows}`;
	  }

	  async _exploreBestLineFromCurrentMove() {
	    const index = Number(this.elBtnLineExplorer?.dataset.moveIndex ?? this.currentMoveIndex);
	    const result = this.analysisResults?.[index] || this.liveMoveResults?.[index];
	    if (!result?.bestMove || result.bestMove === result.moveUci || !result.fen) return;
	    if (!this.explorerReturnState) {
	      this.explorerReturnState = {
	        gameMoves: this.gameMoves.slice(),
	        originalGameMoves: this.originalGameMoves.slice(),
	        initialFen: this.initialFen,
	        gameHeaders: { ...(this.gameHeaders || {}) },
	        analysisResults: this.analysisResults,
	        liveMoveResults: this.liveMoveResults.slice(),
	        liveEvalHistory: this.liveEvalHistory.slice(),
	        currentMoveIndex: this.currentMoveIndex,
	        coachMode: { ...this.coachMode },
	        boardFlipped: this.board.flipped,
	      };
	    }

	    const branch = new Chess(result.fen);
	    const move = branch.move({
	      from: result.bestMove.slice(0, 2),
	      to: result.bestMove.slice(2, 4),
	      promotion: result.bestMove[4],
	    });
	    if (!move) return;

	    const prefix = this.gameMoves.slice(0, Math.max(0, index));
	    this.gameMoves = [...prefix, move.san];
	    this.chess = new Chess(this.initialFen);
	    for (const san of this.gameMoves) this.chess.move(san, { sloppy: true });
	    this.currentMoveIndex = this.gameMoves.length - 1;
	    this.analysisResults = null;
	    this.liveMoveResults = [];
	    this.liveEvalHistory = [];
	    if (this.elReviewBtnText) this.elReviewBtnText.textContent = 'Start Review';
	    this.elReviewSummary.style.display = 'none';
	    this.elCriticalMoments.style.display = 'none';
	    this.elCriticalList.innerHTML = '';
	    this._clearReviewExtras();
	    this._setCoachDialog('Best-line explorer loaded. Play your next move and the coach will answer.', 'Explorer');
		    this.coachMode.active = true;
		    this.coachMode.humanColor = this.chess.turn();
		    this.coachMode.thinking = false;
		    this.coachMode.gameOverCelebrated = false;
	    this._syncCoachVisibility();
	    this._syncCoachControls();
	    this.board.setChessInstance(this.chess);
	    this._updateBoard();
	    this._renderMoveList();
	    this._updateCurrentMoveIndicator();
	    this._updateGameStatus();
	    this.board.setHighlights([{ square: move.from, type: 'best-from' }, { square: move.to, type: 'best-to' }]);
	    this._requestLiveEvaluation(`Exploring ${move.san}`, {
	      fenBefore: result.fen,
	      fenAfter: this.chess.fen(),
	      moveObj: move,
	      moveIndex: this.currentMoveIndex,
	    });
	  }

	  _returnFromLineExplorer() {
	    const state = this.explorerReturnState;
	    if (!state) return;
	    this.liveEvalToken += 1;
	    this.explorerReturnState = null;
	    this.gameMoves = state.gameMoves.slice();
	    this.originalGameMoves = state.originalGameMoves.slice();
	    this.initialFen = state.initialFen;
	    this.gameHeaders = { ...(state.gameHeaders || {}) };
	    this.analysisResults = state.analysisResults;
	    this.liveMoveResults = state.liveMoveResults.slice();
	    this.liveEvalHistory = state.liveEvalHistory.slice();
	    this.coachMode = { ...state.coachMode, thinking: false };
	    this.chess = new Chess(this.initialFen);
	    for (const san of this.gameMoves.slice(0, state.currentMoveIndex + 1)) {
	      this.chess.move(san, { sloppy: true });
	    }
	    this.currentMoveIndex = state.currentMoveIndex;
	    if (this.board.flipped !== state.boardFlipped) this.board.flip();
	    this.board.setChessInstance(this.chess);
	    this._syncPlayerNameplates();
	    this._syncCoachVisibility();
	    this._syncCoachControls();
	    this._renderMoveList();
	    this._showOpeningInfo(this.analysisResults?.opening || this.analyzer.detectOpening(this.gameMoves));
	    if (this.analysisResults) {
	      this._showReviewSummary();
	      this._renderCriticalMoments();
	    }
	    const restoreIndex = this.currentMoveIndex;
	    this.currentMoveIndex = -9999;
	    this._goToMove(restoreIndex);
	    this._setCoachDialog('Returned to the original review.', 'Review');
	  }

	  _toggleAutoPlay() {
    if (this.autoPlaying) {
      this.autoPlaying = false;
      this._setButtonLabel(this.elBtnAuto, 'Auto');
      return;
    }

    this.autoPlaying = true;
    this._setButtonLabel(this.elBtnAuto, 'Stop');

    const step = () => {
      if (!this.autoPlaying) return;
      if (this.currentMoveIndex >= this.gameMoves.length - 1) {
        this.autoPlaying = false;
        this._setButtonLabel(this.elBtnAuto, 'Auto');
        return;
      }
      this._goToMove(this.currentMoveIndex + 1);
      setTimeout(step, 1100);
    };
    step();
  }
}

function browserMeetsChessRequirements() {
  try {
    const storageKey = '__chess_feature_test__';
    window.localStorage.setItem(storageKey, '1');
    window.localStorage.removeItem(storageKey);
  } catch (_err) {
    return false;
  }
  return !!(
    window.WebAssembly
    && window.Worker
    && window.fetch
    && window.Promise
    && window.URL
    && Array.from
    && Object.assign
  );
}

document.addEventListener('DOMContentLoaded', () => {
  if (!browserMeetsChessRequirements() && !/incompatible-browser\.html$/i.test(window.location.pathname)) {
    window.location.replace('/incompatible-browser.html');
    return;
  }
  window.app = new ChessReviewApp();
});
