import Parser from 'rss-parser';
import { dbRepo } from '../db/repository';
import { executeLlmPrompt } from './llm-gateway';
import { CapturedArticle, NewsSource, ArticleRewriteOptions } from '../../shared/types';
import { syncArticleToWordPress } from './wordpress-sync';

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

  for (const item of items.slice(0, 15)) {
    const link = item.link?.trim();
    const title = item.title?.trim();
    if (!link || !title) continue;

    // Verificar se artigo já existe
    if (dbRepo.checkArticleUrlExists(link)) {
      continue;
    }

    // Extrair imagem
    let imgUrl: string | null = null;
    if (item.enclosure?.url) {
      imgUrl = item.enclosure.url;
    } else if (item.mediaContent?.$?.url) {
      imgUrl = item.mediaContent.$.url;
    } else if (item.mediaThumbnail?.$?.url) {
      imgUrl = item.mediaThumbnail.$.url;
    } else {
      imgUrl = extractImageUrlFromHtml(item.content || '');
    }

    const excerpt = item.contentSnippet ? cleanHtmlTags(item.contentSnippet).slice(0, 250) : '';
    const rawContent = item.content || item.contentSnippet || title;

    const newArticle = dbRepo.createCapturedArticle({
      sourceId: source.id,
      sourceName: source.name,
      originalUrl: link,
      originalTitle: title,
      originalContent: rawContent,
      originalExcerpt: excerpt,
      imageUrl: imgUrl,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      status: 'pending',
      aiTitle: null,
      aiContent: null,
      aiExcerpt: null,
      aiSeoKeywords: [],
      wpPostId: null,
      wpSiteId: null,
      wpPermalink: null,
    });

    newCount++;
    capturedList.push(newArticle);

    // Auto-reescrever se configurado na fonte
    if (source.autoRewrite) {
      try {
        await rewriteArticleWithAi(newArticle.id, {
          targetSiteId: source.targetSiteId || undefined,
          autoPublish: source.autoPublish,
        });
      } catch (aiErr) {
        console.error(`[Scraper] Falha ao auto-reescrever artigo ${newArticle.id}:`, aiErr);
      }
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

  const tone = options?.tone || 'jornalistico';
  const provider = options?.model || 'gemini';

  const systemPrompt = `Você é um jornalista sênior, editor-chefe e especialista em SEO para WordPress.
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

  const userPrompt = `Notícia Original:
Título: ${article.originalTitle}
Link Original: ${article.originalUrl}
Trecho / Conteúdo Base:
${article.originalContent.slice(0, 3000)}

Tom desejado: ${tone}
Por favor, reescreva em português com padrão editorial profissional.`;

  try {
    const aiResult = await executeLlmPrompt({
      provider,
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

    const updated = dbRepo.updateCapturedArticle(articleId, {
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
