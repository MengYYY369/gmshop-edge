# 04 — 本地验证与测试

**What to build:** 全面验证 Bun 运行时 + AliMPay 的兼容性和功能正确性。

**Blocked by:** 03 — 适配上游结构性变更

**Status:** ready-for-agent

- [ ] 运行 `bun run typecheck` 无错误
- [ ] 运行 `bun run test` 无失败
- [ ] 验证 AliMPay 支付创建流程（POST /mapi.php → 获取 payurl/qrcode → 跳转）
- [ ] 验证 AliMPay 回调处理（签名验证 → 订单状态更新）
- [ ] 验证 QR 码/跳转链接在 storefront 正确展示
