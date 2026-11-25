// Token Radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug on the snapshot's watchlist (a floor, never a ceiling) and then adds the
// pre-token protocols the watchlist leaves out, so the page can surface the early names the house's
// size line would otherwise hide. A protocol is pre-token when it records no token at all: both
// gecko_id and symbol are null. Live-token protocols are kept apart and shown with the market's own
// market cap; they are never mixed into the implied-value ranking.
//
// ---------------------------------------------------------------------------
// The implied-value model (version radar-2.1)
// ---------------------------------------------------------------------------
//
// Every row goes through the same function. No protocol name is ever special-cased.
//
//   base       = tvl_usd * category_weight(category)
//   growthMult = 1 + (clamp(change_7d, -60, +150) / 100) * 0.35
//   ageMult    = 0.60 + (min(age_days, 1460) / 1460) * 0.40      (unknown age: 240 days)
//   chainMult  = 1 + min(chain_count, 8) * 0.03
//   fundMult   = 1 + (min(funding_usd, 50_000_000) / 50_000_000) * 0.15  (absent funding: 1.00)
//   implied    = max(1, round(base * growthMult * ageMult * chainMult * fundMult))
//
// The category weight table is CATEGORY_RULES below. It is a table of *categories*, not names:
// lending and credit books carry the highest multiple because a token there captures fee and spread
// value; trading, derivatives and yield sit in the middle; curators, allocators and stable-asset
// wrappers carry less because their economics are thinner per dollar of TVL. An unmapped category
// falls back to 0.18.
//
// Growth is capped so one outlier week cannot dominate the board, and floored so one bad week cannot
// zero a protocol out. Age measures how long the protocol has run with no token; a longer record
// means more accumulated usage and stronger launch pressure, so the multiplier rises from 0.60 to
// 1.00 over four years. Chain count is a small reach premium. Funding is used only when the snapshot
// carries it (this snapshot does not); it is a modest launch-tailwind premium.
//
// The dashboard states this same model, shows every row's factors, and prints a "why this value"
// sentence built from the factors. Screenshots and code therefore tell the same story.

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

/** The model's constants, exactly as the dashboard prints them. */
export interface ModelConstants {
  version: string;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_full_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  funding_weight: number;
  funding_full_usd: number;
}

export const MODEL: ModelConstants = {
  version: 'radar-2.1',
  growth_weight: 0.35,
  growth_floor: -60,
  growth_cap: 150,
  age_floor: 0.6,
  age_range: 0.4,
  age_full_days: 1460,
  unknown_age_days: 240,
  chain_step: 0.03,
  chain_cap: 8,
  funding_weight: 0.15,
  funding_full_usd: 50_000_000,
};

/** The model's version label: the dashboard names it and the dossier quotes it. */
export const MODEL_VERSION = MODEL.version;

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
  { label: 'Lending & credit', weight: 0.3, match: ['lending', 'cdp', 'collateral', 'credit'] },
  { label: 'Trading & liquidity', weight: 0.26, match: ['dex', 'leveraged farm', 'liquidity manager'] },
  { label: 'Derivatives', weight: 0.24, match: ['derivative', 'perpetual', 'basis', 'option'] },
  { label: 'Yield & staking', weight: 0.22, match: ['yield', 'staking pool', 'restak'] },
  { label: 'RWA & BTC', weight: 0.2, match: ['rwa', 'btc'] },
  { label: 'Infrastructure', weight: 0.18, match: ['chain', 'payments', 'privacy', 'index', 'bridge'] },
  { label: 'Curators & allocators', weight: 0.14, match: ['risk curator', 'allocator', 'governance'] },
  { label: 'Insurance', weight: 0.14, match: ['insurance'] },
  { label: 'Stable assets', weight: 0.1, match: ['stable'] },
];

/** What an unmatched category earns. */
export const DEFAULT_CATEGORY_RULE: CategoryRule = {
  label: 'Unclassified / other',
  weight: 0.18,
  match: [],
};

