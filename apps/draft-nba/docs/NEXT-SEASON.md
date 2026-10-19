# Next season checklist

1. Bump `SEASON` in `src/core/espn-constants.js`. ESPN names an NBA season by the year it ends.
2. Run `pnpm run fetch` to get fresh ESPN and FantasyPros projections.
3. Save your league's settings JSON from a signed-in browser:
   `…/leagues/<id>?view=mSettings&view=mTeam&view=mDraftDetail`
   Then run `pnpm run import:league <file>` and re-add any `house` rules from the group chat.
4. Run `pnpm run build`, eyeball `dist/cheatsheet.html`, then reload the extension.
5. Do a practice mock draft on ESPN and check the panel reads picks live.
