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
  Cloud,
  Eye,
  Code,
  Image as ImageIcon,
  Wand2,
} from 'lucide-react';

interface WordPressSitesViewProps {
  token: string;
}

interface GeneratedArticleItem {
  id: string;
  site_id: string;
  site_name: string;
  site_url: string;
  wp_post_id?: number | null;
  wp_permalink?: string | null;
  wp_featured_media_id?: number | null;
  wp_has_featured_image?: boolean;
  published_at: string;
  title: string;
  description: string;
  excerpt: string;
  content: string;
  categories: string[];
  tags: string[];
  featured_image: {
    url: string | null;
    alt: string;
    title: string;
    caption: string;
    description: string;
  } | null;
  seo: {
    focus_keyword: string;
    meta_title: string;
    meta_description: string;
    canonical_url?: string;
    keywords: string[];
    image_seo: {
      alt: string;
      title: string;
      caption: string;
      description: string;
    };
  };
  original_source: {
    source_id?: string;
    source_name?: string;
    original_url: string;
    original_title: string;
    original_excerpt?: string;
    captured_at?: string;
  };
  ai_metadata?: {
    tone?: string;
    model?: string;
    custom_instructions_applied?: boolean;
    custom_instructions?: string;
  };
  r2_json_url?: string;
  created_at: string;
  updated_at: string;
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

  // Generated Articles Modal & Inspection State
  const [viewingArticlesSite, setViewingArticlesSite] = useState<WordPressSite | null>(null);
  const [siteGeneratedArticles, setSiteGeneratedArticles] = useState<GeneratedArticleItem[]>([]);
  const [loadingGeneratedArticles, setLoadingGeneratedArticles] = useState(false);
  const [siteR2FeedUrl, setSiteR2FeedUrl] = useState<string | null>(null);
  const [articlesSearchQuery, setArticlesSearchQuery] = useState('');
  const [selectedArticleDetail, setSelectedArticleDetail] = useState<GeneratedArticleItem | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<'preview' | 'json'>('preview');
  const [copiedJson, setCopiedJson] = useState(false);
  const [isSyncingSiteR2, setIsSyncingSiteR2] = useState(false);
  const [syncR2Feedback, setSyncR2Feedback] = useState<string | null>(null);
  const [isRepairingAllImages, setIsRepairingAllImages] = useState(false);
  const [repairingArticleId, setRepairingArticleId] = useState<string | null>(null);

  const handleOpenGeneratedArticles = async (site: WordPressSite) => {
    setViewingArticlesSite(site);
    setLoadingGeneratedArticles(true);
    setArticlesSearchQuery('');
    setSelectedArticleDetail(null);
    setSyncR2Feedback(null);
    try {
      const res = await fetch(`/api/wordpress/sites/${site.id}/generated-articles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSiteGeneratedArticles(data.articles || []);
        setSiteR2FeedUrl(data.r2FeedUrl || null);
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Erro ao carregar artigos gerados.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Falha ao buscar artigos gerados.' });
    } finally {
      setLoadingGeneratedArticles(false);
    }
  };

  const handleSyncSiteR2 = async () => {
    if (!viewingArticlesSite) return;
    setIsSyncingSiteR2(true);
    setSyncR2Feedback(null);
    try {
      const res = await fetch(`/api/wordpress/sites/${viewingArticlesSite.id}/sync-r2-articles`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSyncR2Feedback(data.message || 'Sincronizado com o R2 com sucesso!');
        if (data.r2FeedUrl) setSiteR2FeedUrl(data.r2FeedUrl);
        const reloadRes = await fetch(`/api/wordpress/sites/${viewingArticlesSite.id}/generated-articles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const reloadData = await reloadRes.json();
        if (reloadData.success) {
          setSiteGeneratedArticles(reloadData.articles || []);
        }
      } else {
        setSyncR2Feedback(`Erro: ${data.error || 'Falha na sincronização'}`);
      }
    } catch (err: any) {
      setSyncR2Feedback(`Erro: ${err.message || 'Falha de conexão com R2'}`);
    } finally {
      setIsSyncingSiteR2(false);
    }
  };

