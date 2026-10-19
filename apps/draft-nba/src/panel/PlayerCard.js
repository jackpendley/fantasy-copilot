import { h } from 'preact';
import { TAG_COLOR, TAG_LABEL, one } from './format.js';

const Row = ({ label, children }) =>
  h('div', { class: 'dc-cardrow' }, h('span', { class: 'dc-cardlabel' }, label), h('span', null, children));

const pct3 = (v) => (v == null ? '--' : v.toFixed(3).replace(/^0/, ''));
const zColor = (z) => (z >= 1 ? '#1f9d4d' : z <= -1 ? '#c62828' : undefined);

export function PlayerCard({ row, dataset, onClose }) {
  if (!row) return null;
  const m = row.model || {};
  const pj = m.proj || {};
  const points = dataset.rules?.scoring?.type === 'points';

  return h('div', { class: 'dc-card' },
    h('div', { class: 'dc-cardhead' },
      h('div', null,
        h('div', { class: 'dc-cardname' }, row.name),
        h('div', { class: 'dc-cardsub' },
          `${row.eligible.join('/')} · ${row.team}`,
          m.rank ? ` · Model #${m.rank}` : '',
          m.posRank ? ` · ${row.pos}${m.posRank}` : '',
          m.tier ? ` · Tier ${m.tier}` : '',
        ),
      ),
      row.tag !== 'neutral' && h('span', { class: 'dc-tag', style: { background: TAG_COLOR[row.tag] } }, TAG_LABEL[row.tag]),
      h('button', { class: 'dc-card-close', onClick: onClose, title: 'Close' }, '×'),
    ),

    h('div', { class: 'dc-cardbody' },
      h(Row, { label: 'Market' },
        `ESPN ADP ${one(row.adp)}`,
        row.adjAdp != null && row.adjAdp !== row.adp ? ` → keeper-adj ${one(row.adjAdp)}` : '',
        row.availNext != null ? ` · ${Math.round(row.availNext * 100)}% to reach your next pick` : '',
        row.espn?.auctionValue ? ` · ESPN $${Math.round(row.espn.auctionValue)}` : '',
        m.dollars != null ? ` · model $${m.dollars}` : '',
      ),

      h(Row, { label: 'Value' },
        `${one(m.value)} over replacement`,
        points && m.fppg != null ? ` · ${one(m.fppg)} FP/G · ${Math.round(m.raw)} season FP` : '',
        !points ? ` · ${one(m.raw)} total z` : '',
      ),

      h(Row, { label: 'Projection' },
        `${one(pj.GP)} GP · ${one(pj.MIN)} min · ${one(pj.PTS)} pts · ${one(pj.REB)} reb · ${one(pj.AST)} ast · `
        + `${one(pj.STL)} stl · ${one(pj.BLK)} blk · ${one(pj['3PM'])} 3pm · ${one(pj.TO)} to · `
        + `${pct3(pj['FG%'])} FG (${one(pj.FGA)} att) · ${pct3(pj['FT%'])} FT (${one(pj.FTA)} att)`,
      ),

      !points && m.z && h(Row, { label: 'Category z' },
        Object.entries(m.z).map(([c, z], i) => h('span', { key: c, style: { color: zColor(z) } }, `${i ? ' · ' : ''}${c} ${z > 0 ? '+' : ''}${z.toFixed(1)}`)),
      ),

      h(Row, { label: 'Source' }, m.sources === 'ESPN+FP' ? 'ESPN + FantasyPros blend' : 'ESPN projection only'),

      (m.notes || []).length > 0 && h(Row, { label: 'House rules' }, m.notes.join(' · ')),

      row.injuryStatus && row.injuryStatus !== 'ACTIVE'
        && h(Row, { label: 'Injury' }, h('strong', { style: { color: '#c62828' } }, row.injuryStatus.replace(/_/g, ' '))),

      row.espn?.seasonOutlook && h('div', { class: 'dc-profile' }, h('p', null, row.espn.seasonOutlook)),
    ),
  );
}
