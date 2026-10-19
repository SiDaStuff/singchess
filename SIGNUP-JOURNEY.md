# Signup and upgrade journey

Guests see free account benefits on Home and in the sidebar. Completing a
review or solving a puzzle adds a contextual signup prompt. These links open
the account form directly; board, skill, and integration setup remain optional.
Quick signup preserves the guest's current rating and board choices.

Signed-in users see three real training steps: create an account, review a
game, and solve a puzzle. Completion is stored separately for each account on
the device. Guest activity is not assigned to a different account.

Boost prompts follow a completed review or use of the server review allowance.
Coach prompts appear at 80% of the actual allowance: Free points to Boost,
Boost points to Max. Prices come from the existing pricing cards. Paid plan
changes continue through the existing contact flow.

The flow uses relevant benefits, small achievable steps, progress feedback,
and a comparison at the point of need. It does not change feature access or
introduce scarcity claims, timers, or invented customer statistics. Contextual
prompts can be dismissed for 24 hours, are hidden during active-game
protection, and wait for resolved authentication and verified plan data.

Implementation: `src/ui/training-journey.js`, `src/ui/journey-state.js`, and
`src/ui/training-journey.css`. Signup and query-preserving navigation remain
in `src/app.js`; pricing state remains in `src/boost.js`.

Checks: `npm run test:journey`, `npm run test:ui:journey` (start Vite first),
plus the existing site, authentication, Play/OAuth, and QoL regression suites.
