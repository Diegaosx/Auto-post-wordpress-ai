import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { dbRepo } from '../db/repository';
import { CapturedArticle, WordPressSite } from '../../shared/types';
import { sanitizeArticleHtmlForPublish } from './article-cleaner';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export async function getR2Config(): Promise<R2Config | null> {
  const settings = dbRepo.getSystemSettings();

  const accountId = process.env.R2_ACCOUNT_ID || settings.r2AccountId || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || settings.r2AccessKeyId || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || settings.r2SecretAccessKey || '';
  const bucketName = process.env.R2_BUCKET_NAME || settings.r2BucketName || '';
  const rawPublicUrl = process.env.R2_PUBLIC_URL || settings.r2PublicUrl || '';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.warn('[R2 Sync] Credenciais Cloudflare R2 ausentes nas variáveis de ambiente (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).');
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
 * Faz upload de um buffer binário de imagem para o Cloudflare R2
 * Retorna a URL pública na CDN aberta sem bloqueios de firewall ou hotlinking
 */
export async function uploadImageBufferToR2(
  imageBuffer: Buffer,
  filenameKey: string,
  contentType: string = 'image/jpeg'
): Promise<string | null> {
  const config = await getR2Config();
  if (!config) return null;

  const key = `midias/${filenameKey}`;
  const publicUrl = `${config.publicUrl}/${key}`;
  const client = createR2Client(config);

  try {
    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    });
    await client.send(command);
    console.log(`[R2 Image Upload] Imagem salva com sucesso no R2: ${publicUrl}`);
    return publicUrl;
  } catch (err: any) {
    console.error(`[R2 Image Upload Error] Falha ao enviar imagem ${key} para R2:`, err.message);
    return null;
  }
}

/**
 * Garante que a imagem do artigo esteja espelhada e acessível no Cloudflare R2
 * Permite que qualquer WordPress faça download_url sem bloqueios de CDN ou WAF externo
 */
export async function ensureImageMirroredToR2(
  imageUrlOrBase64: string | undefined,
  articleId: string,
  slugTitle: string = 'destaque'
): Promise<{ url: string; base64?: string } | null> {
  if (!imageUrlOrBase64 || !imageUrlOrBase64.trim()) return null;

  const config = await getR2Config();
  const input = imageUrlOrBase64.trim();

  // Se já for uma URL do nosso R2 / CDN
  if (config && (input.startsWith(config.publicUrl) || input.includes('cdn.saletub.com'))) {
    return { url: input };
  }

  try {
    let buffer: Buffer | null = null;
    let contentType = 'image/jpeg';
    let ext = 'jpg';

    if (input.startsWith('data:image/')) {
      const match = input.match(/^data:(image\/(\w+));base64,(.+)$/s);
      if (match) {
        contentType = match[1];
        ext = match[2] === 'jpeg' ? 'jpg' : match[2];
        buffer = Buffer.from(match[3], 'base64');
      }
    } else if (input.startsWith('http://') || input.startsWith('https://')) {
      const res = await fetch(input, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength >= 500 && arrayBuf.byteLength <= 15 * 1024 * 1024) {
          buffer = Buffer.from(arrayBuf);
          const headerCt = res.headers.get('content-type') || '';
          if (headerCt.includes('png')) {
            contentType = 'image/png';
            ext = 'png';
          } else if (headerCt.includes('webp')) {
            contentType = 'image/webp';
            ext = 'webp';
          } else {
            contentType = 'image/jpeg';
            ext = 'jpg';
          }
        }
      }
    }

    if (buffer && buffer.length >= 500) {
      const cleanSlug = slugTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'foto';
      const filenameKey = `${articleId}-${cleanSlug}.${ext}`;

      if (config) {
        const r2Url = await uploadImageBufferToR2(buffer, filenameKey, contentType);
        if (r2Url) {
          return {
            url: r2Url,
            base64: `data:${contentType};base64,${buffer.toString('base64')}`,
          };
        }
      }

      // Fallback: se R2 não configurado localmente, retorna base64
      return {
        url: input,
        base64: `data:${contentType};base64,${buffer.toString('base64')}`,
      };
    }
  } catch (err: any) {
    console.warn(`[R2 Mirror] Falha ao espelhar imagem no R2 (${input.slice(0, 80)}):`, err.message);
  }

  return null;
}

/**
 * Gera uma imagem editorial de fallback profissional via Google Imagen 3 (DeepMind)
 * caso o artigo original não possua imagem ou ela tenha falhado.
 * PROIBIÇÃO ABSOLUTA: Nunca utilizar pollinations.ai, unsplash ou serviços com marca d'água.
 */
