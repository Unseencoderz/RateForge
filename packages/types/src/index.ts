export interface ClientIdentity {
  userId: string;
  ip: string;
  tier: 'free' | 'pro' | 'enterprise' | string;
}

export enum AlgorithmType {
  FIXED_WINDOW = 'fixed_window',
  SLIDING_WINDOW = 'sliding_window',
  TOKEN_BUCKET = 'token_bucket',
  LEAKY_BUCKET = 'leaky_bucket'
}

export interface RateLimitRequest {
  clientId: string;
  identity: ClientIdentity;
  endpoint: string;
  method: string;
  timestamp: number;
  algorithm: AlgorithmType;
}

export interface RuleConfig {
  id: string;
  description?: string;
  clientTier?: string;
  endpointPattern: string;
  method?: string;
  windowMs: number;
  maxRequests: number;
  burstCapacity?: number;
  algorithm: AlgorithmType;
  enabled: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
  ruleId?: string;
  reason?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: RateLimitErrorBody;
}

export interface RateLimitErrorBody {
  code: 'RATE_LIMIT_EXCEEDED' | 'INVALID_RULE_CONFIG' | 'INTERNAL_ERROR' | string;
  message: string;
  retryAfterMs?: number;
  details?: unknown;
}

export interface AdminRulePayload {
  rules: RuleConfig[];
}

export interface ResetClientResponse {
  /** The clientId that was reset. */
  clientId: string;
  /** Number of Redis keys deleted during the reset. */
  deletedKeys: number;
}

export interface MetricsEvent {
  id: string;
  timestamp: number;
  clientId: string;
  endpoint: string;
  method: string;
  allowed: boolean;
  latencyMs: number;
  ruleId?: string;
  tier?: string;
}

export interface RequestLogEntry {
  requestId: string;
  timestamp: number;
  clientId: string;
  ip: string;
  method: string;
  endpoint: string;
  statusCode: number;
  userAgent?: string;
  ruleId?: string;
  latencyMs?: number;
}

export interface AlertPayload {
  id: string;
  createdAt: number;
  severity: 'info' | 'warning' | 'critical' | string;
  message: string;
  ruleId?: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
}

export * from './constants';

