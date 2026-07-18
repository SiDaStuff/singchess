// Main Application - Chess Game Review
class ChessReviewApp {
  constructor() {
    this.board = new ChessBoard('chess-board');
    this.engine = null;
    this.analyzer = new MoveAnalyzer();
    this.chess = new Chess();
		const _savedEngineSettings = (() => { try { const r = window.localStorage?.getItem('sidastuff.engineSettings'); return r ? JSON.parse(r) : {}; } catch (_) { return {}; } })();
		// Back-compat: users saved before the strength tier existed have only
		// legacy depthProfile/maxTimeMs. Migrate those onto the tier model so the
		// new primary control has a sensible value on first load.
		const _legacyProfileToTier = { depth10: 'quick', depth14: 'standard', depth18: 'thorough', depth22: 'thorough', depth26: 'thorough' };
		const _migratedStrength = _savedEngineSettings.reviewStrength
			|| _legacyProfileToTier[_savedEngineSettings.depthProfile]
			|| _legacyProfileToTier[_savedEngineSettings.strength]
			|| 'standard';
		this.engineSettings = {
				source: _savedEngineSettings.source || 'browser',
				module: _savedEngineSettings.module || 'lite-single',
						// Primary review-strength control (Quick/Standard/Thorough).
						reviewStrength: _migratedStrength,
						// Advanced overrides (active only when advancedEngine === true).
						advancedEngine: _savedEngineSettings.advancedEngine === true,
						customDepth: Number(_savedEngineSettings.customDepth) || Number(_savedEngineSettings.depthProfile?.replace(/\D/g, '')) || 16,
						customTimeMs: Number(_savedEngineSettings.customTimeMs) || Number(_savedEngineSettings.maxTimeMs) || 8000,
						// Set true ONLY when the user picks a value from the in-review
						// "Maximum Time" dropdown. The dropdown writes customTimeMs, but
						// _getReviewProfile must not apply that value for users who never
						// touched the dropdown (customTimeMs defaults to 8000, which would
						// silently slow every Standard-tier review from 4.5s to 8s/move).
						// This flag is the explicit "the user chose a max time" signal.
						maxTimeOverride: _savedEngineSettings.maxTimeOverride === true,
						// strength/depthProfile are kept in sync for the live-deepening ladder.
						strength: { quick: 'depth10', standard: 'depth14', thorough: 'depth18' }[_migratedStrength] || 'depth14',
						depthProfile: { quick: 'depth10', standard: 'depth14', thorough: 'depth18' }[_migratedStrength] || 'depth14',
						// Whether live per-move analysis keeps climbing to deeper
						// depths while you sit on a move. Off = use forcedDepth once.
						liveDeepening: _savedEngineSettings.liveDeepening !== undefined ? !!_savedEngineSettings.liveDeepening : true,
						forcedDepth: Number(_savedEngineSettings.forcedDepth) || 16,
						analysisLocation: _savedEngineSettings.analysisLocation || 'server',
						serverStrongReview: _savedEngineSettings.serverStrongReview !== undefined ? !!_savedEngineSettings.serverStrongReview : true,
			};
	    this.engineSettings.module = this._recommendedEngineModule();
    this.engineInitToken = 0;
    this.liveEvalToken = 0;
    // Iterative-deepening token for "sit on a move" re-analysis. Kept in lock-
    // step with liveEvalToken: every site that bumps liveEvalToken to cancel an
    // in-progress live evaluation also invalidates an in-progress deepening
    // loop, so stale passes stop touching the UI.
    this.liveDepthToken = 0;
    this.failedBrowserModules = new Set();

    this.gameMoves = [];
    this.gameHeaders = {};
    this.originalGameMoves = [];
		this.gameClockHistory = [];
		this.initialClocks = { white: null, black: null };
		this.clockState = {
			white: null,
			black: null,
			active: false,
			flagged: false,
			timerId: null,
			lastTick: 0,
			currentSide: null,
		};
    this.initialFen = this.chess.fen();
	    this.currentMoveIndex = -1;
	    this.analysisResults = null;
	    this.liveMoveResults = [];
	    this.explorerReturnState = null;
    this.exploreLineMode = false;
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
	    // AI coach chat state. model: 'fast'|'strong'; history hydrated from
	    // server on enter. streaming=assistant reply in flight; abortController
	    // cancels the fetch on leave/new message.
	    this.coachChat = {
	      active: false,
	      streaming: false,
	      model: 'fast',
	      history: [],
	      abortController: null,
	      streamedDuringTurn: false,
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
		      savedUsernames: { lichess: '', chesscom: '' },
		    };

    this.board.setChessInstance(this.chess);
    this.board.interactive = true;
    this.board.onMove = (from, to) => this._handleBoardMove(from, to);
	    this.board.onFlip = () => {
	      this._syncPlayerNameplates();
    this._applyAppearanceSettings();
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
		    this._loadAppearanceSettingsIntoUi();
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
			    this._initRouting();
			    this._ensureImportModalTabs();
			    this._initSavedUsernameBar();
			    this._initLinkUsernameRow();
			    window.addEventListener('resize', () => this._updateEvalBar(this.currentEvalScore), { passive: true });
			    window.addEventListener('resize', () => this._syncHeaderLabelVisibility(), { passive: true });
			    // Refresh plan + usage on tab focus / visibility change so the
			    // anticheat page reflects the user's current Boost/Max status
			    // without them having to navigate away and back.
			    const refreshPlanAndUsage = () => {
			      if (!this.authState?.user) return;
			      this._refreshMe()
			        .then(() => {
			          this._syncAccountUi();
			          if (this.anticheatMode?.active) this._renderAnticheatUsageBar();
			        })
			        .catch(() => {});
			    };
			    document.addEventListener('visibilitychange', () => {
			      if (document.visibilityState === 'visible') refreshPlanAndUsage();
			    });
			    window.addEventListener('focus', refreshPlanAndUsage);
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
		    // HTML uses `btn-menu-plans` (Plans page replaced Boost page). The
		    // home feature card is the only place this lives; keep an alias
		    // so legacy code that referenced `btn-menu-boost` keeps working.
		    this.elBtnMenuPlans = document.getElementById('btn-menu-plans');
		    this.elBtnMenuBoost = this.elBtnMenuPlans || document.getElementById('btn-menu-boost');
	this.elHeaderBrandLink = document.querySelector('.apple-brand-link');
	this.elHeaderAccountBtn = document.getElementById('header-account');
	this.elHeaderAccountIcon = document.getElementById('header-account-icon');
	this.elHeaderAccountLabel = document.getElementById('header-account-label');
    this.elAppleNav = document.getElementById('apple-nav');
    this.elAppleNavToggle = document.getElementById('apple-nav-toggle');
    this.elNavScrim = document.getElementById('nav-scrim');
    this.elBtnBackMenu = document.getElementById('btn-back-menu');
    // The engine-choice modal was removed (it was wired but never displayed;
    // the recommended module is applied silently). elEngineChoiceModal is kept
    // null-safe for any defensive checks elsewhere.
    this.elEngineChoiceModal = null;
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
    // Page-settings (/settings) engine form — the real source of truth users see.
    this.elSettingsEngineModule = document.getElementById('settings-engine-module');
    this.elSettingsEngineDepth = document.getElementById('settings-engine-depth');
    this.elSettingsEngineTimeout = document.getElementById('settings-engine-timeout');
    this.elSettingsLiveDeepening = document.getElementById('settings-live-deepening');
    this.elSettingsForcedDepth = document.getElementById('settings-forced-depth');
    this.elSettingsForcedDepthField = document.getElementById('settings-forced-depth-field');
    this.elSettingsReviewStrength = document.getElementById('settings-review-strength');
    this.elSettingsAdvancedToggle = document.getElementById('settings-advanced-toggle');
    this.elSettingsAdvancedEngine = document.getElementById('settings-advanced-engine');
    this.elBtnSaveEngineSettings = document.getElementById('btn-save-engine-settings');
    this.elBtnSaveAppearanceSettings = document.getElementById('btn-save-appearance-settings');
    this.elEngineSettingsStatus = document.getElementById('engine-settings-status');
    this.elAppearanceSettingsStatus = document.getElementById('appearance-settings-status');
    this.elBoardTheme = document.querySelector('input[name="settings-board-theme"]:checked');
    this.elPieceTheme = document.querySelector('input[name="settings-piece-theme"]:checked');
    this.elArrowColor = document.getElementById('settings-arrow-color');
    this.elHighlightColor = document.getElementById('settings-highlight-color');
    this.elPieceAnimations = document.getElementById('settings-piece-animations');
	    this.elAnalysisLocation = document.getElementById('analysis-location');
	    this.elServerBoostToggle = document.getElementById('server-boost-toggle');
	    this.elServerStrongReview = document.getElementById('server-strong-review');
	    this.elServerStrongNote = document.getElementById('server-strong-note');
    this.elEngineLoadProgress = document.getElementById('engine-load-progress');
    this.elEngineLoadProgressFill = document.getElementById('engine-load-progress-fill');
    this.elReviewSummary = document.getElementById('review-summary');
    this.elReviewSaveCta = document.getElementById('review-save-cta');
    this.elReviewSaveCtaClose = document.getElementById('review-save-cta-close');
    this.elProgressBar = document.getElementById('review-progress');
    this.elProgressFill = document.getElementById('progress-fill');
    this.elReviewProgressStep = document.getElementById('review-progress-step');
    // Home: onboarding ribbon, continue card, social proof, streak
    this.elOnboardingProgress = document.getElementById('onboarding-progress');
    this.elOnboardingFill = document.getElementById('onboarding-progress-fill');
    this.elOnboardingLabel = document.getElementById('onboarding-progress-label');
    this.elHomeContinueReview = document.getElementById('home-continue-review');
    this.elHomeContinueMeta = document.getElementById('home-continue-meta');
    this.elHomeStats = document.getElementById('home-stats');
    this.elHomeStatReviews = document.getElementById('home-stat-reviews');
    this.elHomeStatPuzzles = document.getElementById('home-stat-puzzles');
    this.elHomeStatCoaches = document.getElementById('home-stat-coaches');
    this.elMoveBadge = document.getElementById('move-badge');
    this.elBadgeIcon = document.getElementById('badge-icon');
    this.elBadgeText = document.getElementById('badge-text');
    this.elPlayerTop = document.getElementById('player-top');
    this.elPlayerBottom = document.getElementById('player-bottom');
	this.elPlayerTopClock = document.getElementById('player-top-clock');
	this.elPlayerBottomClock = document.getElementById('player-bottom-clock');
    this.elOpeningInfo = document.getElementById('opening-info');
    this.elOpeningName = document.getElementById('opening-name');
    this.elOpeningStats = document.getElementById('opening-stats');
    this._openingCache = new Map(); // uci-sequence -> {opening, stats} | null
    this.elGameStatus = document.getElementById('game-status');
    this.elGameStatusTitle = document.getElementById('game-status-title');
    this.elGameStatusReason = document.getElementById('game-status-reason');
    this.elGameStatusDetails = document.getElementById('game-status-details');

    this.elCapsWhite = document.getElementById('caps-white-val');
	    this.elCapsBlack = document.getElementById('caps-black-val');
	    this.elAcplWhite = document.getElementById('acpl-white-val');
	    this.elAcplBlack = document.getElementById('acpl-black-val');
	    this.elPhaseBreakdown = document.getElementById('phase-breakdown');

	    this.elMoveInsights = document.getElementById('move-insights');
	    this.elInsightEmpty = document.getElementById('insight-empty');
	    this.elInsightContent = document.getElementById('insight-content');
    this.elInsightMove = document.getElementById('insight-move');
    this.elInsightClass = document.getElementById('insight-class');
    this.elInsightClassDesc = document.getElementById('insight-class-desc');
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
	    this.elInsightGate = document.getElementById('insight-gate');
	    this.elInsightGateMove = document.getElementById('insight-gate-move');
	    this.elInsightGateClass = document.getElementById('insight-gate-class');
	    this.elInsightGateClose = document.getElementById('insight-gate-close');

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
		// Coach chat (AI) elements
		this.elCoachPage = document.getElementById('page-coach');
		this.elCoachChatCard = document.getElementById('coach-chat-card');
		this.elCoachChatLocked = document.getElementById('coach-chat-locked');
		this.elCoachChatBody = document.getElementById('coach-chat-body');
		this.elCoachMessages = document.getElementById('coach-chat-messages');
		this.elCoachTyping = document.getElementById('coach-typing');
		this.elCoachTypingText = document.getElementById('coach-typing-text');
		this.elCoachChatForm = document.getElementById('coach-chat-form');
		this.elCoachTextarea = document.getElementById('coach-chat-textarea');
		this.elBtnCoachSend = document.getElementById('btn-coach-send');
		this.elCoachModelToggles = document.querySelectorAll('.coach-model-seg');

	    this.elPuzzleCard = document.getElementById('puzzle-card');
	    this.elPuzzleSource = document.getElementById('puzzle-source');
	    this.elPuzzleUserRating = document.getElementById('puzzle-user-rating');
	    this.elPuzzleTargetRating = document.getElementById('puzzle-target-rating');
	    this.elPuzzleStreak = document.getElementById('puzzle-streak');
	    this.elPuzzleScore = document.getElementById('puzzle-score');
	    this.elPuzzleDailyGoal = document.getElementById('puzzle-daily-goal');
	    this.elPuzzleStreakMeta = document.querySelector('.puzzle-streak-meta');
	    this.elPuzzleStatus = document.getElementById('puzzle-status');
	    this.elPuzzleTags = document.getElementById('puzzle-tags');
	    this.elPuzzleTheme = document.getElementById('puzzle-theme');
	    this.elPuzzleDifficulty = document.getElementById('puzzle-difficulty');
	    this.elBtnPuzzleNext = document.getElementById('btn-puzzle-next');
	    this.elBtnPuzzleDaily = document.getElementById('btn-puzzle-daily');
		    this.elBtnPuzzleRetry = document.getElementById('btn-puzzle-retry');
		    this.elBtnPuzzleHint = document.getElementById('btn-puzzle-hint');
		    this.elBtnPuzzleReview = document.getElementById('btn-puzzle-review');
		    // Skill-level chips + Try-it embed (added in onboarding/settings rework)
		    this.elPuzzleSuccessOverlay = document.getElementById('puzzle-success-overlay');
		    this.elPuzzleLevelEmbedPreview = document.getElementById('puzzle-level-embed-preview');
		    this.elPuzzleLevelEmbedTitle = document.getElementById('puzzle-level-embed-title');
		    this.elPuzzleLevelEmbedSub = document.getElementById('puzzle-level-embed-sub');
		    this.elBtnPuzzleLevelTry = document.getElementById('btn-puzzle-level-try');
		    // Cache per-level sample puzzle so we don't refetch when re-selecting.
		    this._puzzleLevelSamples = {};
		    this._selectedPuzzleLevel = 1500;
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
    this.elBtnPgnSample = document.getElementById('btn-pgn-sample');
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
    this.elSavedUsernameBar = document.getElementById('saved-username-bar');
    this.elSavedUsernameContent = document.getElementById('saved-username-content');
    this.elSavedUsernameList = document.getElementById('saved-username-list');
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
		    // Onboarding wizard controls
		    this.elOnboardProgressFill = document.getElementById('onboard-progress-fill');
		    this.elOnboardStepLabel = document.getElementById('onboard-step-label');
		    this.elOnboardSteps = [
		      document.getElementById('onboard-step-1'),
		      document.getElementById('onboard-step-2'),
		      document.getElementById('onboard-step-3'),
		    ];
		    this.elOnboardBoardTheme = document.querySelector('input[name="onboard-board-theme"]');
		    this.elOnboardPieceTheme = document.querySelector('input[name="onboard-piece-theme"]');
		    this.elOnboardSkill = document.querySelector('input[name="onboard-skill"]');
		    // Coach difficulty + Play-as removed from onboarding. Coach setup is invoked from the /coach popup instead.
		    this.onboardingStep = 1;
		    this.elPageToSignup = document.getElementById('btn-page-to-signup');
		    this.elPageToLogin = document.getElementById('btn-page-to-login');
		    this.elPageAccountSignin = document.getElementById('btn-page-account-signin');
		    this.elPageAccountSignout = document.getElementById('btn-page-account-signout');
		    this.elSettingsSummary = document.getElementById('settings-summary');
		    this.elPageClearCache = document.getElementById('btn-page-clear-cache');
		    // SPA route panels
		    this.elBoostPagePanel = document.getElementById('page-boost');
		    this.elAuthPagePanel = document.getElementById('page-auth');
		    this.elNotFoundPanel = document.getElementById('page-404');
		    this.elIncompatiblePanel = document.getElementById('page-incompatible-browser');
		    this.elPrivacyPage = document.getElementById('page-privacy');
		    this.elTermsPage = document.getElementById('page-terms');
		    this.elProfilePage = document.getElementById('page-profile');
		    this.elContactPage = document.getElementById('page-contact');
		    // SPA Account page bindings (prefixed to avoid duplicate IDs with the modal)
		    this.elSpaAccountDisplayName = document.getElementById('spa-account-display-name');
		    this.elSpaAccountEmailLabel = document.getElementById('spa-account-email-label');
		    this.elSpaAccountPlan = document.getElementById('spa-account-plan');
		    this.elSpaAccountPuzzleRating = document.getElementById('spa-account-puzzle-rating');
		    this.elSpaAccountPuzzlesSolved = document.getElementById('spa-account-puzzles-solved');
		    this.elSpaAccountPuzzlesAttempted = document.getElementById('spa-account-puzzles-attempted');
		    this.elSpaAccountUsage = document.getElementById('spa-account-usage');
		    this.elSpaAccountBoostCta = document.getElementById('spa-account-boost-cta');
		    this.elSpaPageStatus = document.getElementById('spa-page-status');
		    this.elSpaGiftBoostEmail = document.getElementById('spa-gift-boost-email');
		    this.elSpaGiftBoostDays = document.getElementById('spa-gift-boost-days');
		    this.elSpaGiftBoostStatus = document.getElementById('spa-gift-boost-status');
		    this.elSpaAdminOnlineCount = document.getElementById('spa-admin-online-count');
		    this.elSpaAdminTotalVisitors = document.getElementById('spa-admin-total-visitors');
		    this.elSpaAdminOnlineList = document.getElementById('spa-admin-online-list');
		    this.elSpaWarnEmail = document.getElementById('spa-warn-user-email');
		    this.elSpaWarnMessage = document.getElementById('spa-warn-user-message');
		    this.elSpaBanEmail = document.getElementById('spa-ban-user-email');
		    this.elSpaBanReason = document.getElementById('spa-ban-user-reason');
		    this.elSpaSpaResetPassword = document.getElementById('spa-btn-reset-password');
		    // SPA Boost page bindings (prefixed to avoid duplicate IDs with the menu)
		    this.elSpaBoostStatusContainer = document.getElementById('spa-boost-status-container');
		    // HTML renamed this id to `spa-plans-status-title`; alias to the old name too.
		    this.elSpaBoostStatusTitle = document.getElementById('spa-plans-status-title') || document.getElementById('spa-boost-status-title');
		    this.elSpaBoostStatusText = document.getElementById('spa-boost-status-text');
		    this.elSpaBoostAuthRequired = document.getElementById('spa-boost-auth-required');
		    this.elSpaBoostContent = document.getElementById('spa-boost-content');
		    this.elSpaBoostStatus = document.getElementById('spa-boost-status');
		    this.elSpaResetEmail = document.getElementById('reset-email');
		    this.elSpaResetNewPassword = document.getElementById('reset-new-password');
		    this.elSpaResetConfirmPassword = document.getElementById('reset-confirm-password');
		    this.elSpaResetNewPasswordArea = document.getElementById('reset-new-password-area');
		    this.elPageAccountToSignin = document.getElementById('btn-page-account-to-signin');
		    this.elPageAccountToSignup = document.getElementById('btn-page-account-to-signup');
		    this.elBoostToSignin = document.getElementById('btn-boost-to-signin');
		    this.elBoostToSignup = document.getElementById('btn-boost-to-signup');
		    this.elPageAuthToSignin = document.getElementById('btn-page-auth-to-signin');
		    this.elPageAuthToSignup = document.getElementById('btn-page-auth-to-signup');
		    this.elAccountSignedOutPage = document.getElementById('account-signed-out-page');
		    this.elAccountSignedInPage = document.getElementById('account-signed-in-page');
	  }

  _initEngineControls() {
	    this.elEngineSource.value = this.engineSettings.source;
	    this.elEngineStrength.value = this.engineSettings.strength;
	    if (this.elEngineMaxTime) this.elEngineMaxTime.value = String(this.engineSettings.maxTimeMs);
	    if (this.elAnalysisLocation) this.elAnalysisLocation.value = this.engineSettings.analysisLocation;
	    if (this.elServerStrongReview) this.elServerStrongReview.checked = !!this.engineSettings.serverStrongReview;
	    // Populate the /settings page engine form with the saved values.
	    if (this.elSettingsEngineModule) this.elSettingsEngineModule.value = this.engineSettings.module;
	    if (this.elSettingsReviewStrength) this.elSettingsReviewStrength.value = this.engineSettings.reviewStrength || 'standard';
	    if (this.elSettingsAdvancedToggle) this.elSettingsAdvancedToggle.checked = this.engineSettings.advancedEngine === true;
	    if (this.elSettingsEngineDepth) this.elSettingsEngineDepth.value = String(this.engineSettings.customDepth || 16);
	    if (this.elSettingsEngineTimeout) this.elSettingsEngineTimeout.value = String(this.engineSettings.customTimeMs || 8000);
	    if (this.elSettingsLiveDeepening) this.elSettingsLiveDeepening.checked = this.engineSettings.liveDeepening !== false;
	    if (this.elSettingsForcedDepth) this.elSettingsForcedDepth.value = String(this.engineSettings.forcedDepth || 16);
	    this._syncForcedDepthVisibility();
	    this._syncAdvancedEngineVisibility();
	    // Wire the toggles so dependent rows show/hide live.
	    if (this.elSettingsLiveDeepening && !this.elSettingsLiveDeepening.dataset.bound) {
	      this.elSettingsLiveDeepening.addEventListener('change', () => this._syncForcedDepthVisibility());
	      this.elSettingsLiveDeepening.dataset.bound = '1';
	    }
	    if (this.elSettingsAdvancedToggle && !this.elSettingsAdvancedToggle.dataset.bound) {
	      this.elSettingsAdvancedToggle.addEventListener('change', () => this._syncAdvancedEngineVisibility());
	      this.elSettingsAdvancedToggle.dataset.bound = '1';
	    }
	    this._populateEngineModules();
	  }

  // Show the advanced depth/time fields only when "Advanced" is enabled.
  _syncAdvancedEngineVisibility() {
    if (!this.elSettingsAdvancedEngine) return;
    const advanced = this.elSettingsAdvancedToggle ? this.elSettingsAdvancedToggle.checked : false;
    this.elSettingsAdvancedEngine.hidden = !advanced;
  }

  // Show the "Forced Depth" row only when live deepening is OFF.
  _syncForcedDepthVisibility() {
    if (!this.elSettingsForcedDepthField) return;
    const enabled = this.elSettingsLiveDeepening ? this.elSettingsLiveDeepening.checked : true;
    this.elSettingsForcedDepthField.hidden = !!enabled;
  }

	  _getReviewProfile() {
	    // Primary control: review strength tier (Quick/Standard/Thorough), each a
	    // (depth, time cap) pair. Advanced users can pin a custom depth and/or
	    // custom per-move time that override the tier. Depth guarantees cross-move
	    // consistency; the time cap bounds worst-case latency. Drives full reviews
	    // + server analysis + anticheat only (live/coach deepening uses
	    // REVIEW_PROFILES via _getAnalysisDepthLadder and is NOT capped here).
	    const tiers = (window.REVIEW_STRENGTH_TIERS || REVIEW_STRENGTH_TIERS);
	    const resolveTier = window.getReviewStrengthTier || getReviewStrengthTier;
	    const tier = resolveTier(this.engineSettings.reviewStrength || 'standard');
	    const advanced = this.engineSettings.advancedEngine === true;
	    const clampDepth = (d) => Math.max(8, Math.min(Number(d) || tier.depth, 26));
	    const clampTime = (t) => Math.max(500, Math.min(Number(t) || tier.timeoutMs, 30000));
	    const depth = advanced && this.engineSettings.customDepth
	      ? clampDepth(this.engineSettings.customDepth)
	      : tier.depth;
	    // The per-move time cap is overridable from two places: the /settings
	    // Advanced mode (advancedEngine + customTimeMs) and the in-review
	    // "Maximum Time" dropdown (maxTimeOverride + customTimeMs). Depth is NOT
	    // affected by the in-review dropdown — only Advanced mode overrides
	    // depth — so toggling max time from a review can't silently change the
	    // search depth. maxTimeOverride is set ONLY by the in-review dropdown, so
	    // users who never touched it keep the tier's default time cap.
	    const overrideTime = (advanced || this.engineSettings.maxTimeOverride === true)
	      && this.engineSettings.customTimeMs;
	    const timeoutMs = overrideTime
	      ? clampTime(this.engineSettings.customTimeMs)
	      : tier.timeoutMs;
	    return {
	      key: tier.key,
	      label: tier.label,
	      depth,
	      multiPv: tier.multiPv,
	      timeoutMs,
	      battleDepth: Math.max(8, depth - 2),
	    };
	  }

		  _showPopup(options = {}) {
		    if (window.AppDialog?.open) {
		      return window.AppDialog.open(options);
		    }
		    const confirmed = !options.showCancelButton || window.confirm([options.title, options.text || options.message || ''].filter(Boolean).join('\n'));
		    return Promise.resolve({ isConfirmed: confirmed, isDismissed: !confirmed });
		  }

		  // Non-blocking loading popup (SweetAlert2). Returns a close handle. Used
		  // for recent-games fetches from the home screen and import modal so the
		  // user always sees a clear loading state while network requests run.
		  _showLoadingPopup(message = 'Loading…') {
		    if (window.Swal?.fire) {
		      window.Swal.fire({
		        title: message,
		        allowOutsideClick: false,
		        allowEscapeKey: false,
		        showConfirmButton: false,
		        didOpen: (popup) => {
		          if (window.Swal?.showLoading) window.Swal.showLoading();
		          try {
		            const loader = popup?.querySelector('.swal2-loader, .swal2-spinner');
		            if (loader) loader.style.borderColor = 'var(--accent, #1976d2)';
		          } catch (_) {}
		        },
		      });
		      return () => window.Swal?.close?.();
		    }
		    // Fallback: no popup, but the import-status text still acts as indicator.
		    return () => {};
		  }

		  _swalContentRoot() {
		    return window.Swal?.getHtmlContainer?.() || window.Swal?.getPopup?.() || null;
		  }

		  _showUserWarning(warning = {}) {
		    const message = String(warning.message || '').trim();
		    if (!message) return;
		    return this._showPopup({
		      icon: 'warning',
		      title: 'Message from admin',
		      text: message,
		      confirmButtonText: 'OK',
		      allowOutsideClick: false,
		    });
		  }

		  _recordSiteVisit() {
		    if (sessionStorage.getItem('sidastuff.visitRecorded')) return;
		    apiFetch('/api/site/visit', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
		    sessionStorage.setItem('sidastuff.visitRecorded', '1');
		  }

		

  _saveEngineSettings() {
    // The /settings page engine form is the source of truth: engine module,
    // review strength tier (Quick/Standard/Thorough) OR advanced custom depth +
    // per-move time. analysisLocation and serverStrongReview come from their own
    // (in-review) controls.
    const module = (this.elSettingsEngineModule?.value || this.engineSettings.module || 'lite-single');
    const reviewStrength = (this.elSettingsReviewStrength?.value || this.engineSettings.reviewStrength || 'standard');
    const advancedEngine = this.elSettingsAdvancedToggle ? this.elSettingsAdvancedToggle.checked : (this.engineSettings.advancedEngine === true);
    const customDepth = Math.max(8, Math.min(Number(this.elSettingsEngineDepth?.value) || 16, 26));
    const customTimeMs = Math.max(500, Math.min(Number(this.elSettingsEngineTimeout?.value) || 8000, 30000));
    const liveDeepening = this.elSettingsLiveDeepening ? this.elSettingsLiveDeepening.checked : (this.engineSettings.liveDeepening !== false);
    const forcedDepth = Math.max(8, Math.min(Number(this.elSettingsForcedDepth?.value) || 16, 30));
    // Map the strength tier onto a legacy `strength` profile key so the live/
    // coach deepening ladder (_getAnalysisDepthLadder, which reads REVIEW_PROFILES)
    // still resolves a sensible base rung.
    const strengthForLive = { quick: 'depth10', standard: 'depth14', thorough: 'depth18' }[reviewStrength] || 'depth14';
    const settings = {
      source: this.engineSettings.source,
      module,
      reviewStrength,
      advancedEngine,
      customDepth,
      customTimeMs,
      // Legacy keys kept for back-compat (live-deepening ladder reads `strength`).
      strength: strengthForLive,
      depthProfile: strengthForLive,
      liveDeepening,
      forcedDepth,
      analysisLocation: this.elAnalysisLocation?.value || this.engineSettings.analysisLocation,
      serverStrongReview: this.elServerStrongReview?.checked ?? this.engineSettings.serverStrongReview,
    };
    this.engineSettings = { ...this.engineSettings, ...settings };
    this._persistEngineSettings();
    if (this.elEngineSettingsStatus) {
      this.elEngineSettingsStatus.textContent = 'Engine settings saved!';
      this.elEngineSettingsStatus.className = 'account-status success';
    }
    this._syncServerStrongToggle();
    // Persist + reload for a clean refresh so the new engine build, depth, and
    // cache all initialize from scratch.
    this._saveAndReload();
  }

  // Persist is already done by the caller; this just gives the user a brief
  // "saved" confirmation, then reloads the page so settings apply cleanly.
  _saveAndReload(message = 'Saved. Reloading…') {
    // Show a brief confirmation, then reload. The short delay lets the status
    // text paint before the navigation tears the page down.
    try { window.dispatchEvent(new Event('app-settings-saved')); } catch (_) {}
    setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 350);
  }

  _saveAppearanceSettings() {
    // Save appearance settings to localStorage
    const boardTheme = document.querySelector('input[name="settings-board-theme"]:checked')?.value
      || this.elBoardTheme?.value || 'classic';
    const pieceTheme = document.querySelector('input[name="settings-piece-theme"]:checked')?.value
      || this.elPieceTheme?.value || 'classic';
    const settings = {
      boardTheme,
      pieceTheme,
      arrowColor: this.elArrowColor?.value || '#d88a1d',
      highlightColor: this.elHighlightColor?.value || '#d22626',
      pieceAnimations: this.elPieceAnimations?.checked || false
    };
    localStorage.setItem('sidastuff.appearanceSettings', JSON.stringify(settings));
    if (this.elAppearanceSettingsStatus) {
      this.elAppearanceSettingsStatus.textContent = 'Appearance settings saved!';
      this.elAppearanceSettingsStatus.className = 'account-status success';
    }
    this._applyAppearanceSettings(settings);
    this._saveAndReload();
  }

  // Populate the settings-page appearance form with the values currently
  // saved in localStorage so the radio chips / colors reflect what's applied
  // (previously the form always showed the HTML defaults).
  _loadAppearanceSettingsIntoUi() {
    let saved = {};
    try {
      const raw = localStorage.getItem('sidastuff.appearanceSettings');
      saved = raw ? JSON.parse(raw) : {};
    } catch (_) { saved = {}; }
    // Radios: set `checked` on the matching chip.
    const checkRadio = (name, value) => {
      if (!value) return;
      const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
      if (el) el.checked = true;
    };
    checkRadio('settings-board-theme', saved.boardTheme);
    checkRadio('settings-piece-theme', saved.pieceTheme);
    if (this.elArrowColor && saved.arrowColor) this.elArrowColor.value = saved.arrowColor;
    if (this.elHighlightColor && saved.highlightColor) this.elHighlightColor.value = saved.highlightColor;
    if (this.elPieceAnimations && typeof saved.pieceAnimations === 'boolean') {
      this.elPieceAnimations.checked = saved.pieceAnimations;
    }
  }

  _applyAppearanceSettings(settings = null) {
    // Apply saved appearance settings
    const saved = settings || (() => {
      try {
        const s = localStorage.getItem('sidastuff.appearanceSettings');
        return s ? JSON.parse(s) : {};
      } catch (_) { return {}; }
    })();

    // Apply board theme. NOTE: the class-based theme is largely superseded by
    // the body[data-board-theme] dataset that board.js + the CSS vars use, but
    // we keep the class in sync too. The regex strips any prior theme class —
    // `\w+` (was previously `w+`, which matched a literal "w+" and never
    // removed the old class, causing classes to pile up on every change).
    if (saved.boardTheme) {
      document.body.className = document.body.className.replace(/board-theme-\w+/g, '').replace(/\s+/g, ' ').trim();
      document.body.classList.add('board-theme-' + saved.boardTheme);
    }

    // Apply piece theme
    if (saved.pieceTheme) {
      document.body.className = document.body.className.replace(/piece-theme-\w+/g, '').replace(/\s+/g, ' ').trim();
      document.body.classList.add('piece-theme-' + saved.pieceTheme);
    }

    // Update board theme via dataset (board.js reads these attributes)
    if (this.board) {
      if (saved.boardTheme) document.body.dataset.boardTheme = saved.boardTheme;
      if (saved.pieceTheme) document.body.dataset.pieceTheme = saved.pieceTheme;
      if (saved.pieceAnimations !== undefined) {
        document.body.dataset.pieceAnimations = saved.pieceAnimations ? 'on' : 'off';
      }
    }

    // Apply color settings
    if (saved.arrowColor && this.arrowColor) {
      this.arrowColor = saved.arrowColor;
    }
    if (saved.highlightColor && this.highlightColor) {
      this.highlightColor = saved.highlightColor;
    }
    if (saved.pieceAnimations !== undefined && this.board) {
      this.board.enableAnimations(saved.pieceAnimations);
    }
    // Keep the settings-page preview in sync with whatever was just applied.
    this._renderBoardPreview?.();
  }

  // Render a small 4x4 preview board with sample pieces into the Board
  // Appearance section of the settings page. Squares use the live
  // --sq-light/--sq-dark CSS vars (driven by body[data-board-theme]); pieces
  // use getPieceSvgUri (driven by body[data-pieceTheme]), so the preview
  // reflects the selected themes. Re-rendered on theme change and on save.
  _renderBoardPreview(containerId = 'appearance-board-preview') {
    const container = document.getElementById(containerId);
    if (!container) return;
    // Layout: a4=light, so square (r,c) is light when (r+c) is even.
    // Sample a couple of pieces on each side to show off both colors.
    const pieceAt = (r, c) => {
      const map = {
        '0_0': 'wR', '0_1': 'wN', '0_2': 'wB', '0_3': 'wQ',
        '1_0': 'wP', '1_3': 'wK',
        '2_0': 'bK', '2_3': 'bP',
        '3_0': 'bQ', '3_1': 'bB', '3_2': 'bN', '3_3': 'bR',
      };
      return map[`${r}_${c}`] || '';
    };
    const squares = [];
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        const isLight = (r + c) % 2 === 0;
        const piece = pieceAt(r, c);
        const img = piece && window.getPieceSvgUri ? `<img src="${window.getPieceSvgUri(piece)}" alt="${piece}" loading="lazy">` : '';
        squares.push(`<div class="preview-square ${isLight ? 'light' : 'dark'}">${img}</div>`);
      }
    }
    container.innerHTML = squares.join('');
  }

  _initRouting() {
		    const params = new URLSearchParams(window.location.search);
		    const spaRoute = params.get('spa-route');
		    const pageRoute = document.body.dataset.page ? `/${document.body.dataset.page}` : '';
		    let currentPath = pageRoute || this._normalizeRoute(window.location.pathname || '/index');
		    if (spaRoute) {
		      const normalized = this._normalizeRoute(spaRoute.startsWith('/') ? spaRoute : `/${spaRoute}`);
		      // Rewrite the URL to the clean SPA path and drop the query param.
		      const cleanUrl = this._routeUrl(normalized);
		      const remainingParams = new URLSearchParams();
		      params.forEach((value, key) => {
		        if (key !== 'spa-route') remainingParams.set(key, value);
		      });
		      const search = remainingParams.toString();
		      window.history.replaceState({}, '', cleanUrl + (search ? `?${search}` : '') + window.location.hash);
		      currentPath = normalized;
		    }
		    if (!this._browserMeetsRequirements()) {
		      this._applyRoute('/incompatible-browser', { replace: true });
		      return;
		    }
		    this._applyRoute(currentPath, { replace: true, skipHistory: true });
		    window.addEventListener('popstate', () => {
		      const route = this._normalizeRoute(window.location.pathname || '/index');
		      // disableRestore so Back/Forward doesn't re-prompt "Continue
		      // review?" for a game the user already resumed or dismissed.
		      this._applyRoute(route, { skipHistory: true, disableRestore: true });
		    });
		    this._installLinkInterceptor();
		    document.addEventListener('app-navigate', (e) => {
		      const route = e.detail?.route;
		      if (route) this._navigateTo(route);
		    });
		  }

		  _browserMeetsRequirements() {
		    try {
		      const storageKey = '__chess_feature_test__';
		      window.localStorage.setItem(storageKey, '1');
		      window.localStorage.removeItem(storageKey);
		    } catch (_err) {
		      return false;
		    }
		    return !!(window.WebAssembly && window.Worker && window.fetch && window.Promise && window.URL);
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
		      '/login': '/signin',
		      '/signup': '/signup',
		      '/account': '/account',
		      '/settings': '/settings',
		      '/auth': '/auth',
		      '/boost': '/plans',
		      '/plans': '/plans',
		      '/review': '/review',
	      '/coach': '/coach',
	      '/puzzles': '/puzzles',
	      '/anticheat': '/anticheat',
	      '/privacy': '/privacy',
	      '/terms': '/terms',
	      '/404': '/404',
		      '/incompatible-browser': '/incompatible-browser',
		    };
		    return map[route] || `${route}`;
		  }

		  _isSameRoute(a, b) {
		    return this._normalizeRoute(a) === this._normalizeRoute(b);
		  }

		  _navigateTo(path, options = {}) {
		    const route = this._normalizeRoute(path || '/index');
		    const target = this._routeUrl(route);
		    const current = this._normalizeRoute(window.location.pathname || '/index');
		    // Forward skipImport so callers (the coach's game_review tool) can
		    // suppress the "Import Games" popup when loading a PGN directly.
		    const passOpts = { skipHistory: true, disableRestore: options.disableRestore, skipImport: options.skipImport };
		    if (current === route) {
		      this._applyRoute(route, passOpts);
		      return;
		    }
		    if (options.replace) {
		      window.history.replaceState({}, '', target);
		    } else {
		      window.history.pushState({}, '', target);
		    }
		    this._applyRoute(route, passOpts);
		  }

