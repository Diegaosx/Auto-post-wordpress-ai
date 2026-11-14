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
  sourceIds?: string[];
  categories?: string[];
  publishFrequencyMinutes?: number;
  aiCustomInstructions?: string;
  aiProvider?: LLMProviderId;
  aiModel?: string;
  aiTone?: string;
  lastPublishedAt?: string | null;
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
  type: 'rss' | 'portal_html' | 'google_news' | 'espn' | 'workana';
  category: string;
  targetSiteId: string | null;
  active: boolean;
  autoRewrite: boolean;
  autoPublish: boolean;
  intervalMinutes: number;
  lastScrapedAt: string | null;
  articlesCount?: number;
  createdAt: string;
}

export interface ArticleMediaData {
  featuredImage?: {
    url: string;
    alt?: string;
    title?: string;
    caption?: string;
  } | null;
  internalImages?: Array<{
    url: string;
    alt?: string;
    caption?: string;
  }>;
  videos?: Array<{
    type: string;
    url: string;
    title?: string;
    thumbnail?: string;
    description?: string;
  }>;
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
  publishedSiteIds?: string[];
  errorMessage?: string | null;
  createdAt: string;

  // Painel AGY Extração Profunda & Cloudflare R2
  subtitle?: string;
  author?: string;
  cleanHtml?: string;
  cleanText?: string;
  r2JsonUrl?: string | null;
  mediaData?: ArticleMediaData;
  tags?: string[];
}

export interface ArticleRewriteOptions {
  articleId: string;
  tone?: 'jornalistico' | 'persuasivo' | 'analitico' | 'didatico';
  provider?: LLMProviderId;
  model?: string;
  targetSiteId?: string;
  autoPublish?: boolean;
}

export interface SystemSettings {
  // 1. Branding & White-label
  platformName: string;
  platformTagline: string;
  browserTitle: string;
  logoText: string;
  logoUrl?: string;

  // 2. Motor de IA (AI Engine)
  aiProvider: LLMProviderId;
  openRouterApiKey?: string;
  openRouterModel: string;
  openRouterBaseUrl?: string;

  geminiApiKey?: string;
  geminiModel: string;

  llamaApiKey?: string;
  llamaBaseUrl?: string;
  llamaModel?: string;

  aiTemperature: number;
  aiSystemPrompt: string;

  // 3. Automação padrão
  autoRewriteArticles: boolean;
  autoPublishToWordPress: boolean;
  defaultRewriteTone: 'jornalistico' | 'persuasivo' | 'analitico' | 'didatico';

  // 4. Armazenamento em Nuvem Cloudflare R2
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
  r2PublicUrl?: string;
  r2AutoSync?: boolean;
  r2SyncEnabled?: boolean;
}

export type PublicBrandingSettings = Pick<
  SystemSettings,
  'platformName' | 'platformTagline' | 'browserTitle' | 'logoText' | 'logoUrl'
> & {
  hasUsers?: boolean;
};


