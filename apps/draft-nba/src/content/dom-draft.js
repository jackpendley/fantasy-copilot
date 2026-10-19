// Reads the live draft straight off ESPN's draft room page. ESPN's league API returns
// every pick slot as playerId -1 until the draft is over (seen in a practice draft), so the
// page is the only live source. Parsing is split into pure text functions (tested) and a
// thin DOM walk that feeds them; all of it is best-effort and fails quiet.

const PICK_RE = /\bR(\d{1,2}),\s*P(\d{1,2})\b/;
const CLOCK_RE = /pick\s*(\d{1,3})/i;

/** "ON THE CLOCK: PICK 40" (any case, any spacing) -> 40. */
export function parseClock(text) {
  if (!text || !/on the clock/i.test(text)) return null;
  const m = text.match(CLOCK_RE);
  return m ? Number(m[1]) : null;
}

/**
 * One pick card's text, e.g. "Pascal Siakam / IND PF\nR2, P10 - Team Ten Long Name Bu...",
 * -> { round, roundPick, name }. Null if it isn't a pick card.
 */
export function parsePickCard(text) {
  if (!text) return null;
  const m = text.match(PICK_RE);
  if (!m) return null;
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.includes(' / '));
  if (!line) return null;
  const name = line.split(' / ')[0].trim();
  if (!name) return null;
  return { round: Number(m[1]), roundPick: Number(m[2]), name };
}

/** Overall pick number in a snake draft from round + pick-within-round as ESPN labels it. */
export const overallOf = (round, roundPick, teams) => (round - 1) * teams + roundPick;

/** Walk the page: the on-the-clock number and every pick card currently rendered. */
export function readDraftRoom(doc = document) {
  let onClock = null;
  const cards = new Map(); // "round:pick" -> parsed card
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    if (!t || t.length > 200) continue;
    if (onClock == null && /on the clock/i.test(t)) {
      // The number may sit in a sibling element; read the nearest few ancestors' text.
      let el = n.parentElement;
      for (let i = 0; el && i < 3 && onClock == null; i++, el = el.parentElement) onClock = parseClock(el.textContent);
    }
    if (PICK_RE.test(t)) {
      let el = n.parentElement;
      for (let i = 0; el && i < 5; i++, el = el.parentElement) {
        const card = parsePickCard(el.innerText);
        if (card) { cards.set(`${card.round}:${card.roundPick}`, card); break; }
      }
    }
  }
  return { onClock, cards: [...cards.values()] };
}

/** Poll the page and broadcast what it says; the Panel (same content-script world) listens. */
export function startDraftRoomReader(intervalMs = 1000) {
  let last = '';
  const tick = () => {
    try {
      const r = readDraftRoom();
      const key = `${r.onClock}|${r.cards.length}|${r.cards.map((c) => c.name).join(',')}`;
      if (key === last) return;
      last = key;
      window.dispatchEvent(new CustomEvent('hoops-draft-room', { detail: r }));
    } catch { /* never break the draft room */ }
  };
  tick();
  return setInterval(tick, intervalMs);
}
