// Sakura Radar's model: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and adds the pre-token protocols below that floor with the most
// TVL: the early rows a launch radar exists to surface. A protocol counts as
// pre-token when its record carries no token at all (no market cap, no
// CoinGecko id, no symbol). Protocols whose token already trades are kept
// apart and shown at the market's own value, never mixed into the ranking.
//
// Implied value is built only from figures the snapshot itself carries:
//
//   implied = round( tvl_usd
//                    x categoryMultiple   (what one TVL dollar tends to be
//                                          worth in this category)
//                    x momentumMult       (from change_7d, clamped)
//                    x maturityMult       (log of the days since listed_at:
//                                          seasons run with no token)
//                    x breadthMult )      (one bonus step per extra chain,
//                                          capped)
//
// No protocol name is ever special-cased: one function scores every row, and
// the dashboard recomputes the same number from the same figures so a reader
// can check the board against the page.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so the arithmetic is public. */
export interface ModelConstants {
  default_multiple: number;
  lending_multiple: number;
  exchange_multiple: number;
  yield_multiple: number;
  bridge_multiple: number;
  staking_multiple: number;
  rwa_multiple: number;
  curator_multiple: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  default_multiple: 0.25,
  lending_multiple: 0.34,
  exchange_multiple: 0.3,
  yield_multiple: 0.24,
  bridge_multiple: 0.2,
  staking_multiple: 0.26,
  rwa_multiple: 0.28,
  curator_multiple: 0.27,
  momentum_weight: 0.8,
  momentum_floor: -45,
  momentum_cap: 75,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 2190,
  unknown_age_days: 540,
  breadth_step: 0.04,
  breadth_max_chains: 6,
};

/** The model's version label: the dashboard names it and the board carries it. */
export const MODEL_VERSION = 'sakura-radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 180;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    momentum_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * What one dollar of TVL tends to be worth as a token in this category.
 * Lending books carry the richest fee base per TVL dollar; bridges the
 * thinnest, because most bridged value is pass-through custody.
 */
export function categoryMultiple(category: string | null, model: ModelConstants): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return model.lending_multiple;
  if (c.includes('dex') || c.includes('derivat') || c.includes('perpetual')) return model.exchange_multiple;
  if (c.includes('bridge')) return model.bridge_multiple;
  if (c.includes('staking') || c.includes('restak') || c.includes('staking pool')) return model.staking_multiple;
  if (c.includes('rwa')) return model.rwa_multiple;
  if (c.includes('curator') || c.includes('allocator')) return model.curator_multiple;
  if (c.includes('yield') || c.includes('farm')) return model.yield_multiple;
  return model.default_multiple;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; momentumPct: number; catMult: number; momentumMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const catMult = categoryMultiple(protocol.category, model);
  const rawMomentum = finite(protocol.change_7d, 0);
  const momentumPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawMomentum));
  const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const maturityMult =
    model.maturity_floor + (Math.log1p(cappedAge) / Math.log1p(model.maturity_days)) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length, 1), model.breadth_max_chains) - 1;
  const breadthMult = 1 + extraChains * model.breadth_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * momentumMult * maturityMult * breadthMult));
  return { implied, momentumPct, catMult, momentumMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is in, whatever the model thinks of it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.catMult,
      momentum_pct: s.momentumPct,
      momentum_multiplier: round4(s.momentumMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A realistic gas figure for one transaction on the protocol's first chain. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 14;
  if (c.includes('bitcoin')) return 6;
  if (c.includes('solana')) return 1;
  if (c.includes('binance') || c.includes('bsc')) return 2;
  if (c.includes('polygon')) return 1;
  return 3;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's opening action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow about 40% against it so both sides of the book record your wallet.`;
  if (c.includes('dex'))
    return `Swap about $${Math.round(capital / 4)} through ${name}'s main pair on ${chain}, then provide the remaining $${capital - Math.round(capital / 4)} as two-sided liquidity in that same pool.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then put the bridged funds to work in one app on the far side instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} worth of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivat'))
    return `Deposit $${capital} of USDC as margin on ${name}, open one small position of about $${Math.round(capital / 5)} notional, and close it after a day so volume and an open-interest snapshot both count.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into the largest ${name} vault on ${chain} and keep the vault shares untouched in the farming wallet.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} with USDC and hold the minted asset in the farming wallet.`;
  if (c.includes('yield'))
    return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and leave auto-compounding switched on.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its main app and keep the position open.`;
}

/** The category's second action: the step that separates a farmer from a one-click visitor. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp'))
    return `Repay half the borrow after 7 days and borrow again, so ${name} records two separate borrow cycles from your wallet.`;
  if (c.includes('dex'))
    return `Claim any fees ${name} shows after the first week and add them back to the pool instead of withdrawing them.`;
  if (c.includes('bridge'))
    return `Make one return bridge of about $${Math.round(capital / 4)} after at least 14 days, so ${name} sees a round trip rather than a single hop.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Restake or re-delegate about $${Math.round(capital / 3)} of the position once after 30 days, keeping the rest untouched.`;
  if (c.includes('perpetual') || c.includes('derivat'))
    return `Trade one more small position in a second week and leave a resting limit order overnight once, so ${name} records both active and passive flow from your wallet.`;
  if (c.includes('rwa'))
    return `Redeem about $${Math.round(capital / 5)} of the minted asset after 30 days and mint it back a week later, so ${name} records a full mint-redeem-mint cycle.`;
  return `Repeat the opening action once with about $${Math.round(capital / 4)} more capital after 14 days, so ${name} records a returning wallet, not a single visit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Create a fresh wallet for ${p.name} alone, back its seed phrase up offline, and fund it with the farming capital plus gas on ${chain}.`,
      cost: `about $${gas} of gas to fund and make the first transaction`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas * 2} of gas for the two transactions`,
      time: '20 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${gas} of gas, with the capital already in the position`,
      time: '15 minutes, on day 7 to 14',
    },
    {
      text: `Make one small qualifying action every week (a deposit top-up, a swap, a claim-and-restake or a governance vote) so no weekly snapshot misses the wallet.`,
      cost: `about $${gas} of gas a week, roughly $${gas * 4} a month`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days: protocols this age usually weight duration and repeated snapshots, and an early exit wastes the gas already spent.`,
      cost: `the $${capital} stays locked in the position for the whole window`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points, rewards or governance page once a week and claim only through links that page publishes; never pay a third party to claim for you.`,
      cost: 'nothing to check, and never pay a claim fee to anyone',
      time: '10 minutes a week',
    },
    {
      text: `Keep a farm log with the wallet address, every transaction hash and the dates, then unwind in reverse order (withdraw, repay, unbridge) once a token or a snapshot date is announced.`,
      cost: `about $${gas * 2} of gas to unwind fully`,
      time: '15 minutes to log, 20 minutes to exit',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
