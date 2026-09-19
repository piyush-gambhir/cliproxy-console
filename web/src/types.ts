/**
 * Shapes the console's own server returns. The auth-file shape mirrors
 * server/src/mgmt-contract.ts -> ENDPOINTS.listAuthFiles, which was read out of
 * internal/api/handlers/management/auth_files.go:326-470.
 */

export interface ClaudeModelOption {id: string; label: string; contextWindow: 1000000; maxEffort: 'low'|'medium'|'high'|'xhigh'|'max'}
export interface Settings {
  gateway?:GatewayStatus;
  displayName: string;
  proxyUrl: string;
  hasManagementKey: boolean;
  keySource: 'env' | 'sqlite' | 'none';
  hasStoredManagementKey: boolean;
  hasClientApiKey: boolean;
  hasStoredClientApiKey: boolean;
  clientKeySource: 'env' | 'sqlite' | 'none';
  consoleUrl: string;
  sources: Record<string, 'env' | 'sqlite' | 'default'>;
  claudeModels: ClaudeModelOption[];
  cliProfile: string;
  cliEffort: 'low'|'medium'|'high'|'xhigh'|'max';
  claudeBackgroundModel: string;
  claudeSubagentModel: string;
  receiptRetentionDays: number;
  claudeConfigDir: string;
  desktopConfigDir: string;
  configFile: string;
  routingMode: 'manual';
}

export interface Health {
  ok: boolean;
  error?: string;
  proxyUrl: string;
  proxyVersion: string | null;
  hasManagementKey: boolean;
}

export interface Routing {
  strategy: string;
  forceModelPrefix: boolean;
  requestRetry: number;
  maxRetryInterval: number;
  switchProject: boolean;
  switchPreviewModel: boolean;
  sessionAffinity: boolean;
  sessionAffinityTtl: string;
  sessionAffinitySubagents: boolean;
}

export interface Profile {
  id: string;
  name: string;
  authFile: string;
  color: string;
  createdAt: string;
  /** The prefix this console last wrote — the Management API never reads one back. */
  lastKnownPrefix?: string;
  resetAt?: string;
  subscriptionNote?: string;
}

export interface AuthFile {
  id: string;
  auth_index?: string;
  name: string;
  provider: string;
  type?: string;
  label?: string;
  status: string;
  status_message?: string;
  disabled: boolean;
  unavailable?: boolean;
  runtime_only?: boolean;
  source?: string;
  email?: string;
  account?: string;
  account_type?: string;
  project_id?: string;
  priority?: number;
  weight?: number;
  note?: string;
  success?: number;
  failed?: number;
  next_retry_after?: string;
  last_refresh?: string;
  updated_at?: string;
  cooldowns?: unknown;
}

export interface AuthFileList {
  observed_at: string;
  files: AuthFile[];
}

export interface ModelEntry {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
}

export interface WirePlan {
  file: string;
  displayFile: string;
  env: { ANTHROPIC_BASE_URL: string; ANTHROPIC_AUTH_TOKEN: string; ANTHROPIC_MODEL: string };
  merged: Record<string, unknown>;
  fileExists: boolean;
  overwrites: string[];
  backupFile?: string | null;
  displayBackupFile?: string | null;
}

export interface TargetDir {
  path: string;
  display: string;
  exists?: boolean;
}

export interface Targets {
  globals: TargetDir[];
  recents: TargetDir[];
}

/** The console's derived health verdict for one account. */
export type AccountState = 'healthy' | 'cooling' | 'disabled' | 'expired' | 'error' | 'unknown';

export interface AccountStatus {
  state: AccountState;
  label: string;
  tone: 'ok' | 'warn' | 'err' | 'off' | 'plain';
  detail?: string;
}

export interface SubscriptionUsage {
  checkedAt: string;
  plan: string | null;
  windows: Array<{label: string; remainingPercent: number | null; resetsAt: string | null; active?: boolean; severity?: string}>;
  planTier?: string | null;
  subscriptionStatus?: string | null;
  planCheckUnavailable?: boolean;
  extraUsageEnabled?: boolean | null;
  usageBreakdown?: Array<{label: string; percent: number}>;
  breakdownCheckedAt?: string | null;
}

export interface GatewayStatus {ready:boolean;independent:boolean;inferenceUrl:string;error:string|null;storageError:string|null;syncedAt:string|null;receiptRetentionDays:number}
export interface RequestReceipt {id:string;startedAt:string;profile:string;model:string;responseModel:string;effort:string;session:string;agent:string;parentAgent:string;endpoint:string;status:number;durationMs:number;inputTokens:number|null;outputTokens:number|null;cacheReadTokens:number|null;cacheCreationTokens:number|null;accountConfirmed:boolean;completed:boolean;contextConfigured:number;over200kObserved:boolean;errorType:string}
export interface RequestHistory {receipts:RequestReceipt[];gateway:GatewayStatus;profiles:Profile[]}
