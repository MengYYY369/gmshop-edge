# 03 — 适配上游结构性变更

**What to build:** 适配 upstream 对 payment provider 模块的结构性调整，确保类型定义、凭证 schema 与上游对齐。

**Blocked by:** 02 — 恢复 AliMPay 支付提供商

**Status:** ready-for-agent

- [ ] 在 `provider.ts` 中加回 `"epay_v1"` 到 `paymentProviderValues` 和 `PaymentProviderFamily`
- [ ] 恢复 `epayV1CredentialSchema` 定义（PID 数字校验、secretKey、paymentMethod）
- [ ] 在 `providers/index.ts` 中重新注册 epayV1 provider
- [ ] 检查并修复上游移除的 `payment-sync-fn.ts` 和 `payment-sync.ts` 的引用
- [ ] 运行 `bun run typecheck` 确保类型正确
