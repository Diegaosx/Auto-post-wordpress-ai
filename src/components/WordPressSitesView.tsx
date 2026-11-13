import React, { useState, useEffect } from 'react';
import { WordPressSite, WordPressLog } from '../shared/types';
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
} from 'lucide-react';

interface WordPressSitesViewProps {
  token: string;
}

export function WordPressSitesView({ token }: WordPressSitesViewProps) {
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [logs, setLogs] = useState<WordPressLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [formSiteName, setFormSiteName] = useState('');
  const [formSiteUrl, setFormSiteUrl] = useState('');
  const [formCategory, setFormCategory] = useState('Geral');
  const [formStatus, setFormStatus] = useState<'publish' | 'draft'>('publish');
  const [formAutoPublish, setFormAutoPublish] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch('/api/wordpress/logs?limit=15', {
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

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSites(), fetchLogs()]).finally(() => setLoading(false));
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
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    }
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/wordpress/sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          siteName: formSiteName,
          siteUrl: formSiteUrl,
          defaultCategory: formCategory,
          defaultStatus: formStatus,
          autoPublish: formAutoPublish,
        }),
      });

      if (res.ok) {
        setShowCreateModal(false);
        setFormSiteName('');
        setFormSiteUrl('');
        setActionMessage({
          type: 'success',
          text: 'Site vinculado com sucesso! Chave de licença gerada.',
        });
        fetchSites();
        fetchLogs();
      } else {
        const err = await res.json();
        setActionMessage({ type: 'error', text: err.error || 'Erro ao criar site.' });
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
              onClick={() => setShowCreateModal(true)}
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

      {/* Sites List Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Sites Vinculados</h3>
          <p className="text-xs text-slate-500">
            Gerencie as conexões ativas e configure regras de publicação automática por portal.
          </p>
        </div>
        <button
          onClick={() => {
            fetchSites();
            fetchLogs();
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
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
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Cadastrar Primeiro Site
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sites.map((site) => (
            <div
              key={site.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col justify-between"
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

                  {/* Status Badge */}
                  <div>
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

                {/* Config Details */}
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-lg">
                    <span className="text-slate-500 block">Categoria Padrão</span>
                    <span className="font-semibold text-slate-800">{site.defaultCategory || 'Geral'}</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded-lg">
                    <span className="text-slate-500 block">Status ao Postar</span>
                    <span className="font-semibold text-slate-800 uppercase">{site.defaultStatus}</span>
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
                <button
                  onClick={() => handleTestConnection(site.id)}
                  disabled={testingId === site.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingId === site.id ? 'animate-spin' : ''}`} />
                  {testingId === site.id ? 'Testando...' : 'Testar Conexão'}
                </button>

                <button
                  onClick={() => handleDeleteSite(site.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                  title="Remover Site"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity Logs Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-base font-bold text-slate-900 mb-1">Histórico de Atividades do WordPress</h3>
        <p className="text-xs text-slate-500 mb-4">
          Registro das últimas publicações e checagens de integridade com as REST APIs dos sites.
        </p>

        {logs.length === 0 ? (
          <div className="text-xs text-slate-400 py-6 text-center">Nenhum evento registrado ainda.</div>
        ) : (
          <div className="overflow-x-auto">
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
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-500">
                      {new Date(log.timestamp).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{log.siteName || log.siteId}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{log.action}</td>
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
        )}
      </div>

      {/* Modal: Vincular Novo Site */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Vincular Novo Site WordPress</h3>
                <p className="text-xs text-slate-500">Gere uma nova licença e conecte seu blog ou portal.</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSite} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome do Site
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Portal Notícias Brasil"
                  value={formSiteName}
                  onChange={(e) => setFormSiteName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  URL Completa do WordPress
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://meuportal.com.br"
                  value={formSiteUrl}
                  onChange={(e) => setFormSiteUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoria Padrão
                  </label>
                  <input
                    type="text"
                    placeholder="Notícias, Geral..."
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status Padrão
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as 'publish' | 'draft')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                  >
                    <option value="publish">Publicar Imediatamente</option>
                    <option value="draft">Salvar como Rascunho</option>
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formAutoPublish}
                    onChange={(e) => setFormAutoPublish(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-700 font-medium">
                    Habilitar autopublicação direta quando matérias forem mineradas
                  </span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Gerando Licença...' : 'Cadastrar e Gerar Licença'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
