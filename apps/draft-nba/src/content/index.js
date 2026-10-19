// Mounts the panel into a draft room and decorates the site's own player rows.
// The badge layer is strictly optional: if the site's markup shifts, badges silently stop
// and the panel is untouched.
//
// Runs on two sites: ESPN, where the real draft happens, and Sleeper, which is where the
// whole thing gets rehearsed with keepers in their proper rounds. Which one we're on is
// decided once, here, and passed down -- nothing below this file sniffs the URL.

import { h, render } from 'preact';
import { Panel } from '../panel/Panel.js';
import { attachBadges } from './badges.js';
import { installFetchRelay } from '../core/espn-fetch.js';
import { extensionAlive } from '../core/runtime.js';
import { PLATFORMS, platformForHost, ESPN, SLEEPER } from '../core/platform.js';
import { draftIdFromUrl } from '../core/sleeper-constants.js';
import { startDraftRoomReader } from './dom-draft.js';

const HOST_ID = 'draft-copilot-root';
const platform = platformForHost(location.hostname);

// Register this before anything else: the service worker relies on any ESPN tab,
// draft room or not, to make same-site requests on its behalf. It exists solely for
// ESPN's SameSite cookie problem -- Sleeper's API is public, so it has nothing to do there.
if (platform === ESPN) installFetchRelay();

function isDraftRoom() {
  if (!platform) return false;
  // ?copilot=1 force-mounts anywhere on either site, for pre-draft dry runs.
  if (new URLSearchParams(location.search).get('copilot') === '1') return true;
  return PLATFORMS[platform].isDraftRoom(location, document);
}

// The draft id is in the URL of every Sleeper draft room, including a throwaway mock, so
// a fresh mock needs no configuration at all.
const draftId = () => (platform === SLEEPER ? draftIdFromUrl(location.href) : null);

// ESPN's draft room URL always carries its own leagueId too (?leagueId=...) -- read it the
// same way, so the panel self-corrects to whatever league you're actually standing in
// instead of quietly polling a stale or wrong one left over in options from a prior season
// or a different league.
const leagueId = () => (platform === ESPN ? new URLSearchParams(location.search).get('leagueId') : null);

function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  // Draggable, resizable shell so it never fights ESPN's layout.
  const shell = document.createElement('div');
  shell.className = 'dc-shell';
  host.appendChild(shell);
  makeDraggable(shell);

  render(h(Panel, { platform, draftId: draftId(), leagueId: leagueId() }), shell);
  raiseToTopLayer(host);
  if (platform === ESPN) startDraftRoomReader();

  try {
    attachBadges(platform);
  } catch (err) {
    console.warn('[Draft Copilot] badge layer disabled:', err.message);
  }
}

// A page that opens a modal <dialog> or goes fullscreen paints in the top layer, above
// any z-index. Put the panel there too, and re-raise it whenever the page adds something
// that might have landed above it (later top-layer entries paint over earlier ones).
function raiseToTopLayer(host) {
  if (typeof host.showPopover !== 'function') return;
  host.setAttribute('popover', 'manual');
  const raise = () => {
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch { /* not connected yet, or the page is mid-transition */ }
  };
  raise();
  let pending = false;
  const onChange = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (document.fullscreenElement || document.querySelector('dialog[open]')) raise();
    }, 300);
  };
  document.addEventListener('fullscreenchange', onChange);
  new MutationObserver(onChange).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
}

// Own key: the football copilot shares fantasy.espn.com's localStorage under 'dc-pos',
// saved from whatever monitor it was last dragged on.
const POS_KEY = 'hoops-dc-pos';

// Keep the panel's header on screen: a position saved on a wider monitor (or before the
// window shrank) would otherwise park the whole panel off the edge, invisibly.
function clampIntoView(el) {
  if (el.style.right !== 'auto') return;
  const x = parseFloat(el.style.left) || 0;
  const y = parseFloat(el.style.top) || 0;
  const cx = Math.max(0, Math.min(window.innerWidth - 240, x));
  const cy = Math.max(0, Math.min(window.innerHeight - 60, y));
  if (cx !== x || cy !== y) { el.style.left = `${cx}px`; el.style.top = `${cy}px`; }
}

function makeDraggable(el) {
  let saved = null;
  try { saved = localStorage.getItem(POS_KEY); } catch {}
  if (saved) {
    try { const { x, y } = JSON.parse(saved); el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.right = 'auto'; } catch {}
  }
  clampIntoView(el);
  window.addEventListener('resize', () => clampIntoView(el));
  let dragging = false; let ox = 0; let oy = 0;
  el.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.dc-header')) return;
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    const r = el.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - oy));
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    const r = el.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch {}
  });
}

// ESPN is a SPA: the draft room can appear after initial load.
if (isDraftRoom()) mount();
const obs = new MutationObserver(() => {
  if (!extensionAlive()) { obs.disconnect(); return; }
  if (isDraftRoom()) mount();
});
obs.observe(document.documentElement, { childList: true, subtree: true });
