# Upstream Divergences

This fork intentionally diverges from the upstream management center in the following ways:

## 1. Credential usage view is auth-file aware
- The Usage page's credential statistics card is extended to aggregate request data by auth file / credential.
- Matching uses the existing usage detail fields (`source`, `auth_index`) plus `/v0/management/auth-files` metadata.
- Rows now show provider, request counts, success rate, total token usage, and computed cost.

## 2. Per-model breakdown is available inside each credential row
- Each credential row can be expanded to show a nested per-model breakdown.
- The nested view includes requests, success rate, total tokens, and cost per model.

## 3. Cost totals are derived client-side from saved model pricing
- This fork reuses the existing model price configuration path rather than introducing a separate pricing system.
- Credential-level and model-level costs are sums of request-level costs computed from saved model prices.

## 4. Minor local build compatibility fix
- `src/components/ui/Modal.tsx` was adjusted to use `setTimeout` / `clearTimeout` without the `window.` prefix so the project builds cleanly with the installed TypeScript toolchain.
- This is a compatibility fix only and does not intentionally change modal behavior.

## 5. Role / repo statistics view (WebCity role-scoped slug attribution)
- New `RoleStatsCard` component (`src/components/usage/RoleStatsCard.tsx`) groups usage by parsed role slug `[REPO-]ROLE-TIER`, e.g. `wa-builder-sonnet`, `mayor-opus`, `th-self-check-haiku`.
- Requires the matching fork of CLIProxyAPIPlus that records `original_model` in each `RequestDetail` (see `docs/UPSTREAM_DIVERGENCES.md` section 7 in that repo).
- Reuses existing cost calculation via `calculateCost` + saved model pricing — no separate pricing logic.
- Shows per-role totals with expandable per-slug rows; slugs not matching the `[REPO-]ROLE-TIER` format fall into an `unparsed` bucket.
- Displays role, repos-in-use, tiers-in-use, requests, success rate, total tokens, and cost.
- Wired into `UsagePage.tsx` below `CredentialStatsCard`.

## 6. Page-level role / repo / tier filters on the Usage page
- Three new filter dropdowns (**Role**, **Repo**, **Tier**) live in the Usage page header next to the existing time range filter.
- Filter values persist to `localStorage` (`cli-proxy-usage-role-filter-v1`, `cli-proxy-usage-repo-filter-v1`, `cli-proxy-usage-tier-filter-v1`).
- The role dropdown is populated dynamically from `collectRolesFromUsage(usage)` — only roles actually present in the data appear.
- The repo and tier dropdowns are populated from `KNOWN_REPO_PREFIXES` (`wa`, `cm`, `th`) and `KNOWN_TIERS` (`haiku`, `sonnet`, `opus`).
- `filteredUsage` is composed as `filterUsageByRoleRepoTier(filterUsageByTimeRange(usage, timeRange), {role, repo, tier})` and passed to **every** child component on the page (StatCards, charts, token/cost trends, ApiDetailsCard, ModelStatsCard, RequestEventsDetailsCard, CredentialStatsCard, RoleStatsCard).
- When any filter is active, requests without `original_model` are excluded from the filtered dataset (since they can't be attributed). When all filters are `__any__`, the filter is a no-op and pre-existing behavior is preserved.
- `RoleStatsCard` was simplified: its internal role/repo/tier filter dropdowns were removed (filters now come from the page). The card now purely reports whatever the page filters let through.

## New utilities in `src/utils/usage.ts`
- `parseRoleSlug(slug): ParsedRoleSlug | null` — parses `[REPO-]ROLE-TIER` into `{repo, role, tier}`; returns null if the slug does not match.
- `KNOWN_REPO_PREFIXES`, `KNOWN_TIERS` — authoritative lists used by filters and parser.
- `filterUsageByRoleRepoTier<T>(usageData: T, filter: {role?, repo?, tier?}): T` — filters the raw usage tree (same shape as `filterUsageByTimeRange`) to include only requests matching the slug constraints. Excludes requests without `original_model` when any filter is active.
- `collectRolesFromUsage(usage): string[]` — returns the sorted unique set of role names observed in the data's `original_model` fields.
- `UsageDetail.original_model?: string` field added; `collectUsageDetails` populates it from `detailRaw.original_model` when present.

## Files primarily responsible for the divergence
- `src/components/usage/CredentialStatsCard.tsx`
- `src/components/usage/RoleStatsCard.tsx`
- `src/components/usage/index.ts`
- `src/pages/UsagePage.tsx`
- `src/pages/UsagePage.module.scss`
- `src/utils/usage.ts`
- `src/i18n/locales/en.json` (adds `role_stats.*` section)
- `src/i18n/locales/zh-CN.json` (adds `role_stats.*` section)
- `src/i18n/locales/ru.json` (adds `role_stats.*` section)
- `src/components/ui/Modal.tsx`

## Notes
- The local `package-lock.json` changed after dependency installation for building and verification.
- This document is intended to help reviewers compare this fork against the upstream management-center repository.
