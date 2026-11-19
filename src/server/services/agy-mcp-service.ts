import https from 'https';
import http from 'http';
import { URL } from 'url';
import { CapturedArticle, WordPressSite } from '../../shared/types';
import { env } from '../config/env';
import { parseRobustArticleJson, sanitizeArticleHtmlForPublish } from './article-cleaner';
import { isForbiddenImageService, generateContextualEditorialImage } from './r2-sync';

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
  imageBase64?: string;
  imageAlt?: string;
  imageCaption?: string;
  imageTitle?: string;
  durationSeconds?: number;
  computeHours?: number;
  remainingHours?: number;
  conversationId?: string;
}

/**
 * Normaliza URLs de artefatos e imagens geradas no Painel AGY / Cloudflare CDN
 * Corrige automaticamente domínios legados ou quebrados (ex: ssl-cdn-cloudflare.adsensecustomsearchads.com.br -> cdn.saletub.com)
 */
export function normalizeImageUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  let cleaned = url.trim().replace(/^['"<]+|['">]+$/g, '');
  
  if (cleaned.includes('ssl-cdn-cloudflare.adsensecustomsearchads.com.br')) {
    cleaned = cleaned.replace('https://ssl-cdn-cloudflare.adsensecustomsearchads.com.br', 'https://cdn.saletub.com');
  }
  if (cleaned.includes('adsensecustomsearchads.com.br')) {
    cleaned = cleaned.replace(/https?:\/\/[^\/]*adsensecustomsearchads\.com\.br/, 'https://cdn.saletub.com');
  }
  if (cleaned.startsWith('/uploads/chat-artifacts/') || cleaned.startsWith('/chat-artifacts/')) {
    const p = cleaned.replace(/^\/uploads/, '');
    cleaned = `https://cdn.saletub.com${p}`;
  }
  return cleaned;
}

/**
 * Valida se uma URL responde com HTTP 200 e tipo de imagem válido, baixando o buffer binário
 */
export async function fetchAndValidateImage(
  url: string
): Promise<{ valid: boolean; buffer?: Buffer; contentType?: string; finalUrl?: string }> {
  try {
    const normalized = normalizeImageUrl(url);
    if (!normalized.startsWith('http')) return { valid: false };

    const res = await fetch(normalized, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!res.ok) return { valid: false };
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return { valid: false };

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength < 500) return { valid: false };

    return {
      valid: true,
      buffer: Buffer.from(arrayBuf),
      contentType,
      finalUrl: res.url || normalized,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Normaliza o endpoint base do MCP para comunicação HTTP e SSE
 * Suporta https://backend-agy.saletub.com/mcp, https://backend-agy.saletub.com/mcp/ ou https://backend-agy.saletub.com/api/mcp/panel
 */
export function resolveMcpEndpoints(rawUrl?: string) {
  let base = (rawUrl || env.MCP_AGY_URL || 'https://backend-agy.saletub.com/api/mcp/panel').trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  if (base.endsWith('/mcp')) {
    base = base.replace(/\/mcp$/, '/api/mcp/panel');
  } else if (!base.includes('/api/mcp/panel')) {
    base = `${base}/api/mcp/panel`;
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

  const hasOriginalImage = Boolean(article.imageUrl && article.imageUrl.trim());
  const originalRefImage = article.imageUrl || '';
  const baseContent = (article.cleanText || article.originalContent || '').slice(0, 4500);

  // 1. Montagem da Diretriz de Imagem Inédita Anti-Plágio (Google Imagen 3 DeepMind Exclusivo)
  let imageDirectivePrompt = '';
  if (hasOriginalImage) {
    if (imageStrategy === 'temporal_advance') {
      imageDirectivePrompt = `[DIRETRIZ MANDATÓRIA DE IMAGEM: AVANÇO TEMPORAL & CONTINUIDADE VISUAL (GOOGLE IMAGEN 3)]:
1. A matéria original continha a imagem de referência: "${originalRefImage}".
2. É ESTRITAMENTE PROIBIDO usar a imagem original diretamente para eliminar 100% dos riscos de plágio ou notificação autoral.
3. É TERMINANTEMENTE PROIBIDO usar pollinations.ai, image.pollinations.ai ou qualquer gerador de terceiros com marca d'água.
4. Você DEVE acionar o subagente nativo 'image-generator' (invocando invoke_subagent com TypeName='image-generator', Role='Image Generator', Prompt=...) para gerar uma imagem fotográfica fotorrealista hiperdetalhada (8k, horizontal 16:9, Google Imagen 3 DeepMind).
5. CONCEITO DO AVANÇO TEMPORAL: Projete a cena alguns segundos ou instantes à frente no tempo em relação à imagem original. Simule a continuação natural da narrativa visual (ex: pessoas em movimento, novo ângulo dinâmico, iluminação de alto padrão fotojornalístico).
6. Caso não consiga chamar o subagente, forneça a descrição fotográfica exata no campo "image_prompt" do JSON.`;
    } else {
      imageDirectivePrompt = `[DIRETRIZ MANDATÓRIA DE IMAGEM: CRIAÇÃO CONCEITUAL EDITORIAL (GOOGLE IMAGEN 3)]:
1. É ESTRITAMENTE PROIBIDO usar a imagem original diretamente.
2. É TERMINANTEMENTE PROIBIDO usar pollinations.ai, image.pollinations.ai ou qualquer gerador com marca d'água.
3. Você DEVE acionar o subagente nativo 'image-generator' (usando invoke_subagent com TypeName='image-generator', Role='Image Generator', Prompt=...) para criar uma NOVA fotografia profissional em alta resolução (8k, horizontal 16:9, realismo fotográfico jornalístico, Google Imagen 3 DeepMind).
4. A imagem deve traduzir com precisão e beleza estética o tema central da notícia e as palavras-chave principais.
5. Caso não consiga chamar o subagente, forneça a descrição fotográfica no campo "image_prompt" do JSON.`;
    }
  } else {
    imageDirectivePrompt = `[DIRETRIZ MANDATÓRIA DE IMAGEM: CRIAÇÃO FOTOGRÁFICA DO ZERO (GOOGLE IMAGEN 3)]:
1. ATENÇÃO: A matéria original NÃO POSSUI FOTO DE DESTAQUE ('Sem Foto').
2. É TERMINANTEMENTE PROIBIDO usar pollinations.ai ou qualquer serviço externo com marca d'água.
3. Você DEVE acionar o subagente nativo 'image-generator' (usando invoke_subagent com TypeName='image-generator', Role='Image Generator', Prompt=...) para criar uma fotografia editorial inédita de alto impacto (8k, horizontal 16:9, Google Imagen 3 DeepMind).
4. Crie um prompt de imagem fotográfica hiper-realista retratando com fidelidade o contexto central, as figuras públicas citadas, o ambiente institucional ou a cena da reportagem.
5. Caso não consiga chamar o subagente, forneça a descrição fotográfica no campo "image_prompt" do JSON.`;
  }

  // 2. Diretrizes Exclusivas do Site com PRIORIDADE MÁXIMA
  let customSiteInstructions = '';
  if (targetSite?.aiCustomInstructions && targetSite.aiCustomInstructions.trim()) {
    customSiteInstructions = `
======================================================================
[DIRETRIZES EDITORIAIS MANDATÓRIAS DO SITE "${targetSite.siteName}"]:
ATENÇÃO PRIORITÁRIA: Este portal possui regras editoriais exclusivas definidas pelo proprietário do site. Você DEVE seguir CADA UMA DELAS com a mais alta prioridade:
>>> ${targetSite.aiCustomInstructions.trim()} <<<

COMO APLICAR ESSAS DIRETRIZES NO ARTIGO:
- Se solicitar TOM DESCONTRAÍDO, JOVEM OU DINÂMICO: adote um tom leve, engajador e ágil, com estilo de internet conectado ao público leitor.
- Se solicitar RESUMO EM TÓPICOS: inclua obrigatoriamente logo após a introdução uma seção <h2>Resumo da Notícia</h2> ou <h2>Destaques Rápidos</h2> com <ul><li>...</li></ul> resumindo os pontos fundamentais.
- Se solicitar CHAMADA PARA DEBATE NOS COMENTÁRIOS: o artigo DEVE OBRIGATORIAMENTE terminar com um subtítulo (ex: <h2>Participe do Debate</h2> ou <h2>E você, o que achou?</h2>) e parágrafo instigando os leitores a responderem e debaterem na seção de comentários do site.
- Se solicitar FOCO EM SEO ON-PAGE: construa subtítulos semânticos <h2> e <h3> com palavras-chave de cauda longa e termos de busca orgânica.
======================================================================
`;
  }

  const promptMessage = `Você é um jornalista sênior, editor-chefe investigativo e especialista em SEO On-Page para WordPress.
Sua missão é transformar a notícia original abaixo em uma reportagem 100% autoral, aprofundada, envolvente e perfeitamente formatada para publicação imediata no portal.

${customSiteInstructions}

[REGRA SUPREMA E INVIOLÁVEL: REESCRITA 100% AUTORAL - ZERO PLÁGIO]
1. É TERMINANTEMENTE PROIBIDO copiar e colar frases, trechos ou períodos literais da matéria original.
2. Você é o autor desta nova reportagem. Reescreva tudo com seu próprio vocabulário jornalístico, estilo, ritmo e estruturação de texto.
3. Mantenha 100% de precisão e fidelidade aos FATOS, NOMES DE PESSOAS, LOCAIS, DATAS, HORÁRIOS, NÚMEROS e DADOS TÉCNICOS.
4. Qualquer ferramenta de detecção de plágio deve atestar 100% de originalidade textual.

${imageDirectivePrompt}

[DADOS DA NOTÍCIA ORIGINAL]:
Título Original: ${article.originalTitle}
${article.subtitle ? `Subtítulo: ${article.subtitle}\n` : ''}${article.author ? `Autor Original: ${article.author}\n` : ''}Fonte Original: ${article.originalUrl}
Conteúdo da Notícia:
${baseContent}

[ESTRUTURA TÉCNICA DO ARTIGO]:
1. Formate o corpo do artigo ESTRITAMENTE em HTML limpo, usando <h2>, <h3>, parágrafos <p> ricos e listas <ul><li>.
2. Não inclua tags de documento como <html>, <head>, <body> ou <!DOCTYPE>.
3. Crie um Título impactante com alto gatilho de leitura (CTR) sem sensacionalismo falso.
4. Crie um Excerpt / Meta Descrição de até 160 caracteres com excelente gancho editorial.
5. Forneça de 4 a 8 palavras-chave/tags de SEO estratégicas.
6. Forneça o Alt Text (para acessibilidade da imagem), Título SEO e Legenda Jornalística descritiva para a nova fotografia gerada.

[FORMATO DE SAÍDA OBRIGATÓRIO E REGRAS DE JSON]:
1. Ao concluir a execução de ferramentas e redação, entregue a resposta final estruturada EXCLUSIVAMENTE dentro de um único bloco JSON no formato:
\`\`\`json
{
  "title": "Título Marcante e Otimizado",
  "content": "<h2>Subtítulo Semântico</h2><p>Parágrafo autoral...</p>",
  "excerpt": "Meta descrição de até 160 caracteres com alto CTR...",
  "keywords": ["tag1", "tag2", "tag3", "tag4"],
  "image_url": "URL gerada ou deixe vazio",
  "image_alt": "Texto alternativo descritivo da nova fotografia gerada",
  "image_caption": "Legenda editorial jornalística para a imagem",
  "image_title": "Título SEO da fotografia"
}
\`\`\`
2. PROIBIÇÃO ABSOLUTA DE PROLIXIDADE OU METADADOS EXTRAS: NÃO inclua absolutamente NENHUM texto, comentário, saudação, relatório ou nota fora do bloco JSON. É TERMINANTEMENTE PROIBIDO gerar seções como "## Relatório de Implementação", "## Diretrizes Editoriais", "## Notas de Originalidade" ou relatórios de cumprimento de regras.
3. No campo "content", todo o conteúdo deve ser HTML puro (<p>, <h2>, <h3>, <ul>, <li>). Se usar aspas dentro do texto HTML, use aspas simples (') ou &quot;. Nunca use aspas curvas (“ ou ”) para delimitadores JSON.`;

  console.log(`[MCP AGY] Iniciando turno de reescrita no cluster Antigravity (Modelo: ${mcpModel}, Estratégia Imagem: ${imageStrategy}, Sem Foto Original: ${!hasOriginalImage})...`);

  const { postUrl } = resolveMcpEndpoints(mcpUrl);

  // 1. Criar conversa dedicada no Painel AGY
  let convId = '';
  try {
    const createRes = await sendJsonRpc(
      postUrl,
      token,
      {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'criar_conversa',
          arguments: {
            title: `Reescrita: ${article.originalTitle.slice(0, 35)}`,
            model: mcpModel,
          },
        },
      },
      30000
    );

    const createText = createRes?.result?.content?.[0]?.text;
    if (createText) {
      const parsed = JSON.parse(createText);
      convId = parsed?.conversa?.id || parsed?.id || '';
    }
  } catch (createErr: any) {
    console.warn('[MCP AGY] Aviso ao criar conversa dedicada, continuando com auto-criação:', createErr.message);
  }

  // 2. Despachar a execução da mensagem para o cluster Antigravity
  console.log(`[MCP AGY] Despachando prompt para a conversa ${convId || '(nova)'}...`);
  sendJsonRpc(
    postUrl,
    token,
    {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'enviar_mensagem',
        arguments: {
          conversation_id: convId || undefined,
          message: promptMessage,
          model: mcpModel,
        },
      },
    },
    120000
  ).catch((err: any) => {
    console.log('[MCP AGY Dispatch Notice]:', err.message, '(continuando com polling autônomo do cluster)');
  });

  // 3. Polling resiliente via obter_conversa (eliminando 100% de timeouts de proxy e Cloudflare 524)
  const startTime = Date.now();
  const maxWaitMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      if (!convId) {
        // Se convId não estava disponível no início, busca a conversa mais recente na lista
        const listRes = await sendJsonRpc(
          postUrl,
          token,
          {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: 'listar_conversas', arguments: {} },
          },
          20000
        );
        const listText = listRes?.result?.content?.[0]?.text;
        if (listText) {
          const listData = JSON.parse(listText);
          if (Array.isArray(listData.conversas) && listData.conversas.length > 0) {
            convId = listData.conversas[0].id;
          }
        }
      }

      if (convId) {
        const pollRes = await sendJsonRpc(
          postUrl,
          token,
          {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: 'obter_conversa',
              arguments: {
                conversation_id: convId,
                limit_messages: 50,
              },
            },
          },
          20000
        );

        const pollText = pollRes?.result?.content?.[0]?.text;
        if (pollText) {
          const convData = JSON.parse(pollText);
          const assistantMsg = (convData.mensagens || []).find(
            (m: any) => m.role === 'assistant' && m.content && m.content.trim()
          );
          if (assistantMsg) {
            console.log(
              `[MCP AGY] Turno concluído no cluster com sucesso em ${Math.round((Date.now() - startTime) / 1000)}s!`
            );
            return await processMcpResponse(
              {
                result: {
                  content: [{ type: 'text', text: assistantMsg.content }],
                },
              },
              article,
              convData,
              convId
            );
          }
        }
      }
    } catch (pollErr: any) {
      console.warn('[MCP AGY Poll Warn]:', pollErr.message);
    }
  }

  throw new Error(
    `Timeout de processamento no Painel AGY (${timeoutSeconds}s). O cluster Antigravity não concluiu a tarefa no tempo limite configurado.`
  );
}

