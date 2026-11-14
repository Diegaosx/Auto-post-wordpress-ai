/**
 * scripts/collector_runner.js
 * 
 * Standalone Daemon do Coletor de Pautas e Scraping para VPS Ubuntu ou Servidor Dedicado.
 * Compatível com PM2:
 *   pm2 start scripts/collector_runner.js --name "collector-daemon"
 *   pm2 save
 *   pm2 startup
 * 
 * Arquitetura:
 * - Scraping contínuo de fontes RSS, Google News e Portais
 * - Sanitização profunda do DOM com Cheerio
 * - Armazenamento persistente no PostgreSQL (tabelas captured_items e captured_articles)
 * - Sincronização automática para Cloudflare R2 Edge Storage (artigos/<id>.json)
 * - Agregação e particionamento temporal no Fuso Horário de Recife (feed/recentes.json, etc.)
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const { Pool } = pg;

// ============================================================================
// CONFIGURAÇÕES E CLIENTS
// ============================================================================
const DATABASE_URL = process.env.DATABASE_URL || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
const INTERVAL_MINUTES = parseInt(process.env.COLLECTOR_INTERVAL_MINUTES || '5', 10);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('proxy.rlwy.net') ? { rejectUnauthorized: false } : undefined,
  });
}

function getR2Client() {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return null;
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

const r2Client = getR2Client();

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

// ============================================================================
// UTILITÁRIOS
// ============================================================================
function generateHash(input) {
  return crypto.createHash('sha256').update(String(input).trim()).digest('hex');
}

function cleanUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
    stripParams.forEach((p) => parsed.searchParams.delete(p));
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function getRecifeDateInfo(dateObj = new Date()) {
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
  }, {});

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hourNum = parseInt(parts.hour || '0', 10) || 0;
  const slotStart = Math.floor(hourNum / 6) * 6;
  const slotEnd = slotStart + 6;
  const slotStr = `${String(slotStart).padStart(2, '0')}h-${String(slotEnd).padStart(2, '0')}h`;

  return {
    date: dateStr,
    hour: hourNum,
    slot: slotStr,
    recifeIso: `${dateStr}T${parts.hour}:${parts.minute}:${parts.second}-03:00`,
  };
}

async function uploadJsonToR2(key, payload, maxAgeSeconds = 300) {
  if (!r2Client) return null;
  const body = JSON.stringify(payload, null, 2);
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: Buffer.from(body, 'utf-8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}`,
  });
  await r2Client.send(command);
  return `${R2_PUBLIC_URL}/${key}`;
}

// ============================================================================
// RESOLVER GOOGLE NEWS E DEEP EXTRACTION COM CHEERIO
// ============================================================================
async function resolveGoogleNewsUrl(googleUrl) {
  if (!googleUrl.includes('news.google.com')) return googleUrl;
  try {
    const res = await fetch(googleUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (res.url && !res.url.includes('news.google.com')) {
      return res.url;
    }
    const html = await res.text();
    const match = html.match(/data-n-au=["'](https?:\/\/[^"']+)["']/i);
    if (match && match[1]) return match[1];
    return res.url || googleUrl;
  } catch {
    return googleUrl;
  }
}

async function extractArticle(url) {
  const targetUrl = await resolveGoogleNewsUrl(url);
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove ruídos publicitários
    $('script, style, noscript, iframe, header, footer, nav, aside, .advertisement, .adsbygoogle, .banner, .social-share, .cookie-banner').remove();

    // Título
    let title = $('meta[property="og:title"]').attr('content') ||
                $('meta[name="twitter:title"]').attr('content') ||
                $('h1').first().text().trim() ||
                $('title').text().trim();
    title = title.replace(/\s*[-–|].*$/, '').trim();

    // Subtítulo
    const subtitle = $('meta[name="description"]').attr('content') ||
                     $('meta[property="og:description"]').attr('content') ||
                     $('.article-subtitle, .lead, .subtitle').first().text().trim();

    // Autor
    const author = $('meta[name="author"]').attr('content') ||
                   $('meta[property="article:author"]').attr('content') ||
                   $('.author, .byline, [rel="author"]').first().text().trim();

    // Imagem Destacada
    const featuredImage = $('meta[property="og:image"]').attr('content') ||
                          $('meta[name="twitter:image"]').attr('content') ||
                          $('article img').first().attr('src');

    // Conteúdo Principal
    const contentSelectors = [
      'article',
      '[itemprop="articleBody"]',
      '.article-body',
      '.post-content',
      '.entry-content',
      '.content-body',
      'main',
    ];

    let $body = null;
    for (const sel of contentSelectors) {
      if ($(sel).length > 0) {
        $body = $(sel);
        break;
      }
    }
    if (!$body) $body = $('body');

    const paragraphs = [];
    $body.find('p, h2, h3, ul').each((_, el) => {
      const txt = $(el).text().trim();
      if (txt.length > 20 && !txt.toLowerCase().includes('leia também') && !txt.toLowerCase().includes('inscreva-se')) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'h2' || tag === 'h3') {
          paragraphs.push(`<${tag}>${txt}</${tag}>`);
        } else if (tag === 'ul') {
          paragraphs.push(`<ul>${$(el).html()}</ul>`);
        } else {
          paragraphs.push(`<p>${txt}</p>`);
        }
      }
    });

    const cleanHtml = paragraphs.join('\n');
    const cleanText = paragraphs.map(p => p.replace(/<[^>]+>/g, '')).join('\n\n');

    return {
      canonicalUrl: targetUrl,
      title,
      subtitle: subtitle || null,
      author: author || null,
      featuredImageUrl: featuredImage || null,
      cleanContentHtml: cleanHtml,
      cleanContentText: cleanText,
      summary: (cleanText.slice(0, 250) + (cleanText.length > 250 ? '...' : '')).trim(),
    };
  } catch (err) {
    return {
      canonicalUrl: targetUrl,
      title: '',
      subtitle: null,
      author: null,
      featuredImageUrl: null,
      cleanContentHtml: '',
      cleanContentText: '',
      summary: '',
    };
  }
}

// ============================================================================
// COLETA E PROCESSAMENTO DE FONTES
// ============================================================================
async function getActiveSources() {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT id, name, type, url, category, auto_publish, 1 as is_active 
      FROM news_sources 
      WHERE active = true
      UNION
      SELECT id, name, type, url, category, auto_publish, is_active 
      FROM sources 
      WHERE is_active = 1
    `);
    const seen = new Set();
    const unique = [];
    for (const row of res.rows) {
      if (!seen.has(row.id) && !seen.has(row.url)) {
        seen.add(row.id);
        seen.add(row.url);
        unique.push(row);
      }
    }
    return unique;
  } catch (err) {
    console.error('[Collector Daemon] Erro ao buscar fontes ativas:', err.message);
    return [];
  }
}

async function processSource(source) {
  console.log(`[Collector Daemon] Processando fonte: "${source.name}" (${source.url})`);
  let xmlText = '';

  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xmlText = await res.text();
  } catch (err) {
    console.warn(`[Collector Daemon] Falha ao baixar feed de ${source.name}: ${err.message}`);
    return 0;
  }

  const parsed = xmlParser.parse(xmlText);
  const channel = parsed?.rss?.channel || parsed?.feed;
  if (!channel) {
    console.warn(`[Collector Daemon] Estrutura XML inválida ou sem canal: ${source.name}`);
    return 0;
  }

  const rawItems = channel.item || channel.entry || [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  let capturedCount = 0;

  for (const item of items.slice(0, 10)) {
    let link = item.link;
    if (typeof link === 'object' && link['@_href']) link = link['@_href'];
    const title = item.title ? (typeof item.title === 'string' ? item.title : item.title['#text']) : '';
    if (!link || !title) continue;

    const targetUrl = cleanUrl(String(link).trim());
    const hashId = generateHash(targetUrl);

    // Verifica se já foi capturado
    if (pool) {
      const existsRes = await pool.query(
        'SELECT id FROM captured_items WHERE id = $1 UNION SELECT id FROM captured_articles WHERE original_url = $2',
        [hashId, targetUrl]
      );
      if (existsRes.rows.length > 0) continue;
    }

    // Extração profunda com Cheerio
    const extracted = await extractArticle(targetUrl);
    const finalTitle = extracted.title || title;
    const cleanHtml = extracted.cleanContentHtml || item.description || title;
    const cleanText = extracted.cleanContentText || extracted.summary;
    const featuredImage = extracted.featuredImageUrl || null;
    const recifeInfo = getRecifeDateInfo();

    const articlePayload = {
      id: hashId,
      source_id: source.id,
      source_name: source.name,
      category: source.category || 'Geral',
      title: finalTitle,
      subtitle: extracted.subtitle,
      author: extracted.author,
      url: targetUrl,
      summary: extracted.summary,
      clean_content_html: cleanHtml,
      clean_content_text: cleanText,
      published_at: recifeInfo.recifeIso,
      captured_at: new Date().toISOString(),
      recife_date: recifeInfo.date,
      recife_slot: recifeInfo.slot,
      status: 'new',
      featured_image_url: featuredImage,
    };

    // 1. Upload individual para Cloudflare R2
    let r2Url = null;
    try {
      r2Url = await uploadJsonToR2(`artigos/${hashId}.json`, articlePayload, 86400);
      articlePayload.r2_json_url = r2Url;
    } catch (r2Err) {
      console.warn(`[Collector Daemon] Falha ao enviar para R2: ${r2Err.message}`);
    }

    // 2. Persistir no PostgreSQL (ambas tabelas)
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO captured_items (
             id, source_id, source_name, category, title, subtitle, author, url, summary,
             clean_content_html, clean_content_text, published_at, captured_at, status, r2_json_url, featured_image_url
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15)
           ON CONFLICT (id) DO NOTHING`,
          [
            hashId,
            source.id,
            source.name,
            source.category || 'Geral',
            finalTitle,
            extracted.subtitle,
            extracted.author,
            targetUrl,
            extracted.summary,
            cleanHtml,
            cleanText,
            recifeInfo.recifeIso,
            'new',
            r2Url,
            featuredImage,
          ]
        );

        await pool.query(
          `INSERT INTO captured_articles (
             id, source_id, source_name, original_url, original_title, original_content, original_excerpt,
             subtitle, author, clean_html, clean_text, r2_json_url, image_url, status, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
           ON CONFLICT (original_url) DO NOTHING`,
          [
            hashId,
            source.id,
            source.name,
            targetUrl,
            finalTitle,
            cleanHtml,
            extracted.summary,
            extracted.subtitle,
            extracted.author,
            cleanHtml,
            cleanText,
            r2Url,
            featuredImage,
            'pending',
          ]
        );
      } catch (dbErr) {
        console.error('[Collector Daemon] Erro salvando no DB:', dbErr.message);
      }
    }

    capturedCount++;
    console.log(`[Collector Daemon] [+] Artigo capturado: "${finalTitle}" -> R2: ${r2Url || 'local'}`);
  }

  return capturedCount;
}

// ============================================================================
// ATUALIZAÇÃO DOS FEEDS AGREGADOS NO R2 (Recife Timezone)
// ============================================================================
async function syncAggregatedFeedsToR2() {
  if (!pool || !r2Client) return;

  try {
    const res = await pool.query(`
      SELECT id, source_id, source_name, category, title, subtitle, author, url, summary,
             published_at, captured_at, r2_json_url, featured_image_url
      FROM captured_items
      ORDER BY captured_at DESC
      LIMIT 100
    `);

    const feedItems = res.rows;
    if (feedItems.length === 0) return;

    const recifeNow = getRecifeDateInfo();

    // 1. Feed Global de Recentes
    await uploadJsonToR2('feed/recentes.json', {
      timezone: 'America/Recife (UTC-3)',
      recife_now: recifeNow.recifeIso,
      updated_at: new Date().toISOString(),
      total_items: feedItems.length,
      items: feedItems.slice(0, 50),
    }, 60);

    // 2. Particionamento por Fonte
    const bySource = {};
    for (const it of feedItems) {
      if (!bySource[it.source_id]) bySource[it.source_id] = [];
      bySource[it.source_id].push(it);
    }

    for (const [sourceId, items] of Object.entries(bySource)) {
      await uploadJsonToR2(`feed/fontes/${sourceId}.json`, {
        total: items.length,
        items,
      }, 120);

      // Partição 6h
      await uploadJsonToR2(`feed/fontes/${sourceId}/${recifeNow.date}/${recifeNow.slot}.json`, {
        total: items.length,
        slot: recifeNow.slot,
        date: recifeNow.date,
        items,
      }, 300);
    }

    // 3. Manifest Geral
    await uploadJsonToR2('feed/index.json', {
      cdn_base: R2_PUBLIC_URL,
      timezone: 'America/Recife (UTC-3)',
      updated_at: new Date().toISOString(),
      recentes: `${R2_PUBLIC_URL}/feed/recentes.json`,
      total_recentes: feedItems.length,
    }, 60);

    console.log('[Collector Daemon] Feeds agregados e particionados atualizados no Cloudflare R2 com sucesso.');
  } catch (err) {
    console.warn('[Collector Daemon] Erro atualizando feeds agregados:', err.message);
  }
}

// ============================================================================
// LOOP PRINCIPAL DO DAEMON
// ============================================================================
async function runCycle() {
  console.log(`\n======================================================`);
  console.log(`[Collector Daemon] Iniciando ciclo em ${new Date().toISOString()}`);
  console.log(`======================================================`);

  const sources = await getActiveSources();
  console.log(`[Collector Daemon] Encontradas ${sources.length} fontes ativas.`);

  let totalCaptured = 0;
  for (const source of sources) {
    try {
      const count = await processSource(source);
      totalCaptured += count;
    } catch (err) {
      console.error(`[Collector Daemon] Falha na fonte ${source.name}:`, err.message);
    }
  }

  if (totalCaptured > 0) {
    console.log(`[Collector Daemon] Sincronizando feeds agregados para ${totalCaptured} novas notícias...`);
    await syncAggregatedFeedsToR2();
  }

  console.log(`[Collector Daemon] Ciclo finalizado com sucesso. ${totalCaptured} novas matérias salvas.`);
}

async function start() {
  console.log('----------------------------------------------------');
  console.log('  AUTO POST WORDPRESS AI — STANDALONE SCRAPING DAEMON');
  console.log('----------------------------------------------------');
  console.log(`Intervalo: a cada ${INTERVAL_MINUTES} minutos.`);
  console.log(`R2 Bucket: ${R2_BUCKET_NAME}`);
  console.log(`R2 CDN: ${R2_PUBLIC_URL}`);

  // Executa o primeiro ciclo imediatamente
  await runCycle();

  // Agenda os próximos ciclos
  setInterval(async () => {
    try {
      await runCycle();
    } catch (err) {
      console.error('[Collector Daemon] Erro no ciclo agendado:', err);
    }
  }, INTERVAL_MINUTES * 60 * 1000);
}

process.on('SIGINT', async () => {
  console.log('\n[Collector Daemon] Encerrando por SIGINT...');
  if (pool) await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Collector Daemon] Encerrando por SIGTERM...');
  if (pool) await pool.end();
  process.exit(0);
});

start().catch(err => {
  console.error('[Collector Daemon Fatal]:', err);
  process.exit(1);
});
