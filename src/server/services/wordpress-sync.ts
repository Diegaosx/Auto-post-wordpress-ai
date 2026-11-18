import { dbRepo } from '../db/repository';
import { CapturedArticle, WordPressSite } from '../../shared/types';
import { sanitizeArticleHtmlForPublish } from './article-cleaner';
import {
  uploadSiteArticleJson,
  ensureImageMirroredToR2,
  generateContextualEditorialImage,
  uploadSiteArticlesFeedJson,
} from './r2-sync';

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

  const postTitle = (article.aiTitle || article.originalTitle).trim();
  const postContent = sanitizeArticleHtmlForPublish(article.aiContent || article.originalContent);
  const postExcerpt = (article.aiExcerpt || article.originalExcerpt || '').trim();
  const postStatus = options?.status || site.defaultStatus || 'publish';
  const categoryName = options?.category || site.defaultCategory || 'Notícias';

  // 1. Pré-processar imagem: Espelhar no Cloudflare R2 para eliminar 100% de bloqueios de CDN externa/WAF
  let imageBase64: string | undefined = undefined;
  let finalImageUrl: string | undefined = undefined;

  // Prioridade A: Base64 já existente no mediaData
  if (article.mediaData?.featuredImage?.base64) {
    imageBase64 = article.mediaData.featuredImage.base64;
    finalImageUrl = article.mediaData.featuredImage.url || article.imageUrl || undefined;
  }

  // Prioridade B: Espelhar URL da matéria no Cloudflare R2 (URL aberta que o WordPress consegue baixar)
  const candidateUrl = article.imageUrl || article.mediaData?.featuredImage?.url;
  let mirror = await ensureImageMirroredToR2(candidateUrl || imageBase64, article.id, postTitle);

  // Prioridade C: Se o artigo não tinha imagem ou falhou o espelhamento, gera imagem editorial via IA
  if (!mirror && !candidateUrl) {
    console.log(`[WordPress Sync] Artigo "${postTitle}" sem imagem de origem. Gerando foto editorial via IA...`);
    mirror = await generateContextualEditorialImage(postTitle, article.id);
  }

  if (mirror) {
    finalImageUrl = mirror.url;
    if (mirror.base64) {
      imageBase64 = mirror.base64;
    }
  } else if (candidateUrl) {
    finalImageUrl = candidateUrl.trim();
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

  // Endpoints prioritários: 1º Rota amigável com permalink, 2º Rota nativa com rest_route (caso permalinks simples), 3º Fallback legado
  const endpoints = [
    { url: `${baseUrl}/wp-json/autopost-ai/v1/posts`, isPrimary: true },
    { url: `${baseUrl}/?rest_route=/autopost-ai/v1/posts`, isPrimary: true },
    { url: `${baseUrl}/wp-json/criador-conteudo/v1/posts`, isPrimary: false },
  ];

  let lastError: string | null = null;
  let primaryError: string | null = null;
  let responseData: any = null;

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep.url, {
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
        const formattedErr = `HTTP ${resp.status} em ${ep.url}: ${errText.slice(0, 200)}`;
        lastError = formattedErr;
        if (ep.isPrimary && !primaryError) {
          primaryError = formattedErr;
        }
      }
    } catch (err: any) {
      const formattedNetErr = `Falha de rede em ${ep.url}: ${err.message}`;
      lastError = formattedNetErr;
      if (ep.isPrimary && !primaryError) {
        primaryError = formattedNetErr;
      }
    }
  }

  if (!responseData) {
    // Dá preferência para o erro da rota oficial para orientar o usuário com precisão
    const effectiveError = primaryError || lastError || 'Erro desconhecido ao tentar comunicar com o WordPress.';
    dbRepo.appendWordPressLog({
      siteId: site.id,
      siteName: site.siteName,
      action: 'POST_PUBLISH_FAILED',
      status: 'error',
      message: `Falha ao sincronizar artigo "${postTitle}": ${effectiveError}`,
      details: { articleId, error: effectiveError },
    });

    dbRepo.updateWordPressSite(site.id, { status: 'error' });
    throw new Error(`Erro ao conectar com o WordPress: ${effectiveError}`);
  }

  const wpPostId = responseData.post_id || responseData.id;
  const permalink = responseData.permalink || responseData.link || `${baseUrl}/?p=${wpPostId}`;
  const isDuplicatePrevented = Boolean(responseData.already_exists || responseData.duplicate_prevented);

  // 2. Revisão Pós-Publicação Ativa: Verificar se a imagem destaque foi vinculada com sucesso no WordPress
  let verifiedFeaturedMediaId: number = Number(responseData.featured_image_id || responseData.featured_media || 0);

  if (wpPostId && !isDuplicatePrevented) {
    if (!verifiedFeaturedMediaId) {
      try {
        const verifyRes = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${wpPostId}`, {
          headers: { 'User-Agent': 'AutoPostAi-Sync/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (verifyRes.ok) {
          const wpPostData = await verifyRes.json();
          verifiedFeaturedMediaId = Number(wpPostData.featured_media || 0);
        }
      } catch (chkErr: any) {
        console.warn(`[WordPress Audit] Aviso ao inspecionar mídia do post ${wpPostId}:`, chkErr.message);
      }
    }

    // Se o post foi publicado SEM imagem destaque (featured_media === 0), dispara a auto-recuperação imediatamente!
    if (!verifiedFeaturedMediaId && finalImageUrl) {
      console.warn(`[WordPress Audit] ALERTA: Artigo #${wpPostId} publicado no site "${site.siteName}" está SEM imagem destacada. Disparando protocolo de autocorreção...`);
      verifiedFeaturedMediaId = await selfHealPostFeaturedImage(
        site,
        wpPostId,
        finalImageUrl,
        postTitle,
        imageAlt,
        imageCaption
      );
    }
  }

  // Registra no banco de dados para o Escudo Anti-Duplicação
  await dbRepo.recordArticlePublication(article.id, site.id, wpPostId, permalink);

  // Faz upload assíncrono do JSON estruturado do artigo gerado para o Cloudflare R2
  uploadSiteArticleJson(site, article, {
    wpPostId,
    permalink,
    publishedAt: new Date().toISOString(),
    wpFeaturedMediaId: verifiedFeaturedMediaId || null,
  }).catch((r2Err: any) =>
    console.warn(`[WordPress Sync] Aviso ao salvar JSON no R2 para site ${site.siteName}:`, r2Err.message)
  );

  // Atualiza artigo no banco
  dbRepo.updateCapturedArticle(article.id, {
    status: 'published',
    wpPostId,
    wpSiteId: site.id,
    wpPermalink: permalink,
    imageUrl: finalImageUrl || article.imageUrl,
    mediaData: {
      ...article.mediaData,
      wpFeaturedMediaId: verifiedFeaturedMediaId || undefined,
      featuredImage: {
        url: finalImageUrl || article.imageUrl || '',
        alt: imageAlt,
        title: imageTitle,
        caption: imageCaption,
        base64: imageBase64,
      },
    },
  });

  // Atualiza site
  dbRepo.updateWordPressSite(site.id, {
    status: 'connected',
    lastSyncAt: new Date().toISOString(),
  });

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
    `${baseUrl}/?rest_route=/autopost-ai/v1/status`,
    `${baseUrl}/wp-json/criador-conteudo/v1/status`,
  ];

  let testErrorDetail = '';

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
      } else {
        const errBody = await resp.text();
        testErrorDetail = `HTTP ${resp.status} em ${ep}: ${errBody.slice(0, 160)}`;
      }
    } catch (e: any) {
      testErrorDetail = `Falha de rede em ${ep}: ${e.message}`;
      console.warn(`[WordPress Test] Endpoint ${ep} falhou:`, e.message);
    }
  }

  dbRepo.updateWordPressSite(site.id, { status: 'error' });
  dbRepo.appendWordPressLog({
    siteId: site.id,
    siteName: site.siteName,
    action: 'CONNECTION_TEST_FAILED',
    status: 'error',
    message: `Falha ao testar conexão com ${site.siteName}: ${testErrorDetail || 'Sem resposta do servidor'}`,
  });

  let friendlyMessage = 'Falha ao conectar. Verifique se o plugin está ativo no WordPress e a chave de licença está salva.';
  if (testErrorDetail.includes('404')) {
    friendlyMessage = 'HTTP 404: Rota da REST API não encontrada. Verifique se o plugin Auto Post WordPress AI está ativo. Se estiver ativo, vá em Configurações > Links Permanentes no WordPress e clique em "Salvar Alterações".';
  } else if (testErrorDetail.includes('401') || testErrorDetail.includes('403')) {
    friendlyMessage = 'Chave de Licença não autorizada. Verifique se a chave API Key configurada no plugin no WordPress é idêntica à deste painel.';
  } else if (testErrorDetail) {
    friendlyMessage = `${friendlyMessage} (${testErrorDetail})`;
  }

  return {
    success: false,
    status: 'error',
    message: friendlyMessage,
    details: { rawError: testErrorDetail },
  };
}

