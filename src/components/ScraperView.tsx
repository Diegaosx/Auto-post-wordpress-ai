import React, { useState, useEffect } from 'react';
import { CapturedArticle, NewsSource, WordPressSite } from '../shared/types';
import {
  Rss,
  Play,
  Sparkles,
  Send,
  Plus,
  RefreshCw,
  ExternalLink,
  Trash2,
  Eye,
  CheckCircle2,
  Clock,
  Layers,
  Search,
  Filter,
  AlertCircle,
  FileText,
  Tag,
  Calendar,
  Cloud,
  Pencil,
} from 'lucide-react';

interface ScraperViewProps {
  token: string;
}

export function ScraperView({ token }: ScraperViewProps) {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [articles, setArticles] = useState<CapturedArticle[]>([]);
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('all');

  // Loading States
  const [scrapingSourceId, setScrapingSourceId] = useState<string | null>(null);
  const [rewritingArticleId, setRewritingArticleId] = useState<string | null>(null);
  const [publishingArticleId, setPublishingArticleId] = useState<string | null>(null);
  const [syncingArticleR2Id, setSyncingArticleR2Id] = useState<string | null>(null);
  const [syncingR2All, setSyncingR2All] = useState(false);
  const [syncingFeedsR2, setSyncingFeedsR2] = useState(false);

  // Modals
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [previewArticle, setPreviewArticle] = useState<CapturedArticle | null>(null);
  const [publishModalArticle, setPublishModalArticle] = useState<CapturedArticle | null>(null);
  const [selectedPublishSiteId, setSelectedPublishSiteId] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add Source Form
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceCategory, setSourceCategory] = useState('Tecnologia');
  const [sourceTargetSite, setSourceTargetSite] = useState('');
  const [sourceIntervalMinutes, setSourceIntervalMinutes] = useState(15);
  const [submittingSource, setSubmittingSource] = useState(false);

  // Edit Source Form
  const [editingSource, setEditingSource] = useState<NewsSource | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editCategory, setEditCategory] = useState('Tecnologia');
  const [editTargetSite, setEditTargetSite] = useState('');
  const [editIntervalMinutes, setEditIntervalMinutes] = useState(15);
  const [editActive, setEditActive] = useState(true);
  const [submittingEditSource, setSubmittingEditSource] = useState(false);

  const handleOpenEditSource = (src: NewsSource) => {
    setEditingSource(src);
    setEditName(src.name);
    setEditUrl(src.url);
    setEditCategory(src.category || 'Geral');
    setEditTargetSite(src.targetSiteId || '');
    setEditIntervalMinutes(src.intervalMinutes || 15);
    setEditActive(src.active !== false);
  };

  const handleUpdateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSource) return;
    setSubmittingEditSource(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/scraper/sources/${editingSource.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editName,
          url: editUrl,
          category: editCategory,
          targetSiteId: editTargetSite || null,
          intervalMinutes: Number(editIntervalMinutes) || 15,
          active: editActive,
        }),
      });

      if (res.ok) {
        setEditingSource(null);
        setActionMessage({ type: 'success', text: 'Fonte atualizada com sucesso!' });
        fetchData();
      } else {
        const err = await res.json();
        setActionMessage({ type: 'error', text: err.error || 'Erro ao atualizar fonte.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSubmittingEditSource(false);
    }
  };

  const fetchData = async () => {
    try {
      const [srcRes, artRes, sitesRes] = await Promise.all([
        fetch('/api/scraper/sources', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/scraper/articles', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/wordpress/sites', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (srcRes.ok) setSources(await srcRes.json());
      if (artRes.ok) setArticles(await artRes.json());
      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        setSites(sitesData);
        if (sitesData.length > 0 && !selectedPublishSiteId) {
          setSelectedPublishSiteId(sitesData[0].id);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar dados de scraping:', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [token]);

  const handleRunScrape = async (sourceId: string) => {
    setScrapingSourceId(sourceId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/scraper/sources/${sourceId}/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: data.message });
        fetchData();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Falha ao executar scraping.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setScrapingSourceId(null);
    }
  };

  const handleRewriteArticle = async (articleId: string) => {
    setRewritingArticleId(articleId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/scraper/articles/${articleId}/rewrite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tone: 'jornalistico', model: 'gemini' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: 'Artigo reescrito com sucesso pela IA!' });
        fetchData();
        if (previewArticle?.id === articleId) {
          setPreviewArticle(data.article);
        }
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Erro ao reescrever artigo.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setRewritingArticleId(null);
    }
  };

  const handlePublishToWordPress = async (articleId: string, siteId: string) => {
    setPublishingArticleId(articleId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/scraper/articles/${articleId}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ siteId, status: 'publish' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({
          type: 'success',
          text: `Artigo publicado com sucesso no WordPress! ID: ${data.wpPostId}`,
        });
        setPublishModalArticle(null);
        fetchData();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Erro ao publicar no WordPress.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setPublishingArticleId(null);
    }
  };

  const handleDeleteArticle = async (articleId: string) => {
    if (!window.confirm('Deseja excluir este artigo capturado?')) return;
    try {
      const res = await fetch(`/api/scraper/articles/${articleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchData();
        if (previewArticle?.id === articleId) setPreviewArticle(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncArticleR2 = async (articleId: string) => {
    setSyncingArticleR2Id(articleId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/scraper/articles/${articleId}/sync-r2`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: 'Artigo sincronizado no Cloudflare R2 com sucesso!' });
        fetchData();
        if (previewArticle?.id === articleId) {
          setPreviewArticle({ ...previewArticle, r2JsonUrl: data.url });
        }
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Falha ao sincronizar artigo no R2.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSyncingArticleR2Id(null);
    }
  };

  const handleSyncAllR2 = async () => {
    setSyncingR2All(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/scraper/sync-r2-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: data.message });
        fetchData();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Falha na sincronização completa R2.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSyncingR2All(false);
    }
  };

  const handleSyncFeedsR2 = async () => {
    setSyncingFeedsR2(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/scraper/sync-r2-feeds', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: data.message });
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Falha ao sincronizar feeds R2.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSyncingFeedsR2(false);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!window.confirm('Tem certeza que deseja remover esta fonte de notícias?')) return;
    try {
      const res = await fetch(`/api/scraper/sources/${sourceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSource(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/scraper/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: sourceName,
          url: sourceUrl,
          category: sourceCategory,
          targetSiteId: sourceTargetSite || null,
          intervalMinutes: Number(sourceIntervalMinutes) || 15,
          autoRewrite: false,
          autoPublish: false,
        }),
      });

      if (res.ok) {
        setShowAddSourceModal(false);
        setSourceName('');
        setSourceUrl('');
        setActionMessage({ type: 'success', text: 'Fonte adicionada com sucesso!' });
        fetchData();
      } else {
        const err = await res.json();
        setActionMessage({ type: 'error', text: err.error || 'Erro ao adicionar fonte.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setSubmittingSource(false);
    }
  };

  // Filtered Articles
  const filteredArticles = articles.filter((art) => {
    if (statusFilter !== 'all' && art.status !== statusFilter) return false;
    if (selectedSourceId !== 'all' && art.sourceId !== selectedSourceId) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = art.originalTitle.toLowerCase().includes(q) || (art.aiTitle && art.aiTitle.toLowerCase().includes(q));
      const matchSource = art.sourceName.toLowerCase().includes(q);
      return matchTitle || matchSource;
    }
    return true;
  });

  const countPending = articles.filter((a) => a.status === 'pending').length;
  const countReady = articles.filter((a) => a.status === 'ready').length;
  const countPublished = articles.filter((a) => a.status === 'published').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Metrics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Portais de Notícias & Scraping AI
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Monitore portais em tempo real, minere matérias e reescreva de forma autônoma para seus blogs.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={handleSyncAllR2}
            disabled={syncingR2All}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100 shadow-xs cursor-pointer disabled:opacity-60"
            title="Enviar todos os artigos capturados para o Cloudflare R2 e atualizar feeds"
          >
            <Cloud className={`w-3.5 h-3.5 ${syncingR2All ? 'animate-spin' : ''}`} />
            {syncingR2All ? 'Sincronizando R2...' : 'Sincronizar R2'}
          </button>
          <button
            onClick={handleSyncFeedsR2}
            disabled={syncingFeedsR2}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 shadow-xs cursor-pointer disabled:opacity-60"
            title="Atualizar feeds agregados (janelas de 6h Recife) no Cloudflare R2"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            {syncingFeedsR2 ? 'Atualizando...' : 'Feeds R2'}
          </button>
          <button
            onClick={() => fetchData()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </button>
          <button
            onClick={() => setShowAddSourceModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Adicionar Fonte
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-xl text-sm flex items-center justify-between shadow-sm border ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs font-semibold underline ml-4 hover:opacity-80"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Fontes Ativas</span>
            <Rss className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{sources.length}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Aguardando IA</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-2">{countPending}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Prontos p/ Postar</span>
            <Sparkles className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-indigo-600 mt-2">{countReady}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Publicados no WP</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">{countPublished}</div>
        </div>
      </div>

      {/* News Sources List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Fontes de Notícias Conectadas</h3>
            <p className="text-xs text-slate-500">Portais e Feeds RSS monitorados para extração periódica.</p>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            Nenhuma fonte cadastrada. Clique em "Adicionar Fonte" para começar.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map((src) => (
              <div
                key={src.id}
                className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-800">
                        {src.category}
                      </span>
                      {src.active === false && (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                          Pausada
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEditSource(src)}
                        className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-slate-200/60 transition-colors cursor-pointer"
                        title="Editar Fonte"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteSource(src.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-slate-200/60 transition-colors cursor-pointer"
                        title="Excluir Fonte"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <h4 className="font-bold text-sm text-slate-900 mt-2 line-clamp-1">{src.name}</h4>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{src.url}</p>

                  <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
                    <span>{src.articlesCount || 0} matérias</span>
                    <span>•</span>
                    <span>
                      {src.lastScrapedAt
                        ? `Scraped: ${new Date(src.lastScrapedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                        : 'Nunca executado'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                    <Clock className="w-3 h-3 text-slate-500" />
                    A cada {src.intervalMinutes || 15} min
                  </span>
                  <button
                    onClick={() => handleRunScrape(src.id)}
                    disabled={scrapingSourceId === src.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    <Play className={`w-3 h-3 ${scrapingSourceId === src.id ? 'animate-spin' : ''}`} />
                    {scrapingSourceId === src.id ? 'Minerando...' : 'Minerar Agora'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Articles Feed & Operations */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">Artigos Minerados ({filteredArticles.length})</h3>
            <p className="text-xs text-slate-500">
              Revise as matérias capturadas, reescreva com o Gemini e envie para seus sites WordPress.
            </p>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar nas notícias..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pb-4 mb-4 border-b border-slate-100">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({articles.length})
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Aguardando IA ({countPending})
          </button>
          <button
            onClick={() => setStatusFilter('ready')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              statusFilter === 'ready'
                ? 'bg-indigo-600 text-white'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            Prontos p/ Postar ({countReady})
          </button>
          <button
            onClick={() => setStatusFilter('published')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              statusFilter === 'published'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Publicados ({countPublished})
          </button>
        </div>

        {/* Articles Table / Cards */}
        {loading ? (
          <div className="text-center py-12 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
            Carregando artigos...
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            Nenhum artigo encontrado com os filtros selecionados.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredArticles.map((art) => (
              <div key={art.id} className="py-4.5 flex flex-col md:flex-row items-start gap-4 hover:bg-slate-50/70 p-3 rounded-xl transition-colors">
                {/* Thumbnail Image */}
                <div className="w-full md:w-36 h-24 shrink-0 rounded-lg bg-slate-100 overflow-hidden relative border border-slate-200">
                  {art.imageUrl ? (
                    <img
                      src={art.imageUrl}
                      alt={art.originalTitle}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                      Sem Foto
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-bold text-indigo-600">{art.sourceName}</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-[11px] text-slate-400">
                      {art.publishedAt ? new Date(art.publishedAt).toLocaleDateString('pt-BR') : ''}
                    </span>
                    <span className="text-slate-300">•</span>

                    {/* Status Badge */}
                    {art.status === 'ready' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        <Sparkles className="w-2.5 h-2.5" /> REESCRITO COM IA
                      </span>
                    )}
                    {art.status === 'published' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-2.5 h-2.5" /> PUBLICADO WP
                      </span>
                    )}
                    {art.status === 'pending' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock className="w-2.5 h-2.5" /> PENDENTE
                      </span>
                    )}
                    {art.status === 'rewriting' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 animate-pulse">
                        <Sparkles className="w-2.5 h-2.5" /> GERANDO IA...
                      </span>
                    )}

                    {/* R2 Cloud Storage Badge */}
                    {art.r2JsonUrl && (
                      <a
                        href={art.r2JsonUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors"
                        title="Ver JSON no Cloudflare R2 Edge Storage"
                      >
                        <Cloud className="w-2.5 h-2.5 text-orange-500" /> JSON R2
                      </a>
                    )}
                  </div>

                  <h4 className="font-bold text-sm text-slate-900 leading-snug">
                    {art.aiTitle ? (
                      <span className="text-indigo-950">{art.aiTitle}</span>
                    ) : (
                      art.originalTitle
                    )}
                  </h4>

                  {art.subtitle && (
                    <p className="text-xs text-slate-500 font-medium italic mt-0.5 line-clamp-1">
                      {art.subtitle}
                    </p>
                  )}

                  {art.author && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Por: <span className="text-slate-600 font-medium">{art.author}</span>
                    </p>
                  )}

                  {art.aiTitle && (
                    <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                      <span className="font-medium text-slate-500">Original:</span> {art.originalTitle}
                    </p>
                  )}

                  <p className="text-xs text-slate-600 line-clamp-2 mt-1">
                    {art.aiExcerpt || art.originalExcerpt}
                  </p>

                  {/* SEO Keywords tags if available */}
                  {art.aiSeoKeywords && art.aiSeoKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {art.aiSeoKeywords.slice(0, 4).map((kw, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                          #{kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions Button Group */}
                <div className="flex flex-row md:flex-col items-center md:items-end gap-2 shrink-0 w-full md:w-auto justify-end border-t md:border-t-0 pt-2 md:pt-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewArticle(art)}
                      className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      title="Ver Prévia Completa"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleSyncArticleR2(art.id)}
                      disabled={syncingArticleR2Id === art.id}
                      className="p-1.5 text-slate-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer"
                      title="Sincronizar Artigo no Cloudflare R2"
                    >
                      <Cloud className={`w-4 h-4 ${syncingArticleR2Id === art.id ? 'animate-spin text-orange-500' : ''}`} />
                    </button>
                    <a
                      href={art.wpPermalink || art.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      title="Abrir Link Externo"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => handleDeleteArticle(art.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRewriteArticle(art.id)}
                      disabled={rewritingArticleId === art.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${rewritingArticleId === art.id ? 'animate-spin' : ''}`} />
                      {rewritingArticleId === art.id ? 'Gerando...' : art.aiTitle ? 'Re-escrever' : 'Gerar com IA'}
                    </button>

                    <button
                      onClick={() => {
                        setPublishModalArticle(art);
                      }}
                      disabled={publishingArticleId === art.id || sites.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {art.status === 'published' ? 'Re-postar' : 'Postar no WP'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Adicionar Fonte */}
      {showAddSourceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Cadastrar Fonte de Notícias</h3>
                <p className="text-xs text-slate-500">Adicione uma URL de feed RSS ou portal para mineração contínua.</p>
              </div>
              <button
                onClick={() => setShowAddSourceModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSource} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome da Fonte
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: G1 Tecnologia, CNN Negócios, TechCrunch"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  URL do Feed RSS ou Categoria do Portal
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://g1.globo.com/rss/g1/tecnologia/ ou https://portal.com/feed"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoria
                  </label>
                  <input
                    type="text"
                    placeholder="Tecnologia, Economia, Saúde..."
                    value={sourceCategory}
                    onChange={(e) => setSourceCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Site WP de Destino
                  </label>
                  <select
                    value={sourceTargetSite}
                    onChange={(e) => setSourceTargetSite(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    <option value="">Nenhum (Manual)</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.siteName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Frequência de Captura Automática
                </label>
                <select
                  value={sourceIntervalMinutes}
                  onChange={(e) => setSourceIntervalMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                >
                  <option value={5}>A cada 5 minutos (Mais frequente)</option>
                  <option value={15}>A cada 15 minutos (Recomendado)</option>
                  <option value={30}>A cada 30 minutos</option>
                  <option value={60}>A cada 1 hora</option>
                  <option value={120}>A cada 2 horas</option>
                  <option value={360}>A cada 6 horas</option>
                  <option value={720}>A cada 12 horas</option>
                  <option value={1440}>A cada 24 horas (Diário)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  O coletor monitora este portal continuamente e extrai exclusivamente o artigo mais recente, ignorando matérias já capturadas.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddSourceModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingSource}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow disabled:opacity-50 cursor-pointer"
                >
                  {submittingSource ? 'Salvando...' : 'Adicionar Fonte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Fonte de Notícias */}
      {editingSource && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Editar Fonte de Notícias</h3>
                <p className="text-xs text-slate-500">Atualize as configurações e periodicidade desta fonte.</p>
              </div>
              <button
                onClick={() => setEditingSource(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateSource} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome da Fonte
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Ex: G1 Tecnologia, Poder360, CNN Negócios"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  URL do Feed RSS ou Categoria do Portal
                </label>
                <input
                  type="url"
                  required
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoria
                  </label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Site WP de Destino
                  </label>
                  <select
                    value={editTargetSite}
                    onChange={(e) => setEditTargetSite(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    <option value="">Nenhum (Manual)</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.siteName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Frequência de Captura Automática
                </label>
                <select
                  value={editIntervalMinutes}
                  onChange={(e) => setEditIntervalMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                >
                  <option value={5}>A cada 5 minutos (Mais frequente)</option>
                  <option value={15}>A cada 15 minutos (Recomendado)</option>
                  <option value={30}>A cada 30 minutos</option>
                  <option value={60}>A cada 1 hora</option>
                  <option value={120}>A cada 2 horas</option>
                  <option value={360}>A cada 6 horas</option>
                  <option value={720}>A cada 12 horas</option>
                  <option value={1440}>A cada 24 horas (Diário)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  O coletor monitora este portal continuamente e extrai exclusivamente o artigo mais recente, ignorando matérias já capturadas.
                </p>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-700 font-medium">
                    Fonte ativa (habilitada para mineração autônoma periódica)
                  </span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingSource(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingEditSource}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow disabled:opacity-50 cursor-pointer"
                >
                  {submittingEditSource ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Publicar no WordPress */}
      {publishModalArticle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Publicar Matéria no WordPress</h3>
              <button
                onClick={() => setPublishModalArticle(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <span className="text-xs text-slate-500">Título que será enviado:</span>
                <p className="font-bold text-sm text-slate-900 mt-1">
                  {publishModalArticle.aiTitle || publishModalArticle.originalTitle}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Selecione o Site WordPress
                </label>
                <select
                  value={selectedPublishSiteId}
                  onChange={(e) => setSelectedPublishSiteId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.siteName} ({site.siteUrl})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 space-y-1">
                <div>✓ Foto de destaque será baixada e anexada no WordPress</div>
                <div>✓ Formatação HTML e intertítulos preservados</div>
                <div>✓ Tags de SEO serão configuradas automaticamente</div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPublishModalArticle(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handlePublishToWordPress(publishModalArticle.id, selectedPublishSiteId)}
                  disabled={publishingArticleId === publishModalArticle.id || !selectedPublishSiteId}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow disabled:opacity-50 cursor-pointer"
                >
                  {publishingArticleId === publishModalArticle.id ? 'Publicando...' : 'Confirmar Publicação'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawer / Modal: Prévia Completa do Artigo */}
      {previewArticle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">
                  {previewArticle.sourceName}
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5 line-clamp-1">
                  {previewArticle.aiTitle || previewArticle.originalTitle}
                </h3>
              </div>
              <button
                onClick={() => setPreviewArticle(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-medium">
                  Status: <strong>{previewArticle.status}</strong>
                </span>
                {previewArticle.wpPermalink && (
                  <a
                    href={previewArticle.wpPermalink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 font-medium hover:underline flex items-center gap-1"
                  >
                    Ver no WordPress <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <a
                  href={previewArticle.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-medium hover:underline flex items-center gap-1"
                >
                  Link da Fonte Original <ExternalLink className="w-3 h-3" />
                </a>

                {previewArticle.r2JsonUrl && (
                  <a
                    href={previewArticle.r2JsonUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded-md bg-orange-50 text-orange-700 font-medium hover:underline flex items-center gap-1 border border-orange-200"
                  >
                    <Cloud className="w-3 h-3 text-orange-500" /> Ver JSON no Cloudflare R2 <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {previewArticle.subtitle && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium italic">
                  {previewArticle.subtitle}
                </div>
              )}

              {previewArticle.author && (
                <div className="text-xs text-slate-500">
                  Autor reportado: <strong className="text-slate-800">{previewArticle.author}</strong>
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  {previewArticle.aiTitle ? 'Conteúdo Reescrito por IA (HTML)' : 'Conteúdo Original'}
                </h4>
                <div
                  className="prose prose-sm max-w-none p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: previewArticle.aiContent || previewArticle.originalContent,
                  }}
                />
              </div>

              {previewArticle.aiSeoKeywords && previewArticle.aiSeoKeywords.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Palavras-Chave de SEO (Tags)
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {previewArticle.aiSeoKeywords.map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100">
                        #{kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <button
                onClick={() => setPreviewArticle(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Fechar
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRewriteArticle(previewArticle.id)}
                  disabled={rewritingArticleId === previewArticle.id}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {rewritingArticleId === previewArticle.id ? 'Gerando...' : 'Re-escrever com IA'}
                </button>
                <button
                  onClick={() => {
                    setPublishModalArticle(previewArticle);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Publicar no WordPress
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
