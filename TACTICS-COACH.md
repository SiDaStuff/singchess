# Verified Game Review coaching

The review uses the existing chess.js rules, Stockfish results and custom
ChessBoard. It adds no framework or external service. The same teaching modules
are available to the backend through `server/api/_lib/analysis-loader.js`.

## Data flow

`review result → legal before/after position → board features → candidate motifs
→ complete variation replay → immutable lesson → board annotations → demonstration`

`src/tactics-coach.js` produces the lesson. `src/tactics-advanced.js` supplies
additional detectors that need concrete continuation evidence. A bounded cache
includes the position, grade and engine payload, so revisiting a move reuses its
analysis while updated recommendations produce a fresh lesson.

Each lesson carries before/after FENs, the legal move, evaluation context,
verified motifs and threats, an optional better move, a specific takeaway, and
legal demonstrations. Every fact and demonstration step owns its FEN, arrow
endpoints, square highlights, role labels and verification detail. Cached
lessons are frozen to prevent a presentation component changing chess facts.

## Evidence boundaries

- Board facts describe exact attacks, legal captures, pins, structure and
  terminal results. An alignment alone does not establish a material win.
- Line facts describe a wholly replayed engine continuation. An illegal suffix
  or contradictory saved recommendation invalidates that line, rather than
  turning a valid prefix into a purported complete variation.
- An engine recommendation is an engine opinion. A legal continuation does not
  mean an opponent must choose it. A move is marked forced only when that exact
  position has one legal move.
- Repeated checks in one drawing line do not prove an unavoidable perpetual.
  Mating-net proofs use bounded, exhaustive legal defenses when available.
- Unsupported strategic claims are omitted. Geometry and legality never come
  from a language model, and text does not drive board annotations.

## Presentation and lifecycle

`src/ui/tactical-coach.js` renders insights, threats, the better move, takeaway,
branch selector and playback controls. `src/ui/move-explanation.js` shares one
preview baseline between inline references, fact inspection and demonstrations.
The game controller's chess state and move history are unchanged during a
demonstration. Return, Escape, navigation and route changes restore the baseline
and stop playback. A board flip preserves the step and redraws its coordinates.

The board maintains coach markings separately from user drawings and its best
move arrow. It rejects markings for a different displayed position. Roles are
green for suggestions, red for threats, yellow for tactical relationships and
blue for defenders; text descriptions accompany the colors. Opacity is
adjustable. Demonstration slides respect animation preferences and reduced
motion; inline hover transitions stay immediate. Compact controls beside the
board keep demonstrations usable while reading the explanation on mobile.

## Verification

Run `npm test` for chess, engine, API and data regressions. Start a local Vite
preview on port 4173, then run `npm run test:ui:tactics` and
`npm run test:ui:explanations` for integrated teaching workflows.
`npm run test:ui:annotations` runs the board in an isolated browser and needs no
backend. Browser fixtures block external services and never use real accounts.
