import * as cheerio from 'cheerio';
import { ArticleMediaData } from '../../shared/types';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface ExtractedArticleData {
  url: string;
  originalUrl: string;
  title: string;
  subtitle: string;
  author: string;
  publishedAt: string;
  publishedAtRaw: string;
  category: string;
  tags: string[];
  featuredImage: {
    url: string;
    alt?: string;
    title?: string;
    caption?: string;
  } | null;
  internalImages: Array<{
    url: string;
    alt?: string;
    caption?: string;
  }>;
  videos: Array<{
    type: string;
    url: string;
    title?: string;
    thumbnail?: string;
    description?: string;
  }>;
  cleanHtml: string;
  cleanText: string;
  paragraphs: string[];
}

/**
 * Normaliza e limpa string de texto
 */
export function cleanText(text: any): string {
  if (!text) return '';
  if (typeof text === 'object') {
    if (text['@value']) text = text['@value'];
    else if (Array.isArray(text)) text = text.join(' ');
    else if (text.name) text = text.name;
    else text = String(text);
  }
  if (typeof text !== 'string') text = String(text);
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Remove sufixos de portais no título (ex: "Notícia tal | G1", "Eleições - UOL")
 */
export function cleanPortalSuffix(title: string): string {
  if (!title) return '';
  return title
    .replace(
      /\s*[-|–—]\s*(G1|Globo|UOL|Folha de S\.Paulo|Estadão|CNN Brasil|R7|Aeroin|ESPN|ESPN Brasil|ndmais\.com\.br|Terra|Metrópoles|Exame|InfoMoney|Canaltech|TecMundo|O Globo).*$/i,
      ''
    )
    .trim();
}

/**
 * Resolve links de redirecionamento do Google News (CBMi...) para a URL real de destino
 */
export async function resolveGoogleNewsUrl(gnewsUrl: string): Promise<string> {
  if (!gnewsUrl || !gnewsUrl.includes('news.google.com')) return gnewsUrl;

  try {
    const res = await fetch(gnewsUrl, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    const html = await res.text();
    const match = html.match(
      /data-n-a-id="([^"]+)"[^>]+data-n-a-ts="([^"]+)"[^>]+data-n-a-sg="([^"]+)"/
    );
    if (!match) return res.url || gnewsUrl;

    const [_, id, ts, sg] = match;

    const payload = [
      [
        'Fbv4je',
        JSON.stringify([
          'garturlreq',
          [
            ['pt-BR', 'BR', ['FINANCE_TOP_INDICES', 'GENESIS_PUBLISHER_SECTION', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'BR:pt-419', null, null, null, null, null, null, null, false, 5],
            'pt-BR',
            'BR',
            true,
            [3, 5, 9, 19],
            1,
            true,
            '974867285',
            false,
            false,
            null,
            false,
          ],
          id,
          Number(ts),
          sg,
        ]),
        null,
        'generic',
      ],
    ];

    const freq = 'f.req=' + encodeURIComponent(JSON.stringify([payload]));
    const rpcRes = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      body: freq,
      signal: AbortSignal.timeout(10000),
    });

    const rpcText = await rpcRes.text();
    const urlMatches =
      rpcText.match(/https?:\\\/\\\/[^\s\\",\]]+/g) ||
      rpcText.match(/https?:\/\/[^\s\\",\]]+/g);

    if (urlMatches) {
      for (const u of urlMatches) {
        const clean = u.replace(/\\\//g, '/');
        if (!clean.includes('google.com')) {
          return clean;
        }
      }
    }
  } catch (err: any) {
    console.warn('[Extractor] Falha ao resolver URL do Google News:', err.message);
  }

  return gnewsUrl;
}

/**
 * Extrai dados completos, mídias e conteúdo limpo da página do artigo (método Painel AGY)
 */
export async function extractArticle(
  rawUrl: string,
  fallbackData: {
    title?: string;
    summary?: string;
    category?: string;
    publishedAt?: string;
    publishedAtRaw?: string;
    author?: string;
  } = {}
): Promise<ExtractedArticleData> {
  const finalUrl = await resolveGoogleNewsUrl(rawUrl);
  let html = '';

  try {
    const res = await fetch(finalUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      html = await res.text();
    }
  } catch (err: any) {
    console.warn(`[Extractor] Falha no fetch HTTP direto para ${finalUrl}: ${err.message}`);
  }

  // Fallback se página vazia ou inacessível
  if (!html || html.length < 200) {
    return {
      url: finalUrl,
      originalUrl: rawUrl,
      title: fallbackData.title || '',
      subtitle: fallbackData.summary || '',
      author: fallbackData.author || 'Redação',
      publishedAt: fallbackData.publishedAt || new Date().toISOString(),
      publishedAtRaw: fallbackData.publishedAtRaw || 'Recente',
      category: fallbackData.category || 'Geral',
      tags: [],
      featuredImage: null,
      internalImages: [],
      videos: [],
      cleanHtml: fallbackData.summary ? `<p>${fallbackData.summary}</p>` : '',
      cleanText: fallbackData.summary || '',
      paragraphs: fallbackData.summary ? [fallbackData.summary] : [],
    };
  }

  const $ = cheerio.load(html);

  // Extrai dados estruturados Schema.org (NewsArticle / Article / VideoObject)
  let ldArticle: any = null;
  const ldVideos: any[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed)
        ? parsed
        : parsed['@graph']
        ? parsed['@graph']
        : [parsed];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = item['@type'];
        if (type === 'NewsArticle' || type === 'Article' || type === 'BlogPosting') {
          ldArticle = item;
        } else if (type === 'VideoObject') {
          ldVideos.push(item);
        }
      }
    } catch (_) {}
  });

  // 1. Título
  const rawTitle =
    (ldArticle && ldArticle.headline) ||
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('h1').first().text() ||
    $('title').text() ||
    fallbackData.title ||
    '';
  const title = cleanPortalSuffix(cleanText(rawTitle));

  // 2. Subtítulo / Descrição
  const rawSubtitle =
    (ldArticle && ldArticle.description) ||
    $('.content-head__subtitle').first().text() ||
    $('.article__subtitle').first().text() ||
    $('.subtitle').first().text() ||
    $('h2.lead').first().text() ||
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    fallbackData.summary ||
    '';
  const subtitle = cleanText(rawSubtitle);

  // 3. Autor
  let rawAuthor = '';
  if (ldArticle && ldArticle.author) {
    if (typeof ldArticle.author === 'string') rawAuthor = ldArticle.author;
    else if (Array.isArray(ldArticle.author))
      rawAuthor = ldArticle.author.map((a: any) => a.name || a).filter(Boolean).join(', ');
    else if (ldArticle.author.name) rawAuthor = ldArticle.author.name;
  }
  if (!rawAuthor) {
    rawAuthor =
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('.content-publication-data__from').first().text() ||
      $('.author-name').first().text() ||
      $('.author').first().text() ||
      $('[rel="author"]').first().text() ||
      fallbackData.author ||
      'Redação';
  }
  const author = cleanText(rawAuthor).replace(/^Por\s+/i, '');

  // 4. Tags / Palavras-chave
  const tagsSet = new Set<string>();
  const metaKeywords = $('meta[name="keywords"]').attr('content');
  if (metaKeywords) {
    metaKeywords.split(',').forEach((t) => {
      const tag = cleanText(t);
      if (tag && tag.length > 1 && tag.length < 50) tagsSet.add(tag);
    });
  }
  $('meta[property="article:tag"]').each((_, el) => {
    const val = cleanText($(el).attr('content'));
    if (val) tagsSet.add(val);
  });
  $('.content-tags a, .tags a, .c-tags__link').each((_, el) => {
    const val = cleanText($(el).text());
    if (val) tagsSet.add(val);
  });
  const tags = Array.from(tagsSet);

  // 5. Imagem de Destaque
  let featuredImageUrl =
    (ldArticle &&
      ldArticle.image &&
      (typeof ldArticle.image === 'string' ? ldArticle.image : ldArticle.image.url)) ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('.article-body figure img').first().attr('src') ||
    $('article figure img').first().attr('src') ||
    $('figure img').first().attr('src') ||
    null;

  let featuredImage: ExtractedArticleData['featuredImage'] = null;
  if (featuredImageUrl) {
    let featuredCaption = '';
    const firstFigure = $('.article-body figure, article figure, figure, .inline-photo').first();
    if (firstFigure.length) {
      featuredCaption = cleanText(
        firstFigure.find('figcaption, .photoCaption, .foto-legenda, .caption').text()
      );
    }
    featuredImage = {
      url: featuredImageUrl,
      alt: title,
      title: title,
      caption: featuredCaption || '',
    };
  }

  // Imagens internas com legenda
  const internalImages: ExtractedArticleData['internalImages'] = [];
  $(
    '.article-body figure, article figure, .content-text figure, .entry-content figure, figure, .inline-photo'
  ).each((_, fig) => {
    let src = '';
    const sourceEl = $(fig).find('picture source').first();
    if (sourceEl.length) {
      const srcset = sourceEl.attr('data-srcset') || sourceEl.attr('srcset') || '';
      if (srcset) {
        src = srcset.split(',')[0].trim().split(' ')[0];
      }
    }
    if (!src) {
      const img = $(fig).find('img');
      src = img.attr('src') || img.attr('data-src') || img.attr('data-default-src') || '';
    }

    if (
      src &&
      !src.includes('data:image') &&
      !src.includes('avatar') &&
      !src.includes('logo') &&
      !src.includes('icon')
    ) {
      const alt = cleanText($(fig).find('img').attr('alt') || '');
      const caption = cleanText(
        $(fig).find('figcaption, .photoCaption, .foto-legenda, .caption').text()
      );
      if (!internalImages.some((i) => i.url === src)) {
        internalImages.push({
          url: src,
          alt: alt || title,
          caption: caption || '',
        });
      }
    }
  });

  // 6. Vídeos (JSON-LD VideoObject, Globoplay, YouTube, HTML5)
  const videos: ExtractedArticleData['videos'] = [];

  for (const item of ldVideos) {
    const vUrl = item.contentUrl || item.embedUrl || '';
    if (vUrl && !videos.some((v) => v.url === vUrl)) {
      const isMp4 = vUrl.endsWith('.mp4') || vUrl.includes('.mp4');
      const isHls = vUrl.endsWith('.m3u8') || vUrl.includes('.m3u8');
      videos.push({
        type: isMp4 ? 'mp4' : isHls ? 'hls' : 'video_object',
        title: cleanText(item.name || title),
        url: vUrl,
        thumbnail: item.thumbnailUrl || item.thumbnailURL || '',
        description: cleanText(item.description || ''),
      });
    }
  }

  // Globoplay data attributes
  $('[data-video-id]').each((_, el) => {
    const vId = $(el).attr('data-video-id');
    const vTitle = $(el).attr('data-video-title') || title;
    if (vId) {
      videos.push({
        type: 'globoplay',
        url: `https://globoplay.globo.com/v/${vId}/`,
        title: cleanText(vTitle),
      });
    }
  });

  // YouTube / Vimeo iframes
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.includes('youtube.com') || src.includes('youtu.be')) {
      videos.push({ type: 'youtube', url: src, title });
    } else if (src.includes('vimeo.com')) {
      videos.push({ type: 'vimeo', url: src, title });
    }
  });

  // HTML5 Video sources
  $('video source, video').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src && !videos.some((v) => v.url === src)) {
      videos.push({
        type: src.includes('.m3u8') ? 'hls' : 'mp4',
        url: src,
        title,
      });
    }
  });

  // 7. Limpeza rigorosa de ruídos, anúncios e banners
  $('aside.editorial, aside[class*="editorial"], .inline.editorial, .content-reactions, .article-meta').remove();
  $('script, style, noscript, svg, header, footer, nav, aside').remove();
  $(
    '[id*="ad-"], [class*="ad-"], [class*="ads-"], [class*="advertisement"], ' +
      '[class*="publicidade"], [class*="anuncio"], .banner, .outbrain, .taboola, ' +
      '.teads, ins.adsbygoogle, .globo-ads, .publi, [data-ad], .sponsored, ' +
      '.leia-mais, .veja-tambem, .materia-relacionada, .related-posts, ' +
      '.compartilhar, .share-bar, .social-share, .comments, .newsletter-box, ' +
      '.box-leia-mais, .widget, .floating-banner'
  ).remove();

  const mainArticle = $('.article-body').length
    ? $('.article-body')
    : $('article').length
    ? $('article')
    : $('.content-text__default').length
    ? $('.content-text__default').parent()
    : $('.entry-content').length
    ? $('.entry-content')
    : $('.story-container').length
    ? $('.story-container')
    : $('main').length
    ? $('main')
    : $('body');

  const paragraphs: string[] = [];
  const cleanHtmlParts: string[] = [];

  mainArticle.find('p, h2, h3, h4, blockquote, ul, ol').each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase() || 'p';
    const text = cleanText($(el).text());

    if (!text || text.length < 15) return;
    if (
      /^(você está na edição brasil|você deve logar|leia também|veja também|leia mais|assista|confira o vídeo|foto:|crédito:)/i.test(
        text
      )
    )
      return;

    paragraphs.push(text);

    if (tag.startsWith('h')) {
      cleanHtmlParts.push(`<${tag}>${text}</${tag}>`);
    } else if (tag === 'blockquote') {
      cleanHtmlParts.push(`<blockquote><p>${text}</p></blockquote>`);
    } else if (tag === 'ul' || tag === 'ol') {
      const lis: string[] = [];
      $(el)
        .find('li')
        .each((__, li) => {
          const liText = cleanText($(li).text());
          if (liText) lis.push(`<li>${liText}</li>`);
        });
      if (lis.length) cleanHtmlParts.push(`<${tag}>${lis.join('')}</${tag}>`);
    } else {
      cleanHtmlParts.push(`<p>${text}</p>`);
    }
  });

  const cleanHtml = cleanHtmlParts.join('\n');
  const cleanContentText = paragraphs.join('\n\n');

  return {
    url: finalUrl,
    originalUrl: rawUrl,
    title,
    subtitle,
    author,
    publishedAt: fallbackData.publishedAt || new Date().toISOString(),
    publishedAtRaw: fallbackData.publishedAtRaw || 'Recente',
    category: fallbackData.category || 'Geral',
    tags,
    featuredImage,
    internalImages,
    videos,
    cleanHtml,
    cleanText: cleanContentText,
    paragraphs,
  };
}
