import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  buildCandidateUsageSourceIds,
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  formatCompactNumber,
  formatUsd,
  normalizeAuthIndex,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';
import { authFilesApi } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: unknown;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

interface ModelBreakdownRow {
  model: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
  totalTokens: number;
  cost: number;
}

interface CredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
  totalTokens: number;
  cost: number;
  models: ModelBreakdownRow[];
}

interface AggregateBucket {
  success: number;
  failure: number;
  totalTokens: number;
  cost: number;
  models: Map<string, ModelBreakdownRow>;
}

const createBucket = (): AggregateBucket => ({
  success: 0,
  failure: 0,
  totalTokens: 0,
  cost: 0,
  models: new Map<string, ModelBreakdownRow>(),
});

const appendDetailToBucket = (
  bucket: AggregateBucket,
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>
) => {
  const isFailed = detail.failed === true;
  const totalTokens = extractTotalTokens(detail);
  const cost = calculateCost(detail, modelPrices);
  const modelName = String(detail.__modelName ?? '').trim() || '-';
  const modelBucket = bucket.models.get(modelName) ?? {
    model: modelName,
    success: 0,
    failure: 0,
    total: 0,
    successRate: 100,
    totalTokens: 0,
    cost: 0,
  };

  if (isFailed) {
    bucket.failure += 1;
    modelBucket.failure += 1;
  } else {
    bucket.success += 1;
    modelBucket.success += 1;
  }

  bucket.totalTokens += totalTokens;
  bucket.cost += cost;
  modelBucket.totalTokens += totalTokens;
  modelBucket.cost += cost;
  modelBucket.total = modelBucket.success + modelBucket.failure;
  modelBucket.successRate = modelBucket.total > 0 ? (modelBucket.success / modelBucket.total) * 100 : 100;
  bucket.models.set(modelName, modelBucket);
};

const mergeBucket = (target: AggregateBucket, bucket: AggregateBucket) => {
  target.success += bucket.success;
  target.failure += bucket.failure;
  target.totalTokens += bucket.totalTokens;
  target.cost += bucket.cost;

  bucket.models.forEach((modelBucket, modelName) => {
    const existing = target.models.get(modelName) ?? {
      model: modelName,
      success: 0,
      failure: 0,
      total: 0,
      successRate: 100,
      totalTokens: 0,
      cost: 0,
    };

    existing.success += modelBucket.success;
    existing.failure += modelBucket.failure;
    existing.totalTokens += modelBucket.totalTokens;
    existing.cost += modelBucket.cost;
    existing.total = existing.success + existing.failure;
    existing.successRate = existing.total > 0 ? (existing.success / existing.total) * 100 : 100;
    target.models.set(modelName, existing);
  });
};

const bucketToRow = (
  key: string,
  displayName: string,
  type: string,
  bucket: AggregateBucket
): CredentialRow => {
  const total = bucket.success + bucket.failure;
  return {
    key,
    displayName,
    type,
    success: bucket.success,
    failure: bucket.failure,
    total,
    successRate: total > 0 ? (bucket.success / total) * 100 : 100,
    totalTokens: bucket.totalTokens,
    cost: bucket.cost,
    models: Array.from(bucket.models.values()).sort((a, b) => b.total - a.total),
  };
};

