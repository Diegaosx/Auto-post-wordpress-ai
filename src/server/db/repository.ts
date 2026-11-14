import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  User,
  UserRole,
  UserStatus,
  Locale,
  AuditLog,
  DailyMetricPoint,
  DashboardSummary,
  WordPressSite,
  WordPressLog,
  NewsSource,
  CapturedArticle,
} from '../../shared/types';
import { hashPassword, verifyPassword, hashToken } from '../security/crypto-shield';
import { env } from '../config/env';

export interface StoredUser extends User {
  passwordHash: string;
}

export interface PasswordResetRecord {
  id: string;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

interface DatabaseSchemaState {
  users: StoredUser[];
  passwordResets: PasswordResetRecord[];
  auditLogs: AuditLog[];
  metricsDaily: DailyMetricPoint[];
  wpSites: WordPressSite[];
  wpLogs: WordPressLog[];
  newsSources: NewsSource[];
  capturedArticles: CapturedArticle[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'kore_postgres_store.json');

function formatDateKey(date: Date): { date: string; label: string } {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return {
    date: `${yyyy}-${mm}-${dd}`,
    label: `${dd}/${mm}`,
  };
}

function createInitialSeed(): DatabaseSchemaState {
  const now = new Date();
  const nowIso = now.toISOString();

  const initialUsers: StoredUser[] = [
    {
      id: 'usr_admin_01',
      name: 'Rafael Araujo',
      email: 'admin@kore.dev',
      passwordHash: hashPassword('Admin@123456'),
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      locale: 'pt-BR',
      department: 'Platform Architecture',
      lastLoginAt: nowIso,
      createdAt: new Date(now.getTime() - 28 * 86400000).toISOString(),
      updatedAt: nowIso,
    },
    {
      id: 'usr_client_01',
      name: 'Beatriz Monteiro',
      email: 'cliente@kore.dev',
      passwordHash: hashPassword('Cliente@123456'),
      role: UserRole.CLIENT,
      status: UserStatus.ACTIVE,
      locale: 'pt-BR',
      department: 'Operations',
      lastLoginAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
      createdAt: new Date(now.getTime() - 24 * 86400000).toISOString(),
      updatedAt: nowIso,
    },
    {
      id: 'usr_client_02',
      name: 'Carlos Méndez',
      email: 'carlos.mendez@kore.dev',
      passwordHash: hashPassword('Cliente@123456'),
      role: UserRole.CLIENT,
      status: UserStatus.ACTIVE,
      locale: 'es',
      department: 'Finance',
      lastLoginAt: new Date(now.getTime() - 14 * 3600000).toISOString(),
      createdAt: new Date(now.getTime() - 19 * 86400000).toISOString(),
      updatedAt: nowIso,
    },
  ];

  const series: DailyMetricPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const { date, label } = formatDateKey(d);
    series.push({
      date,
      label,
      usersCount: 3,
      loginsCount: Math.floor(8 + Math.sin(i / 3) * 5 + (i % 4)),
      actionsCount: Math.floor(40 + Math.cos(i / 2) * 20 + (i % 7) * 4),
    });
  }

  const initialLogs: AuditLog[] = [
    {
      id: 'log_seed_01',
      timestamp: new Date(now.getTime() - 45 * 60000).toISOString(),
      actorId: 'usr_admin_01',
      actorEmail: 'admin@kore.dev',
      actorRole: UserRole.ADMIN,
      action: 'SYSTEM_CONFIG_INITIALIZED',
      category: 'security',
      resource: '/api/system/config',
      status: 'success',
      ipAddress: '10.24.0.1',
      latencyMs: 12,
      metadata: { jwtAlg: 'HS256', rateLimit: 'active', postgresSchema: 'verified' },
    },
  ];

  const wpSites: WordPressSite[] = [
    {
      id: 'site_wp_01',
      userId: 'usr_admin_01',
      siteName: 'Portal Tech & News Brasil',
      siteUrl: 'https://exemplo-portal-noticias.com.br',
      apiKey: 'wp_live_78a1bc294ef03',
      status: 'connected',
      lastSyncAt: new Date(now.getTime() - 25 * 60000).toISOString(),
      autoPublish: true,
      defaultStatus: 'publish',
      defaultCategory: 'Tecnologia',
      createdAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
      updatedAt: nowIso,
    },
  ];

  const wpLogs: WordPressLog[] = [
    {
      id: 'wplog_01',
      siteId: 'site_wp_01',
      siteName: 'Portal Tech & News Brasil',
      action: 'POST_PUBLISHED',
      status: 'success',
      message: 'Artigo "Como a Inteligência Artificial Transforma o Mercado em 2026" publicado com sucesso (ID: 1042)',
      details: { wpPostId: 1042, status: 'publish' },
      timestamp: new Date(now.getTime() - 25 * 60000).toISOString(),
    },
  ];

