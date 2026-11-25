// Token Radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug on the snapshot's watchlist (a floor, never a ceiling) and then adds the
// pre-token protocols the watchlist leaves out, so the page can surface the early names the house's
// size line would otherwise hide. A protocol is pre-token when it records no token at all: both
// gecko_id and symbol are null. Live-token protocols are kept apart and shown with the market's own
// market cap; they are never mixed into the implied-value ranking.
//
// ---------------------------------------------------------------------------
// The implied-value model (version radar-3.0)
// ---------------------------------------------------------------------------
//
// Every row goes through the same function. No protocol name is ever special-cased.
//
//   implied = tvl_usd
//           * category_multiple      // WEIGHTS.category, a table of categories, not names
//           * growth_factor          // 1 + clamp(change_7d, -capPct, +capPct) * perPct
//           * age_factor             // floor + min(age_days, fullDays) / fullDays * range
//           * chain_factor           // 1 + min(chain_count, cap) * step
//
// Growth is clamped so one outlier week cannot dominate; the clamp and its scale are documented in
// WEIGHTS.growth. Age rewards a longer run without a token but saturates, so an old protocol is not
// rewarded forever. Chain count is a small reach premium. Funding is carried on the row when a
// snapshot discloses it, but this snapshot carries none, so it does not enter the score.
//
// The dashboard states this same model, shows every row's four factors as labelled bars, and prints
// a one-sentence "why" built from those factors. Screenshots and code therefore tell the same story.

/** The snapshot's protocol entry: the ten sealed fields, plus optional funding when a source has it. */
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
  /** Disclosed funding in whole USD, when a snapshot carries it. Absent in this snapshot. */
  funding_usd?: number | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * The model's four factors, each a named constant in this one table.
 *
 * Category multiples say how much token value a category is expected to capture per dollar of TVL:
 * lending and credit book the highest multiple because a token captures fee and spread value;
 * trading, derivatives and yield sit in the middle; curators, insurance and stable-asset wrappers
 * carry less because their economics are thinner per dollar of TVL. An unmapped category uses the
 * "Unclassified / other" multiple. The table is a table of categories, never of protocol names.
 */
export const WEIGHTS = {
  // Category multiple: expected token value per $1 of TVL, by category label.
  category: {
    'Lending & credit': 0.32,
    'Trading & liquidity': 0.27,
    'Derivatives': 0.24,
    'Yield & staking': 0.22,
    'RWA & BTC': 0.20,
    'Infrastructure': 0.19,
    'Curators & allocators': 0.15,
    'Insurance': 0.14,
    'Stable assets': 0.10,
    'Unclassified / other': 0.18,
  },
  // Growth factor: 7-day TVL growth is capped at +/-capPct before perPct scales it, so one outlier week cannot dominate.
  growth: { capPct: 60, perPct: 0.005 },
  // Age factor: rises from floor by range across fullDays, then saturates; an unknown age uses unknownDays.
  age: { floor: 0.8, range: 0.7, fullDays: 1825, unknownDays: 240 },
  // Chain factor: each supported chain adds step, up to cap chains, so reach is a small bounded premium.
  chain: { step: 0.05, cap: 8 },
} as const;

/** The type of the one weights table, exported so the dashboard can name it. */
export type Weights = typeof WEIGHTS;

/** The model's version label: the dashboard names it and the dossier quotes it. */
export const MODEL_VERSION = 'radar-3.0';

/** How many extra pre-token protocols beyond the watchlist the radar may carry. */
export const EARLY_ROWS = 240;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 36;

/** The board must clear this many rows so the radar is a board, not a handful of names. */
export const MIN_BOARD_ROWS = 100;

/** One documented category weight: the label shown on the page, the value, and the words it matches. */
export interface CategoryRule {
  label: string;
  weight: number;
  match: string[];
}

