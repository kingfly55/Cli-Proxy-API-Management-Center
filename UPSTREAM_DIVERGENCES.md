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

## Files primarily responsible for the divergence
- `src/components/usage/CredentialStatsCard.tsx`
- `src/pages/UsagePage.tsx`
- `src/pages/UsagePage.module.scss`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/ru.json`
- `src/components/ui/Modal.tsx`

## Notes
- The local `package-lock.json` changed after dependency installation for building and verification.
- This document is intended to help reviewers compare this fork against the upstream management-center repository.