  const handleRepairAllMissingImages = async () => {
    if (!viewingArticlesSite) return;
    setIsRepairingAllImages(true);
    setSyncR2Feedback(null);
    try {
      const res = await fetch(`/api/wordpress/sites/${viewingArticlesSite.id}/repair-all-missing-images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSyncR2Feedback(data.message || `Revisão concluída! ${data.repaired} matérias corrigidas no WordPress.`);
        const reloadRes = await fetch(`/api/wordpress/sites/${viewingArticlesSite.id}/generated-articles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const reloadData = await reloadRes.json();
        if (reloadData.success) {
          setSiteGeneratedArticles(reloadData.articles || []);
        }
      } else {
        setSyncR2Feedback(`Erro: ${data.error || 'Falha ao reparar imagens.'}`);
      }
    } catch (err: any) {
      setSyncR2Feedback(`Erro: ${err.message || 'Falha na requisição de reparo.'}`);
    } finally {
      setIsRepairingAllImages(false);
    }
  };

  const handleRepairSingleArticleImage = async (articleId: string) => {
    if (!viewingArticlesSite) return;
    setRepairingArticleId(articleId);
    try {
      const res = await fetch(`/api/wordpress/sites/${viewingArticlesSite.id}/repair-article-image/${articleId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSyncR2Feedback(data.message || 'Imagem corrigida e vinculada com sucesso no WordPress!');
        const reloadRes = await fetch(`/api/wordpress/sites/${viewingArticlesSite.id}/generated-articles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const reloadData = await reloadRes.json();
        if (reloadData.success) {
          setSiteGeneratedArticles(reloadData.articles || []);
        }
      } else {
        setSyncR2Feedback(`Erro: ${data.error || 'Falha ao vincular imagem.'}`);
      }
    } catch (err: any) {
      setSyncR2Feedback(`Erro: ${err.message || 'Falha na requisição.'}`);
    } finally {
      setRepairingArticleId(null);
    }
  };