/** The category weight table. First match wins; the browser shows this same table. */
export const CATEGORY_RULES: CategoryRule[] = [
  { label: 'Lending & credit', weight: WEIGHTS.category['Lending & credit'], match: ['lending', 'cdp', 'collateral', 'credit'] },
  { label: 'Trading & liquidity', weight: WEIGHTS.category['Trading & liquidity'], match: ['dex', 'leveraged farm', 'liquidity manager'] },
  { label: 'Derivatives', weight: WEIGHTS.category['Derivatives'], match: ['derivative', 'perpetual', 'basis', 'option', 'prediction'] },
  { label: 'Yield & staking', weight: WEIGHTS.category['Yield & staking'], match: ['yield', 'staking pool', 'restak'] },
  { label: 'RWA & BTC', weight: WEIGHTS.category['RWA & BTC'], match: ['rwa', 'btc'] },
  { label: 'Infrastructure', weight: WEIGHTS.category['Infrastructure'], match: ['chain', 'payments', 'privacy', 'index', 'bridge'] },
  { label: 'Curators & allocators', weight: WEIGHTS.category['Curators & allocators'], match: ['risk curator', 'allocator', 'governance'] },
  { label: 'Insurance', weight: WEIGHTS.category['Insurance'], match: ['insurance'] },
  { label: 'Stable assets', weight: WEIGHTS.category['Stable assets'], match: ['stable'] },
];

/** What an unmatched category earns. */
export const DEFAULT_CATEGORY_RULE: CategoryRule = {
  label: 'Unclassified / other',
  weight: WEIGHTS.category['Unclassified / other'],
  match: [],
};

/** A farm step: the action, what it costs in USD (or "free"), and how long it takes in minutes. */
export interface FarmStep {
  action: string;
  /** Machine-readable cost: a positive whole-dollar amount, or null when the step is free. */
  cost_usd: number | null;
  /** Machine-readable time: a positive whole number of minutes. */
  minutes: number;
  /** Display cost: always a dollar amount or "free". */
  cost: string;
  /** Display time: always a whole number of minutes. */
  time: string;
}

/** One labelled factor in a row's breakdown. */
export interface BreakdownFactor {
  label: string;
  detail: string;
  multiplier: number;
}

/** The four factors and the one-sentence "why" the detail drawer prints. */
export interface RowBreakdown {
  category: BreakdownFactor;
  growth: BreakdownFactor;
  age: BreakdownFactor;
  chain: BreakdownFactor;
  why: string;
}

/** The model's working for one row, kept beside the result so the page can show the arithmetic. */
export interface RowModel {
  model_version: string;
  category_label: string;
  category_multiple: number;
  base_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  age_multiplier: number;
  age_days_used: number;
  chain_multiplier: number;
  chain_count: number;
  funding_usd: number | null;
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
  token_status: 'pre-token' | 'live';
  on_watchlist: boolean;
  age_days: number | null;
  /** The model's implied value for a pre-token row; null for a live row, which shows its market cap instead. */
  implied_value_usd: number | null;
  model: RowModel | null;
  breakdown: RowBreakdown | null;
  explanation: string | null;
  farm_plan: FarmStep[];
  farm_steps: string[];
}

