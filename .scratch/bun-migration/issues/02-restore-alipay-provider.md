# 02 — 恢复 AliMPay 支付提供商

**What to build:** 在 bun-migration 分支上重新添加 AliMPay（epay_v1）支付提供商，使支付创建和跳转功能正常工作。

**Blocked by:** 01 — 创建 Bun 迁移分支

**Status:** ready-for-agent

- [ ] 从当前 main 恢复 `src/features/shop-payments/providers/epay-v1.ts` 文件
- [ ] 确保 `mapiResponseSchema` 中 `money` 字段为 optional（AliMPay 不返回此字段）
- [ ] 确保 `checkoutPresentation` 为 `"redirect"`（AliMPay 链接包含二维码页面）
- [ ] 验证支付创建流程可正常调用 AliMPay `/mapi.php` 并获取跳转链接
