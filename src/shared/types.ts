export enum UserRole {
  ADMIN = 'admin',
  CLIENT = 'client',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export type Locale = 'pt-BR' | 'es' | 'en';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  locale: Locale;
  department: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  category: 'auth' | 'users' | 'profile' | 'security' | 'queue' | 'llm' | 'mail' | 'webhook' | 'wordpress' | 'scraping';
  resource: string;
  status: 'success' | 'warning' | 'error';
  ipAddress: string;
  latencyMs: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface DailyMetricPoint {
  date: string;
  label: string;
  usersCount: number;
  loginsCount: number;
  actionsCount: number;
}

export interface DashboardSummary {
  totals: {
    totalUsers: number;
    activeUsers: number;
    loginsLast30d: number;
    actionsLast30d: number;
    usersDeltaPct: number;
    loginsDeltaPct: number;
    actionsDeltaPct: number;
  };
  series: DailyMetricPoint[];
}

export interface QueueJobRecord {
  id: string;
  queueName: 'email-dispatch' | 'audit-sync' | 'webhook-delivery' | 'llm-processing';
  name: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result?: string;
  createdAt: string;
  processedAt?: string;
}

export type LLMProviderId = 'gemini' | 'openrouter' | 'llama';

export interface InfrastructureStatus {
  database: {
    engine: 'PostgreSQL';
    mode: 'native-pg-pool' | 'embedded-transactional-store';
    host: string;
    databaseName: string;
    poolMax: number;
    connected: boolean;
  };
  cacheAndQueue: {
    redisEnabled: boolean;
    bullmqEnabled: boolean;
    mode: 'redis-bullmq' | 'in-memory-fallback';
    redisHost: string;
    activeQueues: string[];
    cachedKeysCount: number;
    jobsSummary: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
  };
  llm: {
    geminiConfigured: boolean;
    geminiModel: string;
    openRouterConfigured: boolean;
    openRouterModel: string;
    llamaConfigured: boolean;
    llamaModel: string;
  };
  mail: {
    provider: 'resend' | 'smtp';
    fromAddress: string;
    resendConfigured: boolean;
    smtpConfigured: boolean;
    smtpHost: string;
    sentCount: number;
  };
  security: {
    jwtAlgorithm: 'HS256';
    jwtExpiresInSeconds: number;
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    authRateLimitMax: number;
    webhookHmacEnabled: boolean;
    maxUploadSizeBytes: number;
  };
}

export interface WordPressSite {
  id: string;
  userId: string;
  siteName: string;
  siteUrl: string;
  apiKey: string;
  status: 'connected' | 'pending' | 'disconnected' | 'error';
  lastSyncAt: string | null;
  autoPublish: boolean;
  defaultStatus: 'draft' | 'publish';
  defaultCategory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WordPressLog {
  id: string;
  siteId: string;
  siteName?: string;
  action: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface NewsSource {
  id: string;
  userId: string;
  name: string;
  url: string;
  type: 'rss' | 'portal_html' | 'google_news';
  category: string;
  targetSiteId: string | null;
  active: boolean;
  autoRewrite: boolean;
  autoPublish: boolean;
  lastScrapedAt: string | null;
  articlesCount?: number;
  createdAt: string;
}

export interface CapturedArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  originalUrl: string;
  originalTitle: string;
  originalContent: string;
  originalExcerpt: string;
  imageUrl: string | null;
  publishedAt: string | null;
  status: 'pending' | 'rewriting' | 'ready' | 'published' | 'ignored' | 'error';
  aiTitle: string | null;
  aiContent: string | null;
  aiExcerpt: string | null;
  aiSeoKeywords: string[];
  wpPostId: number | null;
  wpSiteId: string | null;
  wpPermalink: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface ArticleRewriteOptions {
  articleId: string;
  tone?: 'jornalistico' | 'persuasivo' | 'analitico' | 'didatico';
  model?: LLMProviderId;
  targetSiteId?: string;
  autoPublish?: boolean;
}