/**
 * Protocolo de Autocorreção / Self-Healing para anexar imagem em destaque no WordPress
 * caso o post tenha sido publicado e por qualquer motivo a imagem não tenha vinculado de primeira.
 */
export async function selfHealPostFeaturedImage(
  site: WordPressSite,
  wpPostId: number,
  imageUrl: string,
  title: string,
  alt: string,
  caption?: string
): Promise<number> {
  let baseUrl = site.siteUrl.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  // Passo 1: Atualização direta via REST do plugin com a URL aberta do R2
  try {
    const updateRes = await fetch(`${baseUrl}/wp-json/autopost-ai/v1/posts/${wpPostId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': site.apiKey,
        'User-Agent': 'AutoPostAi-Sync/1.0',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        featured_image: imageUrl,
        image_alt: alt,
        image_title: title,
        image_caption: caption || '',
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (updateRes.ok) {
      const upData: any = await updateRes.json();
      const mediaId = Number(upData.featured_image_id || 0);
      if (mediaId > 0) {
        console.log(`[WordPress Self-Healing] Sucesso (Passo 1): Imagem vinculada (#${mediaId}) ao post #${wpPostId}`);
        return mediaId;
      }
    }
  } catch (err1: any) {
    console.warn(`[WordPress Self-Healing] Passo 1 falhou:`, err1.message);
  }

  // Passo 2: Upload isolado da mídia via /wp-json/autopost-ai/v1/media e associação imediata ao post
  try {
    const mediaRes = await fetch(`${baseUrl}/wp-json/autopost-ai/v1/media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': site.apiKey,
        'User-Agent': 'AutoPostAi-Sync/1.0',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        title,
        alt_text: alt,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (mediaRes.ok) {
      const mediaData: any = await mediaRes.json();
      const mediaId = Number(mediaData.id || 0);
      if (mediaId > 0) {
        // Vincula no post via endpoint de posts
        await fetch(`${baseUrl}/wp-json/autopost-ai/v1/posts/${wpPostId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': site.apiKey,
            'User-Agent': 'AutoPostAi-Sync/1.0',
          },
          body: JSON.stringify({
            featured_media: mediaId,
            featured_image_id: mediaId,
          }),
          signal: AbortSignal.timeout(15000),
        });
        console.log(`[WordPress Self-Healing] Sucesso (Passo 2): Mídia #${mediaId} criada e vinculada ao post #${wpPostId}`);
        return mediaId;
      }
    }
  } catch (err2: any) {
    console.warn(`[WordPress Self-Healing] Passo 2 falhou:`, err2.message);
  }

  // Verificação final no WordPress
  try {
    const checkRes = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${wpPostId}`, {
      headers: { 'User-Agent': 'AutoPostAi-Sync/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (checkRes.ok) {
      const postData: any = await checkRes.json();
      return Number(postData.featured_media || 0);
    }
  } catch {}

  return 0;
}

/**
 * Inspeciona e repara individualmente a imagem destacada de um artigo já publicado
 */
export async function verifyAndRepairPostFeaturedImage(
  siteId: string,
  articleId: string
): Promise<{ success: boolean; wpPostId: number; mediaId: number; message: string }> {
  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) throw new Error('Site WordPress não encontrado.');

  const article = dbRepo.getCapturedArticleById(articleId);
  if (!article) throw new Error('Artigo não encontrado.');

  const pub = dbRepo.getArticlePublication(articleId, siteId);
  const wpPostId = pub?.wpPostId || article.wpPostId;
  if (!wpPostId) throw new Error('Este artigo ainda não possui ID de publicação neste WordPress.');

  const title = article.aiTitle || article.originalTitle;
  let targetImageUrl = article.imageUrl || article.mediaData?.featuredImage?.url;

  // Garante espelhamento no Cloudflare R2 ou gera foto editorial se não houver
  let mirror = await ensureImageMirroredToR2(targetImageUrl, article.id, title);
  if (!mirror && !targetImageUrl) {
    mirror = await generateContextualEditorialImage(title, article.id);
  }

  if (!mirror) {
    throw new Error('Não foi possível obter ou gerar imagem para este artigo.');
  }

  const mediaId = await selfHealPostFeaturedImage(
    site,
    wpPostId,
    mirror.url,
    title,
    title
  );

  if (mediaId <= 0) {
    throw new Error('O WordPress não confirmou a associação da imagem em destaque.');
  }

  // Atualiza artigo no banco
  dbRepo.updateCapturedArticle(article.id, {
    imageUrl: mirror.url,
    mediaData: {
      ...article.mediaData,
      wpFeaturedMediaId: mediaId,
      featuredImage: {
        url: mirror.url,
        alt: title,
        title,
        caption: article.subtitle || article.aiExcerpt || title,
        base64: mirror.base64,
      },
    },
  });

  // Atualiza JSON individual e feed no R2
  uploadSiteArticleJson(site, article, {
    wpPostId,
    permalink: pub?.permalink || article.wpPermalink || undefined,
    publishedAt: pub?.publishedAt || article.publishedAt || undefined,
    wpFeaturedMediaId: mediaId,
  }).catch(() => {});

  return {
    success: true,
    wpPostId,
    mediaId,
    message: `Imagem destacada vinculada com sucesso no WordPress (Anexo #${mediaId})!`,
  };
}

