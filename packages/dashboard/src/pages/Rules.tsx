import { AlgorithmType } from '@rateforge/types';
import { useEffect, useMemo, useState } from 'react';

import { fetchRules, replaceRules } from '../api/admin';
import { useDashboardShellContext } from '../App';

import type { RuleConfig } from '@rateforge/types';
import type { ChangeEvent, FormEvent } from 'react';

interface RuleFormState {
  algorithm: AlgorithmType;
  burstCapacity: string;
  clientTier: string;
  description: string;
  enabled: boolean;
  endpointPattern: string;
  id: string;
  maxRequests: string;
  method: string;
  windowMs: string;
}

const DEFAULT_RULE_FORM: RuleFormState = {
  id: '',
  description: '',
  clientTier: '',
  endpointPattern: '/api/v1',
  method: 'GET',
  windowMs: '60000',
  maxRequests: '60',
  burstCapacity: '',
  algorithm: AlgorithmType.TOKEN_BUCKET,
  enabled: true,
};

const formInputClass =
  'w-full rounded-md border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 placeholder:text-zinc-500';

function buildRuleConfig(form: RuleFormState): RuleConfig {
  const windowMs = Number(form.windowMs);
  const maxRequests = Number(form.maxRequests);
  const burstCapacity = form.burstCapacity.trim() ? Number(form.burstCapacity) : undefined;

  if (!form.id.trim()) {
    throw new Error('Rule id is required.');
  }

  if (!form.endpointPattern.trim()) {
    throw new Error('Endpoint pattern is required.');
  }

  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error('windowMs must be a positive integer.');
  }

  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new Error('maxRequests must be a positive integer.');
  }

  if (burstCapacity !== undefined && (!Number.isInteger(burstCapacity) || burstCapacity < 0)) {
    throw new Error('burstCapacity must be a non-negative integer when provided.');
  }

  return {
    id: form.id.trim(),
    description: form.description.trim() || undefined,
    clientTier: form.clientTier.trim() || undefined,
    endpointPattern: form.endpointPattern.trim(),
    method: form.method.trim() ? form.method.trim().toUpperCase() : undefined,
    windowMs,
    maxRequests,
    burstCapacity,
    algorithm: form.algorithm,
    enabled: form.enabled,
  };
}

function summariseRule(rule: RuleConfig): string {
  return `${rule.maxRequests} requests per ${Math.round(rule.windowMs / 1000)}s`;
}

function sectionHeading(step: string, title: string) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">{step}</span>
      <strong className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-200">
        {title}
      </strong>
    </div>
  );
}

