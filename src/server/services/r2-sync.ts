import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { dbRepo } from '../db/repository';
import { CapturedArticle } from '../../shared/types';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export async function getR2Config(): Promise<R2Config | null> {
  const settings = dbRepo.getSystemSettings();

  const accountId = settings.r2AccountId || process.env.R2_ACCOUNT_ID || '4830cafc5dff5d7c50b8623b89b9b8c9';
  const accessKeyId = settings.r2AccessKeyId || process.env.R2_ACCESS_KEY_ID || 'f60e9da5ad3f0eeabab24de5dc987edf';
  const secretAccessKey = settings.r2SecretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '98d4417c42008d3bfc726ddab4a32d46d2612f164cc5b14e82acca5401a598b0';
  const bucketName = settings.r2BucketName || process.env.R2_BUCKET_NAME || 'cdn-imagens';
  let rawPublicUrl = settings.r2PublicUrl || process.env.R2_PUBLIC_URL || 'https://ssl-cdn-cloudflare.adsensecustomsearchads.com.br';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  const publicUrl = rawPublicUrl.replace(/\/+$/, '');

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
  };
}

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * Retorna metadados de data/hora no fuso oficial de Recife/Brasil (UTC-3)
 */
export function getRecifeDateInfo(dateObj = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Recife',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(dateObj).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hourNum = parseInt(parts.hour || '0', 10) || 0;
  const slotStart = Math.floor(hourNum / 6) * 6;
  const slotEnd = slotStart + 6;
  const slotStr = `${String(slotStart).padStart(2, '0')}h-${String(slotEnd).padStart(2, '0')}h`;

  return {
    date: dateStr,
    hour: hourNum,
    slot: slotStr,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    recifeIso: `${dateStr} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/**
 * Salva o artigo completo em formato JSON no Cloudflare R2
 */
export async function uploadArticleJson(article: CapturedArticle): Promise<string | null> {
  const config = await getR2Config();
  if (!config) {
    console.warn('[R2 Sync] Credenciais Cloudflare R2 não configuradas.');
    return null;
  }

  const key = `artigos/${article.id}.json`;
  const publicUrl = `${config.publicUrl}/${key}`;

  const articlePayload = {
    ...article,
    r2_json_url: publicUrl,
    r2_synced_at: new Date().toISOString(),
  };

  const body = JSON.stringify(articlePayload, null, 2);
  const client = createR2Client(config);

  try {
    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: Buffer.from(body, 'utf-8'),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'public, max-age=86400, s-maxage=86400',
    });

    await client.send(command);
    console.log(`[R2 Sync] Artigo salvo no R2 com sucesso: ${publicUrl}`);
    return publicUrl;
  } catch (err: any) {
    console.error(`[R2 Sync Error] Falha ao enviar artigo ${article.id} para R2:`, err.message);
    return null;
  }
}

/**
 * Atualiza os feeds agregados (recentes, fontes, datas, categorias, manifesto) no Cloudflare R2
 */
export async function uploadFeedJson(articles: CapturedArticle[] = []): Promise<string | null> {
  const config = await getR2Config();
  if (!config) return null;

  const now = new Date();
  const recifeNow = getRecifeDateInfo(now);
  const client = createR2Client(config);

  const formattedItems = articles.map((a) => {
    let itemDate = recifeNow.date;
    let itemSlot = recifeNow.slot;
    if (a.publishedAt) {
      const match = a.publishedAt.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}):/);
      if (match) {
        itemDate = match[1];
        const h = parseInt(match[2], 10) || 0;
        const sStart = Math.floor(h / 6) * 6;
        itemSlot = `${String(sStart).padStart(2, '0')}h-${String(sStart + 6).padStart(2, '0')}h`;
      }
    }

    return {
      id: a.id,
      source_id: a.sourceId,
      source_name: a.sourceName,
      title: a.originalTitle,
      subtitle: a.subtitle || a.originalExcerpt || '',
      author: a.author || 'Redação',
      published_at: a.publishedAt,
      captured_at: a.createdAt,
      recife_date: itemDate,
      recife_slot: itemSlot,
      url: a.originalUrl,
      featured_image: a.mediaData?.featuredImage || (a.imageUrl ? { url: a.imageUrl, alt: a.originalTitle } : null),
      has_video: Boolean(a.mediaData?.videos && a.mediaData.videos.length > 0),
      videos_count: a.mediaData?.videos ? a.mediaData.videos.length : 0,
      r2_json_url: a.r2JsonUrl || `${config.publicUrl}/artigos/${a.id}.json`,
      ai_title: a.aiTitle,
      ai_excerpt: a.aiExcerpt,
      status: a.status,
      wp_permalink: a.wpPermalink,
    };
  });

  const uploadJson = async (key: string, payload: unknown, maxAge = 60) => {
    return client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
        ContentType: 'application/json; charset=utf-8',
        CacheControl: `public, max-age=${maxAge}, s-maxage=${maxAge * 2}`,
      })
    );
  };

  try {
    // 1. Feed geral recente (últimos 100 itens)
    const feedSummary = {
      timezone: 'America/Recife',
      recife_now: recifeNow.recifeIso,
      updated_at: now.toISOString(),
      total_items: formattedItems.length,
      cdn_base_url: config.publicUrl,
      items: formattedItems.slice(0, 100),
    };
    await uploadJson('feed/recentes.json', feedSummary, 60);

    // 2. Feeds por Fonte
    const bySource: Record<string, typeof formattedItems> = {};
    for (const it of formattedItems) {
      const sId = it.source_id || 'geral';
      if (!bySource[sId]) bySource[sId] = [];
      bySource[sId].push(it);
    }

    const availableFeeds: Record<string, any> = {
      recentes: `${config.publicUrl}/feed/recentes.json`,
      fontes: {},
      datas: {},
    };

    for (const [sId, items] of Object.entries(bySource)) {
      const sourceName = items[0]?.source_name || sId;
      const sourcePayload = {
        timezone: 'America/Recife',
        recife_now: recifeNow.recifeIso,
        source_id: sId,
        source_name: sourceName,
        updated_at: now.toISOString(),
        total_items: items.length,
        items,
      };
      await uploadJson(`feed/fontes/${sId}.json`, sourcePayload, 60);
      availableFeeds.fontes[sId] = `${config.publicUrl}/feed/fontes/${sId}.json`;
    }

    // 3. Feeds Consolidados por Dia
    const byDate: Record<string, typeof formattedItems> = {};
    for (const it of formattedItems) {
      const dt = it.recife_date || recifeNow.date;
      if (!byDate[dt]) byDate[dt] = [];
      byDate[dt].push(it);
    }

    for (const [dt, dayItems] of Object.entries(byDate)) {
      const daySummary = {
        timezone: 'America/Recife',
        date: dt,
        updated_at: now.toISOString(),
        total_items: dayItems.length,
        items: dayItems,
      };
      await uploadJson(`feed/datas/${dt}.json`, daySummary, 300);
      availableFeeds.datas[dt] = `${config.publicUrl}/feed/datas/${dt}.json`;
    }

    // 4. Índice / Manifesto de Feeds
    const manifestPayload = {
      description: 'Índice de Feeds Públicos Cloudflare R2 — Auto Post WordPress AI',
      timezone: 'America/Recife (UTC-3)',
      recife_now: recifeNow.recifeIso,
      updated_at: now.toISOString(),
      current_date: recifeNow.date,
      feeds: availableFeeds,
    };
    await uploadJson('feed/index.json', manifestPayload, 60);

    const feedUrl = `${config.publicUrl}/feed/recentes.json`;
    console.log(`[R2 Sync] Feeds públicos sincronizados no R2! Índice: ${config.publicUrl}/feed/index.json`);
    return feedUrl;
  } catch (err: any) {
    console.error('[R2 Sync Error] Falha ao atualizar feeds no R2:', err.message);
    return null;
  }
}

/**
 * Valida a conexão com o bucket Cloudflare R2
 */
export async function testR2Connection(customConfig?: Partial<R2Config>): Promise<{
  success: boolean;
  message?: string;
  latencyMs?: number;
  publicUrl?: string;
  error?: string;
}> {
  const start = Date.now();
  const config = customConfig && customConfig.accountId
    ? {
        accountId: customConfig.accountId,
        accessKeyId: customConfig.accessKeyId || '',
        secretAccessKey: customConfig.secretAccessKey || '',
        bucketName: customConfig.bucketName || 'cdn-imagens',
        publicUrl: (customConfig.publicUrl || 'https://ssl-cdn-cloudflare.adsensecustomsearchads.com.br').replace(/\/+$/, ''),
      }
    : await getR2Config();

  if (!config || !config.accountId || !config.accessKeyId || !config.secretAccessKey) {
    return {
      success: false,
      error: 'Credenciais Cloudflare R2 incompletas (Account ID, Access Key ID, Secret Access Key ou Bucket Name não preenchidos).',
    };
  }

  const client = createR2Client(config);
  const testKey = `_health_check_${Date.now()}.json`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: testKey,
        Body: Buffer.from(JSON.stringify({ check: 'ok', timestamp: new Date().toISOString() }), 'utf-8'),
        ContentType: 'application/json',
      })
    );

    const latencyMs = Date.now() - start;
    const testPublicUrl = `${config.publicUrl}/${testKey}`;

    return {
      success: true,
      message: `Conexão Cloudflare R2 validada com sucesso no bucket "${config.bucketName}" (${latencyMs}ms)`,
      latencyMs,
      publicUrl: testPublicUrl,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Erro ao conectar com Cloudflare R2: ${err.message}`,
    };
  }
}