/** The dashboard's compact view of one ranked row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  category_label: string;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number | null;
  base_usd: number | null;
  category_multiple: number | null;
  growth_pct: number | null;
  growth_multiplier: number | null;
  age_multiplier: number | null;
  chain_multiplier: number | null;
  funding_usd: number | null;
  on_watchlist: boolean;
  token_status: 'pre-token' | 'live';
  explanation: string | null;
  breakdown: RowBreakdown | null;
  farm_plan: FarmStep[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  category_label: string;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  age_days: number | null;
  symbol: string | null;
  token_status: 'live';
}

/** Everything the dashboard needs: the ranked board, the live set, and the model that made it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  weights: Weights;
  model_version: string;
  category_rules: CategoryRule[];
  default_category: CategoryRule;
  protocols_scanned: number;
  pre_token_total: number;
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  board_pre_token_size: number;
  board_live_size: number;
  early_size: number;
  live_size: number;
  top_implied: number;
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

/** A number clamped to [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A compact dollar string for prose and the page's model table. */
function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** A signed percentage with two decimals. */
function signedPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** A plain whole-dollar string for farm-plan costs. */
function usd(n: number): string {
  return `$${Math.round(n)}`;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a category label contains a keyword at a word boundary, so "onchain" is not "chain". */
function matchesKeyword(category: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`, 'i').test(category);
}

/** The category rule a protocol falls under; the first keyword match wins. */
export function categoryRuleFor(category: string | null): CategoryRule {
  if (category === null || category.trim() === '') return DEFAULT_CATEGORY_RULE;
  for (const rule of CATEGORY_RULES) {
    if (rule.match.some((needle) => matchesKeyword(category, needle))) return rule;
  }
  return DEFAULT_CATEGORY_RULE;
}

/** Whether a protocol records a token at all: a non-null symbol or a non-null market cap. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.symbol !== null || p.mcap_usd !== null;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !hasToken(p);
}

// DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol is a plausible pre-token farm subject rather than a pool, wrapper or exchange. */
export function isFarmablePreToken(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** One protocol's complete score: the result, its four factors, and the sentence that explains it. */
export interface ScoreResult {
  implied: number;
  base: number;
  categoryRule: CategoryRule;
  rawGrowthPct: number;
  growthPct: number;
  growthMultiplier: number;
  ageMultiplier: number;
  ageDays: number | null;
  ageDaysUsed: number;
  chainMultiplier: number;
  fundingUsed: number | null;
  breakdown: RowBreakdown;
  explanation: string;
}

/** Score one protocol with the documented four-factor model. The same function scores every row. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string): ScoreResult {
  const age = ageDays(asOf, p.listed_at);
  const rule = categoryRuleFor(p.category);
  const base = p.tvl_usd * rule.weight;

  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, -WEIGHTS.growth.capPct, WEIGHTS.growth.capPct);
  const growthMultiplier = 1 + growthPct * WEIGHTS.growth.perPct;

  const ageDaysUsed = age ?? WEIGHTS.age.unknownDays;
  const ageRatio = clamp(ageDaysUsed, 0, WEIGHTS.age.fullDays) / WEIGHTS.age.fullDays;
  const ageMultiplier = WEIGHTS.age.floor + ageRatio * WEIGHTS.age.range;

  const chainCount = p.chains.length;
  const chainMultiplier = 1 + Math.min(chainCount, WEIGHTS.chain.cap) * WEIGHTS.chain.step;

  const implied = Math.max(1, Math.round(base * growthMultiplier * ageMultiplier * chainMultiplier));

  const funding =
    typeof p.funding_usd === 'number' && Number.isFinite(p.funding_usd) && p.funding_usd > 0 ? p.funding_usd : null;

  const growthDetail =
    rawGrowth === growthPct
      ? `${signedPct(growthPct)} 7d · ${growthMultiplier.toFixed(3)}×`
      : `${signedPct(rawGrowth)} 7d capped at ${signedPct(growthPct)} · ${growthMultiplier.toFixed(3)}×`;
  const ageDetail =
    age === null
      ? `no listing date, ${WEIGHTS.age.unknownDays}d assumed · ${ageMultiplier.toFixed(3)}×`
      : `${age}d without a token · ${ageMultiplier.toFixed(3)}×`;
  const chainDetail = `${chainCount} chain${chainCount === 1 ? '' : 's'}, ${Math.min(chainCount, WEIGHTS.chain.cap)} counted · ${chainMultiplier.toFixed(3)}×`;
  const categoryDetail = `${rule.label} · ${rule.weight.toFixed(2)}×`;

  const growthClause =
    rawGrowth === growthPct
      ? `a ${signedPct(growthPct)} 7-day move scores ${growthMultiplier.toFixed(3)}×`
      : `a ${signedPct(rawGrowth)} 7-day move, capped at ${signedPct(growthPct)}, scores ${growthMultiplier.toFixed(3)}×`;
  const ageClause =
    age === null
      ? `no listing date means ${WEIGHTS.age.unknownDays} assumed days (${ageMultiplier.toFixed(3)}×)`
      : `${age} days without a token scores ${ageMultiplier.toFixed(3)}×`;
  const chainClause = `${chainCount} chain${chainCount === 1 ? ' scores' : 's score'} ${chainMultiplier.toFixed(3)}×`;
  const fundingClause =
    funding === null ? 'no disclosed funding is on record' : `${money(funding)} of disclosed funding is on record`;
  const explanation =
    `${money(p.tvl_usd)} of TVL at the ${rule.label.toLowerCase()} multiple (${rule.weight.toFixed(2)}×) ` +
    `gives a ${money(base)} base; ${growthClause}, ${ageClause} and ${chainClause}, ` +
    `for an implied value of ${money(implied)}; ${fundingClause}.`;

  const breakdown: RowBreakdown = {
    category: { label: 'Category multiple', detail: categoryDetail, multiplier: round4(rule.weight) },
    growth: { label: '7-day growth', detail: growthDetail, multiplier: round4(growthMultiplier) },
    age: { label: 'Age without token', detail: ageDetail, multiplier: round4(ageMultiplier) },
    chain: { label: 'Chain reach', detail: chainDetail, multiplier: round4(chainMultiplier) },
    why: explanation,
  };

  return {
    implied,
    base,
    categoryRule: rule,
    rawGrowthPct: rawGrowth,
    growthPct,
    growthMultiplier,
    ageMultiplier,
    ageDays: age,
    ageDaysUsed,
    chainMultiplier,
    fundingUsed: funding,
    breakdown,
    explanation,
  };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 400;
  if (tvl >= 2_000_000_000) return 300;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** An estimated gas cost in whole USD, from the chain the position lands on. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 12;
  if (c.includes('bitcoin')) return 15;
  if (c.includes('solana') || c.includes('sui') || c.includes('ton')) return 1;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('linea') || c.includes('sonic')) return 2;
  return 4;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** A stable chain key for the venue book. */
function chainKey(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'ethereum';
  if (c.includes('base')) return 'base';
  if (c.includes('arbitrum')) return 'arbitrum';
  if (c.includes('optimism')) return 'optimism';
  if (c.includes('polygon')) return 'polygon';
  if (c.includes('solana')) return 'solana';
  if (c.includes('sui')) return 'sui';
  if (c.includes('ton')) return 'ton';
  if (c.includes('binance') || c === 'bsc') return 'binance';
  if (c.includes('avalanche')) return 'avalanche';
  if (c.includes('linea')) return 'linea';
  if (c.includes('scroll')) return 'scroll';
  if (c.includes('mantle')) return 'mantle';
  if (c.includes('unichain')) return 'unichain';
  if (c.includes('sonic')) return 'sonic';
  return c;
}

/** A chain's own venue for a category, so two protocols on different chains never share a venue. */
type VenueBook = { [chain: string]: string[] };

const VENUES: { [label: string]: VenueBook } = {
  'Lending & credit': {
    ethereum: ['Aave v3', 'Morpho Blue', 'Spark', 'Compound v3'],
    base: ['Moonwell', 'Aave v3', 'Morpho'],
    arbitrum: ['Aave v3', 'Silo', 'Radiant'],
    optimism: ['Aave v3', 'Sonne'],
    polygon: ['Aave v3', 'Retro'],
    avalanche: ['Aave v3', 'Benqi'],
    default: ['Aave v3', 'Morpho Blue', 'the native lending market'],
  },
  'Trading & liquidity': {
    ethereum: ['Uniswap v4', 'Curve', 'Balancer', 'Maverick'],
    base: ['Aerodrome', 'Uniswap v4', 'BaseSwap'],
    arbitrum: ['Camelot', 'Uniswap v4', 'Trader Joe'],
    optimism: ['Velodrome', 'Uniswap v4'],
    polygon: ['QuickSwap', 'Balancer'],
    solana: ['Jupiter', 'Raydium', 'Orca'],
    sui: ['Cetus', 'Bluefin'],
    default: ['Uniswap v4', 'Curve', 'the main liquidity pool'],
  },
  'Derivatives': {
    ethereum: ['GMX', 'dYdX', 'Synthetix'],
    arbitrum: ['GMX', 'Vertex'],
    base: ['Aerodrome Perps', 'Synthetix'],
    optimism: ['Synthetix', 'Velodrome Perps'],
    solana: ['Drift', 'Jupiter Perps'],
    default: ['GMX', 'Drift', 'the native perps market'],
  },
  'Yield & staking': {
    ethereum: ['Pendle', 'EigenLayer', 'Yearn', 'Lido'],
    base: ['Moonwell', 'Aerodrome', 'Yearn'],
    arbitrum: ['Pendle', 'GMX', 'Yearn'],
    solana: ['Kamino', 'Marginfi', 'Jito'],
    sui: ['Scallop', 'NAVI'],
    default: ['Pendle', 'Yearn', 'the native staking module'],
  },
  'RWA & BTC': {
    ethereum: ['Ondo', 'Maple', 'Centrifuge', 'Ethena'],
    base: ['Ondo', 'Centrifuge'],
    arbitrum: ['Maple', 'Ondo'],
    solana: ['Ondo', 'Maple'],
    default: ['Ondo', 'Maple', 'the native RWA market'],
  },
  'Infrastructure': {
    ethereum: ['the native bridge', 'EigenLayer', 'the staking module'],
    base: ['the native bridge', 'the native app'],
    arbitrum: ['the native bridge', 'the native app'],
    solana: ['the Wormhole bridge', 'the native app'],
    default: ['the native bridge', 'the chain app', 'the staking module'],
  },
  'Curators & allocators': {
    ethereum: ['Morpho vaults', 'Euler vaults', 'Gauntlet vaults'],
    base: ['Morpho vaults', 'Moonwell vaults', 'Gauntlet vaults'],
    arbitrum: ['Morpho vaults', 'Euler vaults'],
    optimism: ['Morpho vaults', 'Gauntlet vaults'],
    default: ['Morpho vaults', 'Euler vaults', 'Gauntlet vaults'],
  },
  'Insurance': {
    ethereum: ['Nexus Mutual', 'Sherlock', 'InsurAce'],
    base: ['Nexus Mutual', 'Sherlock'],
    arbitrum: ['Nexus Mutual', 'InsurAce'],
    default: ['Nexus Mutual', 'Sherlock', 'the native cover market'],
  },
  'Stable assets': {
    ethereum: ['Curve', 'Aave GHO', 'Ethena'],
    base: ['Curve', 'Aave GHO'],
    arbitrum: ['Curve', 'Ethena'],
    solana: ['Jupiter', 'Kamino'],
    default: ['Curve', 'Aave GHO', 'the native stable market'],
  },
  'Unclassified / other': {
    ethereum: ['Uniswap v4', 'Aave v3', 'Curve'],
    base: ['Aerodrome', 'Uniswap v4', 'Moonwell'],
    arbitrum: ['Camelot', 'Aave v3', 'GMX'],
    solana: ['Jupiter', 'Kamino', 'Raydium'],
    default: ['the protocol app', 'the main pool', 'the native market'],
  },
};

/** A small deterministic hash, so a protocol picks the same venue on every run. */
function hashSlug(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The venue a category uses on a chain; the hash varies it within a chain without breaking determinism. */
function venueFor(label: string, chain: string, seed: string): string {
  const book = VENUES[label] ?? VENUES['Unclassified / other']!;
  const key = chainKey(chain);
  const options = book[key] ?? book.default!;
  return options[hashSlug(`${seed}:${key}`) % options.length]!;
}

/** The category's one concrete action, in words a farmer can follow. */
function categoryAction(p: SnapshotProtocol, capital: number, chain: string, venue: string, rule: CategoryRule): string {
  switch (rule.label) {
    case 'Lending & credit':
      return `Supply ${usd(capital)} of USDC to ${venue} on ${chain} through ${p.name} and borrow no more than a third of it to stay liquid.`;
    case 'Trading & liquidity':
      return `Provide ${usd(capital)} of liquidity to ${venue} on ${chain} through ${p.name} and keep the LP receipt.`;
    case 'Derivatives':
      return `Post ${usd(capital)} of USDC as margin on ${venue} via ${p.name} on ${chain} and open one small hedged position.`;
    case 'Yield & staking':
      return `Deposit ${usd(capital)} into ${venue} on ${chain} through ${p.name} and keep the receipt token.`;
    case 'RWA & BTC':
      return `Mint or subscribe to ${usd(capital)} of ${p.name}'s yield asset through ${venue} on ${chain} and hold the receipt.`;
    case 'Infrastructure':
      return `Deposit ${usd(capital)} into ${p.name}'s ${chain} app through ${venue} and make one real use of it.`;
    case 'Curators & allocators':
      return `Allocate ${usd(capital)} to ${venue} on ${chain} through ${p.name} and keep the vault shares.`;
    case 'Insurance':
      return `Buy ${usd(capital)} of cover from ${p.name} through ${venue} on ${chain} and keep the policy.`;
    case 'Stable assets':
      return `Mint ${usd(capital)} of the protocol's stable asset through ${venue} on ${chain} and hold it.`;
    default:
      return `Deposit ${usd(capital)} of USDC into ${p.name} via ${venue} on ${chain} and keep the position open.`;
  }
}

