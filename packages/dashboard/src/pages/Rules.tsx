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

export function RulesPage() {
  const { settings } = useDashboardShellContext();
  const [rules, setRules] = useState<RuleConfig[]>([]);
  const [form, setForm] = useState<RuleFormState>(DEFAULT_RULE_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const canManageRules = Boolean(settings.gatewayUrl.trim() && settings.adminToken.trim());
  const ruleCountLabel = useMemo(
    () => `${rules.length} active rule${rules.length === 1 ? '' : 's'}`,
    [rules.length],
  );

  const loadCurrentRules = async (): Promise<void> => {
    if (!canManageRules) {
      setRules([]);
      setError('Save both the gateway URL and an admin JWT to manage rules.');
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
  }, [canManageRules, settings.adminToken, settings.gatewayUrl]);

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
      setError('Save both the gateway URL and an admin JWT before posting rules.');
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
      setError('Save both the gateway URL and an admin JWT before deleting rules.');
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
    <div className="page-stack">
      <section className="page-header">
        <div className="page-copy">
          <span className="section-kicker">Rules management</span>
          <h2>Operate the live ruleset with guard rails</h2>
          <p>
            This page works with the existing admin API by replacing the full rules array whenever
            you add or remove a rule. That keeps the frontend aligned with the gateway contract that
            already exists today.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button-primary"
            type="button"
            onClick={() => void loadCurrentRules()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh rules'}
          </button>
          <p className="subtle-label">{ruleCountLabel}</p>
        </div>
      </section>

      {error ? <div className="alert-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="rules-layout">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">Add rule</span>
              <h3>Compose a new policy</h3>
            </div>
            <strong>{saving ? 'Saving...' : 'Ready'}</strong>
          </div>
          <form className="rule-form" onSubmit={(event) => void handleAddRule(event)}>
            <div className="form-grid">
              <label>
                <span>Rule ID</span>
                <input
                  name="id"
                  value={form.id}
                  onChange={handleFieldChange}
                  placeholder="pro-read-burst"
                />
              </label>
              <label>
                <span>Endpoint pattern</span>
                <input
                  name="endpointPattern"
                  value={form.endpointPattern}
                  onChange={handleFieldChange}
                  placeholder="/api/v1/orders"
                />
              </label>
              <label>
                <span>HTTP method</span>
                <input
                  name="method"
                  value={form.method}
                  onChange={handleFieldChange}
                  placeholder="GET"
                />
              </label>
              <label>
                <span>Client tier</span>
                <input
                  name="clientTier"
                  value={form.clientTier}
                  onChange={handleFieldChange}
                  placeholder="pro"
                />
              </label>
              <label>
                <span>Window (ms)</span>
                <input
                  name="windowMs"
                  type="number"
                  min="1"
                  value={form.windowMs}
                  onChange={handleFieldChange}
                />
              </label>
              <label>
                <span>Max requests</span>
                <input
                  name="maxRequests"
                  type="number"
                  min="1"
                  value={form.maxRequests}
                  onChange={handleFieldChange}
                />
              </label>
              <label>
                <span>Burst capacity</span>
                <input
                  name="burstCapacity"
                  type="number"
                  min="0"
                  value={form.burstCapacity}
                  onChange={handleFieldChange}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span>Algorithm</span>
                <select name="algorithm" value={form.algorithm} onChange={handleFieldChange}>
                  <option value={AlgorithmType.TOKEN_BUCKET}>Token bucket</option>
                  <option value={AlgorithmType.FIXED_WINDOW}>Fixed window</option>
                  <option value={AlgorithmType.SLIDING_WINDOW}>Sliding window</option>
                  <option value={AlgorithmType.LEAKY_BUCKET}>Leaky bucket</option>
                </select>
              </label>
            </div>
            <label className="form-area">
              <span>Description</span>
              <textarea
                name="description"
                value={form.description}
                onChange={handleFieldChange}
                rows={4}
                placeholder="Describe why this rule exists and who it protects."
              />
            </label>
            <label className="checkbox-row">
              <input
                name="enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={handleFieldChange}
              />
              <span>Rule is enabled immediately after save.</span>
            </label>
            <div className="form-footer">
              <p className="subtle-label">
                Posts to <code>/api/v1/admin/rules</code> as a full replacement payload.
              </p>
              <button
                className="button-secondary"
                type="submit"
                disabled={saving || !canManageRules}
              >
                {saving ? 'Saving rule...' : 'Add rule'}
              </button>
            </div>
          </form>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">Active rules</span>
              <h3>Current gateway policy</h3>
            </div>
            <strong>{ruleCountLabel}</strong>
          </div>
          <div className="rule-list">
            {rules.length === 0 ? (
              <div className="chart-empty">
                {canManageRules
                  ? 'No rules loaded yet. Refresh the gateway or add a first rule.'
                  : 'Save the gateway URL and admin JWT to load the current ruleset.'}
              </div>
            ) : (
              rules.map((rule) => (
                <article key={rule.id} className="rule-card">
                  <div className="rule-card-head">
                    <div>
                      <strong>{rule.id}</strong>
                      <p>{rule.description ?? 'No description provided.'}</p>
                    </div>
                    <button
                      className="button-ghost"
                      type="button"
                      onClick={() => void handleDeleteRule(rule.id)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="rule-chip-row">
                    <span className="rule-chip">{rule.algorithm}</span>
                    <span className="rule-chip">{summariseRule(rule)}</span>
                    <span className="rule-chip">{rule.method ?? 'ALL methods'}</span>
                    <span className="rule-chip">{rule.endpointPattern}</span>
                    <span className="rule-chip">{rule.clientTier ?? 'all tiers'}</span>
                    <span className="rule-chip">{rule.enabled ? 'enabled' : 'disabled'}</span>
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