  const newsSources: NewsSource[] = [
    {
      id: 'src_g1_tec',
      userId: 'usr_admin_01',
      name: 'G1 — Tecnologia e Games',
      url: 'https://g1.globo.com/rss/g1/tecnologia/',
      type: 'rss',
      category: 'Tecnologia',
      targetSiteId: 'site_wp_01',
      active: true,
      autoRewrite: true,
      autoPublish: false,
      lastScrapedAt: new Date(now.getTime() - 15 * 60000).toISOString(),
      articlesCount: 1,
      createdAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
    },
  ];

  const capturedArticles: CapturedArticle[] = [
    {
      id: 'art_seed_01',
      sourceId: 'src_g1_tec',
      sourceName: 'G1 — Tecnologia e Games',
      originalUrl: 'https://g1.globo.com/tecnologia/noticia/2026/03/ia-avancos-automacao.ghtml',
      originalTitle: 'Novos avanços em IA aceleram automação em redações e portais de notícias',
      originalContent: 'Especialistas apontam que ferramentas de IA com curadoria humana garantem velocidade e profundidade na cobertura jornalística moderna em 2026.',
      originalExcerpt: 'Especialistas apontam que ferramentas de IA com curadoria humana garantem velocidade...',
      imageUrl: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800',
      publishedAt: new Date(now.getTime() - 60 * 60000).toISOString(),
      status: 'ready',
      aiTitle: 'Inteligência Artificial e Jornalismo: A Nova Era de Automação de Conteúdo em 2026',
      aiContent: 'A integração entre modelos de linguagem e fluxos editoriais está transformando a publicação digital em escala...',
      aiExcerpt: 'A integração entre modelos de linguagem e fluxos editoriais está transformando a publicação digital...',
      aiSeoKeywords: ['Inteligência Artificial', 'Automação', 'Jornalismo Tech', 'WordPress'],
      wpPostId: 1042,
      wpSiteId: 'site_wp_01',
      wpPermalink: 'https://exemplo-portal-noticias.com.br/ia-nova-era-automacao-2026',
      createdAt: new Date(now.getTime() - 50 * 60000).toISOString(),
    },
  ];

  return {
    users: initialUsers,
    passwordResets: [],
    auditLogs: initialLogs,
    metricsDaily: series,
    wpSites,
    wpLogs,
    newsSources,
    capturedArticles,
  };
}

class PostgresRepository {
  private state: DatabaseSchemaState;
  private pool: pg.Pool | null = null;
  private isPgConnected = false;

  constructor() {
    this.state = this.loadOrInitialize();
    this.setupPool();
  }

  private setupPool(): void {
    const connStr = env.DATABASE_URL || (env.POSTGRES_ENABLED ? `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}` : '');
    if (connStr) {
      try {
        this.pool = new pg.Pool({
          connectionString: connStr,
          ssl: env.POSTGRES_SSL ? { rejectUnauthorized: false } : undefined,
          max: env.POSTGRES_POOL_MAX || 10,
          connectionTimeoutMillis: 5000,
        });
      } catch (err: any) {
        console.warn('[PostgreSQL] Failed to initialize pool:', err.message);
      }
    }
  }

  public async init(): Promise<void> {
    if (!this.pool) return;

    try {
      // 1. Verify connection
      const check = await this.pool.query('SELECT NOW() as current_time');
      this.isPgConnected = true;
      console.log(`[PostgreSQL] Connected successfully to database at ${check.rows[0].current_time}`);

      // 2. Ensure schema DDL exists
      const schemaPath = path.resolve(process.cwd(), 'src/server/db/postgres-schema.sql');
      if (fs.existsSync(schemaPath)) {
        const ddl = fs.readFileSync(schemaPath, 'utf8');
        await this.pool.query(ddl);
      }

      // 3. Check if users table is empty; if so, seed it with canonical accounts
      const userCountRes = await this.pool.query('SELECT COUNT(*) as count FROM users');
      const count = Number(userCountRes.rows[0]?.count || 0);

      if (count === 0) {
        console.log('[PostgreSQL] Seeding initial canonical users and default data...');
        for (const u of this.state.users) {
          await this.pool.query(
            `INSERT INTO users (id, name, email, password_hash, role, status, locale, department, last_login_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO NOTHING`,
            [u.id, u.name, u.email, u.passwordHash, u.role, u.status, u.locale, u.department, u.lastLoginAt, u.createdAt, u.updatedAt]
          );
        }

        for (const m of this.state.metricsDaily) {
          await this.pool.query(
            `INSERT INTO metrics_daily (metric_date, label, users_count, logins_count, actions_count, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (metric_date) DO NOTHING`,
            [m.date, m.label, m.usersCount, m.loginsCount, m.actionsCount]
          );
        }

        for (const s of this.state.wpSites) {
          await this.pool.query(
            `INSERT INTO wordpress_sites (id, user_id, site_name, site_url, api_key, status, last_sync_at, auto_publish, default_status, default_category, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (id) DO NOTHING`,
            [s.id, s.userId, s.siteName, s.siteUrl, s.apiKey, s.status, s.lastSyncAt, s.autoPublish, s.defaultStatus, s.defaultCategory, s.createdAt, s.updatedAt]
          );
        }

        for (const src of this.state.newsSources) {
          await this.pool.query(
            `INSERT INTO news_sources (id, user_id, name, url, type, category, target_site_id, active, auto_rewrite, auto_publish, last_scraped_at, articles_count, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO NOTHING`,
            [src.id, src.userId, src.name, src.url, src.type, src.category, src.targetSiteId, src.active, src.autoRewrite, src.autoPublish, src.lastScrapedAt, src.articlesCount || 0, src.createdAt]
          );
        }

        for (const a of this.state.capturedArticles) {
          await this.pool.query(
            `INSERT INTO captured_articles (id, source_id, source_name, original_url, original_title, original_content, original_excerpt, image_url, published_at, status, ai_title, ai_content, ai_excerpt, ai_seo_keywords, wp_post_id, wp_site_id, wp_permalink, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
             ON CONFLICT (id) DO NOTHING`,
            [a.id, a.sourceId, a.sourceName, a.originalUrl, a.originalTitle, a.originalContent, a.originalExcerpt, a.imageUrl, a.publishedAt, a.status, a.aiTitle, a.aiContent, a.aiExcerpt, JSON.stringify(a.aiSeoKeywords || []), a.wpPostId, a.wpSiteId, a.wpPermalink, a.createdAt]
          );
        }
      }

      // 4. Hydrate state directly from PostgreSQL
      await this.hydrateFromPostgres();
      console.log(`[PostgreSQL] Hydrated ${this.state.users.length} users, ${this.state.wpSites.length} WP sites, ${this.state.newsSources.length} sources, ${this.state.capturedArticles.length} articles.`);
    } catch (err: any) {
      console.error('[PostgreSQL] Database initialization error (falling back to JSON store):', err.message);
      this.isPgConnected = false;
    }
  }

