import express, { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ZipArchive } from 'archiver';
import { createServer as createViteServer } from 'vite';
import { env } from './src/server/config/env';
import {
  signJwt,
  verifyJwt,
  sanitizeInput,
  generateRecoveryToken,
  signWebhookPayload,
  verifyWebhookSignature,
  validateFileUpload,
  canAccessResource,
  RateLimiter,
  verifyPassword,
  JwtClaims,
} from './src/server/security/crypto-shield';
import { dbRepo } from './src/server/db/repository';
import { queueCacheManager } from './src/server/infra/queue-cache';
import { executeLlmPrompt } from './src/server/services/llm-gateway';
import { mailService } from './src/server/services/mail-service';
import {
  scrapeSource,
  rewriteArticleWithAi,
  syncArticleToR2,
  syncAllArticlesToR2,
  syncFeedsToR2,
} from './src/server/services/scraper-service';
import {
  testR2Connection,
  getR2Config,
  buildGeneratedArticleStructure,
  uploadSiteArticleJson,
  uploadSiteArticlesFeedJson,
} from './src/server/services/r2-sync';
import {
  syncArticleToWordPress,
  testWordPressConnection,
  verifyAndRepairPostFeaturedImage,
  repairAllMissingImagesForSite,
  fetchRemoteWordPressLogs,
  clearRemoteWordPressLogs,
} from './src/server/services/wordpress-sync';
import {
  UserRole,
  UserStatus,
  Locale,
  InfrastructureStatus,
  LLMProviderId,
  QueueJobRecord,
  WordPressSite,
  NewsSource,
  CapturedArticle,
} from './src/shared/types';

interface AuthenticatedRequest extends Request {
  auth?: JwtClaims;
}

const globalRateLimiter = new RateLimiter(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX_REQUESTS);
const authRateLimiter = new RateLimiter(env.RATE_LIMIT_WINDOW_MS, env.AUTH_RATE_LIMIT_MAX_REQUESTS);

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

