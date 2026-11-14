import React, { useState, useEffect } from 'react';
import { SystemSettings, LLMProviderId } from '../shared/types';
import {
  Settings,
  Sparkles,
  Palette,
  Bot,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Save,
  RotateCw,
  Cpu,
  Globe,
  Key,
  Shield,
  Layers,
  Terminal,
  Cloud,
  ExternalLink,
} from 'lucide-react';

interface SettingsViewProps {
  token: string;
  onSettingsUpdated?: (settings: SystemSettings) => void;
}

export function SettingsView({ token, onSettingsUpdated }: SettingsViewProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    output?: string;
    model?: string;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testingR2, setTestingR2] = useState(false);
  const [r2TestResult, setR2TestResult] = useState<{
    success: boolean;
    message?: string;
    endpoint?: string;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  const [form, setForm] = useState<SystemSettings>({
    platformName: 'Auto Post WordPress AI',
    platformTagline: 'Automação editorial com IA e sincronização WordPress',
    browserTitle: 'Auto Post WordPress AI — Painel Editorial',
    logoText: 'AP',
    logoUrl: '',
    aiProvider: 'openrouter',
    openRouterApiKey: '',
    openRouterModel: 'openai/gpt-4o-mini',
    openRouterBaseUrl: 'https://openrouter.ai/api/v1',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    llamaApiKey: '',
    llamaBaseUrl: 'https://api.groq.com/openai/v1',
    llamaModel: 'llama-3.3-70b-versatile',
    aiTemperature: 0.7,
    aiSystemPrompt: '',
    autoRewriteArticles: true,
    autoPublishToWordPress: false,
    defaultRewriteTone: 'jornalistico',
    r2AccountId: '',
    r2AccessKeyId: '',
    r2SecretAccessKey: '',
    r2BucketName: 'cdn-imagens',
    r2PublicUrl: 'https://ssl-cdn-cloudflare.adsensecustomsearchads.com.br',
    r2AutoSync: true,
  });

  const [hasKeys, setHasKeys] = useState({
    openRouter: false,
    gemini: false,
    llama: false,
    r2: false,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setForm({
          platformName: data.platformName || 'Auto Post WordPress AI',
          platformTagline: data.platformTagline || 'Automação editorial com IA e sincronização WordPress',
          browserTitle: data.browserTitle || 'Auto Post WordPress AI — Painel Editorial',
          logoText: data.logoText || 'AP',
          logoUrl: data.logoUrl || '',
          aiProvider: data.aiProvider || 'openrouter',
          openRouterApiKey: '',
          openRouterModel: data.openRouterModel || 'openai/gpt-4o-mini',
          openRouterBaseUrl: data.openRouterBaseUrl || 'https://openrouter.ai/api/v1',
          geminiApiKey: '',
          geminiModel: data.geminiModel || 'gemini-2.5-flash',
          llamaApiKey: '',
          llamaBaseUrl: data.llamaBaseUrl || 'https://api.groq.com/openai/v1',
          llamaModel: data.llamaModel || 'llama-3.3-70b-versatile',
          aiTemperature: data.aiTemperature ?? 0.7,
          aiSystemPrompt: data.aiSystemPrompt || '',
          autoRewriteArticles: data.autoRewriteArticles ?? true,
          autoPublishToWordPress: data.autoPublishToWordPress ?? false,
          defaultRewriteTone: data.defaultRewriteTone || 'jornalistico',
          r2AccountId: data.r2AccountId || '',
          r2AccessKeyId: data.r2AccessKeyId || '',
          r2SecretAccessKey: '',
          r2BucketName: data.r2BucketName || 'cdn-imagens',
          r2PublicUrl: data.r2PublicUrl || 'https://ssl-cdn-cloudflare.adsensecustomsearchads.com.br',
          r2AutoSync: data.r2AutoSync ?? true,
        });
        setHasKeys({
          openRouter: Boolean(data.hasOpenRouterKey),
          gemini: Boolean(data.hasGeminiKey),
          llama: Boolean(data.hasLlamaKey),
          r2: Boolean(data.hasR2Configured),
        });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro ao carregar configurações do servidor.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const payload: Partial<SystemSettings> = { ...form };
      if (!payload.openRouterApiKey) delete payload.openRouterApiKey;
      if (!payload.geminiApiKey) delete payload.geminiApiKey;
      if (!payload.llamaApiKey) delete payload.llamaApiKey;
      if (!payload.r2SecretAccessKey) delete payload.r2SecretAccessKey;

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Configurações salvas e aplicadas com sucesso!' });
        if (data.settings) {
          if (onSettingsUpdated) {
            onSettingsUpdated(data.settings);
          }
          document.title = data.settings.browserTitle || data.settings.platformName;
        }
        fetchSettings();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Falha ao salvar configurações.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Erro de comunicação ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestR2 = async () => {
    setTestingR2(true);
    setR2TestResult(null);

    try {
      const res = await fetch('/api/settings/r2/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountId: form.r2AccountId,
          accessKeyId: form.r2AccessKeyId,
          secretAccessKey: form.r2SecretAccessKey || undefined,
          bucketName: form.r2BucketName,
          publicUrl: form.r2PublicUrl,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setR2TestResult({
          success: true,
          message: data.message || 'Conexão com Cloudflare R2 bem-sucedida! Bucket e CDN operacionais.',
          endpoint: data.endpoint,
          latencyMs: data.latencyMs,
        });
      } else {
        setR2TestResult({
          success: false,
          error: data.error || data.message || 'Falha na comunicação com o Cloudflare R2.',
        });
      }
    } catch (err: any) {
      setR2TestResult({
        success: false,
        error: err.message || 'Erro de rede ao testar Cloudflare R2.',
      });
    } finally {
      setTestingR2(false);
    }
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    setTestResult(null);

    const activeProvider = form.aiProvider;
    let apiKey = '';
    let model = '';

    if (activeProvider === 'openrouter') {
      apiKey = form.openRouterApiKey || '';
      model = form.openRouterModel || '';
    } else if (activeProvider === 'gemini') {
      apiKey = form.geminiApiKey || '';
      model = form.geminiModel || '';
    } else {
      apiKey = form.llamaApiKey || '';
      model = form.llamaModel || '';
    }

    try {
      const res = await fetch('/api/settings/ai/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider: activeProvider,
          apiKey: apiKey || undefined,
          model: model || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: data.result?.liveApiUsed ?? true,
          output: data.result?.output,
          model: data.result?.model,
          latencyMs: data.result?.latencyMs,
        });
      } else {
        setTestResult({
          success: false,
          error: data.error || 'Falha ao testar IA.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || 'Erro de conexão.',
      });
    } finally {
      setTestingAi(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <RotateCw className="w-6 h-6 animate-spin mr-2" />
        Carregando configurações...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Configurações da Plataforma
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Personalize a identidade visual, white-label, nome do sistema e os motores de inteligência artificial.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
        >
          {saving ? <RotateCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg text-xs font-medium flex items-center gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* SEÇÃO 1: IDENTIDADE VISUAL & WHITE-LABEL */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <Palette className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Identidade Visual & White-Label</h2>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome da Plataforma (Exibido na Sidebar e Login)
                </label>
                <input
                  type="text"
                  value={form.platformName}
                  onChange={(e) => setForm({ ...form, platformName: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Auto Post WordPress AI"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Título na Aba do Navegador (Document Title)
                </label>
                <input
                  type="text"
                  value={form.browserTitle}
                  onChange={(e) => setForm({ ...form, browserTitle: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Auto Post WordPress AI — Painel Editorial"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Slogan / Subtítulo da Plataforma
                </label>
                <input
                  type="text"
                  value={form.platformTagline}
                  onChange={(e) => setForm({ ...form, platformTagline: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Automação editorial com IA e sincronização WordPress"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sigla do Ícone (2 letras)
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={form.logoText}
                  onChange={(e) => setForm({ ...form, logoText: e.target.value.toUpperCase() })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md uppercase font-mono font-bold"
                  placeholder="AP"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                URL da Imagem do Logotipo (Opcional)
              </label>
              <input
                type="url"
                value={form.logoUrl || ''}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="https://meusite.com/logo.png"
              />
            </div>

            {/* Live Preview Card */}
            <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Prévia de Marca (Sidebar / Topbar)
              </div>
              <div className="flex items-center gap-3 bg-white p-3 rounded-md border border-slate-200 w-fit">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Logo" className="w-7 h-7 object-contain rounded" />
                ) : (
                  <div className="w-7 h-7 bg-slate-900 rounded flex items-center justify-center text-white font-mono text-xs font-bold">
                    {form.logoText || 'AP'}
                  </div>
                )}
                <div>
                  <div className="text-xs font-bold text-slate-900">{form.platformName}</div>
                  <div className="text-[10px] text-slate-500">{form.platformTagline}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 2: MOTOR DE INTELIGÊNCIA ARTIFICIAL (AI ENGINE) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-slate-900">Motor de Inteligência Artificial (AI Engine)</h2>
            </div>
            <span className="text-[11px] font-mono text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded">
              Multi-LLM Gateway
            </span>
          </div>

          <div className="p-5 space-y-5">
            {/* Escolha do Provedor Ativo */}
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-2">
                Provedor de IA Padrão para Reescrita de Notícias
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Opção OpenRouter */}
                <div
                  onClick={() => setForm({ ...form, aiProvider: 'openrouter' })}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                    form.aiProvider === 'openrouter'
                      ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                      OpenRouter
                    </span>
                    {hasKeys.openRouter && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-medium">
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Acesso a mais de 200+ modelos (GPT-4o, Claude 3.5, DeepSeek V3, Llama 3.3).
                  </p>
                </div>

                {/* Opção Google Gemini */}
                <div
                  onClick={() => setForm({ ...form, aiProvider: 'gemini' })}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                    form.aiProvider === 'gemini'
                      ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-indigo-600" />
                      Google Gemini
                    </span>
                    {hasKeys.gemini && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-medium">
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    SDK nativo oficial do Google com alta velocidade e janela de contexto estendida.
                  </p>
                </div>

                {/* Opção Llama / Groq / Ollama */}
                <div
                  onClick={() => setForm({ ...form, aiProvider: 'llama' })}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                    form.aiProvider === 'llama'
                      ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                      Groq / Ollama / Custom
                    </span>
                    {hasKeys.llama && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-medium">
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Endpoints padrão OpenAI-compatible, Groq ultra-rápido ou servidor Ollama local.
                  </p>
                </div>
              </div>
            </div>

            {/* Painel Específico do Provedor Selecionado */}
            {form.aiProvider === 'openrouter' && (
              <div className="p-4 bg-indigo-50/30 rounded-lg border border-indigo-100 space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                  <Key className="w-3.5 h-3.5 text-indigo-600" />
                  Credenciais e Modelo do OpenRouter
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Chave de API do OpenRouter ({hasKeys.openRouter ? 'Configurada no Servidor ✓' : 'Não configurada'})
                  </label>
                  <input
                    type="password"
                    value={form.openRouterApiKey}
                    onChange={(e) => setForm({ ...form, openRouterApiKey: e.target.value })}
                    className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-indigo-500"
                    placeholder={hasKeys.openRouter ? '•••••••••••••••••••••••• (deixe vazio para manter)' : 'sk-or-v1-...'}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Obtenha sua chave em <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-indigo-600 underline">openrouter.ai/keys</a>.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Modelo do OpenRouter
                    </label>
                    <input
                      type="text"
                      value={form.openRouterModel}
                      onChange={(e) => setForm({ ...form, openRouterModel: e.target.value })}
                      className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white"
                      placeholder="openai/gpt-4o-mini"
                    />
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.5-flash'].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setForm({ ...form, openRouterModel: m })}
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                            form.openRouterModel === m
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {m.split('/')[1] || m}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      URL Base da API (Opcional)
                    </label>
                    <input
                      type="text"
                      value={form.openRouterBaseUrl}
                      onChange={(e) => setForm({ ...form, openRouterBaseUrl: e.target.value })}
                      className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white"
                      placeholder="https://openrouter.ai/api/v1"
                    />
                  </div>
                </div>
              </div>
            )}

            {form.aiProvider === 'gemini' && (
              <div className="p-4 bg-indigo-50/30 rounded-lg border border-indigo-100 space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                  <Key className="w-3.5 h-3.5 text-indigo-600" />
                  Credenciais e Modelo do Google Gemini
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Chave de API do Gemini ({hasKeys.gemini ? 'Configurada no Servidor ✓' : 'Não configurada'})
                  </label>
                  <input
                    type="password"
                    value={form.geminiApiKey}
                    onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })}
                    className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-indigo-500"
                    placeholder={hasKeys.gemini ? '•••••••••••••••••••••••• (deixe vazio para manter)' : 'AIzaSy...'}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Modelo do Gemini
                  </label>
                  <input
                    type="text"
                    value={form.geminiModel}
                    onChange={(e) => setForm({ ...form, geminiModel: e.target.value })}
                    className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white"
                    placeholder="gemini-2.5-flash"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-1.5-pro'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, geminiModel: m })}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                          form.geminiModel === m
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {form.aiProvider === 'llama' && (
              <div className="p-4 bg-indigo-50/30 rounded-lg border border-indigo-100 space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                  <Key className="w-3.5 h-3.5 text-indigo-600" />
                  Credenciais e Endpoint Groq / Ollama / Custom
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Chave de API ({hasKeys.llama ? 'Configurada ✓' : 'Não configurada'})
                  </label>
                  <input
                    type="password"
                    value={form.llamaApiKey}
                    onChange={(e) => setForm({ ...form, llamaApiKey: e.target.value })}
                    className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white"
                    placeholder={hasKeys.llama ? '••••••••••••••••••••••••' : 'gsk_... ou chave local'}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      URL Base da API
                    </label>
                    <input
                      type="text"
                      value={form.llamaBaseUrl}
                      onChange={(e) => setForm({ ...form, llamaBaseUrl: e.target.value })}
                      className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white"
                      placeholder="https://api.groq.com/openai/v1"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Modelo
                    </label>
                    <input
                      type="text"
                      value={form.llamaModel}
                      onChange={(e) => setForm({ ...form, llamaModel: e.target.value })}
                      className="w-full text-xs font-mono px-3 py-2 border border-slate-300 rounded-md bg-white"
                      placeholder="llama-3.3-70b-versatile"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Teste de Conexão com o Motor de IA */}
            <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <button
                  type="button"
                  onClick={handleTestAi}
                  disabled={testingAi}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {testingAi ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                  <span>{testingAi ? 'Testando Conexão...' : 'Testar Conexão com a IA Agora'}</span>
                </button>
              </div>

              {testResult && (
                <div
                  className={`text-xs p-2.5 rounded-md border flex items-center gap-2 ${
                    testResult.success
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <span className="font-semibold">
                      {testResult.success ? `Sucesso (${testResult.latencyMs}ms)!` : 'Falha no Teste:'}
                    </span>{' '}
                    <span className="text-[11px]">{testResult.output || testResult.error}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Parâmetros de Geração & Tom de Reescrita */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tom de Reescrita Editorial Padrão
                </label>
                <select
                  value={form.defaultRewriteTone}
                  onChange={(e: any) => setForm({ ...form, defaultRewriteTone: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md bg-white cursor-pointer"
                >
                  <option value="jornalistico">Jornalístico (Informativo, Objetivo e Formal)</option>
                  <option value="persuasivo">Persuasivo (Engajador, com Gatilhos de Atenção)</option>
                  <option value="analitico">Analítico (Aprofundado, com Contexto e Dados)</option>
                  <option value="didatico">Didático (Explicativo e Acessível a Todos)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                  <span>Temperatura da IA: {form.aiTemperature}</span>
                  <span className="text-[10px] text-slate-500">
                    {form.aiTemperature < 0.4 ? 'Muito Factual' : form.aiTemperature > 0.8 ? 'Mais Criativo' : 'Equilibrado'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.aiTemperature}
                  onChange={(e) => setForm({ ...form, aiTemperature: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </div>
            </div>

            {/* Prompt do Sistema de Reescrita (Customizável) */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                <span>Prompt de Instrução do Sistema (System Instruction)</span>
                <span className="text-[10px] text-slate-400">Usado por todos os sites conectados</span>
              </label>
              <textarea
                rows={7}
                value={form.aiSystemPrompt}
                onChange={(e) => setForm({ ...form, aiSystemPrompt: e.target.value })}
                className="w-full text-[11px] font-mono leading-relaxed p-3 border border-slate-300 rounded-md bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500"
                placeholder="Insira as regras editoriais para a IA..."
              />
            </div>
          </div>
        </div>

        {/* SEÇÃO 3: AUTOMAÇÃO EDITORIAL */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Automação Editorial Padrão</h2>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <div>
                <div className="text-xs font-semibold text-slate-900">Reescrita Automática com IA</div>
                <div className="text-[11px] text-slate-500">
                  Acionar automaticamente o motor de IA configurado assim que uma nova notícia for capturada.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoRewriteArticles}
                  onChange={(e) => setForm({ ...form, autoRewriteArticles: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-xs font-semibold text-slate-900">Auto-publicação para WordPress</div>
                <div className="text-[11px] text-slate-500">
                  Publicar diretamente no site WordPress vinculado assim que o artigo for reescrito pela IA.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoPublishToWordPress}
                  onChange={(e) => setForm({ ...form, autoPublishToWordPress: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* SEÇÃO 4: CLOUDFLARE R2 EDGE STORAGE & CDN */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-orange-500" />
              <h2 className="text-sm font-semibold text-slate-900">Cloudflare R2 Edge Storage (CDN & Feeds JSON)</h2>
            </div>
            <div className="flex items-center gap-2">
              {hasKeys.r2 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> R2 Configurado
                </span>
              )}
            </div>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Os artigos capturados e os feeds são sincronizados como JSONs estáticos no Cloudflare R2 com taxa zero de saída (zero egress). Feeds agregados são automaticamente particionados em janelas de 6h no Fuso Horário de Recife (America/Recife UTC-3).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cloudflare Account ID
                </label>
                <input
                  type="text"
                  value={form.r2AccountId || ''}
                  onChange={(e) => setForm({ ...form, r2AccountId: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md font-mono"
                  placeholder="4830cafc5dff5d7c50b8623b89b9b8c9"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome do Bucket R2
                </label>
                <input
                  type="text"
                  value={form.r2BucketName || ''}
                  onChange={(e) => setForm({ ...form, r2BucketName: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md font-mono"
                  placeholder="cdn-imagens"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  R2 Access Key ID
                </label>
                <input
                  type="text"
                  value={form.r2AccessKeyId || ''}
                  onChange={(e) => setForm({ ...form, r2AccessKeyId: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md font-mono"
                  placeholder="f60e9da5ad3f0eeabab24de5dc987edf"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                  <span>R2 Secret Access Key</span>
                  {hasKeys.r2 && <span className="text-[10px] text-emerald-600 font-medium">Chave salva</span>}
                </label>
                <input
                  type="password"
                  value={form.r2SecretAccessKey || ''}
                  onChange={(e) => setForm({ ...form, r2SecretAccessKey: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-md font-mono"
                  placeholder={hasKeys.r2 ? '•••••••••••••••••••••••••••••••• (inalterada)' : 'Cole a secret key do R2'}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Domínio Público do CDN (Custom Domain associado ao Bucket)
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={form.r2PublicUrl || ''}
                  onChange={(e) => setForm({ ...form, r2PublicUrl: e.target.value })}
                  className="flex-1 text-xs px-3 py-2 border border-slate-300 rounded-md font-mono"
                  placeholder="https://ssl-cdn-cloudflare.adsensecustomsearchads.com.br"
                />
                {form.r2PublicUrl && (
                  <a
                    href={form.r2PublicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-md border border-slate-300 flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Abrir</span>
                  </a>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Certifique-se de que este domínio está cadastrado como Custom Domain ativo no painel do Cloudflare R2 Settings para evitar erro 404.
              </p>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-slate-100">
              <div>
                <div className="text-xs font-semibold text-slate-900">Sincronização Automática com R2</div>
                <div className="text-[11px] text-slate-500">
                  Enviar automaticamente os artigos como JSON e atualizar feeds no CDN durante cada ciclo de scraping.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.r2AutoSync}
                  onChange={(e) => setForm({ ...form, r2AutoSync: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
              </label>
            </div>

            {/* Botão de Teste R2 */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Gera um objeto de teste no bucket e valida a leitura pelo CDN público.
              </span>
              <button
                type="button"
                onClick={handleTestR2}
                disabled={testingR2}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-xs font-medium rounded-md transition-colors disabled:opacity-60 cursor-pointer"
              >
                {testingR2 ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                <span>{testingR2 ? 'Testando Conexão...' : 'Testar Conexão R2'}</span>
              </button>
            </div>

            {/* Resultado do Teste R2 */}
            {r2TestResult && (
              <div
                className={`p-3 rounded-lg text-xs ${
                  r2TestResult.success
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border border-rose-200'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold mb-1">
                  {r2TestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                  )}
                  <span>{r2TestResult.success ? 'Conexão Cloudflare R2 Concluída com Sucesso' : 'Falha na Conexão com R2'}</span>
                </div>
                {r2TestResult.message && <p className="text-[11px] mt-0.5">{r2TestResult.message}</p>}
                {r2TestResult.endpoint && (
                  <p className="text-[10px] font-mono mt-1 text-slate-600">Endpoint: {r2TestResult.endpoint}</p>
                )}
                {r2TestResult.latencyMs && (
                  <p className="text-[10px] font-mono text-slate-600">Latência: {r2TestResult.latencyMs}ms</p>
                )}
                {r2TestResult.error && (
                  <p className="text-[11px] font-mono text-rose-700 mt-1 whitespace-pre-wrap">{r2TestResult.error}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé com Botão Salvar */}
        <div className="flex justify-end pt-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
          >
            {saving ? <RotateCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{saving ? 'Salvando Configurações...' : 'Salvar Todas as Configurações'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
