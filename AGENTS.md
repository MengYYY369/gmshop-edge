# GMShop Edge engineering contract

[简体中文](AGENTS.zh-CN.md)

## Product boundary

- Product, package, Worker, Node service, database, and durable resource names
  are `GMShop Edge` / `gmshop-edge`.
- GMShop is a single-deployment, single-tenant digital-goods store, not a payment
  gateway. It supports stock, private-download, and automation products.
- Public and customer surfaces use the normal Header layout. Internal operations
  use `/admin` and permission-driven navigation.
- GMShop may integrate explicitly approved third-party hosted payment processors,
  including Cryptomus invoices, with encrypted single-deployment credentials.
  It must not expose merchant protocols, operate as a payment gateway, custody
  wallets, scan chains, adapt exchange/wallet receipts, or create gateway orders.

## Approved stack and ownership

- Use Bun, strict TypeScript, React 19, TanStack Start/Router/Query/Table/Form,
  Tailwind CSS 4, shadcn/Radix, Zod, Better Auth, Drizzle, Cloudflare Workers
  (D1, KV, R2, Queues, Cron), Node.js with Nitro and SQLite, Paraglide, Vitest,
  Biome, and Wrangler. Docker is the supported Node distribution.
- Do not add a second router, auth system, ORM, form system, cache, formatter,
  linter, or i18n runtime.
- Feature pages, schemas, server functions, types, and domain behavior remain in
  `src/features`. Routes stay thin. Cross-domain runtime plumbing stays in
  `src/server`; Drizzle schemas stay in `src/db/schema`; tests stay in
  `tests/{unit,integration,security,e2e,fixtures,helpers}`.
- Preserve the established public/auth/install/dashboard/settings layouts,
  ProTable/ProForm foundations, sidebar, themes, and responsive interaction.

## Domain invariants

- Product types are `stock | download | automation`. Stock atomically allocates
  encrypted preset text, download grants private files, and automation runs
  deployments, scripts, resource provisioning, or concrete build workflows.
  Automation methods use artifact policy `none | optional | required`. Persist
  history as immutable order, input-definition, pricing, entitlement, and
  automation snapshots.
- Fiat values are decimal integer strings in `*_minor`; proportions are `*_bps`;
  timestamps/durations are milliseconds; sizes are bytes. Never use floating
  point for money.
- D1 is authoritative for orders, coupons, inventory, entitlements, automation quota,
  replay, rate limits, and audit. State transitions and outbox writes are atomic
  and idempotent. KV is only a validated, versioned, bounded read cache.
- Workers and Node/Nitro run the same full stack through explicit runtime
  adapters. Node uses SQLite authority, an in-process bounded cache, local
  private objects, a durable SQLite Queue, and a one-minute scheduler. Node is
  single-instance only; multi-replica and shared-network storage are unsupported.
- Private product media, downloads, artifacts, and exports use R2. Client input
  never selects an object key. Queue messages contain non-secret references only.
- Stock allocation is atomic. Fulfillment and automation state machines handle retries,
  duplicates, expiry, cancellation, refund, and manual recovery explicitly.

## Authentication and security

- Better Auth owns users, credentials, accounts, sessions, passwords, and
  one-time verifications. Project RBAC stores normalized role IDs on users and
  module permission masks on roles.
- The installer creates the first root and required settings only. Root cannot be
  edited/deleted; the last enabled root cannot be disabled or stripped of root.
- Every administrative server entry checks an enabled session and structured
  permission. Client hiding never replaces server authorization.
- Dynamic email/social/OIDC/Telegram providers use validated presets and IDs.
  Secrets use purpose-separated versioned envelopes, configuration changes
  invalidate revisioned auth factories, and link/unlink/disable operations must
  not lock accounts out.
- Telegram Mini App verifies raw initData HMAC, bot, age, origin, normalized user
  ID, and D1 replay. Telegram OIDC verifies code+PKCE, issuer, audience, nonce,
  signature, time, state, and replay. The grammY webhook bot provides localized
  commands, fixed Mini App targets, and Forum Topic support without persisting
  message content; support replies trust only a fresh Telegram administrator
  mirror.
- Enforce trusted Host/Origin, CSRF, bounded bodies, secure headers, structured
  redacted errors, SSRF/path protection, D1 rate limits, and audit. Sensitive
  exports require fresh-password reauthentication. Administrators without a
  local password must set one before performing a sensitive export.

## UI and internationalization

- All user-facing text uses Paraglide and supports `en-US` and `zh-CN`. Product
  content may render stored HTML without a contract-level sanitization
  requirement and falls back active locale → `en-US` → base fields.
- Localize money, dates, counts, statuses, billing periods, bytes, and build units.
- Keyboard access, accessible names, focus restoration, reduced motion, mobile,
  loading/empty/error states, and both themes are required.


## Quality and delivery

- Keep strict types, validate untrusted input once with Zod, use structured domain
  errors, and simplify touched code after non-trivial work. Prefer colocation and
  direct control flow; do not create generic service/repository/barrel layers.
- Biome is the only formatter/import organizer. Preserve unrelated user changes.
- The only clean-install migration baseline is `drizzle/0000_gmshop.sql`. Do not
  regenerate it on normal dev start or disguise gateway data as shop data.
- `bun run build`, `bun run predeploy`, and `bun run deploy` are Workers paths;
  Node uses `bun run build:node` and the multi-architecture GHCR image. The only
  public Node environment variable is `GMSHOP_DATA_DIR`; configure Origin,
  Allowed Hosts, email, and business credentials through the product UI.
- Node backup, restore, and Cloudflare import must use `bun run data -- …`.
  Never overwrite a non-empty target or copy a live SQLite database.
- Real payment, email, Telegram, and build-provider smoke suites are manual and
  unconditionally skipped; credentials or environment variables must not enable
  them automatically.
- During development run focused checks. When all executable TODOs are complete,
  run once on the same final tree:

```bash
bun run typecheck
bun run test
bun run check
bun run build
bun run build:node
```

- Completion also requires empty-D1 migration, permission-path, query-plan,
  R2/Queue, both-locale/theme/mobile/keyboard browser, and paired documentation
  evidence. Never commit real secrets.
- Releases use semantic-release from `main`. Native amd64 and arm64 jobs must
  smoke-test before publishing a GHCR manifest with SBOM and provenance.
