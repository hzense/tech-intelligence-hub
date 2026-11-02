export type GenerationSignalType =
  | 'research'
  | 'product'
  | 'funding'
  | 'acquisition'
  | 'hiring'
  | 'policy'
  | 'technology'
  | 'market'
  | 'people'
  | 'open_source'
  | 'security'
  | 'patent'
  | 'partnership'
  | 'regulation'
  | 'supply_chain'
  | 'disclosure'
  | 'operations'
  | 'incident';
export const LEGACY_SIGNAL_TYPES: readonly Exclude<
  GenerationSignalType,
  'disclosure' | 'operations' | 'incident'
>[];
export const SIGNAL_TYPES: readonly GenerationSignalType[];
export type SignalEventType = Exclude<
  GenerationSignalType,
  'technology' | 'security' | 'market' | 'open_source' | 'supply_chain'
>;
export const SIGNAL_EVENT_TYPES: readonly SignalEventType[];
export const SIGNAL_EVENT_TYPE_LABELS: Readonly<Record<SignalEventType, string>>;
export const SIGNAL_EVENT_TYPE_RULES: string;
export function isSignalEventType(value: unknown): value is SignalEventType;
