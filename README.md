# token-radar-lucy

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hellolucyheart/token-radar-lucy/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hellolucyheart/token-radar-lucy/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Sakura Radar: a token launch radar that ranks pre-token protocols by an
implied value built only from the snapshot's own figures — TVL, seven-day
momentum, log-scaled seasons without a token, chain breadth, and a
category multiple — and gives every protocol a concrete seven-step farm
plan with costs and times. The dashboard is a dark sakura-themed static
page with search, category and chain filters, sortable columns, a
per-protocol detail view that recomputes the model in the browser, and a
live-token view set apart from the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18 or later, standard library only. The run writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output
directory.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