  private async hydrateFromPostgres(): Promise<void> {
    if (!this.pool) return;

    // Users
    const usersRes = await this.pool.query('SELECT * FROM users ORDER BY created_at ASC');
    if (usersRes.rows.length > 0) {
      this.state.users = usersRes.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        passwordHash: r.password_hash,
        role: r.role as UserRole,
        status: r.status as UserStatus,
        locale: r.locale as Locale,
        department: r.department,
        lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    }

    // WordPress Sites
    const sitesRes = await this.pool.query('SELECT * FROM wordpress_sites ORDER BY created_at DESC');
    this.state.wpSites = sitesRes.rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      siteName: r.site_name,
      siteUrl: r.site_url,
      apiKey: r.api_key,
      status: r.status,
      lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
      autoPublish: r.auto_publish,
      defaultStatus: r.default_status,
      defaultCategory: r.default_category,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));

    // News Sources
    const sourcesRes = await this.pool.query('SELECT * FROM news_sources ORDER BY created_at DESC');
    this.state.newsSources = sourcesRes.rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      url: r.url,
      type: r.type,
      category: r.category,
      targetSiteId: r.target_site_id,
      active: r.active,
      autoRewrite: r.auto_rewrite,
      autoPublish: r.auto_publish,
      lastScrapedAt: r.last_scraped_at ? new Date(r.last_scraped_at).toISOString() : null,
      articlesCount: r.articles_count || 0,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    // Captured Articles
    const articlesRes = await this.pool.query('SELECT * FROM captured_articles ORDER BY created_at DESC LIMIT 500');
    this.state.capturedArticles = articlesRes.rows.map((r: any) => ({
      id: r.id,
      sourceId: r.source_id,
      sourceName: r.source_name,
      originalUrl: r.original_url,
      originalTitle: r.original_title,
      originalContent: r.original_content,
      originalExcerpt: r.original_excerpt || '',
      imageUrl: r.image_url,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
      status: r.status,
      aiTitle: r.ai_title,
      aiContent: r.ai_content,
      aiExcerpt: r.ai_excerpt,
      aiSeoKeywords: Array.isArray(r.ai_seo_keywords) ? r.ai_seo_keywords : (typeof r.ai_seo_keywords === 'string' ? JSON.parse(r.ai_seo_keywords || '[]') : []),
      wpPostId: r.wp_post_id,
      wpSiteId: r.wp_site_id,
      wpPermalink: r.wp_permalink,
      errorMessage: r.error_message,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    // Audit Logs
    const logsRes = await this.pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 300');
    if (logsRes.rows.length > 0) {
      this.state.auditLogs = logsRes.rows.map((r: any) => ({
        id: r.id,
        timestamp: new Date(r.timestamp).toISOString(),
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        actorRole: r.actor_role,
        action: r.action,
        category: r.category,
        resource: r.resource,
        status: r.status,
        ipAddress: r.ip_address,
        latencyMs: r.latency_ms,
        metadata: typeof r.metadata === 'object' && r.metadata !== null ? r.metadata : {},
      }));
    }

    // WordPress Logs
    const wpLogsRes = await this.pool.query('SELECT * FROM wordpress_logs ORDER BY timestamp DESC LIMIT 500');
    if (wpLogsRes.rows.length > 0) {
      this.state.wpLogs = wpLogsRes.rows.map((r: any) => ({
        id: r.id,
        siteId: r.site_id,
        siteName: r.site_name,
        action: r.action,
        status: r.status,
        message: r.message,
        details: typeof r.details === 'object' && r.details !== null ? r.details : {},
        timestamp: new Date(r.timestamp).toISOString(),
      }));
    }

    // Metrics Daily
    const metricsRes = await this.pool.query('SELECT * FROM metrics_daily ORDER BY metric_date ASC LIMIT 60');
    if (metricsRes.rows.length > 0) {
      this.state.metricsDaily = metricsRes.rows.map((r: any) => ({
        date: r.metric_date instanceof Date ? r.metric_date.toISOString().split('T')[0] : String(r.metric_date),
        label: r.label || '',
        usersCount: r.users_count,
        loginsCount: r.logins_count,
        actionsCount: r.actions_count,
      }));
    }

    this.persist();
  }

  private loadOrInitialize(): DatabaseSchemaState {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw) as DatabaseSchemaState;
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          if (!Array.isArray(parsed.wpSites)) parsed.wpSites = [];
          if (!Array.isArray(parsed.wpLogs)) parsed.wpLogs = [];
          if (!Array.isArray(parsed.newsSources)) parsed.newsSources = [];
          if (!Array.isArray(parsed.capturedArticles)) parsed.capturedArticles = [];
          return parsed;
        }
      }
    } catch {
      // Fallback to fresh seed if corrupted
    }
    const seed = createInitialSeed();
    this.persist(seed);
    return seed;
  }

  private persist(state = this.state): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch {
      // Ignore write failures in read-only filesystems
    }
  }

  private stripPassword(user: StoredUser): User {
    const { passwordHash: _, ...publicUser } = user;
    return publicUser;
  }

  public incrementTodayMetric(field: 'loginsCount' | 'actionsCount' | 'usersCount'): void {
    const { date, label } = formatDateKey(new Date());
    let todayPoint = this.state.metricsDaily.find((m) => m.date === date);
    if (!todayPoint) {
      todayPoint = {
        date,
        label,
        usersCount: this.state.users.length,
        loginsCount: 1,
        actionsCount: 1,
      };
      this.state.metricsDaily.push(todayPoint);
    }
    if (field === 'usersCount') {
      todayPoint.usersCount = this.state.users.length;
    } else {
      todayPoint[field] += 1;
    }
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO metrics_daily (metric_date, label, users_count, logins_count, actions_count, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (metric_date) DO UPDATE SET
           users_count = EXCLUDED.users_count,
           logins_count = EXCLUDED.logins_count,
           actions_count = EXCLUDED.actions_count,
           updated_at = NOW()`,
        [todayPoint.date, todayPoint.label, todayPoint.usersCount, todayPoint.loginsCount, todayPoint.actionsCount]
      ).catch((err: any) => console.warn('[PostgreSQL] Failed updating metric:', err.message));
    }
  }

  public listUsers(): User[] {
    return this.state.users.map((u) => this.stripPassword(u));
  }

  public findUserById(id: string): User | null {
    const found = this.state.users.find((u) => u.id === id);
    return found ? this.stripPassword(found) : null;
  }

  public findStoredUserById(id: string): StoredUser | null {
    return this.state.users.find((u) => u.id === id) || null;
  }

  public findStoredUserByEmail(email: string): StoredUser | null {
    const clean = email.trim().toLowerCase();
    return this.state.users.find((u) => u.email.toLowerCase() === clean) || null;
  }

  public verifyUserCredentials(email: string, passwordPlain: string): User | null {
    const stored = this.findStoredUserByEmail(email);
    if (!stored) return null;
    if (!verifyPassword(passwordPlain, stored.passwordHash)) return null;
    stored.lastLoginAt = new Date().toISOString();
    this.incrementTodayMetric('loginsCount');
    this.persist();

    if (this.pool) {
      this.pool.query(
        'UPDATE users SET last_login_at = $1 WHERE id = $2',
        [stored.lastLoginAt, stored.id]
      ).catch((err: any) => console.warn('[PostgreSQL] Failed to update last_login_at:', err.message));
    }

    return this.stripPassword(stored);
  }

  public createUser(params: {
    name: string;
    email: string;
    passwordPlain: string;
    role: UserRole;
    status?: UserStatus;
    locale?: Locale;
    department?: string;
  }): User {
    const existing = this.findStoredUserByEmail(params.email);
    if (existing) {
      throw new Error('E-mail already registered');
    }
    const nowIso = new Date().toISOString();
    const newUser: StoredUser = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      name: params.name.trim(),
      email: params.email.trim().toLowerCase(),
      passwordHash: hashPassword(params.passwordPlain),
      role: params.role,
      status: params.status || UserStatus.ACTIVE,
      locale: params.locale || 'pt-BR',
      department: params.department?.trim() || 'General',
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.state.users.unshift(newUser);
    this.incrementTodayMetric('usersCount');
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO users (id, name, email, password_hash, role, status, locale, department, last_login_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [newUser.id, newUser.name, newUser.email, newUser.passwordHash, newUser.role, newUser.status, newUser.locale, newUser.department, newUser.lastLoginAt, newUser.createdAt, newUser.updatedAt]
      ).catch((err: any) => console.error('[PostgreSQL] Error inserting user:', err.message));
    }

    return this.stripPassword(newUser);
  }

  public updateUser(
    id: string,
    updates: {
      name?: string;
      email?: string;
      role?: UserRole;
      status?: UserStatus;
      locale?: Locale;
      department?: string;
      passwordPlain?: string;
    }
  ): User {
    const target = this.findStoredUserById(id);
    if (!target) {
      throw new Error('User not found');
    }
    if (updates.email && updates.email.toLowerCase() !== target.email.toLowerCase()) {
      const duplicate = this.findStoredUserByEmail(updates.email);
      if (duplicate && duplicate.id !== id) {
        throw new Error('E-mail already in use by another account');
      }
      target.email = updates.email.trim().toLowerCase();
    }
    if (updates.name !== undefined) target.name = updates.name.trim();
    if (updates.role !== undefined) target.role = updates.role;
    if (updates.status !== undefined) target.status = updates.status;
    if (updates.locale !== undefined) target.locale = updates.locale;
    if (updates.department !== undefined) target.department = updates.department.trim();
    if (updates.passwordPlain && updates.passwordPlain.length >= 6) {
      target.passwordHash = hashPassword(updates.passwordPlain);
    }
    target.updatedAt = new Date().toISOString();
    this.persist();

    if (this.pool) {
      this.pool.query(
        `UPDATE users SET name=$1, email=$2, password_hash=$3, role=$4, status=$5, locale=$6, department=$7, last_login_at=$8, updated_at=$9 WHERE id=$10`,
        [target.name, target.email, target.passwordHash, target.role, target.status, target.locale, target.department, target.lastLoginAt, target.updatedAt, target.id]
      ).catch((err: any) => console.error('[PostgreSQL] Error updating user:', err.message));
    }

    return this.stripPassword(target);
  }

  public deleteUser(id: string): boolean {
    const index = this.state.users.findIndex((u) => u.id === id);
    if (index === -1) return false;
    this.state.users.splice(index, 1);
    this.incrementTodayMetric('usersCount');
    this.persist();

    if (this.pool) {
      this.pool.query('DELETE FROM users WHERE id = $1', [id])
        .catch((err: any) => console.error('[PostgreSQL] Error deleting user:', err.message));
    }

    return true;
  }

  public storePasswordReset(params: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresInMinutes?: number;
  }): PasswordResetRecord {
    const expiresAt = new Date(
      Date.now() + (params.expiresInMinutes ?? 30) * 60000
    ).toISOString();
    const record: PasswordResetRecord = {
      id: `rst_${crypto.randomBytes(6).toString('hex')}`,
      userId: params.userId,
      email: params.email,
      tokenHash: params.tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.state.passwordResets.unshift(record);
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO password_resets (id, user_id, email, token_hash, expires_at, used_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [record.id, record.userId, record.email, record.tokenHash, record.expiresAt, record.usedAt, record.createdAt]
      ).catch((err: any) => console.warn('[PostgreSQL] Failed inserting password reset:', err.message));
    }

    return record;
  }

  public consumePasswordReset(rawToken: string, newPasswordPlain: string): User | null {
    const digest = hashToken(rawToken.trim());
    const record = this.state.passwordResets.find(
      (r) => r.tokenHash === digest && r.usedAt === null
    );
    if (!record) return null;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return null;
    }
    const user = this.findStoredUserById(record.userId);
    if (!user) return null;

    user.passwordHash = hashPassword(newPasswordPlain);
    user.updatedAt = new Date().toISOString();
    record.usedAt = new Date().toISOString();
    this.persist();

    if (this.pool) {
      this.pool.query('UPDATE users SET password_hash=$1, updated_at=$2 WHERE id=$3', [user.passwordHash, user.updatedAt, user.id])
        .catch((err: any) => console.error('[PostgreSQL] Error updating user password:', err.message));
      this.pool.query('UPDATE password_resets SET used_at=$1 WHERE id=$2', [record.usedAt, record.id])
        .catch((err: any) => console.error('[PostgreSQL] Error marking reset token used:', err.message));
    }

    return this.stripPassword(user);
  }

  public appendAuditLog(entry: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const fullLog: AuditLog = {
      id: `log_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.state.auditLogs.unshift(fullLog);
    if (this.state.auditLogs.length > 300) {
      this.state.auditLogs = this.state.auditLogs.slice(0, 300);
    }
    this.incrementTodayMetric('actionsCount');
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO audit_logs (id, timestamp, actor_id, actor_email, actor_role, action, category, resource, status, ip_address, latency_ms, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [fullLog.id, fullLog.timestamp, fullLog.actorId || null, fullLog.actorEmail, fullLog.actorRole, fullLog.action, fullLog.category, fullLog.resource, fullLog.status, fullLog.ipAddress, fullLog.latencyMs, JSON.stringify(fullLog.metadata || {})]
      ).catch((err: any) => console.warn('[PostgreSQL] Failed inserting audit log:', err.message));
    }

    return fullLog;
  }

  public listAuditLogs(params?: {
    category?: string;
    search?: string;
    actorId?: string;
    limit?: number;
  }): AuditLog[] {
    let logs = [...this.state.auditLogs];
    if (params?.actorId) {
      logs = logs.filter((l) => l.actorId === params.actorId);
    }
    if (params?.category && params.category !== 'all') {
      logs = logs.filter((l) => l.category === params.category);
    }
    if (params?.search) {
      const q = params.search.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.actorEmail.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          l.resource.toLowerCase().includes(q) ||
          l.ipAddress.toLowerCase().includes(q)
      );
    }
    return logs.slice(0, params?.limit ?? 100);
  }

  public getDashboardSummary(days = 30): DashboardSummary {
    const clampedDays = Math.min(30, Math.max(7, days));
    const series = this.state.metricsDaily.slice(-clampedDays);
    const totalUsers = this.state.users.length;
    const activeUsers = this.state.users.filter((u) => u.status === UserStatus.ACTIVE).length;

    const loginsLast30d = series.reduce((acc, item) => acc + item.loginsCount, 0);
    const actionsLast30d = series.reduce((acc, item) => acc + item.actionsCount, 0);

    return {
      totals: {
        totalUsers,
        activeUsers,
        loginsLast30d,
        actionsLast30d,
        usersDeltaPct: 14.2,
        loginsDeltaPct: 18.6,
        actionsDeltaPct: 24.1,
      },
      series,
    };
  }

  // ==========================================================================
  // WORDPRESS SITES & LICENSES
  // ==========================================================================
  public getWordPressSites(userId?: string): WordPressSite[] {
    if (!this.state.wpSites) this.state.wpSites = [];
    if (!userId) return [...this.state.wpSites];
    return this.state.wpSites.filter((s) => s.userId === userId);
  }

  public getWordPressSiteById(id: string): WordPressSite | null {
    if (!this.state.wpSites) this.state.wpSites = [];
    return this.state.wpSites.find((s) => s.id === id) || null;
  }

  public getWordPressSiteByApiKey(apiKey: string): WordPressSite | null {
    if (!this.state.wpSites) this.state.wpSites = [];
    return this.state.wpSites.find((s) => s.apiKey === apiKey.trim()) || null;
  }

  public createWordPressSite(data: Omit<WordPressSite, 'id' | 'createdAt' | 'updatedAt'>): WordPressSite {
    if (!this.state.wpSites) this.state.wpSites = [];
    const now = new Date().toISOString();
    const site: WordPressSite = {
      ...data,
      id: `site_wp_${crypto.randomBytes(6).toString('hex')}`,
      createdAt: now,
      updatedAt: now,
    };
    this.state.wpSites.unshift(site);
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO wordpress_sites (id, user_id, site_name, site_url, api_key, status, last_sync_at, auto_publish, default_status, default_category, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [site.id, site.userId, site.siteName, site.siteUrl, site.apiKey, site.status, site.lastSyncAt, site.autoPublish, site.defaultStatus, site.defaultCategory, site.createdAt, site.updatedAt]
      ).catch((err: any) => console.error('[PostgreSQL] Error inserting wordpress site:', err.message));
    }

    return site;
  }

  public updateWordPressSite(id: string, updates: Partial<WordPressSite>): WordPressSite | null {
    if (!this.state.wpSites) this.state.wpSites = [];
    const idx = this.state.wpSites.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const updated: WordPressSite = {
      ...this.state.wpSites[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.state.wpSites[idx] = updated;
    this.persist();

    if (this.pool) {
      this.pool.query(
        `UPDATE wordpress_sites SET site_name=$1, site_url=$2, api_key=$3, status=$4, last_sync_at=$5, auto_publish=$6, default_status=$7, default_category=$8, updated_at=$9 WHERE id=$10`,
        [updated.siteName, updated.siteUrl, updated.apiKey, updated.status, updated.lastSyncAt, updated.autoPublish, updated.defaultStatus, updated.defaultCategory, updated.updatedAt, updated.id]
      ).catch((err: any) => console.error('[PostgreSQL] Error updating wordpress site:', err.message));
    }

    return updated;
  }

  public deleteWordPressSite(id: string): boolean {
    if (!this.state.wpSites) this.state.wpSites = [];
    const len = this.state.wpSites.length;
    this.state.wpSites = this.state.wpSites.filter((s) => s.id !== id);
    if (this.state.wpSites.length !== len) {
      this.persist();
      if (this.pool) {
        this.pool.query('DELETE FROM wordpress_sites WHERE id = $1', [id])
          .catch((err: any) => console.error('[PostgreSQL] Error deleting wordpress site:', err.message));
      }
      return true;
    }
    return false;
  }

  public appendWordPressLog(log: Omit<WordPressLog, 'id' | 'timestamp'>): WordPressLog {
    if (!this.state.wpLogs) this.state.wpLogs = [];
    const newLog: WordPressLog = {
      ...log,
      id: `wplog_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: new Date().toISOString(),
    };
    this.state.wpLogs.unshift(newLog);
    if (this.state.wpLogs.length > 500) {
      this.state.wpLogs = this.state.wpLogs.slice(0, 500);
    }
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO wordpress_logs (id, site_id, site_name, action, status, message, details, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newLog.id, newLog.siteId, newLog.siteName || null, newLog.action, newLog.status, newLog.message, JSON.stringify(newLog.details || {}), newLog.timestamp]
      ).catch((err: any) => console.warn('[PostgreSQL] Failed inserting wordpress log:', err.message));
    }

    return newLog;
  }

  public getWordPressLogs(siteId?: string, limit = 50): WordPressLog[] {
    if (!this.state.wpLogs) this.state.wpLogs = [];
    let list = this.state.wpLogs;
    if (siteId) {
      list = list.filter((l) => l.siteId === siteId);
    }
    return list.slice(0, limit);
  }

  // ==========================================================================
  // NEWS SOURCES
  // ==========================================================================
  public getNewsSources(userId?: string): NewsSource[] {
    if (!this.state.newsSources) this.state.newsSources = [];
    if (!userId) return [...this.state.newsSources];
    return this.state.newsSources.filter((s) => s.userId === userId);
  }

  public getNewsSourceById(id: string): NewsSource | null {
    if (!this.state.newsSources) this.state.newsSources = [];
    return this.state.newsSources.find((s) => s.id === id) || null;
  }

  public createNewsSource(data: Omit<NewsSource, 'id' | 'createdAt'>): NewsSource {
    if (!this.state.newsSources) this.state.newsSources = [];
    const now = new Date().toISOString();
    const source: NewsSource = {
      ...data,
      id: `src_${crypto.randomBytes(6).toString('hex')}`,
      createdAt: now,
    };
    this.state.newsSources.unshift(source);
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO news_sources (id, user_id, name, url, type, category, target_site_id, active, auto_rewrite, auto_publish, last_scraped_at, articles_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [source.id, source.userId, source.name, source.url, source.type, source.category, source.targetSiteId || null, source.active, source.autoRewrite, source.autoPublish, source.lastScrapedAt || null, source.articlesCount || 0, source.createdAt]
      ).catch((err: any) => console.error('[PostgreSQL] Error inserting news source:', err.message));
    }

    return source;
  }

  public updateNewsSource(id: string, updates: Partial<NewsSource>): NewsSource | null {
    if (!this.state.newsSources) this.state.newsSources = [];
    const idx = this.state.newsSources.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const updated: NewsSource = {
      ...this.state.newsSources[idx],
      ...updates,
    };
    this.state.newsSources[idx] = updated;
    this.persist();

    if (this.pool) {
      this.pool.query(
        `UPDATE news_sources SET name=$1, url=$2, type=$3, category=$4, target_site_id=$5, active=$6, auto_rewrite=$7, auto_publish=$8, last_scraped_at=$9, articles_count=$10 WHERE id=$11`,
        [updated.name, updated.url, updated.type, updated.category, updated.targetSiteId || null, updated.active, updated.autoRewrite, updated.autoPublish, updated.lastScrapedAt || null, updated.articlesCount || 0, updated.id]
      ).catch((err: any) => console.error('[PostgreSQL] Error updating news source:', err.message));
    }

    return updated;
  }

  public deleteNewsSource(id: string): boolean {
    if (!this.state.newsSources) this.state.newsSources = [];
    const len = this.state.newsSources.length;
    this.state.newsSources = this.state.newsSources.filter((s) => s.id !== id);
    if (this.state.newsSources.length !== len) {
      this.persist();
      if (this.pool) {
        this.pool.query('DELETE FROM news_sources WHERE id = $1', [id])
          .catch((err: any) => console.error('[PostgreSQL] Error deleting news source:', err.message));
      }
      return true;
    }
    return false;
  }

  // ==========================================================================
  // CAPTURED ARTICLES
  // ==========================================================================
  public getCapturedArticles(params?: {
    sourceId?: string;
    status?: string;
    search?: string;
    limit?: number;
  }): CapturedArticle[] {
    if (!this.state.capturedArticles) this.state.capturedArticles = [];
    let list = [...this.state.capturedArticles];
    if (params?.sourceId) {
      list = list.filter((a) => a.sourceId === params.sourceId);
    }
    if (params?.status && params.status !== 'all') {
      list = list.filter((a) => a.status === params.status);
    }
    if (params?.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (a) =>
          a.originalTitle.toLowerCase().includes(q) ||
          (a.aiTitle && a.aiTitle.toLowerCase().includes(q)) ||
          a.sourceName.toLowerCase().includes(q)
      );
    }
    return list.slice(0, params?.limit ?? 100);
  }

  public getCapturedArticleById(id: string): CapturedArticle | null {
    if (!this.state.capturedArticles) this.state.capturedArticles = [];
    return this.state.capturedArticles.find((a) => a.id === id) || null;
  }

  public checkArticleUrlExists(url: string): boolean {
    if (!this.state.capturedArticles) this.state.capturedArticles = [];
    const cleanUrl = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return this.state.capturedArticles.some((a) => {
      const existing = a.originalUrl.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      return existing === cleanUrl;
    });
  }

  public createCapturedArticle(data: Omit<CapturedArticle, 'id' | 'createdAt'>): CapturedArticle {
    if (!this.state.capturedArticles) this.state.capturedArticles = [];
    const now = new Date().toISOString();
    const article: CapturedArticle = {
      ...data,
      id: `art_${crypto.randomBytes(6).toString('hex')}`,
      createdAt: now,
    };
    this.state.capturedArticles.unshift(article);
    if (this.state.capturedArticles.length > 500) {
      this.state.capturedArticles = this.state.capturedArticles.slice(0, 500);
    }
    this.persist();

    if (this.pool) {
      this.pool.query(
        `INSERT INTO captured_articles (id, source_id, source_name, original_url, original_title, original_content, original_excerpt, image_url, published_at, status, ai_title, ai_content, ai_excerpt, ai_seo_keywords, wp_post_id, wp_site_id, wp_permalink, error_message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (original_url) DO UPDATE SET
           original_title = EXCLUDED.original_title,
           original_content = EXCLUDED.original_content,
           original_excerpt = EXCLUDED.original_excerpt,
           image_url = EXCLUDED.image_url,
           status = EXCLUDED.status,
           ai_title = EXCLUDED.ai_title,
           ai_content = EXCLUDED.ai_content,
           ai_excerpt = EXCLUDED.ai_excerpt,
           ai_seo_keywords = EXCLUDED.ai_seo_keywords,
           wp_post_id = EXCLUDED.wp_post_id,
           wp_site_id = EXCLUDED.wp_site_id,
           wp_permalink = EXCLUDED.wp_permalink,
           error_message = EXCLUDED.error_message`,
        [article.id, article.sourceId, article.sourceName, article.originalUrl, article.originalTitle, article.originalContent, article.originalExcerpt || '', article.imageUrl || null, article.publishedAt || null, article.status, article.aiTitle || null, article.aiContent || null, article.aiExcerpt || null, JSON.stringify(article.aiSeoKeywords || []), article.wpPostId || null, article.wpSiteId || null, article.wpPermalink || null, article.errorMessage || null, article.createdAt]
      ).catch((err: any) => console.error('[PostgreSQL] Error inserting captured article:', err.message));
    }

    return article;
  }

  public updateCapturedArticle(id: string, updates: Partial<CapturedArticle>): CapturedArticle | null {
    if (!this.state.capturedArticles) this.state.capturedArticles = [];
    const idx = this.state.capturedArticles.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const updated: CapturedArticle = {
      ...this.state.capturedArticles[idx],
      ...updates,
    };
    this.state.capturedArticles[idx] = updated;
    this.persist();

    if (this.pool) {
      this.pool.query(
        `UPDATE captured_articles SET source_id=$1, source_name=$2, original_title=$3, original_content=$4, original_excerpt=$5, image_url=$6, published_at=$7, status=$8, ai_title=$9, ai_content=$10, ai_excerpt=$11, ai_seo_keywords=$12, wp_post_id=$13, wp_site_id=$14, wp_permalink=$15, error_message=$16 WHERE id=$17`,
        [updated.sourceId, updated.sourceName, updated.originalTitle, updated.originalContent, updated.originalExcerpt || '', updated.imageUrl || null, updated.publishedAt || null, updated.status, updated.aiTitle || null, updated.aiContent || null, updated.aiExcerpt || null, JSON.stringify(updated.aiSeoKeywords || []), updated.wpPostId || null, updated.wpSiteId || null, updated.wpPermalink || null, updated.errorMessage || null, updated.id]
      ).catch((err: any) => console.error('[PostgreSQL] Error updating captured article:', err.message));
    }

    return updated;
  }

  public deleteCapturedArticle(id: string): boolean {
    if (!this.state.capturedArticles) this.state.capturedArticles = [];
    const len = this.state.capturedArticles.length;
    this.state.capturedArticles = this.state.capturedArticles.filter((a) => a.id !== id);
    if (this.state.capturedArticles.length !== len) {
      this.persist();
      if (this.pool) {
        this.pool.query('DELETE FROM captured_articles WHERE id = $1', [id])
          .catch((err: any) => console.error('[PostgreSQL] Error deleting captured article:', err.message));
      }
      return true;
    }
    return false;
  }
}

export const dbRepo = new PostgresRepository();
