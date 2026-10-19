# Quality-of-life improvements

This tracks all 85 items from the requested list. `Added` describes this pass;
`Existing` describes behavior retained from the app. All work is local to this
checkout. Browser notifications require permission from the browser; preference
sync requires signing in and an available API. No real games are created by tests.

Open **Settings → Controls and accessibility** for the shared controls, or press
**Ctrl/Cmd+K** to find commands. Notes, review drafts, cached reviews, and puzzle
repetition are saved on this device and separated by account. Preference exports
include only a fixed list of preference keys, never tokens, chats, or notes.

| # | Improvement | Status and implementation |
|---|---|---|
| 1 | Restore page scroll | Added: per-route scroll storage. |
| 2 | Navigation shortcuts | Added: Alt+P/R/U/C/S. |
| 3 | Shortcut tooltips | Added: board and navigation tooltips. |
| 4 | Command palette | Added: searchable, keyboard-accessible commands. |
| 5 | Remember last page | Added: optional restoration on home-page reload. |
| 6 | Preserve unsaved review work | Added: local drafts and an explicit Restore review command. |
| 7 | Warn before leaving active work | Added: game/analysis navigation confirmation and browser unload protection. |
| 8 | Loading skeletons | Existing: board and review skeletons; preserved during the new flows. |
| 9 | Quiet notices | Added: short-lived toast confirmations; Play notices expire and invalid premoves cancel silently. |
| 10 | Connection indicators | Added: API, Lichess, and engine status in the header; game status stays in Play. |
| 11 | Restore dialog focus | Existing custom dialog focus handling; added for native dialogs. |
| 12 | Remember sidebar collapse | Added: site sidebar preference; Coach history sidebar also remembers its state. |
| 13 | Back to active game | Added: header action while a game is active. |
| 14 | Browser history preserves state | Added: review and puzzle session snapshots alongside the existing router. |
| 15 | One shared board | Existing: all interactive boards use ChessBoard, including new comparison/Coach previews. |
| 16 | Immediate move display | Existing: optimistic move display reconciles with SSE. |
| 17 | Consistent move input | Existing click/keyboard/mouse; added touch dragging through the shared board. |
| 18 | Animation speed | Added: shared duration slider including instant movement. |
| 19 | Remember orientations | Added: separate Play and Review orientation storage. |
| 20 | Flip shortcut | Added: F; existing flip buttons remain. |
| 21 | Configure highlights | Added: independent legal-dot and last-move controls. |
| 22 | Coordinate placement | Added: inside, outside, or hidden. |
| 23 | Resize board | Added: desktop edge drag, keyboard-accessible separator, and width slider. |
| 24 | Avoid scrolling during drag | Added: shared board touch-action and captured pointers. |
| 25 | Promotion near destination | Added: promotion panels anchor near the destination square. |
| 26 | Auto-queen with Shift override | Existing in Play; added as a shared control for other game modes. |
| 27 | Consistent board drawings | Existing shared annotations, used by every interactive board. |
| 28 | Clear drawings after moves | Added: configurable shared drawing behavior. |
| 29 | High contrast | Added: high-contrast board/UI preset. |
| 30 | Alternative highlight palettes | Added: blue/orange and purple/gold presets. |
| 31 | Optimistic moves and rollback | Existing: immediate display with rollback and authoritative resync after a failed submission. |
| 32 | Persistent game SSE | One browser game subscription while a game is active, including navigation to another page; idle lobby streams close. Shared provider hub on the server. |
| 33 | Reconnect indicator | Existing: compact toolbar status; retained position while reconnecting. |
| 34 | Preserve position/clocks | Existing: reconnect does not reset the running clock estimate or board. |
| 35 | Latency display | Added: most recent non-stream request duration in the Play toolbar; includes transport and auth time. |
| 36 | Distinct game sounds | Existing shared synthesized move/capture/check/castle/promotion/low-time/end effects. |
| 37 | Quick mute | Added: Play toolbar button and M shortcut. |
| 38 | Friendly-occupied premoves | Existing: destination remains selectable and is validated when the turn arrives. |
| 39 | Multiple queued premoves | Added: optional queue of up to ten moves, with planned-piece positions and per-turn validation. |
| 40 | Silent premove cancellation | Existing; extended to invalid queued sequences. |
| 41 | Resignation confirmation | Existing: explicit confirmation before submitting. |
| 42 | Remember game setup | Existing time-control/rated settings storage. |
| 43 | Rematch | Added: challenge the same opponent with the same clock/rated settings and reversed colors. |
| 44 | Search/challenge timers | Added: elapsed search time and a 30-second outgoing-challenge auto-cancel countdown. |
| 45 | Turn/game notifications | Added: optional desktop notifications while the tab is hidden; click returns to Play. |
| 46 | Captures and material | Added beside Play player names, derived from confirmed move history. |
| 47 | Active clock styling | Existing running-clock color/border; retained. |
| 48 | Larger low-time clock | Added below 30 seconds for the running clock. |
| 49 | Optional tenths | Existing formatting; added shared toggle for tenths below 10 seconds. |
| 50 | Lichess fallback | Added: direct game link when the game connection is unavailable. |
| 51 | First mistake after review | Added: optional first-mistake selection after completed/cached reviews. |
| 52 | Move navigation keys | Existing arrows/Home/End; shortcuts remain available in Review. |
| 53 | Evaluation scrubbing | Added: pointer drag through the evaluation graph. |
| 54 | Synchronized review panels | Existing move navigation updates board, graph, feedback, and move list. |
| 55 | Keep selected move visible | Existing bounded move-list auto-scroll. |
| 56 | Move classification filters | Added: blunders, mistakes, inaccuracies, and missed opportunities. |
| 57 | Jump between mistakes | Added: buttons and J/K shortcuts with wraparound. |
| 58 | Notes and bookmarks | Added: account-separated local position notes and bookmark buttons. |
| 59 | Played/best comparison | Added: two shared ChessBoards from the same before-position, with legal moves only. |
| 60 | Remember panel layout | Added: panel-width preference, edge resize, and saved analysis-panel collapse state. Expand controls stay visible; View and session → Expand all panels restores the layout. |
| 61 | Focus mode | Added for Review; existing Play focus mode integrated with Z. |
| 62 | Annotated PGN | Added: notes, classifications, evaluations, engine alternative, and manual variations. |
| 63 | Copy position/game/link | Added quick FEN, PGN, and FEN-based position-link actions; existing download export retained. |
| 64 | Cache completed reviews | Added: account-separated bounded local cache, including result metadata and variations. |
| 65 | Move-based analysis progress | Existing progress includes current move and total, on the board and review panel. |
| 66 | Remember puzzle choices | Added theme/difficulty controls; existing local/account rating settings retained. |
| 67 | Next puzzle shortcut | Added: N and an explicit next button. |
| 68 | Focus puzzle board | Added when a puzzle is set up. |
| 69 | Retry before solution | Existing Retry; engine suggestions now remain hidden during unfinished/failed attempts. |
| 70 | Puzzle repetition | Added: failed-puzzle practice queue, due dates, and expanding intervals after success. Repeat practice cannot award rating twice. |
| 71 | Post-puzzle explanation | Added compact theme summary after success; existing engine feedback and Review Puzzle open only after completion/explicit review. |
| 72 | Ask about current position | Added: Ask Coach passes a validated board context without copying a FEN. |
| 73 | Preserve Coach history | Existing per-account chats; sidebar state and route scroll now persist. |
| 74 | Coach move previews | Added: legal SAN references become keyboard-accessible previews using the shared board. |
| 75 | Clear Coach markings | Added: Escape clears drawings/Coach annotations across mounted boards. |
| 76 | Global board/audio controls | Added shared sound, animation, highlight, coordinate, and auto-queen controls; existing theme/piece selectors retained. |
| 77 | Sync appearance | Added: appearance/usability settings saved through the signed-in profile API and restored at sign-in. Save applies without reloading. |
| 78 | Accessibility presets | Added reduced-motion/high-contrast controls; existing OS reduced-motion board behavior retained. |
| 79 | Follow system theme | Existing system/light/dark setting; system remains the default. |
| 80 | Reading size | Added shared move-list and explanation font-size slider. |
| 81 | Screen-reader status | Added turn/check/result announcements; existing piece/square and clock accessible labels retained. |
| 82 | Keyboard access | Existing shared grid input and native controls; new commands, settings, notes, resizing, and preview dialogs are keyboard accessible. |
| 83 | Per-section reset | Added resets for each new settings section, board appearance, and engine settings. |
| 84 | Settings previews | Existing board preview; added sound preview and immediate controls. |
| 85 | Import/export preferences | Added versioned JSON, fixed key allowlist, validation before applying, and no private-content export. |

## Checks

- `npm run test:ui:design`: light/dark themes, compact headings, responsive
  routes, reduced motion, button contrast, and accurate public counters.
- `npm test`: existing backend/chess/analysis regressions.
- `npm run test:play`: API, fair-play, clocks, and shared-board interaction tests,
  including multiple queued premoves at 640px and 320px.
- `npm run test:qol`: preference validation, private-data exclusion, review
  filters, spaced repetition, annotated PGN replay, and public puzzle access
  with authenticated account restrictions and global feature controls.
- `npm run test:ui:qol`: command palette, live settings, notes, saved review,
  filters, comparisons, focus mode, collapse recovery, guest Brilliant/Great
  badges, Classic colors, and grouped controls at 1440px, 390px, and 320px.
- `npm run test:ui:play`: account/game/SSE/result/review fixtures at 1440px,
  390px, and 320px. No real games.
- `npm run test:ui:coach`: Coach usage/chat/account fixtures.
- `npm run test:ui:annotations`: shared-board drawings, previews, and animations.
- `npm run test:ui`: existing route/board/engine/settings browser checks.

Start Vite first. Existing UI scripts that default to port 4173 can run against
Vite with `UI_TEST_URL=http://127.0.0.1:5173` set in their process environment.
