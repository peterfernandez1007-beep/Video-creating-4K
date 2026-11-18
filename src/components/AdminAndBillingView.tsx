import { CheckCircle2, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { AIModelCapability, AIProvider, BillingSummary, UserProfile } from '../types/studio';

interface AdminAndBillingViewProps {
  user: UserProfile | null;
  providers: AIProvider[];
  models: AIModelCapability[];
  billing: BillingSummary | null;
  onRefresh: () => Promise<void>;
}

export function AdminAndBillingView({
  user,
  providers,
  models,
  billing,
  onRefresh,
}: AdminAndBillingViewProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [externalKeyInputs, setExternalKeyInputs] = useState<Record<string, string>>({});

  // Add new external provider form
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvName, setNewProvName] = useState('');
  const [newProvSlug, setNewProvSlug] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');
  const [newProvKey, setNewProvKey] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await api.testProvider(id);
      setTestMessages((prev) => ({ ...prev, [id]: { ok: res.ok, msg: res.message } }));
      await onRefresh();
    } catch (err) {
      setTestMessages((prev) => ({
        ...prev,
        [id]: { ok: false, msg: err instanceof Error ? err.message : 'Test failed' },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveExternalProviderKey = async (id: string) => {
    setErrorMsg(null);
    try {
      await api.updateProvider(id, { apiKey: externalKeyInputs[id] });
      setExternalKeyInputs((prev) => ({ ...prev, [id]: '' }));
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await api.addProvider({
        name: newProvName,
        slug: newProvSlug,
        category: 'video',
        baseUrl: newProvUrl,
        apiKey: newProvKey || undefined,
      });
      setShowAddProvider(false);
      setNewProvName('');
      setNewProvSlug('');
      setNewProvUrl('');
      setNewProvKey('');
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add provider');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">
            Cost Transparency & API Provider Registry
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Free Editing Mode is active for local FFmpeg cutting, effects, and exports. Paid AI usage is tracked transparently.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#141722] border border-white/10 text-xs text-slate-200 hover:bg-[#1B1F2E]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Registry</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-500/30 text-xs text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* Cost & Usage Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#11131B] border border-white/8">
          <div className="text-xs text-slate-400">Editing Mode</div>
          <div className="text-lg font-semibold text-emerald-400 mt-1">Free Editing Mode</div>
          <div className="text-xs text-slate-500 mt-0.5">FFmpeg Timeline & Exports: $0.00</div>
        </div>
        <div className="p-4 rounded-xl bg-[#11131B] border border-white/8">
          <div className="text-xs text-slate-400">Actual Recorded AI Spend</div>
          <div className="text-lg font-mono font-semibold text-white tabular-nums mt-1">
            ${(billing?.totalSpentUsd ?? 0).toFixed(3)} USD
          </div>
          <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {billing?.paidOperationsCount ?? 0} paid · {billing?.freeOperationsCount ?? 0} free calls
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[#11131B] border border-white/8">
          <div className="text-xs text-slate-400">Registered Providers</div>
          <div className="text-lg font-mono font-semibold text-white tabular-nums mt-1">
            {providers.filter((p) => p.enabled).length} / {providers.length} Enabled
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Backend AES-256-GCM Secret Storage</div>
        </div>
      </div>

      {/* Admin Provider Configuration */}
      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>AI Provider Adapters {isAdmin ? '(Admin Access)' : '(Read-Only)'}</span>
          </h2>
          {isAdmin && (
            <button
              onClick={() => setShowAddProvider((s) => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add External Provider</span>
            </button>
          )}
        </div>

        {showAddProvider && isAdmin && (
          <form
            onSubmit={handleCreateProvider}
            className="p-4 rounded-lg bg-[#090A0F] border border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
          >
            <input
              required
              placeholder="Provider Name (e.g. Luma Dream Machine)"
              value={newProvName}
              onChange={(e) => setNewProvName(e.target.value)}
              className="rounded bg-[#141722] border border-white/10 px-3 py-2 text-white"
            />
            <input
              required
              placeholder="Slug (e.g. luma-ray)"
              value={newProvSlug}
              onChange={(e) => setNewProvSlug(e.target.value)}
              className="rounded bg-[#141722] border border-white/10 px-3 py-2 text-white"
            />
            <input
              required
              placeholder="API Base URL (https://...)"
              value={newProvUrl}
              onChange={(e) => setNewProvUrl(e.target.value)}
              className="rounded bg-[#141722] border border-white/10 px-3 py-2 text-white"
            />
            <input
              type="password"
              placeholder="External Provider Bearer Token (encrypted on server)"
              value={newProvKey}
              onChange={(e) => setNewProvKey(e.target.value)}
              className="rounded bg-[#141722] border border-white/10 px-3 py-2 text-white"
            />
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 rounded bg-indigo-600 text-white font-semibold"
              >
                Register Provider
              </button>
            </div>
          </form>
        )}

        <div className="space-y-3">
          {providers.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-lg bg-[#090A0F] border border-white/8 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white text-sm">{p.name}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-slate-400">{p.category}</span>
                  <span className="text-slate-400">·</span>
                  <span
                    className={
                      p.status === 'ready'
                        ? 'text-emerald-400'
                        : p.status === 'error'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }
                  >
                    {p.status}
                  </span>
                </div>
                <div className="text-slate-500 font-mono truncate">
                  {p.baseUrl} · Limit {p.rateLimitRpm} RPM
                </div>
                {testMessages[p.id] && (
                  <div
                    className={
                      testMessages[p.id].ok ? 'text-emerald-300' : 'text-rose-300'
                    }
                  >
                    {testMessages[p.id].msg}
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {p.authType === 'bearer_key' && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        placeholder={p.hasApiKey ? '••••••• (update key)' : 'Enter external API key'}
                        value={externalKeyInputs[p.id] || ''}
                        onChange={(e) =>
                          setExternalKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        className="w-44 rounded bg-[#141722] border border-white/10 px-2.5 py-1.5 text-white"
                      />
                      <button
                        onClick={() => handleSaveExternalProviderKey(p.id)}
                        disabled={!externalKeyInputs[p.id]}
                        className="px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white disabled:opacity-40"
                      >
                        Save Key
                      </button>
                    </div>
                  )}

                  {p.authType === 'env_gemini' && (
                    <span className="text-slate-400 px-2">Managed via Runtime Secrets</span>
                  )}

                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={testingId === p.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-[#181C29] hover:bg-[#222738] border border-white/10 text-slate-200"
                  >
                    {testingId === p.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>Test</span>
                  </button>

                  <button
                    onClick={async () => {
                      await api.updateProvider(p.id, { enabled: !p.enabled });
                      await onRefresh();
                    }}
                    className={`px-3 py-1.5 rounded font-medium ${
                      p.enabled
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10'
                    }`}
                  >
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Model Capability Registry Table */}
      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3 overflow-x-auto">
        <h2 className="text-sm font-semibold text-white">Model Capability Registry</h2>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2 pr-4 font-medium">Model</th>
              <th className="py-2 pr-4 font-medium">Provider</th>
              <th className="py-2 pr-4 font-medium">Resolutions</th>
              <th className="py-2 pr-4 font-medium">Native 4K</th>
              <th className="py-2 pr-4 font-medium">Ratios</th>
              <th className="py-2 pr-4 font-medium text-right">Pricing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {models.map((m) => (
              <tr key={m.id} className="hover:bg-white/[0.02]">
                <td className="py-2.5 pr-4 font-medium text-slate-100">{m.displayName}</td>
                <td className="py-2.5 pr-4 text-slate-400">{m.providerName}</td>
                <td className="py-2.5 pr-4 font-mono text-slate-300">
                  {m.supportedResolutions.length ? m.supportedResolutions.join(', ') : 'Audio / Text'}
                </td>
                <td className="py-2.5 pr-4">
                  <span className={m.native4k ? 'text-emerald-400' : 'text-slate-500'}>
                    {m.native4k ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-2.5 pr-4 font-mono text-slate-400">
                  {m.supportedAspectRatios.join(', ')}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-200">
                  {m.freeTierAvailable
                    ? 'Free Tier'
                    : m.pricingPerSecUsd > 0
                      ? `$${m.pricingPerSecUsd}/s`
                      : `$${m.pricingPerCallUsd}/call`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* API Usage History */}
      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
        <h2 className="text-sm font-semibold text-white">Recent API & Rendering Usage</h2>
        {!billing || billing.usage.length === 0 ? (
          <p className="text-xs text-slate-500">No generation usage logged yet.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            {billing.usage.slice(0, 12).map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between py-2 border-b border-white/6"
              >
                <div className="min-w-0">
                  <span className="text-slate-200 font-medium">{u.modelId}</span>
                  <span className="text-slate-500"> · {u.units}</span>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
                  <span className={u.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}>
                    {u.status}
                  </span>
                  <span className="text-slate-200">${u.costUsd.toFixed(3)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
