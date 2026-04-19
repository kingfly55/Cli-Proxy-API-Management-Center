import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import {
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  formatCompactNumber,
  formatUsd,
  parseRoleSlug,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface RoleStatsCardProps {
  usage: unknown;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
}

interface SlugBreakdownRow {
  slug: string;
  repo: string;
  tier: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
  totalTokens: number;
  cost: number;
}

interface RoleRow {
  key: string;
  role: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
  totalTokens: number;
  cost: number;
  slugs: SlugBreakdownRow[];
  repos: Set<string>;
  tiers: Set<string>;
}

const ensureSlugRow = (
  map: Map<string, SlugBreakdownRow>,
  slug: string,
  repo: string,
  tier: string
): SlugBreakdownRow => {
  const existing = map.get(slug);
  if (existing) return existing;
  const created: SlugBreakdownRow = {
    slug,
    repo,
    tier,
    success: 0,
    failure: 0,
    total: 0,
    successRate: 100,
    totalTokens: 0,
    cost: 0,
  };
  map.set(slug, created);
  return created;
};

const finalizeSlugRow = (row: SlugBreakdownRow): SlugBreakdownRow => {
  row.total = row.success + row.failure;
  row.successRate = row.total > 0 ? (row.success / row.total) * 100 : 100;
  return row;
};

const applyDetailToSlug = (
  row: SlugBreakdownRow,
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>
) => {
  const isFailed = detail.failed === true;
  const tokens = extractTotalTokens(detail);
  const cost = calculateCost(detail, modelPrices);
  if (isFailed) row.failure += 1;
  else row.success += 1;
  row.totalTokens += tokens;
  row.cost += cost;
};

export function RoleStatsCard({ usage, loading, modelPrices }: RoleStatsCardProps) {
  const { t } = useTranslation();
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const { rows, unparsed } = useMemo(() => {
    const bySlug = new Map<string, SlugBreakdownRow>();
    const byRole = new Map<string, RoleRow>();
    const unparsedRow: SlugBreakdownRow = {
      slug: '__unparsed__',
      repo: '',
      tier: '',
      success: 0,
      failure: 0,
      total: 0,
      successRate: 100,
      totalTokens: 0,
      cost: 0,
    };

    if (!usage) {
      return { rows: [] as RoleRow[], unparsed: unparsedRow };
    }

    const details = collectUsageDetails(usage);
    details.forEach((detail) => {
      const slug = (detail.original_model || '').trim();
      if (!slug) return;
      const parsed = parseRoleSlug(slug);
      if (!parsed) {
        applyDetailToSlug(unparsedRow, detail, modelPrices);
        return;
      }
      const slugRow = ensureSlugRow(bySlug, slug, parsed.repo, parsed.tier);
      applyDetailToSlug(slugRow, detail, modelPrices);

      let roleRow = byRole.get(parsed.role);
      if (!roleRow) {
        roleRow = {
          key: parsed.role,
          role: parsed.role,
          success: 0,
          failure: 0,
          total: 0,
          successRate: 100,
          totalTokens: 0,
          cost: 0,
          slugs: [],
          repos: new Set(),
          tiers: new Set(),
        };
        byRole.set(parsed.role, roleRow);
      }
      if (detail.failed === true) roleRow.failure += 1;
      else roleRow.success += 1;
      roleRow.totalTokens += extractTotalTokens(detail);
      roleRow.cost += calculateCost(detail, modelPrices);
      if (parsed.repo) roleRow.repos.add(parsed.repo);
      if (parsed.tier) roleRow.tiers.add(parsed.tier);
    });

    bySlug.forEach((row, slug) => {
      finalizeSlugRow(row);
      const parsed = parseRoleSlug(slug);
      if (!parsed) return;
      const roleRow = byRole.get(parsed.role);
      if (roleRow) roleRow.slugs.push(row);
    });

    const finalRows: RoleRow[] = [];
    byRole.forEach((row) => {
      row.total = row.success + row.failure;
      row.successRate = row.total > 0 ? (row.success / row.total) * 100 : 100;
      row.slugs.sort((a, b) => b.total - a.total);
      finalRows.push(row);
    });
    finalRows.sort((a, b) => b.total - a.total);

    finalizeSlugRow(unparsedRow);

    return { rows: finalRows, unparsed: unparsedRow };
  }, [usage, modelPrices]);

  const toggleExpanded = (key: string) => {
    setExpandedRows((current) => ({ ...current, [key]: !current[key] }));
  };

  const showUnparsed = unparsed.total > 0;

  return (
    <Card title={t('role_stats.title')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 || showUnparsed ? (
        <div className={styles.detailsScroll}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('role_stats.role')}</th>
                  <th>{t('role_stats.repos')}</th>
                  <th>{t('role_stats.tiers')}</th>
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
                            <span>{row.role}</span>
                            {row.slugs.length > 0 && (
                              <button
                                type="button"
                                className={styles.breakdownToggle}
                                onClick={() => toggleExpanded(row.key)}
                              >
                                {isExpanded
                                  ? t('role_stats.slugs_hide')
                                  : t('role_stats.slugs_show', { count: row.slugs.length })}
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          {row.repos.size > 0 ? Array.from(row.repos).sort().join(', ') : '-'}
                        </td>
                        <td>
                          {row.tiers.size > 0 ? Array.from(row.tiers).sort().join(', ') : '-'}
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
                      {isExpanded && row.slugs.length > 0 && (
                        <tr>
                          <td colSpan={7} className={styles.breakdownCell}>
                            <div className={styles.breakdownSection}>
                              <div className={styles.breakdownTitle}>
                                {t('role_stats.slug_breakdown')}
                              </div>
                              <div className={styles.tableWrapper}>
                                <table className={styles.breakdownTable}>
                                  <thead>
                                    <tr>
                                      <th>{t('role_stats.slug')}</th>
                                      <th>{t('role_stats.repo')}</th>
                                      <th>{t('role_stats.tier')}</th>
                                      <th>{t('usage_stats.requests_count')}</th>
                                      <th>{t('usage_stats.success_rate')}</th>
                                      <th>{t('usage_stats.total_tokens')}</th>
                                      <th>{t('usage_stats.cost')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.slugs.map((slug) => (
                                      <tr key={`${row.key}:${slug.slug}`}>
                                        <td className={styles.modelCell}>{slug.slug}</td>
                                        <td>{slug.repo || '-'}</td>
                                        <td>{slug.tier || '-'}</td>
                                        <td>
                                          <span className={styles.requestCountCell}>
                                            <span>{formatCompactNumber(slug.total)}</span>
                                            <span className={styles.requestBreakdown}>
                                              (<span className={styles.statSuccess}>{slug.success.toLocaleString()}</span>{' '}
                                              <span className={styles.statFailure}>{slug.failure.toLocaleString()}</span>)
                                            </span>
                                          </span>
                                        </td>
                                        <td>
                                          <span
                                            className={
                                              slug.successRate >= 95
                                                ? styles.statSuccess
                                                : slug.successRate >= 80
                                                  ? styles.statNeutral
                                                  : styles.statFailure
                                            }
                                          >
                                            {slug.successRate.toFixed(1)}%
                                          </span>
                                        </td>
                                        <td title={slug.totalTokens.toLocaleString()}>
                                          {formatCompactNumber(slug.totalTokens)}
                                        </td>
                                        <td title={formatUsd(slug.cost)}>{formatUsd(slug.cost)}</td>
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
                {showUnparsed && (
                  <tr>
                    <td className={styles.modelCell} colSpan={3}>
                      {t('role_stats.unparsed_row')}
                    </td>
                    <td>
                      <span className={styles.requestCountCell}>
                        <span>{formatCompactNumber(unparsed.total)}</span>
                        <span className={styles.requestBreakdown}>
                          (<span className={styles.statSuccess}>{unparsed.success.toLocaleString()}</span>{' '}
                          <span className={styles.statFailure}>{unparsed.failure.toLocaleString()}</span>)
                        </span>
                      </span>
                    </td>
                    <td>{unparsed.successRate.toFixed(1)}%</td>
                    <td title={unparsed.totalTokens.toLocaleString()}>
                      {formatCompactNumber(unparsed.totalTokens)}
                    </td>
                    <td title={formatUsd(unparsed.cost)}>{formatUsd(unparsed.cost)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('role_stats.no_data')}</div>
      )}
    </Card>
  );
}
