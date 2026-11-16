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
  ChevronLeft,
  ChevronRight,
  Shield,
  CheckSquare,
  Square,
  Loader2,
  Globe,
} from 'lucide-react';

interface ScraperViewProps {
  token: string;
}

export function ScraperView({ token }: ScraperViewProps) {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [articles, setArticles] = useState<CapturedArticle[]>([]);
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [selectedSourceId, setSelectedSourceId] = useState<string>('all');
  const [r2Filter, setR2Filter] = useState<'all' | 'synced' | 'unsynced'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [forceRePublish, setForceRePublish] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchResults, setDispatchResults] = useState<Array<{
    siteId: string;
    siteName: string;
    success: boolean;
    wpPostId?: number;
    permalink?: string;
    message?: string;
    error?: string;
  }> | null>(null);
  const [dispatchStep, setDispatchStep] = useState<string>('');
  const [dispatchProgress, setDispatchProgress] = useState<number>(0);
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

  const formatCaptureDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('pt-BR');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${date} às ${time}`;
  };

  const fetchData = async () => {
    try {
      const [srcRes, artRes, sitesRes] = await Promise.all([
        fetch('/api/scraper/sources', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/scraper/articles?limit=2000', { headers: { Authorization: `Bearer ${token}` } }),
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
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${res.status}: Erro na resposta do servidor`);
      }
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
          text: data.alreadyPublished
            ? (data.message || 'Artigo já publicado anteriormente neste site. Duplicação evitada.')
            : `Artigo publicado com sucesso no WordPress! ID: ${data.wpPostId}`,
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

  const handleOpenRewriteModal = (art: CapturedArticle) => {
    setPublishModalArticle(art);
    setDispatchResults(null);
    setDispatchStep('');
    setDispatchProgress(0);
    setSiteSearchQuery('');
    setForceRePublish(false);
    if (sites.length === 1) {
      setSelectedSiteIds([sites[0].id]);
    } else if (art.wpSiteId && sites.some((s) => s.id === art.wpSiteId)) {
      setSelectedSiteIds([art.wpSiteId]);
    } else {
      setSelectedSiteIds(sites.map((s) => s.id));
    }
  };

  const handleToggleSiteSelection = (siteId: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
  };

  const handleSelectAllSites = (list: WordPressSite[]) => {
    setSelectedSiteIds(list.map((s) => s.id));
  };

  const handleDeselectAllSites = () => {
    setSelectedSiteIds([]);
  };

  const pollRewriteJob = async (jobId: string) => {
    const maxAttempts = 180; // até 6 minutos (180 * 2s)
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;

      try {
        const pollRes = await fetch(`/api/scraper/rewrite-jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const pollText = await pollRes.text();
        let pollData: any = {};
        try {
          pollData = JSON.parse(pollText);
        } catch {
          continue;
        }

        if (pollData.job) {
          const job = pollData.job;
          if (job.currentStep) setDispatchStep(job.currentStep);
          if (job.progress !== undefined) setDispatchProgress(job.progress);

          if (job.status === 'completed') {
            setDispatchResults(job.results || []);
            fetchData();
            return;
          }

          if (job.status === 'failed') {
            setDispatchResults(
              job.results && job.results.length > 0
                ? job.results
                : [{ siteId: 'error', siteName: 'Erro de Processamento', success: false, error: job.error || 'Falha ao processar job.' }]
            );
            return;
          }
        }
      } catch (pollErr: any) {
        console.warn('[Poll Error]:', pollErr.message);
      }
    }

    throw new Error('O tempo limite de espera foi excedido, mas o processo continua em execução no servidor. Verifique a lista em instantes.');
  };

  const handleDispatchRewriteAndPublish = async () => {
    if (!publishModalArticle || selectedSiteIds.length === 0) return;
    setIsDispatching(true);
    setDispatchResults(null);
    setDispatchStep('Iniciando processamento autônomo com IA...');
    setDispatchProgress(10);

    try {
      const res = await fetch(`/api/scraper/articles/${publishModalArticle.id}/rewrite-and-publish-to-sites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          siteIds: selectedSiteIds,
          force: forceRePublish,
        }),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${res.status}: Erro retornado pelo servidor ou proxy intermediário.`);
      }

      // Se retornou jobId para acompanhamento assíncrono (sem timeout de proxy)
      if (data.jobId) {
        setDispatchStep('Aguardando reescrita autoral via Cluster Antigravity...');
        setDispatchProgress(25);
        await pollRewriteJob(data.jobId);
      } else if (data.results) {
        setDispatchResults(data.results);
        fetchData();
      } else if (data.error) {
        setDispatchResults([
          { siteId: 'error', siteName: 'Sistema', success: false, error: data.error },
        ]);
      }
    } catch (err: any) {
      setDispatchResults([
        { siteId: 'error', siteName: 'Falha no Envio', success: false, error: err.message || 'Falha na requisição' },
      ]);
    } finally {
      setIsDispatching(false);
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

  // Filtered and Sorted Articles
  const filteredArticles = articles
    .filter((art) => {
      // Filtro por Fonte
      if (selectedSourceId !== 'all' && art.sourceId !== selectedSourceId) {
        return false;
      }
      // Filtro por Cloudflare R2
      if (r2Filter === 'synced' && !art.r2JsonUrl) return false;
      if (r2Filter === 'unsynced' && art.r2JsonUrl) return false;
      // Filtro de Busca por Texto
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = art.originalTitle.toLowerCase().includes(q) || (art.aiTitle && art.aiTitle.toLowerCase().includes(q));
        const matchSource = art.sourceName.toLowerCase().includes(q);
        const matchAuthor = art.author ? art.author.toLowerCase().includes(q) : false;
        const matchExcerpt = art.originalExcerpt ? art.originalExcerpt.toLowerCase().includes(q) : false;
        if (!matchTitle && !matchSource && !matchAuthor && !matchExcerpt) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const timeA = new Date(a.publishedAt || a.createdAt).getTime();
      const timeB = new Date(b.publishedAt || b.createdAt).getTime();
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });

  const totalArticles = filteredArticles.length;
  const totalPages = Math.max(1, Math.ceil(totalArticles / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedArticles = filteredArticles.slice(startIndex, startIndex + pageSize);

  const handleSourceFilterChange = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    setCurrentPage(1);
  };

  const handleR2FilterChange = (val: 'all' | 'synced' | 'unsynced') => {
    setR2Filter(val);
    setCurrentPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handleSortChange = (val: 'newest' | 'oldest') => {
    setSortOrder(val);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (val: number) => {
    setPageSize(val);
    setCurrentPage(1);
  };

  const filteredModalSites = sites.filter((site) => {
    if (!siteSearchQuery.trim()) return true;
    const q = siteSearchQuery.toLowerCase().trim();
    return site.siteName.toLowerCase().includes(q) || site.siteUrl.toLowerCase().includes(q);
  });

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
            <span className="text-xs font-medium text-slate-500">Artigos Capturados</span>
            <FileText className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{articles.length}</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Fontes Ativas</span>
            <Rss className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {sources.filter((s) => s.active !== false).length}
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">No Cloudflare R2</span>
            <Cloud className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-2xl font-bold text-orange-600 mt-2">
            {articles.filter((a) => a.r2JsonUrl).length}
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Capturados Hoje</span>
            <Calendar className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-indigo-600 mt-2">
            {
              articles.filter((a) => {
                const d = new Date(a.publishedAt || a.createdAt);
                const today = new Date();
                return d.toDateString() === today.toDateString();
              }).length
            }
          </div>
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">Artigos Minerados ({totalArticles})</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Matérias capturadas e sanitizadas para consumo pelos sites WordPress via plugin.
            </p>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 mb-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            {/* Source Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Fonte:</span>
              <select
                value={selectedSourceId}
                onChange={(e) => handleSourceFilterChange(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-medium text-slate-800"
              >
                <option value="all">Todas as Fontes ({articles.length})</option>
                {sources.map((src) => {
                  const count = articles.filter((a) => a.sourceId === src.id).length;
                  return (
                    <option key={src.id} value={src.id}>
                      {src.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* R2 Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">R2 Edge:</span>
              <select
                value={r2Filter}
                onChange={(e) => handleR2FilterChange(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-medium text-slate-800"
              >
                <option value="all">Todos os Artigos</option>
                <option value="synced">Sincronizados no R2</option>
                <option value="unsynced">Sem R2</option>
              </select>
            </div>

            {/* Sort Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Ordem:</span>
              <select
                value={sortOrder}
                onChange={(e) => handleSortChange(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-medium text-slate-800"
              >
                <option value="newest">Mais Recentes Primeiro</option>
                <option value="oldest">Mais Antigos Primeiro</option>
              </select>
            </div>

            {(selectedSourceId !== 'all' || r2Filter !== 'all' || searchQuery.trim()) && (
              <button
                onClick={() => {
                  setSelectedSourceId('all');
                  setR2Filter('all');
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2 ml-1 cursor-pointer"
              >
                Limpar filtros
              </button>
            )}
          </div>

          {/* Search Box */}
          <div className="relative w-full lg:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar título, resumo ou autor..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800"
            />
          </div>
        </div>

        {/* Articles Table / Cards */}
        {loading ? (
          <div className="text-center py-12 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
            Carregando artigos...
          </div>
        ) : paginatedArticles.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            Nenhum artigo encontrado com os filtros selecionados.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {paginatedArticles.map((art) => (
              <div key={art.id} className="py-4 flex flex-col md:flex-row items-start gap-4 hover:bg-slate-50/70 p-3 rounded-xl transition-colors">
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
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className="text-[11px] font-bold text-indigo-600">{art.sourceName}</span>
                    <span className="text-slate-300">•</span>
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md"
                      title={`Capturado no sistema em ${formatCaptureDateTime(art.createdAt || art.publishedAt)}`}
                    >
                      <Clock className="w-3 h-3 text-slate-400" />
                      {formatCaptureDateTime(art.createdAt || art.publishedAt)}
                    </span>
                    <span className="text-slate-300">•</span>

                    {/* Status Badge: Capturado */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-2.5 h-2.5" /> CAPTURADO
                    </span>

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
                </div>

                {/* Actions Button Group */}
                <div className="flex flex-row md:flex-col items-center md:items-end gap-2 shrink-0 w-full md:w-auto justify-end border-t md:border-t-0 pt-2 md:pt-0">
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <button
                      onClick={() => handleOpenRewriteModal(art)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-xs hover:shadow transition-all cursor-pointer shrink-0"
                      title="Reescrever matéria com IA aplicando diretrizes editoriais e publicar em portais selecionados"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>Reescrever & Publicar</span>
                    </button>

                    <button
                      onClick={() => setPreviewArticle(art)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
                      title="Visualizar Conteúdo da Matéria"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-500" />
                      Visualizar
                    </button>

                    <a
                      href={art.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      title="Abrir Fonte Original"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>

                    {art.r2JsonUrl && (
                      <a
                        href={art.r2JsonUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer"
                        title="Ver JSON no Cloudflare R2"
                      >
                        <Cloud className="w-4 h-4" />
                      </a>
                    )}

                    <button
                      onClick={() => handleDeleteArticle(art.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Excluir Artigo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Mostrando <strong className="text-slate-800">{startIndex + 1}</strong> a{' '}
              <strong className="text-slate-800">{Math.min(startIndex + pageSize, totalArticles)}</strong> de{' '}
              <strong className="text-slate-800">{totalArticles}</strong> artigos
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer font-medium text-slate-700"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((page) => {
                  return (
                    page === 1 ||
                    page === totalPages ||
                    Math.abs(page - safeCurrentPage) <= 1
                  );
                })
                .map((page, idx, arr) => {
                  const prevPage = arr[idx - 1];
                  return (
                    <React.Fragment key={page}>
                      {prevPage && page - prevPage > 1 && (
                        <span className="px-1 text-slate-300">...</span>
                      )}
                      <button
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-8 h-8 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                          safeCurrentPage === page
                            ? 'bg-indigo-600 text-white'
                            : 'border border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        {page}
                      </button>
                    </React.Fragment>
                  );
                })}

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer font-medium text-slate-700"
              >
                Próximo
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span>Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="px-2 py-1 border border-slate-200 rounded-md text-xs bg-white text-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
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

      {/* Modal: Reescrever com IA & Publicar em Múltiplos Sites */}
      {publishModalArticle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 via-white to-indigo-50/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-200 shrink-0">
                  <Sparkles className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Reescrever Matéria com IA & Publicar
                  </h3>
                  <p className="text-xs text-slate-500">
                    Selecione os portais de destino. A IA reescreverá o artigo aplicando as regras e diretrizes de cada portal.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isDispatching) {
                    setPublishModalArticle(null);
                    setDispatchResults(null);
                  }
                }}
                disabled={isDispatching}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto space-y-4">
              {/* Article Preview Card */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-600 mb-1">
                  <span>FONTE ORIGINAL: {publishModalArticle.sourceName}</span>
                  <span className="text-slate-400 font-normal">
                    {formatCaptureDateTime(publishModalArticle.createdAt || publishModalArticle.publishedAt)}
                  </span>
                </div>
                <h4 className="font-bold text-sm text-slate-900 leading-snug">
                  {publishModalArticle.originalTitle}
                </h4>
                {publishModalArticle.originalExcerpt && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {publishModalArticle.originalExcerpt}
                  </p>
                )}
              </div>

              {/* Informative Banner */}
              <div className="p-3 bg-indigo-50/80 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-indigo-950">Geração Autoral & Anti-Plágio:</strong>{' '}
                  A matéria será completamente reescrita para cada portal escolhido, respeitando rigorosamente as{' '}
                  <strong>Diretrizes Editoriais de IA</strong> e o <strong>Tom</strong> configurados para aquele site. Se a matéria não tiver foto ou for genérica, o Cluster Antigravity gerará uma fotografia fotorrealista inédita (Google Imagen 3) e anexará como destaque no WordPress.
                </div>
              </div>

              {/* Real-time Dispatch Feedback if active */}
              {isDispatching && (
                <div className="p-5 bg-gradient-to-br from-indigo-50/90 to-purple-50/80 border border-indigo-200/80 rounded-2xl shadow-sm space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-indigo-600/10 flex items-center justify-center shrink-0">
                        <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-indigo-950">
                          Reescrevendo com IA e Publicando
                        </p>
                        <p className="text-xs text-indigo-700 font-medium mt-0.5">
                          {dispatchStep || `Processando em segundo plano (${selectedSiteIds.length} ${selectedSiteIds.length === 1 ? 'portal' : 'portais'})...`}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-100/90 px-2.5 py-1 rounded-full border border-indigo-200/60">
                      {Math.max(10, Math.min(100, dispatchProgress))}%
                    </span>
                  </div>

                  {/* Barra de progresso */}
                  <div className="w-full bg-indigo-100/70 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-2 rounded-full transition-all duration-500 ease-out shadow-sm"
                      style={{ width: `${Math.max(10, Math.min(100, dispatchProgress))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-indigo-600/80 pt-1 border-t border-indigo-100/80">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      Job assíncrono ativo (blindado contra timeouts do proxy)
                    </span>
                    <span className="font-medium text-slate-500">Cluster Antigravity MCP</span>
                  </div>
                </div>
              )}

              {/* Results Panel */}
              {dispatchResults && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Resultado do Envio ({dispatchResults.length})
                    </span>
                  </div>
                  {dispatchResults.map((res, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                        res.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {res.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-bold text-slate-900">{res.siteName}</p>
                          <p className="mt-0.5">{res.message || res.error || (res.success ? 'Publicado com sucesso!' : 'Falha ao processar')}</p>
                        </div>
                      </div>

                      {res.permalink && (
                        <a
                          href={res.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg shrink-0 transition-colors"
                        >
                          Ver no WP <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Site Search & Selection (hidden while dispatching) */}
              {!isDispatching && !dispatchResults && (
                <>
                  <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-indigo-600" />
                        Portais WordPress Conectados ({sites.length})
                      </label>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => handleSelectAllSites(filteredModalSites)}
                          className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                        >
                          Selecionar Todos ({filteredModalSites.length})
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={handleDeselectAllSites}
                          className="text-slate-500 hover:text-slate-700 font-medium cursor-pointer"
                        >
                          Desmarcar Todos
                        </button>
                      </div>
                    </div>

                    {/* Search Bar */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={siteSearchQuery}
                        onChange={(e) => setSiteSearchQuery(e.target.value)}
                        placeholder="Buscar portal por nome ou URL..."
                        className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-50/50"
                      />
                    </div>
                  </div>

                  {/* List of Sites */}
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {filteredModalSites.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        Nenhum portal WordPress encontrado com o termo pesquisado.
                      </div>
                    ) : (
                      filteredModalSites.map((site) => {
                        const isSelected = selectedSiteIds.includes(site.id);
                        const isAlreadyPublished =
                          publishModalArticle.publishedSiteIds?.includes(site.id) ||
                          publishModalArticle.wpSiteId === site.id;
                        const hasDirectives = Boolean(site.aiCustomInstructions?.trim());

                        return (
                          <div
                            key={site.id}
                            onClick={() => handleToggleSiteSelection(site.id)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-50/50 border-indigo-300 ring-1 ring-indigo-200 shadow-2xs'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="mt-0.5 text-indigo-600 shrink-0">
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300" />
                                  )}
                                </div>

                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-xs text-slate-900">{site.siteName}</span>
                                    <span className="text-[11px] text-slate-400 truncate max-w-xs">{site.siteUrl}</span>
                                    {isAlreadyPublished && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                        <Shield className="w-2.5 h-2.5 text-amber-600" /> Já publicado neste portal
                                      </span>
                                    )}
                                  </div>

                                  {/* Directives & Tone Preview */}
                                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                      Tom: {site.aiTone || 'Jornalístico (Neutro & Formal)'}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium border border-indigo-100">
                                      {site.publishedArticlesCount ?? 0} matérias publicadas
                                    </span>
                                    {hasDirectives ? (
                                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                        <Sparkles className="w-3 h-3 text-emerald-500" /> Diretrizes ativas
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">Diretrizes padrão</span>
                                    )}
                                  </div>

                                  {hasDirectives && (
                                    <div className="mt-1.5 p-2 bg-white/80 rounded-md border border-slate-100 text-[11px] text-slate-600 italic line-clamp-2">
                                      "{site.aiCustomInstructions}"
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Anti-duplication Force Option */}
                  <div className="pt-2 flex items-center justify-between border-t border-slate-100 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-600 select-none">
                      <input
                        type="checkbox"
                        checked={forceRePublish}
                        onChange={(e) => setForceRePublish(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        Forçar reenvio mesmo se o artigo já constar como publicado no portal
                      </span>
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                {dispatchResults
                  ? 'Processo de envio finalizado.'
                  : `${selectedSiteIds.length} ${selectedSiteIds.length === 1 ? 'portal selecionado' : 'portais selecionados'}`}
              </span>

              <div className="flex items-center gap-2">
                {dispatchResults ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPublishModalArticle(null);
                      setDispatchResults(null);
                    }}
                    className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow cursor-pointer transition-colors"
                  >
                    Concluir & Fechar
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setPublishModalArticle(null)}
                      disabled={isDispatching}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleDispatchRewriteAndPublish}
                      disabled={isDispatching || selectedSiteIds.length === 0}
                      className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
                    >
                      {isDispatching ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Reescrevendo e Enviando...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                          <span>
                            Reescrever com IA & Publicar ({selectedSiteIds.length})
                          </span>
                        </>
                      )}
                    </button>
                  </>
                )}
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
                <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 font-medium border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Capturado
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  Capturado em: {formatCaptureDateTime(previewArticle.createdAt || previewArticle.publishedAt)}
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
                  type="button"
                  onClick={() => {
                    const art = previewArticle;
                    setPreviewArticle(null);
                    handleOpenRewriteModal(art);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-sm cursor-pointer transition-all"
                  title="Reescrever matéria com IA seguindo as diretrizes e publicar em sites específicos"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Reescrever & Publicar
                </button>

                <a
                  href={previewArticle.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir Fonte Original
                </a>
                {previewArticle.r2JsonUrl && (
                  <a
                    href={previewArticle.r2JsonUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5 text-orange-500" />
                    Ver JSON no R2
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