/**
 * Processa e extrai o JSON editorial e a nova imagem gerada a partir da resposta do MCP
 */
async function processMcpResponse(
  rpcResponse: any,
  article: CapturedArticle,
  convData?: any,
  convId?: string
): Promise<McpRewriteResult> {
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

  // 1. Extração robusta, resiliente e blindada do JSON editorial
  const parsedArticle = parseRobustArticleJson(assistantText, article);

  // 2. Coleta de Todos os Candidatos de Imagem Inédita Anti-Plágio
  const imageCandidates: string[] = [];

  // A) Imagem explícita indicada no JSON
  if (parsedArticle.image_url && typeof parsedArticle.image_url === 'string' && parsedArticle.image_url.trim()) {
    imageCandidates.push(normalizeImageUrl(parsedArticle.image_url));
  }

  // B) Artefatos criados no payload ou na conversa do cluster
  const combinedArtifacts = [...artifactsCreated, ...(Array.isArray(convData?.artifacts) ? convData.artifacts : [])];
  for (const art of combinedArtifacts) {
    if (art.publicUrl) imageCandidates.push(normalizeImageUrl(art.publicUrl));
    if (art.url) imageCandidates.push(normalizeImageUrl(art.url));
    if (convId && art.id && art.filename && /\.(jpg|jpeg|png|webp)$/i.test(art.filename)) {
      imageCandidates.push(`https://cdn.saletub.com/chat-artifacts/${convId}/${art.id}/${art.filename}`);
      imageCandidates.push(`https://backend-agy.saletub.com/uploads/chat-artifacts/${convId}/${art.id}/${art.filename}`);
    }
  }

  // C) Links markdown ![...](https://...)
  const mdImgMatches = [...assistantText.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s\)]+)\)/gi)];
  for (const m of mdImgMatches) {
    const candidate = normalizeImageUrl(m[1]);
    if (candidate && !candidate.includes('example.com') && !candidate.includes('placeholder')) {
      imageCandidates.push(candidate);
    }
  }

  // D) URLs completas citadas no texto para extensões de imagem
  const rawUrlMatches = [...assistantText.matchAll(/https?:\/\/[^\s'"<>]+\.(?:jpg|jpeg|png|webp)/gi)];
  for (const m of rawUrlMatches) {
    const candidate = normalizeImageUrl(m[0]);
    if (candidate && !imageCandidates.includes(candidate)) {
      imageCandidates.push(candidate);
    }
  }

  // 3. Validação Ativa e Download do Buffer da Imagem (Exclusivo Google Imagen 3)
  let validatedImageUrl: string | null = null;
  let validatedBase64: string | undefined = undefined;

  for (const candidate of imageCandidates) {
    if (isForbiddenImageService(candidate)) {
      console.warn(`[MCP AGY] Descartando candidato com marca d'água/proibido: ${candidate}`);
      continue;
    }
    const check = await fetchAndValidateImage(candidate);
    if (check.valid && check.buffer && check.contentType) {
      validatedImageUrl = check.finalUrl || candidate;
      validatedBase64 = `data:${check.contentType};base64,${check.buffer.toString('base64')}`;
      console.log(`[MCP AGY] Imagem gerada validada com sucesso (${check.contentType}, ${check.buffer.length} bytes): ${validatedImageUrl}`);
      break;
    }
  }

  // Fallback 1: Se o artigo original já possuía uma foto legítima sem marca d'água
  if (!validatedImageUrl && article.imageUrl && !isForbiddenImageService(article.imageUrl)) {
    const origCheck = await fetchAndValidateImage(article.imageUrl);
    if (origCheck.valid && origCheck.buffer && origCheck.contentType) {
      validatedImageUrl = origCheck.finalUrl || normalizeImageUrl(article.imageUrl);
      validatedBase64 = `data:${origCheck.contentType};base64,${origCheck.buffer.toString('base64')}`;
    } else {
      validatedImageUrl = normalizeImageUrl(article.imageUrl);
    }
  }

  // Fallback 2: Se nenhuma imagem válida foi obtida, gera foto editorial inédita via Google Imagen 3 nativo
  if (!validatedImageUrl) {
    console.log(`[MCP AGY] Nenhuma imagem válida retornada pelo agente. Solicitando geração editorial via Google Imagen 3...`);
    try {
      const generated = await generateContextualEditorialImage(parsedArticle.title || article.originalTitle, article.id);
      if (generated && !isForbiddenImageService(generated.url)) {
        validatedImageUrl = generated.url;
        validatedBase64 = generated.base64;
        console.log(`[MCP AGY] Imagem Google Imagen 3 gerada e associada com sucesso: ${validatedImageUrl}`);
      }
    } catch (genErr: any) {
      console.warn('[MCP AGY] Falha na geração contextual de imagem:', genErr.message);
    }
  }

  return {
    title: parsedArticle.title || article.originalTitle,
    content: sanitizeArticleHtmlForPublish(parsedArticle.content || article.originalContent),
    excerpt: parsedArticle.excerpt || article.originalExcerpt || '',
    keywords: Array.isArray(parsedArticle.keywords) ? parsedArticle.keywords : ['noticias', 'atualidades'],
    newImageUrl: validatedImageUrl,
    imageBase64: validatedBase64,
    imageAlt: parsedArticle.image_alt || parsedArticle.title || article.originalTitle,
    imageCaption: parsedArticle.image_caption || parsedArticle.excerpt || '',
    imageTitle: parsedArticle.image_title || parsedArticle.title || article.originalTitle,
    durationSeconds: computeTelemetria.duracao_segundos,
    computeHours: computeTelemetria.horas_consumidas_turno,
    remainingHours: computeTelemetria.saldo_restante_horas,
    conversationId: convId || payload.conversation_id,
  };
}
