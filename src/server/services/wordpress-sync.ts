import { dbRepo } from '../db/repository';
import { CapturedArticle, WordPressSite } from '../../shared/types';

export async function syncArticleToWordPress(
  articleId: string,
  siteId: string,
  options?: {
    status?: 'publish' | 'draft';
    category?: string;
  }
): Promise<{
  success: boolean;
  wpPostId?: number;
  permalink?: string;
  message?: string;
}> {
  const article = dbRepo.getCapturedArticleById(articleId);
  if (!article) {
    throw new Error(`Artigo com ID ${articleId} não encontrado.`);
  }

  const site = dbRepo.getWordPressSiteById(siteId);
  if (!site) {
    throw new Error(`Site WordPress com ID ${siteId} não encontrado.`);
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

  const payload = {
    title: postTitle,
    content: postContent,
    excerpt: postExcerpt,
    status: postStatus,
    categories: [categoryName],
    tags: article.aiSeoKeywords && article.aiSeoKeywords.length > 0 ? article.aiSeoKeywords : ['notícias', 'atualidades'],
    image_url: article.imageUrl || undefined,
    featured_image: article.imageUrl || undefined,
    seo_title: postTitle,
    seo_description: postExcerpt,
    source_url: article.originalUrl,
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

  // Log de auditoria e log WordPress
  dbRepo.appendWordPressLog({
    siteId: site.id,
    siteName: site.siteName,
    action: 'POST_PUBLISHED',
    status: 'success',
    message: `Artigo "${postTitle}" publicado com sucesso no site "${site.siteName}" (ID WP: ${wpPostId})`,
    details: { wpPostId, permalink, status: postStatus },
  });

  dbRepo.appendAuditLog({
    actorId: site.userId,
    actorEmail: 'system',
    actorRole: 'admin',
    action: 'WP_ARTICLE_PUBLISHED',
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
    },
  });

  return {
    success: true,
    wpPostId,
    permalink,
    message: 'Artigo publicado com sucesso!',
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