export function RulesPage() {
  const { settings } = useDashboardShellContext();
  const [rules, setRules] = useState<RuleConfig[]>([]);
  const [form, setForm] = useState<RuleFormState>(DEFAULT_RULE_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const canManageRules = Boolean(settings.gatewayUrl.trim() && settings.adminPassphrase.trim());
  const ruleCountLabel = useMemo(
    () => `${rules.length} active rule${rules.length === 1 ? '' : 's'}`,
    [rules.length],
  );

  const loadCurrentRules = async (): Promise<void> => {
    if (!canManageRules) {
      setRules([]);
      setError('Save both the gateway URL and the admin passphrase to manage rules.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const nextRules = await fetchRules(settings);
      setRules(nextRules);
      setSuccess(`Loaded ${nextRules.length} rule(s) from the gateway.`);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load rules.';
      setError(message);
      setSuccess('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManageRules) {
      setRules([]);
      return;
    }

    void loadCurrentRules();
  }, [canManageRules, settings.adminPassphrase, settings.gatewayUrl]);

  const handleFieldChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ): void => {
    const target = event.target;
    const key = target.name as keyof RuleFormState;
    const value =
      target instanceof HTMLInputElement && target.type === 'checkbox'
        ? target.checked
        : target.value;

    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleAddRule = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!canManageRules) {
      setError('Save both the gateway URL and the admin passphrase before posting rules.');
      return;
    }

    try {
      const nextRule = buildRuleConfig(form);
      if (rules.some((rule) => rule.id === nextRule.id)) {
        throw new Error(`Rule id "${nextRule.id}" already exists.`);
      }

      setSaving(true);
      const nextRules = await replaceRules(settings, [...rules, nextRule]);
      setRules(nextRules);
      setForm(DEFAULT_RULE_FORM);
      setSuccess(`Rule "${nextRule.id}" added.`);
      setError('');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to add rule.';
      setError(message);
      setSuccess('');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string): Promise<void> => {
    if (!canManageRules) {
      setError('Save both the gateway URL and the admin passphrase before deleting rules.');
      return;
    }

    if (!window.confirm(`Delete rule "${ruleId}" from the active ruleset?`)) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const nextRules = await replaceRules(
        settings,
        rules.filter((rule) => rule.id !== ruleId),
      );
      setRules(nextRules);
      setSuccess(`Rule "${ruleId}" deleted.`);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Failed to delete rule.';
      setError(message);
      setSuccess('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-300">
            Policy surface
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
            Operate the live ruleset with a cleaner control plane.
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-zinc-400">
            The workflow is unchanged: add and delete actions still replace the full rules array
            through the existing admin endpoint so the frontend remains aligned with the gateway
            contract already in production.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <button
            className="inline-flex items-center justify-center rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
            type="button"
            onClick={() => void loadCurrentRules()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh rules'}
          </button>
          <p className="text-sm text-zinc-500">{ruleCountLabel}</p>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
          {success}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.15fr)]">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Policy composer
              </p>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-100">
                Compose a new policy
              </h3>
            </div>
            <span className="rounded-full border border-zinc-800 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
              {saving ? 'saving' : 'ready'}
            </span>
          </div>

          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(event) => void handleAddRule(event)}
          >
            <section className="space-y-4 rounded-xl border border-zinc-800 bg-black/20 p-4">
              {sectionHeading('01', 'Entry trigger')}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Rule ID
                  </span>
                  <input
                    className={formInputClass}
                    name="id"
                    value={form.id}
                    onChange={handleFieldChange}
                    placeholder="pro-read-burst"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Endpoint pattern
                  </span>
                  <input
                    className={`${formInputClass} font-mono text-xs`}
                    name="endpointPattern"
                    value={form.endpointPattern}
                    onChange={handleFieldChange}
                    placeholder="/api/v1/orders"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    HTTP method
                  </span>
                  <input
                    className={`${formInputClass} font-mono text-xs uppercase`}
                    name="method"
                    value={form.method}
                    onChange={handleFieldChange}
                    placeholder="GET"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Client tier
                  </span>
                  <input
                    className={formInputClass}
                    name="clientTier"
                    value={form.clientTier}
                    onChange={handleFieldChange}
                    placeholder="pro"
                  />
                </label>
              </div>
            </section>

            <section className="space-y-4 rounded-xl border border-zinc-800 bg-black/20 p-4">
              {sectionHeading('02', 'Rule logic')}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Window (ms)
                  </span>
                  <input
                    className={`${formInputClass} font-mono text-xs`}
                    name="windowMs"
                    type="number"
                    min="1"
                    value={form.windowMs}
                    onChange={handleFieldChange}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Max requests
                  </span>
                  <input
                    className={`${formInputClass} font-mono text-xs`}
                    name="maxRequests"
                    type="number"
                    min="1"
                    value={form.maxRequests}
                    onChange={handleFieldChange}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Burst capacity
                  </span>
                  <input
                    className={`${formInputClass} font-mono text-xs`}
                    name="burstCapacity"
                    type="number"
                    min="0"
                    value={form.burstCapacity}
                    onChange={handleFieldChange}
                    placeholder="Optional"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Algorithm
                  </span>
                  <select
                    className={formInputClass}
                    name="algorithm"
                    value={form.algorithm}
                    onChange={handleFieldChange}
                  >
                    <option value={AlgorithmType.TOKEN_BUCKET}>Token bucket</option>
                    <option value={AlgorithmType.FIXED_WINDOW}>Fixed window</option>
                    <option value={AlgorithmType.SLIDING_WINDOW}>Sliding window</option>
                    <option value={AlgorithmType.LEAKY_BUCKET}>Leaky bucket</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-4 rounded-xl border border-zinc-800 bg-black/20 p-4">
              {sectionHeading('03', 'Resulting action')}
              <label className="space-y-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Description
                </span>
                <textarea
                  className={formInputClass}
                  name="description"
                  value={form.description}
                  onChange={handleFieldChange}
                  rows={4}
                  placeholder="Describe why this rule exists and who it protects."
                />
              </label>
              <label className="flex items-center gap-3 text-sm text-zinc-400">
                <input
                  className="h-4 w-4 rounded border-zinc-700 bg-transparent text-cyan-500 focus:ring-cyan-500"
                  name="enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={handleFieldChange}
                />
                <span>Rule is enabled immediately after save.</span>
              </label>
            </section>

            <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-500">
                Posts to{' '}
                <code className="font-mono text-xs text-cyan-300">/api/v1/admin/rules</code> as a
                full replacement payload.
              </p>
              <button
                className="inline-flex items-center justify-center rounded-md border border-zinc-800 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                type="submit"
                disabled={saving || !canManageRules}
              >
                {saving ? 'Saving rule...' : 'Deploy policy'}
              </button>
            </div>
          </form>
        </article>

        <article className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Active policies
              </p>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-100">
                Current gateway policy
              </h3>
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">
              {ruleCountLabel}
            </span>
          </div>

          <div className="mt-6 grid gap-4">
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-12 text-center text-sm text-zinc-500">
                {canManageRules
                  ? 'No rules loaded yet. Refresh the gateway or add a first rule.'
                  : 'Save the gateway URL and admin passphrase to load the current ruleset.'}
              </div>
            ) : (
              rules.map((rule) => (
                <article
                  key={rule.id}
                  className="rounded-xl border border-zinc-800 bg-black/20 p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-base font-semibold text-zinc-100">{rule.id}</strong>
                        <span
                          className={[
                            'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]',
                            rule.enabled
                              ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
                              : 'border-zinc-800 bg-white/5 text-zinc-400',
                          ].join(' ')}
                        >
                          {rule.enabled ? 'active' : 'paused'}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-zinc-400">
                        {rule.description ?? 'No description provided.'}
                      </p>
                    </div>
                    <button
                      className="inline-flex items-center justify-center rounded-md border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20 disabled:cursor-wait disabled:opacity-60"
                      type="button"
                      onClick={() => void handleDeleteRule(rule.id)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs uppercase text-zinc-300">
                      {rule.algorithm.replace('_', ' ')}
                    </span>
                    <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs uppercase text-zinc-300">
                      {summariseRule(rule)}
                    </span>
                    <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs uppercase text-zinc-300">
                      {rule.method ?? 'ALL methods'}
                    </span>
                    <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs text-zinc-300">
                      {rule.endpointPattern}
                    </span>
                    <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-xs uppercase text-zinc-300">
                      {rule.clientTier ?? 'all tiers'}
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