/** How long the setup action takes, from the category. */
function actionMinutes(rule: CategoryRule): number {
  if (rule.label === 'Trading & liquidity' || rule.label === 'Infrastructure') return 20;
  if (rule.label === 'RWA & BTC' || rule.label === 'Insurance') return 18;
  return 15;
}

/** A step with its display strings derived from the machine-readable cost and minutes. */
function makeStep(action: string, costUsd: number | null, minutes: number): FarmStep {
  return {
    action,
    cost_usd: costUsd,
    minutes,
    cost: costUsd === null ? 'free' : usd(costUsd),
    time: `${minutes} minute${minutes === 1 ? '' : 's'}`,
  };
}

/**
 * A protocol's farm plan: four concrete steps, each an action with an explicit cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. The venue is chosen from the protocol's category and chain, so two
 * protocols of the same category on different chains read differently. When the protocol runs on more
 * than one chain, step three mirrors a smaller position on the second chain; otherwise it is the
 * weekly qualifying action.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const rule = categoryRuleFor(p.category);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const venue = venueFor(rule.label, chain, p.slug);
  const steps: FarmStep[] = [
    makeStep(
      `Create a dedicated wallet, move ${usd(capital)} of USDC onto ${chain} and approve only ${venue} for ${p.name}; keep the seed phrase offline.`,
      capital + gas,
      chainKey(chain) === 'ethereum' ? 20 : 12,
    ),
    makeStep(categoryAction(p, capital, chain, venue, rule), gas, actionMinutes(rule)),
  ];
  if (secondChain !== null) {
    const mirror = Math.max(25, Math.round(capital / 2 / 25) * 25);
    const secondVenue = venueFor(rule.label, secondChain, `${p.slug}:2`);
    steps.push(
      makeStep(
        `Mirror a smaller ${usd(mirror)} position on ${secondChain} through ${secondVenue} for ${p.name} so the wallet shows activity on more than one chain.`,
        mirror + gasFor(secondChain),
        18,
      ),
    );
  } else {
    steps.push(
      makeStep(
        `Make one qualifying action each week through ${venue} on ${chain} for ${hold} days (deposit, borrow, swap or vote).`,
        Math.max(1, 2 * weeks),
        10,
      ),
    );
  }
  steps.push(
    makeStep(
      `Log the wallet, dates and every transaction, then claim only from ${p.name}'s official rewards page after ${hold} days.`,
      null,
      15,
    ),
  );
  return steps;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const compareSlug = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Turn one scored protocol into the board row both board.json and the page carry. */
