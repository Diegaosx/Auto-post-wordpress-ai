import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { LLMProviderId } from '../../shared/types';
import { dbRepo } from '../db/repository';

export interface LLMExecutionResult {
  provider: LLMProviderId;
  model: string;
  output: string;
  latencyMs: number;
  liveApiUsed: boolean;
}

/**
 * Server-Side Multi-LLM Gateway
 * Supports OpenRouter, Google Gemini (@google/genai), and Meta Llama / OpenAI-compatible endpoints.
 * Dynamic credentials can come from SystemSettings or environment variables.
 * Strictly executed on the server; API keys are never exposed to the client browser.
 */
export async function executeLlmPrompt(params: {
  provider?: LLMProviderId;
  prompt: string;
  systemInstruction?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
}): Promise<LLMExecutionResult> {
  const start = Date.now();
  const cleanPrompt = params.prompt.trim();
  const settings = dbRepo.getSystemSettings();

  const provider: LLMProviderId = params.provider || settings.aiProvider || 'openrouter';
  const temperature = params.temperature ?? settings.aiTemperature ?? 0.7;

  // ==========================================================================
  // 1. OPENROUTER (https://openrouter.ai/api/v1/chat/completions)
  // ==========================================================================
  if (provider === 'openrouter') {
    const apiKey = params.apiKey || settings.openRouterApiKey || env.OPENROUTER_API_KEY;
    const modelName = params.model || settings.openRouterModel || env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini';
    const baseUrl = settings.openRouterBaseUrl || env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

    if (apiKey) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': env.APP_URL,
            'X-Title': settings.platformName || 'Auto Post WordPress AI',
          },
          body: JSON.stringify({
            model: modelName,
            temperature,
            messages: [
              ...(params.systemInstruction
                ? [{ role: 'system', content: params.systemInstruction }]
                : []),
              { role: 'user', content: cleanPrompt },
            ],
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const text = data.choices?.[0]?.message?.content || 'Empty OpenRouter response.';
          return {
            provider: 'openrouter',
            model: modelName,
            output: text,
            latencyMs: Date.now() - start,
            liveApiUsed: true,
          };
        } else {
          const errData = await res.text();
          throw new Error(`OpenRouter HTTP ${res.status}: ${errData.slice(0, 160)}`);
        }
      } catch (err: any) {
        return {
          provider: 'openrouter',
          model: modelName,
          output: `[OpenRouter Error (${err.message})]: Não foi possível obter resposta do OpenRouter. Verifique a chave de API e o saldo.`,
          latencyMs: Date.now() - start,
          liveApiUsed: false,
        };
      }
    }

    return {
      provider: 'openrouter',
      model: modelName,
      output: `[OpenRouter Adapter (${modelName})]: Chave de API não configurada. Configure sua chave do OpenRouter na aba Configurações.`,
      latencyMs: Math.max(15, Date.now() - start),
      liveApiUsed: false,
    };
  }

  // ==========================================================================
  // 2. GOOGLE GEMINI (@google/genai)
  // ==========================================================================
  if (provider === 'gemini') {
    const apiKey = params.apiKey || settings.geminiApiKey || env.GEMINI_API_KEY;
    const modelName = params.model || settings.geminiModel || env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash';
    const hasValidKey = Boolean(apiKey) && apiKey !== 'MY_GEMINI_API_KEY';

    if (hasValidKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const response = await ai.models.generateContent({
          model: modelName,
          contents: cleanPrompt,
          config: {
            temperature,
            systemInstruction: params.systemInstruction || undefined,
          },
        });

        return {
          provider: 'gemini',
          model: modelName,
          output: response.text || 'No text returned from Gemini model.',
          latencyMs: Date.now() - start,
          liveApiUsed: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          provider: 'gemini',
          model: modelName,
          output: `[Gemini Error (${message.slice(0, 120)})]: Falha ao comunicar com a API do Google Gemini.`,
          latencyMs: Date.now() - start,
          liveApiUsed: false,
        };
      }
    }

    return {
      provider: 'gemini',
      model: modelName,
      output: `[Gemini Adapter (${modelName})]: GEMINI_API_KEY não configurada. Insira sua chave nas Configurações.`,
      latencyMs: Math.max(12, Date.now() - start),
      liveApiUsed: false,
    };
  }

  // ==========================================================================
  // 3. META LLAMA / GROQ / OLLAMA / OPENAI-COMPATIBLE
  // ==========================================================================
  const apiKey = params.apiKey || settings.llamaApiKey || env.LLAMA_API_KEY;
  const baseUrl = settings.llamaBaseUrl || env.LLAMA_API_BASE_URL || 'https://api.groq.com/openai/v1';
  const llamaModel = params.model || settings.llamaModel || env.LLAMA_DEFAULT_MODEL || 'llama-3.3-70b-versatile';

  if (apiKey) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llamaModel,
          temperature,
          messages: [
            ...(params.systemInstruction
              ? [{ role: 'system', content: params.systemInstruction }]
              : []),
            { role: 'user', content: cleanPrompt },
          ],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = data.choices?.[0]?.message?.content || 'Empty response.';
        return {
          provider: 'llama',
          model: llamaModel,
          output: text,
          latencyMs: Date.now() - start,
          liveApiUsed: true,
        };
      } else {
        const errData = await res.text();
        throw new Error(`HTTP ${res.status}: ${errData.slice(0, 160)}`);
      }
    } catch (err: any) {
      return {
        provider: 'llama',
        model: llamaModel,
        output: `[Llama/Groq Error (${err.message})]: Falha ao comunicar com o endpoint.`,
        latencyMs: Date.now() - start,
        liveApiUsed: false,
      };
    }
  }

  return {
    provider: 'llama',
    model: llamaModel,
    output: `[Llama Native Adapter (${llamaModel})]: Chave de API não configurada.`,
    latencyMs: Math.max(14, Date.now() - start),
    liveApiUsed: false,
  };
}