/** A farm step: the action, what it costs in USD (or "free"), and how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One line of a row's value breakdown, as the detail panel prints it. */
export interface BreakdownItem {
  factor: string;
  detail: string;
  multiplier: number | null;
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
  funding_multiplier: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  breakdown: BreakdownItem[];
  explanation: string;
  farm_plan: FarmStep[];
  farm_steps: string[];
}

/** The dashboard's compact view of one ranked row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  category_label: string;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
  funding_multiplier: number;
  funding_usd: number | null;
  on_watchlist: boolean;
  token_status: 'pre-token';
  explanation: string;
  breakdown: BreakdownItem[];
  farm_plan: FarmStep[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
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
  model: ModelConstants;
  model_version: string;
  category_rules: CategoryRule[];
  default_category: CategoryRule;
  protocols_scanned: number;
  pre_token_total: number;
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
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

const capitalize = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category rule a protocol falls under; the first keyword match wins. */
export function categoryRuleFor(category: string | null): CategoryRule {
  if (category === null || category.trim() === '') return DEFAULT_CATEGORY_RULE;
  const c = category.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.match.some((needle) => c.includes(needle))) return rule;
  }
  return DEFAULT_CATEGORY_RULE;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
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

/** One protocol's complete score: the result, its factors, and the sentence that explains it. */
export interface ScoreResult {
  implied: number;
  base: number;
  categoryRule: CategoryRule;
  growthPct: number;
  growthMultiplier: number;
  ageMultiplier: number;
  ageDays: number | null;
  ageDaysUsed: number;
  chainMultiplier: number;
  fundingMultiplier: number;
  fundingUsed: number | null;
  breakdown: BreakdownItem[];
  explanation: string;
}