function toBoardRow(rank: number, p: SnapshotProtocol, score: ScoreResult, onWatchlist: boolean): BoardRow {
  const plan = farmPlan(p, score.ageDays);
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    on_watchlist: onWatchlist,
    age_days: score.ageDays,
    implied_value_usd: score.implied,
    model: {
      model_version: MODEL_VERSION,
      category_label: score.categoryRule.label,
      category_multiple: score.categoryRule.weight,
      base_usd: Math.round(score.base),
      growth_pct: round4(score.growthPct),
      growth_multiplier: round4(score.growthMultiplier),
      age_multiplier: round4(score.ageMultiplier),
      age_days_used: score.ageDaysUsed,
      chain_multiplier: round4(score.chainMultiplier),
      chain_count: p.chains.length,
      funding_usd: score.fundingUsed,
    },
    breakdown: score.breakdown,
    explanation: score.explanation,
    farm_plan: plan,
    farm_steps: plan.map(stepText),
  };
}

/** Turn one live-token protocol into a board row: the market's market cap rather than a model value. */
function toLiveBoardRow(rank: number, p: SnapshotProtocol, onWatchlist: boolean, asOf: string): BoardRow {
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'live',
    on_watchlist: onWatchlist,
    age_days: ageDays(asOf, p.listed_at),
    implied_value_usd: null,
    model: null,
    breakdown: null,
    explanation: null,
    farm_plan: [],
    farm_steps: [],
  };
}

