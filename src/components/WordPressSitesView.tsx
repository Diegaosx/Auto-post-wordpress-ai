import React, { useState, useEffect } from 'react';
import { WordPressSite, WordPressLog, NewsSource } from '../shared/types';
import {
  Globe,
  Plus,
  Key,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Download,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  ShieldCheck,
  FileCode,
  Sliders,
  ArrowLeft,
  Sparkles,
  Cpu,
  Layers,
  Radio,
  Save,
  HelpCircle,
  FileText,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  Send,
} from 'lucide-react';

interface WordPressSitesViewProps {
  token: string;
}

export function WordPressSitesView({ token }: WordPressSitesViewProps) {
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [logs, setLogs] = useState<WordPressLog[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingPostSiteId, setTestingPostSiteId] = useState<string | null>(null);
  const [testPostResult, setTestPostResult] = useState<{
    siteName: string;
    title: string;
    permalink?: string;
    wpPostId?: number;
    imageUrl?: string;
    originalTitle?: string;
    sourceName?: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // View Mode: 'list' | 'editor'
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);

  // Form State for Dedicated Control Screen
  const [formSiteName, setFormSiteName] = useState('');
  const [formSiteUrl, setFormSiteUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formDefaultCategory, setFormDefaultCategory] = useState('Geral');
  const [formDefaultStatus, setFormDefaultStatus] = useState<'publish' | 'draft'>('publish');
  const [formAutoPublish, setFormAutoPublish] = useState(true);
  const [formPublishFrequency, setFormPublishFrequency] = useState<number>(60);
  const [formUseAllSources, setFormUseAllSources] = useState(true);
  const [formSelectedSources, setFormSelectedSources] = useState<string[]>([]);
  const [formAiCustomInstructions, setFormAiCustomInstructions] = useState('');
  const [formAiTone, setFormAiTone] = useState('jornalistico');
  const [regenerateKeyOnSave, setRegenerateKeyOnSave] = useState(false);

  // WordPress Activity Logs State (Pagination & Filters)
  const [logPage, setLogPage] = useState<number>(1);
  const [logPageSize, setLogPageSize] = useState<number>(10);
  const [logSearch, setLogSearch] = useState<string>('');
  const [logSiteFilter, setLogSiteFilter] = useState<string>('all');
  const [logStatusFilter, setLogStatusFilter] = useState<string>('all');

  const fetchSites = async () => {
    try {
      const res = await fetch('/api/wordpress/sites', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSites(data);
      }
    } catch (err) {
      console.error('Erro ao buscar sites:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/wordpress/logs?limit=500', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Erro ao buscar logs:', err);
    }
  };

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/scraper/sources', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSources(data);
      }
    } catch (err) {
      console.error('Erro ao buscar fontes:', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSites(), fetchLogs(), fetchSources()]).finally(() => setLoading(false));
  }, [token]);

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleTestConnection = async (siteId: string) => {
    setTestingId(siteId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/wordpress/sites/${siteId}/test-connection`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: data.message || 'Conexão validada com sucesso!' });
      } else {
        setActionMessage({ type: 'error', text: data.message || 'Falha ao testar conexão.' });
      }
      fetchSites();
      fetchLogs();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Erro: ${err.message}` });
    } finally {
      setTestingId(null);
    }
  };

  const handleTestPublishLatestArticle = async (siteId: string) => {
    setTestingPostSiteId(siteId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/wordpress/sites/${siteId}/publish-latest-test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (data.success) {
        setTestPostResult({
          siteName: data.siteName || 'WordPress',
          title: data.title || '',
          permalink: data.permalink,
          wpPostId: data.wpPostId,
          imageUrl: data.imageUrl,
          originalTitle: data.originalTitle,
          sourceName: data.sourceName,
        });
        setActionMessage({
          type: 'success',
          text: data.message || 'Artigo de teste gerado por IA e publicado no WordPress com sucesso!',
        });
        fetchSites();
        fetchLogs();
      } else {
        setActionMessage({
          type: 'error',
          text: data.error || 'Falha ao gerar e publicar artigo de teste.',
        });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Erro: ${err.message}` });
    } finally {
      setTestingPostSiteId(null);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!window.confirm('Tem certeza que deseja remover este site WordPress?')) return;
    try {
      const res = await fetch(`/api/wordpress/sites/${siteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: 'Site removido com sucesso.' });
        fetchSites();
        fetchLogs();
        if (editingSiteId === siteId) {
          setViewMode('list');
        }
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    }
  };

  const handleOpenCreateScreen = () => {
    setEditingSiteId(null);
    setFormSiteName('');
    setFormSiteUrl('');
    setFormApiKey('');
    setFormDefaultCategory('Geral');
    setFormDefaultStatus('publish');
    setFormAutoPublish(true);
    setFormPublishFrequency(60);
    setFormUseAllSources(true);
    setFormSelectedSources([]);
    setFormAiCustomInstructions('');
    setFormAiTone('jornalistico');
    setRegenerateKeyOnSave(false);
    setViewMode('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenEditScreen = (site: WordPressSite) => {
    setEditingSiteId(site.id);
    setFormSiteName(site.siteName || '');
    setFormSiteUrl(site.siteUrl || '');
    setFormApiKey(site.apiKey || '');
    setFormDefaultCategory(site.defaultCategory || 'Geral');
    setFormDefaultStatus(site.defaultStatus || 'publish');
    setFormAutoPublish(site.autoPublish ?? true);
    setFormPublishFrequency(site.publishFrequencyMinutes || 60);
    const hasSources = Array.isArray(site.sourceIds) && site.sourceIds.length > 0;
    setFormUseAllSources(!hasSources);
    setFormSelectedSources(site.sourceIds || []);
    setFormAiCustomInstructions(site.aiCustomInstructions || '');
    setFormAiTone(site.aiTone || 'jornalistico');
    setRegenerateKeyOnSave(false);
    setViewMode('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionMessage(null);

    const payload = {
      siteName: formSiteName.trim(),
      siteUrl: formSiteUrl.trim(),
      defaultCategory: formDefaultCategory.trim() || 'Geral',
      defaultStatus: formDefaultStatus,
      autoPublish: formAutoPublish,
      publishFrequencyMinutes: Number(formPublishFrequency) || 60,
      sourceIds: formUseAllSources ? [] : formSelectedSources,
      aiCustomInstructions: formAiCustomInstructions.trim(),
      aiTone: formAiTone,
      regenerateKey: regenerateKeyOnSave,
    };

    try {
      if (editingSiteId) {
        // Edit existing site
        const res = await fetch(`/api/wordpress/sites/${editingSiteId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const updated = await res.json();
          setActionMessage({
            type: 'success',
            text: `Configurações do site "${updated.siteName}" salvas com sucesso!`,
          });
          await fetchSites();
          await fetchLogs();
          setViewMode('list');
        } else {
          const err = await res.json();
          setActionMessage({ type: 'error', text: err.error || 'Erro ao atualizar site.' });
        }
      } else {
        // Create new site
        const res = await fetch('/api/wordpress/sites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const created = await res.json();
          setActionMessage({
            type: 'success',
            text: `Site "${created.siteName}" criado com sucesso! Chave de licença gerada.`,
          });
          await fetchSites();
          await fetchLogs();
          setViewMode('list');
        } else {
          const err = await res.json();
          setActionMessage({ type: 'error', text: err.error || 'Erro ao cadastrar site.' });
        }
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPlugin = () => {
    window.location.href = '/api/wordpress/plugin/download';
  };

  const toggleSourceSelection = (sourceId: string) => {
    setFormSelectedSources((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  };

  const applyPromptPreset = (presetText: string) => {
    setFormAiCustomInstructions((prev) => {
      if (!prev.trim()) return presetText;
      return `${prev.trim()}\n\n${presetText}`;
    });
  };

  const activeSite = editingSiteId ? sites.find((s) => s.id === editingSiteId) : null;

  // ============================================================================
  // RENDER: TELA DE CONTROLE DEDICADA (EDITOR)
  // ============================================================================
  if (viewMode === 'editor') {
    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-16">
        {/* Navigation Breadcrumb & Back */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 shadow-xs cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar aos Sites
            </button>
            <div className="h-4 w-px bg-slate-300" />
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-600" />
                {editingSiteId ? `Controle & Edição: ${formSiteName || 'Site WordPress'}` : 'Vincular Novo Site WordPress'}
              </h2>
              <p className="text-xs text-slate-500">
                Configure fontes alimentadoras, cadência de postagem e diretrizes de IA exclusivas para este site.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveSite}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/25 disabled:opacity-50 cursor-pointer transition-all hover:scale-[1.01]"
            >
              <Save className="w-4 h-4" />
              {submitting ? 'Salvando...' : 'Salvar Configurações'}
            </button>
          </div>
        </div>

        {actionMessage && (
          <div
            className={`p-4 rounded-xl text-sm flex items-center justify-between shadow-xs border ${
              actionMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <span>{actionMessage.text}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-xs font-semibold underline ml-4 hover:opacity-80 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        <form onSubmit={handleSaveSite} className="space-y-6">
          {/* Card 1: Identificação & Conexão do Portal */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <Globe className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Identificação & Conexão com o WordPress</h3>
                <p className="text-xs text-slate-500">Endereço público do site e credenciais para autenticação da REST API.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nome do Site / Portal <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Rede, Portal Notícias Brasil, TechBlog"
                  value={formSiteName}
                  onChange={(e) => setFormSiteName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  URL Completa do WordPress <span className="text-rose-500">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://seusite.com.br"
                  value={formSiteUrl}
                  onChange={(e) => setFormSiteUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* License Key Box (if editing) */}
            {editingSiteId && formApiKey && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                  <span className="font-semibold flex items-center gap-1.5 text-slate-800">
                    <Key className="w-4 h-4 text-indigo-600" />
                    Chave de Licença (API Key do Plugin)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyKey(formApiKey)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                    >
                      {copiedKey === formApiKey ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600">Copiada!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar Chave</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="font-mono text-xs text-slate-800 bg-white px-3 py-2 rounded-lg border border-slate-200 select-all">
                  {formApiKey}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>Insira esta chave no menu do plugin <strong>Auto Post AI</strong> dentro do WordPress.</span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-600 hover:text-slate-800">
                    <input
                      type="checkbox"
                      checked={regenerateKeyOnSave}
                      onChange={(e) => setRegenerateKeyOnSave(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    <span>Regerar nova chave ao salvar</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Fontes de Notícias Conectadas */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Radio className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Fontes de Notícias Vinculadas</h3>
                  <p className="text-xs text-slate-500">
                    Quais portais e feeds de notícias cadastrados devem enviar matérias para este site?
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={formUseAllSources}
                    onChange={() => setFormUseAllSources(true)}
                    className="text-indigo-600"
                  />
                  <span>Todas as Fontes</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="sourceMode"
                    checked={!formUseAllSources}
                    onChange={() => setFormUseAllSources(false)}
                    className="text-indigo-600"
                  />
                  <span>Fontes Específicas</span>
                </label>
              </div>
            </div>

            {formUseAllSources ? (
              <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs text-indigo-900 flex items-center gap-3">
                <Layers className="w-5 h-5 text-indigo-600 shrink-0" />
                <span>
                  <strong>Modo Universal Ativo:</strong> Este site receberá notícias de todas as fontes cadastradas no sistema ({sources.length} fontes ativas).
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 mb-2">
                  Selecione as fontes que alimentarão este site WordPress:
                </div>
                {sources.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center">Nenhuma fonte cadastrada ainda.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
                    {sources.map((src) => {
                      const isSelected = formSelectedSources.includes(src.id);
                      return (
                        <div
                          key={src.id}
                          onClick={() => toggleSourceSelection(src.id)}
                          className={`p-3 rounded-xl border text-xs cursor-pointer flex items-center justify-between transition-all ${
                            isSelected
                              ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950 font-medium'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate mr-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <div className="truncate">
                              <span className="font-bold text-slate-900 block truncate">{src.name}</span>
                              <span className="text-[11px] text-slate-500 truncate block">{src.url}</span>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 uppercase shrink-0">
                            {src.category || 'Geral'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  Selecionadas: {formSelectedSources.length} de {sources.length} fontes disponíveis.
                </p>
              </div>
            )}
          </div>

          {/* Card 3: Frequência de Postagem & Automação */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <Clock className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Frequência de Publicação & Regras WordPress</h3>
                <p className="text-xs text-slate-500">Configure com que frequência e em qual formato os posts chegam ao site.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Frequência de Postagem Automática
                </label>
                <select
                  value={formPublishFrequency}
                  onChange={(e) => setFormPublishFrequency(Number(e.target.value))}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
                >
                  <option value={15}>A cada 15 minutos (Alta intensidade)</option>
                  <option value={30}>A cada 30 minutos</option>
                  <option value={60}>A cada 1 hora (Recomendado)</option>
                  <option value={120}>A cada 2 horas</option>
                  <option value={240}>A cada 4 horas</option>
                  <option value={360}>A cada 6 horas</option>
                  <option value={720}>A cada 12 horas</option>
                  <option value={1440}>A cada 24 horas (Uma vez ao dia)</option>
                  <option value={0}>Manual (Sem postagem automática)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Status Inicial no WordPress
                </label>
                <select
                  value={formDefaultStatus}
                  onChange={(e) => setFormDefaultStatus(e.target.value as 'publish' | 'draft')}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
                >
                  <option value="publish">Publicar Imediatamente (Ao Vivo)</option>
                  <option value="draft">Salvar como Rascunho (Draft)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Categoria Padrão no WP
                </label>
                <input
                  type="text"
                  placeholder="Ex: Geral, Tecnologia, Política"
                  value={formDefaultCategory}
                  onChange={(e) => setFormDefaultCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-slate-50 border border-slate-200/80 hover:bg-slate-100/70 transition-colors">
                <input
                  type="checkbox"
                  checked={formAutoPublish}
                  onChange={(e) => setFormAutoPublish(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-900 block">
                    Publicar automaticamente conforme o agendamento de frequência
                  </span>
                  <span className="text-slate-500 block mt-0.5">
                    O robô buscará a notícia mais recente das fontes vinculadas, aplicará as diretrizes de IA deste site e enviará via REST API.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Card 4: Diretrizes de IA e Instruções de Reescrita Exclusivas */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Diretrizes Editoriais de IA para Este Site</h3>
                <p className="text-xs text-slate-500">
                  Instrua a Inteligência Artificial sobre como recriar, estruturar e adaptar as notícias mineradas para este portal.
                </p>
              </div>
            </div>

            {/* Presets Rápidos */}
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span className="font-semibold text-slate-700">Sugestões Rápidas de Diretrizes (Clique para adicionar):</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    applyPromptPreset(
                      'Adote linguagem jornalística aprofundada, neutra e com foco em dados e contexto histórico.'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 transition-colors cursor-pointer"
                >
                  + Jornalismo Investigativo
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPromptPreset(
                      'Use tom descontraído e dinâmico, focado no público jovem de internet. Finalize com chamada provocativa para debate nos comentários.'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 transition-colors cursor-pointer"
                >
                  + Jovem & Engajador
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPromptPreset(
                      'Destaque números, impactos econômicos, tendências de mercado e consequências para investidores e empresários.'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 transition-colors cursor-pointer"
                >
                  + Negócios & Mercado
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPromptPreset(
                      'Estruture o artigo com foco rigoroso em SEO On-Page, usando subtítulos H2/H3 com palavras-chave semânticas e resumo de leitura em tópicos.'
                    )
                  }
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 transition-colors cursor-pointer"
                >
                  + SEO & Bullet Points
                </button>
              </div>
            </div>

            {/* Custom Instructions Textarea */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Instruções e Regras Exclusivas de Redação
              </label>
              <textarea
                rows={4}
                value={formAiCustomInstructions}
                onChange={(e) => setFormAiCustomInstructions(e.target.value)}
                placeholder="Ex: Você é o editor-chefe do portal RedeGram. Reescreva todas as matérias trazendo títulos com alto gatilho de clique sem fake news. Sempre insira uma seção 'O que você precisa saber' em tópicos e finalize recomendando assinar nossa newsletter."
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none font-sans leading-relaxed"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                {formAiCustomInstructions.length} caracteres digitados. Estas diretrizes serão incorporadas diretamente ao prompt que recria as notícias para este site.
              </p>
            </div>

            {/* Tone Selector & Global Admin AI Notice */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tom Editorial
                </label>
                <select
                  value={formAiTone}
                  onChange={(e) => setFormAiTone(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
                >
                  <option value="jornalistico">Jornalístico (Neutro & Formal)</option>
                  <option value="persuasivo">Persuasivo & Envolvente</option>
                  <option value="analitico">Analítico & Técnico</option>
                  <option value="didatico">Didático & Explicativo</option>
                  <option value="descontraido">Descontraído & Informal</option>
                  <option value="opinativo">Opinativo & Enérgico</option>
                </select>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3">
                <Cpu className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div className="text-xs text-slate-600 leading-relaxed">
                  <strong className="text-slate-800 font-semibold block mb-0.5">Motor de IA Padronizado:</strong>
                  Este site utiliza automaticamente o provedor de IA e modelo definidos pelo administrador na aba <em>Configurações</em> da plataforma.
                </div>
              </div>
            </div>
          </div>

          {/* Form Bottom Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancelar e Voltar
            </button>

            <div className="flex items-center gap-3">
              {editingSiteId && (
                <>
                  <button
                    type="button"
                    onClick={() => handleTestConnection(editingSiteId)}
                    disabled={testingId === editingSiteId || testingPostSiteId === editingSiteId}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingId === editingSiteId ? 'animate-spin' : ''}`} />
                    {testingId === editingSiteId ? 'Testando Conexão...' : 'Testar Conexão Agora'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTestPublishLatestArticle(editingSiteId)}
                    disabled={testingId === editingSiteId || testingPostSiteId === editingSiteId}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 cursor-pointer transition-all shadow-xs disabled:opacity-50"
                    title="Reescreve com IA e publica a última notícia imediatamente no seu WordPress, sem esperar o ciclo agendado"
                  >
                    <Send className={`w-3.5 h-3.5 ${testingPostSiteId === editingSiteId ? 'animate-spin' : ''}`} />
                    {testingPostSiteId === editingSiteId ? 'Criando e Publicando Post...' : 'Testar Publicação (Última Notícia)'}
                  </button>
                </>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/25 disabled:opacity-50 cursor-pointer transition-all hover:scale-[1.01]"
              >
                <Save className="w-4 h-4" />
                {submitting ? 'Salvando Configurações...' : 'Salvar Configurações do Site'}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  // ============================================================================
  // RENDER: LISTA DE SITES & DASHBOARD PRINCIPAL
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* Top Banner: Plugin Download & Onboarding */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 md:p-8 text-white shadow-xl border border-indigo-900/40">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold tracking-wide border border-indigo-400/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              PLUGIN OFICIAL REST API
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              Sincronize com seus Portais WordPress
            </h2>
            <p className="text-slate-300 text-sm leading-relaxed">
              Instale o plugin oficial <strong>Auto Post WordPress AI</strong> no seu site para publicar artigos com fotos em destaque, formatação SEO e categorias de forma 100% autônoma.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <button
              onClick={handleDownloadPlugin}
              className="inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.02] cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Baixar Plugin (.zip)
            </button>
            <button
              onClick={handleOpenCreateScreen}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm border border-slate-700 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Vincular Novo Site
            </button>
          </div>
        </div>

        {/* 3 Steps Guide */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
              1
            </span>
            <span>Instale o arquivo <code>auto-post-wordpress-ai.zip</code> em Plugins no WordPress.</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
              2
            </span>
            <span>Acesse o menu <strong>Auto Post AI</strong> no painel de administração do WordPress.</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
              3
            </span>
            <span>Cole a <strong>Chave de Licença</strong> gerada abaixo e clique em Salvar.</span>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-xl text-sm flex items-center justify-between shadow-xs border ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs font-semibold underline ml-4 hover:opacity-80 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Sites List Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Sites Vinculados</h3>
          <p className="text-xs text-slate-500">
            Gerencie as conexões ativas, selecione fontes alimentadoras e configure diretrizes de IA para cada portal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchSites();
              fetchLogs();
              fetchSources();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 shadow-xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </button>
          <button
            onClick={handleOpenCreateScreen}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Site
          </button>
        </div>
      </div>

      {/* Sites Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
          Carregando sites cadastrados...
        </div>
      ) : sites.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-slate-300">
          <Globe className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h4 className="text-base font-semibold text-slate-800">Nenhum site WordPress vinculado ainda</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Cadastre seu primeiro site WordPress para gerar a chave de licença e começar a sincronizar matérias automaticamente.
          </p>
          <button
            onClick={handleOpenCreateScreen}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Cadastrar Primeiro Site
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sites.map((site) => {
            const hasSources = Array.isArray(site.sourceIds) && site.sourceIds.length > 0;
            const hasAiInstructions = Boolean(site.aiCustomInstructions && site.aiCustomInstructions.trim());

            return (
              <div
                key={site.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow p-6 flex flex-col justify-between"
              >
                <div>
                  {/* Header Card */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-slate-900">{site.siteName}</h4>
                        <a
                          href={site.siteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-indigo-600 hover:underline flex items-center gap-1 mt-0.5"
                        >
                          {site.siteUrl}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>

                    {/* Status & Articles Badges */}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-xs"
                        title="Total de artigos gerados e publicados para este portal WordPress"
                      >
                        <FileText className="w-3.5 h-3.5 text-indigo-600" />
                        {site.publishedArticlesCount ?? 0} {site.publishedArticlesCount === 1 ? 'artigo gerado' : 'artigos gerados'}
                      </span>

                      {site.status === 'connected' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Conectado
                        </span>
                      )}
                      {site.status === 'pending' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Pendente
                        </span>
                      )}
                      {site.status === 'error' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Erro
                        </span>
                      )}
                      {site.status === 'disconnected' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          Desconectado
                        </span>
                      )}
                    </div>
                  </div>

                  {/* License Key Box */}
                  <div className="mt-5 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-indigo-500" />
                        Chave de Licença (API Key)
                      </span>
                      <button
                        onClick={() => handleCopyKey(site.apiKey)}
                        className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === site.apiKey ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-600">Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar Chave</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="font-mono text-xs text-slate-800 bg-white px-3 py-2 rounded-lg border border-slate-200 select-all break-all">
                      {site.apiKey}
                    </div>
                  </div>

                  {/* Config Chips / Badges */}
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Fontes Vinculadas</span>
                      <span className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5 truncate">
                        <Radio className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        {hasSources ? `${site.sourceIds!.length} selecionadas` : 'Todas as fontes'}
                      </span>
                    </div>

                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Frequência</span>
                      <span className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        {site.publishFrequencyMinutes ? `A cada ${site.publishFrequencyMinutes}min` : 'A cada 60min'}
                      </span>
                    </div>

                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Status ao Postar</span>
                      <span className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5 uppercase truncate">
                        {site.defaultStatus} {site.autoPublish ? '(Auto)' : '(Manual)'}
                      </span>
                    </div>

                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wider">Diretrizes de IA</span>
                      <span className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5 truncate">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        {hasAiInstructions ? 'Instruções ativas' : 'Padrão editorial'}
                      </span>
                    </div>

                    <div className="p-2.5 bg-indigo-50/70 rounded-lg border border-indigo-100 col-span-2 sm:col-span-1">
                      <span className="text-indigo-600 block text-[10px] font-semibold uppercase tracking-wider">Artigos Gerados</span>
                      <span className="font-bold text-indigo-950 flex items-center gap-1.5 mt-0.5">
                        <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        {site.publishedArticlesCount ?? 0} {site.publishedArticlesCount === 1 ? 'matéria enviada' : 'matérias enviadas'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      Última sincronização:{' '}
                      {site.lastSyncAt ? new Date(site.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}
                    </span>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEditScreen(site)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg text-white bg-indigo-600 hover:bg-indigo-500 shadow-xs transition-colors cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      Configurar Site
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTestConnection(site.id)}
                      disabled={testingId === site.id || testingPostSiteId === site.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingId === site.id ? 'animate-spin' : ''}`} />
                      {testingId === site.id ? 'Testando...' : 'Testar Conexão'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTestPublishLatestArticle(site.id)}
                      disabled={testingId === site.id || testingPostSiteId === site.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-colors disabled:opacity-50 cursor-pointer"
                      title="Testar reescrita e publicação imediata com a última matéria minerada"
                    >
                      <Send className={`w-3.5 h-3.5 ${testingPostSiteId === site.id ? 'animate-spin' : ''}`} />
                      {testingPostSiteId === site.id ? 'Publicando...' : 'Testar Post'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteSite(site.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Remover Site"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity Logs Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-0.5">Histórico de Atividades do WordPress</h3>
            <p className="text-xs text-slate-500">
              Registro das publicações automáticas e checagens de integridade com as REST APIs dos sites.
            </p>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={logSearch}
                onChange={(e) => {
                  setLogSearch(e.target.value);
                  setLogPage(1);
                }}
                placeholder="Buscar no histórico..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 w-44 sm:w-56"
              />
            </div>

            <select
              value={logSiteFilter}
              onChange={(e) => {
                setLogSiteFilter(e.target.value);
                setLogPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-700 font-medium"
            >
              <option value="all">Todos os Sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteName}
                </option>
              ))}
            </select>

            <select
              value={logStatusFilter}
              onChange={(e) => {
                setLogStatusFilter(e.target.value);
                setLogPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-700 font-medium"
            >
              <option value="all">Todos os Status</option>
              <option value="success">Sucesso</option>
              <option value="warning">Aviso</option>
              <option value="error">Erro</option>
            </select>

            <button
              type="button"
              onClick={() => fetchLogs()}
              title="Atualizar Logs"
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {(() => {
          const filteredLogs = logs.filter((log) => {
            if (logSiteFilter !== 'all' && log.siteId !== logSiteFilter && log.siteName !== logSiteFilter) {
              return false;
            }
            if (logStatusFilter !== 'all' && log.status !== logStatusFilter) {
              return false;
            }
            if (logSearch.trim()) {
              const q = logSearch.toLowerCase();
              const match =
                (log.siteName || '').toLowerCase().includes(q) ||
                (log.action || '').toLowerCase().includes(q) ||
                (log.message || '').toLowerCase().includes(q);
              if (!match) return false;
            }
            return true;
          });

          const totalWpLogs = filteredLogs.length;
          const totalWpLogPages = Math.ceil(totalWpLogs / logPageSize) || 1;
          const safeWpLogPage = Math.min(logPage, totalWpLogPages);
          const wpLogStartIndex = (safeWpLogPage - 1) * logPageSize;
          const pagedWpLogs = filteredLogs.slice(wpLogStartIndex, wpLogStartIndex + logPageSize);

          if (totalWpLogs === 0) {
            return (
              <div className="text-xs text-slate-400 py-8 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                Nenhum evento registrado com os filtros aplicados.
              </div>
            );
          }

          return (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Data/Hora</th>
                      <th className="py-2.5 px-3 font-semibold">Site</th>
                      <th className="py-2.5 px-3 font-semibold">Ação</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                      <th className="py-2.5 px-3 font-semibold">Mensagem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {pagedWpLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                          {new Date(log.timestamp).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{log.siteName || log.siteId}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] font-medium text-indigo-700">{log.action}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.status === 'success'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.status === 'warning'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-md truncate" title={log.message}>
                          {log.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
                <div>
                  Mostrando <strong className="text-slate-800">{wpLogStartIndex + 1}</strong> a{' '}
                  <strong className="text-slate-800">{Math.min(wpLogStartIndex + logPageSize, totalWpLogs)}</strong> de{' '}
                  <strong className="text-slate-800">{totalWpLogs}</strong> registros
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                    disabled={safeWpLogPage === 1}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer font-medium text-slate-700 bg-white"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Anterior
                  </button>

                  {Array.from({ length: totalWpLogPages }, (_, i) => i + 1)
                    .filter((page) => page === 1 || page === totalWpLogPages || Math.abs(page - safeWpLogPage) <= 1)
                    .map((page, idx, arr) => {
                      const prev = arr[idx - 1];
                      return (
                        <React.Fragment key={page}>
                          {prev && page - prev > 1 && (
                            <span className="px-1 text-slate-300">...</span>
                          )}
                          <button
                            onClick={() => setLogPage(page)}
                            className={`min-w-8 h-8 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                              safeWpLogPage === page
                                ? 'bg-indigo-600 text-white'
                                : 'border border-slate-200 hover:bg-slate-50 text-slate-700 bg-white'
                            }`}
                          >
                            {page}
                          </button>
                        </React.Fragment>
                      );
                    })}

                  <button
                    onClick={() => setLogPage((p) => Math.min(totalWpLogPages, p + 1))}
                    disabled={safeWpLogPage === totalWpLogPages}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer font-medium text-slate-700 bg-white"
                  >
                    Próximo
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span>Por página:</span>
                  <select
                    value={logPageSize}
                    onChange={(e) => {
                      setLogPageSize(Number(e.target.value));
                      setLogPage(1);
                    }}
                    className="px-2 py-1 border border-slate-200 rounded-md text-xs bg-white text-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Test Post Result Modal */}
      {testPostResult && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Post Publicado com Sucesso!</h3>
                  <p className="text-xs text-slate-500">Site WordPress: <strong className="text-slate-700">{testPostResult.siteName}</strong></p>
                </div>
              </div>
              <button
                onClick={() => setTestPostResult(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3">
              {testPostResult.imageUrl && (
                <div className="w-full h-44 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                  <img
                    src={testPostResult.imageUrl}
                    alt={testPostResult.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div>
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                  Título Reescrito por IA
                </span>
                <h4 className="font-bold text-sm text-slate-900 mt-1 leading-snug">
                  {testPostResult.title}
                </h4>
              </div>

              {testPostResult.originalTitle && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700 block mb-0.5">Baseado na notícia:</span>
                  <p className="italic text-slate-600 line-clamp-2">"{testPostResult.originalTitle}"</p>
                  {testPostResult.sourceName && (
                    <span className="text-[11px] text-slate-400 mt-1 inline-block">Fonte: {testPostResult.sourceName}</span>
                  )}
                </div>
              )}

              {testPostResult.wpPostId && (
                <div className="text-xs text-slate-500">
                  ID do Post no WordPress: <strong className="text-slate-700">#{testPostResult.wpPostId}</strong>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setTestPostResult(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Fechar
              </button>

              {testPostResult.permalink && (
                <a
                  href={testPostResult.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20 cursor-pointer transition-all hover:scale-[1.01]"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ver Artigo no WordPress
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