  const handleCopyJsonToClipboard = (obj: any) => {
    try {
      navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2500);
    } catch (err) {
      console.error(err);
    }
  };

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
                      <button
                        type="button"
                        onClick={() => handleOpenGeneratedArticles(site)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 active:bg-indigo-200 border border-indigo-200 hover:border-indigo-300 shadow-xs cursor-pointer transition-all"
                        title="Clique para ver a lista de artigos gerados e inspecionar o JSON estruturado no R2"
                      >
                        <FileText className="w-3.5 h-3.5 text-indigo-600" />
                        {site.publishedArticlesCount ?? 0} {site.publishedArticlesCount === 1 ? 'artigo gerado' : 'artigos gerados'}
                      </button>

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

                    <div
                      onClick={() => handleOpenGeneratedArticles(site)}
                      className="p-2.5 bg-indigo-50/70 hover:bg-indigo-100/90 rounded-lg border border-indigo-100 hover:border-indigo-200 col-span-2 sm:col-span-1 cursor-pointer transition-all group"
                      title="Clique para ver todos os artigos criados e inspecionar a estrutura JSON no R2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-indigo-600 block text-[10px] font-semibold uppercase tracking-wider group-hover:text-indigo-800">
                          Artigos Gerados
                        </span>
                        <ExternalLink className="w-2.5 h-2.5 text-indigo-400 group-hover:text-indigo-600 transition-colors" />
                      </div>
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
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleOpenGeneratedArticles(site)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer shadow-2xs"
                      title="Abrir página com todos os artigos gerados, metadados e JSON no Cloudflare R2"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Artigos Gerados ({site.publishedArticlesCount ?? 0})</span>
                    </button>

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

      {/* Modal: Artigos Gerados para o Portal */}
      {viewingArticlesSite && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 via-white to-indigo-50/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200 shrink-0">
                  <FileText className="w-5 h-5 text-indigo-100" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Artigos Gerados — {viewingArticlesSite.siteName}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {siteGeneratedArticles.length} {siteGeneratedArticles.length === 1 ? 'artigo' : 'artigos'}
                    </span>
                  </div>
                  <a
                    href={viewingArticlesSite.siteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    {viewingArticlesSite.siteUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {siteR2FeedUrl && (
                  <a
                    href={siteR2FeedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors cursor-pointer"
                    title="Abrir o arquivo JSON consolidado de todos os artigos deste site no Cloudflare R2"
                  >
                    <Cloud className="w-3.5 h-3.5 text-amber-600" />
                    <span>Ver JSON Geral no R2</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleRepairAllMissingImages}
                  disabled={isRepairingAllImages}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 disabled:opacity-50 transition-colors cursor-pointer"
                  title="Revisar se todos os artigos possuem imagem em destaque no WordPress e reparar os faltantes"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isRepairingAllImages ? 'animate-spin' : ''}`} />
                  <span>{isRepairingAllImages ? 'Revisando Fotos...' : 'Revisar & Corrigir Fotos WP'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSyncSiteR2}
                  disabled={isSyncingSiteR2}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors cursor-pointer"
                  title="Salvar/atualizar todos os artigos gerados deste portal no Cloudflare R2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSiteR2 ? 'animate-spin' : ''}`} />
                  <span>{isSyncingSiteR2 ? 'Sincronizando...' : 'Sincronizar no R2'}</span>
                </button>

                <button
                  onClick={() => {
                    setViewingArticlesSite(null);
                    setSiteGeneratedArticles([]);
                    setSelectedArticleDetail(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 font-bold p-1 text-lg rounded-lg hover:bg-slate-100 transition-colors ml-1"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Sync Feedback Alert */}
            {syncR2Feedback && (
              <div className="px-5 py-2.5 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-indigo-600" />
                  <span>{syncR2Feedback}</span>
                </div>
                <button
                  onClick={() => setSyncR2Feedback(null)}
                  className="text-indigo-400 hover:text-indigo-700 text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Search & Info Toolbar */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={articlesSearchQuery}
                  onChange={(e) => setArticlesSearchQuery(e.target.value)}
                  placeholder="Buscar artigos por título, tag, categoria ou SEO..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                />
              </div>

              <div className="text-xs text-slate-500 flex items-center gap-2">
                <span>
                  Exibindo{' '}
                  <strong className="text-slate-800">
                    {
                      siteGeneratedArticles.filter((art) => {
                        if (!articlesSearchQuery.trim()) return true;
                        const q = articlesSearchQuery.toLowerCase();
                        return (
                          art.title.toLowerCase().includes(q) ||
                          (art.excerpt || '').toLowerCase().includes(q) ||
                          (art.tags || []).some((t) => t.toLowerCase().includes(q)) ||
                          (art.seo?.focus_keyword || '').toLowerCase().includes(q)
                        );
                      }).length
                    }
                  </strong>{' '}
                  de <strong className="text-slate-800">{siteGeneratedArticles.length}</strong> artigos gerados
                </span>
              </div>
            </div>

            {/* Articles List Content */}
            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {loadingGeneratedArticles ? (
                <div className="p-16 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-indigo-600" />
                  <p className="text-sm font-semibold text-slate-700">Carregando artigos gerados...</p>
                  <p className="text-xs text-slate-400 mt-1">Buscando metadados e estrutura JSON salva para este portal.</p>
                </div>
              ) : siteGeneratedArticles.length === 0 ? (
                <div className="p-16 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-slate-700">Nenhum artigo gerado para este portal ainda</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                    Quando o robô ou o teste de post gerar matérias para este site, elas ficarão listadas aqui com JSON completo e metadados no R2.
                  </p>
                </div>
              ) : (
                (() => {
                  const filtered = siteGeneratedArticles.filter((art) => {
                    if (!articlesSearchQuery.trim()) return true;
                    const q = articlesSearchQuery.toLowerCase();
                    return (
                      art.title.toLowerCase().includes(q) ||
                      (art.excerpt || '').toLowerCase().includes(q) ||
                      (art.tags || []).some((t) => t.toLowerCase().includes(q)) ||
                      (art.seo?.focus_keyword || '').toLowerCase().includes(q)
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="p-10 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                        Nenhum artigo encontrado com o termo pesquisado.
                      </div>
                    );
                  }

                  return filtered.map((art) => {
                    const hasImage = Boolean(art.featured_image?.url);

                    return (
                      <div
                        key={art.id}
                        className="p-4 bg-white rounded-xl border border-slate-200/90 hover:border-indigo-300 hover:shadow-xs transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex items-start gap-3.5 flex-1 min-w-0">
                          {/* Image Thumbnail */}
                          <div className="w-20 h-16 sm:w-24 sm:h-18 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative flex items-center justify-center">
                            {hasImage ? (
                              <img
                                src={art.featured_image!.url!}
                                alt={art.featured_image?.alt || art.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-[10px] text-slate-400">
                                <ImageIcon className="w-4 h-4 mb-0.5 text-slate-300" />
                                <span>Sem Foto</span>
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mb-1">
                              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
                                {art.categories?.[0] || 'Geral'}
                              </span>
                              {art.wp_post_id && (
                                <span className="text-slate-500 font-mono font-medium">
                                  ID WP: #{art.wp_post_id}
                                </span>
                              )}
                              {art.wp_featured_media_id ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title={`Mídia Anexada ID #${art.wp_featured_media_id}`}>
                                  ✓ Foto WP #{art.wp_featured_media_id}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200" title="Artigo publicado sem imagem em destaque associada no WordPress">
                                  ⚠ Sem Foto no WP
                                </span>
                              )}
                              <span>•</span>
                              <span>{new Date(art.published_at).toLocaleString('pt-BR')}</span>
                              {art.seo?.focus_keyword && (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-700 font-medium">
                                    SEO: "{art.seo.focus_keyword}"
                                  </span>
                                </>
                              )}
                            </div>

                            <h4 className="text-sm font-bold text-slate-900 leading-snug line-clamp-1 hover:text-indigo-600 transition-colors">
                              {art.title}
                            </h4>

                            {art.excerpt && (
                              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                                {art.excerpt}
                              </p>
                            )}

                            {/* Tags */}
                            {art.tags && art.tags.length > 0 && (
                              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                {art.tags.slice(0, 4).map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded font-medium"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                                {art.tags.length > 4 && (
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    +{art.tags.length - 4}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 justify-end border-t md:border-t-0 pt-2 md:pt-0">
                          {!art.wp_featured_media_id && (
                            <button
                              type="button"
                              onClick={() => handleRepairSingleArticleImage(art.id)}
                              disabled={repairingArticleId === art.id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors cursor-pointer shadow-2xs"
                              title="Corrigir e vincular imagem em destaque no WordPress agora"
                            >
                              <Wand2 className={`w-3.5 h-3.5 ${repairingArticleId === art.id ? 'animate-spin' : ''}`} />
                              <span>{repairingArticleId === art.id ? 'Corrigindo...' : 'Corrigir Foto WP'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedArticleDetail(art);
                              setActiveDetailTab('preview');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                            title="Inspecionar artigo completo, metadados e código JSON"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Inspecionar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedArticleDetail(art);
                              setActiveDetailTab('json');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                            title="Ver JSON estruturado"
                          >
                            <Code className="w-3.5 h-3.5 text-slate-600" />
                            <span>{'{ }'}</span>
                          </button>

                          {art.r2_json_url && (
                            <a
                              href={art.r2_json_url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                              title="Abrir JSON no Cloudflare R2"
                            >
                              <Cloud className="w-4 h-4 text-amber-600" />
                            </a>
                          )}

                          {art.wp_permalink && (
                            <a
                              href={art.wp_permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                              title="Abrir post publicado no WordPress"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Os artigos e JSONs são gerados exclusivamente para este site e salvos no Cloudflare R2.
              </span>
              <button
                type="button"
                onClick={() => setViewingArticlesSite(null)}
                className="px-5 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg shadow cursor-pointer transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detalhes do Artigo Gerado & JSON Completo */}
      {selectedArticleDetail && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="min-w-0 flex-1 mr-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {selectedArticleDetail.site_name}
                  </span>
                  {selectedArticleDetail.wp_post_id && (
                    <span className="text-xs text-slate-500 font-mono">
                      Post #{selectedArticleDetail.wp_post_id}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1 line-clamp-1">
                  {selectedArticleDetail.title}
                </h3>
              </div>

              {/* Tabs Switcher */}
              <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('preview')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    activeDetailTab === 'preview'
                      ? 'bg-white text-indigo-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Artigo & SEO</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('json')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    activeDetailTab === 'json'
                      ? 'bg-white text-indigo-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Code className="w-3.5 h-3.5" />
                  <span>JSON Estruturado</span>
                </button>
              </div>

              <button
                onClick={() => setSelectedArticleDetail(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 text-lg rounded-lg hover:bg-slate-100 transition-colors ml-3"
              >
                ✕
              </button>
            </div>

            {/* Tab 1: Editorial Preview & SEO */}
            {activeDetailTab === 'preview' && (
              <div className="p-6 overflow-y-auto space-y-5 flex-1">
                {/* Featured Image Box */}
                {selectedArticleDetail.featured_image?.url && (
                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                    <div className="max-h-72 w-full overflow-hidden bg-slate-900 flex items-center justify-center">
                      <img
                        src={selectedArticleDetail.featured_image.url}
                        alt={selectedArticleDetail.featured_image.alt}
                        className="w-full max-h-72 object-cover"
                      />
                    </div>
                    <div className="p-3 bg-slate-50/90 border-t border-slate-200 text-xs text-slate-600 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <strong className="text-slate-700 block text-[10px] uppercase tracking-wider">Alt Text (Acessibilidade)</strong>
                        <span className="italic">{selectedArticleDetail.featured_image.alt || 'Não informado'}</span>
                      </div>
                      <div>
                        <strong className="text-slate-700 block text-[10px] uppercase tracking-wider">Legenda / Caption</strong>
                        <span>{selectedArticleDetail.featured_image.caption || 'Sem legenda'}</span>
                      </div>
                      <div>
                        <strong className="text-slate-700 block text-[10px] uppercase tracking-wider">Título SEO Imagem</strong>
                        <span>{selectedArticleDetail.featured_image.title || 'Padrão'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Title & Excerpt */}
                <div>
                  <h1 className="text-xl font-extrabold text-slate-900 leading-snug">
                    {selectedArticleDetail.title}
                  </h1>
                  {selectedArticleDetail.excerpt && (
                    <p className="text-xs text-slate-600 italic mt-2 border-l-2 border-indigo-500 pl-3 leading-relaxed">
                      {selectedArticleDetail.excerpt}
                    </p>
                  )}
                </div>

                {/* SEO Meta Grid */}
                <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2.5">
                  <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    Metadados de Otimização para SEO WordPress
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 bg-white rounded-lg border border-slate-100">
                      <strong className="text-slate-500 block text-[10px] uppercase">Palavra-chave Foco</strong>
                      <span className="font-bold text-indigo-700 mt-0.5 block">{selectedArticleDetail.seo?.focus_keyword || 'notícias'}</span>
                    </div>
                    <div className="p-2.5 bg-white rounded-lg border border-slate-100">
                      <strong className="text-slate-500 block text-[10px] uppercase">Categoria no WP</strong>
                      <span className="font-semibold text-slate-800 mt-0.5 block">{selectedArticleDetail.categories?.join(', ') || 'Geral'}</span>
                    </div>
                    <div className="p-2.5 bg-white rounded-lg border border-slate-100 sm:col-span-2">
                      <strong className="text-slate-500 block text-[10px] uppercase">Tags / Palavras-chave Semânticas</strong>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {(selectedArticleDetail.tags || []).map((tag, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-medium">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rendered HTML Content */}
                <div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    Conteúdo Formatado Publicado
                  </h4>
                  <div
                    className="p-5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-800 space-y-3 leading-relaxed [&>h2]:text-base [&>h2]:font-bold [&>h2]:text-slate-900 [&>h2]:mt-4 [&>h2]:mb-2 [&>h3]:text-sm [&>h3]:font-bold [&>h3]:text-slate-900 [&>h3]:mt-3 [&>h3]:mb-1 [&>p]:leading-relaxed [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1"
                    dangerouslySetInnerHTML={{ __html: selectedArticleDetail.content }}
                  />
                </div>

                {/* Original Source Reference */}
                {selectedArticleDetail.original_source?.original_url && (
                  <div className="p-3 bg-slate-100 rounded-xl text-xs text-slate-500 flex items-center justify-between">
                    <div>
                      <span>Fonte Original: </span>
                      <strong className="text-slate-700">{selectedArticleDetail.original_source.source_name || 'Desconhecida'}</strong>
                      <span className="mx-2">•</span>
                      <span className="italic">"{selectedArticleDetail.original_source.original_title}"</span>
                    </div>
                    <a
                      href={selectedArticleDetail.original_source.original_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline inline-flex items-center gap-1 font-semibold"
                    >
                      Abrir Fonte <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Structured JSON Viewer */}
            {activeDetailTab === 'json' && (
              <div className="p-6 flex flex-col flex-1 overflow-hidden space-y-3">
                {/* JSON Toolbar */}
                <div className="flex items-center justify-between bg-slate-100 p-2.5 rounded-xl text-xs">
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-indigo-600" />
                    <span className="font-semibold text-slate-700">
                      Estrutura JSON Completa do Artigo
                    </span>
                    {selectedArticleDetail.r2_json_url && (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                        Hospedado no Cloudflare R2
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyJsonToClipboard(selectedArticleDetail)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                    >
                      {copiedJson ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600">Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar JSON</span>
                        </>
                      )}
                    </button>

                    {selectedArticleDetail.r2_json_url && (
                      <a
                        href={selectedArticleDetail.r2_json_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors cursor-pointer"
                      >
                        <Cloud className="w-3.5 h-3.5 text-amber-600" />
                        <span>Abrir no R2</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Pre / Code Block */}
                <div className="flex-1 overflow-y-auto bg-slate-950 rounded-xl p-4 border border-slate-800 text-xs font-mono text-emerald-400 select-all">
                  <pre className="whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedArticleDetail, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Artigo gerado para o portal <strong className="text-slate-700">{selectedArticleDetail.site_name}</strong>
              </span>

              <div className="flex items-center gap-2">
                {selectedArticleDetail.wp_permalink && (
                  <a
                    href={selectedArticleDetail.wp_permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ver no WordPress</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedArticleDetail(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Voltar para Lista
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
