/** Anonymous, cross-user aggregates from market_signals(); shown only when `enough`. */
export interface MarketSignals {
  since: string;
  users: number;
  roles: number;
  enough: boolean;
  stacks: { name: string; count: number }[];
  remote: { scope: string; count: number }[];
  ai_share: number;
  contract_share: number;
  median_score: number;
}
