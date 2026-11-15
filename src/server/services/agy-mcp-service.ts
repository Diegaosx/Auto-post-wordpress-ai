import https from 'https';
import http from 'http';
import { URL } from 'url';
import { CapturedArticle, WordPressSite } from '../../shared/types';
import { env } from '../config/env';

export interface McpTestResult {
  success: boolean;
  output?: string;
  user?: {
    nome?: string;
    email?: string;
    role?: string;
    plano?: string;
  };
  compute?: {
    total?: number;
    used?: number;
    remaining?: number;
  };
  concurrency?: {
    active?: number;
    max?: number;
  };
  latencyMs: number;
  error?: string;
}

export interface McpRewriteOptions {
  article: CapturedArticle;
  targetSite?: WordPressSite | null;
  tone?: string;
  systemPrompt?: string;
  mcpUrl?: string;
  mcpToken?: string;
  mcpModel?: string;
  imageStrategy?: 'temporal_advance' | 'content_concept';
  timeoutSeconds?: number;
}

export interface McpRewriteResult {
  title: string;
  content: string;
  excerpt: string;
  keywords: string[];
  newImageUrl?: string | null;
  imageAlt?: string;
  imageCaption?: string;
  durationSeconds?: number;
  computeHours?: number;
  remainingHours?: number;
  conversationId?: string;
}

/**
 * Normaliza o endpoint base do MCP para comunicação HTTP e SSE
 */
function resolveMcpEndpoints(rawUrl?: string) {
  let base = (rawUrl || env.MCP_AGY_URL || 'https://backend-agy.saletub.com/api/mcp/panel').trim();
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (base.endsWith('/mcp')) {
    // Corrige /mcp para /api/mcp/panel se o usuário digitou o alias
    base = base.replace(/\/mcp$/, '/api/mcp/panel');
  }

  const sseUrl = `${base}/sse`;
  return {
    postUrl: base,
    sseUrl,
  };
}

/**
 * Executa uma requisição HTTP/HTTPS genérica em JSON
 */