export async function generateContextualEditorialImage(
  title: string,
  articleId: string
): Promise<{ url: string; base64?: string } | null> {
  try {
    const cleanPrompt = title
      .replace(/[^\w\s\u00C0-\u00FF]/gi, ' ')
      .trim()
      .slice(0, 120);

    const settings = dbRepo.getSystemSettings();
    const geminiKey = process.env.GEMINI_API_KEY || (settings as any).geminiApiKey;

    if (!geminiKey) {
      console.warn('[Fallback Image Generator] Nenhuma chave Gemini configurada para o Google Imagen 3. Ignorando fallback para evitar marcas d\'água.');
      return null;
    }

    const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`;
    const promptText = `${cleanPrompt}, editorial photojournalism, high quality 4k sharp focus, modern authentic photography, horizontal landscape 16:9, natural lighting, no text, no watermark`;

    const res = await fetch(imagenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: promptText }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
          outputMimeType: 'image/jpeg'
        }
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (res.ok) {
      const data: any = await res.json();
      const base64Bytes = data.predictions?.[0]?.bytesBase64Encoded;
      if (base64Bytes) {
        const buffer = Buffer.from(base64Bytes, 'base64');
        const filenameKey = `${articleId}-imagen3.jpg`;
        const r2Url = await uploadImageBufferToR2(buffer, filenameKey, 'image/jpeg');
        if (r2Url) {
          return {
            url: r2Url,
            base64: `data:image/jpeg;base64,${base64Bytes}`
          };
        }
      }
    }
  } catch (err: any) {
    console.warn('[Fallback Image Generator] Falha ao gerar imagem editorial via Google Imagen 3:', err.message);
  }

  return null;
  } catch (err: any) {
    console.warn('[Fallback Image Generator] Falha ao gerar imagem editorial via IA:', err.message);
  }

  return null;
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
        bucketName: customConfig.bucketName || process.env.R2_BUCKET_NAME || '',
        publicUrl: (customConfig.publicUrl || process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
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

export interface GeneratedArticleStructure {
  id: string;
  site_id: string;
  site_name: string;
  site_url: string;
  wp_post_id?: number | null;
  wp_permalink?: string | null;
  wp_featured_media_id?: number | null;
  wp_has_featured_image?: boolean;
  published_at: string;
  title: string;
  description: string;
  excerpt: string;
  content: string;
  categories: string[];
  tags: string[];
  featured_image: {
    url: string | null;
    alt: string;
    title: string;
    caption: string;
    description: string;
  } | null;
  seo: {
    focus_keyword: string;
    meta_title: string;
    meta_description: string;
    canonical_url?: string;
    keywords: string[];
    image_seo: {
      alt: string;
      title: string;
      caption: string;
      description: string;
    };
  };
  original_source: {
    source_id?: string;
    source_name?: string;
    original_url: string;
    original_title: string;
    original_excerpt?: string;
    captured_at?: string;
  };
  ai_metadata?: {
    tone?: string;
    model?: string;
    custom_instructions_applied?: boolean;
    custom_instructions?: string;
  };
  r2_json_url?: string;
  created_at: string;
  updated_at: string;
}

export function buildGeneratedArticleStructure(
  site: WordPressSite,
  article: CapturedArticle,
  publicationMeta?: { wpPostId?: number; permalink?: string; publishedAt?: string; wpFeaturedMediaId?: number | null },
  r2PublicUrlBase?: string
): GeneratedArticleStructure {
  const title = (article.aiTitle || article.originalTitle || '').trim();
  const excerpt = (article.aiExcerpt || article.originalExcerpt || '').trim();
  const content = sanitizeArticleHtmlForPublish(article.aiContent || article.originalContent || '');
  const featImg = article.mediaData?.featuredImage;
  const imgUrl = featImg?.url || article.imageUrl || null;
  const imgAlt = featImg?.alt || title;
  const imgTitle = featImg?.title || title;
  const imgCaption = featImg?.caption || article.subtitle || excerpt;
  const imgDesc = excerpt;

  const wpPostId = publicationMeta?.wpPostId || article.wpPostId || null;
  const wpPermalink =
    publicationMeta?.permalink ||
    article.wpPermalink ||
    (wpPostId ? `${site.siteUrl.replace(/\/$/, '')}/?p=${wpPostId}` : site.siteUrl);
  const publishedAt =
    publicationMeta?.publishedAt || article.publishedAt || article.createdAt || new Date().toISOString();

  const wpFeaturedMediaId =
    publicationMeta?.wpFeaturedMediaId !== undefined
      ? publicationMeta.wpFeaturedMediaId
      : ((article.mediaData as any)?.wpFeaturedMediaId || null);
  const wpHasFeaturedImage = Boolean(wpFeaturedMediaId && wpFeaturedMediaId > 0) || Boolean(imgUrl);

  const r2JsonUrl = r2PublicUrlBase
    ? `${r2PublicUrlBase.replace(/\/$/, '')}/sites/${site.id}/artigos/${article.id}.json`
    : (article.r2JsonUrl || undefined);

  const keywords =
    article.aiSeoKeywords && article.aiSeoKeywords.length > 0
      ? article.aiSeoKeywords
      : (article.tags || ['notícias', 'atualidades']);
  const focusKeyword = keywords[0] || 'notícias';

  return {
    id: article.id,
    site_id: site.id,
    site_name: site.siteName,
    site_url: site.siteUrl,
    wp_post_id: wpPostId,
    wp_permalink: wpPermalink,
    wp_featured_media_id: wpFeaturedMediaId,
    wp_has_featured_image: wpHasFeaturedImage,
    published_at: publishedAt,
    title,
    description: excerpt,
    excerpt,
    content,
    categories: [site.defaultCategory || 'Notícias'],
    tags: keywords,
    featured_image: imgUrl
      ? {
          url: imgUrl,
          alt: imgAlt,
          title: imgTitle,
          caption: imgCaption,
          description: imgDesc,
        }
      : null,
    seo: {
      focus_keyword: focusKeyword,
      meta_title: title,
      meta_description: excerpt.slice(0, 160),
      canonical_url: wpPermalink || undefined,
      keywords,
      image_seo: {
        alt: imgAlt,
        title: imgTitle,
        caption: imgCaption,
        description: imgDesc,
      },
    },
    original_source: {
      source_id: article.sourceId,
      source_name: article.sourceName,
      original_url: article.originalUrl,
      original_title: article.originalTitle,
      original_excerpt: article.originalExcerpt,
      captured_at: article.createdAt,
    },
    ai_metadata: {
      tone: site.aiTone || 'jornalistico',
      model: site.aiModel,
      custom_instructions_applied: Boolean(site.aiCustomInstructions?.trim()),
      custom_instructions: site.aiCustomInstructions || undefined,
    },
    r2_json_url: r2JsonUrl,
    created_at: article.createdAt || publishedAt,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Salva a estrutura completa de um artigo gerado para um site no Cloudflare R2
 */
export async function uploadSiteArticleJson(
  site: WordPressSite,
  article: CapturedArticle,
  publicationMeta?: { wpPostId?: number; permalink?: string; publishedAt?: string; wpFeaturedMediaId?: number | null }
): Promise<string | null> {
  const config = await getR2Config();
  if (!config) return null;

  const key = `sites/${site.id}/artigos/${article.id}.json`;
  const publicUrl = `${config.publicUrl}/${key}`;

  const payload = buildGeneratedArticleStructure(site, article, publicationMeta, config.publicUrl);
  payload.r2_json_url = publicUrl;

  const client = createR2Client(config);
  try {
    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'public, max-age=3600, s-maxage=7200',
    });
    await client.send(command);
    console.log(`[R2 Site Sync] Artigo gerado salvo no R2 para site ${site.siteName}: ${publicUrl}`);
    return publicUrl;
  } catch (err: any) {
    console.error(`[R2 Site Sync Error] Falha ao enviar artigo do site para R2:`, err.message);
    return null;
  }
}

/**
 * Atualiza o feed consolidado de artigos gerados de um site no Cloudflare R2
 */
export async function uploadSiteArticlesFeedJson(
  site: WordPressSite,
  items: Array<{ article: CapturedArticle; publication?: { wpPostId?: number; permalink?: string; publishedAt?: string; wpFeaturedMediaId?: number | null } }>
): Promise<string | null> {
  const config = await getR2Config();
  if (!config) return null;

  const key = `sites/${site.id}/artigos.json`;
  const publicUrl = `${config.publicUrl}/${key}`;

  const structuredArticles = items.map((it) =>
    buildGeneratedArticleStructure(site, it.article, it.publication, config.publicUrl)
  );

  const feedPayload = {
    site_id: site.id,
    site_name: site.siteName,
    site_url: site.siteUrl,
    r2_feed_url: publicUrl,
    total_articles: structuredArticles.length,
    updated_at: new Date().toISOString(),
    articles: structuredArticles,
  };

  const client = createR2Client(config);
  try {
    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: Buffer.from(JSON.stringify(feedPayload, null, 2), 'utf-8'),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'public, max-age=60, s-maxage=120',
    });
    await client.send(command);
    console.log(
      `[R2 Site Sync] Feed de artigos gerados salvo no R2 para ${site.siteName} (${structuredArticles.length} matérias): ${publicUrl}`
    );
    return publicUrl;
  } catch (err: any) {
    console.error(`[R2 Site Sync Error] Falha ao enviar feed de artigos do site para R2:`, err.message);
    return null;
  }
}
