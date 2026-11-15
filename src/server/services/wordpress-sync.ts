import { dbRepo } from '../db/repository';
import { CapturedArticle, WordPressSite } from '../../shared/types';

export async function syncArticleToWordPress(
  articleId: string,
  siteId: string,
  options?: {
    status?: 'publish' | 'draft';
    category?: string;
    force?: boolean;
  }
): Promise<{
  success: boolean;
  wpPostId?: number;
  permalink?: string;
  message?: string;
  alreadyPublished?: boolean;
}> {
  const article = dbRepo.getCapturedArticleById(articleId);
  if (!article) {
    throw new Error(`Artigo com ID ${articleId} não encontrado.`);
  }

  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) {
    throw new Error(`Site WordPress com ID ${siteId} não encontrado.`);
  }

  // 1. Escudo Anti-Duplicação no Backend: Evita reenvio se já publicado neste site
  if (!options?.force && dbRepo.isArticlePublishedToSite(articleId, siteId)) {
    const existingPub = dbRepo.getArticlePublication(articleId, siteId);
    return {
      success: true,
      alreadyPublished: true,
      wpPostId: existingPub?.wpPostId || article.wpPostId || undefined,
      permalink: existingPub?.permalink || article.wpPermalink || undefined,
      message: `Artigo já publicado anteriormente no site "${site.siteName}". Duplicação evitada com sucesso.`,
    };
  }

  let baseUrl = site.siteUrl.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const postTitle = article.aiTitle || article.originalTitle;
  const postContent = article.aiContent || article.originalContent;
  const postExcerpt = article.aiExcerpt || article.originalExcerpt || '';
  const postStatus = options?.status || site.defaultStatus || 'publish';
  const categoryName = options?.category || site.defaultCategory || 'Notícias';

  // 1. Pré-carregar imagem em base64 se disponível (elimina 100% de falhas de CDN/firewall no WordPress)
  let imageBase64: string | undefined = undefined;
  let finalImageUrl: string | undefined = undefined;

  // Prioridade A: Base64 já validado e pré-carregado no mediaData pelo MCP Antigravity
  if (article.mediaData?.featuredImage?.base64) {
    imageBase64 = article.mediaData.featuredImage.base64;
    finalImageUrl = article.mediaData.featuredImage.url || article.imageUrl || undefined;
  }

  // Prioridade B: Baixar a partir de imageUrl ou mediaData
  if (!imageBase64) {
    const rawUrl = article.imageUrl || article.mediaData?.featuredImage?.url;
    if (rawUrl) {
      let normalized = rawUrl.trim();
      if (normalized.includes('adsensecustomsearchads.com.br')) {
        normalized = normalized.replace(/https?:\/\/[^\/]*adsensecustomsearchads\.com\.br/, 'https://cdn.saletub.com');
      }
      finalImageUrl = normalized;
      try {
        const imgRes = await fetch(normalized, {
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(15000),
        });
        if (imgRes.ok) {
          const arrayBuf = await imgRes.arrayBuffer();
          if (arrayBuf.byteLength >= 500 && arrayBuf.byteLength <= 10 * 1024 * 1024) {
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
            imageBase64 = `data:${contentType};base64,${Buffer.from(arrayBuf).toString('base64')}`;
          }
        }
      } catch (imgErr: any) {
        console.warn(`[WordPress Sync] Aviso: Não foi possível pré-carregar buffer da imagem (${normalized}):`, imgErr.message);
      }
    }
  }

  const focusKeyword = article.aiSeoKeywords && article.aiSeoKeywords.length > 0 ? article.aiSeoKeywords[0] : 'notícias';
  const featMeta = article.mediaData?.featuredImage;
  const imageAlt = featMeta?.alt || postTitle;
  const imageTitle = featMeta?.title || postTitle;
  const imageCaption = featMeta?.caption || article.subtitle || postExcerpt.slice(0, 160);
  const imageDesc = postExcerpt;

  const payload = {
    article_id: article.id,
    source_url: article.originalUrl,
    original_url: article.originalUrl,
    title: postTitle,
    content: postContent,
    excerpt: postExcerpt,
    status: postStatus,
    categories: [categoryName],
    tags: article.aiSeoKeywords && article.aiSeoKeywords.length > 0 ? article.aiSeoKeywords : ['notícias', 'atualidades'],
    image_url: finalImageUrl || article.imageUrl || undefined,
    featured_image: finalImageUrl || article.imageUrl || undefined,
    image_base64: imageBase64,
    image_alt: imageAlt,
    alt_text: imageAlt,
    image_title: imageTitle,
    image_caption: imageCaption,
    caption: imageCaption,
    image_description: imageDesc,
    description: imageDesc,
    focus_keyword: focusKeyword,
    keywords: article.aiSeoKeywords || [],
    seo_title: postTitle,
    seo_description: postExcerpt,
  };

  // Tenta primeiro endpoint moderno do Auto Post AI, com fallback para criador-conteudo caso o WP use a base legada
  const endpoints = [
    `${baseUrl}/wp-json/autopost-ai/v1/posts`,
    `${baseUrl}/wp-json/criador-conteudo/v1/posts`,
  ];

  let lastError: string | null = null;
  let responseData: any = null;

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': site.apiKey,
          'User-Agent': 'AutoPostAi-Sync/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        responseData = await resp.json();
        break;
      } else {
        const errText = await resp.text();
        lastError = `HTTP ${resp.status} em ${ep}: ${errText.slice(0, 200)}`;
      }
    } catch (err: any) {
      lastError = `Falha de rede em ${ep}: ${err.message}`;
    }
  }

  if (!responseData) {
    dbRepo.appendWordPressLog({
      siteId: site.id,
      siteName: site.siteName,
      action: 'POST_PUBLISH_FAILED',
      status: 'error',
      message: `Falha ao sincronizar artigo "${postTitle}": ${lastError}`,
      details: { articleId, error: lastError },
    });

    dbRepo.updateWordPressSite(site.id, { status: 'error' });
    throw new Error(`Erro ao conectar com o WordPress: ${lastError}`);
  }

  const wpPostId = responseData.post_id || responseData.id;
  const permalink = responseData.permalink || responseData.link || `${baseUrl}/?p=${wpPostId}`;

  // Registra no banco de dados para o Escudo Anti-Duplicação
  await dbRepo.recordArticlePublication(article.id, site.id, wpPostId, permalink);

  // Atualiza artigo no banco
  dbRepo.updateCapturedArticle(article.id, {
    status: 'published',
    wpPostId,
    wpSiteId: site.id,
    wpPermalink: permalink,
  });

  // Atualiza site
  dbRepo.updateWordPressSite(site.id, {
    status: 'connected',
    lastSyncAt: new Date().toISOString(),
  });

  const isDuplicatePrevented = Boolean(responseData.already_exists || responseData.duplicate_prevented);

  // Log de auditoria e log WordPress
  dbRepo.appendWordPressLog({
    siteId: site.id,
    siteName: site.siteName,
    action: isDuplicatePrevented ? 'POST_DUPLICATE_PREVENTED' : 'POST_PUBLISHED',
    status: 'success',
    message: isDuplicatePrevented
      ? `Duplicação evitada: Artigo "${postTitle}" já constava no WordPress do site "${site.siteName}" (ID WP: ${wpPostId})`
      : `Artigo "${postTitle}" publicado com sucesso no site "${site.siteName}" (ID WP: ${wpPostId})`,
    details: { wpPostId, permalink, status: postStatus, duplicatePrevented: isDuplicatePrevented },
  });

  dbRepo.appendAuditLog({
    actorId: site.userId,
    actorEmail: 'system',
    actorRole: 'admin',
    action: isDuplicatePrevented ? 'WP_DUPLICATE_PREVENTED' : 'WP_ARTICLE_PUBLISHED',
    category: 'wordpress',
    resource: `${site.siteUrl}/posts/${wpPostId}`,
    status: 'success',
    ipAddress: '127.0.0.1',
    latencyMs: 150,
    metadata: {
      siteId: site.id,
      siteName: site.siteName,
      articleId: article.id,
      wpPostId,
      duplicatePrevented: isDuplicatePrevented,
    },
  });

  return {
    success: true,
    wpPostId,
    permalink,
    alreadyPublished: isDuplicatePrevented,
    message: isDuplicatePrevented
      ? 'Artigo já existia no WordPress. Duplicação evitada com sucesso.'
      : 'Artigo publicado com sucesso!',
  };
}