async function sendJsonRpc(urlStr: string, token: string, body: any, timeoutMs = 35000): Promise<any> {
  const parsed = new URL(urlStr);
  const isHttps = parsed.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`MCP Server Error (HTTP ${res.statusCode}): ${rawData.slice(0, 200)}`));
          }
          try {
            const json = JSON.parse(rawData);
            resolve(json);
          } catch {
            resolve({ raw: rawData, statusCode: res.statusCode });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout de comunicação com servidor MCP (${timeoutMs}ms)`));
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

/**
 * 1. Teste de Conexão com o Painel AGY MCP
 * Consulta saldo de computação em nuvem, dados do plano e limites do usuário.
 */
export async function testMcpConnection(customUrl?: string, customToken?: string): Promise<McpTestResult> {
  const startTime = Date.now();
  const token = (customToken || env.MCP_AGY_TOKEN || '').trim();
  const { postUrl } = resolveMcpEndpoints(customUrl);

  if (!token) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: 'Token MCP não fornecido. Insira sua chave mcp_live_... para autenticar.',
    };
  }

  try {
    const response = await sendJsonRpc(
      postUrl,
      token,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'consultar_plano_e_limites',
          arguments: {},
        },
      },
      25000
    );

    const latencyMs = Date.now() - startTime;

    if (response?.error) {
      return {
        success: false,
        latencyMs,
        error: `Erro retornado pelo MCP: ${response.error.message || JSON.stringify(response.error)}`,
      };
    }

    const contentText = response?.result?.content?.[0]?.text;
    if (!contentText) {
      return {
        success: false,
        latencyMs,
        error: 'Resposta vazia ou inválida do servidor MCP.',
      };
    }

    let parsedInfo: any = {};
    try {
      parsedInfo = JSON.parse(contentText);
    } catch {
      parsedInfo = { raw: contentText };
    }

    const u = parsedInfo.usuario || {};
    const c = parsedInfo.horas_computacao || {};
    const conc = parsedInfo.concorrencia_processos || {};

    const summaryText =
      `OK - Conexão com Painel AGY (Cluster Antigravity) ativa!\n` +
      `Cliente: ${u.nome || 'Usuário'} (${u.email || 'N/A'})\n` +
      `Plano: ${u.plano || 'starter'} (Status: ${parsedInfo.status || 'ATIVO'})\n` +
      `Saldo de Computação: ${typeof c.horas_restantes === 'number' ? c.horas_restantes.toFixed(2) : '0.00'}h restantes de ${c.total_disponivel_horas || 10}h\n` +
      `Concorrência: ${conc.processos_ativos_agora ?? 0}/${conc.limite_maximo_simultaneo ?? 1} processo(s) em execução.`;

    return {
      success: true,
      output: summaryText,
      user: {
        nome: u.nome,
        email: u.email,
        role: u.role,
        plano: u.plano,
      },
      compute: {
        total: c.total_disponivel_horas,
        used: c.horas_consumidas,
        remaining: c.horas_restantes,
      },
      concurrency: {
        active: conc.processos_ativos_agora,
        max: conc.limite_maximo_simultaneo,
      },
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Falha ao conectar com o Servidor MCP.',
    };
  }
}

/**
 * 2. Executa Reescrita Completa de Artigo com Geração de Imagem Inédita Anti-Plágio
 * Utiliza o canal persistente SSE (Server-Sent Events) para evitar timeout HTTP 524 do Cloudflare.
 */
export async function executeMcpAgyRewrite(options: McpRewriteOptions): Promise<McpRewriteResult> {
  const {
    article,
    targetSite,
    tone = 'jornalistico',
    mcpUrl,
    mcpToken,
    mcpModel = 'gemini-3.8-flash',
    imageStrategy = 'temporal_advance',
    timeoutSeconds = 300,
  } = options;

  const token = (mcpToken || env.MCP_AGY_TOKEN || '').trim();
  if (!token) {
    throw new Error('Token MCP do Painel AGY não configurado. Adicione o token mcp_live_... nas Configurações.');
  }

  const { sseUrl } = resolveMcpEndpoints(mcpUrl);
  const parsedSse = new URL(sseUrl);
  const isHttps = parsedSse.protocol === 'https:';
  const client = isHttps ? https : http;

  const originalRefImage = article.imageUrl || '';
  const baseContent = (article.cleanText || article.originalContent || '').slice(0, 4000);

  // Montagem da Diretriz de Imagem Inédita Anti-Plágio
  let imageDirectivePrompt = '';
  if (imageStrategy === 'temporal_advance') {
    imageDirectivePrompt = `[DIRETRIZ MANDATÓRIA DE IMAGEM: AVANÇO TEMPORAL & CONTINUIDADE VISUAL (ANTI-PLÁGIO)]:
1. A matéria original continha a imagem de referência: "${originalRefImage || 'foto jornalística contextual'}".
2. É ESTRITAMENTE PROIBIDO usar a imagem original diretamente para eliminar qualquer risco de plágio ou infração autoral.
3. Você DEVE acionar IMEDIATAMENTE a ferramenta 'generate_image' com AspectRatio='16:9' e Prompt fotográfico fotorrealista hiperdetalhado (8k, Google Imagen 3 DeepMind).
4. CONCEITO DO AVANÇO TEMPORAL: Projete a cena alguns segundos ou instantes à frente no tempo em relação à imagem original. Simule a continuação natural da narrativa visual (ex: pessoas em movimento ou deslocamento contínuo, veículos avançando, novo ângulo de visão dinâmico e iluminação fotográfica fotojornalística de alto padrão).
5. NUNCA responda apenas dizendo que a imagem será gerada: chame agora mesmo a ferramenta 'generate_image'.`;
  } else {
    imageDirectivePrompt = `[DIRETRIZ MANDATÓRIA DE IMAGEM: CRIAÇÃO CONCEITUAL EDITORIAL]:
1. É ESTRITAMENTE PROIBIDO usar a imagem original diretamente.
2. Você DEVE acionar IMEDIATAMENTE a ferramenta 'generate_image' com AspectRatio='16:9' para criar uma NOVA fotografia profissional em alta resolução (8k, realismo fotográfico jornalístico, Google Imagen 3 DeepMind).
3. A imagem deve traduzir com precisão e beleza estética o tema central da notícia e as palavras-chave principais.
4. NUNCA responda apenas dizendo que a imagem será gerada: chame agora mesmo a ferramenta 'generate_image'.`;
  }

  // Montagem do Prompt Completo
  let customSiteInstructions = '';
  if (targetSite?.aiCustomInstructions && targetSite.aiCustomInstructions.trim()) {
    customSiteInstructions = `\n[DIRETRIZES EXCLUSIVAS DO SITE "${targetSite.siteName}"]:
${targetSite.aiCustomInstructions.trim()}
(Aplique com prioridade máxima as diretrizes acima)\n`;
  }

  const promptMessage = `Você é um jornalista investigativo sênior, editor-chefe e especialista em SEO para WordPress.
Sua missão é transformar a notícia original abaixo em uma reportagem 100% autoral, aprofundada, envolvente e perfeitamente formatada para publicação imediata.

Tom editorial solicitado: ${tone}
${customSiteInstructions}
${imageDirectivePrompt}

[DADOS DA NOTÍCIA ORIGINAL]:
Título Original: ${article.originalTitle}
${article.subtitle ? `Subtítulo: ${article.subtitle}\n` : ''}${article.author ? `Autor Original: ${article.author}\n` : ''}Fonte Original: ${article.originalUrl}
Conteúdo Base:
${baseContent}

[REGRAS MANDATÓRIAS DE REDAÇÃO E ESTRUTURA]:
1. Reescreva do zero com padrão jornalístico impecável. Nunca faça cópia literal.
2. Formate o corpo do artigo ESTRITAMENTE em HTML limpo, usando <h2>, <h3>, parágrafos <p> ricos e listas <ul><li>.
3. Não inclua tags de documento como <html>, <body> ou <!DOCTYPE>.
4. Crie um Título impactante com alto gatilho de leitura sem sensacionalismo falso.
5. Crie um Excerpt / Meta Descrição de até 160 caracteres com excelente gancho.
6. Forneça de 4 a 8 palavras-chave/tags de SEO estratégicas.
7. Forneça o Alt Text (para acessibilidade da imagem) e Legenda Jornalística descritiva para a nova fotografia gerada.

[FORMATO DE SAÍDA OBRIGATÓRIO]:
Ao concluir a execução de ferramentas e redação, entregue a resposta final estruturada dentro de um único bloco JSON no formato:
\`\`\`json
{
  "title": "Título Marcante e Otimizado",
  "content": "<h2>Contexto e Análise</h2><p>Parágrafos...</p>",
  "excerpt": "Meta descrição de até 160 caracteres com alto CTR...",
  "keywords": ["tag1", "tag2", "tag3", "tag4"],
  "image_alt": "Texto alternativo descritivo da nova fotografia gerada",
  "image_caption": "Legenda editorial jornalística para a imagem"
}
\`\`\``;

  console.log(`[MCP AGY] Iniciando turno de reescrita via SSE persistente (Modelo: ${mcpModel}, Estratégia Imagem: ${imageStrategy})...`);

  const requestId = Math.floor(Math.random() * 1000000) + 1;
  const timeoutMs = timeoutSeconds * 1000;

  return new Promise<McpRewriteResult>((resolve, reject) => {
    let resolved = false;
    let sseReq: http.ClientRequest | null = null;
    let endpointUrl = '';
    let buffer = '';

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          if (sseReq) sseReq.destroy();
        } catch (_) {}
        reject(
          new Error(
            `Timeout de processamento no Painel AGY (${timeoutSeconds}s). A tarefa demorou mais que o limite configurado.`
          )
        );
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        if (sseReq) sseReq.destroy();
      } catch (_) {}
    };

    sseReq = client.request(
      {
        hostname: parsedSse.hostname,
        port: parsedSse.port || (isHttps ? 443 : 80),
        path: parsedSse.pathname + (parsedSse.search ? parsedSse.search + '&' : '?') + `token=${encodeURIComponent(token)}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      },
      (sseRes) => {
        if (sseRes.statusCode && sseRes.statusCode >= 400) {
          cleanup();
          resolved = true;
          return reject(new Error(`Falha ao conectar no canal SSE do MCP (HTTP ${sseRes.statusCode})`));
        }

        sseRes.on('data', (chunk: Buffer) => {
          if (resolved) return;
          buffer += chunk.toString('utf8');

          // 1. Descoberta do Endpoint de Envio de Mensagens da Sessão SSE
          if (!endpointUrl && buffer.includes('event: endpoint')) {
            const match = buffer.match(/data:\s*([^\r\n]+)/);
            if (match) {
              endpointUrl = match[1].trim();
              console.log(`[MCP AGY] Canal SSE conectado. Despachando turno para ${endpointUrl}...`);

              // Envia a mensagem JSON-RPC para o cluster via POST
              const postParsed = new URL(
                endpointUrl.startsWith('http')
                  ? endpointUrl
                  : `${parsedSse.protocol}//${parsedSse.host}${endpointUrl}`
              );

              const postReq = client.request(
                {
                  hostname: postParsed.hostname,
                  port: postParsed.port || (isHttps ? 443 : 80),
                  path: postParsed.pathname + postParsed.search,
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                  },
                },
                (postRes) => {
                  if (postRes.statusCode !== 202 && postRes.statusCode !== 200) {
                    console.warn(`[MCP AGY] Aviso: POST de mensagem retornou status HTTP ${postRes.statusCode}`);
                  }
                }
              );

              postReq.on('error', (err) => {
                console.error('[MCP AGY] Erro no POST de mensagem SSE:', err.message);
              });

              postReq.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: requestId,
                  method: 'tools/call',
                  params: {
                    name: 'enviar_mensagem',
                    arguments: {
                      message: promptMessage,
                      model: mcpModel,
                    },
                  },
                })
              );
              postReq.end();
            }
          }

          // 2. Recepção da Resposta Conclusiva do Robô via SSE
          if (buffer.includes('event: message')) {
            const events = buffer.split('\n\n');
            for (const ev of events) {
              if (ev.includes('event: message') && ev.includes('data:')) {
                const dataMatch = ev.match(/data:\s*([\s\S]+)$/);
                if (dataMatch) {
                  try {
                    const rpcResponse = JSON.parse(dataMatch[1].trim());
                    if (rpcResponse.id === requestId) {
                      resolved = true;
                      cleanup();
                      const finalResult = processMcpResponse(rpcResponse, article);
                      return resolve(finalResult);
                    }
                  } catch (parseErr) {
                    // Continua acumulando chunks
                  }
                }
              }
            }
          }
        });

        sseRes.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Erro no fluxo de stream SSE: ${err.message}`));
          }
        });

        sseRes.on('end', () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error('Conexão SSE encerrada antes do término do turno pelo servidor MCP.'));
          }
        });
      }
    );

    sseReq.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    });

    sseReq.end();
  });
}

/**
 * Processa e extrai o JSON editorial e a nova imagem gerada a partir da resposta do MCP
 */
function processMcpResponse(rpcResponse: any, article: CapturedArticle): McpRewriteResult {
  if (rpcResponse.result?.isError) {
    const errMsg = rpcResponse.result?.content?.[0]?.text || 'Erro desconhecido retornado pela ferramenta MCP';
    throw new Error(`Falha no processamento do agente Antigravity: ${errMsg}`);
  }

  const rawToolOutput = rpcResponse.result?.content?.[0]?.text || '';
  let payload: any = {};

  try {
    payload = JSON.parse(rawToolOutput);
  } catch {
    payload = { response: rawToolOutput };
  }

  const assistantText: string = payload.response || payload.output || rawToolOutput;
  const artifactsCreated: any[] = Array.isArray(payload.artifacts_created) ? payload.artifacts_created : [];
  const computeTelemetria = payload.consumo_computacao || {};

  // 1. Extração do JSON editorial da resposta do assistente
  let parsedArticle: {
    title?: string;
    content?: string;
    excerpt?: string;
    keywords?: string[];
    image_alt?: string;
    image_caption?: string;
    image_url?: string;
  } = {};

  try {
    const jsonMatch = assistantText.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      parsedArticle = JSON.parse(jsonMatch[1]);
    } else {
      // Tenta parsing do texto se começar com {
      const firstBrace = assistantText.indexOf('{');
      const lastBrace = assistantText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        parsedArticle = JSON.parse(assistantText.slice(firstBrace, lastBrace + 1));
      }
    }
  } catch {
    // Fallback se o robô respondeu em markdown puro
    parsedArticle = {
      title: article.originalTitle,
      content: `<p>${assistantText.replace(/\n\n/g, '</p><p>')}</p>`,
      excerpt: article.originalExcerpt || '',
      keywords: ['noticias', 'tecnologia', 'exclusivo'],
    };
  }

  // 2. Extração da Nova Imagem Inédita Anti-Plágio
  // A) Procura no corpo da resposta markdown por imagens Cloudflare R2 ou URLs externas criadas
  let generatedImageUrl: string | null = null;

  // Busca markdown ![...](https://...)
  const mdImgMatches = [...assistantText.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s\)]+)\)/gi)];
  if (mdImgMatches.length > 0) {
    // Seleciona a primeira imagem válida retornada pelo agente
    for (const m of mdImgMatches) {
      const urlCandidate = m[1];
      if (urlCandidate && !urlCandidate.includes('example.com') && !urlCandidate.includes('placeholder')) {
        generatedImageUrl = urlCandidate;
        break;
      }
    }
  }

  // B) Se não achou no markdown, procura em links diretos para a CDN Cloudflare R2
  if (!generatedImageUrl) {
    const r2Match = assistantText.match(/https?:\/\/[^\s'"<>]+\.(?:jpg|jpeg|png|webp)/i);
    if (r2Match) {
      generatedImageUrl = r2Match[0];
    }
  }

  // C) Verifica se veio no JSON explícito
  if (!generatedImageUrl && parsedArticle.image_url && typeof parsedArticle.image_url === 'string') {
    generatedImageUrl = parsedArticle.image_url;
  }

  // D) Verifica se há algum artefato de imagem criado retornado na telemetria
  if (!generatedImageUrl && artifactsCreated.length > 0) {
    const imgArt = artifactsCreated.find((a) => a.type === 'image' || (a.filename && /\.(jpg|jpeg|png|webp)$/i.test(a.filename)));
    if (imgArt && imgArt.publicUrl) {
      generatedImageUrl = imgArt.publicUrl;
    }
  }

  // Se nenhuma imagem foi gerada, mantém a original como fallback de segurança
  if (!generatedImageUrl) {
    generatedImageUrl = article.imageUrl || null;
  }

  return {
    title: parsedArticle.title || article.originalTitle,
    content: parsedArticle.content || article.originalContent,
    excerpt: parsedArticle.excerpt || article.originalExcerpt || '',
    keywords: Array.isArray(parsedArticle.keywords) ? parsedArticle.keywords : ['noticias', 'atualidades'],
    newImageUrl: generatedImageUrl,
    imageAlt: parsedArticle.image_alt || parsedArticle.title || article.originalTitle,
    imageCaption: parsedArticle.image_caption || parsedArticle.excerpt || '',
    durationSeconds: computeTelemetria.duracao_segundos,
    computeHours: computeTelemetria.horas_consumidas_turno,
    remainingHours: computeTelemetria.saldo_restante_horas,
    conversationId: payload.conversation_id,
  };
}
