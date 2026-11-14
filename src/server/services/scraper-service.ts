import Parser from 'rss-parser';
import { dbRepo } from '../db/repository';
import { executeLlmPrompt } from './llm-gateway';
import { CapturedArticle, NewsSource, ArticleRewriteOptions } from '../../shared/types';
import { syncArticleToWordPress } from './wordpress-sync';
import { extractArticle } from './article-extractor';
import { uploadArticleJson, uploadFeedJson } from './r2-sync';

const rssParser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure', 'enclosure'],
    ],
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AutoPostAi/1.0',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  timeout: 15000,
});

function extractImageUrlFromHtml(html: string): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function cleanHtmlTags(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeSource(sourceId: string): Promise<{
  source: NewsSource;
  totalFound: number;
  newCaptured: number;
  articles: CapturedArticle[];
}> {
  const source = dbRepo.getNewsSourceById(sourceId);
  if (!source) {
    throw new Error(`Fonte com ID ${sourceId} não foi encontrada.`);
  }

  let items: Array<{
    title?: string;
    link?: string;
    content?: string;
    contentSnippet?: string;
    pubDate?: string;
    enclosure?: { url?: string };
    mediaContent?: { $?: { url?: string } };
    mediaThumbnail?: { $?: { url?: string } };
  }> = [];

  try {
    const feed = await rssParser.parseURL(source.url);
    items = (feed.items || []) as typeof items;
  } catch (feedError) {
    // Se não for RSS puro ou falhar, tenta requisição HTTP direta buscando feeds alternativos ou HTML
    console.warn(`[Scraper] Falha ao fazer parse de RSS direto para ${source.url}. Tentando extração HTTP fallback...`, feedError);
    
    try {
      const response = await fetch(source.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AutoPostAi/1.0' },
      });
      const htmlText = await response.text();

      // Procura tag <link rel="alternate" type="application/rss+xml" href="...">
      const rssMatch = htmlText.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i);
      if (rssMatch && rssMatch[1]) {
        let feedUrl = rssMatch[1];
        if (!feedUrl.startsWith('http')) {
          const base = new URL(source.url);
          feedUrl = new URL(feedUrl, base.origin).toString();
        }
        const resolvedFeed = await rssParser.parseURL(feedUrl);
        items = (resolvedFeed.items || []) as typeof items;
      } else {
        throw new Error(`Nenhum feed RSS detectado no portal ${source.url}. Certifique-se de usar a URL de feed RSS da categoria.`);
      }
    } catch (err: any) {
      throw new Error(`Erro ao conectar com a fonte "${source.name}": ${err.message}`);
    }
  }

  const capturedList: CapturedArticle[] = [];
  let newCount = 0;

  if (items.length === 0) {
    return {
      source,
      totalFound: 0,
      newCaptured: 0,
      articles: [],
    };
  }

  // Capturar EXCLUSIVAMENTE a última matéria (a mais recente do portal/feed)
  const latestItem = items[0];
  const initialLink = latestItem.link?.trim();
  const initialTitle = latestItem.title?.trim();

  if (initialLink && initialTitle) {
    // 1. Verificação prévia de duplicação: se a última matéria já foi salva, ignora e nunca duplica
    if (dbRepo.checkArticleUrlExists(initialLink)) {
      console.log(`[Scraper] Última matéria já capturada anteriormente (${initialLink}). Nenhuma duplicação gerada.`);
    } else {
      // Extrair imagem inicial de fallback
      let imgUrl: string | null = null;
      if (latestItem.enclosure?.url) {
        imgUrl = latestItem.enclosure.url;
      } else if (latestItem.mediaContent?.$?.url) {
        imgUrl = latestItem.mediaContent.$.url;
      } else if (latestItem.mediaThumbnail?.$?.url) {
        imgUrl = latestItem.mediaThumbnail.$.url;
      } else {
        imgUrl = extractImageUrlFromHtml(latestItem.content || '');
      }

      // 2. Extração profunda com DOM/Cheerio (Arquitetura painel-agy)
      let extracted: any = null;
      try {
        extracted = await extractArticle(initialLink);
      } catch (e: any) {
        console.warn(`[Scraper] Extração profunda falhou para ${initialLink}, usando dados do feed:`, e.message);
      }

      const finalUrl = extracted?.url || extracted?.canonicalUrl || initialLink;
      if (finalUrl !== initialLink && dbRepo.checkArticleUrlExists(finalUrl)) {
        console.log(`[Scraper] URL canônica da última matéria já existe (${finalUrl}). Ignorando duplicação.`);
      } else {
        const finalTitle = extracted?.title || initialTitle;
        const finalSubtitle = extracted?.subtitle || undefined;
        const finalAuthor = extracted?.author || undefined;
        const finalCleanHtml = extracted?.cleanHtml || undefined;
        const finalCleanText = extracted?.cleanText || undefined;
        const finalExcerpt =
          (extracted?.paragraphs && extracted.paragraphs.length > 0 ? extracted.paragraphs[0] : '') ||
          (latestItem.contentSnippet ? cleanHtmlTags(latestItem.contentSnippet).slice(0, 250) : '');
        // Foto de destaque real extraída do DOM/Cheerio ou fallback do feed
        const finalImage = extracted?.featuredImage?.url || imgUrl;
        const finalMediaData = extracted
          ? {
              featuredImage: extracted.featuredImage,
              internalImages: extracted.internalImages,
              videos: extracted.videos,
            }
          : undefined;
        const finalTags = extracted?.tags && extracted.tags.length > 0 ? extracted.tags : [];
        const rawContent = finalCleanHtml || latestItem.content || latestItem.contentSnippet || finalTitle;

        let newArticle = dbRepo.createCapturedArticle({
          sourceId: source.id,
          sourceName: source.name,
          originalUrl: finalUrl,
          originalTitle: finalTitle,
          originalContent: rawContent,
          originalExcerpt: finalExcerpt,
          subtitle: finalSubtitle,
          author: finalAuthor,
          cleanHtml: finalCleanHtml,
          cleanText: finalCleanText,
          imageUrl: finalImage,
          mediaData: finalMediaData,
          tags: finalTags,
          publishedAt:
            extracted?.publishedAt ||
            (latestItem.pubDate ? new Date(latestItem.pubDate).toISOString() : new Date().toISOString()),
          status: 'pending',
          aiTitle: null,
          aiContent: null,
          aiExcerpt: null,
          aiSeoKeywords: [],
          wpPostId: null,
          wpSiteId: null,
          wpPermalink: null,
        });

        // 3. Upload para Cloudflare R2 Edge Storage
        const settings = dbRepo.getSystemSettings();
        if (settings.r2AutoSync !== false) {
          try {
            const r2Url = await uploadArticleJson(newArticle);
            if (r2Url) {
              newArticle = dbRepo.updateCapturedArticle(newArticle.id, { r2JsonUrl: r2Url }) || newArticle;
            }
          } catch (r2Err: any) {
            console.warn(`[Scraper] Erro ao sincronizar artigo ${newArticle.id} no R2:`, r2Err.message);
          }
        }

        newCount++;
        capturedList.push(newArticle);

        // 4. Auto-reescrever com IA se configurado na fonte
        if (source.autoRewrite) {
          try {
            const rewritten = await rewriteArticleWithAi(newArticle.id, {
              targetSiteId: source.targetSiteId || undefined,
              autoPublish: source.autoPublish,
            });
            if (rewritten) {
              newArticle = rewritten;
            }
          } catch (aiErr) {
            console.error(`[Scraper] Falha ao auto-reescrever artigo ${newArticle.id}:`, aiErr);
          }
        }
      }
    }
  }

  // 4. Atualizar feeds agregados no Cloudflare R2 (Recife Timezone)
  const currentSettings = dbRepo.getSystemSettings();
  if (currentSettings.r2AutoSync !== false) {
    try {
      const recentArticles = dbRepo.getCapturedArticles({ limit: 100 });
      await uploadFeedJson(recentArticles);
    } catch (feedErr: any) {
      console.warn('[Scraper] Erro ao sincronizar feeds agregados no R2:', feedErr.message);
    }
  }

  // Atualizar fonte com data do último scraping
  const updatedSource = dbRepo.updateNewsSource(source.id, {
    lastScrapedAt: new Date().toISOString(),
    articlesCount: (source.articlesCount || 0) + newCount,
  }) || source;

  dbRepo.appendAuditLog({
    actorId: source.userId,
    actorEmail: 'system',
    actorRole: 'admin',
    action: 'SCRAPING_RUN_SUCCESS',
    category: 'scraping',
    resource: source.url,
    status: 'success',
    ipAddress: '127.0.0.1',
    latencyMs: 120,
    metadata: {
      sourceId: source.id,
      sourceName: source.name,
      found: items.length,
      newCaptured: newCount,
    },
  });

  return {
    source: updatedSource,
    totalFound: items.length,
    newCaptured: newCount,
    articles: capturedList,
  };
}