/** Score one protocol with the documented model. The same function scores every row. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): ScoreResult {
  const age = ageDays(asOf, p.listed_at);
  const rule = categoryRuleFor(p.category);
  const base = p.tvl_usd * rule.weight;

  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMultiplier = 1 + (growthPct / 100) * model.growth_weight;

  const ageDaysUsed = age ?? model.unknown_age_days;
  const ageRatio = clamp(ageDaysUsed, 0, model.age_full_days) / model.age_full_days;
  const ageMultiplier = model.age_floor + ageRatio * model.age_range;

  const chainCount = p.chains.length;
  const chainMultiplier = 1 + Math.min(chainCount, model.chain_cap) * model.chain_step;

  const funding =
    typeof p.funding_usd === 'number' && Number.isFinite(p.funding_usd) && p.funding_usd > 0 ? p.funding_usd : null;
  const fundingMultiplier =
    funding === null ? 1 : 1 + Math.min(funding / model.funding_full_usd, 1) * model.funding_weight;

  const implied = Math.max(1, Math.round(base * growthMultiplier * ageMultiplier * chainMultiplier * fundingMultiplier));

  const growthDetail =
    rawGrowth === growthPct
      ? `${signedPct(growthPct)} 7d -> ${growthMultiplier.toFixed(3)}x`
      : `${signedPct(rawGrowth)} 7d, clamped to ${signedPct(growthPct)} -> ${growthMultiplier.toFixed(3)}x`;
  const ageDetail =
    age === null
      ? `no listing date, ${model.unknown_age_days}d assumed -> ${ageMultiplier.toFixed(3)}x`
      : `${age}d without a token -> ${ageMultiplier.toFixed(3)}x`;
  const chainDetail = `${chainCount} chain${chainCount === 1 ? '' : 's'} -> ${chainMultiplier.toFixed(3)}x`;
  const fundingDetail =
    funding === null ? 'none on record -> 1.000x' : `${money(funding)} raised -> ${fundingMultiplier.toFixed(3)}x`;

  const breakdown: BreakdownItem[] = [
    { factor: 'TVL', detail: money(p.tvl_usd), multiplier: null },
    { factor: 'Category weight', detail: `${rule.label} · ${rule.weight.toFixed(2)}x`, multiplier: rule.weight },
    { factor: '7-day growth', detail: growthDetail, multiplier: round4(growthMultiplier) },
    { factor: 'Age without token', detail: ageDetail, multiplier: round4(ageMultiplier) },
    { factor: 'Chain reach', detail: chainDetail, multiplier: round4(chainMultiplier) },
    { factor: 'Funding', detail: fundingDetail, multiplier: round4(fundingMultiplier) },
  ];

  const growthClause =
    rawGrowth === growthPct
      ? `a ${signedPct(growthPct)} 7-day move scores ${growthMultiplier.toFixed(3)}x`
      : `a ${signedPct(rawGrowth)} 7-day move, clamped to ${signedPct(growthPct)}, scores ${growthMultiplier.toFixed(3)}x`;
  const ageClause =
    age === null
      ? `no listing date means the model assumes ${model.unknown_age_days} days (${ageMultiplier.toFixed(3)}x)`
      : `${age} days without a token scores ${ageMultiplier.toFixed(3)}x`;
  const chainClause = `${chainCount} chain${chainCount === 1 ? ' scores' : 's score'} ${chainMultiplier.toFixed(3)}x`;
  const fundingClause =
    funding === null
      ? 'No disclosed funding is on record.'
      : `${money(funding)} of disclosed funding adds ${fundingMultiplier.toFixed(3)}x.`;
  const explanation =
    `${money(p.tvl_usd)} of TVL at the ${rule.label.toLowerCase()} weight (${rule.weight.toFixed(2)}x) ` +
    `gives a ${money(base)} base. ${capitalize(growthClause)}; ${ageClause}; ${chainClause}. ` +
    `${fundingClause} Implied value ${money(implied)}.`;

  return {
    implied,
    base,
    categoryRule: rule,
    growthPct,
    growthMultiplier,
    ageMultiplier,
    ageDays: age,
    ageDaysUsed,
    chainMultiplier,
    fundingMultiplier,
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

/** The category's one concrete action, in words a farmer can follow. */
function categoryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) {
    return `Supply ${usd(capital)} of USDC to ${name} on ${chain} and borrow no more than a third of it to stay liquid.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return `Provide ${usd(capital)} of liquidity to ${name}'s main pool on ${chain} and keep the LP receipt.`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis') || c.includes('option')) {
    return `Post ${usd(capital)} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('yield') || c.includes('staking pool') || c.includes('restak')) {
    return `Deposit ${usd(capital)} into ${name}'s ${chain} yield position and keep the receipt token.`;
  }
  if (c.includes('rwa') || c.includes('btc')) {
    return `Mint or subscribe to ${usd(capital)} of ${name}'s yield asset on ${chain} and hold the receipt.`;
  }
  if (c.includes('bridge')) {
    return `Bridge ${usd(capital)} of USDC into ${chain} through ${name} and deploy it in the protocol's app.`;
  }
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('governance')) {
    return `Allocate ${usd(capital)} to a ${name} curator vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint ${usd(capital)} of the protocol's stable asset on ${chain} against collateral.`;
  }
  if (c.includes('insurance')) {
    return `Buy ${usd(capital)} of cover from ${name} on ${chain} and keep the policy.`;
  }
  if (c.includes('prediction')) {
    return `Fund one ${usd(capital)} position on a ${name} market on ${chain}.`;
  }
  if (c.includes('chain') || c.includes('payments') || c.includes('privacy')) {
    return `Deposit ${usd(capital)} into ${name}'s ${chain} app and make one real use of it.`;
  }
  return `Deposit ${usd(capital)} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** How long the setup action takes, from the category. */
function actionMinutes(p: SnapshotProtocol): number {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('liquidity') || c.includes('bridge')) return 20;
  if (c.includes('rwa') || c.includes('insurance') || c.includes('prediction')) return 18;
  return 15;
}

/**
 * A protocol's farm plan: four concrete steps, each an action with an explicit cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. When the protocol runs on more than one chain, step three mirrors a
 * smaller position on the second chain; otherwise it is the weekly qualifying action.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const steps: FarmStep[] = [
    {
      action: `Create a dedicated wallet and move ${usd(capital)} of USDC onto ${chain}; keep the seed phrase offline.`,
      cost: `${usd(capital)} capital + ${usd(gas)} gas`,
      time: `${chain.toLowerCase().includes('ethereum') ? 20 : 12} minutes`,
    },
    {
      action: categoryAction(p, capital, chain),
      cost: `${usd(0)} extra capital + ${usd(gas)} gas`,
      time: `${actionMinutes(p)} minutes`,
    },
  ];
  if (secondChain !== null) {
    const mirror = Math.max(25, Math.round(capital / 2 / 25) * 25);
    steps.push({
      action: `Mirror a smaller ${usd(mirror)} position on ${secondChain} through ${p.name} so the wallet shows activity on more than one chain.`,
      cost: `${usd(mirror)} more capital + ${usd(gasFor(secondChain))} gas`,
      time: '18 minutes',
    });
  } else {
    steps.push({
      action: `Make one qualifying action each week on ${p.name} (deposit, borrow, swap or vote) for ${hold} days.`,
      cost: `${usd(0)} extra capital + ${usd(2 * weeks)} gas across ${weeks} week${weeks === 1 ? '' : 's'}`,
      time: `10 minutes a week for ${weeks} week${weeks === 1 ? '' : 's'}`,
    });
  }
  steps.push({
    action: `Log the wallet, dates and every transaction, then claim only from ${p.name}'s official rewards page after ${hold} days.`,
    cost: 'free',
    time: '15 minutes',
  });
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
      funding_multiplier: round4(score.fundingMultiplier),
      funding_usd: score.fundingUsed,
    },
    breakdown: score.breakdown,
    explanation: score.explanation,
    farm_plan: plan,
    farm_steps: plan.map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();

  // The watchlist is the floor: every slug, even if the snapshot's index has moved under it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  // The expanded radar: pre-token protocols the watchlist left out, by TVL, capped. A chosen
  // protocol always stays chosen; this only adds rows the watchlist did not name.
  const extra = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isFarmablePreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareSlug(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of extra) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort(
    (a, b) =>
      b.score.implied - a.score.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      compareSlug(a.p.slug, b.p.slug),
  );
  return scored.map((s, i) => toBoardRow(i + 1, s.p, s.score, watch.has(s.p.slug)));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) ||
        b.tvl_usd - a.tvl_usd ||
        compareSlug(a.slug, b.slug),
    )
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
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
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    chain_count: row.chains.length,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    category_label: row.model.category_label,
    category_multiple: row.model.category_multiple,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    funding_multiplier: row.model.funding_multiplier,
    funding_usd: row.model.funding_usd,
    on_watchlist: row.on_watchlist,
    token_status: 'pre-token',
    explanation: row.explanation,
    breakdown: row.breakdown,
    farm_plan: row.farm_plan,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const covered = new Set(board.map((r) => r.slug));
  const watchlistCovered = snapshot.watchlist.filter((slug) => covered.has(slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    category_rules: CATEGORY_RULES,
    default_category: DEFAULT_CATEGORY_RULE,
    protocols_scanned: snapshot.protocols.length,
    pre_token_total: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    top_implied: board.length > 0 ? board[0]!.implied_value_usd : 0,
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
 * Why a board is not one the gate will take, or null: row count, coverage, ranks, order, value
 * spread, farm plans, and the explanation each row must carry.
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
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.token_status !== 'pre-token') return `${r.slug} is not marked pre-token`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.explanation !== 'string' || r.explanation.length < 40) {
      return `${r.slug} has no usable "why this value" explanation`;
    }
    if (!Array.isArray(r.farm_plan) || r.farm_plan.length < 3 || r.farm_plan.length > 4) {
      return `${r.slug} has ${Array.isArray(r.farm_plan) ? r.farm_plan.length : 0} structured farm steps`;
    }
    for (const step of r.farm_plan) {
      if (step.cost.trim() === '' || step.time.trim() === '') return `${r.slug} has a farm step without a cost or time`;
      if (!/\$|free/i.test(step.cost)) return `${r.slug} has a farm cost that is not a dollar amount or "free"`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
