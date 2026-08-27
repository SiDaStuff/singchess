// partials.js — fetch + mount the HTML partials into the live preview shell.
// Keeps the redesign modular: Sidebar.html / Header.html / BoardWrapper.html
// are standalone deliverables AND real, server-renderable fragments.

/**
 * Load a partial from /redesign/components/{name} into an element by id.
 * @param {string} name  filename inside redesign/components/
 * @param {string} into  id of the host element
 */
export async function loadPartial(name, into) {
  const host = document.getElementById(into);
  if (!host) throw new Error(`loadPartial: host #${into} not found`);
  const res = await fetch(`/redesign/components/${name}`);
  if (!res.ok) throw new Error(`loadPartial: ${res.status} for ${name}`);
  host.innerHTML = await res.text();
}