export async function rewriteArticleWithAi(
  articleId: string,
  options?: Omit<ArticleRewriteOptions, 'articleId'>
): Promise<CapturedArticle> {
  const article = dbRepo.getCapturedArticleById(articleId);
  if (!article) {
    throw new Error(`Artigo com ID ${articleId} não encontrado.`);
  }

  dbRepo.updateCapturedArticle(articleId, { status: 'rewriting' });

  const settings = dbRepo.getSystemSettings();
  let targetSite: any = null;
  if (options?.targetSiteId) {
    targetSite = dbRepo.getWordPressSiteById(options.targetSiteId);
  }

  const tone = options?.tone || targetSite?.aiTone || settings.defaultRewriteTone || 'jornalistico';
  const provider = options?.model || targetSite?.aiProvider || settings.aiProvider || 'openrouter';
  const model = targetSite?.aiModel || (provider === 'openrouter' ? settings.openRouterModel : (provider === 'gemini' ? settings.geminiModel : settings.llamaModel));

  const systemPrompt = settings.aiSystemPrompt || `Você é um jornalista sênior, editor-chefe e especialista em SEO para WordPress.
Sua missão é transformar a notícia original em uma reportagem 100% autoral, informativa, envolvente e otimizada para os mecanismos de busca.
REGRAS OBRIGATÓRIAS:
1. NUNCA faça cópia literal (evite plágio). Reescreva do zero trazendo clareza, contexto e dados.
2. O conteúdo DEVE estar em HTML limpo, usando títulos <h2>, subtítulos <h3>, parágrafos <p> bem elaborados e listas <ul><li> com os pontos-chave quando relevante.
3. Não inclua tags de documento como <html>, <body>, <head> ou <!DOCTYPE>.
4. Crie um Título cativante e forte para atrair leitores (sem ser sensacionalista falso).
5. Gere uma Meta Descrição (resumo de até 160 caracteres com gatilho de clique).
6. Gere de 3 a 6 tags/palavras-chave estratégicas.
7. Responda ESTRITAMENTE em formato JSON com as chaves:
   - "title": string
   - "content": string (HTML formatado)
   - "excerpt": string (até 160 caracteres)
   - "keywords": string[] (array de strings)
Não inclua nenhuma outra palavra ou markdown fora do JSON.`;

  const baseContent = (article.cleanText || cleanHtmlTags(article.cleanHtml || '') || article.originalContent || '').slice(0, 4500);

  const userPrompt = `Notícia Original:
Título: ${article.originalTitle}
${article.subtitle ? `Subtítulo: ${article.subtitle}\n` : ''}${article.author ? `Autor: ${article.author}\n` : ''}Link Original: ${article.originalUrl}
Trecho / Conteúdo Base:
${baseContent}

Tom editorial desejado: ${tone}
Por favor, reescreva em português com padrão editorial profissional e otimizado para SEO.`;

  try {
    const aiResult = await executeLlmPrompt({
      provider,
      model,
      prompt: userPrompt,
      systemInstruction: systemPrompt,
    });

    let parsed: {
      title?: string;
      content?: string;
      excerpt?: string;
      keywords?: string[];
    } = {};

    try {
      // Remove possíveis blocos markdown como ```json ... ```
      const cleaned = aiResult.output.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback se não for JSON puro
      parsed = {
        title: article.originalTitle,
        content: `<p>${aiResult.output.replace(/\n\n/g, '</p><p>')}</p>`,
        excerpt: article.originalExcerpt || '',
        keywords: ['noticias', 'tecnologia', 'atualidades'],
      };
    }

    let updated = dbRepo.updateCapturedArticle(articleId, {
      status: 'ready',
      aiTitle: parsed.title || article.originalTitle,
      aiContent: parsed.content || article.originalContent,
      aiExcerpt: parsed.excerpt || article.originalExcerpt,
      aiSeoKeywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    });

    if (!updated) {
      throw new Error('Falha ao salvar artigo reescrito.');
    }

    // Se autoPublish estiver ativado e houver um site de destino
    if (options?.autoPublish && options?.targetSiteId) {
      await syncArticleToWordPress(articleId, options.targetSiteId);
      // Recarrega o artigo atualizado com os links do WordPress
      updated = dbRepo.getCapturedArticleById(articleId) || updated;
    }

    // Sincroniza artigo reescrito com o Cloudflare R2
    if (settings.r2AutoSync !== false) {
      try {
        const r2Url = await uploadArticleJson(updated);
        if (r2Url && r2Url !== updated.r2JsonUrl) {
          updated = dbRepo.updateCapturedArticle(articleId, { r2JsonUrl: r2Url }) || updated;
        }
      } catch (r2Err: any) {
        console.warn(`[Scraper] Falha ao atualizar R2 após reescrita do artigo ${articleId}:`, r2Err.message);
      }
    }

    return updated;
  } catch (error: any) {
    dbRepo.updateCapturedArticle(articleId, {
      status: 'error',
      errorMessage: error.message || 'Erro na geração de IA',
    });
    throw error;
  }
}

