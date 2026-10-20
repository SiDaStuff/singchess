import { Chess } from 'chess.js';
import pages from './templates/pages.html?raw';
import workspace from './templates/workspace.html?raw';
import dialogs from './templates/dialogs.html?raw';

// Mount once before the existing controller binds its controls. The game,
// authentication and API contracts stay in their established modules.
window.Chess = Chess;
// This private policy accepts only the statically imported application
// templates below. User and provider content uses the sanitizing default.
const templates = window.trustedTypes?.createPolicy('chess-templates', { createHTML: markup => markup });
for (const [name, markup] of Object.entries({ pages, workspace, dialogs })) {
  const mount = document.querySelector(`[data-template="${name}"]`);
  const html = name === 'pages' ? markup.replace(/<img(?![^>]*loading=)/g, '<img loading="lazy" decoding="async"') : markup;
  if (mount) mount.outerHTML = templates ? templates.createHTML(html) : html;
}