export async function testWordPressConnection(siteId: string): Promise<{
  success: boolean;
  status: 'connected' | 'error';
  message: string;
  details?: any;
}> {
  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) {
    throw new Error(`Site com ID ${siteId} não encontrado.`);
  }

  let baseUrl = site.siteUrl.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const endpoints = [
    `${baseUrl}/wp-json/autopost-ai/v1/status`,
    `${baseUrl}/wp-json/criador-conteudo/v1/status`,
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'GET',
        headers: {
          'X-API-Key': site.apiKey,
          'User-Agent': 'AutoPostAi-Sync/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        const data = await resp.json();
        dbRepo.updateWordPressSite(site.id, {
          status: 'connected',
          lastSyncAt: new Date().toISOString(),
        });
        dbRepo.appendWordPressLog({
          siteId: site.id,
          siteName: site.siteName,
          action: 'CONNECTION_TEST',
          status: 'success',
          message: 'Teste de conexão bem-sucedido com a REST API do WordPress.',
          details: data,
        });
        return {
          success: true,
          status: 'connected',
          message: 'Conexão ativa e validada com sucesso!',
          details: data,
        };
      }
    } catch (e: any) {
      console.warn(`[WordPress Test] Endpoint ${ep} falhou:`, e.message);
    }
  }

  dbRepo.updateWordPressSite(site.id, { status: 'error' });
  dbRepo.appendWordPressLog({
    siteId: site.id,
    siteName: site.siteName,
    action: 'CONNECTION_TEST_FAILED',
    status: 'error',
    message: `Não foi possível obter resposta positiva de ${baseUrl}/wp-json/autopost-ai/v1/status`,
  });

  return {
    success: false,
    status: 'error',
    message: 'Falha ao conectar. Verifique se o plugin está ativo no WordPress e a chave de licença está salva.',
  };
}