_installLinkInterceptor() {
		    document.addEventListener('click', (event) => {
		      if (event.defaultPrevented) return;
		      if (event.button !== 0) return;
		      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		      const anchor = event.target?.closest ? event.target.closest('a[href]') : null;
		      if (!anchor) return;
			  const href = anchor.getAttribute('href');
			  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
			  if (anchor.target && anchor.target !== '_self') return;
			  if (anchor.hasAttribute('download')) return;
			  let url;
			  try { url = new URL(href, window.location.href); } catch (_) { return; }
			  if (url.origin !== window.location.origin) return;
			  // Bare cross-page links with no data-route are still intercepted if they map to a known SPA route.
			  const route = this._normalizeRoute(url.pathname);
			  const knownRoutes = [
			    '/index', '/login', '/signup', '/account', '/settings', '/auth',
			    '/plans', '/boost', '/review', '/coach', '/puzzles', '/anticheat',
			    '/privacy', '/terms', '/contact',
			  ];
			  if (!knownRoutes.includes(route) && !route.startsWith('/profile/')) return;
			  event.preventDefault();
			  this._navigateTo(route);
		    }, true);
		  }

		  _hideRoutePages() {
		    if (this.elLoginPage) this.elLoginPage.hidden = true;
		    if (this.elSignupPage) this.elSignupPage.hidden = true;
		    if (this.elAccountPage) this.elAccountPage.hidden = true;
		    if (this.elSettingsPage) this.elSettingsPage.hidden = true;
		    if (this.elBoostPagePanel) this.elBoostPagePanel.hidden = true;
		    if (this.elCoachPage) this.elCoachPage.hidden = true;
		    if (this.elAuthPagePanel) this.elAuthPagePanel.hidden = true;
if (this.elPrivacyPage) this.elPrivacyPage.hidden = true;
if (this.elProfilePage) this.elProfilePage.hidden = true;
if (this.elContactPage) this.elContactPage.hidden = true;
if (this.elTermsPage) this.elTermsPage.hidden = true;
		    if (this.elNotFoundPanel) this.elNotFoundPanel.hidden = true;
		    if (this.elIncompatiblePanel) this.elIncompatiblePanel.hidden = true;
		  }

		  _updateNavActiveState() {
		    const navLinks = document.querySelectorAll('.apple-nav a');
		    if (!navLinks.length) return;
		    const currentPath = this._normalizeRoute(window.location.pathname || '/') || '/index';
		    navLinks.forEach((link) => {
		      const href = link.getAttribute('href');
		      link.classList.remove('active');
		      if (href) {
		        const linkPath = this._normalizeRoute(href);
		        if (linkPath === currentPath) link.classList.add('active');
		      }
		    });
		  }

	  // Mobile nav drawer open/close helpers. Toggle the scrim, body scroll-lock,
	  // and the hamburger ↔ close icon.
	  _setMobileNavOpen(open) {
	    if (!this.elAppleNav) return;
	    this.elAppleNav.classList.toggle('open', !!open);
	    this.elAppleNavToggle?.setAttribute('aria-expanded', String(!!open));
	    document.body.classList.toggle('nav-open', !!open);
	    if (this.elNavScrim) this.elNavScrim.hidden = !open;
	    const icon = this.elAppleNavToggle?.querySelector('.material-symbols-outlined');
	    if (icon) icon.textContent = open ? 'close' : 'menu';
	  }

	  _closeMobileNav() {
	    if (this.elAppleNav?.classList.contains('open')) this._setMobileNavOpen(false);
	  }

		  _showRoutePage(name) {
		    this._hideRoutePages();
		    if (this.elMainContent) this.elMainContent.hidden = false;
		    if (name === 'login' && this.elLoginPage) {
		      this.elLoginPage.hidden = false;
		    } else if (name === 'signup' && this.elSignupPage) {
		      this.elSignupPage.hidden = false;
		    } else if (name === 'account' && this.elAccountPage) {
		      this.elAccountPage.hidden = false;
		      this._bindSpaAccountPageEvents();
		      // Pull fresh quota first, then render so usage bars are accurate.
		      this._refreshUsageBeforeAction().finally(() => this._renderSpaAccount());
		    } else if (name === 'settings' && this.elSettingsPage) {
		      this.elSettingsPage.hidden = false;
		      this._injectClearSavedGamesButton();
		      // Populate the form with saved values and render the live preview.
		      this._loadAppearanceSettingsIntoUi();
		      this._renderBoardPreview();
		    } else if (name === 'boost' && this.elBoostPagePanel) {
		      this.elBoostPagePanel.hidden = false;
		      this._bindSpaBoostPageEvents();
		    } else if (name === 'coach' && this.elCoachPage) {
		      this.elCoachPage.hidden = false;
		      if (this.coachChat.active) this._renderCoachGate();
		    } else if (name === 'auth' && this.elAuthPagePanel) {
		      this.elAuthPagePanel.hidden = false;
		      this._bindSpaAuthPageEvents();
	    } else if (name === 'privacy' && this.elPrivacyPage) {
	      this.elPrivacyPage.hidden = false;
	    } else if (name === 'terms' && this.elTermsPage) {
	      this.elTermsPage.hidden = false;
	    } else if (name === 'profile' && this.elProfilePage) {
	      this.elProfilePage.hidden = false;
	    } else if (name === 'contact' && this.elContactPage) {
	      this.elContactPage.hidden = false;
		    } else if (name === '404' && this.elNotFoundPanel) {
		      this.elNotFoundPanel.hidden = false;
		    } else if (name === 'incompatible-browser' && this.elIncompatiblePanel) {
		      this.elIncompatiblePanel.hidden = false;
		    }
		  }

	  // ── Onboarding wizard (multi-step signup) ─────────────────────────
	  // 3 steps: appearance → skill → email/password. The progress bar starts
	  // visibly underway (40% on step 1, 70% on step 2) so the user feels they've
	  // already begun — research shows a head-start measurably boosts completion.
	  _initOnboarding() {
	    // Reset to step 1 whenever the signup route is (re)shown.
	    this.onboardingStep = 1;
	    this._setOnboardingStep(1);

	    // Live preview: apply the chosen theme immediately so the preview board
	    // updates and the board theme takes effect the moment a chip is picked.
	    const applyLive = () => {
	      const settings = this._onboardingAppearance();
	      try { localStorage.setItem('sidastuff.appearanceSettings', JSON.stringify(settings)); } catch (_) {}
	      this._applyAppearanceSettings(settings);
	      this._renderBoardPreview('onboard-board-preview');
	    };
	    // Re-resolve the cached "currently checked" radios on every change so
	    // _onboardingAppearance() always reads the freshly-picked value.
	    const refreshRefs = () => {
	      this.elOnboardBoardTheme = document.querySelector('input[name="onboard-board-theme"]:checked');
	      this.elOnboardPieceTheme = document.querySelector('input[name="onboard-piece-theme"]:checked');
	    };
	    const onBoardChange = (e) => { refreshRefs(); applyLive(); };
	    document.querySelectorAll('input[name="onboard-board-theme"]').forEach((el) => el.addEventListener('change', onBoardChange));
	    document.querySelectorAll('input[name="onboard-piece-theme"]').forEach((el) => el.addEventListener('change', onBoardChange));

	    // Skill chip — live-update puzzleMode.rating so the live preview / state mirrors the choice.
	    document.querySelectorAll('input[name="onboard-skill"]').forEach((el) => el.addEventListener('change', () => {
	      this.elOnboardSkill = document.querySelector('input[name="onboard-skill"]:checked');
	      const elo = parseInt(this.elOnboardSkill?.value, 10);
	      if (Number.isFinite(elo)) this.puzzleMode.rating = elo;
	    }));

	    document.getElementById('btn-onboard-next-1')?.addEventListener('click', () => this._setOnboardingStep(2));
	    document.getElementById('btn-onboard-next-2')?.addEventListener('click', () => this._setOnboardingStep(3));
	    document.getElementById('btn-onboard-back-2')?.addEventListener('click', () => this._setOnboardingStep(1));
	    document.getElementById('btn-onboard-back-3')?.addEventListener('click', () => this._setOnboardingStep(2));
	    // "Skip" jumps straight to account creation, keeping whatever defaults are selected.
	    document.getElementById('btn-onboard-skip-1')?.addEventListener('click', () => this._setOnboardingStep(3));
	    document.getElementById('btn-onboard-skip-2')?.addEventListener('click', () => this._setOnboardingStep(3));

	    // Render the preview once with current (default) settings.
	    this._renderBoardPreview('onboard-board-preview');
	  }

	  _onboardingAppearance() {
	    const checkedBoard = document.querySelector('input[name="onboard-board-theme"]:checked');
	    const checkedPiece = document.querySelector('input[name="onboard-piece-theme"]:checked');
	    return {
	      boardTheme: checkedBoard?.value || this.elOnboardBoardTheme?.value || 'classic',
	      pieceTheme: checkedPiece?.value || this.elOnboardPieceTheme?.value || 'classic',
	      arrowColor: '#d88a1d',
	      highlightColor: '#d22626',
	      pieceAnimations: true,
	    };
	  }

	  _setOnboardingStep(n) {
	    this.onboardingStep = n;
	    const steps = this.elOnboardSteps || [];
	    steps.forEach((el, idx) => { if (el) el.hidden = (idx + 1) !== n; });
	    // Step 1 paints 40% (visibly underway), step 2 paints 70%, step 3 = done.
	    const pct = n === 1 ? 40 : n === 2 ? 70 : 100;
	    if (this.elOnboardProgressFill) this.elOnboardProgressFill.style.width = `${pct}%`;
	    if (this.elOnboardStepLabel) this.elOnboardStepLabel.textContent = `Step ${n} of 3`;
	    // Focus the first input of the newly shown step for keyboard users.
	    const stepEl = steps[n - 1];
	    if (stepEl) {
	      const focusable = stepEl.querySelector('input, select, button');
	      if (focusable) try { focusable.focus({ preventScroll: true }); } catch (_) {}
	    }
	  }

	  // Persist onboarding choices into the live app state + appearance storage so
	  // the post-signup _saveUserProfile picks them up. Called right before the
	  // email/password or Google auth runs.
	  _persistOnboardingChoices() {
	    // Appearance (already written live in step 1; ensure it's set even on Skip).
	    try { localStorage.setItem('sidastuff.appearanceSettings', JSON.stringify(this._onboardingAppearance())); } catch (_) {}

	    // Skill → starting puzzle ELO. _handleEmailAuth's signup payload reads
	    // this.puzzleMode.rating, so seeding it here flows the chosen ELO into
	    // the new profile.
	    const checkedSkill = document.querySelector('input[name="onboard-skill"]:checked');
	    const skillElo = parseInt(checkedSkill?.value, 10);
	    if (Number.isFinite(skillElo)) this.puzzleMode.rating = skillElo;

	    // Coach difficulty + Play-as no longer live in onboarding. The live
	    // /coach popup collects them per-session; we leave coachMode defaults
	    // (elo=1200, humanColor='w', aiAdjust=true, adjustStyle='better')
	    // untouched so the popup's prefill matches a fresh user.
	  }

	  // A returning user who signed in without completing onboarding finishes it
	  // here: persist their onboarding choices + set the onboardingComplete flag
	  // server-side, then send them to /account. (No new Firebase account to create.)
	  async _finishOnboardingForSignedInUser() {
	    this._showAppLoadingOverlay('Saving your setup...');
	    try {
	      await this._saveUserProfile({
	        ...this.authState.profile,
	        puzzleRating: this.puzzleMode.rating || this.authState.profile?.puzzleRating || 1500,
	        coachMode: {
	          elo: this.coachMode.elo || 1200,
	          humanColor: this.coachMode.humanColor || 'w',
	          aiAdjust: this.coachMode.aiAdjust !== false,
	          adjustStyle: this.coachMode.adjustStyle || 'better',
	        },
	        appearanceSettings: this._onboardingAppearance(),
	        onboardingComplete: true,
	      });
	    } catch (_err) {
	      // Profile save is best-effort; still proceed so the user isn't stuck.
	    } finally {
	      this._hideAppLoadingOverlay();
	    }
	    this._navigateTo('/account', { replace: true });
	    setTimeout(() => window.location.reload(), 400);
	  }

	  _isInAppPage(route) {
		    return ['/login', '/signup', '/account', '/settings', '/plans', '/boost', '/auth', '/404', '/incompatible-browser'].includes(route);
		  }

  // IKEA effect + onboarding-not-at-0%: when a guest arrives at signup from the
  // post-review "Save my review" CTA (?src=review), reframe the copy around the
  // work they JUST did. The review was Step 1; this is Step 2 of 2.
  _applySignupContext() {
    const eyebrow = document.getElementById('signup-eyebrow');
    const headline = document.getElementById('signup-headline');
    const subtitle = document.getElementById('signup-subtitle');
    const params = new URLSearchParams(window.location.search);
    const fromReview = params.get('src') === 'review';
    if (!eyebrow || !headline || !subtitle) return;
    if (fromReview) {
      eyebrow.textContent = 'Step 2 of 2 — almost there';
      headline.textContent = 'Save the review you just ran';
      subtitle.textContent = 'Create your free account to save this review, track accuracy over time, and pick up where you left off.';
    } else {
      eyebrow.textContent = 'Create your free account';
      headline.textContent = 'Start training stronger chess';
      subtitle.textContent = 'Sign up with email to save your analysis, unlock coach progress, and track puzzle performance.';
    }
  }

		  // ── Public profile ────────────────────────────────────────────────
	  async _loadPublicProfile(username) {
	    const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
	    show('profile-loading', true); show('profile-not-found', false); show('profile-content', false);
	    if (!username) { show('profile-loading', false); show('profile-not-found', true); return; }
	    try {
	      const resp = await apiFetch(`/api/profile/${encodeURIComponent(username)}`, { cache: 'no-store' });
	      if (!resp.ok) { show('profile-loading', false); show('profile-not-found', true); return; }
	      const data = await resp.json();
	      this._renderPublicProfile(data.profile || {});
	    } catch (_err) {
	      show('profile-loading', false); show('profile-not-found', true);
	    }
	  }

	  _renderPublicProfile(profile) {
	    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
	    const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
	    show('profile-loading', false);
	    show('profile-content', true);
	    show('profile-not-found', false);
	    const username = profile.username || 'Player';
	    setText('profile-username', username);
	    setText('profile-rating', Math.round(Number(profile.puzzleRating) || 1500));
	    setText('profile-solved', Math.max(0, Number(profile.puzzleStats?.solved) || 0));
	    setText('profile-attempted', Math.max(0, Number(profile.puzzleStats?.attempted) || 0));
	    setText('profile-streak', Math.max(0, Number(profile.puzzleStats?.streak) || 0));
	    const avatar = document.getElementById('profile-avatar');
	    if (avatar) avatar.textContent = (username[0] || '?').toUpperCase();
	    const since = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : '';
	    setText('profile-member-since', since ? `Member since ${since}` : '');
	    // Plan flair badge
	    const badge = document.getElementById('profile-plan-badge');
	    if (badge) {
	      badge.textContent = this._planBadgeLabel(profile.plan);
	      badge.className = `plan-badge ${this._planBadgeClass(profile.plan)}`;
	    }
	    // Owner affordance: if this is the signed-in user's own profile, show edit.
	    const isOwner = !!this.authState.user && this.authState.profile?.username?.toLowerCase() === String(username).toLowerCase();
	    show('profile-owner-actions', isOwner);
	    // Share button (bound once)
	    this._bindProfileShare(username);
	    document.title = `${username} | SiDaStuff Chess`;
	  }

	  _bindProfileShare(username) {
	    const btn = document.getElementById('btn-profile-share');
	    if (!btn) return;
	    // Re-bind each render: the panel persists but username can change, and
	    // we want the latest link. Remove any prior handler via clone.
	    const fresh = btn.cloneNode(true);
	    btn.parentNode.replaceChild(fresh, btn);
	    fresh.addEventListener('click', async () => {
	      const url = `${window.location.origin}/profile/${encodeURIComponent(username)}`;
	      const setStatus = (msg) => {
	        const el = document.getElementById('profile-share-status');
	        if (el) { el.textContent = msg; el.className = 'profile-share-status success'; }
      };
	      try {
	        await navigator.clipboard.writeText(url);
	        setStatus('Link copied to clipboard.');
	      } catch (_) {
	        // Fallback: select-and-prompt
	        window.prompt('Copy this link:', url);
	      }
	    });
	  }

	  _planBadgeLabel(plan) {
	    // Tier product names: the paid tier is "Boost" (the nav/page is "Plans",
	    // but the badge labels the tier itself, so it must say Boost).
	    return plan === 'boost' ? 'Boost' : plan === 'max' ? 'Max' : 'Free';
	  }

	  _planBadgeClass(plan) {
	    return plan === 'boost' ? 'boost' : plan === 'max' ? 'max' : 'free';
	  }

	  // ── Contact page ──────────────────────────────────────────────────
	  _initContactPage() {
	    const emailInput = document.getElementById('contact-email');
	    // Auto-fill the signed-in user's email.
	    if (emailInput && this.authState.user?.email) emailInput.value = this.authState.user.email;
	    const btn = document.getElementById('btn-contact-submit');
	    if (btn && !btn.dataset.bound) {
	      btn.dataset.bound = '1';
	      btn.addEventListener('click', () => this._submitContact());
	    }
	  }

	  async _submitContact() {
	    const email = document.getElementById('contact-email')?.value?.trim();
	    const reason = document.getElementById('contact-reason')?.value || 'general';
	    const message = document.getElementById('contact-message')?.value?.trim();
	    const status = document.getElementById('contact-status');
	    const set = (m, c) => { if (status) { status.textContent = m; status.className = `account-status ${c}`; } };
	    if (!email) { set('Enter your email.', 'error'); return; }
	    if (!message || message.length < 5) { set('Please write a short message.', 'error'); return; }
	    set('Sending…', '');
	    try {
	      const res = await apiFetch('/api/contact', {
	        method: 'POST', headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({ email, reason, message }),
	      });
	      const data = await res.json().catch(() => ({}));
	      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
	      set('Message sent — we\'ll get back to you soon.', 'success');
	      const msg = document.getElementById('contact-message'); if (msg) msg.value = '';
	    } catch (err) { set(err.message || 'Could not send. Try again.', 'error'); }
	  }

	  // Forgot-password from the sign-in page: send a reset email to the
	  // address in the login-email field (or prompt if empty).
	  async _handleLoginPageForgotPassword() {
	    const firebase = this._ensureFirebase();
	    const email = (this.elLoginEmail?.value || '').trim();
	    const status = this.elLoginStatus;
	    const set = (m, c) => { if (status) { status.textContent = m; status.className = `account-status ${c}`; } };
	    if (!email) { set('Enter your email above first, then tap "Forgot password".', 'error'); this.elLoginEmail?.focus(); return; }
	    if (!firebase?.auth) { set('Reset is unavailable right now.', 'error'); return; }
	    set('Sending reset email…', '');
	    try {
	      await firebase.auth().sendPasswordResetEmail(email);
	      set('Check your inbox for a reset link.', 'success');
	    } catch (err) {
	      set(this._friendlyAuthError(err), 'error');
	    }
	  }

	  _enterInAppLayout() {
		    // Stop the chess game, hide main menu, hide main content. Show only the routed panel.
		    if (this.elMainMenu) this.elMainMenu.hidden = true;
		    if (this.elMainContent) this.elMainContent.hidden = false;
		    if (this.elBoostPage) this.elBoostPage.hidden = true;
		    this.coachMode.active = false;
		    this.coachMode.thinking = false;
		    this.puzzleMode.active = false;
		    this.anticheatMode.active = false;
		    this._syncCoachVisibility();
		    this._syncPuzzleVisibility();
		    this._syncAnticheatVisibility();
		    delete document.body.dataset.mode;
		    document.body.classList.remove('menu-active');
		    document.body.classList.add('in-app-route');
		  }

		  _renderSpaAccount() {
		    if (!this.elAccountSignedOutPage || !this.elAccountSignedInPage) return;
		    const signedIn = !!this.authState.user;
		    // While Firebase auth is still resolving (initialized === false),
		    // show neither view — otherwise a signed-in user flashes the "Sign In"
		    // panel before onAuthStateChanged fires. Re-rendered from the callback.
		    if (this.authState.initialized === false) {
		      this.elAccountSignedOutPage.hidden = true;
		      this.elAccountSignedInPage.hidden = true;
		      const _loading = document.getElementById('account-loading');
		      if (_loading) _loading.hidden = false;
		      return;
		    }
		    const _loadingDone = document.getElementById('account-loading');
		    if (_loadingDone) _loadingDone.hidden = true;
		    this.elAccountSignedOutPage.hidden = signedIn;
		    this.elAccountSignedInPage.hidden = !signedIn;
		    const user = this.authState.user;
		    const me = this.authState.me;
		    if (!signedIn || !me) return;
		    const profile = me.profile || {};
		    const plan = me.plan || { name: 'Free', plan: 'free' };
		    const stats = profile.puzzleStats || {};
		    const usage = me.usage || {};
		    const limits = me.limits || {};
		    const setText = (id, value) => {
		      const el = id ? document.getElementById(id) : null;
		      if (el) el.textContent = value;
		    };
		    setText('spa-account-display-name', profile.username || user.displayName || 'Player');
		    setText('spa-account-email-label', user.email || profile.email || '');
		    setText('spa-account-plan', plan.name || 'Free');
		    setText('spa-account-puzzle-rating', Math.round(Number(profile.puzzleRating) || 1500));
		    setText('spa-account-puzzles-solved', Math.max(0, Number(stats.solved) || 0));
		    setText('spa-account-puzzles-attempted', Math.max(0, Number(stats.attempted) || 0));
		    // Plan-aware usage progress bars replace the old text line.
		    this._renderAccountUsageBars(plan, usage, limits);
		    this._setAccountProfileLink(profile.username);
		    // Populate the username editor with the current username (empty until set).
		    const usernameInput = document.getElementById('spa-account-username-input');
		    if (usernameInput && document.activeElement !== usernameInput) {
		      usernameInput.value = profile.username || '';
		    }
		    // Apply the 7-day username-change cooldown (disable Save, show remaining).
		    this._syncAccountUsernameCooldown();
		    if (this.elSpaAccountBoostCta) this.elSpaAccountBoostCta.style.display = this._isPaidOrAbove('boost') ? 'none' : 'block';
		    // Admin controls reuse the same IDs as the account modal (admin-boost-panel etc.).
		    this._syncAdminControlsVisibility();
		  }

	  // Render labeled progress bars for each metered feature, plan-aware.
	  _renderAccountUsageBars(plan, usage = {}, limits = {}) {
	    const host = document.getElementById('spa-account-usage-section');
	    if (!host) return;
	    const bars = [];
	    // Server reviews: Free X/3 per 24h; paid unlimited.
	    const srLimit = limits.serverReviewsPerDay;
	    if (srLimit === null || srLimit === undefined) {
	      bars.push(this._usageBarHtml('Server reviews', 'Unlimited', 0, null, '24h'));
	    } else {
	      const used = Math.max(0, Number(usage.serverReviews) || 0);
	      bars.push(this._usageBarHtml('Server reviews', `${used} / ${srLimit}`, used, srLimit, '24h'));
	    }
	    // Anticheat games: Free none; Boost X/25; Max X/100 (weekly).
	    const acLimit = limits.anticheatGamesPerWeek;
	    if (plan.plan === 'free' || !acLimit) {
	      bars.push(this._usageBarHtml('Anticheat games', 'Plans feature', 0, 0, 'week', { upgrade: true }));
	    } else {
	      const used = Math.max(0, Number(usage.anticheatGames) || 0);
	      bars.push(this._usageBarHtml('Anticheat games', `${used} / ${acLimit}`, used, acLimit, 'week'));
	    }
	    // Coach tokens (AI chat): Free 5k / Boost 20k / Max 100k per day.
	    const ctLimit = Number(usage.coachTokenLimit) || Number(limits.coachTokensPerDay) || 0;
	    if (!ctLimit) {
	      bars.push(this._usageBarHtml('Coach tokens', 'Unavailable', 0, 0, 'day', { upgrade: true }));
	    } else {
	      const ctUsed = Math.max(0, Number(usage.coachTokens) || 0);
	      bars.push(this._usageBarHtml('Coach tokens', `${ctUsed.toLocaleString()} / ${ctLimit.toLocaleString()}`, ctUsed, ctLimit, 'day'));
	    }
	    host.innerHTML = bars.join('');
	  }

	  _usageBarHtml(label, summary, used, limit, period, opts = {}) {
	    const pct = (limit === null || limit === undefined || limit <= 0)
	      ? 0
	      : Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
	    const tone = pct >= 100 ? 'full' : pct >= 75 ? 'high' : 'ok';
	    const note = opts.upgrade
	      ? `<a class="usage-bar-upgrade" href="/plans" data-route="/plans">Upgrade</a>`
	      : `resets ${period === 'week' ? 'Monday' : 'in ~24h'}`;
	    return `<div class="usage-bar">
	      <div class="usage-bar-top"><span>${this._escapeHtml(label)}</span><strong>${this._escapeHtml(String(summary))}</strong></div>
	      <div class="usage-bar-track ${tone}"><div class="usage-bar-fill" style="width:${opts.upgrade ? 0 : pct}%"></div></div>
	      <div class="usage-bar-note">${note}</div>
	    </div>`;
	  }

	  _setAccountProfileLink(username) {
	    const name = String(username || '').trim();
	    const view = document.getElementById('btn-account-view-profile');
	    const copy = document.getElementById('btn-account-copy-profile');
	    if (view) {
	      if (name) { view.setAttribute('href', `/profile/${encodeURIComponent(name)}`); view.setAttribute('data-route', `/profile/${name}`); view.classList.remove('disabled'); }
	      else { view.setAttribute('href', '/account'); view.classList.add('disabled'); }
	    }
	    if (copy && !copy.dataset.bound && name) {
	      copy.dataset.bound = '1';
	      copy.addEventListener('click', async () => {
	        const url = `${window.location.origin}/profile/${encodeURIComponent(name)}`;
	        try { await navigator.clipboard.writeText(url); this._setAccountStatus?.('Profile link copied.', 'success'); }
	        catch (_) { window.prompt('Copy this link:', url); }
	      });
	    }
	  }

		  _setSpaAccountStatus(message, kind = '') {
		    const el = this.elSpaPageStatus || document.getElementById('auth-page-status');
		    if (el) {
		      el.textContent = message || '';
		      el.className = `account-status ${kind}`.trim();
		    }
		  }

		  _bindSpaAuthPageEvents() {
		    const resetBtn = document.getElementById('btn-reset-password');
		    if (resetBtn && !resetBtn.dataset.spaBound) {
		      resetBtn.addEventListener('click', () => this._handleSpaResetPassword());
		      resetBtn.dataset.spaBound = '1';
		    }
		    const signinBtn = document.getElementById('btn-page-auth-to-signin');
		    if (signinBtn && !signinBtn.dataset.spaBound) {
		      signinBtn.addEventListener('click', () => this._navigateTo('/login'));
		      signinBtn.dataset.spaBound = '1';
		    }
		    const signupBtn = document.getElementById('btn-page-auth-to-signup');
		    if (signupBtn && !signupBtn.dataset.spaBound) {
		      signupBtn.addEventListener('click', () => this._navigateTo('/signup'));
		      signupBtn.dataset.spaBound = '1';
		    }
		  }

		  async _handleSpaResetPassword() {
		    const params = new URLSearchParams(window.location.search);
		    const mode = params.get('mode');
		    const oobCode = params.get('oobCode');
		    if (mode === 'resetPassword' && oobCode) return this._confirmSpaPasswordReset(oobCode);
		    const firebase = this._ensureFirebase();
		    if (!firebase?.auth) return this._setSpaAccountStatus('Firebase auth is unavailable.', 'error');
		    const email = (this.elSpaResetEmail?.value || '').trim();
		    if (!email) return this._setSpaAccountStatus('Enter your email first.', 'error');
		    this._showAppLoadingOverlay('Sending reset email...');
		    try {
		      await firebase.auth().sendPasswordResetEmail(email);
		      this._setSpaAccountStatus('Password reset email sent.', 'success');
		    
    // Set Firebase auth persistence to maintain session across page reloads
    try {
      window.firebase.auth().setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    } catch (err) {
      console.warn('Could not set Firebase auth persistence:', err);
    }
} catch (err) {
		      this._setSpaAccountStatus(err?.message || 'Unable to send reset email.', 'error');
		    } finally {
		      this._hideAppLoadingOverlay();
		    }
		  }

		  async _handleSpaAccountResetPassword() {
		    const firebase = this._ensureFirebase();
		    if (!firebase?.auth) return this._setSpaAccountStatus('Firebase auth is unavailable.', 'error');
		    const email = (this.authState?.user?.email || '').trim();
		    if (!email) return this._setSpaAccountStatus('No account email found. Sign in again.', 'error');
		    this._showAppLoadingOverlay('Sending reset email...');
		    try {
		      await firebase.auth().sendPasswordResetEmail(email);
		      this._setSpaAccountStatus(`Password reset email sent to ${email}.`, 'success');
		    } catch (err) {
		      this._setSpaAccountStatus(err?.message || 'Unable to send reset email.', 'error');
		    } finally {
		      this._hideAppLoadingOverlay();
		    }
		  }

		  async _confirmSpaPasswordReset(code) {
		    const firebase = this._ensureFirebase();
		    if (!firebase?.auth) return this._setSpaAccountStatus('Firebase auth is unavailable.', 'error');
		    const newPassword = (this.elSpaResetNewPassword?.value || '').trim();
		    const confirmPassword = (this.elSpaResetConfirmPassword?.value || '').trim();
		    if (!newPassword || newPassword.length < 6) return this._setSpaAccountStatus('Password must be at least 6 characters.', 'error');
		    if (newPassword !== confirmPassword) return this._setSpaAccountStatus('Passwords do not match.', 'error');
		    this._showAppLoadingOverlay('Updating password...');
		    try {
		      await firebase.auth().confirmPasswordReset(code, newPassword);
		      this._setSpaAccountStatus('Password updated. You may now sign in.', 'success');
		      setTimeout(() => this._navigateTo('/login'), 1500);
		    } catch (err) {
		      this._setSpaAccountStatus(err?.message || 'Unable to update password.', 'error');
		    } finally {
		      this._hideAppLoadingOverlay();
		    }
		  }

		  _bindSpaBoostPageEvents() {
		    const toSignin = document.getElementById('btn-boost-to-signin');
		    if (toSignin && !toSignin.dataset.spaBound) {
		      toSignin.addEventListener('click', () => this._navigateTo('/login'));
		      toSignin.dataset.spaBound = '1';
		    }
		    const toSignup = document.getElementById('btn-boost-to-signup');
		    if (toSignup && !toSignup.dataset.spaBound) {
		      toSignup.addEventListener('click', () => this._navigateTo('/signup'));
		      toSignup.dataset.spaBound = '1';
		    }
		  }

		  _bindSpaAccountPageEvents() {
		    const toSignin = document.getElementById('btn-page-account-to-signin');
		    if (toSignin && !toSignin.dataset.spaBound) {
		      toSignin.addEventListener('click', () => this._navigateTo('/login'));
		      toSignin.dataset.spaBound = '1';
		    }
		    const toSignup = document.getElementById('btn-page-account-to-signup');
		    if (toSignup && !toSignup.dataset.spaBound) {
		      toSignup.addEventListener('click', () => this._navigateTo('/signup'));
			  toSignup.dataset.spaBound = '1';
		    }
		    const signoutBtn = document.getElementById('btn-signout');
		    if (signoutBtn && !signoutBtn.dataset.spaBound) {
		      signoutBtn.addEventListener('click', () => this._handleSignOut());
		      signoutBtn.dataset.spaBound = '1';
		    }
		    const resetPwBtn = document.getElementById('spa-btn-reset-password');
		    if (resetPwBtn && !resetPwBtn.dataset.spaBound) {
		      resetPwBtn.addEventListener('click', () => this._handleSpaAccountResetPassword());
		      resetPwBtn.dataset.spaBound = '1';
		    }
		    const saveUsernameBtn = document.getElementById('spa-btn-save-username');
		    if (saveUsernameBtn && !saveUsernameBtn.dataset.spaBound) {
		      saveUsernameBtn.addEventListener('click', () => this._saveAccountUsername());
		      saveUsernameBtn.dataset.spaBound = '1';
		    }
		    // Admin: gift boost / gift max / remove subscription / support list.
		    const giftBoostBtn = document.getElementById('spa-btn-gift-boost');
		    if (giftBoostBtn && !giftBoostBtn.dataset.spaBound) {
		      giftBoostBtn.addEventListener('click', () => this._adminGiftPlan('boost'));
		      giftBoostBtn.dataset.spaBound = '1';
		    }
		    const giftMaxBtn = document.getElementById('spa-btn-gift-max');
		    if (giftMaxBtn && !giftMaxBtn.dataset.spaBound) {
		      giftMaxBtn.addEventListener('click', () => this._adminGiftPlan('max'));
		      giftMaxBtn.dataset.spaBound = '1';
		    }
		    const removeSubBtn = document.getElementById('spa-btn-remove-subscription');
		    if (removeSubBtn && !removeSubBtn.dataset.spaBound) {
		      removeSubBtn.addEventListener('click', () => this._adminRemoveSubscription());
		      removeSubBtn.dataset.spaBound = '1';
		    }
		    const refreshSupportBtn = document.getElementById('spa-btn-refresh-support');
		    if (refreshSupportBtn && !refreshSupportBtn.dataset.spaBound) {
		      refreshSupportBtn.addEventListener('click', () => this._loadAdminSupport());
		      refreshSupportBtn.dataset.spaBound = '1';
		    }
		    const banBtn = document.getElementById('btn-ban-user');
		    if (banBtn && !banBtn.dataset.spaBound) {
		      banBtn.addEventListener('click', () => this._adminBan(true));
		      banBtn.dataset.spaBound = '1';
		    }
		    const unbanBtn = document.getElementById('btn-unban-user');
		    if (unbanBtn && !unbanBtn.dataset.spaBound) {
		      unbanBtn.addEventListener('click', () => this._adminBan(false));
		      unbanBtn.dataset.spaBound = '1';
		    }
		  }

	  async _adminGiftPlan(plan) {
	    const email = document.getElementById('spa-gift-boost-email')?.value?.trim();
	    const days = parseInt(document.getElementById('spa-gift-boost-days')?.value, 10) || 30;
	    const status = document.getElementById('spa-gift-boost-status');
	    const set = (m, c) => { if (status) { status.textContent = m; status.className = `account-status ${c}`; } };
	    if (!email) { set('Enter an email.', 'error'); return; }
	    set(`Gifting ${plan}…`, '');
	    try {
	      const res = await apiFetch('/api/admin/gift-boost', {
	        method: 'POST', headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
	        body: JSON.stringify({ email, days, plan }),
	      });
	      const data = await res.json().catch(() => ({}));
	      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
	      set(`Granted ${data.plan || plan} for ${days} day${days === 1 ? '' : 's'}.`, 'success');
	    } catch (err) { set(err.message || 'Failed.', 'error'); }
	  }

	  async _adminRemoveSubscription() {
	    const email = document.getElementById('spa-gift-boost-email')?.value?.trim();
	    const status = document.getElementById('spa-gift-boost-status');
	    const set = (m, c) => { if (status) { status.textContent = m; status.className = `account-status ${c}`; } };
	    if (!email) { set('Enter an email.', 'error'); return; }
	    if (!window.confirm(`Remove subscription for ${email}?`)) return;
	    set('Removing…', '');
	    try {
	      const res = await apiFetch('/api/admin/remove-subscription', {
	        method: 'POST', headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
	        body: JSON.stringify({ email }),
	      });
	      const data = await res.json().catch(() => ({}));
	      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
	      set('Subscription removed (now Free).', 'success');
	    } catch (err) { set(err.message || 'Failed.', 'error'); }
	  }

	  async _adminBan(ban) {
	    const email = document.getElementById('spa-ban-user-email')?.value?.trim();
	    const reason = document.getElementById('spa-ban-user-reason')?.value?.trim();
	    if (!email) return;
	    if (ban && !reason) { window.alert('Reason required to ban.'); return; }
	    try {
	      await apiFetch('/api/admin/ban-user', {
	        method: 'POST', headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
	        body: JSON.stringify({ action: ban ? 'ban' : 'unban', email, reason }),
	      });
	    } catch (_err) {}
	  }

	  async _loadAdminSupport() {
	    const list = document.getElementById('spa-admin-support-list');
	    if (!list) return;
	    list.innerHTML = '<p class="account-status">Loading…</p>';
	    try {
	      const res = await apiFetch('/api/admin/support', { headers: await this._authHeaders({}) });
	      const data = await res.json().catch(() => ({}));
	      const messages = Array.isArray(data.messages) ? data.messages : [];
	      if (!messages.length) { list.innerHTML = '<p class="account-status">No messages yet.</p>'; return; }
	      list.innerHTML = messages.map((m) => `
	        <div class="admin-support-item" data-id="${this._escapeHtml(m.id || '')}">
	          <div class="admin-support-top"><strong>${this._escapeHtml(m.email || '')}</strong> <span class="admin-support-reason">${this._escapeHtml(m.reason || '')}</span></div>
	          <p class="admin-support-msg">${this._escapeHtml(m.message || '')}</p>
	          <small>${m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}${m.uid ? ' · uid ' + this._escapeHtml(m.uid) : ''}</small>
	          <button class="btn btn-secondary btn-small admin-support-delete" type="button">Delete</button>
	        </div>`).join('');
	      list.querySelectorAll('.admin-support-delete').forEach((btn) => {
	        btn.addEventListener('click', () => this._deleteAdminSupport(btn.closest('.admin-support-item')?.dataset.id));
	      });
	    } catch (_err) { list.innerHTML = '<p class="account-status error">Could not load messages.</p>'; }
	  }

	  async _deleteAdminSupport(id) {
	    if (!id || !window.confirm('Delete this message?')) return;
	    try {
	      await apiFetch('/api/admin/support/delete', {
	        method: 'POST', headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
	        body: JSON.stringify({ id }),
	      });
	      this._loadAdminSupport();
	    } catch (_err) { /* keep */ }
	  }


	  // Save the username entered on the account page. A valid username is
	  // required before a public profile can exist/be visited.
	  async _saveAccountUsername() {
	    const input = document.getElementById('spa-account-username-input');
	    const status = document.getElementById('spa-account-username-status');
	    const raw = String(input?.value || '').trim();
	    const set = (msg, cls) => { if (status) { status.textContent = msg; status.className = `account-status ${cls}`; } };
	    if (!raw) { set('Enter a username to create your public profile.', 'error'); return; }
	    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(raw)) {
	      set('Username must be 3–40 characters: letters, numbers, . _ - only.', 'error');
	      return;
	    }
	    set('Saving…', '');
	    try {
	      await this._saveUserProfile({ ...this.authState.profile, username: raw }, { rethrow: true });
	      set('Username saved — your profile is live.', 'success');
	      this._setAccountProfileLink(raw);
	      this._syncAccountUsernameCooldown();
	    } catch (err) {
	      if (err?.code === 'username_cooldown') {
	        set(err.message || 'You can change your username again later.', 'error');
	      } else {
	        set('Could not save username. It may be taken — try another.', 'error');
	      }
	    }
	  }

  // Disable the username Save button and show remaining time while the 7-day
  // change cooldown is active (server-enforced). First-ever username set has no
  // cooldown (canChangeAt is null). Re-evaluated whenever the account page
  // renders or a username save resolves.
  _syncAccountUsernameCooldown() {
    // HTML uses `spa-btn-save-username`; alias the old id for safety.
    const saveBtn = document.getElementById('spa-btn-save-username')
      || document.getElementById('spa-account-username-save');
    const status = document.getElementById('spa-account-username-status');
    const cooldown = this.authState.usernameCooldown || {};
    const now = Date.now();
    const canChangeAt = Number(cooldown.canChangeAt) || 0;
    const onCooldown = canChangeAt && canChangeAt > now;
    if (saveBtn) saveBtn.disabled = onCooldown;
    if (onCooldown && status) {
      const daysLeft = Math.max(1, Math.ceil((canChangeAt - now) / (24 * 60 * 60 * 1000)));
      status.textContent = `You can change your username again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`;
      status.className = 'account-status error';
    }
    return onCooldown;
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

		  _syncAdminControlsVisibility() {
		    // Gate every admin-only panel (Gift Boost on the account page and in
		    // the account modal, plus Ban/Unban Player) on the server-derived
		    // authState.isAdmin flag. Non-admins never see these controls; the
		    // endpoints also enforce admin-only server-side, so this is defense
		    // in depth, not a security boundary.
		    const isAdmin = !!this.authState?.isAdmin;
		    const adminElementIds = [
		      'spa-admin-boost-panel', // Plans & subscriptions — account/settings page
		      'admin-boost-panel',     // Gift Boost — account modal
		      'admin-ban-panel',       // Ban / Unban Player
		      'spa-admin-support-panel', // Support messages
		    ];
		    adminElementIds.forEach((id) => {
		      const el = document.getElementById(id);
		      if (el) el.hidden = !isAdmin;
		    });
		    // Support messages are NOT auto-loaded — the list would refetch on
		    // every auth tick / re-render (this method runs frequently), spamming
		    // the server. The admin loads them on demand with the Refresh button.
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

		  _clearSavedGames() {
		    try {
		      this._forgetSavedGameState('review');
		      this._forgetSavedGameState('coach');
		      this._showPopup({
		        icon: 'success',
		        title: 'Saved games cleared',
		        text: 'Stored review and coach games were removed from this device.',
		      });
		    } catch (err) {
		      this._showPopup({ icon: 'error', title: 'Clear failed', text: err.message || 'Unable to clear saved games.' });
		    }
		  }

		  _injectClearSavedGamesButton() {
		    // The Clear Saved Games button now lives in Settings, not the header.
		    const btn = document.getElementById('btn-clear-saved-games');
		    if (btn && !btn.dataset.bound) {
		      btn.addEventListener('click', () => this._clearSavedGames());
		      btn.dataset.bound = '1';
		    }
		    // Clear saved coach chats (localStorage keys per-uid).
		    const chatBtn = document.getElementById('btn-clear-coach-chats');
		    if (chatBtn && !chatBtn.dataset.bound) {
		      chatBtn.addEventListener('click', () => {
		        // Remove all sidastuff.coachChats.* + sidastuff.coachActiveChat.* keys.
		        try {
		          const keys = [];
		          for (let i = 0; i < localStorage.length; i++) {
		            const k = localStorage.key(i);
		            if (k && (k.startsWith('sidastuff.coachChats.') || k.startsWith('sidastuff.coachActiveChat.'))) keys.push(k);
		          }
		          keys.forEach((k) => localStorage.removeItem(k));
		        } catch (_) {}
		        // Reset the in-memory chat state + re-render.
		        if (window.CoachChat && this.coachChat?.active) {
		          window.CoachChat.mount(this); // re-mounts → loadForUid → createChat (fresh)
		        }
		        const status = document.getElementById('page-status');
		        if (status) { status.textContent = 'Coach chats cleared.'; status.className = 'account-status success'; }
		      });
		      chatBtn.dataset.bound = '1';
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
		    this._closeMobileNav();
		    const route = this._normalizeRoute(path || '/index');
		    if (!options.skipHistory) {
		      const target = this._routeUrl(route);
		      const current = this._normalizeRoute(window.location.pathname || '/index');
		      if (current !== route) {
		        if (options.replace) {
		          window.history.replaceState({}, '', target);
		        } else {
		          window.history.pushState({}, '', target);
		        }
		      }
		    }

		    if (route === '/incompatible-browser') {
		      this._hideRoutePages();
		      this._showRoutePage('incompatible-browser');
		      document.body.classList.remove('menu-active');
		      document.body.classList.add('in-app-route');
		      if (this.elMainMenu) this.elMainMenu.hidden = true;
		      if (this.elMainContent) this.elMainContent.hidden = true;
		      document.title = 'Unsupported Browser | SiDaStuff Chess';
		      return;
		    }

		    if (route === '/login') {
		      if (this.authState.initialized && this.authState.user) {
		        return this._navigateTo('/account', { replace: true });
		      }
		      this._enterInAppLayout();
		      this._showRoutePage('login');
		      this._showBannedMessageIfAny();
		      document.title = 'Sign In | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/signup') {
		      // Signed-in users who already finished onboarding go to /account.
		      // Signed-in-but-not-yet-onboarded users stay here to complete the wizard.
		      if (this.authState.initialized && this.authState.user && this.authState.profile?.onboardingComplete) {
		        return this._navigateTo('/account', { replace: true });
		      }
		      this._enterInAppLayout();
		      this._showRoutePage('signup');
		      this._applySignupContext();
		      // (Re)initialize the onboarding wizard to step 1 each time signup is shown.
		      this._initOnboarding();
		      document.title = 'Sign Up | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/account') {
		      this._enterInAppLayout();
		      this._showRoutePage('account');
		      document.title = 'Account | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/settings') {
		      this._enterInAppLayout();
		      this._showRoutePage('settings');
		      document.title = 'Settings | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/auth') {
		      this._enterInAppLayout();
		      this._showRoutePage('auth');
		      document.title = 'Account Help | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/privacy') {
		      this._enterInAppLayout();
		      this._showRoutePage('privacy');
		      document.title = 'Privacy Policy | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/terms') {
		      this._enterInAppLayout();
		      this._showRoutePage('terms');
		      document.title = 'Terms of Service | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/contact') {
		      this._enterInAppLayout();
		      this._showRoutePage('contact');
		      this._initContactPage();
		      document.title = 'Contact Us | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/plans' || route === '/boost') {
		      this._enterInAppLayout();
		      this._showRoutePage('boost');
		      document.title = 'Plans | SiDaStuff Chess';
		      if (window.SidaBoost?.render) window.SidaBoost.render();
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/puzzles') {
		      this._hideRoutePages();
		      this._hideSettingsModal();
		      this._hideAccountModal();
		      this._enterPuzzleMode();
		      document.title = 'Puzzles | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

			    if (route === '/anticheat') {
			      this._hideRoutePages();
		      this._hideSettingsModal();
		      this._hideAccountModal();
		      this._enterAnticheatMode();
		      document.title = 'Anticheat | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

			    if (route === '/coach') {
			      this._hideRoutePages();
			      this._hideSettingsModal();
			      this._hideAccountModal();
			      this._enterCoachChat();
		      document.title = 'Coach | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/review') {
			      this._hideRoutePages();
		      this._hideSettingsModal();
			      this._hideAccountModal();
			      if (!options.disableRestore) {
			        const savedReview = this._loadSavedGameState('review');
			        if (savedReview) {
			          this._promptSavedGameRestore('review', savedReview);
			          document.title = 'Review | SiDaStuff Chess';
			          this._updateNavActiveState();
			          return;
			        }
			      }
		      // When the coach's game_review tool loads a PGN, it passes skipImport
		      // so the PGN import modal doesn't appear on top of the loaded game.
		      if (!options.skipImport) this._showEngineChoiceModal('import');
		      else this._enterReviewMode();
		      document.title = 'Review | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    if (route === '/404') {
		      this._enterInAppLayout();
		      this._showRoutePage('404');
		      document.title = 'Not found | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    // Dynamic profile route: /profile/<username>. This is the app's first
		    // dynamic route, handled before the 404 guard below.
		    if (route.startsWith('/profile/')) {
		      const username = decodeURIComponent(route.slice('/profile/'.length)).replace(/\/+$/, '');
		      this._enterInAppLayout();
		      this._showRoutePage('profile');
		      this._loadPublicProfile(username || '');
		      document.title = `${username || 'Profile'} | SiDaStuff Chess`;
		      this._updateNavActiveState();
		      return;
		    }

		    // Genuinely unknown routes show the 404 panel instead of silently
		    // landing on the home menu. Only the real home routes (/index, /)
		    // show the menu.
		    if (route !== '/index' && route !== '/' && !this._isKnownAppRoute(route)) {
		      this._enterInAppLayout();
		      this._showRoutePage('404');
		      document.title = 'Not found | SiDaStuff Chess';
		      this._updateNavActiveState();
		      return;
		    }

		    // Default (/index, /) — show the main menu
		    this._hideRoutePages();
		    this._hideSettingsModal();
		    this._hideAccountModal();
		    this._showMainMenu();
		    document.title = 'SiDaStuff Chess';
		    this._updateNavActiveState();
		  }

  _isKnownAppRoute(route) {
    // Routes handled explicitly in _applyRoute or intercepted by the link
    // interceptor. Anything else is a 404. /profile/<name> is a dynamic prefix.
    if (typeof route === 'string' && route.startsWith('/profile/')) return true;
    return [
      '/index', '/', '/login', '/signup', '/account', '/settings', '/auth',
      '/plans', '/boost', '/review', '/coach', '/puzzles', '/anticheat', '/404',
      '/incompatible-browser', '/privacy', '/terms', '/contact',
    ].includes(route);
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
		    return stats;
		  }

		  async _loadPublicStats() {
		    return null;
			  }

		  async _recordPublicStatEvent(event, extra = {}) {
		    return { event, ...extra };
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
	    
    // Set Firebase auth persistence to maintain session across page reloads
    try {
      window.firebase.auth().setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    } catch (err) {
      console.warn('Could not set Firebase auth persistence:', err);
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
              if (!user) {
                this._stopStatusStream();
                this.authState.profile = null;
                this._applyLocalPuzzleProfile();
              } else {
                this._startStatusStream(user);
                this.authState.profile = await this._loadUserProfile(user);
                this._applyProfileToPuzzleMode(this.authState.profile);
              }
              this.authState.initialized = true;
              // Part 3: the /account page rendered before auth resolved with
              // authState.user = null; re-render it now that we know the real
              // state so a signed-in user never sees the "Sign In" panel.
              if (this.elAccountPage && !this.elAccountPage.hidden) {
                this._renderSpaAccount();
              }
              // Re-evaluate the move-insights gate + review save-CTA now that
              // auth has resolved (they may have flashed for a signed-in user
              // whose authState.user was still null at render time).
              this._refreshInsightsForAuth();
              this._maybeShowReviewSaveCta();
              // Coach chat: re-evaluate the Max gate after auth resolves (src/coach-chat.js
              // owns model pref + history hydration on mount).
              if (this.coachChat.active && window.CoachChat) window.CoachChat.onAuth(this);
              // Part 1c: a signed-in user who hasn't completed onboarding is
              // sent to the wizard — but never mid-session (don't yank them out
              // of an active review/coach/puzzle/anticheat run).
              if (user && this.authState.profile && !this.authState.profile.onboardingComplete) {
                const cur = this._normalizeRoute(window.location.pathname || '/index');
                const safeToRedirect = ['/index', '/', '/login', '/signup', '/account'].includes(cur)
                  && !this.coachMode?.active && !this.puzzleMode?.active && !this.anticheatMode?.active
                  && !this.isAnalyzing;
                if (safeToRedirect && cur !== '/signup') {
                  this._navigateTo('/signup', { replace: true });
                }
              }
			      this._syncAccountUi();
			      this._syncPuzzlePanel();
			      this._refreshPuzzleForCurrentUser();
			      this._loadSavedUsernames();
			      this._renderSavedUsernameBar();
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

			  _banMessage(reason = '') {
			    return reason ? `Account banned. Reason: ${reason}` : 'Account banned.';
			  }

			  async _lookupBanReason(email) {
			    if (!email) return '';
			    try {
			      const response = await apiFetch('/api/auth/ban-status', {
			        method: 'POST',
			        headers: { 'Content-Type': 'application/json' },
			        cache: 'no-store',
			        body: JSON.stringify({ email }),
			      });
			      const result = await response.json().catch(() => null);
			      return result?.banned ? String(result.reason || '').trim() : '';
			    } catch (_err) {
			      return '';
			    }
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
			      const response = await apiFetch('/api/users/me', {
			        headers: await this._authHeaders(),
			        cache: 'no-store',
			        signal: controller.signal,
			      });
		      clearTimeout(timeout);
				      if (!response.ok) {
				        const result = await response.json().catch(() => null);
				        const error = new Error(result?.reason ? this._banMessage(result.reason) : (result?.error || `Account API responded with ${response.status}`));
				        error.statusCode = response.status;
				        error.reason = result?.reason || '';
				        throw error;
				      }
		      const me = await response.json();
		      this.authState.me = me;
		      this.authState.plan = me.plan || { plan: 'free', name: 'Free' };
		      this.authState.usage = me.usage || {};
		      this.authState.limits = me.limits || {};
		      this.authState.isAdmin = !!me.isAdmin;
		      this.authState.usernameCooldown = me.usernameCooldown || null;
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
				    } catch (err) {
				      if (timeout) clearTimeout(timeout);
			      this.authState.me = null;
			      this.authState.plan = { plan: 'free', name: 'Free' };
			      this.authState.usage = {};
			      this.authState.limits = {};
			      this.authState.isAdmin = false;
			      if (err?.statusCode === 403) {
			        await this._handleBannedSession(err.reason || '', err.message);
			      }
			      return fallback;
			    }
			  }

			  async _refreshMe() {
			    const user = this.authState.user;
			    if (!user) return null;
			    const response = await apiFetch('/api/users/me', {
			      headers: await this._authHeaders(),
			      cache: 'no-store',
			    });
			    if (!response.ok) {
			      const result = await response.json().catch(() => null);
			      if (response.status === 403) {
			        await this._handleBannedSession(result?.reason || '', result?.error);
			      }
			      throw new Error(result?.reason ? this._banMessage(result.reason) : (result?.error || `Account API responded with ${response.status}`));
			    }
		    const me = await response.json();
		    this.authState.me = me;
		    this.authState.profile = me.profile || this.authState.profile;
		    this.authState.plan = me.plan || { plan: 'free', name: 'Free' };
		    this.authState.usage = me.usage || {};
		    this.authState.limits = me.limits || {};
		    this.authState.isAdmin = !!me.isAdmin;
		    this.authState.usernameCooldown = me.usernameCooldown || null;
		    this._applyProfileToPuzzleMode(this.authState.profile);
		    this._syncAccountUi();
		    this._syncPuzzlePanel();
		    if (me.pendingWarning) this._showUserWarning(me.pendingWarning);
		    return me;
		  }

		  async _authHeaders(extra = {}) {
		    const token = await this.authState.user?.getIdToken?.();
		    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
		  }

		  _stopStatusStream() {
		    if (this.authState.statusSource) {
		      this.authState.statusSource.close();
		      this.authState.statusSource = null;
		    }
		  }

		  async _startStatusStream(user) {
    this._stopStatusStream();
    // Disable SSE streams as they cause lag per user request
  }

			  async _handleBannedSession(reason = '', fallbackMessage = '') {
			    const message = reason ? this._banMessage(reason) : (fallbackMessage || 'Account banned.');
			    this._setAccountStatus(message, 'error');
			    this._stopStatusStream();
			    const firebase = this._ensureFirebase();
			    try {
			      await firebase?.auth?.().signOut();
			    } catch (_err) {}
			    // Carry the ban message via sessionStorage so the SPA login page can
			    // show it. The old /signin.html?banned=1 shim redirect dropped the
			    // reason and left the user on a blank login form with no explanation.
			    try { window.sessionStorage.setItem('sidastuff.banMessage', message); } catch (_) {}
			    window.location.replace('/?spa-route=/signin');
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
	    const plan = this.authState.plan?.plan; // 'free' | 'boost' | 'max'
	    const usage = this.authState.usage || {};
	    const limits = this.authState.limits || {};
	    if (kind === 'serverReviews') {
	      const limit = limits.serverReviewsPerDay;
	      if (limit === null || limit === undefined) return false; // paid = unlimited
	      return Math.max(0, Number(usage.serverReviews) || 0) >= Math.max(1, Number(limit) || 3);
	    }
	    if (kind === 'anticheat') {
	      // Free: no anticheat at all.
	      if (plan === 'free' || !limits.anticheatGamesPerWeek) return true;
	      return Math.max(0, Number(usage.anticheatGames) || 0) >= Math.max(1, Number(limits.anticheatGamesPerWeek));
	    }
	    return false;
	  }

  // Client-side tier gating. Max ranks above Boost so Max inherits every Boost
  // perk; feature gates must use _isPaidOrAbove('boost'), NOT an exact
  // `plan === 'boost'` equality (which wrongly excludes Max). Mirrors the
  // server-side isPaidOrAbove() in user-service.js.
  _planRank(plan) {
    return { free: 0, boost: 1, max: 2 }[String(plan || '').toLowerCase()] ?? 0;
  }
  _isPaidOrAbove(floor) {
    return this._planRank(this.authState.plan?.plan) >= this._planRank(floor);
  }

  // Single source of truth for upsell-gate visibility. Auth is resolved
  // client-side by Firebase onAuthStateChanged, which is async — a returning
  // signed-in user has authState.user === null until the callback fires. Gates
  // must stay HIDDEN while auth is 'resolving' so a logged-in user never sees a
  // "create an account" prompt. Returns:
  //   'resolving' — authState not yet resolved (hide the gate AND locked content)
  //   'signedIn'  — hide all upsell gates
  //   'guest'     — show upsell gates (subject to dismissal)
  _authGateState() {
    return this.authState.initialized === false || this.authState.initialized === undefined
      ? 'resolving'
      : (this.authState.user ? 'signedIn' : 'guest');
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
	    const plan = this.authState.plan?.plan;
	    const used = this._usedCount(kind);
	    const limit = this._limitCount(kind);
	    const untilReset = this._usageResetCountdown();
	    // Free anticheat: it's not a limit reached — it's not included at all.
	    const freeNoAnticheat = kind === 'anticheat' && (plan === 'free' || !limit);
	    const title = freeNoAnticheat
	      ? 'Anticheat is a Plans feature'
	      : isReview
	        ? `You've used ${used} of ${limit} free server reviews today`
	        : `You've used ${used} of ${limit} anticheat games this week`;
	    const text = freeNoAnticheat
	      ? 'Server-side cheat detection is included with Boost (25 games/week) and Max (100 games/week).'
	      : isReview
	        ? `Your next server review unlocks in ${untilReset} — or go Boost for unlimited reviews right now.`
	        : `Your weekly anticheat budget resets Monday — or upgrade to Max for 100 games/week.`;
	    const result = await this._showPopup({
	      icon: 'warning',
	      title,
	      text,
	      confirmButtonText: isReview ? 'Review in browser instead' : 'OK',
	      denyButtonText: freeNoAnticheat || !isReview ? (plan === 'boost' ? 'Go Max' : 'Go Boost') : 'Go Boost',
	      showDenyButton: true,
	      showCancelButton: true,
	      cancelButtonText: 'Cancel',
	    });
	    if (result.isDenied) {
	      this._navigateTo('/plans');
	      return 'plans';
	    }
	    return isReview && result.isConfirmed ? 'browser' : 'cancel';
	  }

  _usedCount(kind) {
    const usage = this.authState.usage || {};
    if (kind === 'anticheat') return Math.max(0, Number(usage.anticheatGames) || 0);
    return Math.max(0, Number(usage.serverReviews) || 0);
  }

  _limitCount(kind) {
    const limits = this.authState.limits || {};
    if (kind === 'anticheat') return Math.max(0, Number(limits.anticheatGamesPerWeek) || 0);
    const d = limits.serverReviewsPerDay;
    return d === null || d === undefined ? Infinity : Math.max(1, Number(d) || 3);
  }

  // Approximate "time until daily reset" — Firebase daily counters reset on a
  // rolling 24h window, so report hours remaining from now. Kept intentionally
  // fuzzy ("about N hours") so it never reads as a false-precise promise.
  _usageResetCountdown() {
    const now = new Date();
    const nextReset = new Date(now);
    nextReset.setHours(24, 0, 0, 0); // midnight UTC boundary as a stable proxy
    const hours = Math.max(1, Math.ceil((nextReset - now) / 3600000));
    if (hours <= 1) return 'about an hour';
    if (hours < 24) return `about ${hours} hours`;
    return 'tomorrow';
  }

	  // Keys the server allows a client to PATCH (mirror of server
	  // ALLOWED_PROFILE_KEYS). We keep authState.profile rich (uid/email/
	  // subscription/usage) for local use, but POST only these — sending the
	  // full profile triggered patchProfile "blocked forbidden key" warnings.
	  _PROFILE_PATCH_KEYS = ['username', 'puzzleRating', 'puzzleStats', 'savedUsernames', 'appearanceSettings', 'engineSettings', 'coachMode', 'puzzleMode', 'onboardingComplete'];

	  async _saveUserProfile(profile = this.authState.profile, { rethrow = false } = {}) {
	    const user = this.authState.user;
	    if (!user || !profile) return;
	    // Keep a rich local copy (includes uid/email/subscription for the UI)…
	    this.authState.profile = {
	      ...profile,
	      uid: user.uid,
	      email: user.email || profile.email || '',
	      updatedAt: Date.now(),
	    };
	    // …but only send the server-allowed keys.
	    const patch = {};
	    for (const key of this._PROFILE_PATCH_KEYS) {
	      if (profile[key] !== undefined) patch[key] = profile[key];
	    }
	    try {
	      const response = await apiFetch('/api/users/me', {
	        method: 'POST',
	        headers: await this._authHeaders({ 'Content-Type': 'application/json' }),
	        cache: 'no-store',
	        body: JSON.stringify({ profile: patch }),
	      });
	      if (!response.ok) {
	        const result = await response.json().catch(() => null);
	        const err = new Error(result?.error || `Profile save failed with ${response.status}`);
	        if (result?.code) err.code = result.code;
	        if (typeof result?.cooldownDays === 'number') err.cooldownDays = result.cooldownDays;
	        throw err;
	      }
	      const data = await response.json().catch(() => null);
	      if (data?.profile) this.authState.profile = { ...this.authState.profile, ...data.profile };
	      if (data?.me) this.authState.me = data;
	    } catch (err) {
	      if (rethrow) throw err;
	      // Auth remains useful even if profile sync fails temporarily.
	    }
	  }

	  // ── Saved chess usernames ──────────────────────────────────────────

	  _loadSavedUsernames() {
	    const profile = this.authState.profile || {};
	    const saved = profile.savedUsernames || {};
	    this.authState.savedUsernames = {
	      lichess: String(saved.lichess || '').trim(),
	      chesscom: String(saved.chesscom || '').trim(),
	    };
	  }

	  async _saveSavedUsername(source, username) {
	    const user = this.authState.user;
	    if (!user || !username) return;
	    const profile = this.authState.profile || {};
	    const saved = { ...(profile.savedUsernames || {}) };
	    saved[source] = username.trim();
	    await this._saveUserProfile({ ...profile, savedUsernames: saved });
	    this._loadSavedUsernames();
	    this._renderSavedUsernameBar();
	  }

	  async _clearSavedUsername(source) {
	    const profile = this.authState.profile || {};
	    const saved = { ...(profile.savedUsernames || {}) };
	    saved[source] = '';
	    await this._saveUserProfile({ ...profile, savedUsernames: saved });
	    this._loadSavedUsernames();
	    this._renderSavedUsernameBar();
	  }

	  _hasAnySavedUsername() {
	    const s = this.authState.savedUsernames || {};
	    return !!(s.lichess || s.chesscom);
	  }

	  _renderSavedUsernameBar() {
	    if (!this.elSavedUsernameBar || !this.elSavedUsernameContent) return;
	    const s = this.authState.savedUsernames || {};
	    const hasAny = this._hasAnySavedUsername();
	    this.elSavedUsernameBar.hidden = !hasAny;
	    if (!hasAny) {
	      this.elSavedUsernameContent.innerHTML = '';
	      return;
	    }
	    const chips = [];
	    if (s.chesscom) {
	      chips.push(this._savedUsernameChip('chesscom', s.chesscom, '/assets/chesscom.png'));
	    }
	    if (s.lichess) {
	      chips.push(this._savedUsernameChip('lichess', s.lichess, '/assets/lichess.png'));
	    }
	    this.elSavedUsernameContent.innerHTML = chips.join('');
	  }

	  _savedUsernameChip(source, username, iconSrc) {
	    const label = source === 'chesscom' ? 'Chess.com' : 'Lichess';
	    return `
	      <div class="saved-username-chip" data-source="${source}">
	        <img src="${iconSrc}" alt="${label}" class="saved-username-icon" loading="lazy">
	        <span class="saved-username-label">${this._escapeHtml(username)}</span>
	        <button type="button" class="saved-username-load-btn" data-source="${source}" title="Load ${label} games">
	          <span class="material-symbols-outlined">download</span>
	          <span class="btn-label">Load</span>
	        </button>
	        <button type="button" class="saved-username-unlink-btn" data-source="${source}" title="Unlink ${label}">
	          <span class="material-symbols-outlined">close</span>
	        </button>
	      </div>`;
	  }

	  _initSavedUsernameBar() {
	    if (!this.elSavedUsernameContent) return;
	    this.elSavedUsernameContent.addEventListener('click', (e) => {
	      const loadBtn = e.target.closest('.saved-username-load-btn');
	      if (loadBtn) {
	        e.preventDefault();
	        e.stopPropagation();
	        const source = loadBtn.dataset.source;
	        this._quickLoadSavedUsername(source);
	        return;
	      }
	      const unlinkBtn = e.target.closest('.saved-username-unlink-btn');
	      if (unlinkBtn) {
	        e.preventDefault();
	        e.stopPropagation();
	        const source = unlinkBtn.dataset.source;
	        const label = source === 'chesscom' ? 'Chess.com' : 'Lichess';
	        this._showPopup({
	          icon: 'warning',
	          title: `Unlink ${label}?`,
	          text: `Remove ${label} from your saved usernames.`,
	          confirmButtonText: 'Unlink',
	          showCancelButton: true,
	        }).then((result) => {
	          if (result.isConfirmed) this._clearSavedUsername(source);
	        });
	        return;
	      }
	      const chip = e.target.closest('.saved-username-chip');
	      if (chip) {
	        const source = chip.dataset.source;
	        this._quickLoadSavedUsername(source);
	      }
	    });
	  }

	  _renderLinkUsernameRow() {
	    // Show a "link this username" row when logged in and on the username import tab.
	    if (!this.authState?.user) return;
	    let row = this.elPgnModal?.querySelector('.link-username-row');
	    const source = this.elImportSource?.value || 'pgn';
	    const isUsernameMode = source !== 'pgn';
	    const username = (this.elImportUsername?.value || '').trim();
	    const label = source === 'chesscom' ? 'Chess.com' : 'Lichess';
	    const alreadySaved = this.authState.savedUsernames?.[source] === username;

	    if (!isUsernameMode || !username) {
	      if (row) row.remove();
	      return;
	    }

	    if (!row) {
	      row = document.createElement('div');
	      row.className = 'link-username-row';
	      const grid = this.elPgnModal?.querySelector('.import-source-grid');
	      if (grid) grid.after(row);
	    }

	    if (alreadySaved) {
	      row.innerHTML = `
	        <span class="link-username-text">
	          <span class="material-symbols-outlined link-username-icon" style="color:var(--clr-best)">check_circle</span>
	          ${this._escapeHtml(label)} username <strong>${this._escapeHtml(username)}</strong> is already linked.
	        </span>`;
	      row.hidden = false;
	    } else {
	      row.innerHTML = `
	        <span class="link-username-text">
	          Link this <strong>${this._escapeHtml(label)}</strong> username for faster imports next time?
	        </span>
	        <button type="button" class="btn btn-sm btn-link-username" data-link-source="${this._escapeHtml(source)}" data-link-username="${this._escapeHtml(username)}">
	          <span class="material-symbols-outlined btn-symbol">link</span>
	          <span class="btn-label">Link</span>
	        </button>`;
	      row.hidden = false;
	    }
	  }

	  _initLinkUsernameRow() {
	    if (!this.elPgnModal) return;
	    this.elPgnModal.addEventListener('click', (e) => {
	      const btn = e.target.closest('.btn-link-username');
	      if (!btn) return;
	      e.preventDefault();
	      e.stopPropagation();
	      const source = btn.dataset.linkSource;
	      const username = btn.dataset.linkUsername;
	      btn.disabled = true;
	      btn.querySelector('.btn-label').textContent = 'Saving…';
	      this._saveSavedUsername(source, username).then(() => {
	        this._renderLinkUsernameRow();
	        this._showPopup({
	          icon: 'success',
	          title: 'Username linked!',
	          text: `${source === 'chesscom' ? 'Chess.com' : 'Lichess'} username saved for faster imports.`,
	        });
	      }).catch(() => {
	        btn.disabled = false;
	        btn.querySelector('.btn-label').textContent = 'Link';
	      });
	    });
	  }

	  _renderHomeQuickLoad() {
	    if (!this.elMainMenu) return;
	    const quickLoad = document.getElementById('home-quick-load');
	    const quickLoadButtons = document.getElementById('home-quick-load-buttons');
	    if (!quickLoad || !quickLoadButtons) return;
	    const s = this.authState.savedUsernames || {};
	    const hasAny = this._hasAnySavedUsername();
	    quickLoad.hidden = !hasAny;
	    if (!hasAny) {
	      quickLoadButtons.innerHTML = '';
	      return;
	    }
	    const chips = [];
	    if (s.chesscom) {
	      chips.push(`
	        <button type="button" class="home-quick-load-btn" data-source="chesscom" title="Load Chess.com games for ${this._escapeHtml(s.chesscom)}">
	          <img src="/assets/chesscom.png" alt="Chess.com" class="home-quick-load-icon" loading="lazy">
	          <span>Chess.com</span>
	        </button>`);
	    }
	    if (s.lichess) {
	      chips.push(`
	        <button type="button" class="home-quick-load-btn" data-source="lichess" title="Load Lichess games for ${this._escapeHtml(s.lichess)}">
	          <img src="/assets/lichess.png" alt="Lichess" class="home-quick-load-icon" loading="lazy">
	          <span>Lichess</span>
	        </button>`);
	    }
	    quickLoadButtons.innerHTML = chips.join('');
	    quickLoadButtons.querySelectorAll('.home-quick-load-btn').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const source = btn.dataset.source;
	        // Navigate to review page and open the import modal. disableRestore
	        // suppresses the "Continue review?" popup — the user's intent here is
	        // to load a NEW game, not recover a saved one.
	        this._navigateTo('/review', { disableRestore: true });
	        // Small delay to let the page transition settle, then load games directly
	        setTimeout(() => {
	          this._quickLoadSavedUsername(source);
	        }, 150);
	      });
	    });
	  }

	  async _quickLoadSavedUsername(source) {
	    const s = this.authState.savedUsernames || {};
	    const username = s[source];
	    if (!username) return;
	    const modalWasOpen = this.elPgnModal?.style.display === 'flex';
	    if (!modalWasOpen) this._showPgnModal();
	    // Align the import-source dropdown with the platform we're loading so
	    // the UI (and any subsequent "Load games" click) matches. This must
	    // happen before switching tabs so the tab handler keeps this source.
	    if (this.elImportSource) {
	      this.elImportSource.value = source;
	    }
	    const siteLabel = source === 'chesscom' ? 'Chess.com' : 'Lichess';
	    this._setImportStatus(`Loading ${siteLabel} games for ${username}…`, 'loading');
	    // Show a clear loading popup so the user sees the fetch is in progress,
	    // whether they kicked it off from the home screen or the import modal.
	    const closeLoading = this._showLoadingPopup(`Loading ${siteLabel} games…`);
	    try {
	      const games = source === 'chesscom'
	        ? await this._fetchChessComGames(username, 10)
	        : await this._fetchLichessGames(username, 10);
	      if (!games.length) {
	        this._setImportStatus('No recent games were found for that user.', 'error');
	        return;
	      }
	      this._setImportStatus(`Showing the last ${games.length} games for ${username}. Click one to load it.`, 'success');
	      this._renderImportResults(games);
	      // Switch to username tab so the grid is visible
	      const tabs = this.elPgnModal?.querySelector('.import-tabs');
	      if (tabs) {
	        tabs.querySelector('[data-import-tab="username"]')?.click();
	      }
	      this._syncImportMode();
	    } catch (err) {
	      console.error('Quick load failed:', err);
	      this._setImportStatus(err.message || 'Could not load games.', 'error');
	    } finally {
	      closeLoading();
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
	    // Async-auth safety net: a returning user can land on /signin or /signup
	    // before onAuthStateChanged resolves (authState.user is null on first
	    // paint). Once auth resolves and they're signed in, bounce them off the
	    // auth pages to /account so they never get stranded on a login form.
	    if (signedIn && this.authState.initialized) {
	      const currentRoute = this._normalizeRoute(window.location.pathname || '/index');
	      if (currentRoute === '/login' || currentRoute === '/signup') {
	        this._navigateTo('/account', { replace: true });
	        return;
	      }
	    }
	    if (this.elHeaderAccountBtn) this.elHeaderAccountBtn.hidden = false;
	    if (this.elHeaderAccountIcon) this.elHeaderAccountIcon.textContent = signedIn ? 'account_circle' : 'login';
	    if (this.elHeaderAccountLabel) this.elHeaderAccountLabel.textContent = signedIn ? (profile.username || user.displayName || 'Account') : 'Account';
	    this._syncHeaderLabelVisibility();
	    if (this.elHeaderAccountBtn) this.elHeaderAccountBtn.title = signedIn ? 'Account' : 'Sign in';
		    if (this.elAccountSignedOut) this.elAccountSignedOut.hidden = signedIn;
		    if (this.elAccountSignedIn) this.elAccountSignedIn.hidden = !signedIn;
		    if (this.elAccountBtnLabel) {
		      this.elAccountBtnLabel.textContent = signedIn ? (profile.username || user.displayName || 'Account') : 'Account';
		    }
		    if (typeof window.updateHeaderAuth === 'function') {
		      window.updateHeaderAuth(user);
		    }
		    // Hide/show all admin panels (Gift Boost + Ban Player) based on the
		    // server-derived admin flag. Covers both the signed-in and
		    // signed-out paths.
		    this._syncAdminControlsVisibility();
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
		      // Style the badge for ANY paid plan (Boost OR Max). Exact equality
		      // would skip Max — Max users would see a Free-styled badge while
		      // being charged the same as Boost. Use the tier rank helper.
		      this.elAccountPlan.classList.toggle('boost-plan', this._isPaidOrAbove('boost'));
		    }
		    if (this.elAccountUsage) {
		      if (plan.plan === 'boost' || plan.plan === 'max') {
		        this.elAccountUsage.textContent = `${plan.name} includes unlimited server reviews and ${limits.anticheatGamesPerWeek || 0} anticheat games/week.`;
		      } else {
		        const reviews = Math.max(0, Number(usage.serverReviews) || 0);
		        this.elAccountUsage.textContent = `${reviews}/${limits.serverReviewsPerDay || 3} server reviews today. Anticheat is a Plans feature. Extra reviews run in the browser until reset.`;
		      }
			    }
			    this._syncServerStrongToggle();
			    if (this.elAccountPage && !this.elAccountPage.hidden) this._syncAccountPage();
		  }

	  // Hide the header account text label on mobile so only the icon shows.
	  _syncHeaderLabelVisibility() {
	    if (this.elHeaderAccountLabel) {
	      this.elHeaderAccountLabel.style.display = window.innerWidth > 900 ? '' : 'none';
	    }
	  }

	  _setAuthMode(mode) {
	    this.authMode = mode === 'signup' ? 'signup' : 'signin';
	    this.elBtnAuthSigninMode?.classList.toggle('active', this.authMode === 'signin');
	    this.elBtnAuthSignupMode?.classList.toggle('active', this.authMode === 'signup');
	    if (this.elAuthUsernameField) this.elAuthUsernameField.style.display = this.authMode === 'signup' ? 'flex' : 'none';
	    this._setButtonLabel(this.elBtnAuthSubmit, this.authMode === 'signup' ? 'Sign Up' : 'Sign In');
	    this._setAccountStatus('');
	  }

  // Surface a ban reason carried via sessionStorage from _handleBannedSession.
  // Without this the banned user lands on a blank login form with no explanation.
  _showBannedMessageIfAny() {
    try {
      const msg = window.sessionStorage.getItem('sidastuff.banMessage');
      if (msg) {
        this._setAccountStatus(msg, 'error');
        window.sessionStorage.removeItem('sidastuff.banMessage');
      }
    } catch (_) {}
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
		    const paid = plan.plan === 'boost' || plan.plan === 'max';
		    const usageText = paid
		      ? `${plan.name} includes unlimited server reviews and ${limits.anticheatGamesPerWeek || 0} anticheat games/week.`
		      : `${Math.max(0, Number(usage.serverReviews) || 0)}/${limits.serverReviewsPerDay || 3} server reviews today. Anticheat is a Plans feature.`;
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
				const root = this._swalContentRoot();
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
				const root = this._swalContentRoot();
				if (!root) return false;
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
		    window.AppDialog?.close?.({ isDismissed: true });
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
		      const response = await apiFetch('/api/admin/gift-boost', {
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
	          // Onboarding choices, persisted server-side (ALLOWED_PROFILE_KEYS
	          // already permits both keys) so they survive across devices.
	          coachMode: {
	            elo: this.coachMode.elo || 1200,
	            humanColor: this.coachMode.humanColor || 'w',
	            aiAdjust: this.coachMode.aiAdjust !== false,
	            adjustStyle: this.coachMode.adjustStyle || 'better',
	          },
	          appearanceSettings: this._onboardingAppearance(),
	          onboardingComplete: true,
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
	      // Full page reload so Firebase onAuthStateChanged fires cleanly and
	      // all UI (header, SPA panels, usage) resets from the server.
	      setTimeout(() => window.location.reload(), 450);
		    } catch (err) {
			      const message = String(err?.code || '') === 'auth/user-disabled'
			        ? this._banMessage(await this._lookupBanReason(email))
			        : this._friendlyAuthError(err);
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
	      const username = existing.username || user.displayName || (user.email ? user.email.split('@')[0] : 'Player');
	      await this._saveUserProfile({
	        ...existing,
	        uid: user.uid,
	        username: username,
	        email: user.email || existing.email || '',
	        puzzleRating: existing.puzzleRating || this.puzzleMode.rating || 1500,
		        coachMode: existing.coachMode || {
		          elo: this.coachMode.elo || 1200,
		          humanColor: this.coachMode.humanColor || 'w',
		          aiAdjust: this.coachMode.aiAdjust !== false,
		          adjustStyle: this.coachMode.adjustStyle || 'better',
		        },
		        appearanceSettings: existing.appearanceSettings || this._onboardingAppearance(),
		        onboardingComplete: true,
	      });
	      this._setAccountStatus('Signed in with Google.', 'success');
	      // Full page reload so Firebase onAuthStateChanged fires cleanly and
	      // all UI (header, SPA panels, usage) resets from the server.
	      setTimeout(() => window.location.reload(), 450);
		    } catch (err) {
		      if (String(err?.code || '') === 'auth/user-disabled') {
		        this._setAccountStatus(this._banMessage(await this._lookupBanReason(err?.email || '')), 'error');
		      } else {
		        this._setAccountStatus(err.message || 'Google sign-in failed.', 'error');
		      }
		    }
		  }

		  async _handleSignOut() {
		    const firebase = this._ensureFirebase();
		    if (!firebase?.auth) return;
		    await firebase.auth().signOut();
		    // Force a full page reload so auth state is fully cleared and all
		    // observers (Firebase onAuthStateChanged, header, SPA panels) reset.
		    window.location.reload();
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
		      const response = await apiFetch('/api/admin/gift-boost', {
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
    // Boost OR Max (Max inherits all Boost perks). Use the tier helper, not an
    // exact `=== 'boost'` check, so Max can use the stronger server review too.
    const hasBoost = this._isPaidOrAbove('boost');
    const showInReview = this.engineSettings.analysisLocation === 'server' && document.body.dataset.mode === 'review';
	    if (this.elServerBoostToggle) {
	      this.elServerBoostToggle.classList.toggle('boost-locked', !hasBoost);
	      this.elServerBoostToggle.style.display = showInReview ? '' : 'none';
	      this.elServerBoostToggle.title = hasBoost ? '' : 'Plans unlocks stronger server review.';
	    }
    const strongOn = hasBoost && !!this.elServerStrongReview?.checked;
    if (this.elServerStrongNote) this.elServerStrongNote.hidden = !strongOn;
    const lockIcon = document.getElementById('boost-lock-icon');
    if (lockIcon) lockIcon.style.display = hasBoost ? 'none' : '';
    if (!hasBoost && this.elServerStrongReview) {
      this.elServerStrongReview.checked = false;
      this.elServerStrongReview.disabled = true;
	      this.engineSettings.serverStrongReview = false;
    } else if (hasBoost && this.elServerStrongReview) {
      this.elServerStrongReview.disabled = false;
    }
  }

		  _enterAnticheatMode() {
	    this._activateGameLayout();
	    document.body.dataset.mode = 'anticheat';
	    this.liveEvalToken += 1; this.liveDepthToken += 1;
	    // Clear any stale run from a previous visit so the Run button isn't
	    // left disabled by a pending fetch that's no longer relevant.
	    this._stopAnticheatRun();
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
		    this._syncServerStrongToggle();
this._syncAnticheatForm();
	    this._syncActionButtons();
	    // Pull fresh quota + render the weekly anticheat usage bar.
	    this._refreshUsageBeforeAction().finally(() => this._renderAnticheatUsageBar());
	  }

	  // Weekly anticheat-games usage bar shown on the anticheat page.
	  _renderAnticheatUsageBar() {
	    const host = document.getElementById('anticheat-usage-bar');
	    if (!host) return;
	    const plan = this.authState.plan || {};
	    const usage = this.authState.usage || {};
	    const limits = this.authState.limits || {};
	    const acLimit = limits.anticheatGamesPerWeek;
	    if (plan.plan === 'free' || !acLimit) {
	      host.innerHTML = this._usageBarHtml('Anticheat games', 'Plans feature', 0, 0, 'week', { upgrade: true });
	    } else {
	      const used = Math.max(0, Number(usage.anticheatGames) || 0);
	      host.innerHTML = this._usageBarHtml('Anticheat games this week', `${used} / ${acLimit}`, used, acLimit, 'week');
	    }
	  }

		  _syncPuzzlePanel() {
		    if (!this.elPuzzleCard) return;
		    const mode = this.puzzleMode;
		    const currentPuzzleId = mode.current?.puzzle?.id || '';
		    const alreadyAttempted = !!(currentPuzzleId && mode.attemptedPuzzleIds?.has(currentPuzzleId));
		    this.elPuzzleCard.classList.toggle('puzzle-loading', !!mode.loading);
		    if (this.elPuzzleUserRating) this._setPuzzleRatingText(Math.round(mode.rating || 1500));
	    if (this.elPuzzleTargetRating) this.elPuzzleTargetRating.textContent = mode.loading ? '--' : (mode.current?.puzzle?.rating || mode.rating || 1500);
		    if (this.elPuzzleStreak) this.elPuzzleStreak.textContent = String(mode.streak || 0);
		    // Streak fire (retention/loss aversion): celebrate a hot streak so
		    // players are reluctant to break it.
		    const fireOn = (mode.streak || 0) >= 3;
		    if (this.elPuzzleStreakMeta) this.elPuzzleStreakMeta.classList.toggle('streak-fire', fireOn);
		    if (this.elPuzzleStreak) this.elPuzzleStreak.textContent = fireOn ? `🔥 ${mode.streak}` : String(mode.streak || 0);
		    if (this.elPuzzleScore) this.elPuzzleScore.textContent = `${mode.solvedCount || 0} / ${mode.attemptedCount || 0}`;
		    // Daily goal ring (progress motivation): show today's solved count
		    // against a 5-puzzle daily target so progress feels tangible.
		    if (this.elPuzzleDailyGoal) {
		      const todaySolved = this._puzzlesSolvedToday();
		      const goal = this._puzzleDailyGoalTarget();
		      this.elPuzzleDailyGoal.textContent = `${Math.min(todaySolved, goal)} / ${goal}`;
		    }
		    if (this.elPuzzleSource) this.elPuzzleSource.textContent = mode.loading ? 'Finding puzzle' : (mode.source || 'Lichess training');
			if (this.elBtnPuzzleNext) {
				this.elBtnPuzzleNext.disabled = !!mode.loading;
				if (this.elBtnPuzzleNext.disabled) this.elBtnPuzzleNext.classList.remove('pulse');
				else this.elBtnPuzzleNext.classList.add('pulse');
			}
		    if (this.elBtnPuzzleDaily) this.elBtnPuzzleDaily.disabled = !!mode.loading;
				    if (this.elBtnPuzzleRetry) this.elBtnPuzzleRetry.disabled = !mode.current || !!mode.loading || alreadyAttempted || mode.solved;
				    if (this.elBtnPuzzleHint) this.elBtnPuzzleHint.disabled = !mode.current || mode.loading || mode.solved || mode.failed;
			    if (this.elBtnPuzzleReview) this.elBtnPuzzleReview.disabled = this.gameMoves.length === 0 || this.isAnalyzing || (!mode.solved && !mode.failed);
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
    this.elBtnMenuBoost?.addEventListener('click', () => this._navigateTo('/plans', { disableRestore: true }));
    // (engine-choice modal handlers removed — modal was dead UI, never displayed)
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
		    this.elAppleNavToggle?.addEventListener('click', () => {
		      if (!this.elAppleNav) return;
		      const open = this.elAppleNav.classList.toggle('open');
		      this._setMobileNavOpen(open);
		    });
		    // Close the mobile drawer when the scrim is tapped.
		    this.elNavScrim?.addEventListener('click', () => this._closeMobileNav());
		    // Esc closes the drawer.
		    document.addEventListener('keydown', (e) => {
		      if (e.key === 'Escape' && this.elAppleNav?.classList.contains('open')) this._closeMobileNav();
		    });
	    this.elPageToSignup?.addEventListener('click', () => this._navigateTo('/signup'));
	    this.elPageToLogin?.addEventListener('click', () => this._navigateTo('/login'));
	    this.elLoginSubmit?.addEventListener('click', () => this._handlePageEmailAuth('signin'));
	    document.getElementById('btn-login-forgot-password')?.addEventListener('click', () => this._handleLoginPageForgotPassword());
	    this.elSignupSubmit?.addEventListener('click', () => {
	      this._persistOnboardingChoices();
	      // A returning signed-in user completing onboarding (no new account to
	      // create): persist the choices + onboarding flag, then go to /account.
	      if (this.authState.user) {
	        this._finishOnboardingForSignedInUser();
	        return;
	      }
	      this._handlePageEmailAuth('signup');
	    });
	    this.elLoginGoogle?.addEventListener('click', () => this._handleGoogleAuth());
	    this.elSignupGoogle?.addEventListener('click', () => {
	      this._persistOnboardingChoices();
	      this._handleGoogleAuth();
	    });
	    this._initOnboarding();
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

    this.elBtnSaveEngineSettings?.addEventListener('click', () => this._saveEngineSettings());
    this.elBtnSaveAppearanceSettings?.addEventListener('click', () => this._saveAppearanceSettings());
    // Live-update the appearance preview as the user picks a theme. Bind to ALL
    // radios with these names (not just the initially-checked one, whose ref
    // goes stale when the user picks a different option).
    document.querySelectorAll('input[name="settings-board-theme"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        document.body.dataset.boardTheme = radio.value;
        this._renderBoardPreview?.();
      });
    });
    document.querySelectorAll('input[name="settings-piece-theme"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        document.body.dataset.pieceTheme = radio.value;
        this._renderBoardPreview?.();
      });
    });
	    this.elHeaderBrandLink?.addEventListener('click', () => this._navigateTo('/index', { disableRestore: true }));
	    this.elHeaderAccountBtn?.addEventListener('click', () => this._navigateTo(this.authState.user ? '/account' : '/login'));
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
		// Coach chat wiring is owned by src/coach-chat.js (window.CoachChat),
		// which binds its own events on mount — nothing to wire here.
	    this.elBtnPuzzleNext?.addEventListener('click', () => this._loadNextPuzzle());
	    this.elBtnPuzzleDaily?.addEventListener('click', () => this._loadDailyPuzzle());
		    this.elBtnPuzzleRetry?.addEventListener('click', () => this._retryCurrentPuzzle());
		    this.elBtnPuzzleHint?.addEventListener('click', () => this._showPuzzleHint());
		    this.elBtnPuzzleReview?.addEventListener('click', () => this._reviewCurrentPuzzleLine());
		    this.elBtnExportPgn?.addEventListener('click', () => this._exportCurrentPgn());
		    this.elBtnExportFen?.addEventListener('click', () => this._exportCurrentFen());
		    // Anticheat source: card click opens a SweetAlert popup that collects the
// PGN or username and game count, then runs the streaming review.
document.querySelectorAll('.anticheat-source-card').forEach((btn) => {
  btn.addEventListener('click', () => this._openAnticheatSourcePopup(btn.dataset.source));
});
// (Legacy elBtnAnticheatRun binding removed; the source cards above + popup
//  drive the run. The legacy `btn-anticheat-run` button no longer exists.)
	    this.elBtnReview.addEventListener('click', () => this._startReview());
	    this.elBtnLineExplorer?.addEventListener('click', () => this._exploreLineFromCurrentMove());
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
		      if (!this._isPaidOrAbove('boost')) {
		        this.elServerStrongReview.checked = false;
		        this.engineSettings.serverStrongReview = false;
		        this._syncServerStrongToggle();
		        this._navigateTo('/plans');
		        return;
		      }
		      this.engineSettings.serverStrongReview = this.elServerStrongReview.checked;
		      this._syncServerStrongToggle();
		    });

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
		    this._activateGameLayout();
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

	  _activateGameLayout() {
	    document.body.classList.remove('menu-active');
	    document.body.classList.remove('in-app-route');
	    if (this.elMainMenu) this.elMainMenu.hidden = true;
	    if (this.elMainContent) this.elMainContent.hidden = false;
	    if (this.elBoostPage) this.elBoostPage.hidden = true;
	  }

	  async _enterCoachMode(options = null) {
	    this._activateGameLayout();
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
	      this._updateBoard();
	      this.board.clearLoading();
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

    try {
      // Ensure engine is initialized (idempotent — safe to call multiple times)
      await this._initEngine();
      // _initEngine() sets this.engine and marks it ready on success
      if (this.engine?.ready && !this.isAnalyzing) {
        this._startCoachGame(this.pendingCoachSetup || {});
        this.pendingCoachSetup = null;
      } else {
        throw new Error('Engine failed to become ready');
      }
    } catch (err) {
      console.error('Failed to start coach mode:', err);
      this._updateLiveEvalPanel({
        busy: false,
        score: null,
        line: 'Failed to load engine.',
        meta: err.message || 'Please try again or check settings.',
      });
      this._setCoachDialog('Engine failed to load. Check settings and try again.', 'Error');
      this.coachMode.active = false;
      this._syncCoachVisibility();
    }
  }

	  _showMainMenu() {
	    this.autoPlaying = false;
	    this._setButtonLabel(this.elBtnAuto, 'Auto');
	    this.liveEvalToken += 1; this.liveDepthToken += 1;
	    this.explorerReturnState = null;
    this.exploreLineMode = false;
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
		    this._hideRoutePages();
		    if (this.elMainMenu) this.elMainMenu.hidden = false;
		    this._renderHomeQuickLoad();
		    this._renderOnboardingProgress();
		    this._renderHomeContinueCard();
		    this._loadHomeStats();
		    if (this.elMainContent) this.elMainContent.hidden = false;
		    document.body.classList.add('menu-active');
		    document.body.classList.remove('in-app-route');
		  }

  // ── Home enrichment (onboarding, continue, streak, social proof) ───────
  // All read localStorage or existing auth state — no server contract changes.

  _onboardingState() {
    try {
      const raw = window.localStorage.getItem('sidastuff.onboarding');
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  _markOnboarding(key) {
    try {
      const state = this._onboardingState();
      state[key] = true;
      window.localStorage.setItem('sidastuff.onboarding', JSON.stringify(state));
    } catch (_) {}
  }

  _renderOnboardingProgress() {
    if (!this.elOnboardingProgress) return;
    const state = this._onboardingState();
    const steps = [
      { key: 'review', el: 'review' },
      { key: 'savedUsername', el: 'save' },
      { key: 'solvedPuzzle', el: 'puzzle' },
    ];
    // "save" also counts once the user has an account (their progress is then persisted server-side)
    const saveDone = !!state.savedUsername || !!this.authState.user;
    const doneCount = (state.review ? 1 : 0) + (saveDone ? 1 : 0) + (state.solvedPuzzle ? 1 : 0);
    // Hide once the visitor has finished everything — don't nag returning users.
    if (doneCount >= steps.length) {
      this.elOnboardingProgress.hidden = true;
      return;
    }
    this.elOnboardingProgress.hidden = false;
    steps.forEach((step) => {
      const el = this.elOnboardingProgress.querySelector(`.onboarding-step[data-step="${step.el}"]`);
      if (!el) return;
      const isDone = step.key === 'savedUsername' ? saveDone : !!state[step.key];
      el.classList.toggle('done', isDone);
    });
    // Never start cold at 0%: once any step is done, seed at a visible floor.
    const pct = doneCount === 0 ? 8 : Math.round((doneCount / steps.length) * 100);
    if (this.elOnboardingFill) this.elOnboardingFill.style.width = `${pct}%`;
    if (this.elOnboardingLabel) {
      const remaining = steps.length - doneCount;
      this.elOnboardingLabel.textContent = doneCount === 0
        ? `Quick setup — ${remaining} short steps to your first review`
        : `${doneCount} of ${steps.length} done — ${remaining} to go`;
    }
  }

  _renderHomeContinueCard() {
    if (!this.elHomeContinueReview) return;
    let saved = null;
    try { saved = this._loadSavedGameState('review'); } catch (_) {}
    if (!saved || !saved.gameMoves || !saved.gameMoves.length) {
      this.elHomeContinueReview.hidden = true;
      return;
    }
    this.elHomeContinueReview.hidden = false;
    if (this.elHomeContinueMeta) {
      const total = saved.gameMoves.length;
      this.elHomeContinueMeta.textContent = `${total} moves analyzed`;
    }
  }

  _renderHomeStreak() {
    if (!this.elHomeStreak) return;
    const streak = this._currentStreak();
    if (streak >= 2) {
      this.elHomeStreak.textContent = `${streak}-day streak`;
      this.elHomeStreak.hidden = false;
    } else {
      this.elHomeStreak.hidden = true;
    }
  }

  _currentStreak() {
    try {
      const raw = window.localStorage.getItem('sidastuff.streak');
      if (!raw) return 0;
      const data = JSON.parse(raw);
      const last = data.lastDate ? new Date(data.lastDate) : null;
      const today = this._todayKey();
      if (!last) return Number(data.count) || 0;
      const lastKey = `${last.getFullYear()}-${last.getMonth() + 1}-${last.getDate()}`;
      if (lastKey === today) return Number(data.count) || 0;
      // If last activity was yesterday, the streak survives until today's first action.
      const dayMs = 86400000;
      const ageDays = Math.round((Date.now() - last.getTime()) / dayMs);
      return ageDays === 1 ? Number(data.count) || 0 : 0;
    } catch (_) { return 0; }
  }

  _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  _puzzleDailyGoalTarget() {
    // 5 puzzles/day — a small, achievable target that makes the goal ring fill.
    return 5;
  }

  _puzzlesSolvedToday() {
    try {
      const raw = window.localStorage.getItem('sidastuff.puzzleDaily');
      if (!raw) return 0;
      const data = JSON.parse(raw);
      if (data.date !== this._todayKey()) return 0;
      return Math.max(0, Number(data.count) || 0);
    } catch (_) { return 0; }
  }

  _bumpPuzzleDailyGoal() {
    try {
      const today = this._todayKey();
      const raw = window.localStorage.getItem('sidastuff.puzzleDaily');
      const data = raw ? JSON.parse(raw) : { date: today, count: 0 };
      if (data.date !== today) { data.date = today; data.count = 0; }
      data.count = (data.count || 0) + 1;
      window.localStorage.setItem('sidastuff.puzzleDaily', JSON.stringify(data));
    } catch (_) {}
  }

  // Record a qualifying action (review/puzzle/coach completion) for the streak.
  _bumpStreak() {
    try {
      const raw = window.localStorage.getItem('sidastuff.streak');
      const data = raw ? JSON.parse(raw) : { count: 0, lastDate: null };
      const today = this._todayKey();
      const lastKey = data.lastDate ? (() => {
        const d = new Date(data.lastDate);
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      })() : null;
      if (lastKey === today) return; // already counted today
      const dayMs = 86400000;
      const ageDays = data.lastDate ? Math.round((Date.now() - new Date(data.lastDate).getTime()) / dayMs) : 0;
      data.count = ageDays === 1 ? (data.count || 0) + 1 : 1;
      data.lastDate = new Date().toISOString();
      window.localStorage.setItem('sidastuff.streak', JSON.stringify(data));
    } catch (_) {}
  }

  // Populate the three home stat cards from /api/public-stats. Each card shows
  // its own metric; on any failure the cards keep their em-dash placeholder.
  async _loadHomeStats() {
    if (!this.elHomeStats) return;
    const setText = (el, value) => { if (el) el.textContent = value; };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await apiFetch('/api/public-stats', { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('stats unavailable');
      const s = (await res.json())?.stats || {};
      this.elHomeStats.dataset.loaded = 'true';
      setText(this.elHomeStatReviews, this._formatPublicStat(Number(s.movesAnalyzed ?? s.gamesAnalyzed) || 0));
      setText(this.elHomeStatPuzzles, this._formatPublicStat(Number(s.puzzlesSolved) || 0));
      setText(this.elHomeStatCoaches, this._formatPublicStat(Number(s.coachGamesPlayed) || 0));
    } catch (_) {
      // Leave the em-dash placeholders visible (cards already read "—").
    }
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
      // Report byte-accurate download progress from the worker's cache fetch.
      // Maps the download into the 42–82% band of the loading bar; the engine
      // init/handshake fills 82–88. When served from cache it jumps instantly.
      const dlState = { jsDone: false, wasmDone: false };
      const fmtMb = (bytes) => (bytes / 1048576).toFixed(1);
      engine.onDownloadProgress = ({ kind, received, total, cached } = {}) => {
        if (initToken !== this.engineInitToken) return;
        if (cached) {
          if (kind === 'js') dlState.jsDone = true;
          if (kind === 'wasm') dlState.wasmDone = true;
        }
        const pct = 42 + (dlState.jsDone && dlState.wasmDone ? 40 : 8);
        const note = cached
          ? 'Loading cached Stockfish…'
          : (total ? `Downloading Stockfish (${fmtMb(received)} / ${fmtMb(total)} MB)…` : 'Downloading Stockfish…');
        this._setEngineLoadProgress(Math.min(pct, 82), note);
      };
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

      // Use a loop instead of recursion to avoid stack overflow
      let retryModule = this._nextBrowserModuleAfterFailure(this.engineSettings.module);
      while (this.engineSettings.source === 'browser' && retryModule) {
        this.engineSettings.module = retryModule;
        this._populateEngineModules();
        this.elEngineStatus.textContent = 'Browser engine unavailable. Trying another Stockfish module...';
        this._renderIdleEngineInfo('Switching browser engine...');
        
        // Try initializing with the new module
        try {
          // Re-run the initialization logic for the new module
          // We need to re-do the init steps
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
          engine.onDownloadProgress = ({ cached } = {}) => {
            if (initToken !== this.engineInitToken) return;
            this._setEngineLoadProgress(cached ? 82 : 60, cached ? 'Loading cached Stockfish…' : 'Downloading Stockfish…');
          };
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
          break; // Success, exit the loop
        } catch (retryErr) {
          if (initToken !== this.engineInitToken) return;
          retryModule = this._nextBrowserModuleAfterFailure(retryModule);
        }
      }

      // If we exhausted all modules or not a browser engine
      if (!initialized) {
        this.elEngineStatus.textContent = `${moduleConfig.engineLabel}: Failed`;
        this.elEngineLine.textContent = err.message;
        this._setEngineLoadProgress(0, 'Engine failed');
        console.error('Engine init failed:', err);
      }
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
			// Guests always run reviews in the browser (server review needs a UID),
			// so they need the browser engine regardless of analysisLocation.
			const needsBrowserEngine = !serverReview || !this.authState?.user;
		    this.elBtnReview.disabled = this.isAnalyzing || this.gameMoves.length === 0 || (needsBrowserEngine && !engineReady);
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
		      this.elBtnPuzzleReview.disabled = this.isAnalyzing
		        || this.gameMoves.length === 0
		        || (!this.puzzleMode.solved && !this.puzzleMode.failed);
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

    if (this.gameStatus === 'Time') {
      this.elGameStatus.style.display = 'block';
      return;
    }

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
    // During explore-line mode the review results are kept intact (the user
    // is exploring a side branch and can click Back to Review). The snapshot
    // in explorerReturnState holds the canonical copy; don't tear down the
    // review UI here.
    if (this.exploreLineMode || this.explorerReturnState) {
      this.liveDepthToken += 1;
      return;
    }
    // Stop any in-progress deepening before clearing results.
    this.liveDepthToken += 1;

	    this.analysisResults = null;
	    this._forgetReviewSnapshot(this.gameHeaders?.Event === 'Coach');
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

	  // Persist the in-memory engineSettings into localStorage so changes via the
  // in-review panel (Analysis Depth / Maximum Time) survive a reload. The
  // /settings page Save button calls the same helper explicitly.
  _persistEngineSettings() {
	    try {
	      localStorage.setItem('sidastuff.engineSettings', JSON.stringify(this.engineSettings));
	    } catch (_) { /* localStorage unavailable — silently skip */ }
	  }

	  async _handleEngineStrengthChange() {
	    // The in-review "Analysis Depth" select still surfaces the legacy
	    // depthProfile key (depth10/14/18/22/26). Map it onto the new tier
	    // model so changing it actually changes the review profile depth —
	    // previously this only updated `engineSettings.strength` (the legacy
	    // ladder key), which the live-deepening ladder reads but the actual
	    // review profile does not. Without this remap the dropdown was a
	    // no-op for the review's depth and the user couldn't change it.
	    const depthToStrength = { depth10: 'quick', depth14: 'standard', depth18: 'thorough', depth22: 'thorough', depth26: 'thorough' };
	    const value = this.elEngineStrength?.value || 'depth14';
	    this.engineSettings.strength = value;
	    this.engineSettings.depthProfile = value;
	    const newTier = depthToStrength[value];
	    if (newTier) this.engineSettings.reviewStrength = newTier;
	    // Selecting a depth/tier from the in-review panel adopts that tier's default
	    // time cap: clear any prior in-review max-time override so the tier change
	    // isn't silently masked by a leftover custom time.
	    this.engineSettings.maxTimeOverride = false;
	    this._persistEngineSettings();
	    this._renderIdleEngineInfo();
	    this._invalidateAnalysisResults();
	  }

	  async _handleEngineMaxTimeChange() {
	    // Apply the in-review "Maximum Time" selection to the review profile by
	    // writing customTimeMs AND setting maxTimeOverride, the explicit signal
	    // _getReviewProfile needs to honor it. Without maxTimeOverride the value
	    // was gated behind advancedEngine (which this panel never sets), so the
	    // dropdown was a no-op. We do NOT set advancedEngine here — that would
	    // also force the customDepth override and silently change search depth.
	    const raw = Number(this.elEngineMaxTime?.value) || 8000;
	    const clamped = Math.max(500, Math.min(raw, 30000));
	    this.engineSettings.maxTimeMs = clamped;
	    this.engineSettings.customTimeMs = clamped;
	    this.engineSettings.maxTimeOverride = true;
	    this._persistEngineSettings();
	    this._renderIdleEngineInfo();
	    this._invalidateAnalysisResults();
	  }

  _showPgnModal() {
    this._ensureImportModalTabs();
    this.elPgnModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.getElementById('app')?.removeAttribute('aria-hidden');
    this._setImportStatus('');
    this._renderImportResults([]);
    // Render saved username quick-load bar (logged-in users only)
    this._renderSavedUsernameBar();
    // Show "link this username" row after a successful username import
    this._renderLinkUsernameRow();
    const tabs = this.elPgnModal.querySelector('.import-tabs');
    if (tabs) {
      tabs.querySelector('[data-import-tab="pgn"]')?.click();
    }
    this._syncImportMode();
    // Value-before-signup: if the user came from the "Try a sample review" CTA
    // (or is a guest), pre-fill a sample PGN so the first review is one click.
    this._maybePrefillSamplePgn();
    this._bindPgnSampleButton();
    this.elPgnInput?.focus();
  }

  // A short, famous game (Opera Game, 1858) — short enough to review fast,
  // instructive enough that the review teaches something real.
  _samplePgn() {
    return '[Event "Paris"]\n[Site "Paris FRA"]\n[Date "1858.??.??"]\n[White "Morphy"]\n[Black "Duke Karl / Count Isouard"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7\n8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8\n13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0';
  }

  _maybePrefillSamplePgn() {
    if (!this.elPgnInput) return;
    const params = new URLSearchParams(window.location.search);
    const isDemo = params.get('demo') === '1';
    // Only pre-fill when empty (never overwrite a user's paste) and only for
    // guests or explicit demo links — logged-in users with their own games
    // don't need the sample.
    if (this.elPgnInput.value.trim()) return;
    if (isDemo || !this.authState.user) {
      this.elPgnInput.value = this._samplePgn();
      // Clear the demo flag from the URL so it doesn't re-trigger on refresh.
      if (isDemo) {
        params.delete('demo');
        const q = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash);
      }
    }
  }

  _bindPgnSampleButton() {
    if (!this.elBtnPgnSample || this.elBtnPgnSample.dataset.bound) return;
    this.elBtnPgnSample.dataset.bound = '1';
    this.elBtnPgnSample.addEventListener('click', () => {
      if (this.elPgnInput) {
        this.elPgnInput.value = this._samplePgn();
        this.elPgnInput.focus();
      }
    });
  }

  _hidePgnModal() {
    this.elPgnModal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.getElementById('app')?.removeAttribute('aria-hidden');
  }

  _hideSettingsModal() {
    window.AppDialog?.close?.({ isDismissed: true });
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

  // _hideEngineChoiceModal / _confirmEngineChoice removed — the engine-choice
  // modal was dead UI (never displayed). _showEngineChoiceModal now delegates
  // directly to _continueAfterEngineChoice.

  async _continueAfterEngineChoice(nextAction) {
    if (nextAction === 'coach') {
      await this._showCoachSetupModal();
      return;
    }

    this._enterReviewMode();
    this._showPgnModal();
  }

  // Map an ELO to a coarse difficulty band so the setup form can show one
  // segmented control ("Easy / Medium / Hard / Expert") instead of a raw ELO
  // number — one decision instead of three (less decision fatigue).
  _eloToDifficulty(elo) {
    const e = Number(elo) || 1200;
    if (e < 1000) return 'easy';
    if (e < 1400) return 'medium';
    if (e < 1800) return 'hard';
    return 'expert';
  }
  _difficultyToElo(diff) {
    return { easy: 800, medium: 1200, hard: 1600, expert: 2000 }[diff] || 1200;
  }

  async _showCoachSetupModal() {
    const elo = this.coachMode.elo || 1200;
    const difficulty = this._eloToDifficulty(elo);
    const color = this.coachMode.humanColor || 'w';
    const aiAdjust = this.coachMode.aiAdjust !== false;
    const adjustStyle = this.coachMode.adjustStyle || 'better';
    const result = await this._showPopup({
      form: true,
      title: 'Play Coach',
      html: `
        <div class="swal-form-grid">
          <div class="field">
            <span class="field-label">Difficulty</span>
            <div class="coach-difficulty-segments" role="radiogroup" aria-label="Coach difficulty">
              <label class="coach-seg"><input type="radio" name="swal-coach-diff" value="easy" ${difficulty === 'easy' ? 'checked' : ''}><span>Easy</span></label>
              <label class="coach-seg"><input type="radio" name="swal-coach-diff" value="medium" ${difficulty === 'medium' ? 'checked' : ''}><span>Medium</span></label>
              <label class="coach-seg"><input type="radio" name="swal-coach-diff" value="hard" ${difficulty === 'hard' ? 'checked' : ''}><span>Hard</span></label>
              <label class="coach-seg"><input type="radio" name="swal-coach-diff" value="expert" ${difficulty === 'expert' ? 'checked' : ''}><span>Expert</span></label>
            </div>
          </div>
          <label class="checkbox-row coach-adjust-toggle">
            <input id="swal-coach-ai-adjust" type="checkbox" ${aiAdjust ? 'checked' : ''}>
            <span>Auto-adjust to my level</span>
          </label>
          <label class="field coach-adjust-style-field">
            <span class="field-label">Coach target</span>
            <select id="swal-coach-adjust-style" class="input-select" ${aiAdjust ? '' : 'disabled'}>
              <option value="better" ${adjustStyle === 'better' ? 'selected' : ''}>Slightly stronger than me</option>
              <option value="worse" ${adjustStyle === 'worse' ? 'selected' : ''}>Slightly weaker than me</option>
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
				const root = this._swalContentRoot();
				if (!root) return;
        const adjustToggle = root?.querySelector('#swal-coach-ai-adjust');
        const adjustStyleSelect = root?.querySelector('#swal-coach-adjust-style');
        adjustToggle?.addEventListener('change', () => {
          if (adjustStyleSelect) adjustStyleSelect.disabled = !adjustToggle.checked;
        });
      },
      preConfirm: () => {
				const root = this._swalContentRoot();
				if (!root) return false;
        const diff = root.querySelector('input[name="swal-coach-diff"]:checked')?.value || 'medium';
        // Preserve the player's exact ELO if they kept the same band — only
        // quantize to the band midpoint when they actively switch difficulty.
        // (Previously re-confirming the same band silently reset 1350 -> 1200.)
        const eloValue = diff === difficulty ? Math.round(elo) : this._difficultyToElo(diff);
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
		    if (this.elPhaseBreakdown) this.elPhaseBreakdown.innerHTML = '';
		  }

  _hideCoachSetupModal() {
    window.AppDialog?.close?.({ isDismissed: true });
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

// Skill-level chips + Try-it: clicking a chip updates the embed preview;
// clicking "Try it" loads a fresh puzzle of that level on the main board.
// Per-level sample FENs are fetched lazily and cached in this._puzzleLevelSamples.
_initPuzzleLevelRow() {
  if (this._puzzleLevelRowInit) return;
  this._puzzleLevelRowInit = true;
  document.querySelectorAll('input[name="puzzle-level"]').forEach((el) => {
    el.addEventListener('change', () => {
      const checked = document.querySelector('input[name="puzzle-level"]:checked');
      const elo = parseInt(checked?.value, 10);
      if (Number.isFinite(elo)) {
        this._selectedPuzzleLevel = elo;
        this._renderPuzzleLevelEmbed(elo);
      }
    });
  });
  this.elBtnPuzzleLevelTry?.addEventListener('click', () => {
    const elo = Number(this._selectedPuzzleLevel) || 1500;
    this._loadNextPuzzle({ target: elo, difficulty: 'normal' });
  });
  // First-paint: render the embed for the currently-checked level (default 1500).
  this._renderPuzzleLevelEmbed(this._selectedPuzzleLevel);
}

_renderPuzzleLevelEmbed(elo) {
  if (!this.elPuzzleLevelEmbedPreview) return;
  const sample = this._puzzleLevelSamples?.[elo];
  // Until the sample loads, show the empty start position with the level title.
  // Once we have a sample FEN, render that.
  const fen = sample?.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  if (this.elPuzzleLevelEmbedTitle) this.elPuzzleLevelEmbedTitle.textContent = `Try it — ${this._puzzleLevelTitle(elo)}`;
  if (this.elPuzzleLevelEmbedSub) {
    this.elPuzzleLevelEmbedSub.textContent = sample?.rating
      ? `A short puzzle near ${sample.rating}. Drag a piece to play.`
      : `Loading a sample at rating ${elo}…`;
  }
  this.elPuzzleLevelEmbedPreview.innerHTML = this._renderBoardHtmlFromFen(fen);
  // Lazily fetch the sample if we don't have one for this level yet.
  if (!sample) this._fetchPuzzleLevelSample(elo);
}

_puzzleLevelTitle(elo) {
  if (elo <= 1000) return 'Beginner';
  if (elo <= 1500) return 'Intermediate';
  if (elo <= 1900) return 'Advanced';
  return 'Expert';
}

// Render a small 4×4 thumbnail of the first 2 ranks from a FEN, mirroring
// _renderBoardPreview's pattern. Used for the try-it embed.
_renderBoardHtmlFromFen(fen) {
  const placement = String(fen || '').split(' ')[0] || '';
  const ranks = placement.split('/');
  if (ranks.length < 8) return '';
  // Render a 4×4 thumbnail of the four middle ranks (2..5) where most puzzle
  // action lives — same 4×4 grid as the existing _renderBoardPreview pattern.
  const squares = [];
  for (let r = 2; r < 6; r += 1) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/[1-8]/.test(ch)) {
        const empty = parseInt(ch, 10);
        for (let i = 0; i < empty; i += 1) {
          if (file >= 4) break;
          const isLight = (r + file) % 2 === 0;
          squares.push(`<div class="preview-square ${isLight ? 'light' : 'dark'}"></div>`);
          file += 1;
        }
      } else {
        if (file >= 4) break;
        const isLight = (r + file) % 2 === 0;
        const pieceCode = `${ch.toLowerCase() === ch ? 'b' : 'w'}${ch.toUpperCase()}`;
        const img = window.getPieceSvgUri
          ? `<img src="${window.getPieceSvgUri(pieceCode)}" alt="${pieceCode}" loading="lazy">`
          : '';
        squares.push(`<div class="preview-square ${isLight ? 'light' : 'dark'}">${img}</div>`);
        file += 1;
      }
    }
  }
  return squares.join('');
}

async _fetchPuzzleLevelSample(elo) {
  if (this._puzzleLevelSamples?.[elo]) return;
  try {
    const params = new URLSearchParams({
      type: 'next', theme: 'mix', difficulty: 'normal',
      target: String(elo), nonce: String(Date.now()),
    });
    const response = await apiFetch(`/api/puzzle?${params}`, {
      headers: await this._authHeaders(), cache: 'no-store',
    });
    if (!response.ok) return;
    const loaded = await response.json();
    const puzzle = loaded?.data?.puzzle;
    const fen = loaded?.data?.fen;
    if (!puzzle || !fen) return;
    this._puzzleLevelSamples = this._puzzleLevelSamples || {};
    this._puzzleLevelSamples[elo] = {
      fen, rating: puzzle.rating,
    };
    // Re-render only if the user is still viewing this level.
    if (Number(this._selectedPuzzleLevel) === Number(elo)) {
      this._renderPuzzleLevelEmbed(elo);
    }
  } catch (_) { /* non-fatal — embed keeps showing the empty board */ }
}

// Show / hide the big-check success overlay.
_showPuzzleSuccessOverlay() {
  if (!this.elPuzzleSuccessOverlay) return;
  this.elPuzzleSuccessOverlay.hidden = false;
  this.elPuzzleSuccessOverlay.setAttribute('aria-hidden', 'false');
  clearTimeout(this._puzzleSuccessOverlayTimer);
  this._puzzleSuccessOverlayTimer = setTimeout(() => {
    if (!this.elPuzzleSuccessOverlay) return;
    this.elPuzzleSuccessOverlay.hidden = true;
    this.elPuzzleSuccessOverlay.setAttribute('aria-hidden', 'true');
  }, 1600);
}

				  async _enterPuzzleMode() {
				    this._activateGameLayout();
				    document.body.dataset.mode = 'puzzle';
			    if (this.elLiveEval) this.elLiveEval.hidden = true;
	    if (this.coachMode.active) {
	      this.coachMode.active = false;
	      this.coachMode.thinking = false;
	      // Cancel any in-flight coach live-eval and clear its best-move arrow
	      // so a stale red "coach plays X" arrow doesn't persist on the puzzle
	      // board if the puzzle load is slow or fails.
	      this.liveEvalToken += 1; this.liveDepthToken += 1;
	      this.board.clearBestMoveArrow();
	      this._syncCoachControls();
	    }
	    // Stop an in-flight anticheat run if the user left Anticheat mid-check.
	    this._stopAnticheatRun();
		    this.puzzleMode.active = true;
		    this.anticheatMode.active = false;
			    this._initPuzzleLevelRow();
			    this._syncPuzzleVisibility();
			    this._syncAnticheatVisibility();
			    this._syncBoostPageVisibility();
			    this._syncServerStrongToggle();
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
					const response = await apiFetch('/api/puzzle?type=daily', {
			          headers: await this._authHeaders(),
		          cache: 'no-store',
		        });
		      const loaded = await response.json().catch(() => null);
		      if (!response.ok) {
		        const code = loaded?.code;
		        if (response.status === 503 && code === 'puzzle_db_missing') {
		          return this._fallbackPuzzlePayload('Daily puzzle');
		        }
	        throw new Error(loaded?.error || `Puzzle API responded with ${response.status}`);
	      }
		      return loaded;
		    }, { allowFallback: true, fallbackSource: 'Daily puzzle' });
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
				const response = await apiFetch(`/api/puzzle?${params}`, {
		          headers: await this._authHeaders(),
		          cache: 'no-store',
		        });
		      const loaded = await response.json().catch(() => null);
		      if (!response.ok) {
		        const code = loaded?.code;
		        if (response.status === 503 && code === 'puzzle_db_missing') {
		          return this._fallbackPuzzlePayload(`${theme === 'mix' ? 'Mixed' : theme} training puzzle`, { target });
		        }
	        throw new Error(loaded?.error || `Puzzle API responded with ${response.status}`);
	      }
		      if (loaded?.data?.puzzle?.id === excludeId) throw new Error('That puzzle was already on the board. Try again.');
		      return loaded;
		    }, { target, allowFallback: true, fallbackSource: `${theme === 'mix' ? 'Mixed' : theme} training puzzle` });
		  }

		  _fallbackPuzzlePayload(source = 'Local training puzzle', options = {}) {
		    const fallbackPuzzles = [
		      {
		        puzzle: {
		          id: 'local-fallback-1',
		          fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
		          solution: ['h5f7'],
		          rating: 1200,
		          themes: ['mateIn1', 'opening'],
		          popularity: 1,
		          plays: 1,
		        },
		        game: {
		          pgn: '',
		          players: [
		            { color: 'white', name: 'White', rating: 1200 },
		            { color: 'black', name: 'Black', rating: 1200 },
		          ],
		        },
		      },
		      {
		        puzzle: {
		          id: 'local-fallback-2',
		          // Back-rank mate: White mates on g7 after luring the f-pawn.
		          fen: '6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1',
		          solution: ['a1a8'],
		          rating: 1300,
		          themes: ['mateIn1', 'backRank'],
		          popularity: 1,
		          plays: 1,
		        },
		        game: {
		          pgn: '',
		          players: [
		            { color: 'white', name: 'White', rating: 1300 },
		            { color: 'black', name: 'Black', rating: 1300 },
		          ],
		        },
		      },
		      {
		        puzzle: {
		          id: 'local-fallback-3',
		          // Queen forks king and rook.
		          fen: '4k3/8/8/8/8/8/6r1/R3K3 w Q - 0 1',
		          solution: ['a1a8'],
		          rating: 1100,
		          themes: ['mateIn1', 'queen'],
		          popularity: 1,
		          plays: 1,
		        },
		        game: {
		          pgn: '',
		          players: [
		            { color: 'white', name: 'White', rating: 1100 },
		            { color: 'black', name: 'Black', rating: 1100 },
		          ],
		        },
		      },
		    ];
		    // Rotate through fallbacks so consecutive "Next Puzzle" clicks (when
		    // the DB is missing) serve different puzzles and excludeId can dedup.
		    // Vary by the count of fallbacks already served this session.
		    const served = (this._fallbackPuzzlesServed || 0);
		    const index = served % fallbackPuzzles.length;
		    this._fallbackPuzzlesServed = served + 1;
		    return {
		      data: fallbackPuzzles[index],
		      source,
		    };
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
	      if (options.allowFallback) {
	        const fallback = this._fallbackPuzzlePayload(options.fallbackSource || 'Local training puzzle', options);
	        if (token === this.puzzleMode.requestToken) {
	          this._setupPuzzle(fallback.data, fallback.source, options);
	          return;
	        }
	      }
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
    this.exploreLineMode = false;
	    this.analysisResults = null;
	    this.liveMoveResults = [];
	    this.liveEvalHistory = [];
	    this.liveEvalToken += 1; this.liveDepthToken += 1;
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
			      this._setPuzzleStatus('Incorrect. Tap Retry or wait — resetting this puzzle for another try...', 'error');
			      this._syncPuzzlePanel();
			      this._syncActionButtons();
			      this._updateGameStatus();
			      // Make the Retry button surface explicitly on mistake (the
			      // 900ms auto-retry still happens if the user doesn't click).
			      if (this.elBtnPuzzleRetry) this.elBtnPuzzleRetry.disabled = false;
			      window.setTimeout(() => {
			        if (this.puzzleMode.active && this.puzzleMode.failed && this.puzzleMode.current) {
			          this._retryCurrentPuzzle({ automatic: true });
			        }
			      }, 900);
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
				      this._showPuzzleSuccessOverlay();
				      if (this.puzzleMode.step >= this.puzzleMode.solution.length) this._playNamedSound('end');
					      this._setPuzzleStatus(checkmateSolved && !isExpected
					        ? 'Solved by checkmate.'
					        : !rated && !this.puzzleMode.failed
				        ? 'Solved again. Rating is unchanged.'
				        : this.puzzleMode.failed
				        ? 'Solved in practice.'
				        : `Solved. Rating ${this.puzzleMode.lastDelta >= 0 ? '+' : ''}${this.puzzleMode.lastDelta}.`, 'success');
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
		      // Retention hooks must fire for logged-in users too — the daily-goal
		      // ring and streak live in localStorage and drive the puzzle panel UI.
		      if (won) { this._markOnboarding('solvedPuzzle'); this._bumpStreak(); this._bumpPuzzleDailyGoal(); }
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
		    if (won) { this._markOnboarding('solvedPuzzle'); this._bumpStreak(); this._bumpPuzzleDailyGoal(); }
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
		    // Use the text-node helper so a sibling .rating-chip survives the
		    // per-frame value updates.
		    const tick = (now) => {
		      const t = clamp((now - startedAt) / duration, 0, 1);
		      const eased = 1 - Math.pow(1 - t, 3);
		      this._setPuzzleRatingText(String(Math.round(start + ((end - start) * eased))));
		      if (t < 1) {
		        requestAnimationFrame(tick);
		        return;
		      }
		      this._setPuzzleRatingText(String(end));
		      setTimeout(() => target.classList.remove('rating-up', 'rating-down'), 360);
		    };
			    requestAnimationFrame(tick);
		  }

  // Set the rating number via a leading text node so a .rating-chip child
  // (appended on success) is not destroyed by textContent writes.
  _setPuzzleRatingText(value) {
    const target = this.elPuzzleUserRating;
    if (!target) return;
    if (!target.firstChild || target.firstChild.nodeType !== Node.TEXT_NODE) {
      target.insertBefore(document.createTextNode(''), target.firstChild || null);
    }
    target.firstChild.nodeValue = String(value);
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
				const response = await apiFetch('/api/puzzle/solve', {
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

		  _reviewCurrentPuzzleLine() {
		    if (!this.puzzleMode.current || this.gameMoves.length === 0) {
		      this._setPuzzleStatus('Solve a puzzle line before reviewing it.', 'error');
		      return;
		    }
		    if (!this.puzzleMode.solved && !this.puzzleMode.failed) {
		      this._setPuzzleStatus('Finish the puzzle before opening analysis.', 'error');
		      return;
		    }
		    if (this.elLiveEval) this.elLiveEval.hidden = false;
		    this._setPuzzleStatus('Puzzle analysis unlocked.', 'success');
		    this._startReview();
		  }

		  _retryCurrentPuzzle(options = {}) {
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
	    if (options.automatic) this._setPuzzleStatus(`${this.chess.turn() === 'w' ? 'White' : 'Black'} to move. Try again.`);
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

	_formatClock(seconds) {
		if (!Number.isFinite(seconds)) return '';
		const totalSeconds = Math.max(0, Math.round(seconds));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const secs = totalSeconds % 60;
		const padded = (value) => String(value).padStart(2, '0');
		return hours > 0
			? `${hours}:${padded(minutes)}:${padded(secs)}`
			: `${minutes}:${padded(secs)}`;
	}

	_clockSideLabel(side) {
		return side === 'w' ? 'white' : 'black';
	}

	_updateClockDisplays(index = this.currentMoveIndex) {
		const topColor = this.board.flipped ? 'w' : 'b';
		const bottomColor = this.board.flipped ? 'b' : 'w';
		const topSide = this._clockSideLabel(topColor);
		const bottomSide = this._clockSideLabel(bottomColor);

		const topTime = this._clockValueForDisplay(topSide, index);
		const bottomTime = this._clockValueForDisplay(bottomSide, index);

			if (this.elPlayerTopClock) {
				this.elPlayerTopClock.textContent = topTime;
				this.elPlayerTopClock.classList.toggle('has-clock', !!topTime);
				this.elPlayerTopClock.classList.toggle('active-clock', this.clockState.active && this.clockState.currentSide === topSide);
			}
			if (this.elPlayerBottomClock) {
				this.elPlayerBottomClock.textContent = bottomTime;
				this.elPlayerBottomClock.classList.toggle('has-clock', !!bottomTime);
				this.elPlayerBottomClock.classList.toggle('active-clock', this.clockState.active && this.clockState.currentSide === bottomSide);
			}
	}

	_clockValueForDisplay(side, index) {
		if (this.clockState.active) {
			const value = this.clockState[side];
			return this._formatClock(value);
		}
		if (index >= 0 && this.gameClockHistory[index] && Number.isFinite(this.gameClockHistory[index][side])) {
			return this._formatClock(this.gameClockHistory[index][side]);
		}
		if (index < 0 && Number.isFinite(this.initialClocks[side])) {
			return this._formatClock(this.initialClocks[side]);
		}
		return '';
	}

	_resetClockState() {
		if (this.clockState.timerId) {
			clearInterval(this.clockState.timerId);
			this.clockState.timerId = null;
		}
		this.clockState.active = false;
		this.clockState.flagged = false;
		this.clockState.white = null;
		this.clockState.black = null;
		this.clockState.lastTick = 0;
		this.clockState.currentSide = null;
	}

	_endGameOnTime(losingColor) {
		if (!this.clockState.active || this.clockState.flagged) return;
		this.clockState.flagged = true;
		if (this.clockState.timerId) {
			clearInterval(this.clockState.timerId);
			this.clockState.timerId = null;
		}
		this.clockState.active = false;
		const losingName = losingColor === 'w' ? 'White' : 'Black';
		this.gameStatus = 'Time';
		if (this.elGameStatus) {
			this.elGameStatus.style.display = 'block';
			this.elGameStatusTitle.textContent = 'Game End';
			this.elGameStatusReason.textContent = 'Time';
			this.elGameStatusDetails.textContent = `${losingName} lost on time.`;
		}
		if (this.coachMode.active) {
			const humanLost = this.coachMode.humanColor === losingColor;
			const message = humanLost
				? 'You lost on time.'
				: 'Coach lost on time. You win!';
			this.coachMode.thinking = false;
			this.board.interactive = false;
			this.board.clearBestMoveArrow();
			this._setCoachDialog(message, 'Game Over');
			if (!humanLost && !this.coachMode.gameOverCelebrated) {
				this.coachMode.gameOverCelebrated = true;
				this._celebrate();
			}
			this._syncCoachControls();
		}
		this._updateClockDisplays();
	}

	_startClockTimer() {
		if (!this.clockState.active) return;
		if (this.clockState.timerId) return;
		this.clockState.lastTick = Date.now();
		this.clockState.timerId = setInterval(() => {
			const now = Date.now();
			const elapsed = (now - this.clockState.lastTick) / 1000;
			this.clockState.lastTick = now;
			const currentSide = this.clockState.currentSide;
			if (currentSide && Number.isFinite(this.clockState[currentSide])) {
				this.clockState[currentSide] = Math.max(0, this.clockState[currentSide] - elapsed);
				if (this.clockState[currentSide] <= 0 && !this.clockState.flagged) {
					this._endGameOnTime(currentSide === 'white' ? 'w' : 'b');
					return;
				}
			}
			this._updateClockDisplays();
		}, 250);
	}

	_setClockSide(side) {
		if (!this.clockState.active || this.clockState.currentSide === side) return;
		this.clockState.currentSide = side;
		this.clockState.lastTick = Date.now();
		this._updateClockDisplays();
		this._startClockTimer();
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

  // ── AI Coach chat ───────────────────────────────────────────────────
  // /coach is now a streaming chat with a Cerebras-backed LLM that can call
  // tools (stockfish runs in THIS browser via this.engine.evaluate; web_search
  // + coach_games run server-side). Max-users-only. History persists server-side.

  _enterCoachChat() {
    // /coach is its own full-screen page-panel route. The chat experience
    // (localStorage multi-chat + sidebar + markdown + streaming) lives in
    // src/coach-chat.js (window.CoachChat); this just activates the route and
    // mounts the controller.
    this.coachChat.active = true;
    this.coachMode.active = false;
    this.puzzleMode.active = false;
    this.anticheatMode.active = false;
    this._enterInAppLayout();
    this._showRoutePage('coach');
    if (window.CoachChat) window.CoachChat.mount(this);
  }

  // Delegate the gate re-render to the chat controller (called on auth resolve).
  _renderCoachGate() { if (window.CoachChat) window.CoachChat.renderGate(); }


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
      // A coach game runs a live clock (1200s, ticking via setInterval). Stop
      // it here so the timer doesn't keep counting down invisibly after the
      // coach is paused and no game is loaded to reset it.
      this._resetClockState();
      this._updateClockDisplays();
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
	    const diffLabel = this._eloToDifficulty(elo);
	    const diffName = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' }[diffLabel] || 'Medium';
	    const yourSide = humanColor === 'w' ? 'White' : 'Black';
	    // Head-start framing: a match already underway, not a blank "make a move".
	    this._setCoachDialog(`You're playing ${yourSide} against a ${diffName} opponent (${this._effectiveCoachElo()} ELO, ${targetNote}). Your move.`, 'Coaching');
    this._syncCoachVisibility();
    this._syncCoachControls();
    this.board.clearLoading();
    this._updateBoard();

    if (humanColor === 'b') {
      await this._makeCoachMove();
    }
  }

  _syncCoachVisibility() {
    if (!this.elCoachCard) return;
    this.elCoachCard.hidden = !this.coachMode.active;
  }

		  _classificationKey(classification) {
		    if (!classification) return '';
		    return this.analyzer.getClassificationKey(classification)
		      || Object.keys(MoveClassification).find((key) => MoveClassification[key] === classification)
		      || '';
		  }

		  _classificationGlyph(classification) {
		    const key = this._classificationKey(classification);
		    if (classification?.iconType === 'material') return classification.icon || '';
		    return {
		      BRILLIANT: '!!',
		      GREAT: '!',
		      FORCED: '[]',
		      INACCURACY: '?!',
		      MISTAKE: '?',
		      MISS: 'X',
		      BLUNDER: '??',
		    }[key] || classification?.symbol || '';
		  }

		  _classificationIconClass(classification, baseClass) {
		    const key = this._classificationKey(classification).toLowerCase();
		    const iconKind = classification?.iconType === 'material'
		      ? 'material-symbols-outlined classification-material-icon'
		      : 'classification-text-icon';
		    return `${baseClass} classification-mark ${iconKind}${key ? ` classification-${key}` : ''}`;
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
    this.liveEvalToken += 1; this.liveDepthToken += 1;
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
	      // Detect a coach checkmate FIRST so we can skip the (expensive, noisy)
	      // live eval pass on a position that's already decided. The coach's
	      // own score is the right one to surface — a checkmate is always the
	      // best move, so we don't need a fresh MultiPV pass to "confirm" it.
	      const coachDeliveredMate = this.chess.in_checkmate();
	      // Immediately reflect the coach's move on the eval bar using the eval
	      // the coach already computed to choose its move. chosen.cp is Stockfish's
	      // score from the perspective of the side to move at the position the
	      // engine actually evaluated — that's fenBefore, the position BEFORE the
	      // coach moved (the coach picks from engine lines for the to-move side).
	      // The eval bar reads White-absolute, so we need whiteAbsCp() against the
	      // FEN that produced that score. Using fenAfter here would render the
	      // wrong color when the coach plays Black and is winning — the engine's
	      // pre-move eval is from Black's POV (positive = Black winning), but
	      // fenAfter shows White to move, so the naive convert skips the flip and
	      // "Black winning" gets displayed as "White winning".
	      if (typeof chosen.cp === 'number') {
	        const whiteAbsCp = this.analyzer.whiteAbsCp(chosen.cp, fenBefore);
	        this._updateEvalBar(whiteAbsCp);
	      }
	      if (!coachDeliveredMate) {
	        // A checkmate is always the best move — skip the live eval pass that
	        // would just re-derive a mate score and risk flickering the bar as
	        // the engine refines the mate distance.
	        this._requestLiveEvaluation(`Coach played ${move.san}`, {
	          fenBefore,
	          fenAfter: this.chess.fen(),
	          moveObj: move,
	          moveIndex: this.currentMoveIndex,
	          isCoachMove: true,
	        });
	      }
	      // After coach move, switch clock to human if clocks are active
	      if (this.clockState.active) {
	        const nextSide = this.chess.turn() === 'w' ? 'white' : 'black';
	        this._setClockSide(nextSide);
	      }
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
		    // Error moves (Blunder/Mistake/Inaccuracy/Miss) get the rich feedback
		    // panel with a suggested reply + take-back nudge. Brilliant gets
		    // a short celebratory line. Everything else (Best/Excellent/Good)
		    // gets a one-line nudge so the coach doesn't chatter on every move.
		    if (['BLUNDER', 'MISTAKE', 'MISS', 'INACCURACY'].includes(key)) {
		      const reply = result.opponentBestMoveSan || result.opponentBestMove || '';
		      const baseText = (result.coachText || '').trim();
		      const mentionsReply = !reply || baseText.includes(reply);
		      // Assemble the feedback as one natural paragraph instead of
		      // stapling label-like sentences together. Lead with the coach's
		      // assessment, then fold in the reply and the take-back option
		      // conversationally so it reads like an LLM, not a status readout.
		      const parts = [];
		      if (baseText) parts.push(baseText);
		      if (!mentionsReply && reply) {
		        parts.push(`In reply, the coach plays ${reply} — take your move back and try again if you'd like another look.`);
		      } else if (reply) {
		        parts.push(`You can take your move back and try again if you'd like another look.`);
		      } else {
		        parts.push(`Take your move back if you'd like to try something else.`);
		      }
		      let feedback = parts.join(' ');
		      if (adjustNote) feedback += adjustNote;
		      this._setCoachDialog(feedback, key);
		      this._renderMoveInsights(result);
		      if (this.elInsightCoach) this.elInsightCoach.textContent = feedback;
		      if (result.opponentBestMove) this.board.setBestMoveArrow(result.opponentBestMove, { color: '#CA3431' });
		      this.coachMode.lastAdviceMoveIndex = result.moveIndex;
		    } else if (key === 'BRILLIANT') {
		      this._setCoachDialog(`${move.san} — a brilliant find. That's the engine's top choice and a genuinely tough move to spot.${adjustNote}`, 'Brilliant');
		    } else if (key) {
		      this._setCoachDialog(`${move.san} — ${result.classification.name.toLowerCase()}. Solid stuff; keep going.${adjustNote}`, 'Coaching');
		    }
	
		    if (!this._checkCoachGameOver()) {
		      setTimeout(() => this._makeCoachMove(), 700);
		    }
		  }

  _checkCoachGameOver() {
    if (!this.coachMode.active) return false;
    if (this.gameStatus === 'Time' || this.clockState.flagged) return true;
    if (!this.chess.game_over()) return false;

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

	    // The game is over — stop the live clock so its interval doesn't keep
	    // ticking after the result. (_endGameOnTime already stops it for the
	    // timeout path; this covers checkmate/draw/resignation.)
	    this._resetClockState();
	    this._updateClockDisplays();

	    this._setCoachDialog(message, 'Game Over');
	    // Only celebrate on a real win. The clock-timeout path guards with
	    // !humanLost; this checkmate/draw path previously celebrated on losses
	    // and draws too — demoralizing. Confetti now fires only for humanWon.
	    if (humanWon && !this.coachMode.gameOverCelebrated) {
	      this.coachMode.gameOverCelebrated = true;
	      this._celebrate();
	    } else {
	      this.coachMode.gameOverCelebrated = true;
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

	  _ensureImportModalTabs() {
	    const modal = this.elPgnModal;
	    const body = modal?.querySelector('.modal-body');
	    if (!body || body.querySelector('.import-tabs')) return;
	    const grid = body.querySelector('.import-source-grid');
	    const textarea = body.querySelector('#pgn-input');
	    const divider = body.querySelector('.modal-divider');
	    const status = body.querySelector('#import-status');
	    const results = body.querySelector('#import-results');
	    if (!grid || !textarea) return;

	    const tabs = document.createElement('div');
	    tabs.className = 'import-tabs';
	    tabs.setAttribute('role', 'tablist');
	    tabs.innerHTML = `
	      <button type="button" class="import-tab active" data-import-tab="pgn" role="tab">Paste PGN</button>
	      <button type="button" class="import-tab" data-import-tab="username" role="tab">From username</button>`;

	    const panelPgn = document.createElement('div');
	    panelPgn.className = 'import-panel import-panel-pgn active';
	    panelPgn.dataset.importPanel = 'pgn';
	    panelPgn.appendChild(textarea);

	    const panelUsername = document.createElement('div');
	    panelUsername.className = 'import-panel import-panel-username';
	    panelUsername.dataset.importPanel = 'username';
	    panelUsername.appendChild(grid);
	    if (status) panelUsername.appendChild(status);
	    if (results) panelUsername.appendChild(results);

	    if (divider) divider.remove();
	    body.insertBefore(tabs, body.firstChild);
	    body.appendChild(panelPgn);
	    body.appendChild(panelUsername);

	    tabs.querySelectorAll('.import-tab').forEach((tab) => {
	      tab.addEventListener('click', () => {
	        const mode = tab.dataset.importTab;
	        tabs.querySelectorAll('.import-tab').forEach((entry) => entry.classList.toggle('active', entry === tab));
	        body.querySelectorAll('.import-panel').forEach((panel) => {
	          panel.classList.toggle('active', panel.dataset.importPanel === mode);
	        });
	        if (this.elImportSource) {
	          if (mode === 'pgn') {
	            this.elImportSource.value = 'pgn';
	          } else {
	            // Preserve the current username source (lichess or chesscom)
	            // instead of always forcing lichess — otherwise quick-loading
	            // Chess.com games from a saved username would flip the dropdown
	            // to Lichess.
	            const current = this.elImportSource.value;
	            this.elImportSource.value = (current === 'chesscom' || current === 'lichess') ? current : 'lichess';
	          }
	        }
	        this._syncImportMode();
	        if (mode === 'pgn') this.elPgnInput?.focus();
	        else this.elImportUsername?.focus();
	      });
	    });

	    this.elImportSource?.addEventListener('change', () => {
	      const isPgn = this.elImportSource.value === 'pgn';
	      tabs.querySelector('[data-import-tab="pgn"]')?.classList.toggle('active', isPgn);
	      tabs.querySelector('[data-import-tab="username"]')?.classList.toggle('active', !isPgn);
	      body.querySelector('.import-panel-pgn')?.classList.toggle('active', isPgn);
	      body.querySelector('.import-panel-username')?.classList.toggle('active', !isPgn);
	    });
	  }

	  _syncImportMode() {
	    if (!this.elImportSource || !this.elBtnImportUsername) return;
	    const isPgnMode = this.elImportSource.value === 'pgn';
	    const label = this.elBtnImportUsername.querySelector('.btn-label');
	    if (label) label.textContent = 'Load games';
	    this.elImportUsername.disabled = isPgnMode;
	    this.elImportLimit.disabled = isPgnMode;
	    if (this.elImportUsername.parentElement) {
	      this.elImportUsername.parentElement.hidden = isPgnMode;
	    }
	    if (this.elImportLimit.parentElement) {
	      this.elImportLimit.parentElement.hidden = isPgnMode;
	    }
	    const footer = this.elPgnModal?.querySelector('.modal-footer');
	    if (footer) footer.hidden = !isPgnMode;
	    // Re-render the link-username row when source or mode changes
	    this._renderLinkUsernameRow();
	  }

	  // The inline anticheat form (source dropdown + username + limit) was replaced
// by the 3 source cards + SweetAlert popup. These hidden inputs are kept only
// to feed values into _startAnticheatCheck from the popup. This helper is now
// a no-op (no form to sync), but kept as a stub so the call site doesn't crash
// during the transition. Source cards + the popup now drive the form values.
	  _syncAnticheatForm() {
	    // no-op: inline form replaced by source cards + popup
	    return;
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

		  async _openAnticheatSourcePopup(source) {
		    const validSources = ['pgn', 'lichess', 'chesscom'];
		    if (!validSources.includes(source)) return;
		    document.querySelectorAll('.anticheat-source-card').forEach((btn) => {
		      btn.setAttribute('aria-checked', btn.dataset.source === source ? 'true' : 'false');
		    });
		    const titleBySource = {
		      pgn: 'Paste PGN games',
		      lichess: 'Lichess username',
		      chesscom: 'Chess.com username',
		    };
		    const isPgn = source === 'pgn';
		    const limitInitial = parseInt(this.elAnticheatLimit?.value || '10', 10) || 10;
		    const previousUsername = this.elAnticheatUsername?.value || '';
		    const previousPgn = this.elAnticheatPgn?.value || '';
		    const html = `
		      <div class="anticheat-popup">
		        ${isPgn ? `
		          <label class="field">
		            <span class="field-label">PGN</span>
		            <textarea id="swal-anticheat-pgn" class="anticheat-pgn anticheat-popup-pgn" rows="8" placeholder="Paste one PGN or several PGNs here…">${this._escapeHtml(previousPgn)}</textarea>
		          </label>
		        ` : `
		          <label class="field">
		            <span class="field-label">${source === 'lichess' ? 'Lichess username' : 'Chess.com username'}</span>
		            <input id="swal-anticheat-username" class="input-select" type="text" placeholder="username" value="${this._escapeHtml(previousUsername)}" autocomplete="off">
		          </label>
		        `}
		        <div class="anticheat-popup-meta">
		          <span class="field-label">How many games?</span>
		          <div class="anticheat-popup-counts" role="radiogroup" aria-label="Game count">
		            <label class="select-row-item"><input type="radio" name="swal-anticheat-limit" value="5"><span>5</span></label>
		            <label class="select-row-item"><input type="radio" name="swal-anticheat-limit" value="10" checked><span>10</span></label>
		            <label class="select-row-item"><input type="radio" name="swal-anticheat-limit" value="15"><span>15</span></label>
		          </div>
		        </div>
		      </div>
		    `;
		    const result = await this._showPopup({
		      title: titleBySource[source],
		      html,
		      showCancelButton: true,
		      cancelButtonText: 'Cancel',
		      confirmButtonText: 'Start Review',
		      width: 560,
		      didOpen: () => {
		        const root = this._swalContentRoot();
		        if (!root) return;
		        const checked = root.querySelector(`input[name="swal-anticheat-limit"][value="${limitInitial}"]`);
		        if (checked) checked.checked = true;
		        const focusEl = root.querySelector(isPgn ? '#swal-anticheat-pgn' : '#swal-anticheat-username');
		        try { focusEl?.focus({ preventScroll: true }); } catch (_) {}
		      },
		      preConfirm: () => {
		        const root = this._swalContentRoot();
		        if (!root) return false;
		        const limitRadio = root.querySelector('input[name="swal-anticheat-limit"]:checked');
		        const limit = parseInt(limitRadio?.value || '10', 10) || 10;
		        if (isPgn) {
		          const pgn = (root.querySelector('#swal-anticheat-pgn')?.value || '').trim();
		          if (!pgn) {
		            window.Swal?.showValidationMessage?.('Paste at least one PGN first.');
		            return false;
		          }
		          return { source: 'pgn', pgn, limit };
		        }
		        const username = (root.querySelector('#swal-anticheat-username')?.value || '').trim();
		        if (!username) {
		          window.Swal?.showValidationMessage?.('Enter a username first.');
		          return false;
		        }
		        return { source, username, limit };
		      },
		    });
		    if (!result?.isConfirmed || !result.value) return;
		    // Copy the popup's values into the hidden inputs so _startAnticheatCheck
		    // picks them up unchanged.
		    if (this.elAnticheatSource) this.elAnticheatSource.value = result.value.source;
		    if (this.elAnticheatLimit) this.elAnticheatLimit.value = String(result.value.limit);
		    if (this.elAnticheatUsername) this.elAnticheatUsername.value = result.value.username || '';
		    if (this.elAnticheatPgn) this.elAnticheatPgn.value = result.value.pgn || '';
		    await this._startAnticheatCheck();
		  }

		  async _startAnticheatCheck() {
		    if (!this.authState.user) {
		      // Anticheat is server-only (no browser fallback), so it genuinely
		      // needs an account. Explain WHY before bouncing — never a silent
		      // redirect that leaves the user confused.
		      this._setAnticheatStatus('Anticheat needs our server — included with Boost.', 'error');
		      const result = await this._showPopup({
		        icon: 'info',
		        title: 'Anticheat needs an account',
		        text: "Anticheat analysis runs only on our server (it can't run in your browser). Create a free account, then unlock server-side anticheat with Boost (25 games/week).",
		        confirmButtonText: 'Create account',
		        showCancelButton: true,
		        cancelButtonText: 'Not now',
		      });
		      if (result.isConfirmed) this._navigateTo('/signup');
		      return;
		    }
	    // Free plan: anticheat isn't included. Upgrade-prompt instead of hitting
	    // the server (which hard-blocks with 'upgrade_required' anyway).
	    if (this.authState.plan?.plan === 'free') {
	      this._setAnticheatStatus('Anticheat is a Plans feature.', 'error');
	      const result = await this._showPopup({
	        icon: 'info',
	        title: 'Anticheat is a Plans feature',
	        text: 'Server-side cheat detection comes with Boost (25 games/week) and Max (100 games/week). Coach and puzzles stay free.',
	        denyButtonText: 'See plans',
	        showDenyButton: true,
	        showCancelButton: true,
	        cancelButtonText: 'Not now',
	      });
	      if (result.isDenied) this._navigateTo('/plans');
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
		      if (choice !== 'plans') {
		        this._setAnticheatStatus('Weekly anticheat limit reached. It resets Monday — or upgrade to Max for 100 games/week.', 'error');
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
				this._refreshMe().then(() => this._renderAnticheatUsageBar()).catch(() => {});
			} catch (err) {
				console.error('Anticheat failed:', err);
				if (err?.code === 'upgrade_required') {
				  this._setAnticheatStatus('Anticheat is a Plans feature. Upgrade to run server-side cheat detection.', 'error');
				  return;
				}
				if (err?.code === 'quota_exceeded') {
				  this._setAnticheatStatus('Weekly anticheat limit reached. It resets Monday — or upgrade to Max for 100 games/week.', 'error');
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
		    this.anticheatMode.abortController = controller;
		    const timeout = setTimeout(() => controller.abort(), 600000);
		    try {
		      const response = await apiFetch('/api/anticheat/stream', {
		        method: 'POST',
		        headers: await this._authHeaders({
		          'Content-Type': 'application/json',

		        }),
		        signal: controller.signal,
		        cache: 'no-store',
		        body: JSON.stringify(payload),
		      });
		      if (!response.ok) {
		        // Parse JSON for a friendly quota_exceeded message; fall back
		        // to raw text if the body isn't JSON.
		        const text = await response.text().catch(() => '');
		        let parsed = null;
		        try { parsed = text ? JSON.parse(text) : null; } catch (_e) { parsed = null; }
		        const wrapped = new Error(parsed?.error || text || `Anticheat failed with ${response.status}`);
		        if (parsed?.code) wrapped.code = parsed.code;
		        if (parsed?.quota) wrapped.quota = parsed.quota;
		        if (parsed?.plan) wrapped.plan = parsed.plan;
		        throw wrapped;
		      }
		      return await this._readAnticheatStream(response);
		    } catch (err) {
		      if (err.name === 'AbortError') throw new Error('Anticheat check timed out.');
		      throw err;
		    } finally {
		      clearTimeout(timeout);
		      if (this.anticheatMode.abortController === controller) this.anticheatMode.abortController = null;
		    }
		  }

  // Stop an in-flight anticheat run + its status interval when the user
  // navigates away from Anticheat mid-check. Without this the interval keeps
  // firing for up to 10 minutes and the Run button stays disabled on re-entry.
  _stopAnticheatRun() {
    if (this.anticheatMode.statusTimer) {
      clearInterval(this.anticheatMode.statusTimer);
      this.anticheatMode.statusTimer = null;
    }
    if (this.anticheatMode.abortController) {
      try { this.anticheatMode.abortController.abort(); } catch (_) {}
      this.anticheatMode.abortController = null;
    }
    if (this.anticheatMode.checking) this._setAnticheatChecking(false);
  }

		  // DEAD CODE: _readAnticheatStream and _runAnticheatInBrowser below are
		  // unreachable — _startAnticheatCheck exclusively uses _runAnticheatOnServer
		  // (a plain non-streaming fetch). Anticheat is server-only by design.
		  // Retained as a reference impl for a future streaming/browser path; do
		  // not assume they reflect the live request/response shape.
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
		    // Anticheat always uses the Thorough tier (depth 18 / ~2s) regardless of
		    // the user's selected review strength: cheat detection needs to be
		    // thorough, and the user is waiting for the result anyway.
		    const browserProfile = (window.getReviewStrengthTier ? window.getReviewStrengthTier('thorough') : getReviewStrengthTier('thorough'));
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
	    const score = Math.max(0, Math.min(100, Math.round(summary.score || 0)));
	    const riskClass = summary.riskLevel === 'High' ? 'high' : summary.riskLevel === 'Watch' ? 'watch' : 'low';
	    if (this.elAnticheatRiskPill) {
	      this.elAnticheatRiskPill.textContent = summary.riskLevel || 'Low';
	      this.elAnticheatRiskPill.className = `anticheat-risk-pill ${riskClass}`;
	    }
	    const radius = 52;
	    const circumference = 2 * Math.PI * radius;
	    const offset = circumference * (1 - score / 100);
	    const games = Array.isArray(data.games) ? data.games : [];
	    const gamesCount = summary.games || games.length;
	    const metric = (label, value) => `
	      <div class="anticheat-metric">
	        <span>${this._escapeHtml(label)}</span>
	        <strong>${this._escapeHtml(value)}</strong>
	      </div>`;
	    const gameRows = games.slice(0, 12).map((game) => `
	      <div class="anticheat-game">
	        <div>
	          <strong>${this._escapeHtml(game.title || 'Game')}</strong>
	          <small>${this._escapeHtml(game.note || '')}</small>
	        </div>
	        <strong>${Math.round(game.score || 0)}</strong>
	      </div>`).join('');
	    this.elAnticheatResults.innerHTML = `
	      <div class="anticheat-result-ring anticheat-result-ring--${riskClass}">
	        <div class="anticheat-ring-wrap" style="--score:${score}">
	          <svg class="anticheat-ring-svg" viewBox="0 0 120 120" aria-hidden="true">
	            <circle class="anticheat-ring-track" cx="60" cy="60" r="${radius}"></circle>
	            <circle
	              class="anticheat-ring-progress"
	              cx="60"
	              cy="60"
	              r="${radius}"
	              stroke-dasharray="${circumference.toFixed(2)}"
	              stroke-dashoffset="${offset.toFixed(2)}"
	            ></circle>
	          </svg>
	          <div class="anticheat-ring-center">
	            <span class="anticheat-ring-score">${score}</span>
	            <span class="anticheat-ring-label">${this._escapeHtml(summary.riskLevel || 'Low')}</span>
	          </div>
	        </div>
	        <div class="anticheat-ring-copy">
	          <strong>${this._escapeHtml(summary.headline || 'Anticheat score')}</strong>
	          <p>${this._escapeHtml(summary.explanation || 'Heuristic review only — not proof of cheating.')}</p>
	          <span class="anticheat-ring-meta">${gamesCount} game${gamesCount === 1 ? '' : 's'} analyzed</span>
	        </div>
	      </div>
	      <details class="anticheat-advanced" open>
	        <summary>Advanced metrics</summary>
	        <div class="anticheat-metrics">
	          ${metric('Games', gamesCount)}
	          ${metric('Win rate', `${Math.round(summary.winRate || 0)}%`)}
	          ${metric('Accuracy', `${Math.round(summary.accuracy || 0)}%`)}
	          ${metric('Best moves', `${Math.round(summary.bestRate || 0)}%`)}
	          ${metric('ACPL', Math.round(summary.acpl || 0))}
	          ${metric('Mistakes', `${Math.round(summary.mistakeRate || 0)}%`)}
	          ${metric('Fast bests', `${Math.round(summary.fastBestRate || 0)}%`)}
	          ${metric('Fast criticals', `${Math.round(summary.fastCriticalRate || 0)}%`)}
	        </div>
	        ${gameRows ? `<div class="anticheat-game-list">${gameRows}</div>` : ''}
	      </details>
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

			const gameClocks = typeof moveTimesFromPgn === 'function'
				? moveTimesFromPgn(normalized, chess.history().length, parsedHeaders)
				: [];
			const pgnClockValues = typeof parseClock === 'function'
				? [...normalized.matchAll(/\[%clk\s+([0-9:.]+)\]/g)]
					.map((match) => parseClock(match[1]))
					.filter((value) => Number.isFinite(value))
				: [];
			const remainingClockHistory = [];
			if (pgnClockValues.length >= chess.history().length) {
				const lastClock = { white: null, black: null };
				for (let i = 0; i < chess.history().length; i += 1) {
					const side = i % 2 === 0 ? 'white' : 'black';
					lastClock[side] = pgnClockValues[i];
					remainingClockHistory[i] = { white: lastClock.white, black: lastClock.black };
				}
			}
			const baseClock = typeof parseBaseClock === 'function'
				? parseBaseClock(parsedHeaders)
				: null;
		const initialClocks = {
			white: Number.isFinite(baseClock) ? baseClock : null,
			black: Number.isFinite(baseClock) ? baseClock : null,
		};

			this._loadGame(chess.history(), { ...parsedHeaders, ...chess.header(), ...headers,
				_gameClockHistory: gameClocks,
				_gameClockRemainingHistory: remainingClockHistory,
				_initialClocks: initialClocks,
			});
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

    const siteLabel = source === 'chesscom' ? 'Chess.com' : 'Lichess';
    this._setImportStatus(`Loading ${siteLabel} games...`, 'loading');
    this.elBtnImportUsername.disabled = true;
    this._renderImportResults([]);
    const closeLoading = this._showLoadingPopup(`Loading ${siteLabel} games…`);

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
      // Re-render the link-username row now that games loaded successfully
      this._renderLinkUsernameRow();
    } catch (err) {
      console.error('Username import failed:', err);
      this._setImportStatus(err.message || 'Could not load games for that user.', 'error');
    } finally {
      closeLoading();
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
	const response = await apiFetch(`/api/recent-games?${params.toString()}`);
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

    // If we're in a finished review (analysisResults exists) and not already in explore line mode,
    // entering a move should start explore line mode
    const isFinishedReview = this.analysisResults && this.analysisResults.length > 0;
    const shouldEnterExploreLine = isFinishedReview && !this.exploreLineMode && !this.explorerReturnState;

    const fenBefore = this.chess.fen();
    const promotion = this._isPromotionMove(from, to) ? await this._requestPromotionPiece() : undefined;
    const move = this.chess.move({ from, to, promotion }, { sloppy: true });
    if (!move) {
      this.board.setPositionFromFen(this.chess.fen());
      return;
    }

    // If the played move matches the NEXT move of the reviewed main line, just
    // advance to it (like clicking "Next") instead of branching into explore
    // line. Undo the trial move and navigate forward.
    if (isFinishedReview && !this.exploreLineMode && !this.explorerReturnState) {
      const nextIndex = this.currentMoveIndex + 1;
      const nextMainSan = this.originalGameMoves[nextIndex];
      if (nextMainSan && this.analyzer._sameMoveSan(move.san, nextMainSan)) {
        this.chess.undo();
        this._goToMove(nextIndex);
        return;
      }
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
    // detectOpening() is a no-op now (Lichess lookup is async). Don't clobber
    // the opening card on each live move — leave the async-driven card as-is.
    this._updateGameStatus();
    this._playMoveSound(move, this.currentMoveIndex);
    this._syncActionButtons();
    const liveResultPromise = this._requestLiveEvaluation(`Analyzing ${move.san}`, {
      fenBefore,
      fenAfter: this.chess.fen(),
      moveObj: move,
      moveIndex: this.currentMoveIndex,
    });
    // Switch active clock side after a human move (if clocks running)
    if (this.clockState.active) {
      const nextSide = this.chess.turn() === 'w' ? 'white' : 'black';
      this._setClockSide(nextSide);
    }
    if (this.coachMode.active) {
      this._handleCoachHumanMove(move, liveResultPromise);
    }

    // If we were in a finished review and made a move, enter explore line mode
    if (shouldEnterExploreLine) {
      this._enterExploreLineMode();
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
    const playedUci = `${moveObj.from}${moveObj.to}${moveObj.promotion || ''}`;
    const isWhitePlaying = fenBefore.split(' ')[1] === 'w';
    const movePly = moveIndex + 1;
    const timeControl = this.gameHeaders?.TimeControl || this.gameHeaders?.Time || '';

    const posAfter = new Chess(fenAfter);
    const isCheckmate = posAfter.in_checkmate();
    const adjustedScoreAfter = isCheckmate ? (isWhitePlaying ? 10000 : -10000) : scoreAfter;

    const cpLoss = this.analyzer._cpLoss(scoreBefore, adjustedScoreAfter, isWhitePlaying);
    const phase = this.analyzer._phaseFromFen(fenBefore, movePly);

    const secondLine = lines.length > 1 ? lines[1] : null;
    const gapToSecond = this.analyzer._gapToSecond(
      lines[0] ? lines[0].cp : scoreBefore,
      secondLine ? secondLine.cp : null,
      isWhitePlaying
    );

    const playerEdgeBefore = isWhitePlaying ? scoreBefore : -scoreBefore;
    const playerEdgeAfter = isWhitePlaying ? adjustedScoreAfter : -adjustedScoreAfter;
    const playerRating = this.analyzer._ratingForColor(this.gameHeaders, isWhitePlaying);
    const expectedLoss = this.analyzer.expectedPointLoss(playerEdgeBefore, playerEdgeAfter, playerRating);
    const isBestMove = playedUci === bestMove;

    const prevResult = this.liveMoveResults[moveIndex - 1] || this.analysisResults?.[moveIndex - 1];
    const opponentJustBlundered = moveIndex > 0 && prevResult
      && ['BLUNDER', 'MISTAKE'].includes(prevResult.classificationKey);

    const sacCheckBoard = new Chess(fenBefore);
    const sacResult = this.analyzer.checkSacrifice(sacCheckBoard, moveObj.san);
    const legalMoves = new Chess(fenBefore).moves({ verbose: true });

    const priorOpponentMoveSan = moveIndex >= 1
      ? (this.liveMoveResults[moveIndex - 1] || this.analysisResults?.[moveIndex - 1])?.moveSan || ''
      : '';
    const priorOpponentResult = moveIndex >= 1
      ? (this.liveMoveResults[moveIndex - 1] || this.analysisResults?.[moveIndex - 1])
      : null;
    const priorOpponentThreat = !!priorOpponentResult && (
      ['BRILLIANT', 'GREAT', 'BEST'].includes(priorOpponentResult.classificationKey)
      || Math.abs(priorOpponentResult.swing || 0) >= 120
    );

    // During live play a move is "in book" only if every move so far (this one
    // included) still matches a known opening line. Mirrors analyzeGame's
    // `opening && i < opening.ply` gate so live classification matches a review.
    const liveOpening = this.analyzer.detectOpening(this.gameMoves.slice(0, moveIndex + 1));
    const classification = this.analyzer.classifyMove({
      movePly,
      moveSan: moveObj.san,
      moveUci: playedUci,
      fenBefore,
      numLegalMoves: legalMoves.length,
      isCheckmate,
      isPieceSacrifice: sacResult.isPieceSacrifice,
      playerEdgeBefore,
      playerEdgeAfter,
      cpLoss,
      isBestMove,
      gapToSecond,
      scoreBefore,
      scoreAfter: adjustedScoreAfter,
      phase,
      playerRating,
      timeControl,
      opponentJustBlundered,
      isInBook: !!(liveOpening && moveIndex + 1 <= liveOpening.ply),
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
      evalAfter: adjustedScoreAfter,
      swing: adjustedScoreAfter - scoreBefore,
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
        isBestMove,
        bestMoveSan,
        bestMove,
        opponentBestMove,
        opponentBestMoveSan,
        moveUci: playedUci,
        moveSan: moveObj.san,
        movePly,
        scoreBefore,
        scoreAfter: adjustedScoreAfter,
        isWhite: isWhitePlaying,
        playerRating,
        playerEdgeBefore,
        playerEdgeAfter,
        opponentJustBlundered,
        priorOpponentMoveSan,
        priorOpponentThreat,
        mateThreat,
        opponentPvSan: '',
        fenBefore,
        fenAfter,
      }),
    };

    this.liveMoveResults[moveIndex] = result;
    return result;
  }

  /**
   * Depth ladder used for iterative deepening while the user sits on a move.
   * Starts at the user's review profile depth and climbs in +2 steps up to a
   * fixed ceiling, so feedback keeps getting stronger until the user moves on.
   */
  _getAnalysisDepthLadder() {
    const profiles = (window.REVIEW_PROFILES || REVIEW_PROFILES);
    const baseKey = this.engineSettings?.strength || 'depth14';
    const baseDepth = (profiles[baseKey] || profiles.depth14).depth;
    // Bounded ladder: start at the review depth and climb at most two +2 rungs.
    // The earlier ladder climbed base→26 in +2 steps (up to 6 rungs, each
    // re-searching BOTH the before and after position), which could spend tens
    // of seconds re-analyzing one parked move. Depth ≥22 in a browser worker is
    // slow and rarely changes a move classification vs. depth 18-20, so cap at 20.
    const MAX_LADDER_DEPTH = 20;
    const rungs = [];
    for (let d = baseDepth; d <= MAX_LADDER_DEPTH; d += 2) {
      rungs.push(d);
    }
    if (!rungs.length) rungs.push(profiles.depth14.depth);
    return rungs;
  }

  /**
   * Cancel any in-progress "deepen the current move" loop. Called whenever the
   * user navigates away, resets, or a new live evaluation begins.
   */
  _cancelLiveDeepening() {
    this.liveDepthToken += 1;
    this.engine?.interrupt?.();
  }

  _applyLiveResultToUI(liveResult, { context = null } = {}) {
    if (!liveResult || liveResult.isCoachMove) return;
    this._applyBestMoveArrow(liveResult);
    this.board.setHighlights(this._moveHighlightsForResult(liveResult));
    this._showMoveBadge(liveResult.classification, context?.moveObj?.to || null);
    this._renderMoveInsights(liveResult);
    this._showEngineLine(liveResult);
  }

  /**
   * Re-render the Move Feedback section for an already-computed move result
   * produced at a higher depth. Updates score, eval bar/line, badge,
   * classification, and the review statement (coach text), and stores the
   * stronger result so navigation back to this move also reflects it.
   */
  _applyDeepenedResult(liveResult, depth, { moveObj } = {}) {
    const idx = liveResult.moveIndex;
    this.liveMoveResults[idx] = liveResult;
    // If a full game review exists, keep its per-move entry in sync so
    // re-navigating to this move shows the stronger result too (analysisResults
    // takes priority over liveMoveResults in _goToMove's lookup).
    if (Array.isArray(this.analysisResults) && this.analysisResults[idx]) {
      this.analysisResults[idx] = liveResult;
    }
    if (this.currentMoveIndex === idx) {
      this._applyLiveResultToUI(liveResult, { context: { moveObj } });
    }
    this._updateEvalBar(liveResult.evalAfter);
    this.liveEvalHistory[idx] = liveResult.evalAfter;
    this._drawEvalGraph();
    if (this.currentMoveIndex === idx) {
      this._updateLiveEvalPanel({
        busy: false,
        score: liveResult.evalAfter,
        line: `${liveResult.classification.name}: ${liveResult.moveSan}`,
        meta: `Best: ${liveResult.bestMoveSan || '--'} | Depth ${depth} (refining…)`,
      });
    }
  }

  /**
   * Loop that re-evaluates the current move at progressively higher depths
   * while the user stays parked on it. Each pass re-renders the Move Feedback
   * section (classification, coach statement, eval, best move, alternatives)
   * so the feedback keeps sharpening until the user navigates away.
   */
  async _deepenLiveEvaluation(baseContext, initialDepth) {
    if (baseContext?.isCoachMove) return;
    if (this.isAnalyzing) return;                           // a full review is running
    if (!this.engine?.ready) return;
    // Respect the "Climb depth while on a move" setting. When off, the move is
    // analyzed once at the forced depth and never deepened further.
    if (this.engineSettings?.liveDeepening === false) return;
    // Don't re-analyze moves of a completed review. Deepening re-searches the
    // move at higher depths and _applyDeepenedResult writes the fresh result
    // back into analysisResults[idx], which desyncs evalAfter[i] from
    // evalBefore[i+1] (recomputed at a different depth) and corrupts the eval
    // graph, cpLoss, and bestMove. Deepening is still allowed during live play
    // (no analysisResults yet) and in explore-line mode (explorerReturnState
    // snapshots and restores the review, so temporary writes are safe).
    if (this.analysisResults && !this.exploreLineMode) return;
    const token = ++this.liveDepthToken;
    // Interrupt any in-flight engine search from a prior deepening pass so the
    // new climb starts promptly.
    this.engine.interrupt?.();
    const moveIndex = baseContext.moveIndex ?? this.currentMoveIndex;
    const ladder = this._getAnalysisDepthLadder().filter((d) => d > initialDepth);
    if (!ladder.length) return;

    for (let i = 0; i < ladder.length; i += 1) {
      const depth = ladder[i];
      // Pause while the tab is hidden so we don't burn CPU in the background.
      while (document.hidden) {
        if (token !== this.liveDepthToken) return;          // deepening cancelled
        if (this.currentMoveIndex !== moveIndex) return;    // user moved on
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 500));
      }
      if (token !== this.liveDepthToken) return;            // deepening cancelled
      if (this.currentMoveIndex !== moveIndex) return;      // user moved on
      if (!this.liveMoveResults[moveIndex]) return;         // position reset
      if (this.isAnalyzing) return;                         // review started

      const reviewProfile = this._getReviewProfile();
      // Surface deepening progress in the Move Feedback section (live-eval panel
      // meta + busy status) rather than as an on-board overlay, which obstructed
      // the position while the user was still free to move. The board overlay is
      // reserved for genuine blocking states (engine loading, full review, coach
      // thinking) where play is actually paused.
      const maxDepth = ladder[ladder.length - 1];
      this._updateLiveEvalPanel({
        busy: true,
        line: `Analyzing move (depth ${depth}/${maxDepth})`,
        meta: `Refining toward depth ${maxDepth}…`,
      });
      try {
        // Use the tier's own (now-sane) per-move cap. The previous
        // Math.max(8000, timeoutMs) forced EVERY deepening rung to ≥8s, which
        // with a 6-rung ladder meant tens of seconds re-analyzing one move.
        const liveResult = await this._analyzeMoveAtDepth(baseContext, depth, reviewProfile.multiPv, reviewProfile.timeoutMs);
        if (token !== this.liveDepthToken) return;
        if (this.currentMoveIndex !== moveIndex) return;
        if (!liveResult || liveResult.isCoachMove) return;
        if (this.isAnalyzing) return;

        this._applyDeepenedResult(liveResult, depth, { moveObj: baseContext.moveObj });
      } catch (err) {
        // If the engine failed mid-pass, stop the ladder — the UI already
        // shows the previous (valid) deeper result.
        return;
      }
    }

    // Final pass: clear the "refining" note now that deepening is done.
    if (token === this.liveDepthToken && this.currentMoveIndex === moveIndex) {
      const final = this.liveMoveResults[moveIndex];
      const finalDepth = ladder[ladder.length - 1];
      if (final && !final.isCoachMove) {
        this._updateLiveEvalPanel({
          busy: false,
          score: final.evalAfter,
          line: `${final.classification.name}: ${final.moveSan}`,
          meta: `Best: ${final.bestMoveSan || '--'} | Depth ${finalDepth}`,
        });
      }
    }
  }

  /**
   * Pure-compute helper: evaluate a single move (context with fenBefore/move)
   * at the requested depth and return a full live move result (no UI side
   * effects). Extracted from _requestLiveEvaluation so deepening can reuse it
   * at higher depths without re-running the whole live-eval flow.
   */
  async _analyzeMoveAtDepth(context, depth, multiPv, timeoutMs) {
    const prevFen = context.fenBefore;
    const nextFen = context.fenAfter || this.chess.fen();
    const isWhiteToMoveBefore = prevFen.split(' ')[1] === 'w';

    const multi = await this.engine.evaluateMultiPV(prevFen, depth, multiPv, timeoutMs);
    const lines = (multi.lines || [])
      .map((line) => {
        const pvTokens = (line.pv || '').split(/\s+/).filter(Boolean);
        const move = pvTokens.length > 0 ? pvTokens[0] : '';
        return {
          // Stockfish scores are side-to-move-relative; store White-absolute.
          cp: this.analyzer.whiteAbsCp(
            this.analyzer.normalizeScore(line.score || 0, line.scoreType || 'cp', isWhiteToMoveBefore),
            prevFen
          ),
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
    const bestScore = typeof best.cp === 'number' && Number.isFinite(best.cp) ? best.cp : 0;
    const playedUci = `${context.moveObj.from}${context.moveObj.to}${context.moveObj.promotion || ''}`;

    // scoreAfter is the eval of the position AFTER the played move. Evaluate
    // nextFen for both the best-move and non-best cases so the swing reflects
    // the move's actual effect (previously the best-move case reused the
    // before-position eval, making swings read as ~0).
    let scoreAfter = bestScore;
    let opponentBestMove = '';
    let afterDepth = depth;
    const isWhiteToMoveAfter = nextFen.split(' ')[1] === 'w';
    const nextMulti = await this.engine.evaluateMultiPV(nextFen, depth, multiPv, Math.max(6000, timeoutMs));
    const nextLines = (nextMulti.lines || [])
      .map((line) => {
        const pvTokens = (line.pv || '').split(/\s+/).filter(Boolean);
        const mv = pvTokens.length > 0 ? pvTokens[0] : '';
        return {
          cp: this.analyzer.whiteAbsCp(
            this.analyzer.normalizeScore(line.score || 0, line.scoreType || 'cp', isWhiteToMoveAfter),
            nextFen
          ),
          move: mv,
          depth: line.depth || 0,
        };
      })
      .filter((line) => !!line.move);
    const orderedNext = this.analyzer._orderLinesForSide(nextLines, isWhiteToMoveAfter);
    const nextBest = orderedNext[0] || null;
    scoreAfter = nextBest && typeof nextBest.cp === 'number' && Number.isFinite(nextBest.cp)
      ? nextBest.cp
      : bestScore;
    opponentBestMove = nextBest?.move || '';
    afterDepth = nextBest?.depth || depth;

    return this._buildLiveMoveResult({
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
      depth: afterDepth,
      isCoachMove: !!context.isCoachMove,
    });
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
    this.liveDepthToken += 1;
    this.engine.interrupt?.();
	    const fen = this.chess.fen();
	    this.lastLiveEvalFen = fen;
	    const reviewProfile = this._getReviewProfile();
	    // When "Climb depth while on a move" is off, pin live eval to the forced
	    // depth instead of the profile base depth (no ladder climb follows).
	    const depth = this.engineSettings?.liveDeepening === false
	      ? Math.max(8, Math.min(Number(this.engineSettings.forcedDepth) || 16, 30))
	      : reviewProfile.depth;

    if (!context?.isCoachMove) {
      this._updateLiveEvalPanel({
        busy: true,
        score: null,
        line: message,
        meta: `Depth ${depth} | waiting for Stockfish...`,
      });
      // Center the loading popup on the board (not the moved piece's square)
      // so it stays consistent and easy to read during live analysis.
      this.board.setLoading(null, context?.moveObj ? 'Analyzing move' : 'Analyzing');
    }

    try {
      if (context?.fenBefore && context?.moveObj) {
        const liveResult = await this._analyzeMoveAtDepth(context, depth, reviewProfile.multiPv, Math.max(6000, reviewProfile.timeoutMs));
        if (token !== this.liveEvalToken) return;

        if (!liveResult.isCoachMove) {
          this._applyBestMoveArrow(liveResult);
          this.board.setHighlights(this._moveHighlightsForResult(liveResult));
          this._showMoveBadge(liveResult.classification, context.moveObj.to);
          this._renderMoveInsights(liveResult);
          this._showEngineLine(liveResult);
        }
        this._updateEvalBar(liveResult.evalAfter);
        this.liveEvalHistory.push(liveResult.evalAfter);
        if (this.liveEvalHistory.length > 60) this.liveEvalHistory.shift();
        this._drawEvalGraph();
        if (!liveResult.isCoachMove) {
          this._updateLiveEvalPanel({
            busy: false,
            score: liveResult.evalAfter,
            line: `${liveResult.classification.name}: ${context.moveObj.san}`,
            meta: `Best: ${liveResult.bestMoveSan || '--'} | Depth ${liveResult.depth || depth}`,
          });
          this.board.clearLoading();
        }
        this._renderMoveList();
        this._updateActiveMoveInList();
        this._updateGameStatus();
        // While the user stays on this move, climb to higher depths and keep
        // sharpening the feedback. Cancelled automatically on navigation/reset.
        if (!liveResult.isCoachMove) {
          this._deepenLiveEvaluation(context, liveResult.depth || depth);
        }
        return liveResult;
      }

      const result = await this.engine.evaluate(fen, depth, Math.max(6000, reviewProfile.timeoutMs));
      if (token !== this.liveEvalToken) return;

      const isWhiteToMove = fen.split(' ')[1] === 'w';
      const cp = this.analyzer.whiteAbsCp(
        this.analyzer.normalizeScore(result.score || 0, result.scoreType || 'cp', isWhiteToMove),
        fen
      );
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
	    this.liveEvalToken += 1; this.liveDepthToken += 1;
		    this.analysisResults = null;
		    this.explorerReturnState = null;
    this.exploreLineMode = false;
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
    // Opening card is driven by the async Lichess lookup (_loadGame), not reset.
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
			// Convert raw per-ply spent times into per-move remaining clock objects
			const rawTimes = Array.isArray(headers._gameClockHistory) ? headers._gameClockHistory : [];
			const remainingClockHistory = Array.isArray(headers._gameClockRemainingHistory) ? headers._gameClockRemainingHistory : [];
			const baseClock = headers._initialClocks && Number.isFinite(headers._initialClocks.white) ? headers._initialClocks.white : null;
			this.initialClocks = headers._initialClocks || { white: null, black: null };
			this.gameClockHistory = [];
			if (remainingClockHistory.length) {
				this.gameClockHistory = remainingClockHistory.map((entry) => ({
					white: Number.isFinite(entry?.white) ? entry.white : null,
					black: Number.isFinite(entry?.black) ? entry.black : null,
				}));
			} else if (Number.isFinite(baseClock) && rawTimes.length) {
				const lastClock = { white: baseClock, black: baseClock };
			for (let i = 0; i < rawTimes.length; i += 1) {
				const side = i % 2 === 0 ? 'white' : 'black';
				const spent = Number.isFinite(rawTimes[i]) ? rawTimes[i] : null;
				if (Number.isFinite(spent) && Number.isFinite(lastClock[side])) {
					lastClock[side] = Math.max(0, lastClock[side] - spent);
				}
				this.gameClockHistory[i] = { white: lastClock.white, black: lastClock.black };
			}
		}
	    if (loadingCoachGame && this.coachMode.active) {
	      this.initialClocks = { white: 1200, black: 1200 };
	      this.gameClockHistory = [];
	      this.gameStatus = null;
	      this.board.interactive = true;
	      this._resetClockState();
	      this.clockState.active = true;
	      this.clockState.flagged = false;
	      this.clockState.white = 1200;
	      this.clockState.black = 1200;
	      this.clockState.currentSide = this.chess.turn() === 'w' ? 'white' : 'black';
	      this._startClockTimer();
	    } else {
	      this._resetClockState();
	    }
		    this.currentMoveIndex = -1;
		    this.explorerReturnState = null;
    this.exploreLineMode = false;
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
	    this.liveEvalToken += 1; this.liveDepthToken += 1;
	
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

    // Opening name + W/D/B stats now come from the Lichess Masters explorer
    // (async). Show a loading state, then render. (detectOpening() is a no-op.)
    this._refreshOpeningCard();

	    this._updateBoard();
	    this._updateCurrentMoveIndicator();
    this._renderMoveList();
	    this._updateClockDisplays();
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
      if (!this.gameMoves.length && !isCoach) {
        localStorage.removeItem(key);
        this._forgetReviewSnapshot(isCoach);
        return;
      }
	      const state = {
	        moves: this.gameMoves.slice(),
	        headers: this.gameHeaders || {},
	        initialFen: this.initialFen,
	        currentMoveIndex: this.currentMoveIndex,
	        savedAt: Date.now(),
        hasReviewSnapshot: this._saveReviewSnapshot(isCoach),
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

  // Persist the full review snapshot (analysis results + summaries) in a
  // separate localStorage key so a reload restores the completed review, not
  // just the move list. Stored separately because results+PVs can be large.
  _reviewSnapshotKey(isCoach = false) {
    return isCoach ? 'sidastuff.coachReviewSnapshot' : 'sidastuff.reviewSnapshot';
  }

  _saveReviewSnapshot(isCoach = false) {
    try {
      const key = this._reviewSnapshotKey(isCoach);
      if (!Array.isArray(this.analysisResults) || this.analysisResults.length === 0) {
        localStorage.removeItem(key);
        return false;
      }
      // Strip the non-serializable classification object; we rehydrate it from
      // classificationKey on load. Also drop verbose PV strings to save space.
      const slim = this.analysisResults.map((entry) => {
        if (!entry) return entry;
        // eslint-disable-next-line no-unused-vars
        const { classification, alternatives, ...rest } = entry;
        return rest;
      });
      const snapshot = {
        results: slim,
        opening: this.analysisResults.opening || null,
        criticalMoments: (this.analysisResults.criticalMoments || []).map((entry) => {
          if (!entry) return entry;
          // eslint-disable-next-line no-unused-vars
          const { classification, ...rest } = entry;
          return rest;
        }),
        whiteAccuracy: this.analysisResults.whiteAccuracy,
        blackAccuracy: this.analysisResults.blackAccuracy,
        whiteAcpl: this.analysisResults.whiteAcpl,
        blackAcpl: this.analysisResults.blackAcpl,
        whiteCaps: this.analysisResults.whiteCaps,
        blackCaps: this.analysisResults.blackCaps,
        phaseSummary: this.analysisResults.phaseSummary || null,
        savedAt: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(snapshot));
      return true;
    } catch (_) {
      // Most likely a quota-exceeded error on large games; the moves are still
      // saved by _saveGameState, just without the analysis snapshot.
      return false;
    }
  }

  _loadReviewSnapshot(isCoach = false) {
    try {
      const key = this._reviewSnapshotKey(isCoach);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const snapshot = JSON.parse(raw);
      if (!snapshot || !Array.isArray(snapshot.results)) return null;
      const MAX_AGE = 12 * 60 * 60 * 1000;
      if (Date.now() - (snapshot.savedAt || 0) >= MAX_AGE) return null;
      // Rehydrate the classification object from the persisted key.
      const results = snapshot.results.map((entry) => (entry
        ? {
          ...entry,
          classification: MoveClassification[entry.classificationKey] || MoveClassification.GOOD,
          alternatives: entry.alternatives || [],
        }
        : entry));
      results.opening = snapshot.opening || null;
      results.criticalMoments = (snapshot.criticalMoments || []).map((entry) => (entry
        ? { ...entry, classification: MoveClassification[entry.classificationKey] || MoveClassification.GOOD }
        : entry));
      results.whiteAccuracy = snapshot.whiteAccuracy;
      results.blackAccuracy = snapshot.blackAccuracy;
      results.whiteAcpl = snapshot.whiteAcpl;
      results.blackAcpl = snapshot.blackAcpl;
      results.whiteCaps = snapshot.whiteCaps;
      results.blackCaps = snapshot.blackCaps;
      results.phaseSummary = snapshot.phaseSummary || null;
      results.statsRecorded = true; // already recorded on the server, don't double-count
      return results;
    } catch (_) {
      return null;
    }
  }

  _forgetReviewSnapshot(isCoach = false) {
    try {
      localStorage.removeItem(this._reviewSnapshotKey(isCoach));
    } catch (_) {}
  }

	  _savedGameStorageKey(type) {
	    return type === 'coach' ? 'sidastuff.coachGame' : 'sidastuff.reviewGame';
	  }

	  _forgetSavedGameState(type) {
	    try {
	      localStorage.removeItem(this._savedGameStorageKey(type));
	      this._forgetReviewSnapshot(type === 'coach');
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
	      title: isCoach ? 'Continue coach game?' : 'Continue review?',
	      html: this._savedGameRestoreHtml(type, state),
	      confirmButtonText: isCoach ? 'Resume coach' : 'Resume review',
	      showCancelButton: true,
	      cancelButtonText: isCoach ? 'New coach game' : 'Import new game',
	      allowOutsideClick: false,
	      reverseButtons: true,
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
	    // Read the snapshot BEFORE _loadGame: _loadGame sets analysisResults=null
	    // and calls _saveGameState() at its tail, which would delete the
	    // persisted snapshot key before we could read it back (losing accuracy,
	    // classifications, eval graph, critical moments).
	    const snapshot = state.hasReviewSnapshot ? this._loadReviewSnapshot(false) : null;
	    this._loadGame(state.moves || [], state.headers || {});
	    if (snapshot) {
	      this.analysisResults = snapshot;
	      this._showReviewSummary();
	      this._renderCriticalMoments();
	      this._renderPostReviewEvalPanel?.();
	      // Only (re)render the opening card from a saved snapshot that actually
	      // carries one; otherwise leave the async Lichess-driven card in place.
	      if (snapshot && snapshot.opening) this._showOpeningInfo(snapshot.opening);
	    }
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
	      this._updateLiveEvalPanel({
	        busy: false,
	        score: result.evalAfter,
	        line: result.moveSan ? `${result.classification?.name || 'Move'}: ${result.moveSan}` : '',
	        meta: result.depth ? `Depth ${result.depth}` : '',
	      });
	      this._drawEvalGraph();
	      if (!result.isCoachMove) {
	        this._applyBestMoveArrow(result, { allowOnQuiet: false });
	        this._showMoveBadge(result.classification, result.moveUci ? result.moveUci.substring(2, 4) : null);
	        this._renderMoveInsights(result);
	      }
	      this._showEngineLine(result);
	      this._playMoveSound(lastMoveObj, index);
	      // Keep sharpening while the user sits here: cancel any prior deepening
	      // and start a new climb from this move's current depth.
	      if (!result.isCoachMove && lastMoveObj) {
	        this._deepenLiveEvaluation({
	          fenBefore: lastFenBefore, fenAfter: this.chess.fen(),
	          moveObj: lastMoveObj, moveIndex: index,
	        }, result.depth || 0);
	      } else {
	        this._cancelLiveDeepening();
	      }
    } else if (this.analysisResults && index === -1) {
      this._cancelLiveDeepening();
      this._updateEvalBar(this.analysisResults.length > 0 ? this.analysisResults[0].evalBefore : 0);
      this._updateLiveEvalPanel({
        busy: false,
        score: this.analysisResults.length > 0 ? this.analysisResults[0].evalBefore : 0,
        line: 'Original position loaded. Make a move to start live analysis.',
        meta: '',
      });
      this._drawEvalGraph();
      this.elMoveBadge.style.display = 'none';
      this._renderIdleEngineInfo();
      this._resetInsightPanel();
      this.board.clearBestMoveArrow();
    } else {
      this._cancelLiveDeepening();
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
		    this._updateClockDisplays();
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
      // Track the latest live-eval sample (rightmost) instead of always
      // pinning to the right edge. With one sample it's at the edge; with
      // more it follows the most recent move's proportional position.
      const idx = this.liveEvalHistory.length - 1;
      const denom = Math.max(1, this.liveEvalHistory.length - 1);
      const x = (idx / denom) * w;
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
      if (!this.puzzleMode.active) {
        setTimeout(() => this._playNamedSound('end'), 140);
      }
      return;
    }

    if (isGameEnd) {
      if (!this.puzzleMode.active) {
        this._playNamedSound('end');
      }
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
	    if (Math.abs(cpScore) >= 10000) {
	      this.elEvalScore.textContent = 'Checkmate';
	    } else {
	      const formattedScore = this.analyzer.formatScore(cpScore);
	      this.elEvalScore.textContent = formattedScore;
	    }
	  }

	  _showMoveBadge(classification, targetSquare, options = {}) {
    if (!classification) {
      this.elMoveBadge.style.display = 'none';
      return;
    }

    // Brilliant & Great are reward badges — hide them entirely for guests
    // (not signed in). Guests still see every other classification on the
    // board. While auth resolves, treat as guest so a returning logged-in
    // user doesn't briefly lose the badge (re-rendered on auth resolve).
    const _badgeKey = this.analyzer.getClassificationKey(classification);
    if ((_badgeKey === 'BRILLIANT' || _badgeKey === 'GREAT') && this._authGateState() !== 'signedIn') {
      this.elMoveBadge.style.display = 'none';
      return;
    }

    if (targetSquare && this.board.container) {
      const sqEl = this.board.container.querySelector(`[data-square="${targetSquare}"]`);
      if (sqEl && this.board.wrapper) {
        const boardRect = this.board.wrapper.getBoundingClientRect();
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

    // No special animation or treatment for Brilliant/Great/Blunder — every
    // classification badge renders identically, in the standard square-corner
    // position, with no bounce/glow.
    this.elMoveBadge.classList.remove('badge-impact');
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
    if (!this.board.container || !this.board.wrapper) return;
    const existing = this.board.wrapper.querySelector('.board-flash');
    if (existing) existing.remove();

    let flashClass = null;
    if (classification === MoveClassification.MISS) flashClass = 'flash-blunder';
    if (!flashClass) return;

    const flash = document.createElement('div');
    flash.className = `board-flash ${flashClass}`;
    this.board.wrapper.appendChild(flash);
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
	    cell.role = 'button';
	    cell.tabIndex = 0;
	    cell.setAttribute('aria-label', `Go to move ${moveSan}`);

	    const result = this.analysisResults?.[index] || this.liveMoveResults?.[index];

	    const shownMoveBadges = new Set(['BRILLIANT', 'GREAT', 'MISS', 'MISTAKE', 'INACCURACY', 'BLUNDER']);
	    const classificationKey = result?.classificationKey || this.analyzer.getClassificationKey(result?.classification);
	    // Brilliant & Great are reward badges — only for signed-in users. Guests
	    // still see Best/Excellent/Good and the error classes (Inaccuracy/
	    // Mistake/Blunder/Miss); they just don't get the celebratory rewards.
	    // While auth is resolving, treat as guest so a returning logged-in user
	    // never briefly loses the badge (the list re-renders on auth resolve).
	    const signedInForBadges = this._authGateState() === 'signedIn';
	    const badgeHiddenForGuest = (classificationKey === 'BRILLIANT' || classificationKey === 'GREAT') && !signedInForBadges;
	    if (result && !result.isCoachMove && shownMoveBadges.has(classificationKey) && !badgeHiddenForGuest) {
	      const cls = result.classification;
	      const icon = document.createElement('span');
	      icon.className = this._classificationIconClass(cls, 'move-icon');
	      icon.style.background = cls.color;
	      icon.textContent = this._classificationGlyph(cls);
	      icon.setAttribute('aria-hidden', 'true');
	      icon.setAttribute('title', `${cls.name} move`);
	      cell.appendChild(icon);
	      cell.title = `${cls.name} | CP loss: ${Math.round(result.cpLoss || 0)}`;
	      cell.setAttribute('aria-label', `Go to move ${moveSan}. ${cls.name}. CP loss ${Math.round(result.cpLoss || 0)}`);
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

	    const goToMove = () => this._goToMove(index);
	    cell.addEventListener('click', goToMove);
	    cell.addEventListener('keydown', (event) => {
	      if (event.key !== 'Enter' && event.key !== ' ') return;
	      event.preventDefault();
	      goToMove();
	    });

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
    this.liveEvalToken += 1; this.liveDepthToken += 1;
    this._syncActionButtons();
    this._setEngineControlsDisabled(true);
	    this.analyzer.setReviewProfile(this._getReviewProfile());
	    this.elReviewBtnText.textContent = 'Analyzing...';
				    this.elProgressBar.style.display = 'block';
				    // Seed at a visible floor so the bar never reads as "stuck at 0"
				    // the instant the user clicks (progress-bar motivation).
				    this.elProgressFill.style.width = '4%';
				    if (this.elReviewProgressStep) this.elReviewProgressStep.hidden = false;
				    this._showReviewLoadingSkeleton();
				    this.board.setLoading(null, 'Reviewing game');
		    const updateReviewProgress = (current, total, message) => {
		      const pct = Math.round((current / Math.max(1, total - 1)) * 100);
		      this.elProgressFill.style.width = clamp(pct, 0, 100) + '%';
		      if (this.elReviewProgressStep) {
		        this.elReviewProgressStep.textContent = `Analyzing move ${Math.max(1, current)} of ${total}`;
		      }
		      this.elReviewBtnText.textContent = message;
		      // Mirror the review progress onto the on-board loading overlay so
		      // it stays centered on the board with a live progress bar.
		      this.board.setLoadingProgress(clamp(pct, 0, 100), message || 'Reviewing game');
		      this._sprintReviewPlaybackTo(current - 1, { minDelay: 18, maxDelay: 90 });
		      this._updateLiveEvalPanel({
		        busy: true,
		        score: null,
	        line: message,
	        meta: `Reviewing ${this._currentMoveLabel(current - 1)}`,
	      });
	    };
	
		    try {
				      // Value-before-signup: a guest (no account) can't use the server
				      // engine (it requires a Firebase UID for quota). Skip the doomed
				      // server round-trip + 401 and run the review in the browser
				      // directly, with positive copy instead of an apology error.
				      const guestMode = serverReview && !forceBrowserReview && !this.authState.user;
				      if (guestMode && !this.engine?.ready) {
				        // The browser engine isn't ready yet (still downloading the WASM).
				        // Don't crash on null.newGame() — tell the user to wait.
				        throw new Error('Stockfish is still loading. Wait a moment, then try again.');
				      }
				      if (guestMode) {
				        this.elReviewBtnText.textContent = 'Browser fallback...';
				        this._updateLiveEvalPanel({
				          busy: true,
				          score: null,
				          line: 'Running your free review in the browser — no account needed.',
				          meta: 'Sign up after to save and track it.',
				        });
				        this.analysisResults = await this.analyzer.analyzeGame(
				          this.gameMoves,
				          this.engine,
				          updateReviewProgress,
				          { initialFen: this.initialFen, headers: this.gameHeaders }
				        );
				      } else if (serverReview && !forceBrowserReview) {
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

				      // Re-render the opening card only if a server analysis result
				      // carried one; otherwise the async Lichess lookup owns the card.
				      if (this.analysisResults && this.analysisResults.opening) this._showOpeningInfo(this.analysisResults.opening);
				      await this._sprintReviewPlaybackTo(this.gameMoves.length - 1, { minDelay: 6, maxDelay: 22 });
			      this._showReviewSummary();
	      this._renderMoveList();
	      this._renderCriticalMoments();
	      this._renderPostReviewEvalPanel();
	      this._goToMove(0);
	      this._saveGameState();
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
			    // No _startReviewPlayback here: the streaming endpoint emits per-move
			    // progress events and _readServerAnalysisStream drives the playback,
			    // progress bar, and board overlay itself — a second playback loop
			    // here would race with it.
		
			    try {
				      const response = await apiFetch('/api/analyze/stream', {
				        method: 'POST',
				        headers: await this._authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
			        signal: controller.signal,
			        cache: 'no-store',
			        body: JSON.stringify({
			          moves: this.gameMoves,
			          headers: this.gameHeaders || {},
			          initialFen: this.initialFen,
				          profile: (() => {
				            // Boost "stronger" review always uses the Thorough tier
				            // (depth 18 / ~2s), regardless of the user's selected
				            // review strength. Otherwise send the resolved profile
				            // (tier or advanced override). The server clamps + maps
				            // these onto its review profile (analyze.js).
				            const strong = !!this.engineSettings.serverStrongReview && this._isPaidOrAbove('boost');
				            const tier = strong
				              ? (window.getReviewStrengthTier ? window.getReviewStrengthTier('thorough') : getReviewStrengthTier('thorough'))
				              : reviewProfile;
				            return {
				              key: strong ? 'thorough' : reviewProfile.key,
				              strength: strong ? 'strong' : 'standard',
				              depth: tier.depth,
				              multiPv: tier.multiPv,
				              timeoutMs: tier.timeoutMs,
				              serverEngine: strong ? 'full' : 'lite',
				            };
				          })()
			        }),
			      });
			      if (!response.ok) {
			        const text = await response.text().catch(() => '');
			        throw new Error(text || `Server analysis failed with ${response.status}`);
			      }
			      const data = await this._readServerAnalysisStream(response, controller.signal);
			      this.elProgressFill.style.width = '100%';
			      // The streaming endpoint emits an 'error' event (which
			      // _readServerAnalysisStream re-throws) when the Stockfish warm-up
			      // fails or the engine misbehaves, so these guards on the final
			      // payload are belt-and-suspenders for the caller's fallback logic.
			      if (data && data.error) {
			        const err = new Error(data.error);
			        if (data.retryable) err.retryable = true;
			        if (data.code) err.code = data.code;
			        throw err;
			      }
			      if (!Array.isArray(data?.results)) {
			        throw new Error('Server analysis returned no results.');
			      }
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
				        // Mirror onto the on-board overlay (centered, with progress).
				        this.board.setLoadingProgress(clamp(pct, 0, 100), `Reviewing ${completed}/${total}`);
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
	    if (!data || !Array.isArray(data.results)) {
	      throw new Error(data?.error || 'Server analysis returned no results.');
	    }
	    const results = data.results.map((entry) => ({
	      ...entry,
	      classification: MoveClassification[entry.classificationKey] || MoveClassification.GOOD,
    }));
	    results.opening = data.opening || this.analyzer.detectOpening(this.gameMoves);
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
      this.elOpeningName.classList.remove('loading');
      this.elOpeningStats.hidden = true;
      this.elOpeningStats.innerHTML = '';
      return;
    }

    this.elOpeningInfo.style.display = 'flex';
    this.elOpeningName.textContent = `${opening.name}${opening.eco ? ` (${opening.eco})` : ''}`;
    // Stats (White/Draw/Black from Lichess) if present.
    if (opening.stats) {
      this.elOpeningStats.innerHTML = this._openingStatsHtml(opening.stats);
      this.elOpeningStats.hidden = false;
    } else {
      this.elOpeningStats.hidden = true;
      this.elOpeningStats.innerHTML = '';
    }
  }

  // Show the opening card in a loading state while the Lichess lookup is in
  // flight. The spinner lives on the name via the .loading pseudo-element.
  _showOpeningLoading() {
    this.elOpeningInfo.style.display = 'flex';
    this.elOpeningName.classList.add('loading');
    this.elOpeningName.textContent = 'Looking up opening…';
    this.elOpeningStats.hidden = true;
    this.elOpeningStats.innerHTML = '';
  }

  _openingStatsHtml(stats) {
    const cell = (label, pct, cls) => `<span class="opening-stat ${cls}"><span class="opening-stat-val">${pct}%</span><span class="opening-stat-label">${label}</span></span>`;
    return `<span class="opening-stat-total">${(stats.total || 0).toLocaleString()} master games</span>`
      + cell('White', stats.whitePct ?? 0, 'owin')
      + cell('Draw', stats.drawsPct ?? 0, 'odraw')
      + cell('Black', stats.blackPct ?? 0, 'oloss');
  }

  // Convert the game's SAN move list (up to `ply`) to a comma-separated UCI
  // sequence for the Lichess explorer `play` param, by replaying into chess.js.
  _sanMovesToUciPlay(sanMoves, ply) {
    const moves = (sanMoves || []).slice(0, ply);
    if (!moves.length) return '';
    const chess = new Chess();
    let uci = '';
    for (const san of moves) {
      const m = chess.move(san, { sloppy: true });
      if (!m) break;
      const t = m.from + m.to + (m.promotion || '');
      uci += (uci ? ',' : '') + t;
    }
    return uci;
  }

  // Look up the opening name + W/D/B stats from the Lichess Masters explorer
  // (via our /api/opening-explorer proxy). Cached per UCI sequence. Returns an
  // opening object shaped for _showOpeningInfo ({name, eco, stats}) or null.
  async _fetchOpeningFromLichess(sanMoves, ply) {
    const play = this._sanMovesToUciPlay(sanMoves, ply);
    if (!play) return null;
    if (this._openingCache.has(play)) return this._openingCache.get(play);
    try {
      const res = await apiFetch(`/api/opening-explorer?play=${encodeURIComponent(play)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) { this._openingCache.set(play, null); return null; }
      const data = await res.json();
      if (!data || data.error || !data.opening) { this._openingCache.set(play, null); return null; }
      const opening = {
        name: data.opening.name,
        eco: data.opening.eco,
        ply,
        stats: { total: data.total, whitePct: data.whitePct, drawsPct: data.drawsPct, blackPct: data.blackPct },
      };
      this._openingCache.set(play, opening);
      return opening;
    } catch (_) {
      this._openingCache.set(play, null);
      return null;
    }
  }

  // Drive the opening card for the currently loaded game: show a loading state,
  // fetch from Lichess, then render. Called after a game loads and after
  // analysis completes. The Masters explorer is an OPENING tool — it names the
  // opening from the first ~10-16 plies, so we cap the lookup there. Sending a
  // full 90-ply game (a) is pointless (the name doesn't change past the opening)
  // and (b) makes Lichess reject the query. 16 plies covers any main-line name.
  async _refreshOpeningCard() {
    const OPENING_PLY = 16;
    const moves = this.gameMoves || [];
    if (!moves.length) { this._showOpeningInfo(null); return; }
    const ply = Math.min(OPENING_PLY, moves.length);
    // Guard against stale lookups racing a new game load.
    const token = (this._openingToken = (this._openingToken || 0) + 1);
    const play = this._sanMovesToUciPlay(moves, ply);
    const cached = play ? this._openingCache.get(play) : null;
    if (cached) { if (token === this._openingToken) this._showOpeningInfo(cached); return; }
    this._showOpeningLoading();
    const opening = await this._fetchOpeningFromLichess(moves, ply);
    if (token !== this._openingToken) return; // a newer load superseded us
    if (opening) this._showOpeningInfo(opening);
    else {
      this.elOpeningName.classList.remove('loading');
      this.elOpeningInfo.style.display = 'none';
    }
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

    if (this.elPhaseBreakdown) this.elPhaseBreakdown.innerHTML = this._renderSkeletonLines(4);
  }

  _showReviewSummary() {
	    if (!this.analysisResults) return;

	    this.elReviewSummary.style.display = 'block';
	    this.elReviewSummary.classList.remove('review-skeleton');

    // Onboarding + streak hooks: completing a review is a qualifying action.
    this._markOnboarding('review');
    this._bumpStreak();
    this._maybeShowReviewSaveCta();

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
	
	    this._renderPhaseBreakdown();
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
      ['INACCURACY', 'Inaccuracy'],
      ['MISTAKE', 'Mistake'],
      ['MISS', 'Miss'],
      ['BLUNDER', 'Blunder'],
    ];

	    const rows = categories
	      .filter(([key]) => counts[key] > 0)
	      .map(([key, label]) => {
	        const cls = MoveClassification[key];
	        return `<div class="summary-count-row" title="${cls.description}" aria-label="${counts[key]} ${label} moves">
	          <span class="${this._classificationIconClass(cls, 'dot')}" style="background:${cls.color}" aria-hidden="true">${this._classificationGlyph(cls)}</span>
	          <span class="label">${label}</span>
	          <span class="count">${counts[key]}</span>
	        </div>`;
	      })
	      .join('');
	    return rows || '<div class="summary-count-row empty-count-row"><span class="label">No counted moves</span><span class="count">0</span></div>';
	  }

  // Value-before-signup → IKEA effect: after a guest completes a review, show
  // a dismissible, non-blocking banner framing signup as SAVING the work they
  // just did (loss aversion). Never shown to logged-in users; never modal.
  _maybeShowReviewSaveCta() {
    if (!this.elReviewSaveCta) return;
    // Hide for signed-in users AND while auth is still resolving, so a
    // signed-in user never flashes the "save your review" CTA before
    // onAuthStateChanged fires (we re-evaluate on resolve).
    const gateState = this._authGateState();
    if (gateState !== 'guest') {
      this.elReviewSaveCta.hidden = true;
      return;
    }
    // Respect a per-browser dismissal so it doesn't nag returning guests.
    let dismissed = false;
    try { dismissed = window.localStorage.getItem('sidastuff.saveCtaDismissed') === '1'; } catch (_) {}
    this.elReviewSaveCta.hidden = dismissed;
    if (!this.elReviewSaveCtaClose || this.elReviewSaveCtaClose.dataset.bound) return;
    this.elReviewSaveCtaClose.dataset.bound = '1';
    this.elReviewSaveCtaClose.addEventListener('click', () => {
      this.elReviewSaveCta.hidden = true;
      try { window.localStorage.setItem('sidastuff.saveCtaDismissed', '1'); } catch (_) {}
    });
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
	        <span class="${this._classificationIconClass(moment.classification, 'critical-badge')}" style="background:${moment.classification.color}" aria-hidden="true">${this._classificationGlyph(moment.classification)}</span>
	        <span class="critical-text">${moment.moveNumber}${moment.isWhite ? '. ' : '... '}${moment.moveSan}</span>
	        <span class="critical-loss">${Math.round(moment.cpLoss)} cp</span>
	      `;
	      btn.setAttribute('aria-label', `Go to ${moment.classification.name} move ${moment.moveSan}, ${Math.round(moment.cpLoss)} centipawn loss`);
      btn.addEventListener('click', () => this._goToMove(moment.moveIndex));
      return btn;
    });

    this.elCriticalList.innerHTML = '';
    items.forEach((btn) => this.elCriticalList.appendChild(btn));
    this.elCriticalMoments.style.display = 'block';
  }

	  _resetInsightPanel() {
	    if (this.elMoveInsights) this.elMoveInsights.hidden = !this.explorerReturnState;
	    if (this.elInsightEmpty) this.elInsightEmpty.style.display = 'block';
    this.elInsightContent.style.display = 'none';
    this.elInsightMove.textContent = '';
    this.elInsightClass.textContent = '';
    if (this.elInsightClassDesc) this.elInsightClassDesc.textContent = '';
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
    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = !this.explorerReturnState && !this.exploreLineMode;
    this.elInsightAlternatives.innerHTML = '';
    if (this.elInsightGate) this.elInsightGate.hidden = true;
  }

  // Bind the insight-gate "Maybe later" dismiss (once). Per-browser dismissal.
  _bindInsightGateClose() {
    if (!this.elInsightGateClose || this.elInsightGateClose.dataset.bound) return;
    this.elInsightGateClose.dataset.bound = '1';
    this.elInsightGateClose.addEventListener('click', () => {
      if (this.elInsightGate) this.elInsightGate.hidden = true;
      try { window.localStorage.setItem('sidastuff.insightGateDismissed', '1'); } catch (_) {}
    });
  }

  // Re-evaluate the move-insights gate when auth state changes (e.g. after
  // sign-in): if a move is selected, re-render it so locked content opens.
  _refreshInsightsForAuth() {
    if (!this.analysisResults && !this.liveMoveResults?.length) return;
    const idx = this.currentMoveIndex;
    const result = this.analysisResults?.[idx] || this.liveMoveResults?.[idx];
    if (result && !result.isCoachMove) this._renderMoveInsights(result);
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
    if (this.elInsightEmpty) this.elInsightEmpty.style.display = 'none';

    // Feature gate: guests see only a teaser (move + classification) with a
    // sign-up prompt; the detailed rows, coach text, Explore Line, and Top
    // Engine Lines stay locked until they sign in. Respect a per-browser
    // dismissal so it doesn't nag. NEVER show the gate while auth is still
    // resolving — a signed-in user's authState.user can be null on first paint
    // (Firebase onAuthStateChanged is async), and we re-render on resolve.
    const gateState = this._authGateState();
    if (gateState === 'guest') {
      let dismissed = false;
      try { dismissed = window.localStorage.getItem('sidastuff.insightGateDismissed') === '1'; } catch (_) {}
      if (this.elInsightContent) this.elInsightContent.style.display = 'none';
      if (this.elInsightGate) {
        this.elInsightGate.hidden = dismissed;
        if (!dismissed) {
          if (this.elInsightGateMove) {
            this.elInsightGateMove.textContent = `${result.moveNumber}${result.isWhite ? '. ' : '... '}${result.moveSan || result.move}`;
          }
          if (this.elInsightGateClass) {
            this.elInsightGateClass.textContent = result.classification.name;
            this.elInsightGateClass.style.background = result.classification.color;
            this.elInsightGateClass.style.color = '#fff';
          }
          this._bindInsightGateClose();
        }
      }
      return;
    }
    if (gateState === 'resolving') {
      // Auth still resolving: show neither the gate nor the locked content yet.
      if (this.elInsightGate) this.elInsightGate.hidden = true;
      return;
    }

    if (this.elInsightGate) this.elInsightGate.hidden = true;
    this.elInsightContent.style.display = 'block';

    this.elInsightMove.textContent = `${result.moveNumber}${result.isWhite ? '. ' : '... '}${result.moveSan || result.move}`;
    this.elInsightClass.textContent = result.classification.name;
    this.elInsightClass.style.background = result.classification.color;
    this.elInsightClass.style.color = '#fff';
    if (this.elInsightClassDesc) {
      this.elInsightClassDesc.textContent = result.classification.description || '';
    }

    this.elInsightCpLoss.textContent = Math.round(result.cpLoss || 0) + ' cp';
    this.elInsightSwing.textContent = this.analyzer.formatSwing(result.swing || 0);
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
    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = !this.explorerReturnState && !this.exploreLineMode;

    this._renderAlternatives(result);
  }

  _renderAlternatives(result) {
    if (!result?.alternatives?.length) {
      this.elInsightAlternatives.innerHTML = '<div class="alt-title">Top Engine Lines</div><span class="empty-mini">None</span>';
      return;
    }
    const rows = result.alternatives.map((alt) => `
      <div class="alt-row">
        <span class="alt-rank">#${alt.rank}</span>
        <span class="alt-move">${alt.moveSan}</span>
        <span class="alt-eval">${alt.evalText}</span>
      </div>
    `).join('');

    this.elInsightAlternatives.innerHTML = `<div class="alt-title">Top Engine Lines</div>${rows}`;
  }

	  async _exploreLineFromCurrentMove() {
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
	    // NOTE: keep the review UI (summary, critical moments, insights) visible
	    // during explore line — the user is just exploring a branch and can click
	    // "Back to Review" to return. Only clear the per-move live results so the
	    // engine evaluates the branched position fresh.
	    this.liveMoveResults = [];
	    this.liveEvalHistory = [];
    this.exploreLineMode = true;
    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = false;
    this._setExplorerHint(`Exploring ${move.san} — play moves to analyze the branch, or click Back to Review.`);
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

  // Lightweight explorer hint shown in the insights panel during explore-line
  // mode (instead of hijacking the coach card). No-op if the element is absent.
  _setExplorerHint(message) {
    if (this.elInsightCoach) this.elInsightCoach.textContent = message || '';
  }


  _enterExploreLineMode() {
    if (this.exploreLineMode) return;
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
    this.exploreLineMode = true;
    // Keep the review UI (summary, critical moments, insights) visible —
    // explore line is a side branch, not a coach game. Only clear the live
    // per-move results so the engine evaluates the branched position fresh.
    this.liveMoveResults = [];
    this.liveEvalHistory = [];
    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = false;
    this._setExplorerHint('Explore Line mode — play moves to analyze the branch, or click Back to Review.');
    this.board.setChessInstance(this.chess);
    this._updateBoard();
    this._renderMoveList();
    this._updateCurrentMoveIndicator();
    this._updateGameStatus();
    this._requestLiveEvaluation('Explore Line mode active', {
      fenBefore: this.chess.fen(),
      fenAfter: this.chess.fen(),
      moveObj: null,
      moveIndex: this.currentMoveIndex,
    });
  }

  _returnFromLineExplorer() {
    const saved = this.explorerReturnState;
    if (!saved) return;
    this.liveEvalToken += 1;
    this.liveDepthToken += 1;
    this.explorerReturnState = null;
    this.exploreLineMode = false;
    this.gameMoves = saved.gameMoves.slice();
    this.originalGameMoves = saved.originalGameMoves.slice();
    this.initialFen = saved.initialFen;
    this.gameHeaders = { ...(saved.gameHeaders || {}) };
    this.analysisResults = saved.analysisResults;
    this.liveMoveResults = saved.liveMoveResults.slice();
    this.liveEvalHistory = saved.liveEvalHistory.slice();
    this.coachMode = { ...saved.coachMode };
    this.board.flipped = saved.boardFlipped;
    this.chess = new Chess(this.initialFen);
    for (const san of this.gameMoves) this.chess.move(san, { sloppy: true });
    // Restore to the move the user was viewing when they entered explore mode.
    const restoreIndex = Number.isInteger(saved.currentMoveIndex)
      ? Math.min(Math.max(-1, saved.currentMoveIndex), this.gameMoves.length - 1)
      : this.gameMoves.length - 1;
    // Force _goToMove to execute by starting from a differing index; otherwise
    // its `index === currentMoveIndex` early-return skips re-rendering the
    // per-move panel (insights, eval bar, best-move arrow) — the visible
    // symptom of "Back to Review does nothing."
    this.currentMoveIndex = -2;
    this.board.setChessInstance(this.chess);
    this._updateBoard();
    this._renderMoveList();
    this._updateCurrentMoveIndicator();
    this._updateGameStatus();
    this._syncCoachVisibility();
    this._syncCoachControls();
    if (this.elReviewBtnText) this.elReviewBtnText.textContent = 'Re-analyze Game';
    this._showReviewSummary();
    this._renderCriticalMoments();
    this._goToMove(restoreIndex);
    if (this.elBtnReturnExplorer) this.elBtnReturnExplorer.hidden = true;
    this._saveGameState();
  }

  _browserMeetsRequirements() {
    return browserMeetsChessRequirements();
  }
}

window.ChessReviewApp = ChessReviewApp;

// Single source of truth for browser capability checks. The method
// _browserMeetsRequirements() delegates here so the class and the boot path
// never drift apart.
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

window.browserMeetsChessRequirements = browserMeetsChessRequirements;

document.addEventListener('DOMContentLoaded', () => {
  if (!browserMeetsChessRequirements()) {
    // Route directly to the in-SPA incompatible-browser panel instead of the
    // /incompatible-browser.html shim, which bounces back to "/" and re-runs
    // this check (a wasteful double page load). The SPA restores this route.
    const target = '/?spa-route=/incompatible-browser';
    if (!window.location.search.includes('spa-route=/incompatible-browser')) {
      window.location.replace(target);
    }
    return;
  }
  // MoveAnalyzer is defined in chess-core.js, which main.js imports before
  // app.js. Static ES module imports complete before this DOMContentLoaded
  // handler runs, so the class is guaranteed available — no retry needed.
  if (typeof MoveAnalyzer === 'undefined') {
    console.error('MoveAnalyzer failed to load. Please refresh the page.');
    return;
  }
  window.app = new ChessReviewApp();
  // Expose the SPA app to other scripts (e.g. boost.js) so they can navigate in-page.
  window.SidaApp = window.app;
});