async function startServer() {
  await dbRepo.init();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ==========================================================================
  // 1. HARDENED HTTP SECURITY HEADERS
  // ==========================================================================
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
  });

  // ==========================================================================
  // 2. GLOBAL & AUTH RATE LIMITING MIDDLEWARE
  // ==========================================================================
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const isAuthRoute = req.path.startsWith('/auth/');
    const limiter = isAuthRoute ? authRateLimiter : globalRateLimiter;
    const maxLimit = isAuthRoute ? env.AUTH_RATE_LIMIT_MAX_REQUESTS : env.RATE_LIMIT_MAX_REQUESTS;

    const result = limiter.consume(`${isAuthRoute ? 'auth' : 'api'}:${ip}`);
    res.setHeader('X-RateLimit-Limit', String(maxLimit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      dbRepo.appendAuditLog({
        actorId: null,
        actorEmail: 'anonymous',
        actorRole: 'unauthenticated',
        action: 'RATE_LIMIT_EXCEEDED',
        category: 'security',
        resource: req.originalUrl,
        status: 'warning',
        ipAddress: ip,
        latencyMs: 1,
        metadata: { retryAfterSeconds: result.retryAfterSeconds },
      });
      res.status(429).json({
        error: `Rate limit exceeded. Try again in ${result.retryAfterSeconds}s.`,
      });
      return;
    }
    next();
  });

  // ==========================================================================
  // 3. JWT AUTHENTICATION & RBAC MIDDLEWARES
  // ==========================================================================
  const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication token required' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const claims = verifyJwt(token, env.JWT_SECRET);
    if (!claims) {
      res.status(401).json({ error: 'Invalid or expired JWT token' });
      return;
    }
    const currentUser = dbRepo.findUserById(claims.sub);
    if (!currentUser || currentUser.status === UserStatus.SUSPENDED) {
      res.status(403).json({ error: 'Account suspended or removed' });
      return;
    }
    req.auth = {
      ...claims,
      role: currentUser.role,
      email: currentUser.email,
    };
    next();
  };

  const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth || !canAccessResource({
      actorRole: req.auth.role,
      actorId: req.auth.sub,
      requiredRole: UserRole.ADMIN,
    })) {
      dbRepo.appendAuditLog({
        actorId: req.auth?.sub || null,
        actorEmail: req.auth?.email || 'unknown',
        actorRole: req.auth?.role || 'none',
        action: 'RBAC_ACCESS_DENIED',
        category: 'security',
        resource: req.originalUrl,
        status: 'error',
        ipAddress: getClientIp(req),
        latencyMs: 1,
        metadata: { requiredRole: UserRole.ADMIN },
      });
      res.status(403).json({ error: 'Forbidden: Administrator role required' });
      return;
    }
    next();
  };

  // ==========================================================================
  // 4. AUTHENTICATION & PASSWORD RECOVERY ROUTES
  // ==========================================================================
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const start = Date.now();
    const ip = getClientIp(req);
    const email = sanitizeInput(req.body?.email || '', 160).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const stored = dbRepo.findStoredUserByEmail(email);
    if (stored && stored.status === UserStatus.SUSPENDED) {
      dbRepo.appendAuditLog({
        actorId: stored.id,
        actorEmail: stored.email,
        actorRole: stored.role,
        action: 'AUTH_LOGIN_SUSPENDED',
        category: 'auth',
        resource: '/api/auth/login',
        status: 'error',
        ipAddress: ip,
        latencyMs: Date.now() - start,
        metadata: { reason: 'Account suspended' },
      });
      res.status(403).json({ error: 'Account is currently suspended' });
      return;
    }

    const verifiedUser = dbRepo.verifyUserCredentials(email, password);
    if (!verifiedUser) {
      dbRepo.appendAuditLog({
        actorId: null,
        actorEmail: email,
        actorRole: 'anonymous',
        action: 'AUTH_LOGIN_FAILED',
        category: 'auth',
        resource: '/api/auth/login',
        status: 'warning',
        ipAddress: ip,
        latencyMs: Date.now() - start,
        metadata: { reason: 'Invalid credentials' },
      });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signJwt(
      { sub: verifiedUser.id, email: verifiedUser.email, role: verifiedUser.role },
      env.JWT_SECRET,
      env.JWT_EXPIRES_IN_SECONDS
    );

    queueCacheManager.deleteCache('dashboard:summary:30');
    dbRepo.appendAuditLog({
      actorId: verifiedUser.id,
      actorEmail: verifiedUser.email,
      actorRole: verifiedUser.role,
      action: 'AUTH_LOGIN_SUCCESS',
      category: 'auth',
      resource: '/api/auth/login',
      status: 'success',
      ipAddress: ip,
      latencyMs: Date.now() - start,
      metadata: { role: verifiedUser.role },
    });

    res.json({ token, user: verifiedUser });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const start = Date.now();
    const ip = getClientIp(req);
    const name = sanitizeInput(req.body?.name || '', 120);
    const email = sanitizeInput(req.body?.email || '', 160).toLowerCase();
    const department = sanitizeInput(req.body?.department || 'Operations', 100);
    const locale = (['pt-BR', 'es', 'en'].includes(req.body?.locale)
      ? req.body.locale
      : 'pt-BR') as Locale;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!name || !email || password.length < 6) {
      res.status(400).json({ error: 'Name, valid email, and password (min 6 chars) are required' });
      return;
    }

    try {
      // If there are no admin accounts yet, promote the first registrant to ADMIN
      const allUsers = dbRepo.listUsers();
      const hasAdmin = allUsers.some((u) => u.role === UserRole.ADMIN);
      const assignedRole = !hasAdmin ? UserRole.ADMIN : UserRole.CLIENT;

      const user = dbRepo.createUser({
        name,
        email,
        passwordPlain: password,
        role: assignedRole,
        status: UserStatus.ACTIVE,
        locale,
        department: !hasAdmin ? 'Administração' : department,
      });

      const token = signJwt(
        { sub: user.id, email: user.email, role: user.role },
        env.JWT_SECRET,
        env.JWT_EXPIRES_IN_SECONDS
      );

      queueCacheManager.deleteCache('dashboard:summary:30');
      dbRepo.appendAuditLog({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: user.role === UserRole.ADMIN ? 'AUTH_REGISTER_ROOT_ADMIN' : 'AUTH_REGISTER_CLIENT',
        category: 'auth',
        resource: '/api/auth/register',
        status: 'success',
        ipAddress: ip,
        latencyMs: Date.now() - start,
        metadata: { department: user.department, role: user.role },
      });

      res.status(201).json({ token, user });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      res.status(409).json({ error: msg });
    }
  });

  app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
    const start = Date.now();
    const ip = getClientIp(req);
    const email = sanitizeInput(req.body?.email || '', 160).toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const user = dbRepo.findStoredUserByEmail(email);
    if (!user) {
      // Constant-shape response to prevent email enumeration, while logging internally
      dbRepo.appendAuditLog({
        actorId: null,
        actorEmail: email,
        actorRole: 'anonymous',
        action: 'AUTH_RECOVERY_UNKNOWN_EMAIL',
        category: 'mail',
        resource: '/api/auth/forgot-password',
        status: 'warning',
        ipAddress: ip,
        latencyMs: Date.now() - start,
        metadata: { email },
      });
      res.json({
        dispatched: true,
        provider: env.MAIL_PROVIDER,
        devPreviewToken: null,
      });
      return;
    }

    const { rawToken, tokenHash } = generateRecoveryToken();
    dbRepo.storePasswordReset({
      userId: user.id,
      email: user.email,
      tokenHash,
      expiresInMinutes: 30,
    });

    const delivery = await mailService.sendPasswordRecoveryEmail({
      to: user.email,
      userName: user.name,
      rawToken,
    });

    dbRepo.appendAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AUTH_RECOVERY_TOKEN_DISPATCHED',
      category: 'mail',
      resource: '/api/auth/forgot-password',
      status: 'success',
      ipAddress: ip,
      latencyMs: Date.now() - start,
      metadata: {
        mailProvider: delivery.provider,
        deliveryStatus: delivery.status,
        bullmqJobId: delivery.jobId,
      },
    });

    res.json({
      dispatched: true,
      provider: delivery.provider,
      deliveryStatus: delivery.status,
      // Provided in dev/sandbox mode so the user can test the complete token reset loop without external inbox setup
      devPreviewToken: rawToken,
    });
  });

  app.post('/api/auth/reset-password', (req: Request, res: Response) => {
    const start = Date.now();
    const ip = getClientIp(req);
    const rawToken = sanitizeInput(req.body?.token || '', 120);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!rawToken || newPassword.length < 6) {
      res.status(400).json({ error: 'Valid recovery token and password (min 6 chars) required' });
      return;
    }

    const updatedUser = dbRepo.consumePasswordReset(rawToken, newPassword);
    if (!updatedUser) {
      dbRepo.appendAuditLog({
        actorId: null,
        actorEmail: 'anonymous',
        actorRole: 'anonymous',
        action: 'AUTH_PASSWORD_RESET_INVALID_TOKEN',
        category: 'security',
        resource: '/api/auth/reset-password',
        status: 'error',
        ipAddress: ip,
        latencyMs: Date.now() - start,
        metadata: {},
      });
      res.status(400).json({ error: 'Invalid or expired recovery token' });
      return;
    }

    dbRepo.appendAuditLog({
      actorId: updatedUser.id,
      actorEmail: updatedUser.email,
      actorRole: updatedUser.role,
      action: 'AUTH_PASSWORD_RESET_COMPLETED',
      category: 'auth',
      resource: '/api/auth/reset-password',
      status: 'success',
      ipAddress: ip,
      latencyMs: Date.now() - start,
      metadata: {},
    });

    res.json({ success: true });
  });

  // Public Healthcheck for Docker / Load Balancers
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // Public Branding Settings (Platform Name, Logo, Browser Title)
  app.get('/api/settings/public', (_req: Request, res: Response) => {
    res.json(dbRepo.getPublicBranding());
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = dbRepo.findUserById(req.auth!.sub);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  });

  // ==========================================================================
  // 5. DASHBOARD METRICS (ACCESSIBLE TO ADMIN & CLIENT)
  // ==========================================================================
  app.get('/api/dashboard/metrics', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const days = Number(req.query.days) || 30;
    const cacheKey = `dashboard:summary:${days}`;
    const cached = queueCacheManager.getCache(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    const summary = dbRepo.getDashboardSummary(days);
    queueCacheManager.setCache(cacheKey, summary, 30);
    res.json(summary);
  });

  // ==========================================================================
  // 6. USER MANAGEMENT CRUD (STRICTLY ADMIN ONLY)
  // ==========================================================================
  app.get('/api/users', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ users: dbRepo.listUsers() });
  });

  app.post('/api/users', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const start = Date.now();
    const name = sanitizeInput(req.body?.name || '', 120);
    const email = sanitizeInput(req.body?.email || '', 160).toLowerCase();
    const department = sanitizeInput(req.body?.department || 'General', 120);
    const role = req.body?.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.CLIENT;
    const status =
      req.body?.status === UserStatus.SUSPENDED ? UserStatus.SUSPENDED : UserStatus.ACTIVE;
    const locale = (['pt-BR', 'es', 'en'].includes(req.body?.locale)
      ? req.body.locale
      : 'pt-BR') as Locale;
    const password =
      typeof req.body?.password === 'string' && req.body.password.length >= 6
        ? req.body.password
        : 'Cliente@123456';

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required' });
      return;
    }

    try {
      const created = dbRepo.createUser({
        name,
        email,
        passwordPlain: password,
        role,
        status,
        locale,
        department,
      });

      queueCacheManager.deleteCache('dashboard:summary:30');
      dbRepo.appendAuditLog({
        actorId: req.auth!.sub,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: 'USER_CREATED_BY_ADMIN',
        category: 'users',
        resource: `/api/users/${created.id}`,
        status: 'success',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: { createdEmail: created.email, assignedRole: created.role },
      });

      res.status(201).json({ user: created });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not create user';
      res.status(409).json({ error: msg });
    }
  });

  app.patch(
    '/api/users/:id',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      const start = Date.now();
      const targetId = String(req.params.id);

      try {
        const updated = dbRepo.updateUser(targetId, {
          name: req.body?.name !== undefined ? sanitizeInput(req.body.name, 120) : undefined,
          email:
            req.body?.email !== undefined
              ? sanitizeInput(req.body.email, 160).toLowerCase()
              : undefined,
          department:
            req.body?.department !== undefined
              ? sanitizeInput(req.body.department, 120)
              : undefined,
          role:
            req.body?.role === UserRole.ADMIN || req.body?.role === UserRole.CLIENT
              ? req.body.role
              : undefined,
          status:
            req.body?.status === UserStatus.ACTIVE || req.body?.status === UserStatus.SUSPENDED
              ? req.body.status
              : undefined,
          locale: ['pt-BR', 'es', 'en'].includes(req.body?.locale) ? req.body.locale : undefined,
          passwordPlain:
            typeof req.body?.password === 'string' && req.body.password.length >= 6
              ? req.body.password
              : undefined,
        });

        queueCacheManager.deleteCache('dashboard:summary:30');
        dbRepo.appendAuditLog({
          actorId: req.auth!.sub,
          actorEmail: req.auth!.email,
          actorRole: req.auth!.role,
          action: 'USER_UPDATED_BY_ADMIN',
          category: 'users',
          resource: `/api/users/${targetId}`,
          status: 'success',
          ipAddress: getClientIp(req),
          latencyMs: Date.now() - start,
          metadata: { targetEmail: updated.email, role: updated.role, status: updated.status },
        });

        res.json({ user: updated });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Could not update user';
        res.status(400).json({ error: msg });
      }
    }
  );

  app.delete(
    '/api/users/:id',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      const start = Date.now();
      const targetId = String(req.params.id);
      if (targetId === req.auth!.sub) {
        res.status(400).json({ error: 'Cannot delete your own active administrator account' });
        return;
      }

      const targetUser = dbRepo.findUserById(targetId);
      const deleted = dbRepo.deleteUser(targetId);
      if (!deleted) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      queueCacheManager.deleteCache('dashboard:summary:30');
      dbRepo.appendAuditLog({
        actorId: req.auth!.sub,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: 'USER_DELETED_BY_ADMIN',
        category: 'users',
        resource: `/api/users/${targetId}`,
        status: 'warning',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: { deletedEmail: targetUser?.email || targetId },
      });

      res.json({ deleted: true });
    }
  );

  // ==========================================================================
  // 7. SELF PROFILE ROUTES (ADMIN & CLIENT — ISOLATED TO OWN ACCOUNT)
  // ==========================================================================
  app.get('/api/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.sub;
    const user = dbRepo.findUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  });

  app.get('/api/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.sub;
    const user = dbRepo.findUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  });

  app.patch('/api/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const start = Date.now();
    const userId = req.auth!.sub;

    try {
      const updated = dbRepo.updateUser(userId, {
        name: req.body?.name !== undefined ? sanitizeInput(req.body.name, 120) : undefined,
        department:
          req.body?.department !== undefined ? sanitizeInput(req.body.department, 120) : undefined,
        locale: ['pt-BR', 'es', 'en'].includes(req.body?.locale) ? req.body.locale : undefined,
      });

      dbRepo.appendAuditLog({
        actorId: userId,
        actorEmail: updated.email,
        actorRole: updated.role,
        action: 'PROFILE_UPDATED',
        category: 'profile',
        resource: '/api/profile',
        status: 'success',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: { locale: updated.locale, department: updated.department },
      });

      res.json({ user: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Profile update failed';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/profile/password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const start = Date.now();
    const userId = req.auth!.sub;
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || newPassword.length < 6) {
      res
        .status(400)
        .json({ error: 'Current password and new password (min 6 chars) are required' });
      return;
    }

    const stored = dbRepo.findStoredUserById(userId);
    if (!stored || !verifyPassword(currentPassword, stored.passwordHash)) {
      dbRepo.appendAuditLog({
        actorId: userId,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: 'PROFILE_PASSWORD_CHANGE_FAILED',
        category: 'security',
        resource: '/api/profile/password',
        status: 'warning',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: { reason: 'Incorrect current password' },
      });
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const updated = dbRepo.updateUser(userId, { passwordPlain: newPassword });
    dbRepo.appendAuditLog({
      actorId: userId,
      actorEmail: updated.email,
      actorRole: updated.role,
      action: 'PROFILE_PASSWORD_CHANGED',
      category: 'security',
      resource: '/api/profile/password',
      status: 'success',
      ipAddress: getClientIp(req),
      latencyMs: Date.now() - start,
      metadata: {},
    });

    res.json({ success: true });
  });

  // ==========================================================================
  // 8. SYSTEM AUDIT LOGS & INFRASTRUCTURE / LLM / QUEUE / WEBHOOK ROUTES
  // ==========================================================================
  app.get('/api/logs', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const limit = Math.min(1000, Number(req.query.limit) || 500);
    const logs = dbRepo.listAuditLogs({ category, search, limit });
    res.json({ logs });
  });

  app.get(
    '/api/infra/status',
    requireAuth,
    requireAdmin,
    (_req: AuthenticatedRequest, res: Response) => {
      const queueStatus = queueCacheManager.getStatusSummary();
      const status: InfrastructureStatus = {
        database: {
          engine: 'PostgreSQL',
          mode: env.POSTGRES_ENABLED ? 'native-pg-pool' : 'embedded-transactional-store',
          host: `${env.POSTGRES_HOST}:${env.POSTGRES_PORT}`,
          databaseName: env.POSTGRES_DB,
          poolMax: env.POSTGRES_POOL_MAX,
          connected: true,
        },
        cacheAndQueue: queueStatus,
        llm: {
          geminiConfigured:
            Boolean(env.GEMINI_API_KEY) && env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
          geminiModel: env.GEMINI_DEFAULT_MODEL,
          openRouterConfigured: Boolean(env.OPENROUTER_API_KEY),
          openRouterModel: env.OPENROUTER_DEFAULT_MODEL,
          llamaConfigured: Boolean(env.LLAMA_API_KEY),
          llamaModel: env.LLAMA_DEFAULT_MODEL,
        },
        mail: {
          provider: env.MAIL_PROVIDER,
          fromAddress: env.MAIL_FROM,
          resendConfigured: Boolean(env.RESEND_API_KEY),
          smtpConfigured: Boolean(env.SMTP_USER && env.SMTP_PASS),
          smtpHost: `${env.SMTP_HOST}:${env.SMTP_PORT}`,
          sentCount: mailService.getSentCount(),
        },
        security: {
          jwtAlgorithm: 'HS256',
          jwtExpiresInSeconds: env.JWT_EXPIRES_IN_SECONDS,
          rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
          rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
          authRateLimitMax: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
          webhookHmacEnabled: true,
          maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES,
        },
      };

      res.json({
        status,
        recentJobs: queueCacheManager.listJobs().slice(0, 8),
      });
    }
  );

  app.post(
    '/api/infra/queue/job',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      const start = Date.now();
      const queueName = (req.body?.queueName || 'audit-sync') as QueueJobRecord['queueName'];
      const jobName = sanitizeInput(req.body?.name || 'manual-maintenance-job', 80);

      const job = queueCacheManager.enqueueJob({
        queueName,
        name: jobName,
        payload: req.body?.payload || { triggeredBy: req.auth!.email },
      });

      dbRepo.appendAuditLog({
        actorId: req.auth!.sub,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: 'BULLMQ_JOB_ENQUEUED',
        category: 'queue',
        resource: `${env.BULLMQ_PREFIX}:${queueName}`,
        status: 'success',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: { jobId: job.id, jobName },
      });

      res.status(201).json({ job });
    }
  );

  app.post(
    '/api/infra/llm/execute',
    requireAuth,
    requireAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      const provider = (
        ['gemini', 'openrouter', 'llama'].includes(req.body?.provider)
          ? req.body.provider
          : 'gemini'
      ) as LLMProviderId;
      const prompt = sanitizeInput(req.body?.prompt || '', 1000);
      if (!prompt) {
        res.status(400).json({ error: 'Prompt is required' });
        return;
      }

      const result = await executeLlmPrompt({ provider, prompt });

      dbRepo.appendAuditLog({
        actorId: req.auth!.sub,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: `LLM_INFERENCE_${provider.toUpperCase()}`,
        category: 'llm',
        resource: `/api/infra/llm/execute`,
        status: 'success',
        ipAddress: getClientIp(req),
        latencyMs: result.latencyMs,
        metadata: {
          provider: result.provider,
          model: result.model,
          liveApiUsed: result.liveApiUsed,
        },
      });

      res.json({ result });
    }
  );

  app.post(
    '/api/infra/webhook/simulate',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      const start = Date.now();
      const eventType = sanitizeInput(req.body?.event || 'payment.succeeded', 80);
      const rawPayload = JSON.stringify({
        event: eventType,
        timestamp: new Date().toISOString(),
        actor: req.auth!.email,
      });
      const timestampSec = Math.floor(Date.now() / 1000);
      const signature = signWebhookPayload(rawPayload, env.WEBHOOK_SECRET, timestampSec);
      const verification = verifyWebhookSignature(
        rawPayload,
        signature,
        env.WEBHOOK_SECRET,
        timestampSec
      );

      // Also validate file upload guard as part of security check
      const fileGuardSample = validateFileUpload(
        {
          filename: 'invoice-signed.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 245000,
          magicBytesHex: '255044462d312e37',
        },
        env.MAX_UPLOAD_SIZE_BYTES
      );

      dbRepo.appendAuditLog({
        actorId: req.auth!.sub,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: 'WEBHOOK_HMAC_VERIFIED',
        category: 'webhook',
        resource: '/api/webhooks/ingest',
        status: verification.valid ? 'success' : 'error',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: {
          event: eventType,
          signaturePrefix: signature.slice(0, 15),
          fileGuardVerified: fileGuardSample.valid,
        },
      });

      res.json({
        verified: verification.valid,
        signature,
        timestampSec,
        fileGuardSample,
      });
    }
  );

  // Public Webhook receiver endpoint protected by HMAC-SHA256
  app.post('/api/webhooks/ingest', (req: Request, res: Response) => {
    const start = Date.now();
    const signature = String(req.headers['x-webhook-signature'] || '');
    const timestampHeader = Number(req.headers['x-webhook-timestamp'] || 0);
    const rawBody = JSON.stringify(req.body || {});

    const check = verifyWebhookSignature(rawBody, signature, env.WEBHOOK_SECRET, timestampHeader);
    if (!check.valid) {
      dbRepo.appendAuditLog({
        actorId: null,
        actorEmail: 'webhook-caller',
        actorRole: 'external',
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        category: 'webhook',
        resource: '/api/webhooks/ingest',
        status: 'error',
        ipAddress: getClientIp(req),
        latencyMs: Date.now() - start,
        metadata: { reason: check.reason || 'invalid' },
      });
      res.status(401).json({ error: check.reason });
      return;
    }

    res.json({ received: true });
  });

  // ==========================================================================
  // WORDPRESS SITES, LICENSING & PLUGIN ENDPOINTS
  // ==========================================================================
  
  // Public Endpoint: Plugin Verification from WordPress
  app.post('/api/wordpress/verify', (req: Request, res: Response) => {
    const { api_key, site_url, site_name, version } = req.body || {};

    if (!api_key) {
      res.status(400).json({ success: false, message: 'Chave de Licença (api_key) é obrigatória.' });
      return;
    }

    const site = dbRepo.getWordPressSiteByApiKey(api_key);
    if (!site) {
      dbRepo.appendAuditLog({
        actorId: null,
        actorEmail: 'wordpress-plugin',
        actorRole: 'external',
        action: 'WP_LICENSE_VALIDATION_FAILED',
        category: 'wordpress',
        resource: site_url || '/api/wordpress/verify',
        status: 'warning',
        ipAddress: getClientIp(req),
        latencyMs: 5,
        metadata: { attemptedApiKey: api_key.slice(0, 10) + '...', siteUrl: site_url },
      });

      res.status(401).json({ success: false, message: 'Chave de Licença não encontrada ou revogada.' });
      return;
    }

    // Atualiza status do site e URL informada se diferente
    const updates: Partial<WordPressSite> = {
      status: 'connected',
      lastSyncAt: new Date().toISOString(),
    };
    if (site_url && (!site.siteUrl || site.siteUrl.includes('exemplo'))) {
      updates.siteUrl = site_url;
    }
    if (site_name && !site.siteName) {
      updates.siteName = site_name;
    }
    dbRepo.updateWordPressSite(site.id, updates);

    dbRepo.appendWordPressLog({
      siteId: site.id,
      siteName: site.siteName,
      action: 'LICENSE_VERIFIED',
      status: 'success',
      message: `Plugin WordPress conectado com sucesso via ${site_url || site.siteUrl} (versão plugin: ${version || '1.0.0'})`,
      details: { version, ip: getClientIp(req) },
    });

    res.json({
      success: true,
      site_id: site.id,
      site_name: site.siteName,
      message: 'Licença ativa e site conectado com sucesso!',
    });
  });

  // Download Plugin ZIP with automatically injected APP_URL
  app.get('/api/wordpress/plugin/download', (req: Request, res: Response) => {
    const pluginDir = path.resolve(process.cwd(), 'wordpress-plugin', 'auto-post-wordpress-ai');
    res.attachment('auto-post-wordpress-ai.zip');
    res.setHeader('Content-Type', 'application/zip');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err: any) => {
      console.error('[Plugin Download Error]', err);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar arquivo ZIP do plugin.' });
    });

    archive.pipe(res);

    // Resolve APP_URL dynamically (APP_URL env, request headers, or Railway production host)
    const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
    const host = req.get('host') || '';
    const detectedHost = forwardedHost
      ? `${forwardedProto || 'https'}://${forwardedHost}`
      : (host ? `${req.protocol}://${host}` : null);

    const appUrl = (
      process.env.APP_URL ||
      env.APP_URL ||
      detectedHost ||
      'https://auto-post-wordpress-ai-production.up.railway.app'
    ).replace(/\/+$/, '');

    // Injetar a URL do painel dinamicamente no arquivo auto-post-wordpress-ai.php
    const mainPhpPath = path.join(pluginDir, 'auto-post-wordpress-ai.php');
    if (fs.existsSync(mainPhpPath)) {
      let phpContent = fs.readFileSync(mainPhpPath, 'utf8');
      phpContent = phpContent.replace(
        /define\('AUTO_POST_AI_DEFAULT_API_URL',\s*'[^']*'\);/,
        `define('AUTO_POST_AI_DEFAULT_API_URL', '${appUrl}');`
      );
      phpContent = phpContent.replace(/'http:\/\/localhost:3000'/g, `'${appUrl}'`);

      archive.append(phpContent, { name: 'auto-post-wordpress-ai/auto-post-wordpress-ai.php' });
    }

    // Incluir demais arquivos do diretório do plugin
    if (fs.existsSync(pluginDir)) {
      const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'auto-post-wordpress-ai.php') continue;
        const entryPath = path.join(pluginDir, entry.name);
        if (entry.isFile()) {
          archive.file(entryPath, { name: `auto-post-wordpress-ai/${entry.name}` });
        } else if (entry.isDirectory()) {
          archive.directory(entryPath, `auto-post-wordpress-ai/${entry.name}`);
        }
      }
    }

    archive.finalize();
  });

  // List user's WordPress Sites
  app.get('/api/wordpress/sites', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth?.role === UserRole.ADMIN ? undefined : req.auth?.sub;
    const sites = dbRepo.getWordPressSites(userId);
    res.json(sites);
  });

  // Create WordPress Site & Generate License Key
  app.post('/api/wordpress/sites', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const {
      siteName,
      siteUrl,
      defaultCategory,
      defaultStatus,
      autoPublish,
      sourceIds,
      categories,
      publishFrequencyMinutes,
      aiCustomInstructions,
      aiProvider,
      aiModel,
      aiTone,
    } = req.body || {};

    if (!siteName || !siteUrl) {
      res.status(400).json({ error: 'Nome do site e URL são obrigatórios.' });
      return;
    }

    const licenseKey = `APAI-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const newSite = dbRepo.createWordPressSite({
      userId: req.auth!.sub,
      siteName: sanitizeInput(siteName),
      siteUrl: sanitizeInput(siteUrl),
      apiKey: licenseKey,
      status: 'pending',
      lastSyncAt: null,
      autoPublish: Boolean(autoPublish),
      defaultStatus: defaultStatus === 'publish' ? 'publish' : 'draft',
      defaultCategory: defaultCategory ? sanitizeInput(defaultCategory) : 'Geral',
      sourceIds: Array.isArray(sourceIds) ? sourceIds : [],
      categories: Array.isArray(categories) ? categories : [],
      publishFrequencyMinutes: Number(publishFrequencyMinutes) || 60,
      aiCustomInstructions: typeof aiCustomInstructions === 'string' ? aiCustomInstructions.trim() : '',
      aiProvider: aiProvider || 'openrouter',
      aiModel: aiModel ? sanitizeInput(aiModel) : '',
      aiTone: aiTone ? sanitizeInput(aiTone) : 'jornalistico',
    });

    dbRepo.appendWordPressLog({
      siteId: newSite.id,
      siteName: newSite.siteName,
      action: 'SITE_CREATED',
      status: 'success',
      message: `Novo site cadastrado e chave de licença gerada (${licenseKey.slice(0, 9)}...)`,
    });

    res.status(201).json(newSite);
  });

  // Update WordPress Site
  app.put('/api/wordpress/sites/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const site = dbRepo.getWordPressSiteById(req.params.id);
    if (!site) {
      res.status(404).json({ error: 'Site não encontrado.' });
      return;
    }
    if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
      res.status(403).json({ error: 'Sem permissão para alterar este site.' });
      return;
    }

    const {
      siteName,
      siteUrl,
      defaultCategory,
      defaultStatus,
      autoPublish,
      sourceIds,
      categories,
      publishFrequencyMinutes,
      aiCustomInstructions,
      aiProvider,
      aiModel,
      aiTone,
      regenerateKey,
    } = req.body || {};

    const updates: Partial<WordPressSite> = {};
    if (siteName) updates.siteName = sanitizeInput(siteName);
    if (siteUrl) updates.siteUrl = sanitizeInput(siteUrl);
    if (defaultCategory !== undefined) updates.defaultCategory = defaultCategory ? sanitizeInput(defaultCategory) : 'Geral';
    if (defaultStatus !== undefined) updates.defaultStatus = defaultStatus === 'publish' ? 'publish' : 'draft';
    if (autoPublish !== undefined) updates.autoPublish = Boolean(autoPublish);
    if (sourceIds !== undefined) updates.sourceIds = Array.isArray(sourceIds) ? sourceIds : [];
    if (categories !== undefined) updates.categories = Array.isArray(categories) ? categories : [];
    if (publishFrequencyMinutes !== undefined) updates.publishFrequencyMinutes = Number(publishFrequencyMinutes) || 60;
    if (aiCustomInstructions !== undefined) updates.aiCustomInstructions = typeof aiCustomInstructions === 'string' ? aiCustomInstructions.trim() : '';
    if (aiProvider !== undefined) updates.aiProvider = aiProvider;
    if (aiModel !== undefined) updates.aiModel = aiModel ? sanitizeInput(aiModel) : '';
    if (aiTone !== undefined) updates.aiTone = aiTone ? sanitizeInput(aiTone) : 'jornalistico';

    if (regenerateKey) {
      updates.apiKey = `APAI-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    const updated = dbRepo.updateWordPressSite(req.params.id, updates);

    dbRepo.appendWordPressLog({
      siteId: site.id,
      siteName: updated?.siteName || site.siteName,
      action: 'SITE_CONFIG_UPDATED',
      status: 'success',
      message: `Configurações do site atualizadas (Fontes: ${updated?.sourceIds?.length || 0}, Frequência: ${updated?.publishFrequencyMinutes || 60}min)`,
    });

    res.json(updated);
  });

  // Delete WordPress Site
  app.delete('/api/wordpress/sites/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const site = dbRepo.getWordPressSiteById(req.params.id);
    if (!site) {
      res.status(404).json({ error: 'Site não encontrado.' });
      return;
    }
    if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
      res.status(403).json({ error: 'Sem permissão para remover este site.' });
      return;
    }

    dbRepo.deleteWordPressSite(req.params.id);
    res.json({ success: true, message: 'Site removido com sucesso.' });
  });

  // Test WordPress Site Connection
  app.post('/api/wordpress/sites/:id/test-connection', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await testWordPressConnection(req.params.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Test WordPress Site: Rewrite Latest Article with AI & Publish Immediately
  app.post('/api/wordpress/sites/:id/publish-latest-test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const site = dbRepo.getWordPressSiteById(req.params.id);
      if (!site) {
        res.status(404).json({ success: false, error: 'Site não encontrado.' });
        return;
      }
      if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
        res.status(403).json({ success: false, error: 'Sem permissão para este site.' });
        return;
      }

      // Buscar artigos capturados disponíveis
      const allowedSources = site.sourceIds && site.sourceIds.length > 0 ? site.sourceIds : null;
      const articles = dbRepo.getCapturedArticles({ limit: 1000 });

      if (!articles || articles.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Nenhum artigo capturado disponível no sistema. Vá até a aba "Portais & Scraping" e clique em "Minerar Agora" em uma das fontes antes de testar.',
        });
        return;
      }

      // Procurar o artigo mais recente das fontes vinculadas que ainda não foi postado neste site
      let candidate = articles.find((art) => {
        const matchesSource = !allowedSources || allowedSources.includes(art.sourceId);
        const alreadyPosted =
          dbRepo.isArticlePublishedToSite(art.id, site.id) ||
          (art.publishedSiteIds && art.publishedSiteIds.includes(site.id)) ||
          art.wpSiteId === site.id;
        return matchesSource && !alreadyPosted;
      });

      // Se todos já tiverem sido publicados, pega o mais recente das fontes vinculadas
      if (!candidate) {
        candidate = articles.find((art) => !allowedSources || allowedSources.includes(art.sourceId));
      }

      // Se ainda não achou (ex: fontes vinculadas não têm artigos), pega o mais recente global
      if (!candidate) {
        candidate = articles[0];
      }

      console.log(`[Test Post] Iniciando teste de publicação para o site "${site.siteName}" (${site.siteUrl}) usando a matéria "${candidate.originalTitle.slice(0, 45)}..."`);

      // Reescrita de IA personalizada para este site (utiliza as instruções, tom editorial e provedor ativo)
      const rewrittenArticle = await rewriteArticleWithAi(candidate.id, {
        targetSiteId: site.id,
        tone: (site.aiTone as any) || undefined,
      });

      // Sincroniza e publica no WordPress via plugin
      const syncResult = await syncArticleToWordPress(rewrittenArticle.id, site.id, {
        force: true, // Força a publicação no teste mesmo se já existia registro
        status: site.defaultStatus || 'publish',
        category: site.defaultCategory || 'Geral',
      });

      if (!syncResult.success) {
        res.status(500).json({
          success: false,
          error: syncResult.message || 'Falha ao sincronizar o artigo com o WordPress.',
        });
        return;
      }

      // Atualiza data da última publicação no site
      dbRepo.updateWordPressSite(site.id, { lastPublishedAt: new Date().toISOString() });

      // Registra no histórico do WordPress
      dbRepo.appendWordPressLog({
        siteId: site.id,
        siteName: site.siteName,
        action: 'TEST_PUBLISH_SUCCESS',
        status: 'success',
        message: `[Teste Imediato] Artigo "${rewrittenArticle.aiTitle || rewrittenArticle.originalTitle}" publicado com sucesso! (WP Post ID: ${syncResult.wpPostId || 'N/A'})`,
      });

      res.json({
        success: true,
        message: 'Artigo de teste criado e publicado no WordPress com sucesso!',
        title: rewrittenArticle.aiTitle || rewrittenArticle.originalTitle,
        originalTitle: candidate.originalTitle,
        sourceName: candidate.sourceName,
        wpPostId: syncResult.wpPostId,
        permalink: syncResult.permalink,
        imageUrl: rewrittenArticle.imageUrl,
        siteName: site.siteName,
      });
    } catch (err: any) {
      console.error('[Test Post Error]', err);
      res.status(500).json({ success: false, error: err.message || 'Erro inesperado ao gerar e publicar artigo de teste.' });
    }
  });

  // Obter Lista Completa de Artigos Gerados de um Portal (com Metadados de SEO, R2 e Estrutura JSON)
  app.get(
    '/api/wordpress/sites/:id/generated-articles',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const site = dbRepo.getWordPressSiteById(req.params.id);
        if (!site) {
          res.status(404).json({ success: false, error: 'Portal WordPress não encontrado.' });
          return;
        }
        if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
          res.status(403).json({ success: false, error: 'Acesso negado para este portal.' });
          return;
        }

        const r2Config = await getR2Config();
        const r2BaseUrl = r2Config?.publicUrl;
        const r2FeedUrl = r2BaseUrl ? `${r2BaseUrl}/sites/${site.id}/artigos.json` : null;

        const rawArticles = dbRepo.getPublishedArticlesForSite(site.id);

        const structuredArticles = rawArticles.map((it) =>
          buildGeneratedArticleStructure(site, it.article, it.publication, r2BaseUrl)
        );

        res.json({
          success: true,
          site: {
            id: site.id,
            siteName: site.siteName,
            siteUrl: site.siteUrl,
            publishedArticlesCount: structuredArticles.length,
          },
          r2FeedUrl,
          total: structuredArticles.length,
          articles: structuredArticles,
        });
      } catch (err: any) {
        console.error('[Generated Articles Error]', err);
        res.status(500).json({ success: false, error: err.message || 'Erro ao carregar artigos gerados.' });
      }
    }
  );

  // Sincronizar / Salvar Todos os Artigos Gerados deste Portal no Cloudflare R2
  app.post(
    '/api/wordpress/sites/:id/sync-r2-articles',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const site = dbRepo.getWordPressSiteById(req.params.id);
        if (!site) {
          res.status(404).json({ success: false, error: 'Portal WordPress não encontrado.' });
          return;
        }
        if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
          res.status(403).json({ success: false, error: 'Acesso negado para este portal.' });
          return;
        }

        const r2Config = await getR2Config();
        if (!r2Config) {
          res.status(400).json({
            success: false,
            error: 'Cloudflare R2 não configurado nas Configurações da plataforma.',
          });
          return;
        }

        const rawArticles = dbRepo.getPublishedArticlesForSite(site.id);
        if (rawArticles.length === 0) {
          res.status(400).json({
            success: false,
            error: 'Nenhum artigo foi gerado para este portal ainda.',
          });
          return;
        }

        let syncedCount = 0;
        for (const it of rawArticles) {
          try {
            await uploadSiteArticleJson(site, it.article, it.publication);
            syncedCount++;
          } catch (uploadErr: any) {
            console.warn(`[R2 Batch Sync] Falha ao enviar ${it.article.id}:`, uploadErr.message);
          }
        }

        const feedUrl = await uploadSiteArticlesFeedJson(site, rawArticles);

        res.json({
          success: true,
          synced: syncedCount,
          total: rawArticles.length,
          r2FeedUrl: feedUrl,
          message: `${syncedCount} matérias foram sincronizadas e salvas com sucesso em JSON no Cloudflare R2!`,
        });
      } catch (err: any) {
        console.error('[R2 Batch Sync Error]', err);
        res.status(500).json({ success: false, error: err.message || 'Erro ao sincronizar com R2.' });
      }
    }
  );

  // Reparar Imagem em Destaque de um Artigo Específico no WordPress
  app.post(
    '/api/wordpress/sites/:id/repair-article-image/:articleId',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const site = dbRepo.getWordPressSiteById(req.params.id);
        if (!site) {
          res.status(404).json({ success: false, error: 'Portal WordPress não encontrado.' });
          return;
        }
        if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
          res.status(403).json({ success: false, error: 'Acesso negado para este portal.' });
          return;
        }

        const result = await verifyAndRepairPostFeaturedImage(site.id, req.params.articleId);
        res.json(result);
      } catch (err: any) {
        console.error('[Repair Article Image Error]', err);
        res.status(500).json({ success: false, error: err.message || 'Erro ao reparar imagem do artigo.' });
      }
    }
  );

  // Varredura e Reparo em Lote de Todas as Matérias Sem Foto no WordPress
  app.post(
    '/api/wordpress/sites/:id/repair-all-missing-images',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const site = dbRepo.getWordPressSiteById(req.params.id);
        if (!site) {
          res.status(404).json({ success: false, error: 'Portal WordPress não encontrado.' });
          return;
        }
        if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
          res.status(403).json({ success: false, error: 'Acesso negado para este portal.' });
          return;
        }

        const report = await repairAllMissingImagesForSite(site.id);
        res.json({
          success: true,
          ...report,
          message: `Varredura concluída: ${report.repaired} matérias corrigidas com imagem no WordPress!`,
        });
      } catch (err: any) {
        console.error('[Repair Missing Images Error]', err);
        res.status(500).json({ success: false, error: err.message || 'Erro ao varrer e reparar imagens.' });
      }
    }
  );

  // Consultar Logs e Diagnóstico em Tempo Real do Plugin no WordPress do Cliente (Sob Demanda)
  app.get(
    '/api/wordpress/sites/:id/remote-logs',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const site = dbRepo.getWordPressSiteById(req.params.id);
        if (!site) {
          res.status(404).json({ success: false, error: 'Site não encontrado.' });
          return;
        }
        if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
          res.status(403).json({ success: false, error: 'Acesso negado para este site.' });
          return;
        }

        const limit = Math.min(200, Number(req.query.limit) || 100);
        const result = await fetchRemoteWordPressLogs(site.id, limit);
        res.json(result);
      } catch (err: any) {
        console.error('[Remote Logs Error]', err);
        res.status(500).json({ success: false, error: err.message || 'Erro ao consultar logs remotos.' });
      }
    }
  );

  // Limpar Logs Remotos no Plugin do WordPress do Cliente
  app.delete(
    '/api/wordpress/sites/:id/remote-logs',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const site = dbRepo.getWordPressSiteById(req.params.id);
        if (!site) {
          res.status(404).json({ success: false, error: 'Site não encontrado.' });
          return;
        }
        if (req.auth?.role !== UserRole.ADMIN && site.userId !== req.auth?.sub) {
          res.status(403).json({ success: false, error: 'Acesso negado para este site.' });
          return;
        }

        const result = await clearRemoteWordPressLogs(site.id);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message || 'Erro ao limpar logs remotos.' });
      }
    }
  );

  // Proxy Aberto e Resiliente de Imagem (Bypass definitivo de bloqueios de CDN externa para o WordPress)
  app.get('/api/media-proxy', async (req: Request, res: Response) => {
    try {
      const rawUrl = ((req.query.url as string) || '').trim();
      if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
        res.status(400).send('URL inválida');
        return;
      }

      const imgRes = await fetch(rawUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!imgRes.ok) {
        res.status(imgRes.status).send('Erro ao obter imagem de origem');
        return;
      }

      const ct = imgRes.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800');
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      res.send(buffer);
    } catch (err: any) {
      res.status(500).send(`Falha no proxy de mídia: ${err.message}`);
    }
  });

  // WordPress Activity Logs
  app.get('/api/wordpress/logs', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const siteId = req.query.siteId as string | undefined;
    const limit = Math.min(1000, Number(req.query.limit) || 500);
    const logs = dbRepo.getWordPressLogs(siteId, limit);
    res.json(logs);
  });

  // ==========================================================================
  // NEWS SCRAPER & ARTICLES ENDPOINTS
  // ==========================================================================

  // List News Sources
  app.get('/api/scraper/sources', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth?.role === UserRole.ADMIN ? undefined : req.auth?.sub;
    const sources = dbRepo.getNewsSources(userId);
    res.json(sources);
  });

  // Create News Source
  app.post('/api/scraper/sources', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { name, url, type, category, targetSiteId, autoRewrite, autoPublish, intervalMinutes } = req.body || {};

    if (!name || !url) {
      res.status(400).json({ error: 'Nome e URL da fonte são obrigatórios.' });
      return;
    }

    const newSource = dbRepo.createNewsSource({
      userId: req.auth!.sub,
      name: sanitizeInput(name),
      url: sanitizeInput(url),
      type: type || 'rss',
      category: category ? sanitizeInput(category) : 'Geral',
      targetSiteId: targetSiteId || null,
      active: true,
      autoRewrite: Boolean(autoRewrite),
      autoPublish: Boolean(autoPublish),
      intervalMinutes: Number(intervalMinutes) > 0 ? Number(intervalMinutes) : 15,
      lastScrapedAt: null,
      articlesCount: 0,
    });

    res.status(201).json(newSource);
  });

  // Update News Source
  app.put('/api/scraper/sources/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const source = dbRepo.getNewsSourceById(req.params.id);
    if (!source) {
      res.status(404).json({ error: 'Fonte não encontrada.' });
      return;
    }
    if (req.auth?.role !== UserRole.ADMIN && source.userId !== req.auth?.sub) {
      res.status(403).json({ error: 'Sem permissão para alterar esta fonte.' });
      return;
    }

    const updated = dbRepo.updateNewsSource(req.params.id, req.body);
    res.json(updated);
  });

  // Delete News Source
  app.delete('/api/scraper/sources/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const source = dbRepo.getNewsSourceById(req.params.id);
    if (!source) {
      res.status(404).json({ error: 'Fonte não encontrada.' });
      return;
    }
    if (req.auth?.role !== UserRole.ADMIN && source.userId !== req.auth?.sub) {
      res.status(403).json({ error: 'Sem permissão para remover esta fonte.' });
      return;
    }

    dbRepo.deleteNewsSource(req.params.id);
    res.json({ success: true, message: 'Fonte removida com sucesso.' });
  });

  // Trigger Scrape Run for Source
  app.post('/api/scraper/sources/:id/scrape', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await scrapeSource(req.params.id);
      res.json({
        success: true,
        message: `Scraping finalizado. ${result.newCaptured} novas notícias capturadas (${result.totalFound} encontradas no feed).`,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // List Captured Articles
  app.get('/api/scraper/articles', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const sourceId = req.query.sourceId as string | undefined;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit !== undefined ? Math.min(Number(req.query.limit) || 1000, 5000) : 1000;

    const articles = dbRepo.getCapturedArticles({ sourceId, status, search, limit });
    res.json(articles);
  });

  // Get Captured Article by ID
  app.get('/api/scraper/articles/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const article = dbRepo.getCapturedArticleById(req.params.id);
    if (!article) {
      res.status(404).json({ error: 'Artigo não encontrado.' });
      return;
    }
    res.json(article);
  });

  // Rewrite Article with AI
  app.post('/api/scraper/articles/:id/rewrite', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updated = await rewriteArticleWithAi(req.params.id, req.body);
      res.json({
        success: true,
        message: 'Artigo reescrito com sucesso pela IA!',
        article: updated,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Publish Article to WordPress Site
  app.post('/api/scraper/articles/:id/publish', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const { siteId, status, category, force } = req.body || {};

    if (!siteId) {
      res.status(400).json({ error: 'ID do site WordPress é obrigatório.' });
      return;
    }

    try {
      const result = await syncArticleToWordPress(req.params.id, siteId, { status, category, force });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Estrutura de Jobs em Segundo Plano para Reescrita e Publicação (Zero Timeout no Proxy)
  interface RewritePublishJob {
    id: string;
    articleId: string;
    siteIds: string[];
    status: 'queued' | 'running' | 'completed' | 'failed';
    progress: number;
    currentStep: string;
    startedAt: string;
    completedAt?: string;
    results: Array<{
      siteId: string;
      siteName: string;
      success: boolean;
      wpPostId?: number;
      permalink?: string;
      message?: string;
      error?: string;
    }>;
    error?: string;
  }

  const rewriteJobs = new Map<string, RewritePublishJob>();

  // Limpeza automática periódica de jobs antigos (> 2 horas)
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of rewriteJobs.entries()) {
      if (now - new Date(job.startedAt).getTime() > 2 * 60 * 60 * 1000) {
        rewriteJobs.delete(id);
      }
    }
  }, 15 * 60 * 1000);

  // Reescrever com Diretrizes e Publicar em Múltiplos Sites Selecionados (com suporte a Job Assíncrono contra timeouts)
  app.post(
    '/api/scraper/articles/:id/rewrite-and-publish-to-sites',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const articleId = req.params.id;
      const { siteIds, force } = req.body || {};

      if (!Array.isArray(siteIds) || siteIds.length === 0) {
        res.status(400).json({ success: false, error: 'Selecione ao menos um site WordPress de destino.' });
        return;
      }

      const article = dbRepo.getCapturedArticleById(articleId);
      if (!article) {
        res.status(404).json({ success: false, error: 'Artigo não encontrado no sistema.' });
        return;
      }

      // Se o cliente solicitou modo síncrono (ex: scripts ou testes locais)
      if (req.query.sync === 'true') {
        const results: Array<{
          siteId: string;
          siteName: string;
          success: boolean;
          wpPostId?: number;
          permalink?: string;
          message?: string;
          error?: string;
        }> = [];

        for (const siteId of siteIds) {
          const site = dbRepo.getWordPressSiteById(siteId);
          if (!site) {
            results.push({ siteId, siteName: 'Desconhecido', success: false, error: 'Site não encontrado.' });
            continue;
          }

          try {
            console.log(
              `[Manual Re-write & Publish] Reescrevendo artigo "${article.originalTitle.slice(0, 40)}" para o portal "${site.siteName}" (${site.siteUrl})...`
            );

            const rewrittenArticle = await rewriteArticleWithAi(articleId, {
              targetSiteId: site.id,
              tone: (site.aiTone as any) || undefined,
            });

            const syncResult = await syncArticleToWordPress(rewrittenArticle.id, site.id, {
              force: force !== undefined ? Boolean(force) : true,
              status: site.defaultStatus || 'publish',
              category: site.defaultCategory || 'Geral',
            });

            if (syncResult.success) {
              dbRepo.updateWordPressSite(site.id, { lastPublishedAt: new Date().toISOString() });
              dbRepo.appendWordPressLog({
                siteId: site.id,
                siteName: site.siteName,
                action: 'MANUAL_PUBLISH_SUCCESS',
                status: 'success',
                message: `Artigo "${rewrittenArticle.aiTitle || rewrittenArticle.originalTitle}" reescrito com diretrizes de "${site.siteName}" e publicado com sucesso! (ID WP: ${syncResult.wpPostId || 'N/A'})`,
                details: { wpPostId: syncResult.wpPostId, permalink: syncResult.permalink, articleId: article.id },
              });

              results.push({
                siteId: site.id,
                siteName: site.siteName,
                success: true,
                wpPostId: syncResult.wpPostId,
                permalink: syncResult.permalink,
                message: `Publicado com sucesso no portal "${site.siteName}"! (ID WP: ${syncResult.wpPostId || ''})`,
              });
            } else {
              results.push({
                siteId: site.id,
                siteName: site.siteName,
                success: false,
                error: syncResult.message || 'Falha ao sincronizar com WordPress.',
              });
            }
          } catch (err: any) {
            console.error(`[Manual Re-write & Publish Error] Erro ao enviar para "${site.siteName}":`, err.message);
            results.push({
              siteId: site.id,
              siteName: site.siteName,
              success: false,
              error: err.message || 'Erro inesperado durante a reescrita ou publicação.',
            });
          }
        }

        const overallSuccess = results.some((r) => r.success);
        res.json({
          success: overallSuccess,
          results,
          article: dbRepo.getCapturedArticleById(articleId),
        });
        return;
      }

      // Modo Padrão: Despacho de Job Assíncrono com resposta imediata em <50ms (Elimina 100% dos erros 504/upstream do Railway/Cloudflare)
      const jobId = `rwjob_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const job: RewritePublishJob = {
        id: jobId,
        articleId,
        siteIds,
        status: 'queued',
        progress: 10,
        currentStep: 'Iniciando reescrita autoral via IA...',
        startedAt: new Date().toISOString(),
        results: [],
      };
      rewriteJobs.set(jobId, job);

      // Resposta imediata para liberar a conexão HTTP
      res.json({
        success: true,
        jobId,
        status: 'queued',
        message: 'Tarefa de reescrita iniciada em segundo plano.',
      });

      // Executa o processamento em background
      (async () => {
        job.status = 'running';
        const total = siteIds.length;
        let count = 0;

        for (const siteId of siteIds) {
          const site = dbRepo.getWordPressSiteById(siteId);
          if (!site) {
            job.results.push({ siteId, siteName: 'Desconhecido', success: false, error: 'Site não encontrado.' });
            continue;
          }

          try {
            const baseProgress = Math.round((count / total) * 100);
            job.progress = Math.min(95, baseProgress + 15);
            job.currentStep = `Reescrevendo matéria para o portal "${site.siteName}" via Cluster Antigravity...`;

            console.log(
              `[Async Rewrite Job ${jobId}] Reescrevendo matéria "${article.originalTitle.slice(0, 35)}..." para "${site.siteName}"...`
            );

            // 1. Reescrita especializada com diretrizes do portal
            const rewrittenArticle = await rewriteArticleWithAi(articleId, {
              targetSiteId: site.id,
              tone: (site.aiTone as any) || undefined,
            });

            job.progress = Math.min(95, baseProgress + 45);
            job.currentStep = `Publicando matéria no WordPress do portal "${site.siteName}"...`;

            // 2. Sincronização e publicação no WordPress via REST API do plugin
            const syncResult = await syncArticleToWordPress(rewrittenArticle.id, site.id, {
              force: force !== undefined ? Boolean(force) : true,
              status: site.defaultStatus || 'publish',
              category: site.defaultCategory || 'Geral',
            });

            if (syncResult.success) {
              dbRepo.updateWordPressSite(site.id, { lastPublishedAt: new Date().toISOString() });
              dbRepo.appendWordPressLog({
                siteId: site.id,
                siteName: site.siteName,
                action: 'MANUAL_PUBLISH_SUCCESS',
                status: 'success',
                message: `Artigo "${rewrittenArticle.aiTitle || rewrittenArticle.originalTitle}" reescrito com diretrizes de "${site.siteName}" e publicado com sucesso! (ID WP: ${syncResult.wpPostId || 'N/A'})`,
                details: { wpPostId: syncResult.wpPostId, permalink: syncResult.permalink, articleId: article.id },
              });

              job.results.push({
                siteId: site.id,
                siteName: site.siteName,
                success: true,
                wpPostId: syncResult.wpPostId,
                permalink: syncResult.permalink,
                message: `Publicado com sucesso no portal "${site.siteName}"! (ID WP: ${syncResult.wpPostId || ''})`,
              });
            } else {
              job.results.push({
                siteId: site.id,
                siteName: site.siteName,
                success: false,
                error: syncResult.message || 'Falha ao sincronizar com WordPress.',
              });
            }
          } catch (err: any) {
            console.error(`[Async Rewrite Job Error] Erro ao enviar para "${site.siteName}":`, err.message);
            job.results.push({
              siteId: site.id,
              siteName: site.siteName,
              success: false,
              error: err.message || 'Erro inesperado durante a reescrita ou publicação.',
            });
          }
          count++;
        }

        job.status = 'completed';
        job.progress = 100;
        job.completedAt = new Date().toISOString();
        job.currentStep = 'Processo finalizado com sucesso!';
      })().catch((bgErr: any) => {
        console.error(`[Async Rewrite Job Fatal] Erro geral:`, bgErr);
        job.status = 'failed';
        job.error = bgErr.message || 'Falha na execução do processo em segundo plano.';
      });
    }
  );

  // Consultar Status em Tempo Real do Job de Reescrita (Polling do Frontend)
  app.get('/api/scraper/rewrite-jobs/:jobId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const job = rewriteJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job de reescrita não encontrado.' });
      return;
    }
    res.json({ success: true, job });
  });

  // Delete Captured Article
  app.delete('/api/scraper/articles/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const deleted = dbRepo.deleteCapturedArticle(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Artigo não encontrado.' });
      return;
    }
    res.json({ success: true, message: 'Artigo removido.' });
  });

  // Cloudflare R2 Sync Endpoints
  app.post('/api/scraper/articles/:id/sync-r2', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const url = await syncArticleToR2(req.params.id);
      res.json({ success: true, url, message: 'Artigo sincronizado com Cloudflare R2 com sucesso!' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/scraper/sync-r2-all', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await syncAllArticlesToR2();
      res.json({
        success: true,
        message: `${result.synced} de ${result.total} artigos sincronizados no Cloudflare R2. Feeds atualizados.`,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/scraper/sync-r2-feeds', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await syncFeedsToR2();
      res.json({ success: true, message: 'Feeds particionados por fuso de Recife atualizados no R2!', feeds: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // 10. SYSTEM SETTINGS & AI ENGINE CONFIGURATION
  // ==========================================================================
  app.get('/api/settings', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const raw = dbRepo.getSystemSettings();
    res.json({
      ...raw,
      hasOpenRouterKey: Boolean(raw.openRouterApiKey),
      hasGeminiKey: Boolean(raw.geminiApiKey),
      hasLlamaKey: Boolean(raw.llamaApiKey),
      hasMcpAgyToken: Boolean(raw.mcpAgyToken),
      hasR2Configured: Boolean(raw.r2AccountId && raw.r2AccessKeyId && raw.r2SecretAccessKey),
    });
  });

  app.put('/api/settings', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const current = dbRepo.getSystemSettings();
    const updates = req.body || {};

    if (updates.openRouterApiKey === '' && current.openRouterApiKey) {
      delete updates.openRouterApiKey;
    }
    if (updates.geminiApiKey === '' && current.geminiApiKey) {
      delete updates.geminiApiKey;
    }
    if (updates.llamaApiKey === '' && current.llamaApiKey) {
      delete updates.llamaApiKey;
    }
    if (updates.mcpAgyToken === '' && current.mcpAgyToken) {
      delete updates.mcpAgyToken;
    }
    if (updates.r2SecretAccessKey === '' && current.r2SecretAccessKey) {
      delete updates.r2SecretAccessKey;
    }

    const updated = dbRepo.updateSystemSettings(updates);

    dbRepo.appendAuditLog({
      actorId: req.auth!.sub,
      actorEmail: req.auth!.email,
      actorRole: req.auth!.role,
      action: 'SYSTEM_SETTINGS_UPDATED',
      category: 'security',
      resource: '/api/settings',
      status: 'success',
      ipAddress: getClientIp(req),
      latencyMs: 12,
      metadata: { provider: updated.aiProvider, platformName: updated.platformName },
    });

    res.json({
      success: true,
      message: 'Configurações atualizadas com sucesso.',
      settings: updated,
    });
  });

  app.post('/api/settings/r2/test', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl } = req.body || {};
    try {
      const result = await testR2Connection({
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
        publicUrl,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/settings/ai/test', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { provider, apiKey, model, baseUrl, mcpUrl, mcpToken } = req.body || {};

    try {
      const result = await executeLlmPrompt({
        provider,
        apiKey: (apiKey || mcpToken)?.trim() || undefined,
        model: model?.trim() || undefined,
        baseUrl: (baseUrl || mcpUrl)?.trim() || undefined,
        prompt: 'Responda estritamente esta frase: "OK - Motor de IA conectado com sucesso."',
      });

      res.json({
        success: true,
        result,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Falha ao testar conexão com o motor de IA.',
      });
    }
  });

  // ==========================================================================
  // 9. VITE MIDDLEWARE / STATIC ASSETS
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Auto Post WordPress AI platform listening on http://0.0.0.0:${env.PORT}`);

    // Background Autonomous Scraping Loop (Cadência por frequência individual de cada fonte)
    console.log(`[Collector Background] Agendador automático por frequência ativado (verificação a cada 60s).`);

    setInterval(async () => {
      try {
        const sources = dbRepo.getNewsSources().filter((s) => s.active);
        if (sources.length === 0) return;
        const now = Date.now();

        for (const s of sources) {
          const freqMs = (s.intervalMinutes || 15) * 60 * 1000;
          const lastTime = s.lastScrapedAt ? new Date(s.lastScrapedAt).getTime() : 0;

          if (now - lastTime >= freqMs) {
            console.log(`[Collector Background] Coleta agendada iniciada para "${s.name}" (a cada ${s.intervalMinutes || 15} min)...`);
            try {
              await scrapeSource(s.id);
            } catch (err: any) {
              console.warn(`[Collector Background] Erro ao coletar fonte "${s.name}" (${s.id}):`, err.message);
            }
          }
        }

        // 2. Publicação agendada e autônoma para Sites WordPress
        const wpSites = dbRepo.getWordPressSites().filter((site) => site.autoPublish && site.status === 'connected');
        for (const site of wpSites) {
          const siteFreqMs = (site.publishFrequencyMinutes || 60) * 60 * 1000;
          const lastPubTime = site.lastPublishedAt ? new Date(site.lastPublishedAt).getTime() : 0;

          if (now - lastPubTime >= siteFreqMs) {
            const allowedSources = site.sourceIds && site.sourceIds.length > 0 ? site.sourceIds : null;
            const articles = dbRepo.getCapturedArticles({ limit: 500 });

            // Encontrar o artigo mais recente elegível que ainda não foi postado neste site (Escudo Anti-Duplicação)
            const candidate = articles.find((art) => {
              const matchesSource = !allowedSources || allowedSources.includes(art.sourceId);
              const alreadyPosted =
                dbRepo.isArticlePublishedToSite(art.id, site.id) ||
                (art.publishedSiteIds && art.publishedSiteIds.includes(site.id)) ||
                art.wpSiteId === site.id;
              return matchesSource && !alreadyPosted;
            });

            if (candidate) {
              console.log(`[Auto-Publisher] Publicação automática agendada para site "${site.siteName}": "${candidate.originalTitle.slice(0, 35)}..."`);
              try {
                let readyArticle = candidate;
                if (!candidate.aiContent) {
                  readyArticle = await rewriteArticleWithAi(candidate.id, {
                    targetSiteId: site.id,
                    tone: site.aiTone as any,
                  });
                }
                await syncArticleToWordPress(readyArticle.id, site.id);
                dbRepo.updateWordPressSite(site.id, { lastPublishedAt: new Date().toISOString() });
              } catch (pubErr: any) {
                console.warn(`[Auto-Publisher] Erro ao sincronizar artigo no site "${site.siteName}":`, pubErr.message);
              }
            }
          }
        }
      } catch (cycleErr: any) {
        console.error('[Collector Background] Erro no ciclo de coleta:', cycleErr.message);
      }
    }, 60 * 1000);
  });
}

startServer();