/**
 * Força a sincronização de um artigo com o Cloudflare R2
 */
export async function syncArticleToR2(articleId: string): Promise<string | null> {
  const article = dbRepo.getCapturedArticleById(articleId);
  if (!article) {
    throw new Error(`Artigo com ID ${articleId} não encontrado.`);
  }
  const r2Url = await uploadArticleJson(article);
  if (r2Url) {
    dbRepo.updateCapturedArticle(articleId, { r2JsonUrl: r2Url });
  }
  return r2Url;
}

/**
 * Sincroniza todos os artigos capturados para o Cloudflare R2
 */
export async function syncAllArticlesToR2(): Promise<{ total: number; synced: number; feedsSynced: boolean }> {
  const articles = dbRepo.getCapturedArticles({ limit: 500 });
  let synced = 0;

  for (const art of articles) {
    try {
      const url = await uploadArticleJson(art);
      if (url) {
        dbRepo.updateCapturedArticle(art.id, { r2JsonUrl: url });
        synced++;
      }
    } catch (e: any) {
      console.warn(`[R2 Sync All] Falha no artigo ${art.id}:`, e.message);
    }
  }

  let feedsSynced = false;
  try {
    const feedResult = await uploadFeedJson(articles);
    feedsSynced = Boolean(feedResult);
  } catch (feedErr: any) {
    console.warn('[R2 Sync All] Falha ao sincronizar feeds:', feedErr.message);
  }

  return { total: articles.length, synced, feedsSynced };
}

/**
 * Atualiza feeds agregados particionados por fuso de Recife no Cloudflare R2
 */
export async function syncFeedsToR2(): Promise<any> {
  const articles = dbRepo.getCapturedArticles({ limit: 200 });
  return await uploadFeedJson(articles);
}