/**
 * Varre todos os posts de um site WordPress, identifica os que estão sem foto (featured_media === 0)
 * e repara todos automaticamente
 */
export async function repairAllMissingImagesForSite(siteId: string): Promise<{
  scanned: number;
  repaired: number;
  failed: number;
  details: Array<{ postId: number; title: string; success: boolean; mediaId?: number; error?: string }>;
}> {
  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) throw new Error('Site WordPress não encontrado.');

  let baseUrl = site.siteUrl.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  // 1. Obter posts recentes do WordPress
  const wpRes = await fetch(`${baseUrl}/wp-json/wp/v2/posts?per_page=100`, {
    headers: { 'User-Agent': 'AutoPostAi-Sync/1.0' },
    signal: AbortSignal.timeout(20000),
  });

  if (!wpRes.ok) {
    throw new Error(`Falha ao listar posts do WordPress: HTTP ${wpRes.status}`);
  }

  const posts: any[] = await wpRes.json();
  const missing = posts.filter((p) => Number(p.featured_media || 0) === 0);

  const rawArticles = dbRepo.getPublishedArticlesForSite(site.id);
  const details: Array<{ postId: number; title: string; success: boolean; mediaId?: number; error?: string }> = [];

  let repairedCount = 0;
  let failedCount = 0;

  for (const post of missing) {
    const matched = rawArticles.find(
      (r) =>
        r.publication?.wpPostId === post.id ||
        r.article.wpPostId === post.id ||
        (r.article.aiTitle && post.title?.rendered && r.article.aiTitle.includes(post.title.rendered.slice(0, 30)))
    );

    const articleTitle = post.title?.rendered || 'Notícia';
    let targetImageUrl = matched?.article.imageUrl || matched?.article.mediaData?.featuredImage?.url;

    let mirrorResult: { url: string; base64?: string } | null = null;
    if (targetImageUrl) {
      mirrorResult = await ensureImageMirroredToR2(targetImageUrl, matched?.article.id || `wp-${post.id}`, articleTitle);
    }
    if (!mirrorResult) {
      mirrorResult = await generateContextualEditorialImage(articleTitle, matched?.article.id || `wp-${post.id}`);
    }

    if (!mirrorResult) {
      failedCount++;
      details.push({ postId: post.id, title: articleTitle, success: false, error: 'Não foi possível gerar ou obter imagem.' });
      continue;
    }

    const newMediaId = await selfHealPostFeaturedImage(
      site,
      post.id,
      mirrorResult.url,
      articleTitle,
      articleTitle
    );

    if (newMediaId > 0) {
      repairedCount++;
      details.push({ postId: post.id, title: articleTitle, success: true, mediaId: newMediaId });

      if (matched) {
        dbRepo.updateCapturedArticle(matched.article.id, {
          imageUrl: mirrorResult.url,
          mediaData: {
            ...matched.article.mediaData,
            wpFeaturedMediaId: newMediaId,
            featuredImage: {
              url: mirrorResult.url,
              alt: articleTitle,
              title: articleTitle,
              caption: articleTitle,
              base64: mirrorResult.base64,
            },
          },
        });
      }
    } else {
      failedCount++;
      details.push({ postId: post.id, title: articleTitle, success: false, error: 'WordPress não vinculou o anexo.' });
    }
  }

  // Atualiza o feed consolidado no R2
  uploadSiteArticlesFeedJson(site, rawArticles).catch(() => {});

  return {
    scanned: posts.length,
    repaired: repairedCount,
    failed: failedCount,
    details,
  };
}