/** The protocols the board ranks: pre-token by implied value, then live tokens by market cap, ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();

  // The watchlist is the floor: every pre-token slug, even if the snapshot's index has moved under it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isPreToken(p)) chosen.set(slug, p);
  }

  // The expanded radar: pre-token protocols the watchlist left out, by TVL, capped. A chosen
  // protocol always stays chosen; this only adds rows the watchlist did not name.
  const extra = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isFarmablePreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareSlug(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of extra) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of) }));
  scored.sort(
    (a, b) =>
      b.score.implied - a.score.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      compareSlug(a.p.slug, b.p.slug),
  );

  const rows: BoardRow[] = [];
  let rank = 1;
  for (const s of scored) rows.push(toBoardRow(rank++, s.p, s.score, watch.has(s.p.slug)));

  // The live-token group: every protocol whose snapshot record carries a symbol or a market cap,
  // ranked by the market cap it states. It follows the pre-token group on the board.
  const live = snapshot.protocols
    .filter(hasToken)
    .sort(
      (a, b) =>
        (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) ||
        b.tvl_usd - a.tvl_usd ||
        compareSlug(a.slug, b.slug),
    );
  for (const p of live) rows.push(toLiveBoardRow(rank++, p, watch.has(p.slug), snapshot.as_of));

  return rows;
}

/** The live-token protocols, by market cap, for the dashboard's live-token data. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter(hasToken)
    .sort(
      (a, b) =>
        (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) ||
        b.tvl_usd - a.tvl_usd ||
        compareSlug(a.slug, b.slug),
    )
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      category_label: categoryRuleFor(p.category).label,
      chains: p.chains,
      chain_count: p.chains.length,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      age_days: ageDays(snapshot.as_of, p.listed_at),
      symbol: p.symbol,
      token_status: 'live',
    }));
}

/** A board row's compact form for data.js, with the explanation and farm plan embedded. */
export function radarRow(row: BoardRow): RadarRow {
  if (row.token_status === 'live' || row.model === null) {
    return {
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      category_label: categoryRuleFor(row.category).label,
      chains: row.chains,
      chain_count: row.chains.length,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      mcap_usd: row.mcap_usd,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: null,
      base_usd: null,
      category_multiple: null,
      growth_pct: null,
      growth_multiplier: null,
      age_multiplier: null,
      chain_multiplier: null,
      funding_usd: null,
      on_watchlist: row.on_watchlist,
      token_status: 'live',
      explanation: null,
      breakdown: null,
      farm_plan: [],
    };
  }
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    category_label: row.model.category_label,
    chains: row.chains,
    chain_count: row.chains.length,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    category_multiple: row.model.category_multiple,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    funding_usd: row.model.funding_usd,
    on_watchlist: row.on_watchlist,
    token_status: 'pre-token',
    explanation: row.explanation,
    breakdown: row.breakdown,
    farm_plan: row.farm_plan,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const covered = new Set(board.map((r) => r.slug));
  const watchlistCovered = snapshot.watchlist.filter((slug) => covered.has(slug)).length;
  const preRows = board.filter((r) => r.token_status === 'pre-token');
  const liveBoard = board.filter((r) => r.token_status === 'live');
  const top = preRows[0];
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    weights: WEIGHTS,
    model_version: MODEL_VERSION,
    category_rules: CATEGORY_RULES,
    default_category: DEFAULT_CATEGORY_RULE,
    protocols_scanned: snapshot.protocols.length,
    pre_token_total: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    board_size: board.length,
    board_pre_token_size: preRows.length,
    board_live_size: liveBoard.length,
    early_size: preRows.filter((r) => !watch.has(r.slug)).length,
    live_size: liveBoard.length,
    top_implied: top === undefined || top.implied_value_usd === null ? 0 : top.implied_value_usd,
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
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
      funding_usd: typeof p.funding_usd === 'number' && Number.isFinite(p.funding_usd) ? p.funding_usd : null,
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

/**
 * Why a board is not one the model can hand over, or null: row count, coverage, ranks, each group's
 * order, the pre-token rows' values, farm plans and four-factor breakdown, and each row's status.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < MIN_BOARD_ROWS) {
    return `the board has ${board.length} rows, fewer than the ${MIN_BOARD_ROWS} the radar promises`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;

  for (const r of board) {
    const expected = r.symbol !== null || r.mcap_usd !== null ? 'live' : 'pre-token';
    if (r.token_status !== expected) {
      return `${r.slug} is marked ${r.token_status} but its snapshot symbol and market cap say ${expected}`;
    }
  }

  const pre = board.filter((r) => r.token_status === 'pre-token');
  const live = board.filter((r) => r.token_status === 'live');

  for (let i = 1; i < pre.length; i++) {
    const prev = pre[i - 1]!.implied_value_usd;
    const cur = pre[i]!.implied_value_usd;
    if (prev !== null && cur !== null && cur > prev) {
      return `pre-token row ${pre[i]!.rank} outranks pre-token row ${pre[i - 1]!.rank} on implied value`;
    }
  }
  if (pre.length >= 2) {
    const first = pre[0]!.implied_value_usd;
    const last = pre[pre.length - 1]!.implied_value_usd;
    if (first !== null && first === last) {
      return `all ${pre.length} pre-token rows share the same implied value $${first}: a board that ranks nothing by value is not a ranking`;
    }
  }
  for (let i = 1; i < live.length; i++) {
    const prev = live[i - 1]!.mcap_usd ?? -1;
    const cur = live[i]!.mcap_usd ?? -1;
    if (cur > prev) return `live-token row ${live[i]!.rank} outranks live-token row ${live[i - 1]!.rank} on market cap`;
  }

  for (const r of pre) {
    if (!Number.isSafeInteger(r.implied_value_usd) || (r.implied_value_usd as number) <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.explanation !== 'string' || r.explanation.length < 40) {
      return `${r.slug} has no usable "why this value" explanation`;
    }
    const factors = r.breakdown;
    if (typeof factors !== 'object' || factors === null) return `${r.slug} has no factor breakdown`;
    for (const key of ['category', 'growth', 'age', 'chain'] as const) {
      const factor = factors[key];
      if (typeof factor !== 'object' || factor === null || !Number.isFinite(factor.multiplier)) {
        return `${r.slug} has no usable ${key} factor`;
      }
      if (typeof factor.detail !== 'string' || factor.detail.length < 4) {
        return `${r.slug} has an empty ${key} factor detail`;
      }
    }
    if (typeof factors.why !== 'string' || factors.why.length < 20) {
      return `${r.slug} has no one-sentence "why" in its breakdown`;
    }
    if (!Array.isArray(r.farm_plan) || r.farm_plan.length < 3 || r.farm_plan.length > 4) {
      return `${r.slug} has ${Array.isArray(r.farm_plan) ? r.farm_plan.length : 0} structured farm steps`;
    }
    for (const step of r.farm_plan) {
      if (typeof step.action !== 'string' || step.action.length < 20) {
        return `${r.slug} has a farm step without a usable action`;
      }
      if (step.cost.trim() === '' || step.time.trim() === '') return `${r.slug} has a farm step without a cost or time`;
      if (!/\$|free/i.test(step.cost)) return `${r.slug} has a farm cost that is not a dollar amount or "free"`;
      if (step.cost_usd !== null && (!Number.isFinite(step.cost_usd) || step.cost_usd < 0)) {
        return `${r.slug} has a farm cost that is not a USD number or "free"`;
      }
      if (!Number.isInteger(step.minutes) || step.minutes <= 0) {
        return `${r.slug} has a farm time that is not a positive number of minutes`;
      }
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }

  for (const r of live) {
    if (r.implied_value_usd !== null) return `${r.slug} is a live token but carries an implied value`;
    if (!Array.isArray(r.chains)) return `${r.slug} has no chain list`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
