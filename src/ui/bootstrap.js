import { Chess } from 'chess.js';
import home from './templates/home.html?raw';
import pages from './templates/pages.html?raw';
import workspace from './templates/workspace.html?raw';
import dialogs from './templates/dialogs.html?raw';

// Mount once before the existing controller binds its controls. The game,
// authentication and API contracts stay in their established modules.
window.Chess = Chess;
for (const [name, markup] of Object.entries({ home, pages, workspace, dialogs })) {
  const mount = document.querySelector(`[data-template="${name}"]`);
  if (mount) mount.outerHTML = markup;
}