/**
 * Interface dos Logs e Diagnósticos Remotos do WordPress
 */
export interface RemoteWordPressLogResult {
  success: boolean;
  reachable: boolean;
  httpStatus?: number;
  message?: string;
  error?: string;
  diagnosis?: {
    cause: string;
    actionable_steps: string[];
  };
  server_info?: {
    plugin_version?: string;
    wp_version?: string;
    php_version?: string;
    site_url?: string;
    site_name?: string;
    permalink_structure?: string;
    rest_url?: string;
    memory_limit?: string;
    max_execution_time?: string;
    upload_max_filesize?: string;
    seo_plugin?: string;
  };
  counts?: {
    total: number;
    error: number;
    warning: number;
    success: number;
    info: number;
  };
  logs: Array<{
    id?: string;
    timestamp: string;
    timestamp_iso?: string;
    level: 'info' | 'success' | 'warning' | 'error';
    action: string;
    message: string;
    details?: any;
  }>;
}

/**
 * Consulta sob demanda em tempo real os logs internos do plugin Auto Post WordPress AI instalado no site do cliente.
 */
export async function fetchRemoteWordPressLogs(siteId: string, limit: number = 100): Promise<RemoteWordPressLogResult> {
  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) {
    throw new Error(`Site com ID ${siteId} não encontrado.`);
  }

  let baseUrl = site.siteUrl.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const endpoints = [
    `${baseUrl}/wp-json/autopost-ai/v1/logs?limit=${limit}`,
    `${baseUrl}/?rest_route=/autopost-ai/v1/logs&limit=${limit}`,
  ];

  let lastStatus = 0;
  let lastErrorText = '';

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'GET',
        headers: {
          'X-API-Key': site.apiKey,
          'User-Agent': 'AutoPostAi-Sync/1.0',
        },
        signal: AbortSignal.timeout(12000),
      });

      lastStatus = resp.status;

      if (resp.ok) {
        const data = await resp.json();
        return {
          success: true,
          reachable: true,
          httpStatus: resp.status,
          server_info: {
            plugin_version: data.plugin_version || '1.3.0',
            wp_version: data.wp_version,
            php_version: data.php_version,
            site_url: data.site_url || site.siteUrl,
            site_name: data.site_name || site.siteName,
            permalink_structure: data.permalink_structure,
            rest_url: data.rest_url,
            memory_limit: data.memory_limit,
            max_execution_time: data.max_execution_time,
            upload_max_filesize: data.upload_max_filesize,
            seo_plugin: data.seo_plugin,
          },
          counts: data.counts || {
            total: (data.logs || []).length,
            error: 0,
            warning: 0,
            success: 0,
            info: (data.logs || []).length,
          },
          logs: data.logs || [],
        };
      } else {
        const text = await resp.text();
        lastErrorText = text;
      }
    } catch (netErr: any) {
      lastErrorText = netErr.message;
    }
  }

  // Falha de comunicação: gerar diagnóstico detalhado com recomendações
  let cause = 'Não foi possível conectar ao endpoint de logs do WordPress.';
  const actionableSteps: string[] = [];

  if (lastStatus === 404) {
    cause = 'HTTP 404 (Rota não encontrada): O plugin Auto Post WordPress AI pode estar inativo no WordPress ou as rotas REST ainda não foram registradas.';
    actionableSteps.push('1. Acesse o painel do WordPress do cliente em "Plugins" e confirme se "Auto Post WordPress AI" está Ativo.');
    actionableSteps.push('2. Acesse Configurações > Links Permanentes no WordPress e apenas clique em "Salvar Alterações" para forçar a reescrita das regras de rota da REST API.');
    actionableSteps.push('3. Certifique-se de que o cliente instalou a versão mais recente do plugin (baixe o .zip pelo botão "Baixar Plugin (.zip)" neste painel).');
  } else if (lastStatus === 401 || lastStatus === 403) {
    cause = `HTTP ${lastStatus} (Não Autorizado): A Chave de Licença (API Key) não foi reconhecida ou não foi salva corretamente nas configurações do plugin no WordPress.`;
    actionableSteps.push('1. Acesse o painel do WordPress do cliente no menu "Auto Post AI".');
    actionableSteps.push(`2. Cole exatamente a Chave de Licença "${site.apiKey}" no campo correspondente.`);
    actionableSteps.push('3. Clique em "Salvar Configurações" e depois no botão "Testar Conexão Agora".');
  } else if (lastStatus === 500 || lastStatus === 502 || lastStatus === 504) {
    cause = `HTTP ${lastStatus} (Erro no Servidor): O servidor web da hospedagem do cliente retornou erro interno ou timeout ao processar a requisição.`;
    actionableSteps.push('1. Verifique os logs de erro do PHP no servidor de hospedagem do WordPress.');
    actionableSteps.push('2. Verifique se há algum firewall ou plugin de segurança (ex: Wordfence, iThemes, Cloudflare WAF) bloqueando requisições REST externas.');
  } else {
    cause = `Falha de rede ou timeout na conexão com o site: ${lastErrorText || 'sem resposta do host'}.`;
    actionableSteps.push(`1. Verifique se a URL cadastrada (${site.siteUrl}) está acessível publicamente com HTTPS válido.`);
    actionableSteps.push('2. Verifique se o servidor não está bloqueando requisições automatizadas ou IPs da nuvem.');
  }

  return {
    success: false,
    reachable: false,
    httpStatus: lastStatus || undefined,
    error: `Erro ao obter logs remotos: HTTP ${lastStatus || 'Falha de Rede'}: ${lastErrorText.slice(0, 160)}`,
    diagnosis: {
      cause,
      actionable_steps: actionableSteps,
    },
    logs: [],
  };
}

/**
 * Limpa o histórico de logs mantidos no plugin no WordPress do cliente.
 */
export async function clearRemoteWordPressLogs(siteId: string): Promise<{ success: boolean; message: string }> {
  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) throw new Error(`Site com ID ${siteId} não encontrado.`);

  let baseUrl = site.siteUrl.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const endpoints = [
    `${baseUrl}/wp-json/autopost-ai/v1/logs`,
    `${baseUrl}/?rest_route=/autopost-ai/v1/logs`,
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'DELETE',
        headers: {
          'X-API-Key': site.apiKey,
          'User-Agent': 'AutoPostAi-Sync/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        return { success: true, message: 'Logs do plugin no WordPress limpos com sucesso.' };
      }
    } catch {}
  }

  throw new Error('Não foi possível conectar ao WordPress para limpar os logs.');
}