export function CredentialStatsCard({
  usage,
  loading,
  modelPrices,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: CredentialStatsCardProps) {
  const { t } = useTranslation();
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const rawAuthIndex = file['auth_index'] ?? file.authIndex;
          const key = normalizeAuthIndex(rawAuthIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString(),
          });
        });
        setAuthFileMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];

    const details = collectUsageDetails(usage);
    const bySource = new Map<string, AggregateBucket>();
    const result: CredentialRow[] = [];
    const consumedSourceIds = new Set<string>();
    const authIndexToRowIndex = new Map<string, number>();
    const sourceToAuthIndex = new Map<string, string>();
    const sourceToAuthFile = new Map<string, CredentialInfo>();
    const fallbackByAuthIndex = new Map<string, AggregateBucket>();

    details.forEach((detail) => {
      const authIdx = normalizeAuthIndex(detail.auth_index);
      const source = detail.source;

      if (!source) {
        if (!authIdx) return;
        const fallback = fallbackByAuthIndex.get(authIdx) ?? createBucket();
        appendDetailToBucket(fallback, detail, modelPrices);
        fallbackByAuthIndex.set(authIdx, fallback);
        return;
      }

      const bucket = bySource.get(source) ?? createBucket();
      appendDetailToBucket(bucket, detail, modelPrices);
      bySource.set(source, bucket);

      if (authIdx && !sourceToAuthIndex.has(source)) {
        sourceToAuthIndex.set(source, authIdx);
      }
      if (authIdx && !sourceToAuthFile.has(source)) {
        const mapped = authFileMap.get(authIdx);
        if (mapped) sourceToAuthFile.set(source, mapped);
      }
    });

    const mergeBucketToRow = (index: number, bucket: AggregateBucket) => {
      const target = result[index];
      if (!target) return;
      const aggregate = createBucket();
      mergeBucket(aggregate, {
        success: target.success,
        failure: target.failure,
        totalTokens: target.totalTokens,
        cost: target.cost,
        models: new Map(target.models.map((model) => [model.model, { ...model }])),
      });
      mergeBucket(aggregate, bucket);
      result[index] = bucketToRow(target.key, target.displayName, target.type, aggregate);
    };

    const addConfigRow = (
      candidates: Iterable<string>,
      name: string,
      type: string,
      rowKey: string,
    ) => {
      const aggregate = createBucket();
      for (const id of candidates) {
        const bucket = bySource.get(id);
        if (!bucket) continue;
        mergeBucket(aggregate, bucket);
        consumedSourceIds.add(id);
      }
      const total = aggregate.success + aggregate.failure;
      if (total > 0) {
        result.push(bucketToRow(rowKey, name, type, aggregate));
      }
    };

    geminiKeys.forEach((c, i) =>
      addConfigRow(
        buildCandidateUsageSourceIds({ apiKey: c.apiKey, prefix: c.prefix }),
        c.prefix?.trim() || `Gemini #${i + 1}`,
        'gemini',
        `gemini:${i}`
      ));
    claudeConfigs.forEach((c, i) =>
      addConfigRow(
        buildCandidateUsageSourceIds({ apiKey: c.apiKey, prefix: c.prefix }),
        c.prefix?.trim() || `Claude #${i + 1}`,
        'claude',
        `claude:${i}`
      ));
    codexConfigs.forEach((c, i) =>
      addConfigRow(
        buildCandidateUsageSourceIds({ apiKey: c.apiKey, prefix: c.prefix }),
        c.prefix?.trim() || `Codex #${i + 1}`,
        'codex',
        `codex:${i}`
      ));
    vertexConfigs.forEach((c, i) =>
      addConfigRow(
        buildCandidateUsageSourceIds({ apiKey: c.apiKey, prefix: c.prefix }),
        c.prefix?.trim() || `Vertex #${i + 1}`,
        'vertex',
        `vertex:${i}`
      ));

    openaiProviders.forEach((provider, providerIndex) => {
      const candidates = new Set<string>();
      buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id));
      (provider.apiKeyEntries || []).forEach((entry) => {
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
      });

      addConfigRow(
        candidates,
        provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`,
        'openai',
        `openai:${providerIndex}`
      );
    });

    bySource.forEach((bucket, key) => {
      if (consumedSourceIds.has(key)) return;
      const authFile = sourceToAuthFile.get(key);
      const row = bucketToRow(
        key,
        authFile?.name || (key.startsWith('t:') ? key.slice(2) : key),
        authFile?.type || '',
        bucket
      );
      const rowIndex = result.push(row) - 1;
      const authIdx = sourceToAuthIndex.get(key);
      if (authIdx && !authIndexToRowIndex.has(authIdx)) {
        authIndexToRowIndex.set(authIdx, rowIndex);
      }
    });

    fallbackByAuthIndex.forEach((bucket, authIdx) => {
      if (bucket.success + bucket.failure === 0) return;

      const mapped = authFileMap.get(authIdx);
      let targetRowIndex = authIndexToRowIndex.get(authIdx);
      if (targetRowIndex === undefined && mapped) {
        const matchedIndex = result.findIndex(
          (row) => row.displayName === mapped.name && row.type === mapped.type
        );
        if (matchedIndex >= 0) {
          targetRowIndex = matchedIndex;
          authIndexToRowIndex.set(authIdx, matchedIndex);
        }
      }

      if (targetRowIndex !== undefined) {
        mergeBucketToRow(targetRowIndex, bucket);
        return;
      }

      const rowIndex = result.push(
        bucketToRow(`auth:${authIdx}`, mapped?.name || authIdx, mapped?.type || '', bucket)
      ) - 1;
      authIndexToRowIndex.set(authIdx, rowIndex);
    });

    return result.sort((a, b) => b.total - a.total);
  }, [usage, modelPrices, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, openaiProviders, authFileMap]);

  const toggleExpanded = (key: string) => {
    setExpandedRows((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  return (
    <Card title={t('usage_stats.credential_stats')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        <div className={styles.detailsScroll}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.credential_name')}</th>
                  <th>{t('usage_stats.provider')}</th>
                  <th>{t('usage_stats.requests_count')}</th>
                  <th>{t('usage_stats.success_rate')}</th>
                  <th>{t('usage_stats.total_tokens')}</th>
                  <th>{t('usage_stats.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = expandedRows[row.key] === true;
                  return (
                    <Fragment key={row.key}>
                      <tr>
                        <td className={styles.modelCell}>
                          <div className={styles.credentialNameBlock}>
                            <span>{row.displayName}</span>
                            {row.models.length > 0 && (
                              <button
                                type="button"
                                className={styles.breakdownToggle}
                                onClick={() => toggleExpanded(row.key)}
                              >
                                {isExpanded
                                  ? t('usage_stats.credential_models_hide')
                                  : t('usage_stats.credential_models_show', { count: row.models.length })}
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          {row.type ? <span className={styles.credentialType}>{row.type}</span> : '-'}
                        </td>
                        <td>
                          <span className={styles.requestCountCell}>
                            <span>{formatCompactNumber(row.total)}</span>
                            <span className={styles.requestBreakdown}>
                              (<span className={styles.statSuccess}>{row.success.toLocaleString()}</span>{' '}
                              <span className={styles.statFailure}>{row.failure.toLocaleString()}</span>)
                            </span>
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              row.successRate >= 95
                                ? styles.statSuccess
                                : row.successRate >= 80
                                  ? styles.statNeutral
                                  : styles.statFailure
                            }
                          >
                            {row.successRate.toFixed(1)}%
                          </span>
                        </td>
                        <td title={row.totalTokens.toLocaleString()}>{formatCompactNumber(row.totalTokens)}</td>
                        <td title={formatUsd(row.cost)}>{formatUsd(row.cost)}</td>
                      </tr>
                      {isExpanded && row.models.length > 0 && (
                        <tr>
                          <td colSpan={6} className={styles.breakdownCell}>
                            <div className={styles.breakdownSection}>
                              <div className={styles.breakdownTitle}>
                                {t('usage_stats.credential_model_breakdown')}
                              </div>
                              <div className={styles.tableWrapper}>
                                <table className={styles.breakdownTable}>
                                  <thead>
                                    <tr>
                                      <th>{t('usage_stats.model_name')}</th>
                                      <th>{t('usage_stats.requests_count')}</th>
                                      <th>{t('usage_stats.success_rate')}</th>
                                      <th>{t('usage_stats.total_tokens')}</th>
                                      <th>{t('usage_stats.cost')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.models.map((model) => (
                                      <tr key={`${row.key}:${model.model}`}>
                                        <td className={styles.modelCell}>{model.model}</td>
                                        <td>
                                          <span className={styles.requestCountCell}>
                                            <span>{formatCompactNumber(model.total)}</span>
                                            <span className={styles.requestBreakdown}>
                                              (
                                              <span className={styles.statSuccess}>
                                                {model.success.toLocaleString()}
                                              </span>{' '}
                                              <span className={styles.statFailure}>
                                                {model.failure.toLocaleString()}
                                              </span>
                                              )
                                            </span>
                                          </span>
                                        </td>
                                        <td>
                                          <span
                                            className={
                                              model.successRate >= 95
                                                ? styles.statSuccess
                                                : model.successRate >= 80
                                                  ? styles.statNeutral
                                                  : styles.statFailure
                                            }
                                          >
                                            {model.successRate.toFixed(1)}%
                                          </span>
                                        </td>
                                        <td title={model.totalTokens.toLocaleString()}>
                                          {formatCompactNumber(model.totalTokens)}
                                        </td>
                                        <td title={formatUsd(model.cost)}>{formatUsd(model.cost)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
