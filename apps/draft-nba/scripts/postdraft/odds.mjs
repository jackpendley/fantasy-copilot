// Season Monte Carlo from per-team weekly mean/sd: 19 regular weeks vs random opponents
// (round-robin rotation), top 6 by record (points tiebreak), seeds 1-2 bye, 3 playoff weeks.
import { readFileSync } from 'node:fs';
const sim = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = sim.teams; const n = T.length;
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
let shock = new Array(n).fill(1);
const score = (i) => T[i].weeklyMean * shock[i] + T[i].weeklySd * g();
const R = 20000; const po = new Array(n).fill(0); const champ = new Array(n).fill(0); const wins = new Array(n).fill(0); const seed1 = new Array(n).fill(0);
for (let r = 0; r < R; r++) {
  shock = T.map(() => 1 + 0.06 * g());
  const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
  const w = new Array(n).fill(0); const pf = new Array(n).fill(0);
  for (let wk = 0; wk < 19; wk++) {
    // circle-method round robin
    const rot = [order[0], ...order.slice(1).map((_, k) => order[1 + ((k + wk) % (n - 1))])];
    for (let k = 0; k < n / 2; k++) {
      const a = rot[k], b = rot[n - 1 - k]; const sa = score(a), sb = score(b);
      pf[a] += sa; pf[b] += sb; if (sa > sb) w[a]++; else w[b]++;
    }
  }
  const seeds = [...Array(n).keys()].sort((a, b) => w[b] - w[a] || pf[b] - pf[a]).slice(0, 6);
  seeds.forEach((t) => po[t]++); seed1[seeds[0]]++;
  w.forEach((x, i) => { wins[i] += x; });
  const m = (a, b) => (score(a) > score(b) ? a : b);
  const q1 = m(seeds[2], seeds[5]); const q2 = m(seeds[3], seeds[4]);
  const s1 = m(seeds[0], q2); const s2 = m(seeds[1], q1);
  champ[m(s1, s2)]++;
}
T.forEach((t, i) => console.log(`${t.name.padEnd(28)} W-L ${(wins[i] / R).toFixed(1)}-${(19 - wins[i] / R).toFixed(1)}  playoffs ${(po[i] / R * 100).toFixed(0)}%  #1 seed ${(seed1[i] / R * 100).toFixed(0)}%  title ${(champ[i] / R * 100).toFixed(0)}%`));
